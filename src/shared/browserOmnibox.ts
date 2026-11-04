/**
 * Address bar input resolution: decides whether typed text is a URL or a search.
 * Pure - no store or DOM access - so it can be unit tested exhaustively.
 */

import type { BrowserSearchEngine } from './browser'

export type SearchEngineId = BrowserSearchEngine

const SEARCH_ENGINES: Record<SearchEngineId, string> = {
  google: 'https://www.google.com/search?q=',
  duckduckgo: 'https://duckduckgo.com/?q=',
  bing: 'https://www.bing.com/search?q=',
}

export const DEFAULT_SEARCH_ENGINE: SearchEngineId = 'google'

export function searchUrl(query: string, engine: SearchEngineId = DEFAULT_SEARCH_ENGINE): string {
  return SEARCH_ENGINES[engine] + encodeURIComponent(query)
}

const EXPLICIT_SCHEME = /^(https?|file):\/\//i
const ANY_SCHEME = /^[a-z][a-z0-9+.-]*:/i
// Hosts that should default to plain http (dev servers rarely have TLS).
const LOCAL_HOST = /^(localhost|[a-z0-9-]+\.localhost|127(\.\d{1,3}){3}|0\.0\.0\.0|\[::1\])(:\d{1,5})?$/i
const PRIVATE_IPV4 = /^(10(\.\d{1,3}){3}|192\.168(\.\d{1,3}){2}|172\.(1[6-9]|2\d|3[01])(\.\d{1,3}){2})(:\d{1,5})?$/
const HOST_WITH_PORT = /^[a-z0-9.-]+:\d{1,5}$/i
// A dotted hostname whose last label looks like a TLD (letters, 2+ chars) or an IPv4.
const DOTTED_HOST = /^([a-z0-9-]+\.)+([a-z]{2,63}|\d{1,3})(:\d{1,5})?$/i

function normalize(url: string): string | null {
  try {
    return new URL(url).href
  } catch {
    return null
  }
}

/**
 * Resolve address bar text into a navigable URL.
 * - `?query` always searches.
 * - Explicit http/https/file URLs and `about:blank` load as-is.
 * - localhost, loopback, `*.localhost`, private LAN IPs and `host:port` use http.
 * - Other dotted hostnames use https.
 * - Anything else (including unsupported schemes) searches.
 */
export function resolveOmniboxInput(raw: string, engine: SearchEngineId = DEFAULT_SEARCH_ENGINE): string | null {
  const input = raw.trim()
  if (!input) return null

  if (input.startsWith('?')) {
    const query = input.slice(1).trim()
    return query ? searchUrl(query, engine) : null
  }

  if (input.toLowerCase() === 'about:blank') return 'about:blank'

  if (EXPLICIT_SCHEME.test(input)) return normalize(input) ?? searchUrl(input, engine)

  if (/\s/.test(input)) return searchUrl(input, engine)

  // Authority ends at the first path, query or fragment delimiter (`example.com?x=1`).
  const host = input.split(/[/?#]/, 1)[0]

  if (LOCAL_HOST.test(host) || PRIVATE_IPV4.test(host) || HOST_WITH_PORT.test(host)) {
    return normalize(`http://${input}`) ?? searchUrl(input, engine)
  }

  // Must come after host:port so `devbox:8080` isn't mistaken for a scheme.
  if (ANY_SCHEME.test(input)) return searchUrl(input, engine)

  if (DOTTED_HOST.test(host)) {
    return normalize(`https://${input}`) ?? searchUrl(input, engine)
  }

  return searchUrl(input, engine)
}

/** URL as shown in the address bar when it isn't focused. */
export function displayUrl(url: string): string {
  if (!url || url === 'about:blank') return ''
  try {
    const parsed = new URL(url)
    if (parsed.pathname === '/' && !parsed.search && !parsed.hash) {
      return `${parsed.protocol}//${parsed.host}`
    }
  } catch {
    // Not a parseable URL - show it raw.
  }
  return url
}

/** Short label for a tab with no title yet. */
export function hostLabel(url: string): string {
  if (!url || url === 'about:blank') return ''
  try {
    const parsed = new URL(url)
    if (parsed.protocol === 'file:') return parsed.pathname.split('/').filter(Boolean).at(-1) ?? url
    return parsed.host
  } catch {
    return url
  }
}
