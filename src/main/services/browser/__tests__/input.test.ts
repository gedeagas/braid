import { describe, it, expect, vi } from 'vitest'
vi.mock('electron', () => ({}))
import { parseKeyChord } from '../automation/input'

describe('parseKeyChord', () => {
  it('parses named keys and modifiers', () => {
    expect(parseKeyChord('Enter')).toEqual({ def: { key: 'Enter', code: 'Enter', keyCode: 13, text: '\r' }, modifiers: 0 })
    expect(parseKeyChord('Shift+Tab').modifiers).toBe(8)
    expect(parseKeyChord('Meta+a')).toEqual({ def: { key: 'a', code: 'KeyA', keyCode: 65, text: undefined }, modifiers: 4 })
    expect(parseKeyChord('F5').def).toEqual({ key: 'F5', code: 'F5', keyCode: 116 })
    expect(parseKeyChord('x').def.text).toBe('x')
  })

  it('rejects unknown keys and modifiers', () => {
    expect(() => parseKeyChord('Hyper+a')).toThrow(/modifier/)
    expect(() => parseKeyChord('NotAKey')).toThrow(/Unknown key/)
  })
})
