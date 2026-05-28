import { describe, expect, it } from 'vitest'
import { resolveSafeExternalUrl } from '../safeExternalUrl'

describe('resolveSafeExternalUrl', () => {
  const baseUrl = 'https://github.com/example/repo/pull/1#discussion_r2'

  it('allows web URLs and resolves relative GitHub links', () => {
    expect(resolveSafeExternalUrl('https://example.com/docs', baseUrl)).toBe('https://example.com/docs')
    expect(resolveSafeExternalUrl('/example/repo/issues/1', baseUrl)).toBe('https://github.com/example/repo/issues/1')
  })

  it('blocks unsafe or invalid URLs', () => {
    expect(resolveSafeExternalUrl('file:///tmp/secret', baseUrl)).toBeNull()
    expect(resolveSafeExternalUrl('javascript:alert(1)', baseUrl)).toBeNull()
    expect(resolveSafeExternalUrl('http://[::1', baseUrl)).toBeNull()
  })
})
