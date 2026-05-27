export const SPOTIFY_DISABLED_WARNING_KEY = 'apps.spotifyDisabledWarning'

interface EmbeddedAppIdentity {
  name?: unknown
  url?: unknown
}

function isSpotifyUrl(url: unknown): boolean {
  if (typeof url !== 'string' || !url) return false

  try {
    const hostname = new URL(url).hostname.toLowerCase()
    return hostname === 'spotify.com' || hostname.endsWith('.spotify.com')
  } catch {
    return false
  }
}

export function getDisabledEmbeddedAppWarningKey(
  app: EmbeddedAppIdentity | null | undefined
): string | null {
  if (!app || typeof app !== 'object') return null

  const name = typeof app.name === 'string' ? app.name.trim().toLowerCase() : ''
  if (name === 'spotify' || isSpotifyUrl(app.url)) {
    return SPOTIFY_DISABLED_WARNING_KEY
  }

  return null
}
