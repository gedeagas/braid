import { type StateCreator } from 'zustand'
import type { UIState } from './types'
import { SK } from '@/lib/storageKeys'
import { loadBool, loadInt, loadStr } from './helpers'

export interface TerminalSlice {
  // Panel terminal dimensions (right panel)
  terminalHeight: number
  terminalCollapsed: boolean
  // Center panel bottom terminal strip
  centerTerminalHeight: number
  centerTerminalCollapsed: boolean
  // Terminal preferences
  terminalFontSize: number
  terminalShell: string
  terminalScrollback: number

  setTerminalHeight: (height: number) => void
  persistTerminalHeight: () => void
  setTerminalCollapsed: (collapsed: boolean) => void
  setCenterTerminalHeight: (height: number) => void
  persistCenterTerminalHeight: () => void
  setCenterTerminalCollapsed: (collapsed: boolean) => void
  setTerminalFontSize: (size: number) => void
  setTerminalShell: (shell: string) => void
  setTerminalScrollback: (lines: number) => void
}

export const createTerminalSlice: StateCreator<UIState, [], [], TerminalSlice> = (set, get) => ({
  terminalHeight: loadInt(SK.terminalHeight, 0),
  terminalCollapsed: loadBool(SK.terminalCollapsed, false),
  centerTerminalHeight: loadInt(SK.centerTerminalHeight, 0),
  centerTerminalCollapsed: loadBool(SK.centerTerminalCollapsed, false),
  terminalFontSize: loadInt(SK.terminalFontSize, 13),
  terminalShell: loadStr(SK.terminalShell, ''),
  terminalScrollback: loadInt(SK.terminalScrollback, 1000),

  setTerminalHeight: (height) => {
    const clamped = Math.max(120, Math.round(height))
    set({ terminalHeight: clamped })
  },
  persistTerminalHeight: () => {
    localStorage.setItem(SK.terminalHeight, String(get().terminalHeight))
  },
  setTerminalCollapsed: (collapsed) => {
    localStorage.setItem(SK.terminalCollapsed, String(collapsed))
    set({ terminalCollapsed: collapsed })
  },

  setCenterTerminalHeight: (height) => {
    const clamped = Math.max(120, Math.round(height))
    set({ centerTerminalHeight: clamped })
  },
  persistCenterTerminalHeight: () => {
    localStorage.setItem(SK.centerTerminalHeight, String(get().centerTerminalHeight))
  },
  setCenterTerminalCollapsed: (collapsed) => {
    localStorage.setItem(SK.centerTerminalCollapsed, String(collapsed))
    set({ centerTerminalCollapsed: collapsed })
  },

  setTerminalFontSize: (size) => {
    localStorage.setItem(SK.terminalFontSize, String(size))
    set({ terminalFontSize: size })
  },
  setTerminalShell: (shell) => {
    localStorage.setItem(SK.terminalShell, shell)
    set({ terminalShell: shell })
  },
  setTerminalScrollback: (lines) => {
    localStorage.setItem(SK.terminalScrollback, String(lines))
    set({ terminalScrollback: lines })
  },
})
