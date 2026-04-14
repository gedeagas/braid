import { useCallback, useEffect, useReducer, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useShallow } from 'zustand/react/shallow'
import { useToastsStore, type Toast as ToastType } from '@/store/toasts'
import { useUIStore } from '@/store/ui'
import { useSessionsStore } from '@/store/sessions'
import { Toast, GroupedToast } from './Toast'

// ── Dismiss animation state ────────────────────────────���────────────────────

type Action =
  | { type: 'start'; id: string }
  | { type: 'finish'; id: string }

function dismissReducer(state: Set<string>, action: Action): Set<string> {
  const next = new Set(state)
  if (action.type === 'start') next.add(action.id)
  else next.delete(action.id)
  return next
}

// ── Navigation helper ───────────────────────────────────────────────────────

function navigateToSession(toast: ToastType): void {
  useUIStore.getState().selectWorktree(toast.projectId, toast.worktreeId)
  useSessionsStore.getState().setActiveSession(toast.sessionId)
  useUIStore.getState().setActiveCenterView({ type: 'session', sessionId: toast.sessionId })
  useUIStore.getState().setMissionControlActive(false)
}

// ── Component ───────────────────────────────────────────────────────────────

export function ToastContainer() {
  const toasts = useToastsStore(useShallow((s) => s.toasts))
  const [dismissing, dispatch] = useReducer(dismissReducer, new Set<string>())
  const hoveredRef = useRef<Set<string>>(new Set())
  // Force re-render when hover changes (for progress bar pause)
  const [, forceRender] = useReducer((x: number) => x + 1, 0)

  // ── Auto-dismiss done toasts ──────────────────────────────────────────

  const dismissToast = useToastsStore((s) => s.dismissToast)
  const dismissByType = useToastsStore((s) => s.dismissByType)
  const toastSize = useUIStore((s) => s.toastSize)
  const toastPosition = useUIStore((s) => s.toastPosition)
  const toastDuration = useUIStore((s) => s.toastDuration)
  const durationMs = toastDuration * 1000

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = []
    for (const toast of toasts) {
      if (toast.type !== 'done' || dismissing.has(toast.id)) continue
      const remaining = durationMs - (Date.now() - toast.createdAt)
      if (remaining <= 0) {
        animateDismiss(toast.id)
        continue
      }
      const timer = setTimeout(() => {
        if (!hoveredRef.current.has(toast.id)) animateDismiss(toast.id)
      }, remaining)
      timers.push(timer)
    }
    return () => timers.forEach(clearTimeout)
  }, [toasts, dismissing, durationMs]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Dismiss with animation ────────────────────────────────────────────

  const animateDismiss = useCallback((id: string) => {
    dispatch({ type: 'start', id })
    setTimeout(() => {
      dispatch({ type: 'finish', id })
      dismissToast(id)
    }, 150)
  }, [dismissToast])

  const handleDismiss = useCallback((id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    animateDismiss(id)
  }, [animateDismiss])

  const handleDismissType = useCallback((type: ToastType['type'], e: React.MouseEvent) => {
    e.stopPropagation()
    dismissByType(type)
  }, [dismissByType])

  const handleClick = useCallback((toast: ToastType) => {
    navigateToSession(toast)
    dismissToast(toast.id)
  }, [dismissToast])

  const handleMouseEnter = useCallback((id: string) => {
    hoveredRef.current.add(id)
    forceRender()
  }, [])

  const handleMouseLeave = useCallback((id: string) => {
    hoveredRef.current.delete(id)
    forceRender()
    // If it's a done toast past its timer, dismiss now
    const toast = useToastsStore.getState().toasts.find((t) => t.id === id)
    if (toast?.type === 'done' && Date.now() - toast.createdAt >= durationMs) {
      animateDismiss(id)
    }
  }, [animateDismiss])

  // ── Group toasts by type ──────────────────────────────────────────────

  if (toasts.length === 0) return null

  const doneToasts = toasts.filter((t) => t.type === 'done')
  const errorToasts = toasts.filter((t) => t.type === 'error')
  const waitingToasts = toasts.filter((t) => t.type === 'waiting_input')

  return createPortal(
    <div className="toast-container" data-toast-size={toastSize} data-toast-position={toastPosition} style={{ '--toast-duration': `${toastDuration}s` } as React.CSSProperties}>
      {/* Done toasts: always individual */}
      {doneToasts.map((toast) => (
        <div
          key={toast.id}
          onMouseEnter={() => handleMouseEnter(toast.id)}
          onMouseLeave={() => handleMouseLeave(toast.id)}
        >
          <Toast
            toast={toast}
            isDismissing={dismissing.has(toast.id)}
            isHovered={hoveredRef.current.has(toast.id)}
            onDismiss={(e) => handleDismiss(toast.id, e)}
            onClick={() => handleClick(toast)}
          />
        </div>
      ))}

      {/* Error toasts: group when 2+ */}
      {errorToasts.length === 1 && (
        <Toast
          toast={errorToasts[0]}
          isDismissing={dismissing.has(errorToasts[0].id)}
          isHovered={false}
          onDismiss={(e) => handleDismiss(errorToasts[0].id, e)}
          onClick={() => handleClick(errorToasts[0])}
        />
      )}
      {errorToasts.length >= 2 && (
        <GroupedToast
          type="error"
          toasts={errorToasts}
          isDismissing={false}
          onDismissAll={(e) => handleDismissType('error', e)}
          onDismissOne={(id, e) => handleDismiss(id, e)}
          onClickSession={handleClick}
        />
      )}

      {/* Waiting toasts: group when 2+ */}
      {waitingToasts.length === 1 && (
        <Toast
          toast={waitingToasts[0]}
          isDismissing={dismissing.has(waitingToasts[0].id)}
          isHovered={false}
          onDismiss={(e) => handleDismiss(waitingToasts[0].id, e)}
          onClick={() => handleClick(waitingToasts[0])}
        />
      )}
      {waitingToasts.length >= 2 && (
        <GroupedToast
          type="waiting_input"
          toasts={waitingToasts}
          isDismissing={false}
          onDismissAll={(e) => handleDismissType('waiting_input', e)}
          onDismissOne={(id, e) => handleDismiss(id, e)}
          onClickSession={handleClick}
        />
      )}
    </div>,
    document.body
  )
}
