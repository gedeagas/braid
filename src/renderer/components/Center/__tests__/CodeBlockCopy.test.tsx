import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React from 'react'
import { render, screen, cleanup } from '@testing-library/react'
import { CodeBlockWithCopy } from '../CodeBlockCopy'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}))

const mockHandleCopy = vi.fn()
let mockCopied = false

vi.mock('@/hooks/useCopyToClipboard', () => ({
  useCopyToClipboard: vi.fn((text: string) => {
    // Store the text arg so tests can inspect it
    ;(useCopyToClipboardSpy as any).__lastText = text
    return { copied: mockCopied, handleCopy: mockHandleCopy }
  }),
}))

// Re-import after mock so we can inspect calls
import { useCopyToClipboard as useCopyToClipboardSpy } from '@/hooks/useCopyToClipboard'

beforeEach(() => {
  mockCopied = false
  mockHandleCopy.mockClear()
  ;(useCopyToClipboardSpy as any).__lastText = undefined
})

afterEach(() => {
  cleanup()
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CodeBlockWithCopy', () => {
  it('renders a pre element with children', () => {
    render(<CodeBlockWithCopy>console.log("hi")</CodeBlockWithCopy>)

    const pre = screen.getByText('console.log("hi")')
    expect(pre.tagName).toBe('PRE')
  })

  it('renders a copy button with "copy" title by default', () => {
    render(<CodeBlockWithCopy>code</CodeBlockWithCopy>)

    const btn = screen.getByRole('button')
    expect(btn).toBeDefined()
    expect(btn.title).toBe('copy')
  })

  it('applies --copied class and shows "copied" title when copied is true', () => {
    mockCopied = true
    render(<CodeBlockWithCopy>code</CodeBlockWithCopy>)

    const btn = screen.getByRole('button')
    expect(btn.className).toContain('code-block-copy-btn--copied')
    expect(btn.title).toBe('copied')
  })

  it('does not apply --copied class when copied is false', () => {
    mockCopied = false
    render(<CodeBlockWithCopy>code</CodeBlockWithCopy>)

    const btn = screen.getByRole('button')
    expect(btn.className).not.toContain('code-block-copy-btn--copied')
  })

  it('wraps pre in a .code-block-wrapper div', () => {
    const { container } = render(<CodeBlockWithCopy>code</CodeBlockWithCopy>)

    const wrapper = container.firstElementChild
    expect(wrapper?.className).toBe('code-block-wrapper')
    expect(wrapper?.querySelector('pre')).toBeTruthy()
    expect(wrapper?.querySelector('button')).toBeTruthy()
  })

  it('passes extra props to the pre element', () => {
    render(<CodeBlockWithCopy className="language-ts" data-testid="my-pre">x</CodeBlockWithCopy>)

    const pre = screen.getByTestId('my-pre')
    expect(pre.className).toBe('language-ts')
  })

  // ---------------------------------------------------------------------------
  // extractText (tested indirectly through useCopyToClipboard call)
  // ---------------------------------------------------------------------------

  it('extracts plain string children', () => {
    render(<CodeBlockWithCopy>hello world</CodeBlockWithCopy>)
    expect((useCopyToClipboardSpy as any).__lastText).toBe('hello world')
  })

  it('extracts text from nested elements', () => {
    render(
      <CodeBlockWithCopy>
        <code>
          <span>const</span> x = <span>42</span>
        </code>
      </CodeBlockWithCopy>,
    )
    expect((useCopyToClipboardSpy as any).__lastText).toBe('const x = 42')
  })

  it('extracts number children', () => {
    render(<CodeBlockWithCopy>{123}</CodeBlockWithCopy>)
    expect((useCopyToClipboardSpy as any).__lastText).toBe('123')
  })

  it('handles null and boolean children gracefully', () => {
    render(
      <CodeBlockWithCopy>
        {null}
        {true}
        {false}
        text
      </CodeBlockWithCopy>,
    )
    expect((useCopyToClipboardSpy as any).__lastText).toBe('text')
  })

  it('concatenates array children', () => {
    render(
      <CodeBlockWithCopy>
        {'line1'}
        {'\n'}
        {'line2'}
      </CodeBlockWithCopy>,
    )
    expect((useCopyToClipboardSpy as any).__lastText).toBe('line1\nline2')
  })
})
