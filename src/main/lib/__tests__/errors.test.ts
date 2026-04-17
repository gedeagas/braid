import { describe, it, expect } from 'vitest'
import { isEpipe } from '../errors'

describe('isEpipe', () => {
  it('returns true for an Error with code EPIPE', () => {
    const err = Object.assign(new Error('write EPIPE'), { code: 'EPIPE' })
    expect(isEpipe(err)).toBe(true)
  })

  it('returns false for an Error with a different code', () => {
    const err = Object.assign(new Error('connection reset'), { code: 'ECONNRESET' })
    expect(isEpipe(err)).toBe(false)
  })

  it('returns false for an Error with no code', () => {
    expect(isEpipe(new Error('plain error'))).toBe(false)
  })

  it('returns false for a non-Error object with code EPIPE', () => {
    expect(isEpipe({ code: 'EPIPE' })).toBe(false)
  })

  it('returns false for a string', () => {
    expect(isEpipe('EPIPE')).toBe(false)
  })

  it('returns false for null', () => {
    expect(isEpipe(null)).toBe(false)
  })

  it('returns false for undefined', () => {
    expect(isEpipe(undefined)).toBe(false)
  })
})
