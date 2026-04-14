// ---------------------------------------------------------------------------
// Error classification — detects auth errors from SDK error messages
// ---------------------------------------------------------------------------

export type ErrorKind = 'auth' | 'generic'
export type AuthErrorType = 'oauth' | 'api_key' | 'unknown'

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

/** Classify whether an error is an authentication failure. */
export function classifyError(message: string): ErrorKind {
  return AUTH_PATTERNS.some((p) => p.test(message)) ? 'auth' : 'generic'
}

/** For auth errors, determine whether it's OAuth, API key, or unknown. */
export function classifyAuthType(message: string): AuthErrorType {
  if (OAUTH_PATTERNS.some((p) => p.test(message))) return 'oauth'
  if (API_KEY_PATTERNS.some((p) => p.test(message))) return 'api_key'
  return 'unknown'
}
