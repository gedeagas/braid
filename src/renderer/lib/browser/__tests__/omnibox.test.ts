import { describe, it, expect } from 'vitest'
import { resolveOmniboxInput, displayUrl, searchUrl } from '../omnibox'

describe('resolveOmniboxInput', () => {
  it('returns null for empty input', () => {
    expect(resolveOmniboxInput('   ')).toBeNull()
  })

  it('keeps explicit http(s) URLs', () => {
    expect(resolveOmniboxInput('https://example.com/a?b=1')).toBe('https://example.com/a?b=1')
    expect(resolveOmniboxInput('http://localhost:3000')).toBe('http://localhost:3000/')
  })

  it('keeps file and about:blank URLs', () => {
    expect(resolveOmniboxInput('file:///tmp/index.html')).toBe('file:///tmp/index.html')
    expect(resolveOmniboxInput('about:blank')).toBe('about:blank')
  })

  it('uses http for localhost and loopback hosts', () => {
    expect(resolveOmniboxInput('localhost')).toBe('http://localhost/')
    expect(resolveOmniboxInput('localhost:5173/app')).toBe('http://localhost:5173/app')
    expect(resolveOmniboxInput('127.0.0.1:8080')).toBe('http://127.0.0.1:8080/')
    expect(resolveOmniboxInput('0.0.0.0:3000')).toBe('http://0.0.0.0:3000/')
    expect(resolveOmniboxInput('[::1]:3000')).toBe('http://[::1]:3000/')
    expect(resolveOmniboxInput('myapp.localhost:3000')).toBe('http://myapp.localhost:3000/')
  })

  it('uses http for private LAN IPs and https for other bare hosts', () => {
    expect(resolveOmniboxInput('192.168.1.20:8000')).toBe('http://192.168.1.20:8000/')
    expect(resolveOmniboxInput('example.com')).toBe('https://example.com/')
    expect(resolveOmniboxInput('docs.github.com/en/rest')).toBe('https://docs.github.com/en/rest')
  })

  it('treats any host:port as a URL', () => {
    expect(resolveOmniboxInput('devbox:8080')).toBe('http://devbox:8080/')
  })

  it('searches for plain text', () => {
    expect(resolveOmniboxInput('react useEffect cleanup')).toBe(searchUrl('react useEffect cleanup'))
    expect(resolveOmniboxInput('hello')).toBe(searchUrl('hello'))
  })

  it('searches for text with a dot but spaces', () => {
    expect(resolveOmniboxInput('what is node.js')).toBe(searchUrl('what is node.js'))
  })

  it('forces search with a ? prefix', () => {
    expect(resolveOmniboxInput('?example.com')).toBe(searchUrl('example.com'))
    expect(resolveOmniboxInput('? ')).toBeNull()
  })

  it('rejects unsupported schemes by searching instead', () => {
    expect(resolveOmniboxInput('javascript:alert(1)')).toBe(searchUrl('javascript:alert(1)'))
    expect(resolveOmniboxInput('chrome://settings')).toBe(searchUrl('chrome://settings'))
  })

  it('honours the search engine', () => {
    expect(resolveOmniboxInput('cats', 'duckduckgo')).toBe('https://duckduckgo.com/?q=cats')
  })
})

describe('displayUrl', () => {
  it('strips the trailing slash of a bare origin', () => {
    expect(displayUrl('https://example.com/')).toBe('https://example.com')
  })

  it('keeps paths and queries', () => {
    expect(displayUrl('http://localhost:3000/a?b=1')).toBe('http://localhost:3000/a?b=1')
  })

  it('shows about:blank as empty', () => {
    expect(displayUrl('about:blank')).toBe('')
  })
})
