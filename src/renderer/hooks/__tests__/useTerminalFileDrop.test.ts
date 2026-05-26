import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useTerminalFileDrop } from '../useTerminalFileDrop'
import { FILE_PATH_MIME } from '@/lib/fileDragMime'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockPtyWrite = vi.fn()

vi.mock('@/lib/ipc', () => ({
  pty: { write: (...args: unknown[]) => mockPtyWrite(...args) },
}))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTarget(ptyId: string | null = 'pty-1') {
  return { ptyId, focus: vi.fn() }
}

type DragEventInit = {
  types?: string[]
  getData?: (type: string) => string
  files?: Array<{ path: string }>
}

function makeDragEvent(init: DragEventInit = {}) {
  const el = document.createElement('div')
  return {
    dataTransfer: {
      types: init.types ?? [],
      dropEffect: '' as string,
      getData: init.getData ?? (() => ''),
      files: init.files ?? [],
    },
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    currentTarget: el,
    relatedTarget: null,
  } as unknown as React.DragEvent
}

function makeDragEventNoTransfer() {
  const el = document.createElement('div')
  return {
    dataTransfer: null,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    currentTarget: el,
  } as unknown as React.DragEvent
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()
})

describe('useTerminalFileDrop', () => {
  describe('onDragOver', () => {
    it('calls preventDefault and sets dropEffect for FILE_PATH_MIME', () => {
      const target = makeTarget()
      const { result } = renderHook(() => useTerminalFileDrop(() => target))
      const event = makeDragEvent({ types: [FILE_PATH_MIME] })

      result.current.onDragOver(event)

      expect(event.preventDefault).toHaveBeenCalled()
      expect(event.dataTransfer!.dropEffect).toBe('copy')
    })

    it('calls preventDefault for native Files type', () => {
      const target = makeTarget()
      const { result } = renderHook(() => useTerminalFileDrop(() => target))
      const event = makeDragEvent({ types: ['Files'] })

      result.current.onDragOver(event)

      expect(event.preventDefault).toHaveBeenCalled()
    })

    it('does not preventDefault for unrelated drag types', () => {
      const target = makeTarget()
      const { result } = renderHook(() => useTerminalFileDrop(() => target))
      const event = makeDragEvent({ types: ['text/plain'] })

      result.current.onDragOver(event)

      expect(event.preventDefault).not.toHaveBeenCalled()
    })

    it('handles null dataTransfer gracefully', () => {
      const target = makeTarget()
      const { result } = renderHook(() => useTerminalFileDrop(() => target))
      const event = makeDragEventNoTransfer()

      // Should not throw
      result.current.onDragOver(event)
      expect(event.preventDefault).not.toHaveBeenCalled()
    })
  })

  describe('onDragEnter', () => {
    it('adds terminal-drop-target class for acceptable types', () => {
      const target = makeTarget()
      const { result } = renderHook(() => useTerminalFileDrop(() => target))
      const event = makeDragEvent({ types: [FILE_PATH_MIME] })

      result.current.onDragEnter(event)

      expect(event.currentTarget.classList.contains('terminal-drop-target')).toBe(true)
    })

    it('handles null dataTransfer gracefully', () => {
      const target = makeTarget()
      const { result } = renderHook(() => useTerminalFileDrop(() => target))
      const event = makeDragEventNoTransfer()

      result.current.onDragEnter(event)
      // Should not throw
    })
  })

  describe('onDrop', () => {
    it('writes shell-escaped internal file path to PTY', () => {
      const target = makeTarget('pty-1')
      const { result } = renderHook(() => useTerminalFileDrop(() => target))
      const event = makeDragEvent({
        types: [FILE_PATH_MIME],
        getData: (type: string) => type === FILE_PATH_MIME ? '/Users/me/my file.ts' : '',
      })

      result.current.onDrop(event)

      expect(event.preventDefault).toHaveBeenCalled()
      expect(event.stopPropagation).toHaveBeenCalled()
      expect(mockPtyWrite).toHaveBeenCalledWith('pty-1', "'/Users/me/my file.ts' ")
      expect(target.focus).toHaveBeenCalled()
    })

    it('writes native file paths to PTY', () => {
      const target = makeTarget('pty-2')
      const { result } = renderHook(() => useTerminalFileDrop(() => target))
      const event = makeDragEvent({
        types: ['Files'],
        files: [{ path: '/tmp/a.txt' }, { path: '/tmp/b.txt' }],
      })

      result.current.onDrop(event)

      expect(event.preventDefault).toHaveBeenCalled()
      expect(mockPtyWrite).toHaveBeenCalledWith('pty-2', '/tmp/a.txt /tmp/b.txt ')
      expect(target.focus).toHaveBeenCalled()
    })

    it('calls preventDefault even when native files have no .path', () => {
      const target = makeTarget('pty-1')
      const { result } = renderHook(() => useTerminalFileDrop(() => target))
      const event = makeDragEvent({
        types: ['Files'],
        files: [{ path: '' }],
      })

      result.current.onDrop(event)

      // preventDefault should still be called to prevent browser navigation
      expect(event.preventDefault).toHaveBeenCalled()
      expect(mockPtyWrite).not.toHaveBeenCalled()
    })

    it('does not write when PTY is not ready', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const target = makeTarget(null)
      const { result } = renderHook(() => useTerminalFileDrop(() => target))
      const event = makeDragEvent({
        types: [FILE_PATH_MIME],
        getData: (type: string) => type === FILE_PATH_MIME ? '/tmp/file.ts' : '',
      })

      result.current.onDrop(event)

      expect(mockPtyWrite).not.toHaveBeenCalled()
      expect(warnSpy).toHaveBeenCalled()
    })

    it('handles null dataTransfer gracefully', () => {
      const target = makeTarget()
      const { result } = renderHook(() => useTerminalFileDrop(() => target))
      const event = makeDragEventNoTransfer()

      result.current.onDrop(event)

      expect(mockPtyWrite).not.toHaveBeenCalled()
    })

    it('prefers internal FileTree drag over native Files', () => {
      const target = makeTarget('pty-1')
      const { result } = renderHook(() => useTerminalFileDrop(() => target))
      const event = makeDragEvent({
        types: [FILE_PATH_MIME, 'Files'],
        getData: (type: string) => type === FILE_PATH_MIME ? '/src/index.ts' : '',
        files: [{ path: '/other/file.ts' }],
      })

      result.current.onDrop(event)

      // Should use the internal path, not the native file
      expect(mockPtyWrite).toHaveBeenCalledWith('pty-1', '/src/index.ts ')
    })
  })
})
