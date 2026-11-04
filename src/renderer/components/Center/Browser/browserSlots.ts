/**
 * Where each center pane wants a browser page drawn. Panes render an empty
 * <BrowserSlot>; BrowserHost positions the (never re-parented) page over it.
 * Rects are relative to the `.center-body` element that contains both.
 */
import { useSyncExternalStore } from 'react'
import type { PaneId } from '@/store/ui'

export interface SlotRect { left: number; top: number; width: number; height: number }

let rects: Partial<Record<PaneId, SlotRect>> = {}
const listeners = new Set<() => void>()

function emit(): void {
  for (const l of listeners) l()
}

export function setSlotRect(pane: PaneId, rect: SlotRect | null): void {
  const prev = rects[pane]
  if (!rect) {
    if (!prev) return
    const next = { ...rects }
    delete next[pane]
    rects = next
    emit()
    return
  }
  if (prev && prev.left === rect.left && prev.top === rect.top && prev.width === rect.width && prev.height === rect.height) return
  rects = { ...rects, [pane]: rect }
  emit()
}

export function useSlotRects(): Partial<Record<PaneId, SlotRect>> {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => { listeners.delete(cb) } },
    () => rects,
  )
}
