import { describe, it, expect, beforeEach, vi } from 'vitest'
import { getTerminalTheme } from '../terminal'

const HEX_RE = /^#[0-9a-fA-F]{6}$/

// Simulate CSS custom properties on document.documentElement
beforeEach(() => {
  const vars: Record<string, string> = {
    '--bg-primary': '#0d1117',
    '--text-primary': '#e6edf3',
    '--accent': '#58a6ff',
    '--accent-tint-30': '#58a6ff4d',
    '--term-black': '#0d1117',
    '--term-red': '#f85149',
    '--term-green': '#3fb950',
    '--term-yellow': '#d29922',
    '--term-blue': '#58a6ff',
    '--term-magenta': '#d2a8ff',
    '--term-cyan': '#79c0ff',
    '--term-white': '#e6edf3',
    '--term-bright-black': '#6e7681',
    '--term-bright-red': '#ffa198',
    '--term-bright-green': '#56d364',
    '--term-bright-yellow': '#e3b341',
    '--term-bright-blue': '#79c0ff',
    '--term-bright-magenta': '#d2a8ff',
    '--term-bright-cyan': '#a5d6ff',
    '--term-bright-white': '#f0f6fc'
  }

  // Mock getComputedStyle to return our vars
  const original = window.getComputedStyle
  vi.spyOn(window, 'getComputedStyle').mockImplementation((elt: Element) => {
    if (elt === document.documentElement) {
      return {
        getPropertyValue: (name: string) => vars[name] ?? ''
      } as CSSStyleDeclaration
    }
    return original(elt)
  })
})

describe('getTerminalTheme', () => {
  it('returns an object with all 16 ANSI color fields', () => {
    const theme = getTerminalTheme()
    const fields = [
      'black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white',
      'brightBlack', 'brightRed', 'brightGreen', 'brightYellow',
      'brightBlue', 'brightMagenta', 'brightCyan', 'brightWhite'
    ] as const
    for (const field of fields) {
      expect(theme[field]).toMatch(HEX_RE)
    }
  })

  it('reads --term-* CSS vars for base colors', () => {
    const theme = getTerminalTheme()
    expect(theme.red).toBe('#f85149')
    expect(theme.green).toBe('#3fb950')
    expect(theme.magenta).toBe('#d2a8ff')
    expect(theme.cyan).toBe('#79c0ff')
  })

  it('reads --term-bright-* CSS vars for bright colors', () => {
    const theme = getTerminalTheme()
    expect(theme.brightRed).toBe('#ffa198')
    expect(theme.brightGreen).toBe('#56d364')
    expect(theme.brightMagenta).toBe('#d2a8ff')
    expect(theme.brightCyan).toBe('#a5d6ff')
  })

  it('includes background, foreground, and cursor', () => {
    const theme = getTerminalTheme()
    expect(theme.background).toBe('#0d1117')
    expect(theme.foreground).toBe('#e6edf3')
    expect(theme.cursor).toBe('#58a6ff')
  })

  it('includes selectionBackground', () => {
    const theme = getTerminalTheme()
    expect(theme.selectionBackground).toBeTruthy()
  })
})
