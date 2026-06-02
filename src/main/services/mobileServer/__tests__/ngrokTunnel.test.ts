import { describe, expect, it } from 'vitest'
import { extractNgrokPublicUrl, toWebSocketEndpoint } from '../ngrokTunnel'

describe('mobile ngrok tunnel helpers', () => {
  it('converts public HTTP URLs to WebSocket endpoints', () => {
    expect(toWebSocketEndpoint('https://abc.ngrok-free.app')).toBe('wss://abc.ngrok-free.app')
    expect(toWebSocketEndpoint('http://abc.ngrok-free.app/path?q=1')).toBe('ws://abc.ngrok-free.app')
  })

  it('extracts the public URL from ngrok JSON logs', () => {
    const line = JSON.stringify({
      lvl: 'info',
      msg: 'started tunnel',
      url: 'https://abc.ngrok-free.app',
    })
    expect(extractNgrokPublicUrl(line)).toBe('https://abc.ngrok-free.app')
  })

  it('extracts the public URL from text logs', () => {
    expect(extractNgrokPublicUrl('started tunnel url=https://abc.ngrok-free.app')).toBe('https://abc.ngrok-free.app')
    expect(extractNgrokPublicUrl('started tunnel addr=http://localhost:6839 url=https://abc.ngrok-free.app')).toBe('https://abc.ngrok-free.app')
  })
})
