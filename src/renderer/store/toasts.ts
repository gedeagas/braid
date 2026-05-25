// ---------------------------------------------------------------------------
// Zustand store — in-app toast notifications
// ---------------------------------------------------------------------------

import { create } from 'zustand'
import { playNotificationSound } from '@/lib/sounds'
import { useUIStore } from '@/store/ui'

export type WaitingReason = 'question' | 'plan_approval'

export interface Toast {
  id: string
  type: 'done' | 'error' | 'waiting_input'
  /** For waiting_input: what kind of input is needed */
  reason?: WaitingReason
  sessionId: string
  sessionName: string
  worktreeId: string
  worktreeBranch: string
  projectId: string
  /** Non-empty only when 2+ projects are open (avoids noise for single-project users) */
  projectName: string
  /** Present when toast is for a big terminal (not a chat session) */
  terminalId?: string
  /** Display label for the terminal, e.g. "Terminal 1", "Claude Code" */
  terminalLabel?: string
  createdAt: number
}

interface ToastsState {
  toasts: Toast[]
  addToast: (toast: Omit<Toast, 'id' | 'createdAt'>) => void
  dismissToast: (id: string) => void
  dismissByType: (type: Toast['type']) => void
  dismissBySession: (sessionId: string) => void
  dismissByTerminal: (terminalId: string) => void
}

let counter = 0

const MAX_DONE_TOASTS = 3

export const useToastsStore = create<ToastsState>((set) => ({
  toasts: [],

  addToast: (data) => {
    const id = `toast-${Date.now()}-${++counter}`
    const toast: Toast = { ...data, id, createdAt: Date.now() }

    set((s) => {
      // Prevent duplicate: key by terminalId+type for terminal toasts, sessionId+type otherwise
      const isDupe = data.terminalId
        ? s.toasts.some((t) => t.terminalId === data.terminalId && t.type === data.type)
        : s.toasts.some((t) => !t.terminalId && t.sessionId === data.sessionId && t.type === data.type)
      if (isDupe) return s

      // Play notification sound (outside state update to avoid side-effect issues)
      if (useUIStore.getState().notificationSound) {
        const volume = useUIStore.getState().notificationVolume
        try { playNotificationSound(data.type, volume) } catch { /* audio context may not be ready */ }
      }

      let next = [...s.toasts, toast]

      // Cap done toasts — evict oldest done if over limit
      const doneToasts = next.filter((t) => t.type === 'done')
      if (doneToasts.length > MAX_DONE_TOASTS) {
        const oldest = doneToasts[0]
        next = next.filter((t) => t.id !== oldest.id)
      }

      return { toasts: next }
    })
  },

  dismissToast: (id) => {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
  },

  dismissByType: (type) => {
    set((s) => ({ toasts: s.toasts.filter((t) => t.type !== type) }))
  },

  dismissBySession: (sessionId) => {
    set((s) => ({ toasts: s.toasts.filter((t) => t.sessionId !== sessionId) }))
  },

  dismissByTerminal: (terminalId) => {
    set((s) => ({ toasts: s.toasts.filter((t) => t.terminalId !== terminalId) }))
  }
}))
