import { describe, expect, it } from 'vitest'
import {
  getDisabledEmbeddedAppWarningKey,
  SPOTIFY_DISABLED_WARNING_KEY,
} from '../embeddedApps'

describe('getDisabledEmbeddedAppWarningKey', () => {
  it('disables the Spotify preset by name', () => {
    expect(getDisabledEmbeddedAppWarningKey({
      name: 'Spotify',
      url: 'https://open.spotify.com',
    })).toBe(SPOTIFY_DISABLED_WARNING_KEY)
  })

  it('disables custom Spotify URLs', () => {
    expect(getDisabledEmbeddedAppWarningKey({
      name: 'Music',
      url: 'https://accounts.spotify.com/login',
    })).toBe(SPOTIFY_DISABLED_WARNING_KEY)
  })

  it('leaves other embedded apps enabled', () => {
    expect(getDisabledEmbeddedAppWarningKey({
      name: 'Notion',
      url: 'https://notion.so',
    })).toBeNull()
  })

  it('handles null, undefined, or incomplete app objects gracefully', () => {
    expect(getDisabledEmbeddedAppWarningKey(null)).toBeNull()
    expect(getDisabledEmbeddedAppWarningKey(undefined)).toBeNull()
    expect(getDisabledEmbeddedAppWarningKey({})).toBeNull()
    expect(getDisabledEmbeddedAppWarningKey({ name: 'Spotify' })).toBe(SPOTIFY_DISABLED_WARNING_KEY)
    expect(getDisabledEmbeddedAppWarningKey({ url: 'https://open.spotify.com' })).toBe(SPOTIFY_DISABLED_WARNING_KEY)
  })
})
