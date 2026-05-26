import { useCallback, useRef } from 'react'
import { shellEscapePath } from '@/lib/shellEscapePath'
import * as ipc from '@/lib/ipc'
import type { TerminalFileDropTarget } from './useTerminalFileDrop'

/** Elements where paste should be handled by the element itself, not by us. */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA') return true
  if (target.isContentEditable) return true
  return false
}

/**
 * Returns a callback ref that attaches a capture-phase paste listener to the
 * terminal container. When the clipboard contains an image (but no text), the
 * image is saved as a temp PNG via IPC and the shell-escaped path is written
 * into the PTY.
 *
 * Text pastes are left untouched so xterm handles them normally.
 *
 * Uses a callback ref instead of RefObject + useEffect so the listener is
 * correctly attached/detached when the element is conditionally mounted
 * (e.g. collapsed terminal panels).
 */
export function useTerminalClipboardPaste(
  getTarget: () => TerminalFileDropTarget | null,
) {
  const getTargetRef = useRef(getTarget)
  getTargetRef.current = getTarget

  const cleanupRef = useRef<(() => void) | null>(null)

  const refCallback = useCallback((el: HTMLElement | null) => {
    if (cleanupRef.current) {
      cleanupRef.current()
      cleanupRef.current = null
    }

    if (!el) return

    const handler = async (e: ClipboardEvent) => {
      // Don't intercept paste in search bars or other editable elements
      if (isEditableTarget(e.target)) return

      const cd = e.clipboardData
      if (!cd) return

      // If the clipboard has text, let xterm handle the paste natively
      if (cd.getData('text/plain')) return

      // Check for image items
      const imageItem = Array.from(cd.items).find((item) => item.type.startsWith('image/'))
      if (!imageItem) return

      e.preventDefault()
      e.stopPropagation()

      const target = getTargetRef.current()
      if (!target?.ptyId) {
        console.warn('[useTerminalClipboardPaste] paste ignored: PTY not ready')
        return
      }

      try {
        const tempPath = await ipc.clipboard.saveImageAsTempFile()
        if (!tempPath) return
        ipc.pty.write(target.ptyId, shellEscapePath(tempPath) + ' ')
        target.focus()
      } catch (err) {
        console.error('[useTerminalClipboardPaste] Failed to save clipboard image:', err)
      }
    }

    el.addEventListener('paste', handler, true)
    cleanupRef.current = () => el.removeEventListener('paste', handler, true)
  }, [])

  return refCallback
}
