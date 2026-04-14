import { useRef, useState, useCallback } from 'react'

interface UseTabReorderReturn<T> {
  /** The key of the tab currently being dragged */
  dragKey: T | null
  /** The key of the tab being hovered over as a drop target */
  overKey: T | null
  /** Attach to each tab element's onDragStart */
  onDragStart: (key: T) => (e: React.DragEvent) => void
  /** Attach to each tab element's onDragOver */
  onDragOver: (key: T) => (e: React.DragEvent) => void
  /** Attach to each tab element's onDragLeave */
  onDragLeave: () => void
  /** Attach to each tab element's onDrop */
  onDrop: (key: T) => (e: React.DragEvent) => void
  /** Attach to each tab element's onDragEnd */
  onDragEnd: () => void
}

/**
 * Lightweight hook for HTML5 tab drag-reorder.
 *
 * @param keys   Ordered array of unique tab keys (string | number)
 * @param onReorder  Called with (fromIndex, toIndex) when a drop completes
 */
export function useTabReorder<T extends string | number>(
  keys: T[],
  onReorder: (fromIndex: number, toIndex: number) => void
): UseTabReorderReturn<T> {
  const [dragKey, setDragKey] = useState<T | null>(null)
  const [overKey, setOverKey] = useState<T | null>(null)
  const dragKeyRef = useRef<T | null>(null)

  const onDragStart = useCallback(
    (key: T) => (e: React.DragEvent) => {
      dragKeyRef.current = key
      setDragKey(key)
      // Minimal data transfer so the browser allows the drag
      e.dataTransfer.effectAllowed = 'move'
      e.dataTransfer.setData('text/plain', String(key))
      // Use a cloned ghost image pinned to the tab's vertical center
      // so the ghost can only visually shift horizontally, not vertically.
      if (e.currentTarget instanceof HTMLElement) {
        const el = e.currentTarget
        const clone = el.cloneNode(true) as HTMLElement
        clone.style.position = 'fixed'
        clone.style.top = '-1000px'
        clone.style.left = '-1000px'
        clone.style.width = `${el.offsetWidth}px`
        clone.style.height = `${el.offsetHeight}px`
        clone.style.pointerEvents = 'none'
        document.body.appendChild(clone)
        e.dataTransfer.setDragImage(clone, e.nativeEvent.offsetX, el.offsetHeight / 2)
        // Clean up the off-screen clone after the browser captures it
        requestAnimationFrame(() => document.body.removeChild(clone))
      }
    },
    []
  )

  const onDragOver = useCallback(
    (key: T) => (e: React.DragEvent) => {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      setOverKey(key)
    },
    []
  )

  const onDragLeave = useCallback(() => {
    setOverKey(null)
  }, [])

  const onDrop = useCallback(
    (key: T) => (e: React.DragEvent) => {
      e.preventDefault()
      const fromKey = dragKeyRef.current
      if (fromKey == null || fromKey === key) {
        setDragKey(null)
        setOverKey(null)
        dragKeyRef.current = null
        return
      }
      const fromIndex = keys.indexOf(fromKey)
      const toIndex = keys.indexOf(key)
      if (fromIndex !== -1 && toIndex !== -1) {
        onReorder(fromIndex, toIndex)
      }
      setDragKey(null)
      setOverKey(null)
      dragKeyRef.current = null
    },
    [keys, onReorder]
  )

  const onDragEnd = useCallback(() => {
    setDragKey(null)
    setOverKey(null)
    dragKeyRef.current = null
  }, [])

  return { dragKey, overKey, onDragStart, onDragOver, onDragLeave, onDrop, onDragEnd }
}
