import { type StateCreator } from 'zustand'
import type { ThemePalette } from '@/themes/palettes'
import type { UIState } from './types'
import i18n from '@/lib/i18n'
import { SK } from '@/lib/storageKeys'
import { loadFloat } from './helpers'

export type SupportedLanguage = 'en' | 'ja' | 'id'

export interface ThemeSlice {
  activeThemeId: string
  customThemes: ThemePalette[]
  language: SupportedLanguage
  uiZoom: number
  setTheme: (themeId: string) => void
  addCustomTheme: (theme: ThemePalette) => void
  removeCustomTheme: (themeId: string) => void
  setLanguage: (lang: SupportedLanguage) => void
  setUIZoom: (zoom: number) => void
}

function loadActiveThemeId(): string {
  try {
    const raw = localStorage.getItem(SK.activeThemeId)
    if (raw) return raw
  } catch {}
  return 'ocean-dark'
}

function loadCustomThemes(): ThemePalette[] {
  try {
    const raw = localStorage.getItem(SK.customThemes)
    if (raw) return JSON.parse(raw) as ThemePalette[]
  } catch {}
  return []
}

function loadLanguage(): SupportedLanguage {
  try {
    const raw = localStorage.getItem(SK.language)
    if (raw === 'en' || raw === 'ja' || raw === 'id') return raw
  } catch {}
  return 'en'
}

export const createThemeSlice: StateCreator<UIState, [], [], ThemeSlice> = (set, get) => ({
  activeThemeId: loadActiveThemeId(),
  customThemes: loadCustomThemes(),
  language: loadLanguage(),
  uiZoom: loadFloat(SK.uiZoom, 1.0),

  setTheme: (themeId) => {
    localStorage.setItem(SK.activeThemeId, themeId)
    set({ activeThemeId: themeId })
  },

  addCustomTheme: (theme) => {
    const next = [...get().customThemes, theme]
    localStorage.setItem(SK.customThemes, JSON.stringify(next))
    set({ customThemes: next })
  },

  removeCustomTheme: (themeId) => {
    const next = get().customThemes.filter((t) => t.id !== themeId)
    localStorage.setItem(SK.customThemes, JSON.stringify(next))
    if (get().activeThemeId === themeId) {
      localStorage.setItem(SK.activeThemeId, 'ocean-dark')
      set({ customThemes: next, activeThemeId: 'ocean-dark' })
    } else {
      set({ customThemes: next })
    }
  },

  setLanguage: (lang) => {
    localStorage.setItem(SK.language, lang)
    set({ language: lang })
    i18n.changeLanguage(lang)
  },

  setUIZoom: (zoom) => {
    const clamped = Math.round(Math.max(0.8, Math.min(1.5, zoom)) * 10) / 10
    localStorage.setItem(SK.uiZoom, String(clamped))
    try { window.api.window.setZoomFactor(clamped) } catch {}
    set({ uiZoom: clamped })
  },
})
