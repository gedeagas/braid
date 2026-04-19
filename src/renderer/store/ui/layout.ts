import { type StateCreator } from 'zustand'
import type { RightPanelTab } from '@/types'
import type { UIState } from './types'
import { SK } from '@/lib/storageKeys'
import { loadStr, loadBool, loadInt } from './helpers'

export type CenterView =
  | { type: 'session'; sessionId: string }
  | { type: 'file'; path: string }
  | { type: 'changes' }

export type ToolMessageStyle = 'funny' | 'boring'
export type ActivityIndicatorStyle = 'spinner' | 'dots' | 'waveform'

/** Git status codes returned by `git status --porcelain`. */
export type GitStatusCode = 'M' | 'A' | 'D' | 'R' | '?'

/** Metadata stored alongside the selected diff file so DiffReviewView can call getFileDiff correctly. */
export interface DiffFileSelection {
  path: string
  status: GitStatusCode
  staged: boolean
}

// ─── Persistence helpers ───────────────────────────────────────────────────────

function loadExpandedProjects(): Set<string> {
  try {
    const raw = localStorage.getItem(SK.expandedProjects)
    if (raw) return new Set(JSON.parse(raw) as string[])
  } catch {}
  return new Set()
}

function saveExpandedProjects(ids: Set<string>): void {
  try { localStorage.setItem(SK.expandedProjects, JSON.stringify([...ids])) } catch {}
}

function loadPinnedWorktrees(): Set<string> {
  try {
    const raw = localStorage.getItem(SK.pinnedWorktrees)
    if (raw) return new Set(JSON.parse(raw) as string[])
  } catch {}
  return new Set()
}

function savePinnedWorktrees(ids: Set<string>): void {
  try { localStorage.setItem(SK.pinnedWorktrees, JSON.stringify([...ids])) } catch {}
}

function loadProjectOrder(): string[] {
  try {
    const raw = localStorage.getItem(SK.projectOrder)
    if (raw) {
      const parsed = JSON.parse(raw) as unknown[]
      return parsed.filter((x): x is string => typeof x === 'string')
    }
  } catch {}
  return []
}

function saveProjectOrder(order: string[]): void {
  try { localStorage.setItem(SK.projectOrder, JSON.stringify(order)) } catch {}
}

function loadWorktreeOrders(): Record<string, string[]> {
  try {
    const raw = localStorage.getItem(SK.worktreeOrders)
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, unknown[]>
      const clean: Record<string, string[]> = {}
      for (const [k, v] of Object.entries(parsed)) {
        if (Array.isArray(v)) {
          clean[k] = v.filter((x): x is string => typeof x === 'string')
        }
      }
      return clean
    }
  } catch {}
  return {}
}

function saveWorktreeOrders(orders: Record<string, string[]>): void {
  try { localStorage.setItem(SK.worktreeOrders, JSON.stringify(orders)) } catch {}
}

// Module-level: remembers whether the sidebar was open before an overlay (MC or web app) took over.
// Set when entering MC or opening a web app; cleared when returning to Explorer.
let sidebarBeforeOverlay: boolean | null = null

/** Save sidebar state before an overlay takes over. No-op if already saved (e.g. MC -> App
 *  preserves the original Explorer sidebar state rather than overwriting with MC's closed state). */
export function saveSidebarForOverlay(open: boolean): void {
  if (sidebarBeforeOverlay === null) sidebarBeforeOverlay = open
}

// ─── Slice ─────────────────────────────────────────────────────────────────────

export interface LayoutSlice {
  selectedProjectId: string | null
  selectedWorktreeId: string | null
  expandedProjects: Set<string>
  pinnedWorktrees: Set<string>
  projectOrder: string[]
  worktreeOrders: Record<string, string[]>
  rightPanelTab: RightPanelTab
  showAddProject: boolean
  toolMessageStyle: ToolMessageStyle
  activityIndicatorStyle: ActivityIndicatorStyle
  openFilePaths: string[]
  changesOpenByWorktree: Record<string, boolean>
  selectedDiffFileByWorktree: Record<string, DiffFileSelection | null>
  tabOrder: string[]
  dirtyFilePaths: Set<string>
  activeCenterViewByWorktree: Record<string, CenterView | null>
  skipDeleteWorktreeConfirm: boolean
  newlyAddedWorktreeId: string | null
  missionControlActive: boolean
  projectAvatarVisible: boolean
  sidebarPanelOpen: boolean
  rightPanelVisible: boolean
  sidebarWidth: number
  rightPanelWidth: number
  changesCounts: Record<string, number>
  diffRevisionByWorktree: Record<string, number>

  selectWorktree: (projectId: string, worktreeId: string) => void
  toggleProject: (projectId: string) => void
  togglePinWorktree: (worktreeId: string) => void
  reorderProjects: (fromIndex: number, toIndex: number) => void
  reorderProjectsById: (currentIds: string[], fromId: string, toId: string) => void
  reorderWorktrees: (projectId: string, fromIndex: number, toIndex: number) => void
  reorderWorktreesById: (projectId: string, currentIds: string[], fromId: string, toId: string) => void
  setRightPanelTab: (tab: RightPanelTab) => void
  setShowAddProject: (show: boolean) => void
  setToolMessageStyle: (style: ToolMessageStyle) => void
  setActivityIndicatorStyle: (style: ActivityIndicatorStyle) => void
  openFile: (path: string) => void
  closeFile: (path: string) => void
  openChanges: (file?: string, status?: GitStatusCode, staged?: boolean) => void
  closeChanges: () => void
  selectDiffFile: (path: string, status?: GitStatusCode, staged?: boolean) => void
  setActiveCenterView: (view: CenterView | null) => void
  setFileDirty: (path: string, dirty: boolean) => void
  reorderFilePaths: (fromIndex: number, toIndex: number) => void
  setTabOrder: (order: string[]) => void
  setSkipDeleteWorktreeConfirm: (skip: boolean) => void
  setNewlyAddedWorktreeId: (id: string | null) => void
  prependWorktreeToOrder: (projectId: string, worktreeId: string) => void
  setProjectAvatarVisible: (visible: boolean) => void
  toggleMissionControl: () => void
  setMissionControlActive: (active: boolean) => void
  toggleSidebar: () => void
  toggleRightPanel: () => void
  setSidebarWidth: (width: number) => void
  persistSidebarWidth: () => void
  setRightPanelWidth: (width: number) => void
  persistRightPanelWidth: () => void
  setChangesCount: (worktreePath: string, count: number) => void
  bumpDiffRevision: (worktreePath: string) => void
  cleanupWorktreeState: (worktreeId: string, worktreePath: string) => void
}

export const createLayoutSlice: StateCreator<UIState, [], [], LayoutSlice> = (set, get) => ({
  selectedProjectId: loadStr(SK.selectedProjectId, '') || null,
  selectedWorktreeId: loadStr(SK.selectedWorktreeId, '') || null,
  expandedProjects: loadExpandedProjects(),
  pinnedWorktrees: loadPinnedWorktrees(),
  projectOrder: loadProjectOrder(),
  worktreeOrders: loadWorktreeOrders(),
  rightPanelTab: 'changes',
  showAddProject: false,
  toolMessageStyle: (loadStr(SK.toolMessageStyle, 'funny') as ToolMessageStyle),
  activityIndicatorStyle: (loadStr(SK.activityIndicatorStyle, 'waveform') as ActivityIndicatorStyle),
  openFilePaths: (() => {
    try {
      const wtId = loadStr(SK.selectedWorktreeId, '')
      if (wtId) {
        const raw = localStorage.getItem(SK.openFilePathsPrefix + wtId)
        if (raw) {
          const parsed = JSON.parse(raw) as unknown[]
          return parsed.filter((x): x is string => typeof x === 'string')
        }
      }
    } catch {}
    return []
  })(),
  changesOpenByWorktree: {},
  selectedDiffFileByWorktree: {},
  tabOrder: (() => {
    try {
      const wtId = loadStr(SK.selectedWorktreeId, '')
      if (wtId) {
        const raw = localStorage.getItem(SK.tabOrderPrefix + wtId)
        if (raw) {
          const parsed = JSON.parse(raw) as unknown[]
          return parsed.filter((x): x is string => typeof x === 'string')
        }
      }
    } catch {}
    return []
  })(),
  dirtyFilePaths: new Set(),
  activeCenterViewByWorktree: {},
  skipDeleteWorktreeConfirm: localStorage.getItem(SK.skipDeleteWorktreeConfirm) === 'true',
  newlyAddedWorktreeId: null,
  projectAvatarVisible: loadBool(SK.projectAvatarVisible, true),
  missionControlActive: loadBool(SK.missionControlActive, false),
  sidebarPanelOpen: (() => {
    const saved = localStorage.getItem(SK.sidebarPanelOpen)
    if (saved !== null) return saved === 'true'
    return loadBool(SK.sidebarVisible, true) // migrate from old key
  })(),
  rightPanelVisible: loadBool(SK.rightPanelVisible, true),
  sidebarWidth: loadInt(SK.sidebarWidth, 290),
  rightPanelWidth: loadInt(SK.rightPanelWidth, 400),
  changesCounts: {},
  diffRevisionByWorktree: {},

  selectWorktree: (projectId, worktreeId) => {
    const expanded = new Set(get().expandedProjects)
    expanded.add(projectId)
    saveExpandedProjects(expanded)

    const prevWorktreeId = get().selectedWorktreeId
    if (prevWorktreeId) {
      try {
        localStorage.setItem(SK.openFilePathsPrefix + prevWorktreeId, JSON.stringify(get().openFilePaths))
        localStorage.setItem(SK.tabOrderPrefix + prevWorktreeId, JSON.stringify(get().tabOrder))
      } catch {}
    }

    let restoredFiles: string[] = []
    try {
      const raw = localStorage.getItem(SK.openFilePathsPrefix + worktreeId)
      if (raw) {
        const parsed = JSON.parse(raw) as unknown[]
        restoredFiles = parsed.filter((x): x is string => typeof x === 'string')
      }
    } catch {}

    let restoredTabOrder: string[] = []
    try {
      const raw = localStorage.getItem(SK.tabOrderPrefix + worktreeId)
      if (raw) {
        const parsed = JSON.parse(raw) as unknown[]
        restoredTabOrder = parsed.filter((x): x is string => typeof x === 'string')
      }
    } catch {}

    try {
      localStorage.setItem(SK.selectedProjectId, projectId)
      localStorage.setItem(SK.selectedWorktreeId, worktreeId)
    } catch {}

    set({
      selectedProjectId: projectId,
      selectedWorktreeId: worktreeId,
      expandedProjects: expanded,
      openFilePaths: restoredFiles,
      tabOrder: restoredTabOrder,
      dirtyFilePaths: new Set(),
    })
    // Close any active web app via the apps slice's own action
    // (avoids cross-slice mutation of activeWebAppId)
    get().closeWebApp()
  },

  toggleProject: (projectId) => {
    const expanded = new Set(get().expandedProjects)
    if (expanded.has(projectId)) expanded.delete(projectId)
    else expanded.add(projectId)
    saveExpandedProjects(expanded)
    set({ expandedProjects: expanded })
  },

  togglePinWorktree: (worktreeId) => {
    const pinned = new Set(get().pinnedWorktrees)
    if (pinned.has(worktreeId)) pinned.delete(worktreeId)
    else pinned.add(worktreeId)
    savePinnedWorktrees(pinned)
    set({ pinnedWorktrees: pinned })
  },

  reorderProjects: (fromIndex, toIndex) => {
    const order = [...get().projectOrder]
    const [moved] = order.splice(fromIndex, 1)
    order.splice(toIndex, 0, moved)
    saveProjectOrder(order)
    set({ projectOrder: order })
  },

  reorderProjectsById: (currentIds, fromId, toId) => {
    const order = [...currentIds]
    const fromIndex = order.indexOf(fromId)
    const toIndex = order.indexOf(toId)
    if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) return
    const [moved] = order.splice(fromIndex, 1)
    order.splice(toIndex, 0, moved)
    saveProjectOrder(order)
    set({ projectOrder: order })
  },

  reorderWorktrees: (projectId, fromIndex, toIndex) => {
    const orders = { ...get().worktreeOrders }
    const current = orders[projectId] ? [...orders[projectId]] : []
    const [moved] = current.splice(fromIndex, 1)
    current.splice(toIndex, 0, moved)
    orders[projectId] = current
    saveWorktreeOrders(orders)
    set({ worktreeOrders: orders })
  },

  reorderWorktreesById: (projectId, currentIds, fromId, toId) => {
    const order = [...currentIds]
    const fromIndex = order.indexOf(fromId)
    const toIndex = order.indexOf(toId)
    if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) return
    const [moved] = order.splice(fromIndex, 1)
    order.splice(toIndex, 0, moved)
    const orders = { ...get().worktreeOrders, [projectId]: order }
    saveWorktreeOrders(orders)
    set({ worktreeOrders: orders })
  },

  setRightPanelTab: (tab) => set({ rightPanelTab: tab }),
  setShowAddProject: (show) => set({ showAddProject: show }),
  setToolMessageStyle: (style) => {
    localStorage.setItem(SK.toolMessageStyle, style)
    set({ toolMessageStyle: style })
  },
  setActivityIndicatorStyle: (style) => {
    localStorage.setItem(SK.activityIndicatorStyle, style)
    set({ activityIndicatorStyle: style })
  },

  openFile: (path) => {
    const { openFilePaths, tabOrder, selectedWorktreeId } = get()
    const alreadyOpen = openFilePaths.includes(path)
    const nextFiles = alreadyOpen ? openFilePaths : [...openFilePaths, path]
    const fileKey = `f:${path}`
    const nextTabOrder = tabOrder.includes(fileKey) ? tabOrder : [...tabOrder, fileKey]
    if (!alreadyOpen && selectedWorktreeId) {
      try {
        localStorage.setItem(SK.openFilePathsPrefix + selectedWorktreeId, JSON.stringify(nextFiles))
        localStorage.setItem(SK.tabOrderPrefix + selectedWorktreeId, JSON.stringify(nextTabOrder))
      } catch {}
    }
    const wtId = selectedWorktreeId ?? ''
    set({ openFilePaths: nextFiles, tabOrder: nextTabOrder, activeCenterViewByWorktree: { ...get().activeCenterViewByWorktree, [wtId]: { type: 'file', path } } })
  },

  closeFile: (path) => {
    const { openFilePaths, tabOrder, dirtyFilePaths, selectedWorktreeId } = get()
    const wtId = selectedWorktreeId ?? ''
    const acv = get().activeCenterViewByWorktree[wtId] ?? null
    const nextFiles = openFilePaths.filter((p) => p !== path)
    const nextTabOrder = tabOrder.filter((k) => k !== `f:${path}`)
    const nextDirty = new Set(dirtyFilePaths)
    nextDirty.delete(path)
    let nextView: CenterView | null = acv
    if (acv?.type === 'file' && acv.path === path) {
      const idx = openFilePaths.indexOf(path)
      const fallback = nextFiles[idx] ?? nextFiles[idx - 1] ?? null
      nextView = fallback ? { type: 'file', path: fallback } : null
    }
    if (selectedWorktreeId) {
      try {
        localStorage.setItem(SK.openFilePathsPrefix + selectedWorktreeId, JSON.stringify(nextFiles))
        localStorage.setItem(SK.tabOrderPrefix + selectedWorktreeId, JSON.stringify(nextTabOrder))
      } catch {}
    }
    set({ openFilePaths: nextFiles, tabOrder: nextTabOrder, dirtyFilePaths: nextDirty, activeCenterViewByWorktree: { ...get().activeCenterViewByWorktree, [wtId]: nextView } })
  },

  openChanges: (file, status, staged) => {
    const wtId = get().selectedWorktreeId
    if (!wtId) return
    const { tabOrder } = get()
    const changesKey = 'changes'
    const nextTabOrder = tabOrder.includes(changesKey) ? tabOrder : [...tabOrder, changesKey]
    if (!tabOrder.includes(changesKey)) {
      try { localStorage.setItem(SK.tabOrderPrefix + wtId, JSON.stringify(nextTabOrder)) } catch {}
    }
    const selection: DiffFileSelection | null = file
      ? { path: file, status: status ?? 'M', staged: staged ?? false }
      : get().selectedDiffFileByWorktree[wtId] ?? null
    set({
      changesOpenByWorktree: { ...get().changesOpenByWorktree, [wtId]: true },
      selectedDiffFileByWorktree: { ...get().selectedDiffFileByWorktree, [wtId]: selection },
      tabOrder: nextTabOrder,
      activeCenterViewByWorktree: { ...get().activeCenterViewByWorktree, [wtId]: { type: 'changes' } },
    })
  },

  closeChanges: () => {
    const wtId = get().selectedWorktreeId
    if (!wtId) return
    const { tabOrder } = get()
    const acv = get().activeCenterViewByWorktree[wtId] ?? null
    const nextTabOrder = tabOrder.filter((k) => k !== 'changes')
    let nextView: CenterView | null = acv
    if (acv?.type === 'changes') nextView = null
    try { localStorage.setItem(SK.tabOrderPrefix + wtId, JSON.stringify(nextTabOrder)) } catch {}
    set({
      changesOpenByWorktree: { ...get().changesOpenByWorktree, [wtId]: false },
      selectedDiffFileByWorktree: { ...get().selectedDiffFileByWorktree, [wtId]: null },
      tabOrder: nextTabOrder,
      activeCenterViewByWorktree: { ...get().activeCenterViewByWorktree, [wtId]: nextView },
    })
  },

  selectDiffFile: (path, status, staged) => {
    const wtId = get().selectedWorktreeId ?? ''
    set({ selectedDiffFileByWorktree: { ...get().selectedDiffFileByWorktree, [wtId]: { path, status: status ?? 'M', staged: staged ?? false } } })
  },

  setActiveCenterView: (view) => {
    const wtId = get().selectedWorktreeId ?? ''
    set({ activeCenterViewByWorktree: { ...get().activeCenterViewByWorktree, [wtId]: view } })
  },

  setFileDirty: (path, dirty) => {
    const nextDirty = new Set(get().dirtyFilePaths)
    dirty ? nextDirty.add(path) : nextDirty.delete(path)
    set({ dirtyFilePaths: nextDirty })
  },

  reorderFilePaths: (fromIndex, toIndex) => {
    const paths = [...get().openFilePaths]
    const [moved] = paths.splice(fromIndex, 1)
    paths.splice(toIndex, 0, moved)
    const { selectedWorktreeId } = get()
    if (selectedWorktreeId) {
      try { localStorage.setItem(SK.openFilePathsPrefix + selectedWorktreeId, JSON.stringify(paths)) } catch {}
    }
    set({ openFilePaths: paths })
  },

  setTabOrder: (order) => {
    const { selectedWorktreeId } = get()
    if (selectedWorktreeId) {
      try { localStorage.setItem(SK.tabOrderPrefix + selectedWorktreeId, JSON.stringify(order)) } catch {}
    }
    set({ tabOrder: order })
  },

  setSkipDeleteWorktreeConfirm: (skip) => {
    localStorage.setItem(SK.skipDeleteWorktreeConfirm, String(skip))
    set({ skipDeleteWorktreeConfirm: skip })
  },

  setNewlyAddedWorktreeId: (id) => set({ newlyAddedWorktreeId: id }),

  prependWorktreeToOrder: (projectId, worktreeId) => {
    const orders = { ...get().worktreeOrders }
    const current = orders[projectId] ?? []
    orders[projectId] = [worktreeId, ...current.filter((id) => id !== worktreeId)]
    saveWorktreeOrders(orders)
    set({ worktreeOrders: orders, newlyAddedWorktreeId: worktreeId })
  },

  setProjectAvatarVisible: (visible) => {
    localStorage.setItem(SK.projectAvatarVisible, String(visible))
    set({ projectAvatarVisible: visible })
  },

  toggleMissionControl: () => {
    const { missionControlActive, sidebarPanelOpen, activeWebAppId, closeWebApp } = get()
    if (activeWebAppId) closeWebApp()
    const next = !missionControlActive
    localStorage.setItem(SK.missionControlActive, String(next))
    if (next) {
      // Activating MC - save sidebar state, then close it (no-op if app already saved it)
      saveSidebarForOverlay(sidebarPanelOpen)
      localStorage.setItem(SK.sidebarPanelOpen, 'false')
      set({ missionControlActive: true, sidebarPanelOpen: false })
    } else {
      // Deactivating MC - restore sidebar to pre-MC state
      const restore = sidebarBeforeOverlay ?? true
      sidebarBeforeOverlay = null
      localStorage.setItem(SK.sidebarPanelOpen, String(restore))
      set({ missionControlActive: false, sidebarPanelOpen: restore })
    }
  },

  setMissionControlActive: (active) => {
    if (active === get().missionControlActive) return // no-op if already in desired state
    const { activeWebAppId, closeWebApp } = get()
    if (activeWebAppId) closeWebApp()
    localStorage.setItem(SK.missionControlActive, String(active))
    if (active) {
      // Activating MC - save sidebar state, then close it (no-op if app already saved it)
      saveSidebarForOverlay(get().sidebarPanelOpen)
      localStorage.setItem(SK.sidebarPanelOpen, 'false')
      set({ missionControlActive: true, sidebarPanelOpen: false })
    } else {
      // Deactivating MC - restore sidebar to pre-MC state
      const restore = sidebarBeforeOverlay ?? true
      sidebarBeforeOverlay = null
      localStorage.setItem(SK.sidebarPanelOpen, String(restore))
      set({ missionControlActive: false, sidebarPanelOpen: restore })
    }
  },

  toggleSidebar: () => {
    const { sidebarPanelOpen, missionControlActive, activeWebAppId, closeWebApp } = get()
    if (activeWebAppId) {
      // Leaving web app -> Explorer: close app and restore sidebar
      closeWebApp()
      const restore = sidebarBeforeOverlay ?? true
      sidebarBeforeOverlay = null
      if (missionControlActive) {
        localStorage.setItem(SK.missionControlActive, 'false')
        localStorage.setItem(SK.sidebarPanelOpen, String(restore))
        set({ missionControlActive: false, sidebarPanelOpen: restore })
      } else {
        localStorage.setItem(SK.sidebarPanelOpen, String(restore))
        set({ sidebarPanelOpen: restore })
      }
      return
    }
    if (missionControlActive) {
      // Deactivate MC and restore sidebar to pre-MC state (or open)
      const restore = sidebarBeforeOverlay ?? true
      sidebarBeforeOverlay = null
      localStorage.setItem(SK.missionControlActive, 'false')
      localStorage.setItem(SK.sidebarPanelOpen, String(restore))
      set({ missionControlActive: false, sidebarPanelOpen: restore })
    } else {
      const next = !sidebarPanelOpen
      localStorage.setItem(SK.sidebarPanelOpen, String(next))
      set({ sidebarPanelOpen: next })
    }
  },

  toggleRightPanel: () => {
    const next = !get().rightPanelVisible
    localStorage.setItem(SK.rightPanelVisible, String(next))
    set({ rightPanelVisible: next })
  },

  setSidebarWidth: (width) => {
    const clamped = Math.max(180, Math.min(500, Math.round(width)))
    set({ sidebarWidth: clamped })
  },

  persistSidebarWidth: () => {
    localStorage.setItem(SK.sidebarWidth, String(get().sidebarWidth))
  },

  setRightPanelWidth: (width) => {
    const clamped = Math.max(240, Math.min(700, Math.round(width)))
    set({ rightPanelWidth: clamped })
  },

  persistRightPanelWidth: () => {
    localStorage.setItem(SK.rightPanelWidth, String(get().rightPanelWidth))
  },

  setChangesCount: (worktreePath, count) => {
    const prev = get().changesCounts[worktreePath]
    if (prev === count) return
    set({ changesCounts: { ...get().changesCounts, [worktreePath]: count } })
  },

  bumpDiffRevision: (worktreePath) => {
    const current = get().diffRevisionByWorktree[worktreePath] ?? 0
    set({ diffRevisionByWorktree: { ...get().diffRevisionByWorktree, [worktreePath]: current + 1 } })
  },

  cleanupWorktreeState: (worktreeId, worktreePath) => {
    // Prune all per-worktree maps to avoid leaking entries after worktree deletion.
    // Some maps key by worktreeId, others by worktreePath - clean both consistently.
    const omit = <V,>(obj: Record<string, V>, key: string): Record<string, V> => {
      if (!(key in obj)) return obj
      const { [key]: _, ...rest } = obj
      return rest
    }
    const s = get()
    set({
      changesOpenByWorktree: omit(s.changesOpenByWorktree, worktreeId),
      selectedDiffFileByWorktree: omit(s.selectedDiffFileByWorktree, worktreeId),
      activeCenterViewByWorktree: omit(s.activeCenterViewByWorktree, worktreeId),
      changesCounts: omit(s.changesCounts, worktreePath),
      diffRevisionByWorktree: omit(s.diffRevisionByWorktree, worktreePath),
    })
    // Also clear persisted per-worktree localStorage entries
    try { localStorage.removeItem(SK.openFilePathsPrefix + worktreeId) } catch {}
    try { localStorage.removeItem(SK.tabOrderPrefix + worktreeId) } catch {}
  },
})

// ─── Derived selectors (per-worktree lookups) ─────────────────────────────────

export const selectChangesOpen = (s: LayoutSlice): boolean =>
  s.changesOpenByWorktree[s.selectedWorktreeId ?? ''] ?? false

export const selectSelectedDiffFile = (s: LayoutSlice): DiffFileSelection | null =>
  s.selectedDiffFileByWorktree[s.selectedWorktreeId ?? ''] ?? null

export const selectActiveCenterView = (s: LayoutSlice): CenterView | null =>
  s.activeCenterViewByWorktree[s.selectedWorktreeId ?? ''] ?? null
