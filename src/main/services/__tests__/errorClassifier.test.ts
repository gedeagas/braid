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

  it('returns generic for unrelated errors', () => {
    expect(classifyError('Network timeout')).toBe('generic')
    expect(classifyError('SDK import failed')).toBe('generic')
    expect(classifyError('Session process exited (code 1)')).toBe('generic')
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
