import { describe, it, expect } from 'vitest'
import { classifyError, classifyAuthType } from '../agentWorker/errorClassifier'

describe('classifyError', () => {
  it('detects OAuth token expired', () => {
    const msg = 'Failed to authenticate. API Error: 401 {"type":"error","error":{"type":"authentication_error","message":"OAuth token has expired."}}'
    expect(classifyError(msg)).toBe('auth')
  })

  it('detects generic 401', () => {
    expect(classifyError('API Error: 401')).toBe('auth')
  })

  it('detects Unauthorized', () => {
    expect(classifyError('Unauthorized')).toBe('auth')
  })

  it('detects invalid API key', () => {
    expect(classifyError('invalid api key')).toBe('auth')
  })

  it('detects authentication_error type', () => {
    expect(classifyError('{"type":"authentication_error"}')).toBe('auth')
  })

  it('detects "Not logged in" error', () => {
    expect(classifyError('Not logged in · Please run /login')).toBe('auth')
  })

  it('detects "please run /login" error', () => {
    expect(classifyError('Error: please run /login to authenticate')).toBe('auth')
  })

  it('detects network errors - ENOTFOUND', () => {
    expect(classifyError('getaddrinfo ENOTFOUND api.anthropic.com')).toBe('network')
  })

  it('detects network errors - ECONNREFUSED', () => {
    expect(classifyError('connect ECONNREFUSED 127.0.0.1:443')).toBe('network')
  })

  it('detects network errors - ECONNRESET', () => {
    expect(classifyError('socket hang up ECONNRESET')).toBe('network')
  })

  it('detects network errors - ETIMEDOUT', () => {
    expect(classifyError('connect ETIMEDOUT 104.18.6.224:443')).toBe('network')
  })

  it('detects network errors - ENETUNREACH', () => {
    expect(classifyError('connect ENETUNREACH ::1:443')).toBe('network')
  })

  it('detects network errors - socket hang up', () => {
    expect(classifyError('socket hang up')).toBe('network')
  })

  it('detects network errors - fetch failed', () => {
    expect(classifyError('TypeError: fetch failed')).toBe('network')
  })

  it('detects network errors - Failed to fetch', () => {
    expect(classifyError('Failed to fetch')).toBe('network')
  })

  it('detects network errors - request timed out', () => {
    expect(classifyError('request timed out')).toBe('network')
  })

  it('detects network errors - EAI_AGAIN', () => {
    expect(classifyError('getaddrinfo EAI_AGAIN api.anthropic.com')).toBe('network')
  })

  it('prioritizes network over auth for connection-level failures', () => {
    // ECONNREFUSED to auth endpoint is a network issue, not auth
    expect(classifyError('connect ECONNREFUSED to auth server')).toBe('network')
  })

  it('returns generic for unrelated errors', () => {
    expect(classifyError('SDK import failed')).toBe('generic')
    expect(classifyError('Session process exited (code 1)')).toBe('generic')
    expect(classifyError('Some random error occurred')).toBe('generic')
  })
})

describe('classifyAuthType', () => {
  it('returns oauth for OAuth-related messages', () => {
    expect(classifyAuthType('OAuth token has expired')).toBe('oauth')
  })

  it('returns oauth for token expired messages', () => {
    expect(classifyAuthType('Your token has expired. Please refresh.')).toBe('oauth')
  })

  it('returns api_key for invalid API key messages', () => {
    expect(classifyAuthType('invalid api key provided')).toBe('api_key')
  })

  it('returns api_key for API key mentions', () => {
    expect(classifyAuthType('API key is not valid')).toBe('api_key')
  })

  it('returns oauth for "Not logged in" messages', () => {
    expect(classifyAuthType('Not logged in · Please run /login')).toBe('oauth')
  })

  it('returns unknown for generic auth errors', () => {
    expect(classifyAuthType('Unauthorized')).toBe('unknown')
    expect(classifyAuthType('Failed to authenticate')).toBe('unknown')
  })
})
