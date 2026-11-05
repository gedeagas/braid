// ---------------------------------------------------------------------------
// Themed replacement for window.confirm()
// ---------------------------------------------------------------------------
//
// Usage (inside or outside React):
//   import { confirmDialog } from '@/store/confirm'
//   if (!(await confirmDialog({ title, message, confirmLabel, destructive: true }))) return
//
// Requests queue and are shown one at a time by <ConfirmDialogHost />,
// which is mounted once at the app root.

import { create } from 'zustand'

export interface ConfirmOptions {
  /** Short question, e.g. "Close active session?" */
  title?: string
  /** Supporting detail. When there is no title, this is the only text shown. */
  message: string
  /** Confirm button label. Defaults to common:confirm. */
  confirmLabel?: string
  /** Cancel button label. Defaults to common:cancel. */
  cancelLabel?: string
  /** Styles the confirm button as dangerous (data loss, killing a process). */
  destructive?: boolean
}

export interface ConfirmRequest {
  id: string
  options: ConfirmOptions
  resolve: (confirmed: boolean) => void
}

interface ConfirmState {
  queue: ConfirmRequest[]
  settle: (id: string, confirmed: boolean) => void
}

let counter = 0

export const useConfirmStore = create<ConfirmState>((set, get) => ({
  queue: [],

  settle: (id, confirmed) => {
    const request = get().queue.find((r) => r.id === id)
    if (!request) return
    set((s) => ({ queue: s.queue.filter((r) => r.id !== id) }))
    request.resolve(confirmed)
  }
}))

/** Ask the user to confirm an action. Resolves false on cancel, Esc or backdrop click. */
export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    const id = `confirm-${++counter}`
    useConfirmStore.setState((s) => ({ queue: [...s.queue, { id, options, resolve }] }))
  })
}
