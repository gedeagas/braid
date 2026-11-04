import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import http from 'node:http'
import { spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generateHookScript } from '../hookScript'

// Executes the real generated bash script against a loopback server, so the
// regex extraction and sanitizing are tested as bash runs them, not as we
// think they read.

let server: http.Server
let port = 0
let home = ''
const received: Array<Record<string, unknown>> = []
let waiters: Array<() => void> = []

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (c) => { body += c })
    req.on('end', () => {
      received.push(JSON.parse(body) as Record<string, unknown>)
      res.end('ok')
      waiters.forEach((w) => w())
      waiters = []
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
  port = (server.address() as { port: number }).port
  home = mkdtempSync(join(tmpdir(), 'braid-hook-test-'))
  mkdirSync(join(home, '.braid', 'hooks'), { recursive: true })
  writeFileSync(join(home, '.braid', 'hooks', 'hook-server.json'), JSON.stringify({ port, token: 't0k' }))
})

afterAll(() => {
  server.close()
  rmSync(home, { recursive: true, force: true })
})

async function run(agentId: string, payload: string): Promise<Record<string, unknown>> {
  const script = join(home, `hook-${agentId}.sh`)
  writeFileSync(script, generateHookScript({ agentId }))
  chmodSync(script, 0o755)
  const before = received.length
  const arrived = new Promise<void>((r) => waiters.push(r))
  // Async spawn: the script backgrounds curl, which needs this process's event
  // loop free to accept the request.
  const child = spawn('bash', [script], {
    env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: home, BRAID_TERMINAL_ID: 'bt-1' },
    stdio: ['pipe', 'ignore', 'ignore'],
  })
  child.stdin.end(payload)
  await Promise.race([arrived, new Promise((_, rej) => setTimeout(() => rej(new Error('no POST')), 5000))])
  return received[before]
}

describe('generated hook script', () => {
  it('forwards session id, cwd and event for Claude', async () => {
    const body = await run('claude', JSON.stringify({
      session_id: 'abc-123', transcript_path: '/x.jsonl', cwd: '/Users/me/My Repo', hook_event_name: 'SessionStart',
    }))
    expect(body).toEqual({ terminalId: 'bt-1', event: 'SessionStart', sessionId: 'abc-123', cwd: '/Users/me/My Repo' })
  })

  it('forwards the SessionEnd reason', async () => {
    const body = await run('claude', JSON.stringify({ session_id: 'abc', hook_event_name: 'SessionEnd', reason: 'prompt_input_exit' }))
    expect(body.reason).toBe('prompt_input_exit')
  })

  it('reads camelCase and conversation ids used by other agents', async () => {
    expect((await run('copilot', '{"sessionId":"cp-1","hook_event_name":"x"}')).sessionId).toBe('cp-1')
    expect((await run('cursor', '{"conversation_id":"cv-9","hook_event_name":"x"}')).sessionId).toBe('cv-9')
  })

  it('never forwards an id containing shell metacharacters', async () => {
    const body = await run('claude', '{"session_id":"a;$(touch /tmp/pwn)","hook_event_name":"Stop"}')
    expect(body.sessionId).toBeUndefined()
    expect(body.event).toBe('Stop')
  })

  it('keeps the payload valid JSON when cwd has quotes or escapes', async () => {
    const body = await run('claude', '{"session_id":"s","cwd":"/a\\\\b\'c","hook_event_name":"Stop"}')
    expect(typeof body.cwd).toBe('string')
    expect(String(body.cwd)).not.toMatch(/["'\\]/)
  })
})
