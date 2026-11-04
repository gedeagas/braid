// Renderer mirror of main-owned browser state: settings, downloads and
// pending permission prompts. Tab state lives in the UI store (browserTabs slice).
import { create } from 'zustand'
import {
  DEFAULT_BROWSER_SETTINGS,
  type BrowserDownload,
  type BrowserPermissionRequest,
  type BrowserSettings,
} from '@shared/browser'
import * as ipc from '@/lib/ipc'

/** Finished downloads auto-hide from the shelf after this long. */
export const DOWNLOAD_SHELF_LINGER_MS = 30_000
/** How long the agent-activity banner stays after the last automation call. */
export const AUTOMATION_BANNER_MS = 4_000

interface BrowserStoreState {
  settings: BrowserSettings
  settingsLoaded: boolean
  downloads: BrowserDownload[]
  permissionRequests: BrowserPermissionRequest[]
  /** tabId -> time until which the "agent is using this tab" banner shows. */
  automationUntil: Record<string, number>
  noteAutomation: (tabId: string) => void
  loadSettings: () => Promise<void>
  updateSettings: (patch: Partial<BrowserSettings>) => Promise<void>
  /** Replace settings after a main-side change (e.g. profile delete). */
  applySettings: (settings: BrowserSettings) => void
  upsertDownload: (d: BrowserDownload) => void
  dismissDownload: (id: string) => void
  addPermissionRequest: (r: BrowserPermissionRequest) => void
  resolvePermissionRequest: (id: number, allow: boolean, remember: boolean) => void
}

export const useBrowserStore = create<BrowserStoreState>((set, get) => ({
  settings: DEFAULT_BROWSER_SETTINGS,
  settingsLoaded: false,
  downloads: [],
  permissionRequests: [],
  automationUntil: {},

  noteAutomation: (tabId) => set((s) => ({ automationUntil: { ...s.automationUntil, [tabId]: Date.now() + AUTOMATION_BANNER_MS } })),

  loadSettings: async () => {
    try {
      set({ settings: await ipc.browser.getSettings(), settingsLoaded: true })
    } catch {
      set({ settingsLoaded: true })
    }
  },

  updateSettings: async (patch) => {
    // Optimistic; main normalizes and returns the canonical value.
    set((s) => ({ settings: { ...s.settings, ...patch } }))
    try {
      set({ settings: await ipc.browser.setSettings(patch) })
    } catch {
      await get().loadSettings()
    }
  },

  applySettings: (settings) => set({ settings }),

  upsertDownload: (d) => set((s) => {
    const idx = s.downloads.findIndex((x) => x.id === d.id)
    if (idx === -1) return { downloads: [...s.downloads, d] }
    const next = [...s.downloads]
    next[idx] = d
    return { downloads: next }
  }),

  dismissDownload: (id) => {
    void ipc.browser.downloadDismiss(id).catch(() => {})
    set((s) => ({ downloads: s.downloads.filter((d) => d.id !== id) }))
  },

  addPermissionRequest: (r) => set((s) => ({ permissionRequests: [...s.permissionRequests, r] })),

  resolvePermissionRequest: (id, allow, remember) => {
    void ipc.browser.respondPermission(id, allow, remember).catch(() => {})
    set((s) => ({ permissionRequests: s.permissionRequests.filter((r) => r.id !== id) }))
  },
}))
