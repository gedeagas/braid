// Browser tab persistence (localStorage), one key per worktree.
import { SK } from '@/lib/storageKeys'
import { DEFAULT_BROWSER_PROFILE_ID, type BrowserViewport } from '@shared/browser'

export interface BrowserTab {
  id: string
  /** Last committed URL. Empty string = new tab that hasn't navigated yet. */
  url: string
  title: string
  faviconUrl?: string
  /** Browser profile (storage partition) the tab runs in. */
  profileId: string
  /** Scroll offset captured when the tab was hidden, restored after a reload. */
  scrollY?: number
  /** Emulated viewport (responsive testing); undefined = fill the pane. */
  viewport?: BrowserViewport
}

function parseTab(x: unknown): BrowserTab | null {
  if (typeof x !== 'object' || x === null) return null
  const r = x as Record<string, unknown>
  if (typeof r.id !== 'string' || typeof r.url !== 'string') return null
  const tab: BrowserTab = {
    id: r.id,
    url: r.url,
    title: typeof r.title === 'string' ? r.title : '',
    profileId: typeof r.profileId === 'string' && r.profileId ? r.profileId : DEFAULT_BROWSER_PROFILE_ID,
  }
  if (typeof r.faviconUrl === 'string') tab.faviconUrl = r.faviconUrl
  if (typeof r.scrollY === 'number' && r.scrollY > 0) tab.scrollY = r.scrollY
  const vp = r.viewport as Partial<BrowserViewport> | undefined
  if (vp && typeof vp.width === 'number' && typeof vp.height === 'number') {
    tab.viewport = { width: vp.width, height: vp.height, deviceScaleFactor: Number(vp.deviceScaleFactor) || 1, mobile: Boolean(vp.mobile) }
  }
  return tab
}

export function loadBrowserTabsFor(worktreeId: string): BrowserTab[] {
  try {
    const raw = localStorage.getItem(SK.browserTabsPrefix + worktreeId)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.map(parseTab).filter((t): t is BrowserTab => t !== null)
  } catch {
    return []
  }
}

export function saveBrowserTabsFor(worktreeId: string, tabs: BrowserTab[]): void {
  try {
    if (tabs.length === 0) localStorage.removeItem(SK.browserTabsPrefix + worktreeId)
    else localStorage.setItem(SK.browserTabsPrefix + worktreeId, JSON.stringify(tabs))
  } catch {}
}

/** Hydrate every worktree with persisted tabs (sidebar rows may read any worktree). */
export function loadAllBrowserTabs(): Record<string, BrowserTab[]> {
  const result: Record<string, BrowserTab[]> = {}
  try {
    const prefix = SK.browserTabsPrefix
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (!key?.startsWith(prefix)) continue
      const worktreeId = key.slice(prefix.length)
      if (worktreeId) result[worktreeId] = loadBrowserTabsFor(worktreeId)
    }
  } catch {}
  return result
}

export function removeBrowserTabsFor(worktreeId: string): void {
  try { localStorage.removeItem(SK.browserTabsPrefix + worktreeId) } catch {}
}
