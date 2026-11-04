/**
 * Where an http(s) link from a terminal, markdown, chat or the editor opens:
 * Braid's per-worktree browser or the system browser (Settings -> Browser).
 */
import type { BrowserLinkRouting } from '@shared/browser'
import { DEFAULT_BROWSER_PROFILE_ID } from '@shared/browser'
import { useUIStore, centerViewToTabKey } from '@/store/ui'
import { useBrowserStore } from '@/store/browser'
import * as ipc from '@/lib/ipc'
import { openBrowserTab } from './browserCommands'
import { getPaneLayout, otherPaneOf, placeTabInPane } from '@/lib/centerPanes'

export interface LinkModifier {
  shift: boolean
  /** Cmd on macOS, Ctrl elsewhere. */
  platformMod: boolean
}

export interface LinkPlanInput {
  url: string
  routing: BrowserLinkRouting
  invertWithShiftModifier: boolean
  modifier: LinkModifier
  worktreeId: string | null
  tabs: Array<{ id: string; url: string; profileId: string }>
  /** Browser tabs currently on screen (one per visible pane). */
  visibleBrowserTabIds: string[]
  /** Visible browser tab in the focused pane, if any. */
  focusedBrowserTabId: string | null
  recentTabIds: string[]
  /** Tab the link was clicked in (new tabs open beside it). */
  sourceKey: string | null
}

export type LinkPlan =
  | { kind: 'system' }
  | { kind: 'reuse'; tabId: string }
  | { kind: 'newAfter'; tabId: string }
  | { kind: 'newBeside'; sourceKey: string | null }

function isHttp(url: string): boolean {
  return /^https?:\/\//i.test(url)
}

export function planLinkOpen(input: LinkPlanInput): LinkPlan {
  if (!isHttp(input.url)) return { kind: 'system' }
  const inverted = input.invertWithShiftModifier && input.modifier.shift && input.modifier.platformMod
  const routing = inverted ? (input.routing === 'braid' ? 'system' : 'braid') : input.routing
  if (routing === 'system' || !input.worktreeId) return { kind: 'system' }

  const profileId = input.tabs.find((t) => t.id === input.focusedBrowserTabId)?.profileId ?? DEFAULT_BROWSER_PROFILE_ID
  const exact = input.tabs.find((t) => t.url === input.url && t.profileId === profileId)
  if (exact) return { kind: 'reuse', tabId: exact.id }

  if (input.focusedBrowserTabId) return { kind: 'newAfter', tabId: input.focusedBrowserTabId }
  if (input.visibleBrowserTabIds.length > 0) {
    const mru = input.recentTabIds.find((id) => input.visibleBrowserTabIds.includes(id)) ?? input.visibleBrowserTabIds[0]
    return { kind: 'newAfter', tabId: mru }
  }
  return { kind: 'newBeside', sourceKey: input.sourceKey }
}

export function modifierFromEvent(e: { shiftKey?: boolean; metaKey?: boolean; ctrlKey?: boolean } | null | undefined): LinkModifier {
  const isMac = ipc.shell.platform === 'darwin'
  return { shift: Boolean(e?.shiftKey), platformMod: Boolean(isMac ? e?.metaKey : e?.ctrlKey) }
}

/** Open a link according to the user's routing setting. */
export function openLink(url: string, opts: { modifier?: LinkModifier; worktreeId?: string | null } = {}): void {
  const ui = useUIStore.getState()
  const settings = useBrowserStore.getState().settings
  const worktreeId = opts.worktreeId ?? ui.selectedWorktreeId
  const tabs = worktreeId ? ui.browserTabsByWorktree[worktreeId] ?? [] : []
  const layout = worktreeId ? getPaneLayout(worktreeId) : null
  const visibleViews = layout ? layout.panes.map((p) => p.view) : []
  const visibleBrowserTabIds = visibleViews.flatMap((v) => (v?.type === 'browser' ? [v.tabId] : []))
  const focusedView = layout?.panes.find((p) => p.id === layout.focusedPaneId)?.view ?? null
  const plan = planLinkOpen({
    url,
    routing: settings.linkRouting,
    invertWithShiftModifier: settings.invertWithShiftModifier,
    modifier: opts.modifier ?? { shift: false, platformMod: false },
    worktreeId,
    tabs,
    visibleBrowserTabIds,
    focusedBrowserTabId: focusedView?.type === 'browser' ? focusedView.tabId : null,
    recentTabIds: ui.browserRecentTabIds,
    sourceKey: centerViewToTabKey(focusedView),
  })

  if (plan.kind === 'system' || !worktreeId) {
    void ipc.shell.openExternal(url)
    return
  }
  if (plan.kind === 'reuse') {
    placeTabInPane(worktreeId, `b:${plan.tabId}`, layout?.panes.find((p) => p.view?.type === 'browser' && p.view.tabId === plan.tabId)?.id ?? null)
    ui.touchBrowserTab(plan.tabId)
    return
  }
  const profileId = plan.kind === 'newAfter' ? tabs.find((t) => t.id === plan.tabId)?.profileId : undefined
  if (plan.kind === 'newAfter') {
    const pane = layout?.panes.find((p) => p.view?.type === 'browser' && p.view.tabId === plan.tabId)?.id ?? null
    const id = openBrowserTab(worktreeId, { url, profileId, afterKey: `b:${plan.tabId}`, activate: false })
    placeTabInPane(worktreeId, `b:${id}`, pane)
    ui.touchBrowserTab(id)
    return
  }
  // No browser on screen: open beside the source so it stays visible (split when possible).
  const id = openBrowserTab(worktreeId, { url, afterKey: plan.sourceKey ?? undefined, activate: false })
  placeTabInPane(worktreeId, `b:${id}`, layout ? otherPaneOf(worktreeId, layout.focusedPaneId, true) : null)
  ui.touchBrowserTab(id)
}
