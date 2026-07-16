import { describe, expect, it } from 'vitest'
import { buildUpdateFeedUrl, parseUpdateFeedRelease } from '../autoUpdateFeed'

describe('auto-update feed helpers', () => {
  it('builds an architecture-specific Electron update service URL', () => {
    expect(buildUpdateFeedUrl('gedeagas', 'braid', 'darwin', 'arm64', '26.3.1')).toBe(
      'https://update.electronjs.org/gedeagas/braid/darwin-arm64/26.3.1'
    )
  })

  it('parses a release returned by update.electronjs.org', () => {
    expect(parseUpdateFeedRelease({
      name: 'v26.3.2',
      notes: '## Fixed\n\n- Update checks',
      url: 'https://github.com/gedeagas/braid/releases/download/v26.3.2/braid-26.3.2-arm64-mac.zip',
    })).toEqual({
      version: '26.3.2',
      releaseNotes: '## Fixed\n\n- Update checks',
    })
  })

  it('accepts missing release notes', () => {
    expect(parseUpdateFeedRelease({
      name: '26.3.2',
      url: 'https://github.com/gedeagas/braid/releases/download/v26.3.2/braid-26.3.2-arm64-mac.zip',
    })).toEqual({
      version: '26.3.2',
      releaseNotes: '',
    })
  })

  it.each([
    null,
    {},
    { name: 'latest', url: 'https://example.com/update.zip' },
    { name: 'v26.3.2', url: 'not-a-url' },
    { name: 'v26.3.2', notes: 42, url: 'https://example.com/update.zip' },
  ])('rejects malformed service responses', (response) => {
    expect(() => parseUpdateFeedRelease(response)).toThrow('Invalid response from update service')
  })
})
