/**
 * Per-worktree browser tabs: types and constants shared by main, preload and renderer.
 */

/** Every browser profile gets its own persistent partition (cookies, storage, cache). */
export const BROWSER_PARTITION_PREFIX = 'persist:browser-'
export const DEFAULT_BROWSER_PROFILE_ID = 'default'

export function browserPartitionFor(profileId: string): string {
  return `${BROWSER_PARTITION_PREFIX}${profileId}`
}

export function isBrowserPartition(partition: string): boolean {
  return /^persist:browser-[A-Za-z0-9._-]+$/.test(partition)
}

/** Schemes a browser tab is allowed to load. */
export function isBrowsableUrl(url: string): boolean {
  if (url === 'about:blank') return true
  try {
    const protocol = new URL(url).protocol
    return protocol === 'http:' || protocol === 'https:' || protocol === 'file:'
  } catch {
    return false
  }
}

/**
 * Shortcuts the main process intercepts while a browser guest has keyboard focus
 * (the host renderer never sees those keydowns) and forwards to the renderer.
 */
export type BrowserShortcutAction =
  | 'find'
  | 'reload'
  | 'hardReload'
  | 'back'
  | 'forward'
  | 'devtools'
  | 'focusAddress'
  | 'newTab'
  | 'reopenClosedTab'
  | 'closeTab'

export interface BrowserShortcutEvent {
  /** webContents id of the guest that had focus. */
  webContentsId: number
  action: BrowserShortcutAction
}

/** A page asked to open a URL in a new tab (target=_blank, window.open, context menu). */
export interface BrowserOpenTabEvent {
  /** webContents id of the opener guest. */
  webContentsId: number
  url: string
  /** true when the new tab should open in the background (e.g. Cmd+click). */
  background: boolean
}

// ─── Settings (persisted by main in userData/browser-settings.json) ──────────

export type BrowserLinkRouting = 'braid' | 'system'
export type BrowserIdentity = 'cleaned' | 'native'
export type BrowserSearchEngine = 'google' | 'duckduckgo' | 'bing'

export interface BrowserProfile {
  id: string
  name: string
}

export interface BrowserSettings {
  /** Where http(s) links from terminals, markdown and the editor open. */
  linkRouting: BrowserLinkRouting
  /** Shift+platform-modifier click inverts linkRouting for one click. */
  invertWithShiftModifier: boolean
  searchEngine: BrowserSearchEngine
  /** Empty = the OS Downloads folder. */
  downloadsDir: string
  /** App-wide user agent; applied on next launch. */
  identity: BrowserIdentity
  profiles: BrowserProfile[]
  /** braid-browser CLI on Braid terminals' PATH + the braid-browser skill in agent skill folders. */
  exposeToTerminalAgents: boolean
  /** Opt-in: also register the braid-browser MCP server in agent configs (Claude Code, Codex, Gemini, Cursor, Copilot). */
  registerAgentMcp: boolean
}

export const DEFAULT_BROWSER_SETTINGS: BrowserSettings = {
  linkRouting: 'braid',
  invertWithShiftModifier: true,
  searchEngine: 'google',
  downloadsDir: '',
  identity: 'cleaned',
  profiles: [{ id: DEFAULT_BROWSER_PROFILE_ID, name: 'Default' }],
  exposeToTerminalAgents: true,
  registerAgentMcp: false,
}

export type BrowserSkillOutcome = 'installed' | 'updated' | 'unchanged' | 'removed' | 'edited' | 'foreign' | 'failed'

export interface BrowserAgentBridgeStatus {
  skills: Array<{ agent: string; agents: string[]; path: string; outcome: BrowserSkillOutcome; error?: string }>
  mcpAgents: string[]
  cliPath: string | null
}

// ─── Renderer <-> main registry ──────────────────────────────────────────────

/** A mounted browser tab whose guest webContents main can drive. */
export interface BrowserGuestInfo {
  tabId: string
  worktreeId: string
  webContentsId: number
  profileId: string
}

/** Tab list snapshot for one worktree, pushed by the renderer on every change. */
export interface BrowserTabSummary {
  id: string
  url: string
  title: string
  profileId: string
}

export interface BrowserWorktreeSync {
  worktreeId: string
  worktreePath: string
  tabs: BrowserTabSummary[]
  /** Active browser tab of the worktree (most recently shown), if any. */
  activeTabId: string | null
}

/** Requests main sends to the renderer (agent automation needs tab lifecycle). */
export type BrowserRendererRequest =
  | { type: 'openTab'; worktreeId: string; url?: string; activate: boolean }
  | { type: 'activateTab'; worktreeId: string; tabId: string }
  | { type: 'closeTab'; worktreeId: string; tabId: string }
  /** Mount the tab's page (it may be hibernated) without changing the user's view. */
  | { type: 'wakeTab'; worktreeId: string; tabId: string }
  /** Give the tab's <webview> keyboard focus (CDP key events follow host focus). */
  | { type: 'focusTab'; worktreeId: string; tabId: string }
  /** Navigate a tab that has no page yet (fresh empty tab). */
  | { type: 'navigateTab'; worktreeId: string; tabId: string; url: string }

export interface BrowserRendererRequestEnvelope {
  id: number
  request: BrowserRendererRequest
}

// ─── Downloads ───────────────────────────────────────────────────────────────

export type BrowserDownloadState = 'progressing' | 'completed' | 'cancelled' | 'interrupted'

export interface BrowserDownload {
  id: string
  /** Opener guest, used to show the shelf in the right tab. */
  webContentsId: number
  filename: string
  savePath: string
  url: string
  receivedBytes: number
  totalBytes: number
  state: BrowserDownloadState
  startedAt: number
  /** Set once the download reaches a final state. */
  finishedAt?: number
}

// ─── Permissions ─────────────────────────────────────────────────────────────

export interface BrowserPermissionRequest {
  id: number
  webContentsId: number
  origin: string
  permission: string
}

// ─── Viewport emulation ──────────────────────────────────────────────────────

export interface BrowserViewport {
  width: number
  height: number
  deviceScaleFactor: number
  mobile: boolean
}

// ─── Design Mode ─────────────────────────────────────────────────────────────

export interface DesignModeSource {
  file: string
  line?: number
  column?: number
  framework: string
}

export interface DesignModeCapture {
  url: string
  selector: string
  tagName: string
  outerHTML: string
  /** Parent element with children truncated, for layout context. */
  neighborhood: string
  styles: Record<string, string>
  rect: { x: number; y: number; width: number; height: number }
  /** PNG of the element, base64 (no data: prefix). */
  screenshotBase64: string | null
  source: DesignModeSource | null
}

export interface BrowserCookieImportResult {
  imported: number
  skippedGoogle: number
  failed: number
  domains: number
}
