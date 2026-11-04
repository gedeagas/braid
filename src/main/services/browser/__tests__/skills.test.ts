import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, symlinkSync } from 'fs'
import { tmpdir } from 'os'
import { createHash } from 'crypto'
import { join } from 'path'
import { syncBrowserSkill } from '../agentBridge/skills'
import { skillStub } from '../agentBridge/skillContent'

let home: string
// Detected agent CLIs (codex reads the shared folder, so it gets no separate copy).
const FOUND = new Set(['claude', 'grok', 'codex'])
const skillDir = (root: string) => join(home, root, 'skills', 'braid-browser')
const outcomes = (r: ReturnType<typeof syncBrowserSkill>) => Object.fromEntries(r.map((x) => [x.agent, x.outcome]))

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'braid-skills-'))
  mkdirSync(join(home, '.claude'))
  mkdirSync(join(home, '.grok'))
  mkdirSync(join(home, '.codex')) // Codex reads the shared folder: no separate copy
})
afterEach(() => rmSync(home, { recursive: true, force: true }))

describe('syncBrowserSkill', () => {
  it('installs into the shared folder and detected agents only', () => {
    const r = syncBrowserSkill(true, { home, env: {}, foundCommands: FOUND })
    expect(outcomes(r)).toEqual({ shared: 'installed', claude: 'installed', grok: 'installed' })
    expect(r.find((x) => x.agent === 'shared')?.agents).toEqual(['Codex'])
    expect(readFileSync(join(skillDir('.claude'), 'SKILL.md'), 'utf8')).toBe(skillStub())
    expect(existsSync(join(home, '.gemini'))).toBe(false)
    expect(existsSync(skillDir('.codex'))).toBe(false)
  })

  it('is idempotent', () => {
    syncBrowserSkill(true, { home, env: {}, foundCommands: FOUND })
    expect(new Set(syncBrowserSkill(true, { home, env: {}, foundCommands: FOUND }).map((x) => x.outcome))).toEqual(new Set(['unchanged']))
  })

  it('updates an older Braid copy', () => {
    syncBrowserSkill(true, { home, env: {}, foundCommands: FOUND })
    // Simulate a previously shipped version: write it, record its digest via a run, then upgrade.
    const old = skillStub().replace('# Braid browser', '# Braid browser (old)')
    writeFileSync(join(skillDir('.claude'), 'SKILL.md'), old)
    const manifestPath = join(home, '.braid', 'skills', 'manifest.json')
    const m = JSON.parse(readFileSync(manifestPath, 'utf8'))
    m.digests.push(createHash('sha256').update(old).digest('hex'))
    writeFileSync(manifestPath, JSON.stringify(m))
    expect(outcomes(syncBrowserSkill(true, { home, env: {}, foundCommands: FOUND })).claude).toBe('updated')
    expect(readFileSync(join(skillDir('.claude'), 'SKILL.md'), 'utf8')).toBe(skillStub())
  })

  it('leaves edited copies and different skills alone', () => {
    syncBrowserSkill(true, { home, env: {}, foundCommands: FOUND })
    writeFileSync(join(skillDir('.claude'), 'SKILL.md'), skillStub() + '\nmy notes\n')
    mkdirSync(join(home, '.agents', 'skills', 'braid-browser'), { recursive: true })
    writeFileSync(join(home, '.agents', 'skills', 'braid-browser', 'SKILL.md'), '---\nname: something-else\n---\n')
    const r = outcomes(syncBrowserSkill(true, { home, env: {}, foundCommands: FOUND }))
    expect(r.claude).toBe('edited')
    expect(r.shared).toBe('foreign')
    expect(readFileSync(join(skillDir('.claude'), 'SKILL.md'), 'utf8')).toContain('my notes')
  })

  it('treats extra files as an edited copy', () => {
    syncBrowserSkill(true, { home, env: {}, foundCommands: FOUND })
    writeFileSync(join(skillDir('.grok'), 'extra.md'), 'x')
    expect(outcomes(syncBrowserSkill(true, { home, env: {}, foundCommands: FOUND })).grok).toBe('edited')
  })

  it('never follows symlinked skill folders', () => {
    const target = join(home, 'elsewhere')
    mkdirSync(target)
    mkdirSync(join(home, '.claude', 'skills'), { recursive: true })
    symlinkSync(target, skillDir('.claude'))
    expect(outcomes(syncBrowserSkill(true, { home, env: {}, foundCommands: FOUND })).claude).toBe('foreign')
    expect(existsSync(join(target, 'SKILL.md'))).toBe(false)
  })

  it('removes only untouched copies and folders it created', () => {
    syncBrowserSkill(true, { home, env: {}, foundCommands: FOUND })
    writeFileSync(join(skillDir('.grok'), 'SKILL.md'), skillStub() + '\nedited')
    const r = outcomes(syncBrowserSkill(false, { home, env: {}, foundCommands: FOUND }))
    expect(r).toEqual({ shared: 'removed', claude: 'removed', grok: 'edited' })
    expect(existsSync(skillDir('.claude'))).toBe(false)
    expect(existsSync(join(skillDir('.grok'), 'SKILL.md'))).toBe(true)
  })

  it('detects agents by their CLI, even before they created a config folder', () => {
    const r = syncBrowserSkill(true, { home, env: {}, foundCommands: new Set(['kiro-cli', 'copilot']) })
    expect(outcomes(r)).toEqual({ shared: 'installed', kiro: 'installed' })
    expect(r[0].agents).toEqual(['GitHub Copilot'])
    expect(existsSync(join(skillDir('.kiro'), 'SKILL.md'))).toBe(true)
  })

  it('ignores agents whose config folder exists but whose CLI is missing', () => {
    mkdirSync(join(home, '.cursor'))
    expect(outcomes(syncBrowserSkill(true, { home, env: {}, foundCommands: new Set() }))).toEqual({ shared: 'installed' })
  })

  it('requires helper commands for wrapper CLIs', () => {
    const r = syncBrowserSkill(true, { home, env: {}, foundCommands: new Set(['dsh-tui']) })
    expect(r[0].agents).toEqual([])
    const r2 = syncBrowserSkill(true, { home, env: {}, foundCommands: new Set(['dsh-tui', 'dsh']) })
    expect(r2[0].agents).toEqual(['DeepSeek Harness'])
  })

  it('honours agent home env overrides', () => {
    const grokHome = join(home, 'custom-grok')
    mkdirSync(grokHome)
    const r = syncBrowserSkill(true, { home, env: { GROK_HOME: grokHome }, foundCommands: FOUND })
    expect(r.find((x) => x.agent === 'grok')?.path).toBe(join(grokHome, 'skills', 'braid-browser'))
  })

  it('writes once to agent folders linked to the shared folder', () => {
    mkdirSync(join(home, '.agents', 'skills'), { recursive: true })
    symlinkSync(join(home, '.agents', 'skills'), join(home, '.claude', 'skills'))
    const r = syncBrowserSkill(true, { home, env: {}, foundCommands: FOUND })
    expect(r.map((x) => x.agent)).toEqual(['shared', 'grok'])
    expect(r[0].agents).toContain('Claude Code')
  })

  it('keeps a pre-existing empty folder it did not create', () => {
    mkdirSync(skillDir('.claude'), { recursive: true })
    syncBrowserSkill(true, { home, env: {}, foundCommands: FOUND })
    syncBrowserSkill(false, { home, env: {}, foundCommands: FOUND })
    expect(existsSync(skillDir('.claude'))).toBe(true)
  })
})
