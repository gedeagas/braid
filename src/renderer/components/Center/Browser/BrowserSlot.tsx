import { useLayoutEffect, useRef } from 'react'
import type { PaneId } from '@/store/ui'
import { setSlotRect } from './browserSlots'

/** Placeholder a pane renders where its browser tab should appear. */
export function BrowserSlot({ pane }: { pane: PaneId }) {
  const ref = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const el = ref.current
    const body = el?.closest('.center-body')
    if (!el || !(body instanceof HTMLElement)) return
    const measure = () => {
      const a = el.getBoundingClientRect()
      const b = body.getBoundingClientRect()
      setSlotRect(pane, { left: a.left - b.left, top: a.top - b.top, width: a.width, height: a.height })
    }
    measure()
    // The slot can move without resizing (split ratio, bottom strip), so watch the body too.
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    ro.observe(body)
    window.addEventListener('resize', measure)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', measure)
      setSlotRect(pane, null)
    }
  }, [pane])

  return <div ref={ref} className="browser-slot" />
}
