import { describe, it, expect, vi, beforeEach } from 'vitest'
import { homedir } from 'os'
import { join } from 'path'

// Mock fs before importing module
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs')
  return {
    ...actual,
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
  }
})

import { existsSync, readFileSync, writeFileSync } from 'fs'
import {
  getMcpServersFromClaudeJson,
  setMcpServersToClaudeJson,
  getProjectMcpServersFromClaudeJson,
  _test,
} from '../claudeConfigMcp'

const CLAUDE_JSON_PATH = join(homedir(), '.claude.json')

function mockClaudeJson(data: Record<string, unknown>): void {
  vi.mocked(existsSync).mockImplementation((p) => p === CLAUDE_JSON_PATH)
  vi.mocked(readFileSync).mockImplementation((p) => {
    if (p === CLAUDE_JSON_PATH) return JSON.stringify(data)
    throw new Error(`Unexpected read: ${p}`)
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ── resolveType ─────────────────────────────────────────────────────────────

describe('resolveType', () => {
  const { resolveType } = _test

  it('returns stdio for type: "stdio"', () => {
    expect(resolveType({ type: 'stdio', command: 'node' })).toBe('stdio')
  })

  it('normalizes transportType to type', () => {
    expect(resolveType({ transportType: 'stdio', command: 'node' })).toBe('stdio')
  })

  it('infers stdio when command is present but no type', () => {
    expect(resolveType({ command: 'npx', args: ['-y', 'server'] })).toBe('stdio')
  })

  it('returns sse for type: "sse"', () => {
    expect(resolveType({ type: 'sse', url: 'https://x.com/sse' })).toBe('sse')
  })

  it('returns http for type: "http"', () => {
    expect(resolveType({ type: 'http', url: 'https://x.com/mcp' })).toBe('http')
  })

  it('infers http when only url is present', () => {
    expect(resolveType({ url: 'https://x.com/mcp' })).toBe('http')
  })

  it('defaults to stdio when nothing is present', () => {
    expect(resolveType({})).toBe('stdio')
  })
})

// ── normalizeConfig ─────────────────────────────────────────────────────────

describe('normalizeConfig', () => {
  const { normalizeConfig } = _test

  it('normalizes stdio config', () => {
    const cfg = normalizeConfig({ command: 'node', args: ['index.js'], env: { KEY: 'val' } })
    expect(cfg).toEqual({ type: 'stdio', command: 'node', args: ['index.js'], env: { KEY: 'val' } })
  })

  it('normalizes http config without undefined keys', () => {
    const cfg = normalizeConfig({ type: 'http', url: 'https://mcp.example.com' })
    expect(cfg).toEqual({ type: 'http', url: 'https://mcp.example.com' })
    expect('headers' in cfg).toBe(false)
  })

  it('normalizes sse config with headers', () => {
    const cfg = normalizeConfig({ type: 'sse', url: 'https://x.com/sse', headers: { Auth: 'Bearer x' } })
    expect(cfg).toEqual({ type: 'sse', url: 'https://x.com/sse', headers: { Auth: 'Bearer x' } })
  })

  it('handles transportType legacy field without undefined keys', () => {
    const cfg = normalizeConfig({ transportType: 'stdio', command: 'node', args: ['srv.js'] })
    expect(cfg).toEqual({ type: 'stdio', command: 'node', args: ['srv.js'] })
    expect('env' in cfg).toBe(false)
  })
})

// ── extractExtras ───────────────────────────────────────────────────────────

describe('extractExtras', () => {
  const { extractExtras } = _test

  it('extracts non-standard fields', () => {
    const extras = extractExtras({
      type: 'stdio', command: 'node', autoApprove: ['search'], timeout: 60,
    })
    expect(extras).toEqual({ autoApprove: ['search'], timeout: 60 })
  })

  it('returns empty object when no extras', () => {
    expect(extractExtras({ type: 'http', url: 'https://x.com' })).toEqual({})
  })
})

// ── getMcpServersFromClaudeJson ─────────────────────────────────────────────

describe('getMcpServersFromClaudeJson', () => {
  it('returns empty when file does not exist', () => {
    vi.mocked(existsSync).mockReturnValue(false)
    expect(getMcpServersFromClaudeJson()).toEqual([])
  })

  it('reads servers with correct format normalization', () => {
    mockClaudeJson({
      mcpServers: {
        semantic: { type: 'stdio', command: 'node', args: ['index.js'], env: { ROOT: '/app' } },
        notion: { type: 'http', url: 'https://mcp.notion.com/mcp' },
        sg: { transportType: 'stdio', command: 'node', args: ['sg.js'], autoApprove: ['search'], timeout: 60, disabled: false },
      },
    })

    const servers = getMcpServersFromClaudeJson()
    expect(servers).toHaveLength(3)

    expect(servers[0]).toEqual({
      name: 'semantic',
      enabled: true,
      config: { type: 'stdio', command: 'node', args: ['index.js'], env: { ROOT: '/app' } },
      source: { kind: 'user', file: 'claude.json' },
    })

    expect(servers[1]).toEqual({
      name: 'notion',
      enabled: true,
      config: { type: 'http', url: 'https://mcp.notion.com/mcp' },
      source: { kind: 'user', file: 'claude.json' },
    })

    // transportType normalized, extras stripped from config, no undefined keys
    expect(servers[2].config).toEqual({ type: 'stdio', command: 'node', args: ['sg.js'] })
    expect(servers[2].enabled).toBe(true)
  })

  it('marks disabled servers as enabled: false', () => {
    mockClaudeJson({
      mcpServers: { github: { type: 'stdio', command: 'gh', disabled: true } },
    })
    const [entry] = getMcpServersFromClaudeJson()
    expect(entry.enabled).toBe(false)
  })
})

// ── setMcpServersToClaudeJson ───────────────────────────────────────────────

describe('setMcpServersToClaudeJson', () => {
  it('writes servers to ~/.claude.json preserving other data', () => {
    const existing = { numStartups: 42, theme: 'dark', mcpServers: {} }
    mockClaudeJson(existing)

    setMcpServersToClaudeJson([
      { name: 'test', enabled: true, config: { type: 'stdio', command: 'node', args: ['srv.js'] } },
    ])

    expect(writeFileSync).toHaveBeenCalledWith(
      CLAUDE_JSON_PATH,
      expect.any(String),
      'utf-8',
    )
    const written = JSON.parse(vi.mocked(writeFileSync).mock.calls[0][1] as string)
    expect(written.numStartups).toBe(42)
    expect(written.theme).toBe('dark')
    expect(written.mcpServers.test).toEqual({ type: 'stdio', command: 'node', args: ['srv.js'] })
  })

  it('preserves extra fields (autoApprove, timeout) on round-trip', () => {
    mockClaudeJson({
      mcpServers: {
        sg: { type: 'stdio', command: 'node', args: ['old.js'], autoApprove: ['search'], timeout: 60 },
      },
    })

    setMcpServersToClaudeJson([
      { name: 'sg', enabled: true, config: { type: 'stdio', command: 'node', args: ['new.js'] } },
    ])

    const written = JSON.parse(vi.mocked(writeFileSync).mock.calls[0][1] as string)
    expect(written.mcpServers.sg.args).toEqual(['new.js'])
    expect(written.mcpServers.sg.autoApprove).toEqual(['search'])
    expect(written.mcpServers.sg.timeout).toBe(60)
  })

  it('sets disabled: true for disabled servers', () => {
    mockClaudeJson({ mcpServers: {} })

    setMcpServersToClaudeJson([
      { name: 'off', enabled: false, config: { type: 'http', url: 'https://x.com' } },
    ])

    const written = JSON.parse(vi.mocked(writeFileSync).mock.calls[0][1] as string)
    expect(written.mcpServers.off.disabled).toBe(true)
  })

  it('removes legacy transportType on write', () => {
    mockClaudeJson({
      mcpServers: { sg: { transportType: 'stdio', command: 'node', args: ['sg.js'] } },
    })

    setMcpServersToClaudeJson([
      { name: 'sg', enabled: true, config: { type: 'stdio', command: 'node', args: ['sg.js'] } },
    ])

    const written = JSON.parse(vi.mocked(writeFileSync).mock.calls[0][1] as string)
    expect(written.mcpServers.sg.transportType).toBeUndefined()
    expect(written.mcpServers.sg.type).toBe('stdio')
  })
})

// ── getProjectMcpServersFromClaudeJson ──────────────────────────────────────

describe('getProjectMcpServersFromClaudeJson', () => {
  it('returns empty when project has no entry', () => {
    mockClaudeJson({ projects: {} })
    expect(getProjectMcpServersFromClaudeJson('/some/path')).toEqual([])
  })

  it('reads project-level servers with disabled handling', () => {
    mockClaudeJson({
      projects: {
        '/my/project': {
          mcpServers: {
            atlassian: { type: 'sse', url: 'https://mcp.atlassian.com/v1/sse' },
            github: { type: 'stdio', command: 'gh', disabled: true },
          },
          disabledMcpServers: ['notion'],
        },
      },
    })

    const servers = getProjectMcpServersFromClaudeJson('/my/project')
    expect(servers).toHaveLength(2)

    expect(servers[0].name).toBe('atlassian')
    expect(servers[0].enabled).toBe(true)
    expect(servers[0].source).toEqual({ kind: 'project', projectPath: '/my/project', file: 'claude.json' })

    expect(servers[1].name).toBe('github')
    expect(servers[1].enabled).toBe(false)
  })

  it('respects disabledMcpServers array', () => {
    mockClaudeJson({
      projects: {
        '/proj': {
          mcpServers: { notion: { type: 'http', url: 'https://notion.com/mcp' } },
          disabledMcpServers: ['notion'],
        },
      },
    })

    const [entry] = getProjectMcpServersFromClaudeJson('/proj')
    expect(entry.enabled).toBe(false)
  })
})
