import { describe, it, expect } from 'vitest'
import { browserShortcutFor, type ShortcutInput } from '../shortcuts'

function key(k: string, mods: Partial<ShortcutInput> = {}): ShortcutInput {
  return { type: 'keyDown', key: k, meta: false, control: false, shift: false, alt: false, ...mods }
}

describe('browserShortcutFor (mac)', () => {
  const mac = (input: ShortcutInput) => browserShortcutFor(input, 'darwin')

  it('maps Cmd shortcuts', () => {
    expect(mac(key('f', { meta: true }))).toBe('find')
    expect(mac(key('r', { meta: true }))).toBe('reload')
    expect(mac(key('R', { meta: true, shift: true }))).toBe('hardReload')
    expect(mac(key('[', { meta: true }))).toBe('back')
    expect(mac(key(']', { meta: true }))).toBe('forward')
    expect(mac(key('l', { meta: true }))).toBe('focusAddress')
    expect(mac(key('t', { meta: true }))).toBe('newTab')
    expect(mac(key('T', { meta: true, shift: true }))).toBe('reopenClosedTab')
    expect(mac(key('w', { meta: true }))).toBe('closeTab')
    expect(mac(key('ı', { meta: true, alt: true, code: 'KeyI' }))).toBe('devtools')
  })

  it('leaves tab navigation and other shortcuts to the app menu', () => {
    expect(mac(key('[', { meta: true, shift: true }))).toBeNull()
    expect(mac(key('1', { meta: true }))).toBeNull()
    expect(mac(key('k', { meta: true }))).toBeNull()
    expect(mac(key('f', { meta: true, alt: true }))).toBeNull()
  })

  it('ignores keys without the platform modifier and keyUp events', () => {
    expect(mac(key('f'))).toBeNull()
    expect(mac(key('f', { control: true }))).toBeNull()
    expect(mac({ ...key('f', { meta: true }), type: 'keyUp' })).toBeNull()
  })
})

describe('browserShortcutFor (windows/linux)', () => {
  it('uses Ctrl as the modifier', () => {
    expect(browserShortcutFor(key('f', { control: true }), 'linux')).toBe('find')
    expect(browserShortcutFor(key('f', { meta: true }), 'win32')).toBeNull()
  })
})
