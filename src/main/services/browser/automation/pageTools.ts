// In-page agent tools: snapshot, input, screenshots, evaluation, logs.
import type { WebContents } from 'electron'
import type { BrowserToolResult } from '../../../../shared/browserTools'
import { captureGuestPng, cdpSend, consoleLog, ensureCdp, networkLog } from '../cdp'
import { setViewport } from '../viewport'
import {
  AUTOMATION_WORLD_ID,
  SNAPSHOT_SCRIPT,
  elementRectScript,
  focusForFillScript,
  locateScript,
  selectOptionScript,
  waitConditionScript,
} from './pageScripts'
import { insertText, mouseClick, mouseMove, mouseWheel, pressKey } from './input'
import { getGuestByWebContentsId } from '../registry'
import { requestRenderer } from '../rendererRequests'

type Args = Record<string, string | number | boolean>

const MAX_EVAL_CHARS = 20_000
const LEVEL_RANK: Record<string, number> = { verbose: 0, info: 1, warning: 2, error: 3 }

function isolated<T>(wc: WebContents, code: string): Promise<T> {
  return wc.executeJavaScriptInIsolatedWorld(AUTOMATION_WORLD_ID, [{ code }]) as Promise<T>
}

async function locate(wc: WebContents, ref: string): Promise<{ x: number; y: number }> {
  const hit = await isolated<{ x: number; y: number; error?: string }>(wc, locateScript(ref))
  if (!hit || hit.error) throw new Error(hit?.error ?? `Unknown ref ${ref}`)
  return hit
}

const text = (t: string): BrowserToolResult => ({ text: t })

/**
 * CDP key events on a <webview> guest follow the *embedder's* keyboard focus:
 * if Braid's address bar or chat input is focused, keys land there. Ask the
 * renderer to focus the tab's <webview> first (the agent banner shows why).
 */
async function focusForKeys(wc: WebContents): Promise<void> {
  const guest = getGuestByWebContentsId(wc.id)
  if (!guest) return
  await requestRenderer({ type: 'focusTab', worktreeId: guest.worktreeId, tabId: guest.tabId }).catch(() => {})
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function settle(wc: WebContents): Promise<void> {
  // Give click-triggered navigations / renders a moment before the agent's next call.
  await sleep(150)
  const deadline = Date.now() + 5000
  while (wc.isLoadingMainFrame() && Date.now() < deadline) await sleep(100)
}

export async function snapshot(wc: WebContents): Promise<BrowserToolResult> {
  const snap = await isolated<{ title: string; url: string; refs: number; outline: string }>(wc, SNAPSHOT_SCRIPT)
  return text(`Page: ${snap.title}\nURL: ${snap.url}\nInteractive elements: ${snap.refs}\n\n${snap.outline || '(no visible content)'}`)
}

export async function click(wc: WebContents, args: Args): Promise<BrowserToolResult> {
  await ensureCdp(wc)
  const { x, y } = await locate(wc, String(args.ref))
  await mouseClick(wc, x, y, args.double ? 2 : 1)
  await settle(wc)
  return text(`Clicked ${args.ref}. Now at ${wc.getURL()}`)
}

export async function fill(wc: WebContents, args: Args): Promise<BrowserToolResult> {
  await ensureCdp(wc)
  await focusForKeys(wc)
  const res = await isolated<{ error?: string }>(wc, focusForFillScript(String(args.ref)))
  if (res?.error) throw new Error(res.error)
  // Clear via a real Delete so frameworks see the change, then type.
  await pressKey(wc, 'Delete')
  await insertText(wc, String(args.text))
  if (args.submit) { await pressKey(wc, 'Enter'); await settle(wc) }
  return text(`Filled ${args.ref}${args.submit ? ' and pressed Enter' : ''}.`)
}

export async function typeText(wc: WebContents, args: Args): Promise<BrowserToolResult> {
  await focusForKeys(wc)
  await insertText(wc, String(args.text))
  return text('Typed text into the focused element.')
}

export async function press(wc: WebContents, args: Args): Promise<BrowserToolResult> {
  await focusForKeys(wc)
  await pressKey(wc, String(args.key))
  await settle(wc)
  return text(`Pressed ${args.key}.`)
}

export async function hover(wc: WebContents, args: Args): Promise<BrowserToolResult> {
  await ensureCdp(wc)
  const { x, y } = await locate(wc, String(args.ref))
  await mouseMove(wc, x, y)
  return text(`Hovering ${args.ref}.`)
}

export async function selectOption(wc: WebContents, args: Args): Promise<BrowserToolResult> {
  const res = await isolated<{ error?: string; selected?: string }>(wc, selectOptionScript(String(args.ref), String(args.value)))
  if (res?.error) throw new Error(res.error)
  return text(`Selected "${res.selected}" in ${args.ref}.`)
}

export async function scroll(wc: WebContents, args: Args): Promise<BrowserToolResult> {
  await ensureCdp(wc)
  if (args.ref) {
    await locate(wc, String(args.ref))
    return text(`Scrolled ${args.ref} into view.`)
  }
  const metrics = await cdpSend<{ cssLayoutViewport: { clientWidth: number; clientHeight: number } }>(wc, 'Page.getLayoutMetrics')
  const { clientWidth, clientHeight } = metrics.cssLayoutViewport
  const amount = typeof args.amount === 'number' ? args.amount : Math.round(clientHeight * 0.85)
  await mouseWheel(wc, clientWidth / 2, clientHeight / 2, args.direction === 'up' ? -amount : amount)
  await sleep(200)
  return text(`Scrolled ${args.direction === 'up' ? 'up' : 'down'} ${amount}px.`)
}

export async function screenshot(wc: WebContents, args: Args): Promise<BrowserToolResult> {
  if (args.full_page) {
    return { text: `Full-page screenshot of ${wc.getURL()}`, imageBase64: await captureGuestPng(wc, undefined, true) }
  }
  if (args.ref) {
    const rect = await isolated<{ x: number; y: number; width: number; height: number } | null>(wc, elementRectScript(String(args.ref)))
    if (!rect || rect.width === 0 || rect.height === 0) throw new Error(`Unknown or invisible ref ${args.ref}`)
    await sleep(100)
    return { text: `Screenshot of ${args.ref}`, imageBase64: await captureGuestPng(wc, rect) }
  }
  return { text: `Screenshot of ${wc.getURL()}`, imageBase64: await captureGuestPng(wc) }
}

export async function evaluate(wc: WebContents, args: Args): Promise<BrowserToolResult> {
  const value = await wc.executeJavaScript(String(args.expression), true)
  let out: string
  try { out = JSON.stringify(value, null, 2) ?? 'undefined' } catch { out = String(value) }
  if (out.length > MAX_EVAL_CHARS) out = out.slice(0, MAX_EVAL_CHARS) + '\n… (truncated)'
  return text(out)
}

export async function waitFor(wc: WebContents, args: Args): Promise<BrowserToolResult> {
  const timeout = Math.min(60_000, Math.max(100, Number(args.timeout_ms ?? 10_000)))
  const deadline = Date.now() + timeout
  const textArg = args.text ? String(args.text) : null
  const selector = args.selector ? String(args.selector) : null
  while (Date.now() < deadline) {
    const loaded = !wc.isLoadingMainFrame()
    if (!textArg && !selector) { if (loaded) return text('Page finished loading.') }
    else if (await isolated<boolean>(wc, waitConditionScript(textArg, selector)).catch(() => false)) {
      return text(`Found ${textArg ? `text "${textArg}"` : `selector ${selector}`}.`)
    }
    await sleep(200)
  }
  throw new Error(`Timed out after ${timeout}ms waiting for ${textArg ? `text "${textArg}"` : selector ?? 'page load'}`)
}

export async function consoleMessages(wc: WebContents, args: Args): Promise<BrowserToolResult> {
  await ensureCdp(wc)
  const min = LEVEL_RANK[String(args.level ?? 'verbose')] ?? 0
  const entries = consoleLog(wc).filter((e) => (LEVEL_RANK[e.level] ?? 1) >= min).slice(-100)
  if (entries.length === 0) return text('No console messages captured yet (capture starts when an agent first touches the tab).')
  return text(entries.map((e) => `[${e.level}] ${e.text}${e.url ? ` (${e.url}:${e.line})` : ''}`).join('\n'))
}

export async function network(wc: WebContents, args: Args): Promise<BrowserToolResult> {
  await ensureCdp(wc)
  const filter = args.filter ? String(args.filter) : ''
  const entries = networkLog(wc)
    .filter((e) => !filter || e.url.includes(filter))
    .filter((e) => !args.failed_only || e.failed || (e.status !== null && e.status >= 400))
    .slice(-100)
  if (entries.length === 0) return text('No matching requests captured (capture starts when an agent first touches the tab).')
  return text(entries.map((e) => `${e.method} ${e.status ?? (e.failed ? 'FAILED' : '…')} ${e.type} ${e.url}${e.failed ? ` (${e.failed})` : ''}`).join('\n'))
}

export async function viewport(wc: WebContents, args: Args): Promise<BrowserToolResult> {
  const width = Number(args.width)
  if (!width) {
    await setViewport(wc, null)
    return text('Viewport emulation cleared.')
  }
  const mobile = Boolean(args.mobile)
  await setViewport(wc, {
    width,
    height: Number(args.height ?? 800),
    mobile,
    deviceScaleFactor: Number(args.device_scale_factor ?? (mobile ? 3 : 1)),
  })
  return text(`Viewport set to ${width}x${Number(args.height ?? 800)}${mobile ? ' (mobile)' : ''}.`)
}
