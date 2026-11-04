/**
 * Agent-facing browser tools. One spec drives every surface: the in-process
 * Claude SDK MCP server (zod), the stdio MCP bridge for terminal agents (JSON
 * Schema) and the `braid-browser` CLI. Execution lives in main.
 */

export type BrowserToolParamType = 'string' | 'number' | 'boolean'

export interface BrowserToolParam {
  type: BrowserToolParamType
  description: string
  optional?: boolean
  enum?: readonly string[]
}

export interface BrowserToolSpec {
  name: string
  description: string
  params: Record<string, BrowserToolParam>
}

const tabId: BrowserToolParam = { type: 'string', optional: true, description: 'Browser tab id from browser_tabs. Defaults to the tab the agent last used, else the active browser tab of this worktree.' }
const ref: BrowserToolParam = { type: 'string', description: 'Element ref from the latest browser_snapshot, e.g. "e12".' }

export const BROWSER_TOOLS: readonly BrowserToolSpec[] = [
  {
    name: 'browser_tabs',
    description: 'List the browser tabs of this worktree in Braid (the same tabs the user sees). Shows id, url, title and which tab is targeted.',
    params: {},
  },
  {
    name: 'browser_open',
    description: 'Open a URL in the Braid browser for this worktree. Reuses the targeted tab unless new_tab is true or no tab exists. Use for local dev servers (e.g. localhost:3000) and docs.',
    params: {
      url: { type: 'string', description: 'URL or host:port, e.g. "http://localhost:5173" or "localhost:3000".' },
      new_tab: { type: 'boolean', optional: true, description: 'Open in a new tab (default false).' },
      show: { type: 'boolean', optional: true, description: 'Switch Braid\'s center view to the tab (default false, so the user is not interrupted).' },
    },
  },
  {
    name: 'browser_select_tab',
    description: 'Make a tab the target of later browser_* calls. Optionally show it to the user.',
    params: { tab_id: { type: 'string', description: 'Tab id from browser_tabs.' }, show: { type: 'boolean', optional: true, description: 'Also show the tab in Braid (default false).' } },
  },
  { name: 'browser_close_tab', description: 'Close a browser tab.', params: { tab_id: { type: 'string', description: 'Tab id from browser_tabs.' } } },
  { name: 'browser_back', description: 'Go back in the tab history.', params: { tab_id: tabId } },
  { name: 'browser_forward', description: 'Go forward in the tab history.', params: { tab_id: tabId } },
  {
    name: 'browser_reload',
    description: 'Reload the page.',
    params: { hard: { type: 'boolean', optional: true, description: 'Bypass the cache (default false).' }, tab_id: tabId },
  },
  {
    name: 'browser_snapshot',
    description: 'Text outline of the visible page: headings, landmarks, text and every interactive element with a ref like [e12]. Call before clicking or filling; refs change after navigation.',
    params: { tab_id: tabId },
  },
  {
    name: 'browser_click',
    description: 'Click an element by ref (real mouse events).',
    params: { ref, double: { type: 'boolean', optional: true, description: 'Double-click.' }, tab_id: tabId },
  },
  {
    name: 'browser_fill',
    description: 'Replace the contents of an input, textarea or contenteditable element with text.',
    params: { ref, text: { type: 'string', description: 'Text to enter.' }, submit: { type: 'boolean', optional: true, description: 'Press Enter afterwards.' }, tab_id: tabId },
  },
  {
    name: 'browser_type',
    description: 'Type text into the focused element without clearing it.',
    params: { text: { type: 'string', description: 'Text to type.' }, tab_id: tabId },
  },
  {
    name: 'browser_press',
    description: 'Press a key or chord, e.g. "Enter", "Escape", "Tab", "ArrowDown", "Meta+A".',
    params: { key: { type: 'string', description: 'Key name, optionally with modifiers joined by "+" (Shift, Control, Alt, Meta).' }, tab_id: tabId },
  },
  { name: 'browser_hover', description: 'Move the mouse over an element.', params: { ref, tab_id: tabId } },
  {
    name: 'browser_select_option',
    description: 'Choose an option in a <select> by value or visible label.',
    params: { ref, value: { type: 'string', description: 'Option value or label.' }, tab_id: tabId },
  },
  {
    name: 'browser_scroll',
    description: 'Scroll the page (or bring an element into view when ref is given).',
    params: {
      direction: { type: 'string', optional: true, enum: ['down', 'up'], description: 'Direction (default down).' },
      amount: { type: 'number', optional: true, description: 'Pixels (default: one viewport).' },
      ref: { ...ref, optional: true },
      tab_id: tabId,
    },
  },
  {
    name: 'browser_screenshot',
    description: 'PNG screenshot of the visible page, a single element (ref) or the full page. The tab must be shown in Braid (open or select it with show: true).',
    params: { ref: { ...ref, optional: true }, full_page: { type: 'boolean', optional: true, description: 'Capture beyond the viewport.' }, tab_id: tabId },
  },
  {
    name: 'browser_evaluate',
    description: 'Evaluate a JavaScript expression in the page and return the JSON result. Await promises with an async IIFE.',
    params: { expression: { type: 'string', description: 'JavaScript expression.' }, tab_id: tabId },
  },
  {
    name: 'browser_wait_for',
    description: 'Wait until text appears, a CSS selector matches, or the page finishes loading.',
    params: {
      text: { type: 'string', optional: true, description: 'Text to wait for.' },
      selector: { type: 'string', optional: true, description: 'CSS selector to wait for.' },
      timeout_ms: { type: 'number', optional: true, description: 'Max wait (default 10000, max 60000).' },
      tab_id: tabId,
    },
  },
  {
    name: 'browser_console',
    description: 'Recent console messages from the page (captured since the agent first touched the tab).',
    params: { level: { type: 'string', optional: true, enum: ['error', 'warning', 'info', 'verbose'], description: 'Minimum level.' }, tab_id: tabId },
  },
  {
    name: 'browser_network',
    description: 'Recent network requests with status codes (captured since the agent first touched the tab).',
    params: { filter: { type: 'string', optional: true, description: 'Only URLs containing this text.' }, failed_only: { type: 'boolean', optional: true, description: 'Only failed or 4xx/5xx requests.' }, tab_id: tabId },
  },
  {
    name: 'browser_set_viewport',
    description: 'Emulate a viewport size (responsive testing). Pass width 0 to reset.',
    params: {
      width: { type: 'number', description: 'CSS pixels; 0 resets.' },
      height: { type: 'number', optional: true, description: 'CSS pixels (default 800).' },
      mobile: { type: 'boolean', optional: true, description: 'Mobile emulation (touch, meta viewport).' },
      device_scale_factor: { type: 'number', optional: true, description: '1-4 (default 1, mobile 3).' },
      tab_id: tabId,
    },
  },
]

export interface BrowserToolResult {
  text: string
  /** PNG, base64 without data: prefix. */
  imageBase64?: string
  isError?: boolean
}

/** JSON Schema for MCP tools/list. */
export function browserToolJsonSchema(spec: BrowserToolSpec): Record<string, unknown> {
  const properties: Record<string, unknown> = {}
  const required: string[] = []
  for (const [key, p] of Object.entries(spec.params)) {
    properties[key] = { type: p.type, description: p.description, ...(p.enum ? { enum: [...p.enum] } : {}) }
    if (!p.optional) required.push(key)
  }
  return { type: 'object', properties, required, additionalProperties: false }
}

/** Validate and coerce raw args (from HTTP/CLI) against a spec. Throws on bad input. */
export function parseBrowserToolArgs(spec: BrowserToolSpec, raw: unknown): Record<string, string | number | boolean> {
  const input = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const out: Record<string, string | number | boolean> = {}
  for (const [key, p] of Object.entries(spec.params)) {
    const v = input[key]
    if (v === undefined || v === null || v === '') {
      if (!p.optional) throw new Error(`Missing required argument "${key}"`)
      continue
    }
    if (p.type === 'number') {
      const n = typeof v === 'number' ? v : Number(v)
      if (!Number.isFinite(n)) throw new Error(`Argument "${key}" must be a number`)
      out[key] = n
    } else if (p.type === 'boolean') {
      out[key] = v === true || v === 'true' || v === '1'
    } else {
      out[key] = String(v)
    }
    if (p.enum && !p.enum.includes(String(out[key]))) throw new Error(`Argument "${key}" must be one of: ${p.enum.join(', ')}`)
  }
  return out
}
