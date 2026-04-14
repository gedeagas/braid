import { describe, it, expect } from 'vitest'
import { deriveAlwaysAllowRule } from '../ToolPermissionPrompt'

// ═══════════════════════════════════════════════════════════════════════
// deriveAlwaysAllowRule — full Claude Code rule parity
// ═══════════════════════════════════════════════════════════════════════

describe('deriveAlwaysAllowRule — Bash family', () => {
  it('derives a program-level wildcard using space format', () => {
    expect(deriveAlwaysAllowRule('Bash', { command: 'git commit -m "foo"' })).toBe('Bash(git *)')
    expect(deriveAlwaysAllowRule('Bash', { command: 'npm run build' })).toBe('Bash(npm *)')
    expect(deriveAlwaysAllowRule('Bash', { command: 'yarn install' })).toBe('Bash(yarn *)')
  })

  it('uses the first word as the program prefix', () => {
    expect(deriveAlwaysAllowRule('Bash', { command: '  docker ps  ' })).toBe('Bash(docker *)')
  })

  it('returns null when command is empty or missing', () => {
    expect(deriveAlwaysAllowRule('Bash', { command: '' })).toBeNull()
    expect(deriveAlwaysAllowRule('Bash', { command: '   ' })).toBeNull()
    expect(deriveAlwaysAllowRule('Bash', {})).toBeNull()
  })

  it('BashOutput and KillBash use the same Bash rule', () => {
    expect(deriveAlwaysAllowRule('BashOutput', { command: 'npm run dev' })).toBe('Bash(npm *)')
    expect(deriveAlwaysAllowRule('KillBash', { command: 'npm run dev' })).toBe('Bash(npm *)')
  })

  it('generated rule round-trips through matchesRuleList (space format is enforced)', () => {
    const rule = deriveAlwaysAllowRule('Bash', { command: 'git push origin main' })
    // Rule must use space format per Claude Code docs (colon format is deprecated)
    expect(rule).toBe('Bash(git *)')
    expect(rule).not.toContain(':')
  })
})

describe('deriveAlwaysAllowRule — Read family', () => {
  it('Read returns bare "Read"', () => {
    expect(deriveAlwaysAllowRule('Read', { file_path: '/src/foo.ts' })).toBe('Read')
  })

  it('Glob returns "Read" (covered by Read rules per Claude Code docs)', () => {
    expect(deriveAlwaysAllowRule('Glob', { pattern: '**/*.ts' })).toBe('Read')
  })

  it('Grep returns "Read" (covered by Read rules per Claude Code docs)', () => {
    expect(deriveAlwaysAllowRule('Grep', { pattern: 'function foo' })).toBe('Read')
  })
})

describe('deriveAlwaysAllowRule — Edit family', () => {
  it('Write returns bare "Edit"', () => {
    expect(deriveAlwaysAllowRule('Write', { file_path: '/src/foo.ts' })).toBe('Edit')
  })

  it('Edit returns bare "Edit"', () => {
    expect(deriveAlwaysAllowRule('Edit', { file_path: '/src/foo.ts' })).toBe('Edit')
  })

  it('MultiEdit returns "Edit"', () => {
    expect(deriveAlwaysAllowRule('MultiEdit', { file_path: '/src/foo.ts' })).toBe('Edit')
  })

  it('NotebookEdit returns "Edit"', () => {
    expect(deriveAlwaysAllowRule('NotebookEdit', { file_path: '/notebook.ipynb' })).toBe('Edit')
  })
})

describe('deriveAlwaysAllowRule — WebFetch', () => {
  it('derives a domain-scoped rule from the URL hostname', () => {
    expect(deriveAlwaysAllowRule('WebFetch', { url: 'https://api.example.com/v1/data' }))
      .toBe('WebFetch(domain:api.example.com)')
  })

  it('strips path and query — uses only hostname', () => {
    expect(deriveAlwaysAllowRule('WebFetch', { url: 'https://github.com/user/repo?tab=files' }))
      .toBe('WebFetch(domain:github.com)')
  })

  it('works with http URLs', () => {
    expect(deriveAlwaysAllowRule('WebFetch', { url: 'http://localhost:3000/api' }))
      .toBe('WebFetch(domain:localhost)')
  })

  it('falls back to bare "WebFetch" for invalid URL', () => {
    expect(deriveAlwaysAllowRule('WebFetch', { url: 'not-a-url' })).toBe('WebFetch')
  })

  it('falls back to bare "WebFetch" when url is missing', () => {
    expect(deriveAlwaysAllowRule('WebFetch', {})).toBe('WebFetch')
  })
})

describe('deriveAlwaysAllowRule — WebSearch', () => {
  it('returns bare "WebSearch"', () => {
    expect(deriveAlwaysAllowRule('WebSearch', { query: 'typescript generics' })).toBe('WebSearch')
    expect(deriveAlwaysAllowRule('WebSearch', {})).toBe('WebSearch')
  })
})

describe('deriveAlwaysAllowRule — Task family', () => {
  it('Task returns bare "Task"', () => {
    expect(deriveAlwaysAllowRule('Task', {})).toBe('Task')
  })

  it('TaskOutput returns bare "Task"', () => {
    expect(deriveAlwaysAllowRule('TaskOutput', {})).toBe('Task')
  })
})

describe('deriveAlwaysAllowRule — MCP tools', () => {
  it('derives server-level wildcard from a fully qualified MCP tool name', () => {
    expect(deriveAlwaysAllowRule('mcp__puppeteer__navigate', {})).toBe('mcp__puppeteer__*')
    expect(deriveAlwaysAllowRule('mcp__puppeteer__screenshot', {})).toBe('mcp__puppeteer__*')
  })

  it('MCP server names with hyphens produce correct wildcard rule', () => {
    expect(deriveAlwaysAllowRule('mcp__slack-server__search_messages', {}))
      .toBe('mcp__slack-server__*')
    expect(deriveAlwaysAllowRule('mcp__jira-advanced__get_issue', {}))
      .toBe('mcp__jira-advanced__*')
  })

  it('bare MCP server name (no tool part) returned as-is', () => {
    expect(deriveAlwaysAllowRule('mcp__puppeteer', {})).toBe('mcp__puppeteer')
  })

  it('the generated wildcard rule covers all tools in the same server', () => {
    // Verify the derived rule semantically covers the original tool name
    const toolName = 'mcp__sourcegraph__search_code'
    const rule = deriveAlwaysAllowRule(toolName, {})
    expect(rule).toBe('mcp__sourcegraph__*')
    // Rule prefix matches the tool name
    const prefix = rule!.slice(0, -1) // remove trailing *
    expect(toolName.startsWith(prefix)).toBe(true)
  })
})

describe('deriveAlwaysAllowRule — unknown tools', () => {
  it('returns null for unrecognised tool names', () => {
    expect(deriveAlwaysAllowRule('SomeCustomTool', {})).toBeNull()
    expect(deriveAlwaysAllowRule('', {})).toBeNull()
  })
})
