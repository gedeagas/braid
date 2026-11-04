import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'events'

const settings = { exposeToTerminalAgents: true }
const runBrowserTool = vi.fn(async () => ({ text: 'ok' }))

vi.mock('../settings', () => ({ getBrowserSettings: () => settings }))
vi.mock('../automation/tools', () => ({ runBrowserTool: (...a: unknown[]) => runBrowserTool(...(a as [])) }))

import { handleBrowserRoute } from '../http'

interface FakeRes { status: number; body: unknown; done: Promise<void> }

function call(body: string | null, opts: { token?: string; url?: string; method?: string } = {}): FakeRes {
  const req = Object.assign(new EventEmitter(), {
    url: opts.url ?? '/browser/call',
    method: opts.method ?? 'POST',
    headers: { 'x-braid-token': opts.token ?? 'tok' },
    destroy: vi.fn(),
  })
  let resolve!: () => void
  const out: FakeRes = { status: 0, body: undefined, done: new Promise((r) => { resolve = r }) }
  const res = {
    writeHead: (status: number) => { out.status = status },
    end: (data: string) => { out.body = JSON.parse(data); resolve() },
  }
  handleBrowserRoute(req as never, res as never, 'tok')
  if (body !== null) req.emit('data', Buffer.from(body))
  req.emit('end')
  return out
}

beforeEach(() => {
  settings.exposeToTerminalAgents = true
  runBrowserTool.mockClear()
})

describe('handleBrowserRoute', () => {
  it('rejects a wrong token', async () => {
    const r = call('{}', { token: 'nope' })
    await r.done
    expect(r.status).toBe(403)
  })

  it('refuses calls once terminal access is turned off', async () => {
    settings.exposeToTerminalAgents = false
    const r = call(JSON.stringify({ name: 'browser_tabs' }))
    await r.done
    expect(r.status).toBe(403)
    expect(runBrowserTool).not.toHaveBeenCalled()
  })

  it.each(['null', '[]', '"x"', '{bad'])('answers 400 for a non-object body %s', async (body) => {
    const r = call(body)
    await r.done
    expect(r.status).toBe(400)
  })

  it('runs the tool for a valid call', async () => {
    const r = call(JSON.stringify({ name: 'browser_tabs', cwd: '/w' }))
    await r.done
    expect(r.status).toBe(200)
    expect(runBrowserTool).toHaveBeenCalledWith('browser_tabs', {}, { cwd: '/w' })
  })
})
