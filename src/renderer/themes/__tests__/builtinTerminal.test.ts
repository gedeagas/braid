import { describe, it, expect } from 'vitest'
import { builtinThemes } from '../palettes'

const HEX_RE = /^#[0-9a-fA-F]{6}$/
const TERMINAL_FIELDS = [
  'black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white',
  'brightBlack', 'brightRed', 'brightGreen', 'brightYellow',
  'brightBlue', 'brightMagenta', 'brightCyan', 'brightWhite'
] as const

describe('builtin theme terminal colors', () => {
  it('has at least 29 builtin themes', () => {
    expect(builtinThemes.length).toBeGreaterThanOrEqual(29)
  })

  for (const theme of builtinThemes) {
    describe(theme.name, () => {
      it('has a terminal color block', () => {
        expect(theme.terminal).toBeDefined()
      })

      it('has all 16 valid hex ANSI colors', () => {
        expect(theme.terminal).toBeDefined()
        for (const field of TERMINAL_FIELDS) {
          expect(theme.terminal![field]).toMatch(HEX_RE)
        }
      })
    })
  }
})
