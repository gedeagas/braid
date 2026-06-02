import { describe, it, expect } from 'vitest'
import { isReapableTerminalId } from '../orphan'

describe('isReapableTerminalId', () => {
  it('reaps big-terminal sessions', () => {
    expect(isReapableTerminalId('bt-1779786364022-5')).toBe(true)
  })

  it('reaps right-panel terminal sessions', () => {
    // Regression: right terminals ("rt-") were previously invisible to the
    // orphan reaper, so abandoned right-panel daemon shells accumulated forever.
    expect(isReapableTerminalId('rt-1779779555065-1')).toBe(true)
  })

  it('never reaps anonymous ephemeral sessions', () => {
    expect(isReapableTerminalId('pty-d-1779718708542-3zmzbj')).toBe(false)
  })

  it('never reaps arbitrary ids', () => {
    expect(isReapableTerminalId('something-else')).toBe(false)
    expect(isReapableTerminalId('')).toBe(false)
  })
})
