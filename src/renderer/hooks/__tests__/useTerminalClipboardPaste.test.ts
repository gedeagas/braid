import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useTerminalClipboardPaste } from '../useTerminalClipboardPaste'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockSaveImage = vi.fn()
const mockPtyWrite = vi.fn()

vi.mock('@/lib/ipc', () => ({
  clipboard: { saveImageAsTempFile: (...args: unknown[]) => mockSaveImage(...args) },
  pty: { write: (...args: unknown[]) => mockPtyWrite(...args) },
}))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeClipboardEvent(opts: {
  text?: string
  hasImage?: boolean
  target?: EventTarget | null
}): ClipboardEvent {
  const items: DataTransferItem[] = []
  if (opts.hasImage) {
    items.push({ type: 'image/png' } as DataTransferItem)
  }
  const clipboardData = {
    getData: (type: string) => (type === 'text/plain' ? (opts.text ?? '') : ''),
    items,
  } as unknown as DataTransferClipboardData
  const event = new Event('paste', { bubbles: true }) as ClipboardEvent
  Object.defineProperty(event, 'clipboardData', { value: clipboardData })
  if (opts.target) {
    Object.defineProperty(event, 'target', { value: opts.target })
  }
  // Spy on preventDefault/stopPropagation
  vi.spyOn(event, 'preventDefault')
  vi.spyOn(event, 'stopPropagation')
  return event
}

type DataTransferClipboardData = Pick<DataTransfer, 'getData'> & { items: DataTransferItem[] }

function makeTarget(ptyId: string | null = 'pty-1') {
  return { ptyId, focus: vi.fn() }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useTerminalClipboardPaste', () => {
  it('attaches a paste listener when callback ref receives an element', () => {
    const el = document.createElement('div')
    const spy = vi.spyOn(el, 'addEventListener')
    const { result } = renderHook(() => useTerminalClipboardPaste(() => makeTarget()))

    result.current(el)

    expect(spy).toHaveBeenCalledWith('paste', expect.any(Function), true)
  })

  it('removes the paste listener when callback ref receives null', () => {
    const el = document.createElement('div')
    const spy = vi.spyOn(el, 'removeEventListener')
    const { result } = renderHook(() => useTerminalClipboardPaste(() => makeTarget()))

    result.current(el)
    result.current(null)

    expect(spy).toHaveBeenCalledWith('paste', expect.any(Function), true)
  })

  it('cleans up old listener when element changes', () => {
    const el1 = document.createElement('div')
    const el2 = document.createElement('div')
    const removeSpy = vi.spyOn(el1, 'removeEventListener')
    const addSpy = vi.spyOn(el2, 'addEventListener')
    const { result } = renderHook(() => useTerminalClipboardPaste(() => makeTarget()))

    result.current(el1)
    result.current(el2)

    expect(removeSpy).toHaveBeenCalledWith('paste', expect.any(Function), true)
    expect(addSpy).toHaveBeenCalledWith('paste', expect.any(Function), true)
  })

  it('does not intercept text-only paste', async () => {
    const el = document.createElement('div')
    const { result } = renderHook(() => useTerminalClipboardPaste(() => makeTarget()))
    result.current(el)

    const event = makeClipboardEvent({ text: 'hello world' })
    el.dispatchEvent(event)
    await vi.waitFor(() => {})

    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(mockSaveImage).not.toHaveBeenCalled()
  })

  it('intercepts image-only paste and writes path to PTY', async () => {
    const target = makeTarget('pty-42')
    mockSaveImage.mockResolvedValue('/tmp/braid-paste-123.png')

    const el = document.createElement('div')
    const { result } = renderHook(() => useTerminalClipboardPaste(() => target))
    result.current(el)

    const event = makeClipboardEvent({ hasImage: true })
    el.dispatchEvent(event)
    await vi.waitFor(() => expect(mockSaveImage).toHaveBeenCalled())

    expect(event.preventDefault).toHaveBeenCalled()
    expect(event.stopPropagation).toHaveBeenCalled()
    expect(mockPtyWrite).toHaveBeenCalledWith('pty-42', '/tmp/braid-paste-123.png ')
    expect(target.focus).toHaveBeenCalled()
  })

  it('does not write to PTY when PTY is not ready', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const el = document.createElement('div')
    const { result } = renderHook(() => useTerminalClipboardPaste(() => makeTarget(null)))
    result.current(el)

    const event = makeClipboardEvent({ hasImage: true })
    el.dispatchEvent(event)
    await vi.waitFor(() => expect(warnSpy).toHaveBeenCalled())

    expect(mockPtyWrite).not.toHaveBeenCalled()
  })

  it('does not intercept paste when target is an input element', async () => {
    const el = document.createElement('div')
    const input = document.createElement('input')
    el.appendChild(input)
    const { result } = renderHook(() => useTerminalClipboardPaste(() => makeTarget()))
    result.current(el)

    const event = makeClipboardEvent({ hasImage: true, target: input })
    el.dispatchEvent(event)
    await vi.waitFor(() => {})

    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(mockSaveImage).not.toHaveBeenCalled()
  })

  it('does not intercept paste when target is a textarea', async () => {
    const el = document.createElement('div')
    const textarea = document.createElement('textarea')
    el.appendChild(textarea)
    const { result } = renderHook(() => useTerminalClipboardPaste(() => makeTarget()))
    result.current(el)

    const event = makeClipboardEvent({ hasImage: true, target: textarea })
    el.dispatchEvent(event)
    await vi.waitFor(() => {})

    expect(mockSaveImage).not.toHaveBeenCalled()
  })

  it('does not intercept paste when target is contenteditable', async () => {
    const el = document.createElement('div')
    const editable = document.createElement('div')
    editable.contentEditable = 'true'
    el.appendChild(editable)
    const { result } = renderHook(() => useTerminalClipboardPaste(() => makeTarget()))
    result.current(el)

    const event = makeClipboardEvent({ hasImage: true, target: editable })
    el.dispatchEvent(event)
    await vi.waitFor(() => {})

    expect(mockSaveImage).not.toHaveBeenCalled()
  })

  it('handles IPC failure gracefully', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockSaveImage.mockRejectedValue(new Error('disk full'))

    const el = document.createElement('div')
    const { result } = renderHook(() => useTerminalClipboardPaste(() => makeTarget()))
    result.current(el)

    const event = makeClipboardEvent({ hasImage: true })
    el.dispatchEvent(event)
    await vi.waitFor(() => expect(errorSpy).toHaveBeenCalled())

    expect(mockPtyWrite).not.toHaveBeenCalled()
  })

  it('skips paste when clipboardData has no image items', async () => {
    const el = document.createElement('div')
    const { result } = renderHook(() => useTerminalClipboardPaste(() => makeTarget()))
    result.current(el)

    // No text, no image
    const event = makeClipboardEvent({})
    el.dispatchEvent(event)
    await vi.waitFor(() => {})

    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(mockSaveImage).not.toHaveBeenCalled()
  })

  it('does nothing when saveImageAsTempFile returns null', async () => {
    mockSaveImage.mockResolvedValue(null)

    const target = makeTarget()
    const el = document.createElement('div')
    const { result } = renderHook(() => useTerminalClipboardPaste(() => target))
    result.current(el)

    const event = makeClipboardEvent({ hasImage: true })
    el.dispatchEvent(event)
    await vi.waitFor(() => expect(mockSaveImage).toHaveBeenCalled())

    expect(mockPtyWrite).not.toHaveBeenCalled()
    expect(target.focus).not.toHaveBeenCalled()
  })
})
