import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type * as Os from 'os'

const homedirMock = vi.hoisted(() => vi.fn<() => string>())

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof Os>()
  return {
    ...actual,
    homedir: homedirMock,
  }
})

let tmpHome: string

beforeEach(() => {
  vi.resetModules()
  tmpHome = mkdtempSync(join(tmpdir(), 'braid-codex-hooks-'))
  homedirMock.mockReturnValue(tmpHome)
})

afterEach(() => {
  rmSync(tmpHome, { recursive: true, force: true })
  vi.clearAllMocks()
})

async function loadCodexHookService(): Promise<typeof import('../agentHooks/codex')> {
  return import('../agentHooks/codex')
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf-8')) as unknown
}

describe('codex hook service', () => {
  it('installs Codex hooks with config.toml trust entries', async () => {
    const { ensureHooks, areHooksInstalled } = await loadCodexHookService()

    ensureHooks()

    expect(areHooksInstalled()).toBe(true)

    const hooksPath = join(tmpHome, '.codex', 'hooks.json')
    const hooksConfig = readJson(hooksPath) as {
      hooks: Record<string, { hooks?: { command?: string }[] }[]>
    }
    expect(Object.keys(hooksConfig.hooks).sort()).toEqual([
      'PermissionRequest',
      'PostToolUse',
      'PreToolUse',
      'SessionStart',
      'Stop',
      'UserPromptSubmit',
    ].sort())
    expect(hooksConfig.hooks.PreToolUse?.[0]?.hooks?.[0]?.command).toBe(
      '~/.braid/hooks/agent-status-codex.sh'
    )

    const configToml = readFileSync(join(tmpHome, '.codex', 'config.toml'), 'utf-8')
    expect(configToml).toContain(':pre_tool_use:0:0')
    expect(configToml).toContain('trusted_hash = "sha256:')

    const script = readFileSync(join(tmpHome, '.braid', 'hooks', 'agent-status-codex.sh'), 'utf-8')
    expect(script).toContain('BRAID_HOOK_VERSION=11')
    expect(script).toContain('[ -z "$BRAID_HOOK_PORT" ] || [ -z "$BRAID_HOOK_TOKEN" ] || [ -z "$BRAID_TERMINAL_ID" ]')
    expect(script).toContain('\\"name\\"')
  })

  it('trusts the actual managed hook index when user hooks already exist', async () => {
    const codexDir = join(tmpHome, '.codex')
    mkdirSync(codexDir, { recursive: true })
    writeFileSync(
      join(codexDir, 'hooks.json'),
      JSON.stringify({
        hooks: {
          PreToolUse: [{ hooks: [{ type: 'command', command: 'user-hook' }] }],
        },
      }),
      'utf-8'
    )

    const { ensureHooks, areHooksInstalled } = await loadCodexHookService()
    ensureHooks()

    expect(areHooksInstalled()).toBe(true)
    const configToml = readFileSync(join(codexDir, 'config.toml'), 'utf-8')
    expect(configToml).toContain(':pre_tool_use:1:0')
  })

  it('removes managed hooks and their trust entries', async () => {
    const { ensureHooks, removeHooks, areHooksInstalled } = await loadCodexHookService()

    ensureHooks()
    removeHooks()

    expect(areHooksInstalled()).toBe(false)
    const hooksConfig = readJson(join(tmpHome, '.codex', 'hooks.json')) as {
      hooks: Record<string, { hooks?: { command?: string }[] }[]>
    }
    expect(JSON.stringify(hooksConfig)).not.toContain('agent-status-codex.sh')

    const configPath = join(tmpHome, '.codex', 'config.toml')
    expect(existsSync(configPath) ? readFileSync(configPath, 'utf-8') : '').not.toContain(':pre_tool_use:')
  })
})
