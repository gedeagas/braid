import { describe, it, expect, beforeEach } from 'vitest'
import { useUIStore } from '../store'
import { SK } from '@/lib/storageKeys'
import { CHAT_FONT_SIZE_DEFAULT, CHAT_FONT_SIZE_MAX, CHAT_FONT_SIZE_MIN } from '../theme'

const cssVar = () => document.documentElement.style.getPropertyValue('--chat-font-size')

describe('chat font size', () => {
  beforeEach(() => {
    localStorage.clear()
    useUIStore.getState().setChatFontSize(CHAT_FONT_SIZE_DEFAULT)
  })

  it('defaults to 14px', () => {
    expect(CHAT_FONT_SIZE_DEFAULT).toBe(14)
    expect(useUIStore.getState().chatFontSize).toBe(14)
  })

  it('persists and applies the CSS variable', () => {
    useUIStore.getState().setChatFontSize(16)
    expect(useUIStore.getState().chatFontSize).toBe(16)
    expect(localStorage.getItem(SK.chatFontSize)).toBe('16')
    expect(cssVar()).toBe('16px')
  })

  it('clamps to the supported range', () => {
    useUIStore.getState().setChatFontSize(4)
    expect(useUIStore.getState().chatFontSize).toBe(CHAT_FONT_SIZE_MIN)
    useUIStore.getState().setChatFontSize(99)
    expect(useUIStore.getState().chatFontSize).toBe(CHAT_FONT_SIZE_MAX)
  })

  it('rounds to whole pixels', () => {
    useUIStore.getState().setChatFontSize(15.6)
    expect(useUIStore.getState().chatFontSize).toBe(16)
  })
})
