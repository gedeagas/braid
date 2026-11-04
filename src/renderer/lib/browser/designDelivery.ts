/**
 * Design Mode delivery: hand a picked element to the worktree's active agent.
 * - Chat session: element markdown as a snippet chip + screenshot attachment.
 * - Big terminal: element.md / element.png written to a temp folder, paths
 *   bracket-pasted into the PTY (not submitted - the user types the ask).
 * Then the agent is shown next to the browser (other pane) and focused.
 */
import type { DesignModeCapture } from '@shared/browser'
import { designCaptureSummary, formatDesignCapture } from '@shared/designMode'
import { useUIStore, type CenterView } from '@/store/ui'
import { useSessionsStore } from '@/store/sessions'
import { useProjectsStore } from '@/store/projects'
import * as ipc from '@/lib/ipc'
import { centerViewToTabKey } from '@/lib/tabNavigation'
import { paneOfKey, placeTabInPane } from '@/lib/centerPanes'
import { queueChatImages } from '@/lib/chatImageQueue'
import { getBigTerminalPtyId } from '@/components/Center/bigTerminalCache'

/** Most recently shown agent tab (s: chat or t: terminal) per worktree. */
const lastAgentKey = new Map<string, string>()

function recordView(worktreeId: string, view: CenterView | null | undefined): void {
  if (view?.type === 'session' || view?.type === 'terminal') {
    const key = centerViewToTabKey(view)
    if (key) lastAgentKey.set(worktreeId, key)
  }
}

export function startAgentTabTracking(): () => void {
  return useUIStore.subscribe((s, prev) => {
    if (s.activeCenterViewByWorktree !== prev.activeCenterViewByWorktree) {
      for (const [wt, view] of Object.entries(s.activeCenterViewByWorktree)) {
        if (view !== prev.activeCenterViewByWorktree[wt]) recordView(wt, view)
      }
    }
    if (s.centerSplitByWorktree !== prev.centerSplitByWorktree) {
      for (const [wt, split] of Object.entries(s.centerSplitByWorktree)) {
        if (split.secondaryView !== prev.centerSplitByWorktree[wt]?.secondaryView) recordView(wt, split.secondaryView)
      }
    }
  })
}

function keyExists(worktreeId: string, key: string): boolean {
  const ui = useUIStore.getState()
  if (key.startsWith('t:')) return Boolean(ui.bigTerminalsByWorktree[worktreeId]?.some((t) => t.id === key.slice(2)))
  if (key.startsWith('s:')) return useSessionsStore.getState().sessions[key.slice(2)]?.worktreeId === worktreeId
  return false
}

/** The agent to deliver to: last used agent tab, else any agent terminal, else a session, else a new chat. */
function resolveAgentKey(worktreeId: string): string | null {
  const last = lastAgentKey.get(worktreeId)
  if (last && keyExists(worktreeId, last)) return last
  const ui = useUIStore.getState()
  const agentTerminal = ui.bigTerminalsByWorktree[worktreeId]?.find((t) => t.agentId)
  if (agentTerminal) return `t:${agentTerminal.id}`
  const session = Object.values(useSessionsStore.getState().sessions).find((s) => s.worktreeId === worktreeId)
  if (session) return `s:${session.id}`
  const path = useProjectsStore.getState().projects.flatMap((p) => p.worktrees).find((w) => w.id === worktreeId)?.path
  if (!path) return null
  return `s:${useSessionsStore.getState().createSession(worktreeId, path)}`
}

/** Show the agent without hiding the browser tab: they end up in different panes. */
function showAgentBesideBrowser(worktreeId: string, agentKey: string, browserKey: string): void {
  const agentPane = paneOfKey(worktreeId, agentKey)
  const browserPane = paneOfKey(worktreeId, browserKey)
  if (agentPane !== browserPane) {
    placeTabInPane(worktreeId, agentKey, agentPane)
    return
  }
  if (agentKey.startsWith('t:')) {
    placeTabInPane(worktreeId, agentKey, agentPane === 'primary' ? 'secondary' : 'primary')
    return
  }
  // Chat sessions only live in the primary pane: move the browser aside instead.
  placeTabInPane(worktreeId, browserKey, 'secondary')
  placeTabInPane(worktreeId, agentKey, 'primary')
}

function bracketedPaste(text: string): string {
  // Strip ESC so pasted content can't terminate bracketed-paste mode early.
  return `\x1b[200~${text.replace(/\x1b/g, '')}\x1b[201~`
}

export async function deliverDesignCapture(worktreeId: string, browserTabId: string, capture: DesignModeCapture): Promise<void> {
  const agentKey = resolveAgentKey(worktreeId)
  if (!agentKey) return
  if (useUIStore.getState().selectedWorktreeId === worktreeId) showAgentBesideBrowser(worktreeId, agentKey, `b:${browserTabId}`)

  if (agentKey.startsWith('s:')) {
    const sessionId = agentKey.slice(2)
    const content = formatDesignCapture(capture)
    const firstLine = designCaptureSummary(capture)
    useSessionsStore.getState().addDraftSnippet(sessionId, {
      id: `snippet-design-${Date.now()}`,
      content,
      firstLine: firstLine.length > 80 ? `${firstLine.slice(0, 79)}…` : firstLine,
      lineCount: content.split('\n').length,
      charCount: content.length,
    })
    if (capture.screenshotBase64) queueChatImages(sessionId, [`data:image/png;base64,${capture.screenshotBase64}`])
    useSessionsStore.getState().setActiveSession(sessionId)
    window.dispatchEvent(new CustomEvent('braid:focusChat'))
    return
  }

  const terminalId = agentKey.slice(2)
  const { mdPath, pngPath } = await ipc.browser.designSave(capture)
  const ptyId = getBigTerminalPtyId(terminalId)
  if (!ptyId) return
  const text = `Design Mode pick: ${designCaptureSummary(capture)} on ${capture.url}. Details: ${mdPath}${pngPath ? ` Screenshot: ${pngPath}` : ''} `
  void ipc.pty.write(ptyId, bracketedPaste(text))
}
