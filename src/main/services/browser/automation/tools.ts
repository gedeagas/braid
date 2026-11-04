// Agent browser tool dispatcher shared by the SDK MCP server (via the agent
// worker's data channel) and the local HTTP endpoint for terminal agents.
import { isBrowsableUrl } from '../../../../shared/browser'
import { resolveOmniboxInput } from '../../../../shared/browserOmnibox'
import { BROWSER_TOOLS, parseBrowserToolArgs, type BrowserToolResult } from '../../../../shared/browserTools'
import { getWorktree, resolveWorktreeByPath } from '../registry'
import { requestRenderer } from '../rendererRequests'
import { getBrowserSettings } from '../settings'
import { getAgentTarget, openNewTab, pickTabId, resolveTab, setAgentTarget, hasGuest } from './target'
import * as page from './pageTools'

export interface BrowserToolContext {
  /** Preferred: the worktree id (in-process chat sessions know it). */
  worktreeId?: string
  /** Otherwise the agent's working directory, matched against worktree roots. */
  cwd?: string
}

type Args = Record<string, string | number | boolean>

function resolveUrl(raw: string): string {
  const url = resolveOmniboxInput(raw, getBrowserSettings().searchEngine)
  if (!url || !isBrowsableUrl(url)) throw new Error(`Not a loadable URL: ${raw}`)
  return url
}

function worktreeIdFor(ctx: BrowserToolContext): string {
  if (ctx.worktreeId && getWorktree(ctx.worktreeId)) return ctx.worktreeId
  const byPath = ctx.cwd ? resolveWorktreeByPath(ctx.cwd) : null
  if (byPath) return byPath.worktreeId
  if (ctx.worktreeId) return ctx.worktreeId
  throw new Error(`No Braid worktree contains ${ctx.cwd ?? 'this directory'}. Open the worktree in Braid first.`)
}

async function listTabs(worktreeId: string): Promise<BrowserToolResult> {
  const entry = getWorktree(worktreeId)
  const tabs = entry?.tabs ?? []
  if (tabs.length === 0) return { text: 'No browser tabs in this worktree. Use browser_open to open one.' }
  const target = getAgentTarget(worktreeId) ?? pickTabId(worktreeId)
  const lines = tabs.map((t) => {
    const flags = [t.id === target ? 'target' : '', t.id === entry?.activeTabId ? 'shown-to-user' : '', hasGuest(t.id) ? '' : 'sleeping'].filter(Boolean)
    return `${t.id}  ${t.title || '(untitled)'}  ${t.url || '(empty)'}${flags.length ? `  [${flags.join(', ')}]` : ''}`
  })
  return { text: lines.join('\n') }
}

async function open(worktreeId: string, args: Args): Promise<BrowserToolResult> {
  const url = resolveUrl(String(args.url))
  const show = Boolean(args.show)
  const existing = pickTabId(worktreeId)
  const existingTab = existing ? getWorktree(worktreeId)?.tabs.find((t) => t.id === existing) : undefined
  if (args.new_tab || !existingTab) {
    const tab = await openNewTab(worktreeId, url, show)
    await page.waitFor(tab.wc, { timeout_ms: 15_000 }).catch(() => {})
    return { text: `Opened ${tab.wc.getURL()} in new tab ${tab.tabId}. Call browser_snapshot to inspect it.` }
  }
  if (!existingTab.url) {
    await requestRenderer({ type: 'navigateTab', worktreeId, tabId: existingTab.id, url })
  }
  const tab = await resolveTab(worktreeId, existingTab.id)
  if (existingTab.url) await tab.wc.loadURL(url).catch(() => { /* reported by the wait below */ })
  if (show) await requestRenderer({ type: 'activateTab', worktreeId, tabId: tab.tabId })
  await page.waitFor(tab.wc, { timeout_ms: 15_000 }).catch(() => {})
  return { text: `Tab ${tab.tabId} now at ${tab.wc.getURL()}. Call browser_snapshot to inspect it.` }
}

const PAGE_TOOLS: Record<string, (wc: import('electron').WebContents, args: Args) => Promise<BrowserToolResult>> = {
  browser_snapshot: (wc) => page.snapshot(wc),
  browser_click: page.click,
  browser_fill: page.fill,
  browser_type: page.typeText,
  browser_press: page.press,
  browser_hover: page.hover,
  browser_select_option: page.selectOption,
  browser_scroll: page.scroll,
  browser_screenshot: page.screenshot,
  browser_evaluate: page.evaluate,
  browser_wait_for: page.waitFor,
  browser_console: page.consoleMessages,
  browser_network: page.network,
  browser_set_viewport: page.viewport,
  browser_back: async (wc) => { if (wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack(); await page.waitFor(wc, {}); return { text: `Now at ${wc.getURL()}` } },
  browser_forward: async (wc) => { if (wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward(); await page.waitFor(wc, {}); return { text: `Now at ${wc.getURL()}` } },
  browser_reload: async (wc, args) => { if (args.hard) wc.reloadIgnoringCache(); else wc.reload(); await page.waitFor(wc, {}); return { text: `Reloaded ${wc.getURL()}` } },
}

export async function runBrowserTool(name: string, rawArgs: unknown, ctx: BrowserToolContext): Promise<BrowserToolResult> {
  const spec = BROWSER_TOOLS.find((t) => t.name === name)
  if (!spec) return { text: `Unknown browser tool ${name}`, isError: true }
  try {
    const args = parseBrowserToolArgs(spec, rawArgs)
    const worktreeId = worktreeIdFor(ctx)
    switch (name) {
      case 'browser_tabs': return await listTabs(worktreeId)
      case 'browser_open': return await open(worktreeId, args)
      case 'browser_select_tab': {
        const tab = await resolveTab(worktreeId, String(args.tab_id))
        setAgentTarget(worktreeId, tab.tabId)
        if (args.show) await requestRenderer({ type: 'activateTab', worktreeId, tabId: tab.tabId })
        return { text: `Targeting tab ${tab.tabId} (${tab.wc.getURL()}).` }
      }
      case 'browser_close_tab': {
        await requestRenderer({ type: 'closeTab', worktreeId, tabId: String(args.tab_id) })
        return { text: `Closed tab ${args.tab_id}.` }
      }
    }
    const handler = PAGE_TOOLS[name]
    if (!handler) return { text: `Unhandled browser tool ${name}`, isError: true }
    const tab = await resolveTab(worktreeId, args.tab_id ? String(args.tab_id) : undefined)
    return await handler(tab.wc, args)
  } catch (err) {
    return { text: err instanceof Error ? err.message : String(err), isError: true }
  }
}
