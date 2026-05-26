import { useCallback, type DragEvent } from 'react'
import { FILE_PATH_MIME } from '@/lib/fileDragMime'
import { shellEscapePath } from '@/lib/shellEscapePath'
import * as ipc from '@/lib/ipc'

export interface TerminalFileDropTarget {
  /** Active PTY id, or null if not yet spawned. */
  ptyId: string | null
  /** Focus the terminal after dropping. */
  focus: () => void
}

/** Returns true when the drag payload is something we can handle. */
function isAcceptable(types: readonly string[]): boolean {
  return types.includes(FILE_PATH_MIME) || types.includes('Files')
}

/**
 * Returns drag event handlers that accept file-path drops from the FileTree
 * or native OS file drops (e.g. Finder) and paste the shell-escaped path(s)
 * into the terminal's PTY.
 *
 * Usage: spread the returned handlers onto the terminal container div.
 */
export function useTerminalFileDrop(getTarget: () => TerminalFileDropTarget | null) {
  const onDragOver = useCallback((e: DragEvent) => {
    if (e.dataTransfer && isAcceptable(e.dataTransfer.types)) {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
    }
  }, [])

  const onDragEnter = useCallback((e: DragEvent) => {
    if (e.dataTransfer && isAcceptable(e.dataTransfer.types)) {
      e.currentTarget.classList.add('terminal-drop-target')
    }
  }, [])

  const onDragLeave = useCallback((e: DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      e.currentTarget.classList.remove('terminal-drop-target')
    }
  }, [])

  const onDrop = useCallback((e: DragEvent) => {
    e.currentTarget.classList.remove('terminal-drop-target')
    if (!e.dataTransfer) return

    // Internal FileTree drag (priority)
    const filePath = e.dataTransfer.getData(FILE_PATH_MIME)
    if (filePath) {
      e.preventDefault()
      e.stopPropagation()
      const target = getTarget()
      if (!target?.ptyId) {
        console.warn('[useTerminalFileDrop] drop ignored: PTY not ready')
        return
      }
      ipc.pty.write(target.ptyId, shellEscapePath(filePath) + ' ')
      target.focus()
      return
    }

    // Native OS file drop (Finder, desktop, etc.)
    const { files } = e.dataTransfer
    if (files.length > 0) {
      // Prevent default before filtering to avoid browser navigation on drop
      e.preventDefault()
      e.stopPropagation()
      const paths = Array.from(files)
        .map((f) => ipc.drag.getPathForFile(f))
        .filter(Boolean)
      if (paths.length === 0) return
      const target = getTarget()
      if (!target?.ptyId) {
        console.warn('[useTerminalFileDrop] drop ignored: PTY not ready')
        return
      }
      ipc.pty.write(target.ptyId, paths.map(shellEscapePath).join(' ') + ' ')
      target.focus()
    }
  }, [getTarget])

  return { onDragOver, onDragEnter, onDragLeave, onDrop }
}
