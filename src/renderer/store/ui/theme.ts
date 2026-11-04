import { type StateCreator } from 'zustand'
import type { ThemePalette } from '@/themes/palettes'
import type { UIState } from './types'
import i18n from '@/lib/i18n'
import { SK } from '@/lib/storageKeys'
import { loadFloat } from './helpers'

export type SupportedLanguage = 'en' | 'ja' | 'id' | 'zh'

export const CHAT_FONT_SIZE_DEFAULT = 14
export const CHAT_FONT_SIZE_MIN = 12
export const CHAT_FONT_SIZE_MAX = 20

/** Apply the chat body font size (px) as a CSS variable consumed by chat-messages.css. */
export function applyChatFontSize(px: number): void {
  try { document.documentElement.style.setProperty('--chat-font-size', `${px}px`) } catch {}
}

export interface ThemeSlice {
  activeThemeId: string
  customThemes: ThemePalette[]
  language: SupportedLanguage
  uiZoom: number
  chatFontSize: number
  setTheme: (themeId: string) => void
  addCustomTheme: (theme: ThemePalette) => void
  removeCustomTheme: (themeId: string) => void
  setLanguage: (lang: SupportedLanguage) => void
  setUIZoom: (zoom: number) => void
  setChatFontSize: (px: number) => void
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
    if (raw === 'en' || raw === 'ja' || raw === 'id' || raw === 'zh') return raw
  } catch {}
  return 'en'
}

export const createThemeSlice: StateCreator<UIState, [], [], ThemeSlice> = (set, get) => ({
  activeThemeId: loadActiveThemeId(),
  customThemes: loadCustomThemes(),
  language: loadLanguage(),
  uiZoom: loadFloat(SK.uiZoom, 1.0),
  chatFontSize: loadFloat(SK.chatFontSize, CHAT_FONT_SIZE_DEFAULT),

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

  setChatFontSize: (px) => {
    const clamped = Math.round(Math.max(CHAT_FONT_SIZE_MIN, Math.min(CHAT_FONT_SIZE_MAX, px)))
    try { localStorage.setItem(SK.chatFontSize, String(clamped)) } catch {}
    applyChatFontSize(clamped)
    set({ chatFontSize: clamped })
  },
})
