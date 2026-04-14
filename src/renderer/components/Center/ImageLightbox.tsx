import { useReducer, useCallback, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

interface Props {
  src: string
  alt: string
  onClose: () => void
}

interface State {
  scale: number
  translateX: number
  translateY: number
  dragging: boolean
  dragStartX: number
  dragStartY: number
  startTranslateX: number
  startTranslateY: number
  hintVisible: boolean
  zoomBadgeVisible: boolean
}

type Action =
  | { type: 'zoom'; delta: number; clientX: number; clientY: number; rect: DOMRect }
  | { type: 'reset' }
  | { type: 'drag_start'; clientX: number; clientY: number }
  | { type: 'drag_move'; clientX: number; clientY: number }
  | { type: 'drag_end' }
  | { type: 'hide_hint' }
  | { type: 'hide_zoom_badge' }

const MIN_SCALE = 0.5
const MAX_SCALE = 8

const initialState: State = {
  scale: 1,
  translateX: 0,
  translateY: 0,
  dragging: false,
  dragStartX: 0,
  dragStartY: 0,
  startTranslateX: 0,
  startTranslateY: 0,
  hintVisible: true,
  zoomBadgeVisible: false
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'zoom': {
      const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, state.scale + action.delta))
      // Zoom toward cursor position
      const ratio = newScale / state.scale
      const imgCenterX = action.rect.width / 2
      const imgCenterY = action.rect.height / 2
      const cursorX = action.clientX - action.rect.left
      const cursorY = action.clientY - action.rect.top
      const offsetX = cursorX - imgCenterX - state.translateX
      const offsetY = cursorY - imgCenterY - state.translateY
      return {
        ...state,
        scale: newScale,
        translateX: state.translateX - offsetX * (ratio - 1),
        translateY: state.translateY - offsetY * (ratio - 1),
        zoomBadgeVisible: true
      }
    }
    case 'reset':
      return { ...initialState, hintVisible: state.hintVisible }
    case 'hide_hint':
      return { ...state, hintVisible: false }
    case 'hide_zoom_badge':
      return { ...state, zoomBadgeVisible: false }
    case 'drag_start':
      return {
        ...state,
        dragging: true,
        dragStartX: action.clientX,
        dragStartY: action.clientY,
        startTranslateX: state.translateX,
        startTranslateY: state.translateY
      }
    case 'drag_move':
      if (!state.dragging) return state
      return {
        ...state,
        translateX: state.startTranslateX + (action.clientX - state.dragStartX),
        translateY: state.startTranslateY + (action.clientY - state.dragStartY)
      }
    case 'drag_end':
      return { ...state, dragging: false }
  }
}

export function ImageLightbox({ src, alt, onClose }: Props) {
  const [state, dispatch] = useReducer(reducer, initialState)
  const containerRef = useRef<HTMLDivElement>(null)

  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      e.stopPropagation()
      const rect = containerRef.current?.getBoundingClientRect()
      if (!rect) return
      const delta = e.deltaY < 0 ? 0.3 : -0.3
      dispatch({ type: 'zoom', delta, clientX: e.clientX, clientY: e.clientY, rect })
    },
    []
  )

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return
    e.stopPropagation()
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    dispatch({ type: 'drag_start', clientX: e.clientX, clientY: e.clientY })
  }, [])

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    dispatch({ type: 'drag_move', clientX: e.clientX, clientY: e.clientY })
  }, [])

  const handlePointerUp = useCallback(() => {
    dispatch({ type: 'drag_end' })
  }, [])

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) onClose()
    },
    [onClose]
  )

  const handleDoubleClick = useCallback(() => {
    dispatch({ type: 'reset' })
  }, [])

  // Close on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Auto-hide hint after 3s
  useEffect(() => {
    const timer = setTimeout(() => dispatch({ type: 'hide_hint' }), 3000)
    return () => clearTimeout(timer)
  }, [])

  // Auto-hide zoom badge after 1s of no zoom activity
  const zoomBadgeTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => {
    if (!state.zoomBadgeVisible) return
    clearTimeout(zoomBadgeTimer.current)
    zoomBadgeTimer.current = setTimeout(() => dispatch({ type: 'hide_zoom_badge' }), 1000)
    return () => clearTimeout(zoomBadgeTimer.current)
  }, [state.zoomBadgeVisible, state.scale])

  const transform = `translate(${state.translateX}px, ${state.translateY}px) scale(${state.scale})`
  const zoomPercent = Math.round(state.scale * 100)

  return createPortal(
    <div className="image-lightbox-root">
      {/* Backdrop + image layer — handles pan/zoom/close-on-backdrop */}
      <div className="image-lightbox-backdrop" onClick={handleBackdropClick}>
        <div
          ref={containerRef}
          className="image-lightbox-container"
          onWheel={handleWheel}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onDoubleClick={handleDoubleClick}
        >
          <img
            src={src}
            alt={alt}
            className="image-lightbox-img"
            style={{ transform }}
            draggable={false}
          />
        </div>
      </div>
      {/* Controls layer — no-drag so Electron doesn't swallow clicks */}
      <div className="image-lightbox-controls">
        <div className={`image-lightbox-zoom-badge ${state.zoomBadgeVisible ? 'visible' : ''}`}>
          {zoomPercent}%
        </div>
        <button className="image-lightbox-close" onClick={onClose} aria-label="Close">
          &times;
        </button>
      </div>
      <div className={`image-lightbox-hint ${state.hintVisible ? 'visible' : ''}`}>
        <span>Scroll to zoom</span>
        <span className="image-lightbox-hint-sep" />
        <span>Drag to pan</span>
        <span className="image-lightbox-hint-sep" />
        <span>Double-click to reset</span>
        <span className="image-lightbox-hint-sep" />
        <span>Esc to close</span>
      </div>
    </div>,
    document.body
  )
}
