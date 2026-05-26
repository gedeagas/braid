import { useEffect, type RefObject } from 'react'
import { shellEscapePath } from '@/lib/shellEscapePath'
import * as ipc from '@/lib/ipc'
import type { TerminalFileDropTarget } from './useTerminalFileDrop'

/**
 * Intercepts paste events on the terminal container (capture phase) when
 * the clipboard contains an image but no text. Saves the image as a temp
 * PNG via IPC and writes the shell-escaped path into the PTY.
 *
 * Text pastes are left untouched so xterm handles them normally.
 */
export function useTerminalClipboardPaste(
  containerRef: RefObject<HTMLElement | null>,
  getTarget: () => TerminalFileDropTarget | null,
) {
  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const handler = async (e: ClipboardEvent) => {
      const cd = e.clipboardData
      if (!cd) return

      // If the clipboard has text, let xterm handle the paste natively
      if (cd.getData('text/plain')) return

      // Check for image items
      const imageItem = Array.from(cd.items).find((item) => item.type.startsWith('image/'))
      if (!imageItem) return

      e.preventDefault()
      e.stopPropagation()

      const target = getTarget()
      if (!target?.ptyId) {
        console.warn('[useTerminalClipboardPaste] paste ignored: PTY not ready')
        return
      }

      const tempPath = await ipc.clipboard.saveImageAsTempFile()
      if (!tempPath) return
      ipc.pty.write(target.ptyId, shellEscapePath(tempPath) + ' ')
      target.focus()
    }

    el.addEventListener('paste', handler, true)
    return () => el.removeEventListener('paste', handler, true)
  }, [containerRef, getTarget])
}
