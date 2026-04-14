// ---------------------------------------------------------------------------
// Error classification — detects auth, network, and generic errors from SDK
// error messages
// ---------------------------------------------------------------------------

export type ErrorKind = 'auth' | 'network' | 'generic'
export type AuthErrorType = 'oauth' | 'api_key' | 'unknown'

const NETWORK_PATTERNS = [
  /ENOTFOUND/i,
  /ECONNREFUSED/i,
  /ECONNRESET/i,
  /ETIMEDOUT/i,
  /ENETUNREACH/i,
  /EHOSTUNREACH/i,
  /EHOSTDOWN/i,
  /socket hang up/i,
  /network.*error/i,
  /fetch failed/i,
  /Failed to fetch/i,
  /getaddrinfo/i,
  /connect EHOSTDOWN/i,
  /request.*timed?\s*out/i,
  /EPIPE/i,
  /EAI_AGAIN/i,
]

const AUTH_PATTERNS = [
  /authentication_error/i,
  /API Error: 401/,
  /OAuth token has expired/i,
  /Unauthorized/i,
  /Failed to authenticate/i,
  /invalid.*api.?key/i,
  /token.*expired/i,
  /Not logged in/i,
  /please run \/login/i,
]

const OAUTH_PATTERNS = [
  /OAuth/i,
  /token.*expired/i,
  /Not logged in/i,
  /please run \/login/i,
]

const API_KEY_PATTERNS = [
  /invalid.*api.?key/i,
  /API key/i,
]

/**
 * Classify an error as auth, network, or generic.
 * Network patterns are checked first since some network errors
 * (e.g. ECONNREFUSED to auth endpoint) should be treated as connectivity issues.
 */
export function classifyError(message: string): ErrorKind {
  if (NETWORK_PATTERNS.some((p) => p.test(message))) return 'network'
  if (AUTH_PATTERNS.some((p) => p.test(message))) return 'auth'
  return 'generic'
}

/** For auth errors, determine whether it's OAuth, API key, or unknown. */
export function classifyAuthType(message: string): AuthErrorType {
  if (OAUTH_PATTERNS.some((p) => p.test(message))) return 'oauth'
  if (API_KEY_PATTERNS.some((p) => p.test(message))) return 'api_key'
  return 'unknown'
}
