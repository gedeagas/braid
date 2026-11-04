// Resolve which browser tab an agent call acts on, waking or creating it.
import { BrowserWindow, type WebContents } from 'electron'
import { getGuest, getGuestWebContents, getWorktree, waitForGuest } from '../registry'
import { requestRenderer } from '../rendererRequests'

const GUEST_TIMEOUT_MS = 15_000

/** Tab each worktree's agents last used (sticky across calls). */
const agentTargetByWorktree = new Map<string, string>()

export interface ResolvedTab {
  worktreeId: string
  tabId: string
  wc: WebContents
}

export function setAgentTarget(worktreeId: string, tabId: string): void {
  agentTargetByWorktree.set(worktreeId, tabId)
}

export function getAgentTarget(worktreeId: string): string | null {
  const id = agentTargetByWorktree.get(worktreeId)
  const tabs = getWorktree(worktreeId)?.tabs ?? []
  return id && tabs.some((t) => t.id === id) ? id : null
}

/** Explicit id > agent's last tab > the worktree's active browser tab > first tab. */
export function pickTabId(worktreeId: string, explicit?: string): string | null {
  const entry = getWorktree(worktreeId)
  const tabs = entry?.tabs ?? []
  if (explicit) return tabs.some((t) => t.id === explicit) ? explicit : null
  const sticky = getAgentTarget(worktreeId)
  if (sticky) return sticky
  if (entry?.activeTabId && tabs.some((t) => t.id === entry.activeTabId)) return entry.activeTabId
  return tabs[0]?.id ?? null
}

function notifyActivity(tabId: string): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('browser:automationActivity', tabId)
  }
}

/** Live guest for a tab, waking it if it is hibernated. */
export async function liveTab(worktreeId: string, tabId: string): Promise<ResolvedTab> {
  let wc = getGuestWebContents(tabId)
  if (!wc) {
    const tab = getWorktree(worktreeId)?.tabs.find((t) => t.id === tabId)
    if (!tab) throw new Error(`No browser tab ${tabId} in this worktree`)
    if (!tab.url) throw new Error(`Tab ${tabId} is empty - call browser_open with a URL first`)
    await requestRenderer({ type: 'wakeTab', worktreeId, tabId })
    await waitForGuest(tabId, GUEST_TIMEOUT_MS)
    wc = getGuestWebContents(tabId)
    if (!wc) throw new Error(`Browser tab ${tabId} is not available`)
  }
  setAgentTarget(worktreeId, tabId)
  notifyActivity(tabId)
  return { worktreeId, tabId, wc }
}

export async function resolveTab(worktreeId: string, explicit?: string): Promise<ResolvedTab> {
  const tabId = pickTabId(worktreeId, explicit)
  if (!tabId) {
    throw new Error(explicit
      ? `No browser tab ${explicit} in this worktree - see browser_tabs`
      : 'This worktree has no browser tab yet - call browser_open with a URL')
  }
  return liveTab(worktreeId, tabId)
}

/** Open a new tab with a URL and wait until its page is attached. */
export async function openNewTab(worktreeId: string, url: string, show: boolean): Promise<ResolvedTab> {
  const { tabId } = await requestRenderer<{ tabId: string }>({ type: 'openTab', worktreeId, url, activate: show })
  await waitForGuest(tabId, GUEST_TIMEOUT_MS)
  return liveTab(worktreeId, tabId)
}

export function hasGuest(tabId: string): boolean {
  return getGuest(tabId) !== null
}
