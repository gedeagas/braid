import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { shell } from '@/lib/ipc'
import { TaskMarkdown } from '../TaskMarkdown'

vi.mock('@/lib/ipc', () => ({
  shell: { openExternal: vi.fn() },
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('TaskMarkdown', () => {
  it('renders safe GitHub HTML blocks', () => {
    const body = [
      '<details open>',
      '<summary>More <kbd>Cmd</kbd></summary>',
      '<p><mark>Important</mark> context</p>',
      '<dl><dt>Term</dt><dd>Definition</dd></dl>',
      '</details>',
      '',
      '<kbd>Esc</kbd>',
      '',
      '<table><thead><tr><th align="right">State</th></tr></thead><tbody><tr><td><a href="/owner/repo/issues/1">Issue</a></td></tr></tbody></table>',
    ].join('\n')

    const { container } = render(<TaskMarkdown body={body} baseUrl="https://github.com/owner/repo/pull/10" />)

    expect(container.querySelector('details')?.open).toBe(true)
    expect(container.querySelector('summary')?.textContent).toBe('More Cmd')
    expect(container.querySelector('kbd')?.textContent).toBe('Cmd')
    expect(Array.from(container.querySelectorAll('kbd')).map(kbd => kbd.textContent)).toEqual(['Cmd', 'Esc'])
    expect(container.querySelector('mark')?.textContent).toBe('Important')
    expect(container.querySelector('dt')?.textContent).toBe('Term')
    expect(container.querySelector('dd')?.textContent).toBe('Definition')
    expect(container.querySelector('.task-detail-markdown-table')).toBeTruthy()
    expect(container.querySelector('th')?.style.textAlign).toBe('right')

    fireEvent.click(screen.getByRole('link', { name: 'Issue' }))
    expect(shell.openExternal).toHaveBeenCalledWith('https://github.com/owner/repo/issues/1')
  })

  it('drops unsafe raw HTML tags and attributes', () => {
    const body = [
      '<div onclick="alert(1)">',
      '<script>alert(1)</script>',
      '<iframe src="https://example.com"></iframe>',
      '<img src="https://example.com/pixel.png" alt="pixel">',
      '<a href="javascript:alert(1)">Unsafe link</a>',
      '<span>Safe text</span>',
      '</div>',
    ].join('\n')

    const { container } = render(<TaskMarkdown body={body} />)

    expect(screen.getByText('Safe text')).toBeDefined()
    expect(screen.getByText('Unsafe link').closest('a')?.getAttribute('href')).toBeNull()
    expect(container.querySelector('script')).toBeNull()
    expect(container.querySelector('iframe')).toBeNull()
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('[onclick]')).toBeNull()
  })
})
