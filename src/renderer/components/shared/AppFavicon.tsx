import { useState } from 'react'

/** Strip workspace subdomains (e.g. team.slack.com → slack.com) so we
 *  hit the main site's favicon instead of a subdomain that doesn't serve one. */
function baseDomain(hostname: string): string {
  const parts = hostname.split('.')
  return parts.length > 2 ? parts.slice(-2).join('.') : hostname
}

function faviconUrl(appUrl: string): string {
  try {
    const { hostname, protocol } = new URL(appUrl)
    return `${protocol}//${baseDomain(hostname)}/apple-touch-icon.png`
  } catch {
    return ''
  }
}

function googleFaviconUrl(appUrl: string): string {
  try {
    const { hostname } = new URL(appUrl)
    return `https://www.google.com/s2/favicons?domain=${baseDomain(hostname)}&sz=32`
  } catch {
    return ''
  }
}

function LetterAvatar({ name, size }: { name: string; size: number }) {
  const letter = name.charAt(0).toUpperCase() || '?'
  const hue = name.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0) % 360
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: 3,
        background: `hsl(${hue}, 55%, 40%)`,
        color: '#fff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: size * 0.65,
        fontWeight: 600,
        flexShrink: 0,
        userSelect: 'none',
      }}
    >
      {letter}
    </div>
  )
}

interface AppFaviconProps {
  url: string
  name: string
  size?: number
}

export function AppFavicon({ url, name, size = 16 }: AppFaviconProps) {
  const [src, setSrc] = useState(() => faviconUrl(url))
  const [failed, setFailed] = useState(false)

  const handleError = () => {
    // Try Google's favicon API as fallback before giving up
    const google = googleFaviconUrl(url)
    if (src !== google && google) {
      setSrc(google)
    } else {
      setFailed(true)
    }
  }

  if (failed || !src) return <LetterAvatar name={name} size={size} />
  return (
    <img
      src={src}
      width={size}
      height={size}
      alt={name}
      onError={handleError}
      style={{ borderRadius: 3, flexShrink: 0 }}
    />
  )
}
