import { describe, it, expect, vi } from 'vitest'

vi.mock('../../claudeConfigMcp', () => ({ getMcpServersFromClaudeJson: () => [], setMcpServersToClaudeJson: vi.fn() }))

import { pathWithBridge, upsertCodexBlock, braidBinDir } from '../agentBridge/install'
import { cliScript, mcpScript } from '../agentBridge/scripts'

describe('upsertCodexBlock', () => {
  const user = 'model = "o3"\n\n[mcp_servers.other]\ncommand = "x"\n'

  it('appends a managed block and keeps user content', () => {
    const out = upsertCodexBlock(user, '/home/u/.braid/bin/braid-browser-mcp')
    expect(out).toContain('model = "o3"')
    expect(out).toContain('[mcp_servers.other]')
    expect(out).toContain('[mcp_servers.braid-browser]\ncommand = "/home/u/.braid/bin/braid-browser-mcp"')
  })

  it('is idempotent and removable', () => {
    const once = upsertCodexBlock(user, '/bin/mcp')
    expect(upsertCodexBlock(once, '/bin/mcp')).toBe(once)
    const removed = upsertCodexBlock(once, null)
    expect(removed).not.toContain('braid-browser')
    expect(removed).toContain('[mcp_servers.other]')
  })
})

describe('upsertCodexBlock after another writer dropped the comments', () => {
  it('still finds and removes the table', () => {
    const rewritten = '[hooks]\nx = 1\n[mcp_servers.braid-browser]\ncommand = "/old"\nargs = []\n[profiles.a]\nmodel = "o3"\n'
    const removed = upsertCodexBlock(rewritten, null)
    expect(removed).not.toContain('braid-browser')
    expect(removed).toContain('[profiles.a]\nmodel = "o3"')
    const replaced = upsertCodexBlock(rewritten, '/new')
    expect(replaced.match(/\[mcp_servers\.braid-browser\]/g)).toHaveLength(1)
    expect(replaced).toContain('command = "/new"')
  })
})

describe('pathWithBridge', () => {
  it('puts the bridge dir first exactly once', () => {
    const dir = braidBinDir()
    expect(pathWithBridge(`/usr/bin:${dir}:/bin`)).toBe(`${dir}:/usr/bin:/bin`)
    expect(pathWithBridge(undefined)).toBe(dir)
  })
})

describe('generated scripts', () => {
  it('are syntactically valid JavaScript', () => {
    // new Function parses without executing the module body.
    expect(() => new Function('require', 'process', 'module', cliScript())).not.toThrow()
    expect(() => new Function('require', 'process', 'module', mcpScript())).not.toThrow()
  })
})
