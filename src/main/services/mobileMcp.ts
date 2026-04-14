/**
 * In-process MCP server exposing mobilecli device tools to the Claude agent SDK.
 *
 * Uses the SDK's own `createSdkMcpServer` + `tool` helpers so the server runs
 * in the same process — no child process spawn, no stdio transport overhead.
 *
 * ⚠️  This file runs inside a UtilityProcess (via agentWorker).
 * DO NOT import from 'electron' or any module that transitively imports it.
 *
 * Device operations are in `mobileDevice.ts` — this file only defines tools.
 */

import { z } from 'zod'
import {
  setActiveDevice as _setActiveDevice,
  getActiveDevice as _getActiveDevice,
  setActiveFramework as _setActiveFramework,
  getActiveFramework,
  rpc, requireDevice, listDevices, bootDevice, gesture, pressButton,
  screenshot, getScreenSize, sendText, getOrientation, setOrientation,
  resizeScreenshot, getElements, formatElements,
  reloadApp, openDevMenu, hotRestart,
} from './mobileDevice'

export const setActiveDevice = _setActiveDevice
export const getActiveDevice = _getActiveDevice
export const setActiveFramework = _setActiveFramework

// ─── Lazy-loaded SDK helpers ───────────────────────────────────────────────

let _createSdkMcpServer: typeof import('@anthropic-ai/claude-agent-sdk').createSdkMcpServer
let _tool: typeof import('@anthropic-ai/claude-agent-sdk').tool

async function loadSdkHelpers() {
  if (_createSdkMcpServer !== undefined && _tool !== undefined) return
  const sdk = await import('@anthropic-ai/claude-agent-sdk')
  _createSdkMcpServer = sdk.createSdkMcpServer
  _tool = sdk.tool
}

// ─── MCP Server ────────────────────────────────────────────────────────────

/**
 * Creates an MCP server config that can be passed directly to the SDK's
 * `mcpServers` option. Returns `{ type: 'sdk', name, instance }`.
 */
export async function createMobileDeviceServer() {
  await loadSdkHelpers()

  return _createSdkMcpServer({
    name: 'mobile-device',
    version: '1.0.0',
    tools: [
      // ── Device management ──────────────────────────────────────────────
      _tool(
        'mobile_list_devices',
        'List all available mobile devices (simulators, emulators, real devices) with their status',
        {},
        async () => {
          const devices = await listDevices()
          return { content: [{ type: 'text' as const, text: JSON.stringify(devices, null, 2) }] }
        },
      ),

      _tool(
        'mobile_use_device',
        'Set the active device for all subsequent mobile commands. Call mobile_list_devices first.',
        { deviceId: z.string().describe('The device identifier to use') },
        async ({ deviceId }) => {
          _setActiveDevice(deviceId)
          return { content: [{ type: 'text' as const, text: `Active device set to: ${deviceId}` }] }
        },
      ),

      _tool(
        'mobile_boot_device',
        'Boot a simulator or emulator',
        { deviceId: z.string().describe('The device identifier to boot') },
        async ({ deviceId }) => {
          await bootDevice(deviceId)
          return { content: [{ type: 'text' as const, text: `Device ${deviceId} booted` }] }
        },
      ),

      // ── Screen ─────────────────────────────────────────────────────────
      _tool(
        'mobile_take_screenshot',
        'Take a screenshot of the active device screen for visual context. Returns a JPEG image sized to logical point dimensions. Do NOT estimate coordinates from this image — use mobile_tap_element to interact with UI elements.',
        {},
        async () => {
          const id = requireDevice()
          const [b64, size] = await Promise.all([screenshot(id), getScreenSize(id)])
          if (!b64) throw new Error('Screenshot failed')
          let imgData = b64
          let mimeType = 'image/png'
          try {
            imgData = await resizeScreenshot(b64, size.width)
            mimeType = 'image/jpeg'
          } catch { /* fall back to original PNG if sips fails */ }
          return {
            content: [
              { type: 'image' as const, data: imgData, mimeType: mimeType as 'image/png' },
            ],
          }
        },
      ),

      _tool(
        'mobile_get_screen_size',
        'Get the active device screen dimensions in logical points',
        {},
        async () => {
          const id = requireDevice()
          const size = await getScreenSize(id)
          return { content: [{ type: 'text' as const, text: JSON.stringify(size) }] }
        },
      ),

      // ── Elements (accessibility tree) ──────────────────────────────────
      _tool(
        'mobile_list_elements',
        'List all UI elements on screen with their types, text, labels, and exact center coordinates from the accessibility tree. Call this when you need to see available elements before using mobile_tap_element. Do not cache results — screen content changes after every interaction.',
        {},
        async () => {
          const id = requireDevice()
          const elements = await getElements(id)
          const formatted = formatElements(elements)
          return {
            content: [{
              type: 'text' as const,
              text: formatted || 'No elements found on screen.',
            }],
          }
        },
      ),

      _tool(
        'mobile_tap_element',
        'PRIMARY TAP METHOD. Find a UI element by text, label, or identifier and tap its exact center using the accessibility tree. Always use this instead of mobile_tap for buttons, links, text fields, tabs, list items, and any labeled element. If no match is found, returns available elements so you can retry with the correct text.',
        {
          text: z.string().optional().describe('Element display text to match (substring)'),
          label: z.string().optional().describe('Accessibility label to match (substring)'),
          identifier: z.string().optional().describe('Accessibility identifier (exact match)'),
          index: z.number().optional().describe('If multiple matches, pick the Nth (0-based, default 0)'),
        },
        async ({ text, label, identifier, index }) => {
          if (!text && !label && !identifier) {
            throw new Error('Provide at least one of: text, label, or identifier')
          }
          const id = requireDevice()
          const elements = await getElements(id)
          const lower = (s?: string) => s?.toLowerCase() ?? ''
          const matches = elements.filter((el) => {
            if (identifier && el.identifier === identifier) return true
            if (text && lower(el.text).includes(lower(text))) return true
            if (text && lower(el.label).includes(lower(text))) return true
            if (label && lower(el.label).includes(lower(label))) return true
            if (label && lower(el.text).includes(lower(label))) return true
            return false
          })
          if (matches.length === 0) {
            const available = elements
              .filter((el) => el.text || el.label)
              .slice(0, 20)
              .map((el) => `  ${el.type}: "${el.text || el.label}"`)
              .join('\n')
            throw new Error(`No element found. Available elements:\n${available}`)
          }
          const pick = matches[index ?? 0]
          if (!pick) throw new Error(`Only ${matches.length} matches, index ${index} out of range`)
          const cx = Math.round(pick.rect.x + pick.rect.width / 2)
          const cy = Math.round(pick.rect.y + pick.rect.height / 2)
          const err = await gesture(id, [
            { type: 'pointerMove', duration: 0, x: cx, y: cy },
            { type: 'pointerDown', button: 0 },
            { type: 'pause', duration: 50 },
            { type: 'pointerUp', button: 0 },
          ])
          if (err) throw new Error(err)
          const desc = pick.text || pick.label || pick.identifier || pick.type
          return { content: [{ type: 'text' as const, text: `Tapped "${desc}" at (${cx}, ${cy})` }] }
        },
      ),

      // ── Touch / Gesture ─────────────────────────────────────────────────
      _tool(
        'mobile_tap',
        'FALLBACK: Tap at raw (x, y) coordinates. Only use this for non-interactive areas (maps, images, canvas) where no accessibility element exists. For buttons, links, text fields, and any labeled element, use mobile_tap_element instead.',
        {
          x: z.number().describe('X coordinate in logical points'),
          y: z.number().describe('Y coordinate in logical points'),
        },
        async ({ x, y }) => {
          const id = requireDevice()
          const err = await gesture(id, [
            { type: 'pointerMove', duration: 0, x, y },
            { type: 'pointerDown', button: 0 },
            { type: 'pause', duration: 50 },
            { type: 'pointerUp', button: 0 },
          ])
          if (err) throw new Error(err)
          return { content: [{ type: 'text' as const, text: `Tapped (${x}, ${y})` }] }
        },
      ),

      _tool(
        'mobile_long_press',
        'Long press at (x, y) coordinates on the active device screen',
        {
          x: z.number().describe('X coordinate in logical points'),
          y: z.number().describe('Y coordinate in logical points'),
          duration: z.number().default(1000).describe('Hold duration in milliseconds'),
        },
        async ({ x, y, duration }) => {
          const id = requireDevice()
          const err = await gesture(id, [
            { type: 'pointerMove', duration: 0, x, y },
            { type: 'pointerDown', button: 0 },
            { type: 'pause', duration },
            { type: 'pointerUp', button: 0 },
          ])
          if (err) throw new Error(err)
          return { content: [{ type: 'text' as const, text: `Long pressed (${x}, ${y}) for ${duration}ms` }] }
        },
      ),

      _tool(
        'mobile_swipe',
        'Swipe on the active device screen from start to end coordinates in logical points',
        {
          startX: z.number().describe('Start X in logical points'),
          startY: z.number().describe('Start Y in logical points'),
          endX: z.number().describe('End X in logical points'),
          endY: z.number().describe('End Y in logical points'),
          duration: z.number().default(300).describe('Swipe duration in milliseconds'),
        },
        async ({ startX, startY, endX, endY, duration }) => {
          const id = requireDevice()
          const steps = 4
          const segMs = Math.round(duration / steps)
          const actions: Record<string, unknown>[] = [
            { type: 'pointerMove', duration: 0, x: startX, y: startY },
            { type: 'pointerDown', button: 0 },
          ]
          for (let i = 1; i <= steps; i++) {
            const t = i / steps
            actions.push({
              type: 'pointerMove', duration: segMs,
              x: Math.round(startX + (endX - startX) * t),
              y: Math.round(startY + (endY - startY) * t),
            })
          }
          actions.push({ type: 'pointerUp', button: 0 })
          const err = await gesture(id, actions)
          if (err) throw new Error(err)
          return { content: [{ type: 'text' as const, text: `Swiped (${startX},${startY}) → (${endX},${endY})` }] }
        },
      ),

      // ── Input ──────────────────────────────────────────────────────────
      _tool(
        'mobile_type_text',
        'Type text into the currently focused input field on the active device',
        {
          text: z.string().describe('The text to type'),
          submit: z.boolean().default(false).describe('Press Enter after typing'),
        },
        async ({ text, submit }) => {
          const id = requireDevice()
          const err = await sendText(id, text)
          if (err) throw new Error(err)
          if (submit) await pressButton(id, 'ENTER')
          return { content: [{ type: 'text' as const, text: `Typed "${text}"${submit ? ' + Enter' : ''}` }] }
        },
      ),

      _tool(
        'mobile_press_button',
        'Press a hardware/system button: HOME, BACK, VOLUME_UP, VOLUME_DOWN, POWER, APP_SWITCH, ENTER',
        {
          button: z.enum(['HOME', 'BACK', 'VOLUME_UP', 'VOLUME_DOWN', 'POWER', 'APP_SWITCH', 'ENTER'])
            .describe('Button name'),
        },
        async ({ button }) => {
          const id = requireDevice()
          const err = await pressButton(id, button)
          if (err) throw new Error(err)
          return { content: [{ type: 'text' as const, text: `Pressed ${button}` }] }
        },
      ),

      // ── Orientation ────────────────────────────────────────────────────
      _tool(
        'mobile_get_orientation',
        'Get the current orientation of the active device',
        {},
        async () => {
          const id = requireDevice()
          const orientation = await getOrientation(id)
          return { content: [{ type: 'text' as const, text: orientation }] }
        },
      ),

      _tool(
        'mobile_set_orientation',
        'Set the active device orientation to portrait or landscape',
        { orientation: z.enum(['portrait', 'landscape']).describe('Target orientation') },
        async ({ orientation }) => {
          const id = requireDevice()
          await setOrientation(id, orientation)
          return { content: [{ type: 'text' as const, text: `Orientation set to ${orientation}` }] }
        },
      ),

      // ── Framework debug tools ───────────────────────────────────────────
      _tool(
        'mobile_reload_app',
        'Reload the running app. React Native: triggers fast refresh. Flutter: triggers hot reload (preserves state). Requires a connected device and detected framework.',
        {},
        async () => {
          const result = await reloadApp()
          return { content: [{ type: 'text' as const, text: result }] }
        },
      ),

      _tool(
        'mobile_open_dev_menu',
        'Open the React Native developer menu on the connected device. Only available for React Native projects.',
        {},
        async () => {
          const id = requireDevice()
          const info = await rpc<{ device: { platform?: string } }>('device.info', { deviceId: id }).catch(() => ({ device: { platform: undefined } }))
          const platform = info.device?.platform ?? 'ios'
          const result = await openDevMenu(id, platform)
          return { content: [{ type: 'text' as const, text: result }] }
        },
      ),

      _tool(
        'mobile_hot_restart',
        'Perform a full hot restart of the Flutter app (resets all state). Only available for Flutter projects.',
        {},
        async () => {
          requireDevice() // ensure a device is connected
          const result = await hotRestart()
          return { content: [{ type: 'text' as const, text: result }] }
        },
      ),

      _tool(
        'mobile_open_devtools',
        'Open the framework developer tools in the system browser. React Native: opens Metro dev server (localhost:8081). Flutter: opens Flutter DevTools (localhost:9100).',
        {},
        async () => {
          const fw = getActiveFramework()
          if (fw === 'react-native') {
            return { content: [{ type: 'text' as const, text: 'Open http://localhost:8081 in your browser for Metro dev server and debugging tools.' }] }
          }
          if (fw === 'flutter') {
            return { content: [{ type: 'text' as const, text: 'Open http://localhost:9100 in your browser for Flutter DevTools.' }] }
          }
          throw new Error('No mobile framework detected')
        },
      ),
    ],
  })
}
