// Trusted input for agents via CDP (Input.*), so pages see real user events.
import type { WebContents } from 'electron'
import { cdpSend } from '../cdp'

interface KeyDef { key: string; code: string; keyCode: number; text?: string }

const NAMED_KEYS: Record<string, KeyDef> = {
  enter: { key: 'Enter', code: 'Enter', keyCode: 13, text: '\r' },
  tab: { key: 'Tab', code: 'Tab', keyCode: 9 },
  escape: { key: 'Escape', code: 'Escape', keyCode: 27 },
  esc: { key: 'Escape', code: 'Escape', keyCode: 27 },
  backspace: { key: 'Backspace', code: 'Backspace', keyCode: 8 },
  delete: { key: 'Delete', code: 'Delete', keyCode: 46 },
  space: { key: ' ', code: 'Space', keyCode: 32, text: ' ' },
  arrowup: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
  arrowdown: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
  arrowleft: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
  arrowright: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
  home: { key: 'Home', code: 'Home', keyCode: 36 },
  end: { key: 'End', code: 'End', keyCode: 35 },
  pageup: { key: 'PageUp', code: 'PageUp', keyCode: 33 },
  pagedown: { key: 'PageDown', code: 'PageDown', keyCode: 34 },
}

const MODIFIER_BITS: Record<string, number> = { alt: 1, option: 1, control: 2, ctrl: 2, meta: 4, cmd: 4, command: 4, shift: 8 }

export interface ParsedKey { def: KeyDef; modifiers: number }

/** Parse "Shift+Tab", "Meta+a", "Enter" into a CDP key definition + modifier bitmask. */
export function parseKeyChord(chord: string): ParsedKey {
  const parts = chord.split('+').map((p) => p.trim()).filter(Boolean)
  if (parts.length === 0) throw new Error('Empty key')
  let modifiers = 0
  for (const mod of parts.slice(0, -1)) {
    const bit = MODIFIER_BITS[mod.toLowerCase()]
    if (bit === undefined) throw new Error(`Unknown modifier "${mod}"`)
    modifiers |= bit
  }
  const last = parts[parts.length - 1]
  const named = NAMED_KEYS[last.toLowerCase()]
  if (named) return { def: named, modifiers }
  if (/^f([1-9]|1[0-2])$/i.test(last)) {
    const n = Number(last.slice(1))
    return { def: { key: `F${n}`, code: `F${n}`, keyCode: 111 + n }, modifiers }
  }
  if (last.length === 1) {
    const upper = last.toUpperCase()
    const isLetter = /[A-Z]/.test(upper)
    const isDigit = /[0-9]/.test(last)
    const code = isLetter ? `Key${upper}` : isDigit ? `Digit${last}` : ''
    const keyCode = isLetter || isDigit ? upper.charCodeAt(0) : 0
    // Chords with Ctrl/Meta/Alt don't produce text (shortcuts).
    const text = modifiers & (1 | 2 | 4) ? undefined : last
    return { def: { key: last, code, keyCode, text }, modifiers }
  }
  throw new Error(`Unknown key "${last}"`)
}

export async function pressKey(wc: WebContents, chord: string): Promise<void> {
  const { def, modifiers } = parseKeyChord(chord)
  const base = { key: def.key, code: def.code, windowsVirtualKeyCode: def.keyCode, nativeVirtualKeyCode: def.keyCode, modifiers }
  await cdpSend(wc, 'Input.dispatchKeyEvent', { type: def.text ? 'keyDown' : 'rawKeyDown', ...base, ...(def.text ? { text: def.text, unmodifiedText: def.text } : {}) })
  await cdpSend(wc, 'Input.dispatchKeyEvent', { type: 'keyUp', ...base })
}

export async function insertText(wc: WebContents, text: string): Promise<void> {
  await cdpSend(wc, 'Input.insertText', { text })
}

export async function mouseMove(wc: WebContents, x: number, y: number): Promise<void> {
  await cdpSend(wc, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
}

export async function mouseClick(wc: WebContents, x: number, y: number, clickCount = 1): Promise<void> {
  await mouseMove(wc, x, y)
  for (let i = 1; i <= clickCount; i++) {
    await cdpSend(wc, 'Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: i })
    await cdpSend(wc, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: i })
  }
}

export async function mouseWheel(wc: WebContents, x: number, y: number, deltaY: number): Promise<void> {
  await cdpSend(wc, 'Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY })
}
