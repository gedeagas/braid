import { useCallback, type DragEvent } from 'react'
import { FILE_PATH_MIME } from '@/lib/fileDragMime'
import { shellEscapePath } from '@/lib/shellEscapePath'
import * as ipc from '@/lib/ipc'

interface TerminalFileDropTarget {
  /** Active PTY id, or null if not yet spawned. */
  ptyId: string | null
  /** Focus the terminal after dropping. */
  focus: () => void
}

/**
 * Returns drag event handlers that accept file-path drops from the FileTree
 * and paste the shell-escaped path into the terminal's PTY.
 *
 * Usage: spread the returned handlers onto the terminal container div.
 */
export function useTerminalFileDrop(getTarget: () => TerminalFileDropTarget | null) {
  const onDragOver = useCallback((e: DragEvent) => {
    if (e.dataTransfer.types.includes(FILE_PATH_MIME)) {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
    }
  }, [])

  const onDragEnter = useCallback((e: DragEvent) => {
    if (e.dataTransfer.types.includes(FILE_PATH_MIME)) {
      e.currentTarget.classList.add('terminal-drop-target')
    }
  }, [])

  const onDragLeave = useCallback((e: DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      e.currentTarget.classList.remove('terminal-drop-target')
    }
  }, [])

  const onDrop = useCallback((e: DragEvent) => {
    const filePath = e.dataTransfer.getData(FILE_PATH_MIME)
    if (!filePath) return
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.classList.remove('terminal-drop-target')
    const target = getTarget()
    if (!target?.ptyId) {
      // PTY hasn't spawned yet - write a visible error so the user knows why
      // nothing happened rather than silently swallowing the drop.
      console.warn('[useTerminalFileDrop] drop ignored: PTY not ready')
      return
    }
    ipc.pty.write(target.ptyId, shellEscapePath(filePath) + ' ')
    target.focus()
  }, [getTarget])

  return { onDragOver, onDragEnter, onDragLeave, onDrop }
}
