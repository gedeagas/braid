// ---------------------------------------------------------------------------
// Generic flash toast store — lightweight ephemeral notifications
// ---------------------------------------------------------------------------
//
// Usage:
//   import { useFlashStore } from '@/store/flash'
//   useFlashStore.getState().flash({ type: 'warning', message: 'Too many snippets' })
//
// Or the shorthand (callable outside React):
//   import { flash } from '@/store/flash'
//   flash('warning', 'Max 5 snippets')
//

import { create } from 'zustand'

export type FlashType = 'info' | 'success' | 'warning' | 'error'
export type FlashPosition = 'center' | 'bottom-right'

export interface FlashToast {
  id: string
  type: FlashType
  message: string
  createdAt: number
  /** Auto-dismiss duration in ms (default 3000) */
  duration: number
  /** Where to anchor the toast (default 'center') */
  position: FlashPosition
}

interface FlashState {
  items: FlashToast[]
  flash: (opts: { type: FlashType; message: string; duration?: number; position?: FlashPosition }) => void
  dismiss: (id: string) => void
}

let counter = 0
const MAX_FLASH = 5

export const useFlashStore = create<FlashState>((set) => ({
  items: [],

  flash: ({ type, message, duration = 3000, position = 'center' }) => {
    const id = `flash-${Date.now()}-${++counter}`
    set((s) => {
      // Deduplicate: don't show the exact same message if already visible
      if (s.items.some((i) => i.message === message)) return s
      let next = [...s.items, { id, type, message, createdAt: Date.now(), duration, position }]
      // Cap visible toasts
      if (next.length > MAX_FLASH) next = next.slice(next.length - MAX_FLASH)
      return { items: next }
    })
  },

  dismiss: (id) => {
    set((s) => ({ items: s.items.filter((i) => i.id !== id) }))
  },
}))

/** Shorthand — callable outside React components */
export function flash(type: FlashType, message: string, duration?: number, position?: FlashPosition): void {
  useFlashStore.getState().flash({ type, message, duration, position })
}
