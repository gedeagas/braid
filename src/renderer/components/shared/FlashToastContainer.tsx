import { useEffect, useReducer, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useShallow } from 'zustand/react/shallow'
import { useFlashStore, type FlashToast, type FlashPosition } from '@/store/flash'

// ── Dismiss animation state ────────────────────────────────────────────────

type Action = { type: 'start'; id: string } | { type: 'finish'; id: string }

function dismissReducer(state: Set<string>, action: Action): Set<string> {
  const next = new Set(state)
  if (action.type === 'start') next.add(action.id)
  else next.delete(action.id)
  return next
}

const ICONS: Record<FlashToast['type'], string> = {
  info: 'ℹ',
  success: '✓',
  warning: '⚠',
  error: '✗',
}

// ── Sub-component for a single positioned stack ────────────────────────────

function FlashStack({
  items,
  position,
  dismissing,
  onDismiss,
  pausedIds,
  onPause,
  onResume,
}: {
  items: FlashToast[]
  position: FlashPosition
  dismissing: Set<string>
  onDismiss: (id: string) => void
  pausedIds: Set<string>
  onPause: (id: string) => void
  onResume: (id: string) => void
}) {
  const filtered = items.filter((i) => i.position === position)
  if (filtered.length === 0) return null
  return (
    <div
      className={`flash-container flash-container--${position}`}
    >
      {filtered.map((item) => (
        <div
          key={item.id}
          className={`flash flash--${item.type}${dismissing.has(item.id) ? ' flash--dismissing' : ''}${pausedIds.has(item.id) ? ' flash--paused' : ''}`}
          role="alert"
          onMouseEnter={() => onPause(item.id)}
          onMouseLeave={() => onResume(item.id)}
        >
          <span className="flash__icon">{ICONS[item.type]}</span>
          <span className="flash__message">{item.message}</span>
          <button
            className="flash__dismiss"
            onClick={() => onDismiss(item.id)}
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  )
}

// ── Component ──────────────────────────────────────────────────────────────

export function FlashToastContainer() {
  const items = useFlashStore(useShallow((s) => s.items))
  const dismiss = useFlashStore((s) => s.dismiss)
  const [dismissing, dispatch] = useReducer(dismissReducer, new Set<string>())
  const pausedRef = useRef(new Set<string>())
  const [pausedIds, setPausedIds] = useReducer(
    (_: Set<string>, next: Set<string>) => next,
    new Set<string>(),
  )

  const animateDismiss = useCallback((id: string) => {
    dispatch({ type: 'start', id })
    setTimeout(() => {
      dispatch({ type: 'finish', id })
      dismiss(id)
      pausedRef.current.delete(id)
    }, 150)
  }, [dismiss])

  const handlePause = useCallback((id: string) => {
    pausedRef.current.add(id)
    setPausedIds(new Set(pausedRef.current))
  }, [])

  const handleResume = useCallback((id: string) => {
    // Don't resume if user has an active text selection within the toast
    const sel = window.getSelection()
    if (sel && sel.toString().length > 0) return
    pausedRef.current.delete(id)
    setPausedIds(new Set(pausedRef.current))
  }, [])

  // Clear pause when text selection is released outside the toast
  useEffect(() => {
    if (pausedRef.current.size === 0) return
    const onSelectionChange = (): void => {
      const sel = window.getSelection()
      if (sel && sel.toString().length > 0) return
      // Selection cleared - unpause all
      pausedRef.current.clear()
      setPausedIds(new Set())
    }
    document.addEventListener('selectionchange', onSelectionChange)
    return () => document.removeEventListener('selectionchange', onSelectionChange)
  }, [pausedIds])

  // Auto-dismiss after each toast's duration, skipping paused toasts
  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = []
    for (const item of items) {
      if (dismissing.has(item.id) || pausedRef.current.has(item.id)) continue
      const remaining = item.duration - (Date.now() - item.createdAt)
      if (remaining <= 0) {
        animateDismiss(item.id)
        continue
      }
      timers.push(setTimeout(() => animateDismiss(item.id), remaining))
    }
    return () => timers.forEach(clearTimeout)
  }, [items, dismissing, pausedIds, animateDismiss])

  if (items.length === 0) return null

  return createPortal(
    <>
      <FlashStack items={items} position="center" dismissing={dismissing} onDismiss={animateDismiss} pausedIds={pausedIds} onPause={handlePause} onResume={handleResume} />
      <FlashStack items={items} position="bottom-right" dismissing={dismissing} onDismiss={animateDismiss} pausedIds={pausedIds} onPause={handlePause} onResume={handleResume} />
    </>,
    document.body
  )
}
