import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { verifyAgentSession } from '../verify'

let home = ''
let claudeDir = ''
let codexDir = ''

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'braid-verify-'))
  claudeDir = join(home, '.claude')
  codexDir = join(home, '.codex')
})

afterEach(() => {
  rmSync(home, { recursive: true, force: true })
})

const dirs = () => ({ claudeConfigDir: claudeDir, codexHome: codexDir })

describe('verifyAgentSession: claude', () => {
  it('is ok when the reported transcript exists', async () => {
    const t = join(home, 't', 'S1.jsonl')
    mkdirSync(join(home, 't'))
    writeFileSync(t, '{}')
    expect(await verifyAgentSession({ agent: 'claude', id: 'S1', transcriptPath: t }, dirs())).toBe('ok')
  })

  it('finds the transcript under any project folder when the path moved or was not reported', async () => {
    mkdirSync(join(claudeDir, 'projects', '-Users-me-repo'), { recursive: true })
    writeFileSync(join(claudeDir, 'projects', '-Users-me-repo', 'S1.jsonl'), '{}')
    expect(await verifyAgentSession({ agent: 'claude', id: 'S1' }, dirs())).toBe('ok')
    expect(await verifyAgentSession({ agent: 'claude', id: 'S1', transcriptPath: '/gone/S1.jsonl' }, dirs())).toBe('ok')
  })

  it('is missing only when a reported transcript is gone and nothing else matches', async () => {
    mkdirSync(join(claudeDir, 'projects', 'p'), { recursive: true })
    expect(await verifyAgentSession({ agent: 'claude', id: 'S1', transcriptPath: '/gone/S1.jsonl' }, dirs())).toBe('missing')
  })

  it('stays unverifiable without a reported path (a custom config dir could hold it)', async () => {
    mkdirSync(join(claudeDir, 'projects', 'p'), { recursive: true })
    expect(await verifyAgentSession({ agent: 'claude', id: 'S1' }, dirs())).toBe('unverifiable')
  })
})

describe('verifyAgentSession: codex', () => {
  it('is ok when a rollout file for the session exists (plain or compressed)', async () => {
    const day = join(codexDir, 'sessions', '2026', '11', '03')
    mkdirSync(day, { recursive: true })
    writeFileSync(join(day, 'rollout-2026-11-03T10-00-00-c0ffee-1.jsonl'), '{}')
    writeFileSync(join(day, 'rollout-2026-11-03T11-00-00-c0ffee-2.jsonl.zst'), '')
    expect(await verifyAgentSession({ agent: 'codex', id: 'c0ffee-1' }, dirs())).toBe('ok')
    expect(await verifyAgentSession({ agent: 'codex', id: 'c0ffee-2' }, dirs())).toBe('ok')
  })

  it('is missing when the sessions folder exists but has no rollout for it', async () => {
    mkdirSync(join(codexDir, 'sessions', '2026', '11', '03'), { recursive: true })
    expect(await verifyAgentSession({ agent: 'codex', id: 'nope' }, dirs())).toBe('missing')
  })

  it('is unverifiable when there is no sessions folder at all', async () => {
    expect(await verifyAgentSession({ agent: 'codex', id: 'x' }, dirs())).toBe('unverifiable')
  })
})

describe('verifyAgentSession: others', () => {
  it('cannot verify agents without a known session store, so the resume is attempted', async () => {
    expect(await verifyAgentSession({ agent: 'gemini', id: 'g' }, dirs())).toBe('unverifiable')
  })
})
