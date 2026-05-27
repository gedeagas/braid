export const SPOTIFY_DISABLED_WARNING_KEY = 'apps.spotifyDisabledWarning'

interface EmbeddedAppIdentity {
  name: string
  url: string
}

function isSpotifyUrl(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase()
    return hostname === 'spotify.com' || hostname.endsWith('.spotify.com')
  } catch {
    return false
  }
}

export function getDisabledEmbeddedAppWarningKey(app: EmbeddedAppIdentity): string | null {
  if (app.name.trim().toLowerCase() === 'spotify' || isSpotifyUrl(app.url)) {
    return SPOTIFY_DISABLED_WARNING_KEY
  }

  return null
}
