import { type StateCreator } from 'zustand'
import type { EmbeddedApp } from '@/types'
import type { UIState } from './types'
import { SK } from '@/lib/storageKeys'
import { loadBool } from './helpers'
import { saveSidebarForOverlay } from './layout'

export interface AppsSlice {
  webAppsEnabled: boolean
  embeddedApps: EmbeddedApp[]
  activeWebAppId: string | null
  dormantAppIds: Set<string>
  webAppBadges: Map<string, number>
  webAppLastUrls: Record<string, string>
  /** Pending setup run to execute in the bottom panel */
  pendingSetupRun: { worktreePath: string; commands: string[] } | null
  /** Pending terminal command to run in the bottom panel */
  pendingTerminalCommand: { worktreePath: string; label: string; command: string } | null

  setWebAppBadge: (id: string, count: number) => void
  setWebAppLastUrl: (id: string, url: string) => void
  setWebAppsEnabled: (v: boolean) => void
  addEmbeddedApp: (app: EmbeddedApp) => void
  removeEmbeddedApp: (id: string) => void
  hideWebApp: (id: string) => void
  showWebApp: (id: string) => void
  openWebApp: (id: string) => void
  closeWebApp: () => void
  toggleWebApp: (id: string) => void
  quitWebApp: (id: string) => void
  reorderEmbeddedApps: (fromIndex: number, toIndex: number) => void
  setPendingSetupRun: (run: { worktreePath: string; commands: string[] } | null) => void
  setPendingTerminalCommand: (cmd: { worktreePath: string; label: string; command: string } | null) => void
}

export const createAppsSlice: StateCreator<UIState, [], [], AppsSlice> = (set, get) => ({
  webAppsEnabled: loadBool(SK.webAppsEnabled, false),
  embeddedApps: (() => {
    try { return JSON.parse(localStorage.getItem(SK.embeddedApps) ?? '[]') as EmbeddedApp[] } catch { return [] }
  })(),
  activeWebAppId: null,
  dormantAppIds: new Set<string>(),
  webAppBadges: new Map<string, number>(),
  webAppLastUrls: (() => {
    try { return JSON.parse(localStorage.getItem(SK.webAppLastUrls) ?? '{}') as Record<string, string> } catch { return {} }
  })(),
  pendingSetupRun: null,
  pendingTerminalCommand: null,

  setWebAppBadge: (id, count) => set((s) => {
    const next = new Map(s.webAppBadges)
    if (count > 0) next.set(id, count)
    else next.delete(id)
    return { webAppBadges: next }
  }),

  setWebAppLastUrl: (id, url) => set((s) => {
    const next = { ...s.webAppLastUrls, [id]: url }
    localStorage.setItem(SK.webAppLastUrls, JSON.stringify(next))
    return { webAppLastUrls: next }
  }),

  setWebAppsEnabled: (v) => {
    localStorage.setItem(SK.webAppsEnabled, String(v))
    set({ webAppsEnabled: v })
  },

  addEmbeddedApp: (app) => set((s) => {
    const next = [...s.embeddedApps, app]
    localStorage.setItem(SK.embeddedApps, JSON.stringify(next))
    if (!s.webAppsEnabled) localStorage.setItem(SK.webAppsEnabled, 'true')
    return { embeddedApps: next, webAppsEnabled: true }
  }),

  removeEmbeddedApp: (id) => set((s) => {
    const next = s.embeddedApps.filter((a) => a.id !== id)
    localStorage.setItem(SK.embeddedApps, JSON.stringify(next))
    return { embeddedApps: next, activeWebAppId: s.activeWebAppId === id ? null : s.activeWebAppId }
  }),

  hideWebApp: (id) => set((s) => {
    const next = s.embeddedApps.map((a) => a.id === id ? { ...a, visible: false } : a)
    localStorage.setItem(SK.embeddedApps, JSON.stringify(next))
    return { embeddedApps: next, activeWebAppId: s.activeWebAppId === id ? null : s.activeWebAppId }
  }),

  showWebApp: (id) => set((s) => {
    const next = s.embeddedApps.map((a) => a.id === id ? { ...a, visible: true } : a)
    localStorage.setItem(SK.embeddedApps, JSON.stringify(next))
    return { embeddedApps: next }
  }),

  openWebApp: (id) => set((s) => {
    // Save sidebar state before overlay takes over (no-op if MC already saved it)
    saveSidebarForOverlay(s.sidebarPanelOpen)
    if (s.missionControlActive) {
      localStorage.setItem(SK.missionControlActive, 'false')
    }
    const next = s.embeddedApps.map((a) => a.id === id ? { ...a, visible: true } : a)
    const nextDormant = new Set(s.dormantAppIds)
    nextDormant.delete(id)
    localStorage.setItem(SK.embeddedApps, JSON.stringify(next))
    localStorage.setItem(SK.sidebarPanelOpen, 'false')
    return {
      embeddedApps: next,
      activeWebAppId: id,
      dormantAppIds: nextDormant,
      missionControlActive: false,
      sidebarPanelOpen: false,
    }
  }),

  closeWebApp: () => set({ activeWebAppId: null }),

  toggleWebApp: (id) => {
    const { activeWebAppId, dormantAppIds, openWebApp, closeWebApp } = get()
    if (dormantAppIds.has(id)) { openWebApp(id); return }
    activeWebAppId === id ? closeWebApp() : openWebApp(id)
  },

  quitWebApp: (id) => set((s) => {
    const nextUrls = { ...s.webAppLastUrls }
    delete nextUrls[id]
    localStorage.setItem(SK.webAppLastUrls, JSON.stringify(nextUrls))
    return {
      dormantAppIds: new Set([...s.dormantAppIds, id]),
      activeWebAppId: s.activeWebAppId === id ? null : s.activeWebAppId,
      webAppLastUrls: nextUrls,
    }
  }),

  reorderEmbeddedApps: (fromIndex, toIndex) => set((s) => {
    const next = [...s.embeddedApps]
    const [moved] = next.splice(fromIndex, 1)
    next.splice(toIndex, 0, moved)
    localStorage.setItem(SK.embeddedApps, JSON.stringify(next))
    return { embeddedApps: next }
  }),

  setPendingSetupRun: (run) => set({ pendingSetupRun: run }),
  setPendingTerminalCommand: (cmd) => set({ pendingTerminalCommand: cmd }),
})
