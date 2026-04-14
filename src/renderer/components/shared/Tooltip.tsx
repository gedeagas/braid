import { useReducer, useRef, useCallback, useEffect, useLayoutEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

interface TooltipProps {
  content: string
  shortcut?: string
  position?: 'top' | 'bottom' | 'left' | 'right'
  delay?: number
  children: ReactNode
  disabled?: boolean
  maxWidth?: number
}

type TooltipPos = 'top' | 'bottom' | 'left' | 'right'

function anchorCoords(rect: DOMRect, pos: TooltipPos): { top: number; left: number } {
  switch (pos) {
    case 'top':    return { top: rect.top,                    left: rect.left + rect.width / 2 }
    case 'bottom': return { top: rect.bottom,                 left: rect.left + rect.width / 2 }
    case 'left':   return { top: rect.top + rect.height / 2,  left: rect.left }
    case 'right':  return { top: rect.top + rect.height / 2,  left: rect.right }
  }
}

type TooltipState = { visible: boolean; pos: TooltipPos; coords: { top: number; left: number } }
type TooltipAction =
  | { type: 'SHOW'; pos: TooltipPos; coords: { top: number; left: number } }
  | { type: 'HIDE' }
  | { type: 'FLIP'; pos: TooltipPos; coords: { top: number; left: number } }

function tooltipReducer(state: TooltipState, action: TooltipAction): TooltipState {
  switch (action.type) {
    case 'SHOW': return { visible: true, pos: action.pos, coords: action.coords }
    case 'HIDE': return { ...state, visible: false }
    case 'FLIP': return { ...state, pos: action.pos, coords: action.coords }
  }
}

export function Tooltip({
  content,
  shortcut,
  position = 'top',
  delay = 400,
  children,
  disabled,
  maxWidth = 240
}: TooltipProps) {
  const [state, dispatch] = useReducer(tooltipReducer, { visible: false, pos: position, coords: { top: 0, left: 0 } })
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const tooltipRef = useRef<HTMLSpanElement>(null)
  const wrapperRef = useRef<HTMLSpanElement>(null)

  const show = useCallback(() => {
    timerRef.current = setTimeout(() => {
      if (!wrapperRef.current) return
      const rect = wrapperRef.current.getBoundingClientRect()
      dispatch({ type: 'SHOW', pos: position, coords: anchorCoords(rect, position) })
    }, delay)
  }, [delay, position])

  const hide = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = null
    dispatch({ type: 'HIDE' })
  }, [])

  // After render, flip if tooltip overflows viewport
  useLayoutEffect(() => {
    if (!state.visible || !tooltipRef.current || !wrapperRef.current) return
    const tRect = tooltipRef.current.getBoundingClientRect()
    const aRect = wrapperRef.current.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight

    let newPos: TooltipPos | null = null
    if (position === 'top' && tRect.top < 4) newPos = 'bottom'
    else if (position === 'bottom' && tRect.bottom > vh - 4) newPos = 'top'
    else if (position === 'left' && tRect.left < 4) newPos = 'right'
    else if (position === 'right' && tRect.right > vw - 4) newPos = 'left'

    if (newPos) {
      dispatch({ type: 'FLIP', pos: newPos, coords: anchorCoords(aRect, newPos) })
    }
  }, [state.visible, position])

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  if (disabled) return <>{children}</>

  return (
    <span
      ref={wrapperRef}
      className="tooltip-wrapper"
      onMouseEnter={show}
      onMouseLeave={hide}
    >
      {children}
      {state.visible &&
        createPortal(
          <span
            ref={tooltipRef}
            className={`tooltip tooltip--${state.pos} tooltip--portal`}
            style={{ maxWidth, top: state.coords.top, left: state.coords.left }}
            role="tooltip"
          >
            {content}
            {shortcut && <kbd className="tooltip-kbd">{shortcut}</kbd>}
          </span>,
          document.body
        )}
    </span>
  )
}
