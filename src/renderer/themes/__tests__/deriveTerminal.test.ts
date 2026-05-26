import { describe, it, expect } from 'vitest'
import { deriveTerminalColors } from '../deriveTerminal'
import type { ThemePalette } from '../palettes'

const HEX_RE = /^#[0-9a-fA-F]{6}$/

const darkPalette: ThemePalette = {
  id: 'test-dark',
  name: 'Test Dark',
  type: 'dark',
  source: 'custom',
  colors: {
    bgPrimary: '#1e1e1e',
    bgSecondary: '#252526',
    bgTertiary: '#2d2d2d',
    bgHover: '#3a3a3a',
    border: '#404040',
    textPrimary: '#d4d4d4',
    textSecondary: '#9a9a9a',
    textMuted: '#666666',
    accent: '#569cd6',
    accentHover: '#6bb3f0',
    green: '#6a9955',
    red: '#f44747',
    amber: '#dcdcaa',
    olive: '#808080',
    hlBase: '#d4d4d4',
    hlComment: '#6a9955',
    hlKeyword: '#c586c0',
    hlAttrName: '#9cdcfe',
    hlString: '#ce9178',
    hlTitle: '#dcdcaa',
    hlType: '#4ec9b0',
    hlNumber: '#b5cea8',
    hlMeta: '#569cd6',
    hlVariable: '#9cdcfe',
    hlTag: '#569cd6',
    hlAttr: '#9cdcfe'
  }
}

const lightPalette: ThemePalette = {
  ...darkPalette,
  id: 'test-light',
  name: 'Test Light',
  type: 'light',
  colors: {
    ...darkPalette.colors,
    bgPrimary: '#ffffff',
    textPrimary: '#333333',
    textMuted: '#aaaaaa',
    accent: '#0969da',
    hlTitle: '#8250df',
    hlMeta: '#0550ae'
  }
}

const TERMINAL_FIELDS = [
  'black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white',
  'brightBlack', 'brightRed', 'brightGreen', 'brightYellow',
  'brightBlue', 'brightMagenta', 'brightCyan', 'brightWhite'
] as const

describe('deriveTerminalColors', () => {
  it('produces 16 valid hex colors for a dark palette', () => {
    const result = deriveTerminalColors(darkPalette)
    for (const field of TERMINAL_FIELDS) {
      expect(result[field]).toMatch(HEX_RE)
    }
  })

  it('produces 16 valid hex colors for a light palette', () => {
    const result = deriveTerminalColors(lightPalette)
    for (const field of TERMINAL_FIELDS) {
      expect(result[field]).toMatch(HEX_RE)
    }
  })

  it('maps palette.red to terminal red', () => {
    const result = deriveTerminalColors(darkPalette)
    expect(result.red).toBe(darkPalette.colors.red)
  })

  it('maps palette.green to terminal green', () => {
    const result = deriveTerminalColors(darkPalette)
    expect(result.green).toBe(darkPalette.colors.green)
  })

  it('maps palette.amber to terminal yellow', () => {
    const result = deriveTerminalColors(darkPalette)
    expect(result.yellow).toBe(darkPalette.colors.amber)
  })

  it('maps palette.accent to terminal blue', () => {
    const result = deriveTerminalColors(darkPalette)
    expect(result.blue).toBe(darkPalette.colors.accent)
  })

  it('uses bgPrimary for black on dark themes', () => {
    const result = deriveTerminalColors(darkPalette)
    expect(result.black).toBe(darkPalette.colors.bgPrimary)
  })

  it('uses textPrimary for white on dark themes', () => {
    const result = deriveTerminalColors(darkPalette)
    expect(result.white).toBe(darkPalette.colors.textPrimary)
  })

  it('uses a dark black for light themes (not the light bgPrimary)', () => {
    const result = deriveTerminalColors(lightPalette)
    expect(result.black).not.toBe(lightPalette.colors.bgPrimary)
    expect(result.black).toBe('#2e3440')
  })

  it('bright variants differ from base variants', () => {
    const result = deriveTerminalColors(darkPalette)
    expect(result.brightRed).not.toBe(result.red)
    expect(result.brightGreen).not.toBe(result.green)
    expect(result.brightBlue).not.toBe(result.blue)
  })
})
