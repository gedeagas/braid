import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import type { WorkerEvent, AgentSettings } from '../agentTypes'

// ── SDK mock ──────────────────────────────────────────────────────────
// Must be declared before the dynamic import in agentWorker.ts is evaluated.

function makeAsyncIterable(messages: unknown[]) {
  const msgs = [...messages]
  return {
    [Symbol.asyncIterator]: () => ({
      next: async () =>
        msgs.length
          ? { value: msgs.shift(), done: false }
          : { value: undefined, done: true }
    }),
    supportedCommands: vi.fn().mockResolvedValue([])
  }
}

const mockQuery = vi.fn()
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: (...args: unknown[]) => mockQuery(...args),
  createSdkMcpServer: vi.fn().mockReturnValue({ type: 'sdk', name: 'braid', instance: {} }),
  tool: vi.fn().mockImplementation((name: string, _desc: string, _schema: unknown, _handler: unknown) => ({ name })),
}))

// ── claudeConfig mock ─────────────────────────────────────────────────
vi.mock('../claudeConfig', () => ({
  claudeConfigService: {
    getPermissions: vi.fn().mockReturnValue({ allow: [], deny: [] }),
    getProjectPermissions: vi.fn().mockReturnValue({ allow: [], deny: [] }),
    getMcpServers: vi.fn().mockReturnValue([]),
  }
}))

// ── Git service mock ──────────────────────────────────────────────────
vi.mock('../git', () => ({
  gitService: {
    getStagedDiff: vi.fn(),
    getStagedFiles: vi.fn()
  }
}))

vi.mock('../git/status', () => ({
  getStatus: vi.fn().mockResolvedValue([])
}))

vi.mock('../git/worktrees', () => ({
  addWorktree: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('../github', () => ({
  githubService: {
    getPrStatus: vi.fn().mockResolvedValue(null),
    getChecks: vi.fn().mockResolvedValue([])
  }
}))

// ── fs mock (for loadPlugins) ─────────────────────────────────────────
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs')
  return {
    ...actual,
    default: {
      ...actual,
      existsSync: vi.fn().mockReturnValue(false),
      readFileSync: vi.fn().mockImplementation(() => {
        throw new Error('ENOENT')
      })
    },
    existsSync: vi.fn().mockReturnValue(false),
    readFileSync: vi.fn().mockImplementation(() => {
      throw new Error('ENOENT')
    })
  }
})

import {
  buildUserContent,
  cleanCommitMessage,
  cleanSessionTitle,
  loadPlugins,
  globMatch,
  ruleMatch,
  matchesDenyList,
  matchesRuleList,
  AgentWorker
} from '../agentWorker'
import { claudeConfigService } from '../claudeConfig'
import { gitService } from '../git'
import fs from 'fs'

const defaultSettings: AgentSettings = { apiKey: null, systemPromptSuffix: '', claudeCodeExecutablePath: '', bypassPermissions: true, outputCompression: false, rtkDebug: false }

// ═══════════════════════════════════════════════════════════════════════
// Group A: Pure functions (no mocks needed)
// ═══════════════════════════════════════════════════════════════════════

describe('buildUserContent', () => {
  it('returns text block for text-only input', () => {
    const result = buildUserContent('hello world')
    expect(result).toEqual([{ type: 'text', text: 'hello world' }])
  })

  it('returns image blocks first, then text', () => {
    const dataUri = 'data:image/png;base64,iVBORw0KGgo='
    const result = buildUserContent('caption', [dataUri])
    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0KGgo=' }
    })
    expect(result[1]).toEqual({ type: 'text', text: 'caption' })
  })

  it('skips invalid data URIs', () => {
    const result = buildUserContent('text', ['not-a-data-uri', 'data:broken'])
    expect(result).toEqual([{ type: 'text', text: 'text' }])
  })

  it('returns empty array for whitespace-only text and no images', () => {
    expect(buildUserContent('   ')).toEqual([])
    expect(buildUserContent('')).toEqual([])
  })

  it('returns only text when images array is empty', () => {
    const result = buildUserContent('hello', [])
    expect(result).toEqual([{ type: 'text', text: 'hello' }])
  })

  it('returns only image blocks when text is empty', () => {
    const dataUri = 'data:image/jpeg;base64,/9j/4AAQ'
    const result = buildUserContent('', [dataUri])
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ type: 'image' })
  })
})

describe('cleanCommitMessage', () => {
  it('passes through a valid conventional commit message', () => {
    const msg = 'feat(auth): add OAuth2 support'
    expect(cleanCommitMessage(msg)).toBe(msg)
  })

  it('strips markdown fences', () => {
    const msg = '```\nfeat: add feature\n```'
    expect(cleanCommitMessage(msg)).toBe('feat: add feature')
  })

  it('extracts commit line from preamble text', () => {
    const msg = 'Here is the commit message:\nfeat(ui): add dark mode toggle'
    expect(cleanCommitMessage(msg)).toBe('feat(ui): add dark mode toggle')
  })

  it('preserves multi-line body after commit subject', () => {
    const msg = 'fix(api): handle null response\n\n- Added null check\n- Updated tests'
    expect(cleanCommitMessage(msg)).toBe(msg)
  })

  it('handles all valid conventional commit types', () => {
    const types = ['feat', 'fix', 'refactor', 'style', 'docs', 'test', 'chore', 'perf', 'ci', 'build']
    for (const t of types) {
      expect(cleanCommitMessage(`${t}: do something`)).toBe(`${t}: do something`)
    }
  })
})

describe('cleanSessionTitle', () => {
  it('strips </output> closing tag', () => {
    expect(cleanSessionTitle('Fix auth tests</output>')).toBe('Fix auth tests')
  })

  it('removes wrapping double quotes', () => {
    expect(cleanSessionTitle('"Fix auth tests"')).toBe('Fix auth tests')
  })

  it('removes wrapping single quotes', () => {
    expect(cleanSessionTitle("'Fix auth tests'")).toBe('Fix auth tests')
  })

  it('removes markdown fences', () => {
    expect(cleanSessionTitle('```\nFix auth tests\n```')).toBe('Fix auth tests')
  })

  it('strips trailing punctuation', () => {
    expect(cleanSessionTitle('Fix auth tests.')).toBe('Fix auth tests')
    expect(cleanSessionTitle('Fix auth tests!')).toBe('Fix auth tests')
    expect(cleanSessionTitle('Fix auth tests?')).toBe('Fix auth tests')
  })

  it('truncates at 50 chars with ellipsis', () => {
    const long = 'Refactor the entire authentication middleware pipeline for OAuth2'
    const result = cleanSessionTitle(long)
    expect(result.length).toBeLessThanOrEqual(50)
    expect(result).toMatch(/…$/)
  })

  it('returns "New Chat" for empty input', () => {
    expect(cleanSessionTitle('')).toBe('New Chat')
    expect(cleanSessionTitle('   ')).toBe('New Chat')
  })

  it('strips conversational preamble before title', () => {
    // Only stripped if the preamble is longer than the remainder
    expect(cleanSessionTitle('Sure! Here is the title: Fix auth')).toBe('Fix auth')
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Group A.5: loadPlugins (fs mocked)
// ═══════════════════════════════════════════════════════════════════════

describe('loadPlugins', () => {
  beforeEach(() => {
    vi.mocked(fs.existsSync).mockReturnValue(false)
  })

  it('returns empty when no project skills directory exists', () => {
    const result = loadPlugins('/some/project')
    expect(result).toEqual([])
  })

  it('returns project plugin when .claude/skills/ exists', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true)
    const result = loadPlugins('/some/project')
    expect(result).toContainEqual({ type: 'local', path: '/some/project/.claude' })
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Group A.6: Deny list matching
// ═══════════════════════════════════════════════════════════════════════

describe('globMatch', () => {
  it('matches exact strings', () => {
    expect(globMatch('rm', 'rm')).toBe(true)
    expect(globMatch('rm', 'rmdir')).toBe(false)
  })

  it('* matches non-slash chars', () => {
    expect(globMatch('*.env', '.env')).toBe(true)
    expect(globMatch('*.env', 'foo.env')).toBe(true)
    expect(globMatch('*.env', 'path/.env')).toBe(false) // * doesn't cross /
  })

  it('** matches including slashes', () => {
    expect(globMatch('**/.env', 'path/to/.env')).toBe(true)
    expect(globMatch('**/.env', '.env')).toBe(false) // needs a /
  })
})

describe('ruleMatch — Bash (isCommand=true)', () => {
  it('exact pattern blocks only the exact command', () => {
    expect(ruleMatch('rm', 'rm', true)).toBe(true)
    expect(ruleMatch('rm', 'rm -rf /tmp', true)).toBe(true)   // prefix match
    expect(ruleMatch('rm', 'rmdir /tmp', true)).toBe(false)   // word boundary
  })

  it('colon convention: "cmd:*" matches command with any args', () => {
    expect(ruleMatch('git merge:*', 'git merge --ff main', true)).toBe(true)
    expect(ruleMatch('git merge:*', 'git merge', true)).toBe(true)
    expect(ruleMatch('git merge:*', 'git mergetool', true)).toBe(false) // no space boundary
  })

  it('colon convention with no-wildcard prefix still word-boundaries', () => {
    expect(ruleMatch('rm:', 'rm', true)).toBe(true)
    expect(ruleMatch('npm pack:*', 'npm pack --dry-run', true)).toBe(true)
  })

  it('glob pattern works normally for commands', () => {
    expect(ruleMatch('rm**', 'rm -rf /tmp', true)).toBe(true)
    expect(ruleMatch('git*', 'git status', true)).toBe(true)
  })
})

describe('ruleMatch — file paths (isCommand=false)', () => {
  it('basename-only pattern matches files in any directory', () => {
    expect(ruleMatch('.env', '/project/.env', false)).toBe(true)
    expect(ruleMatch('.env', '.env', false)).toBe(true)
    expect(ruleMatch('.env', '/project/.env.local', false)).toBe(false) // exact basename
  })

  it('pattern with / uses full glob match', () => {
    expect(ruleMatch('**/.env', '/project/src/.env', false)).toBe(true)
    expect(ruleMatch('**/.env', '/project/.env.local', false)).toBe(false)
  })
})

describe('matchesDenyList', () => {
  it('returns false for empty rules', () => {
    expect(matchesDenyList('Bash', { command: 'rm -rf /tmp' }, [])).toBe(false)
  })

  it('bare tool name (no pattern) denies all uses of that tool', () => {
    expect(matchesDenyList('Bash', { command: 'anything' }, ['Bash'])).toBe(true)
    expect(matchesDenyList('Read', { file_path: '/some/file' }, ['Bash'])).toBe(false)
  })

  it('denies Bash(rm) for any rm command', () => {
    const rules = ['Bash(rm)']
    expect(matchesDenyList('Bash', { command: 'rm' }, rules)).toBe(true)
    expect(matchesDenyList('Bash', { command: 'rm -rf /tmp' }, rules)).toBe(true)
    expect(matchesDenyList('Bash', { command: 'rmdir /tmp' }, rules)).toBe(false)
  })

  it('denies Read(.env) for any .env file path', () => {
    const rules = ['Read(.env)']
    expect(matchesDenyList('Read', { file_path: '/project/.env' }, rules)).toBe(true)
    expect(matchesDenyList('Read', { file_path: '.env' }, rules)).toBe(true)
    expect(matchesDenyList('Read', { file_path: '/project/.env.local' }, rules)).toBe(false)
  })

  it('handles Claude Code colon convention: Bash(git merge:*)', () => {
    const rules = ['Bash(git merge:*)']
    expect(matchesDenyList('Bash', { command: 'git merge --ff main' }, rules)).toBe(true)
    expect(matchesDenyList('Bash', { command: 'git status' }, rules)).toBe(false)
  })

  it('ignores malformed rules', () => {
    expect(matchesDenyList('Bash', { command: 'rm' }, ['(invalid'])).toBe(false)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Group A.7: matchesRuleList — full Claude Code parity
// ═══════════════════════════════════════════════════════════════════════

describe('matchesRuleList — Bash (space format + backward compat)', () => {
  it('space-format wildcard: Bash(git *) matches any git subcommand', () => {
    const rules = ['Bash(git *)']
    expect(matchesRuleList('Bash', { command: 'git commit -m "foo"' }, rules)).toBe(true)
    expect(matchesRuleList('Bash', { command: 'git push origin main' }, rules)).toBe(true)
    expect(matchesRuleList('Bash', { command: 'git' }, rules)).toBe(true) // bare git
  })

  it('space-format enforces word boundary: Bash(ls *) does not match lsof', () => {
    const rules = ['Bash(ls *)']
    expect(matchesRuleList('Bash', { command: 'ls -la' }, rules)).toBe(true)
    expect(matchesRuleList('Bash', { command: 'lsof' }, rules)).toBe(false)
  })

  it('legacy colon format still works: Bash(git:*)', () => {
    const rules = ['Bash(git:*)']
    expect(matchesRuleList('Bash', { command: 'git commit' }, rules)).toBe(true)
    expect(matchesRuleList('Bash', { command: 'npm install' }, rules)).toBe(false)
  })

  it('bare Bash matches all commands', () => {
    expect(matchesRuleList('Bash', { command: 'any command' }, ['Bash'])).toBe(true)
  })

  it('unrelated tool is not matched by Bash rule', () => {
    expect(matchesRuleList('Read', { file_path: '/foo' }, ['Bash(rm *)'])).toBe(false)
  })
})

describe('matchesRuleList — tool family coverage (Edit/Read/Bash rules)', () => {
  it('Edit rule matches Write, MultiEdit, NotebookEdit', () => {
    const rules = ['Edit']
    expect(matchesRuleList('Write', { file_path: '/src/foo.ts' }, rules)).toBe(true)
    expect(matchesRuleList('MultiEdit', { file_path: '/src/foo.ts' }, rules)).toBe(true)
    expect(matchesRuleList('NotebookEdit', { file_path: '/nb.ipynb' }, rules)).toBe(true)
    expect(matchesRuleList('Read', { file_path: '/src/foo.ts' }, rules)).toBe(false)
  })

  it('Edit(path) specifier is checked against file_path for all edit tools', () => {
    const rules = ['Edit(/src/*)']
    expect(matchesRuleList('Write', { file_path: '/src/foo.ts' }, rules)).toBe(true)
    expect(matchesRuleList('MultiEdit', { file_path: '/src/bar.ts' }, rules)).toBe(true)
    expect(matchesRuleList('Write', { file_path: '/other/foo.ts' }, rules)).toBe(false)
  })

  it('Read rule matches Glob and Grep', () => {
    const rules = ['Read']
    expect(matchesRuleList('Glob', { pattern: '**/*.ts' }, rules)).toBe(true)
    expect(matchesRuleList('Grep', { pattern: 'foo' }, rules)).toBe(true)
    expect(matchesRuleList('Write', { file_path: '/src/foo.ts' }, rules)).toBe(false)
  })

  it('Bash rule (with specifier) matches BashOutput and KillBash', () => {
    const rules = ['Bash(npm *)']
    expect(matchesRuleList('BashOutput', { command: 'npm install' }, rules)).toBe(true)
    expect(matchesRuleList('KillBash', { command: 'npm run dev' }, rules)).toBe(true)
    expect(matchesRuleList('BashOutput', { command: 'yarn install' }, rules)).toBe(false)
  })

  it('bare Bash rule matches BashOutput and KillBash', () => {
    expect(matchesRuleList('BashOutput', { command: 'anything' }, ['Bash'])).toBe(true)
    expect(matchesRuleList('KillBash', { command: 'anything' }, ['Bash'])).toBe(true)
  })
})

describe('matchesRuleList — MCP tools', () => {
  it('mcp__server__* wildcard matches all tools from that server', () => {
    const rules = ['mcp__puppeteer__*']
    expect(matchesRuleList('mcp__puppeteer__navigate', {}, rules)).toBe(true)
    expect(matchesRuleList('mcp__puppeteer__screenshot', {}, rules)).toBe(true)
    expect(matchesRuleList('mcp__other__navigate', {}, rules)).toBe(false)
  })

  it('bare mcp__server name matches all tools from that server', () => {
    const rules = ['mcp__puppeteer']
    expect(matchesRuleList('mcp__puppeteer__navigate', {}, rules)).toBe(true)
    expect(matchesRuleList('mcp__puppeteer__screenshot', {}, rules)).toBe(true)
    expect(matchesRuleList('mcp__other__tool', {}, rules)).toBe(false)
  })

  it('exact mcp tool name matches only that specific tool', () => {
    const rules = ['mcp__puppeteer__navigate']
    expect(matchesRuleList('mcp__puppeteer__navigate', {}, rules)).toBe(true)
    expect(matchesRuleList('mcp__puppeteer__screenshot', {}, rules)).toBe(false)
  })

  it('MCP server names with hyphens parse and match correctly (regex bug fix)', () => {
    const rules = ['mcp__slack-server__*']
    expect(matchesRuleList('mcp__slack-server__search_messages', {}, rules)).toBe(true)
    expect(matchesRuleList('mcp__slack-server__post_message', {}, rules)).toBe(true)
    expect(matchesRuleList('mcp__other-server__search', {}, rules)).toBe(false)
  })

  it('bare MCP server name with hyphens matches all its tools', () => {
    const rules = ['mcp__slack-server']
    expect(matchesRuleList('mcp__slack-server__search_messages', {}, rules)).toBe(true)
    expect(matchesRuleList('mcp__slack-server__get_messages', {}, rules)).toBe(true)
    expect(matchesRuleList('mcp__other-server__get', {}, rules)).toBe(false)
  })

  it('mcp__server__* does not partially match a different server', () => {
    const rules = ['mcp__jira__*']
    expect(matchesRuleList('mcp__jira-advanced__get_issue', {}, rules)).toBe(false)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Group A.8: canUseTool — allow list enforcement
// ═══════════════════════════════════════════════════════════════════════

type CanUseTool = (
  toolName: string,
  input: Record<string, unknown>,
  ctx: { signal: AbortSignal; toolUseID?: string }
) => Promise<{ behavior: string; updatedInput?: Record<string, unknown>; message?: string }>

/** Extract the canUseTool callback from the most recent mockQuery call. */
function captureCanUseTool(): CanUseTool {
  const call = mockQuery.mock.calls[mockQuery.mock.calls.length - 1]
  return (call[0] as { options: { canUseTool: CanUseTool } }).options.canUseTool
}

describe('canUseTool — allow list auto-approves pre-approved tools', () => {
  let worker: AgentWorker
  const noBypassSettings = { ...defaultSettings, bypassPermissions: false }
  const signal = new AbortController().signal

  beforeEach(() => {
    worker = new AgentWorker(() => {})
    mockQuery.mockReset()
    mockQuery.mockReturnValue(makeAsyncIterable([]))
    vi.mocked(claudeConfigService.getPermissions).mockReturnValue({ allow: [], deny: [] })
    vi.mocked(claudeConfigService.getProjectPermissions).mockReturnValue({ allow: [], deny: [] })
  })

  it('auto-allows a tool matched by allow rule — no waiting_input emitted', async () => {
    vi.mocked(claudeConfigService.getPermissions).mockReturnValue({ allow: ['Read'], deny: [] })
    await worker.startSession('s1', 'wt-1', 'test', '/tmp', 'hi', 'claude-sonnet-4-6', false, false, 'high', false, 'Chat', noBypassSettings)

    const canUseTool = captureCanUseTool()
    const result = await canUseTool('Read', { file_path: '/src/foo.ts' }, { signal })
    expect(result.behavior).toBe('allow')
  })

  it('auto-allows Glob via Read allow rule', async () => {
    vi.mocked(claudeConfigService.getPermissions).mockReturnValue({ allow: ['Read'], deny: [] })
    await worker.startSession('s1', 'wt-1', 'test', '/tmp', 'hi', 'claude-sonnet-4-6', false, false, 'high', false, 'Chat', noBypassSettings)

    const canUseTool = captureCanUseTool()
    const result = await canUseTool('Glob', { pattern: '**/*.ts' }, { signal })
    expect(result.behavior).toBe('allow')
  })

  it('auto-allows Write via Edit allow rule', async () => {
    vi.mocked(claudeConfigService.getPermissions).mockReturnValue({ allow: ['Edit'], deny: [] })
    await worker.startSession('s1', 'wt-1', 'test', '/tmp', 'hi', 'claude-sonnet-4-6', false, false, 'high', false, 'Chat', noBypassSettings)

    const canUseTool = captureCanUseTool()
    const result = await canUseTool('Write', { file_path: '/src/foo.ts' }, { signal })
    expect(result.behavior).toBe('allow')
  })

  it('auto-allows MCP tool via server wildcard allow rule', async () => {
    vi.mocked(claudeConfigService.getPermissions).mockReturnValue({ allow: ['mcp__puppeteer__*'], deny: [] })
    await worker.startSession('s1', 'wt-1', 'test', '/tmp', 'hi', 'claude-sonnet-4-6', false, false, 'high', false, 'Chat', noBypassSettings)

    const canUseTool = captureCanUseTool()
    const result = await canUseTool('mcp__puppeteer__navigate', {}, { signal })
    expect(result.behavior).toBe('allow')
  })

  it('auto-allows MCP tool with hyphenated server name', async () => {
    vi.mocked(claudeConfigService.getPermissions).mockReturnValue({ allow: ['mcp__slack-server__*'], deny: [] })
    await worker.startSession('s1', 'wt-1', 'test', '/tmp', 'hi', 'claude-sonnet-4-6', false, false, 'high', false, 'Chat', noBypassSettings)

    const canUseTool = captureCanUseTool()
    const result = await canUseTool('mcp__slack-server__search_messages', {}, { signal })
    expect(result.behavior).toBe('allow')
  })

  it('deny rule wins over allow rule for the same tool', async () => {
    vi.mocked(claudeConfigService.getPermissions).mockReturnValue({
      allow: ['Bash'],
      deny: ['Bash(rm *)'],
    })
    await worker.startSession('s1', 'wt-1', 'test', '/tmp', 'hi', 'claude-sonnet-4-6', false, false, 'high', false, 'Chat', noBypassSettings)

    const canUseTool = captureCanUseTool()
    const result = await canUseTool('Bash', { command: 'rm -rf /tmp' }, { signal })
    expect(result.behavior).toBe('deny')
  })

  it('tool not in allow list triggers waiting_input when not in bypass mode', async () => {
    const emitted: unknown[] = []
    const w = new AgentWorker((e) => emitted.push(e))
    mockQuery.mockReturnValue(makeAsyncIterable([]))
    vi.mocked(claudeConfigService.getPermissions).mockReturnValue({ allow: ['Read'], deny: [] })

    await w.startSession('s1', 'wt-1', 'test', '/tmp', 'hi', 'claude-sonnet-4-6', false, false, 'high', false, 'Chat', noBypassSettings)

    const canUseTool = captureCanUseTool()
    const ac = new AbortController()

    // canUseTool for Bash (not in allow list) should pause and emit waiting_input
    const permPromise = canUseTool('Bash', { command: 'git status' }, { signal: ac.signal, toolUseID: 'tool-123' })
    const waitingEvents = (emitted as Array<{ type: string }>).filter(e => e.type === 'waiting_input')
    expect(waitingEvents).toHaveLength(1)

    // Unblock by answering
    w.answerToolInput('s1', { behavior: 'allow' })
    const result = await permPromise
    expect(result.behavior).toBe('allow')
  })
})

describe('canUseTool — bypassPermissions mode', () => {
  const bypassSettings = { ...defaultSettings, bypassPermissions: true }
  const signal = new AbortController().signal

  beforeEach(() => {
    mockQuery.mockReset()
    mockQuery.mockReturnValue(makeAsyncIterable([]))
    vi.mocked(claudeConfigService.getPermissions).mockReturnValue({ allow: [], deny: [] })
    vi.mocked(claudeConfigService.getProjectPermissions).mockReturnValue({ allow: [], deny: [] })
  })

  it('auto-allows any tool when bypassPermissions is true', async () => {
    const worker = new AgentWorker(() => {})
    await worker.startSession('s1', 'wt-1', 'test', '/tmp', 'hi', 'claude-sonnet-4-6', false, false, 'high', false, 'Chat', bypassSettings)

    const canUseTool = captureCanUseTool()
    const result = await canUseTool('Bash', { command: 'rm -rf /tmp' }, { signal })
    expect(result.behavior).toBe('allow')
  })

  it('no waiting_input emitted for unlisted tool in bypass mode', async () => {
    const emitted: unknown[] = []
    const worker = new AgentWorker((e) => emitted.push(e))
    await worker.startSession('s1', 'wt-1', 'test', '/tmp', 'hi', 'claude-sonnet-4-6', false, false, 'high', false, 'Chat', bypassSettings)

    const canUseTool = captureCanUseTool()
    await canUseTool('Bash', { command: 'git push --force' }, { signal, toolUseID: 'tool-bp-1' })

    const waitingEvents = (emitted as Array<{ type: string }>).filter(e => e.type === 'waiting_input')
    expect(waitingEvents).toHaveLength(0)
  })

  it('global deny list still blocks in bypass mode', async () => {
    vi.mocked(claudeConfigService.getPermissions).mockReturnValue({ allow: [], deny: ['Bash(rm *)'] })
    const worker = new AgentWorker(() => {})
    await worker.startSession('s1', 'wt-1', 'test', '/tmp', 'hi', 'claude-sonnet-4-6', false, false, 'high', false, 'Chat', bypassSettings)

    const canUseTool = captureCanUseTool()
    const result = await canUseTool('Bash', { command: 'rm -rf /tmp' }, { signal })
    expect(result.behavior).toBe('deny')
  })

  it('project deny list still blocks in bypass mode', async () => {
    vi.mocked(claudeConfigService.getProjectPermissions).mockReturnValue({ allow: [], deny: ['Bash(git push *)'] })
    const worker = new AgentWorker(() => {})
    await worker.startSession('s1', 'wt-1', 'test', '/tmp', 'hi', 'claude-sonnet-4-6', false, false, 'high', false, 'Chat', bypassSettings)

    const canUseTool = captureCanUseTool()
    const result = await canUseTool('Bash', { command: 'git push origin main' }, { signal })
    expect(result.behavior).toBe('deny')
  })
})

describe('canUseTool — project-level permissions', () => {
  const noBypassSettings = { ...defaultSettings, bypassPermissions: false }
  const signal = new AbortController().signal

  beforeEach(() => {
    mockQuery.mockReset()
    mockQuery.mockReturnValue(makeAsyncIterable([]))
    vi.mocked(claudeConfigService.getPermissions).mockReturnValue({ allow: [], deny: [] })
    vi.mocked(claudeConfigService.getProjectPermissions).mockReturnValue({ allow: [], deny: [] })
  })

  it('project allow rule auto-approves a tool', async () => {
    vi.mocked(claudeConfigService.getProjectPermissions).mockReturnValue({ allow: ['Bash(npm *)'], deny: [] })
    const worker = new AgentWorker(() => {})
    await worker.startSession('s1', 'wt-1', 'test', '/tmp', 'hi', 'claude-sonnet-4-6', false, false, 'high', false, 'Chat', noBypassSettings)

    const canUseTool = captureCanUseTool()
    const result = await canUseTool('Bash', { command: 'npm install' }, { signal })
    expect(result.behavior).toBe('allow')
  })

  it('project allow rule does not approve a non-matching command', async () => {
    vi.mocked(claudeConfigService.getProjectPermissions).mockReturnValue({ allow: ['Bash(npm *)'], deny: [] })
    const emitted: unknown[] = []
    const worker = new AgentWorker((e) => emitted.push(e))
    await worker.startSession('s1', 'wt-1', 'test', '/tmp', 'hi', 'claude-sonnet-4-6', false, false, 'high', false, 'Chat', noBypassSettings)

    const canUseTool = captureCanUseTool()
    const ac = new AbortController()
    const permPromise = canUseTool('Bash', { command: 'yarn install' }, { signal: ac.signal, toolUseID: 'tool-proj-1' })

    const waitingEvents = (emitted as Array<{ type: string }>).filter(e => e.type === 'waiting_input')
    expect(waitingEvents).toHaveLength(1)

    worker.answerToolInput('s1', { behavior: 'allow' })
    await permPromise
  })

  it('project deny rule blocks even when global allow permits', async () => {
    vi.mocked(claudeConfigService.getPermissions).mockReturnValue({ allow: ['Bash'], deny: [] })
    vi.mocked(claudeConfigService.getProjectPermissions).mockReturnValue({ allow: [], deny: ['Bash(git push *)'] })
    const worker = new AgentWorker(() => {})
    await worker.startSession('s1', 'wt-1', 'test', '/tmp', 'hi', 'claude-sonnet-4-6', false, false, 'high', false, 'Chat', noBypassSettings)

    const canUseTool = captureCanUseTool()
    const result = await canUseTool('Bash', { command: 'git push origin main' }, { signal })
    expect(result.behavior).toBe('deny')
  })

  it('global allow rule auto-approves when project has no allow rules', async () => {
    vi.mocked(claudeConfigService.getPermissions).mockReturnValue({ allow: ['Read'], deny: [] })
    vi.mocked(claudeConfigService.getProjectPermissions).mockReturnValue({ allow: [], deny: [] })
    const worker = new AgentWorker(() => {})
    await worker.startSession('s1', 'wt-1', 'test', '/tmp', 'hi', 'claude-sonnet-4-6', false, false, 'high', false, 'Chat', noBypassSettings)

    const canUseTool = captureCanUseTool()
    const result = await canUseTool('Read', { file_path: '/src/main.ts' }, { signal })
    expect(result.behavior).toBe('allow')
  })

  it('global deny and project deny are merged — both block', async () => {
    vi.mocked(claudeConfigService.getPermissions).mockReturnValue({ allow: [], deny: ['Bash(rm *)'] })
    vi.mocked(claudeConfigService.getProjectPermissions).mockReturnValue({ allow: [], deny: ['Read(.env)'] })
    const worker = new AgentWorker(() => {})
    await worker.startSession('s1', 'wt-1', 'test', '/tmp', 'hi', 'claude-sonnet-4-6', false, false, 'high', false, 'Chat', noBypassSettings)

    const canUseTool = captureCanUseTool()

    const rmResult = await canUseTool('Bash', { command: 'rm -rf /' }, { signal })
    expect(rmResult.behavior).toBe('deny')

    const envResult = await canUseTool('Read', { file_path: '.env' }, { signal })
    expect(envResult.behavior).toBe('deny')
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Group B: Class behavior (SDK mocked)
// ═══════════════════════════════════════════════════════════════════════

describe('AgentWorker', () => {
  let worker: AgentWorker
  let emitted: WorkerEvent[]

  beforeEach(() => {
    emitted = []
    worker = new AgentWorker((event) => emitted.push(event))
    mockQuery.mockReset()
  })

  describe('answerToolInput', () => {
    it('is a no-op when no pending input exists', () => {
      // Should not throw
      worker.answerToolInput('sess-1', { behavior: 'allow' })
    })
  })

  describe('updateSessionName', () => {
    it('updates session name after startSession', async () => {
      mockQuery.mockReturnValue(makeAsyncIterable([]))
      await worker.startSession('s1', 'wt-1', 'test', '/tmp', 'hi', 'claude-sonnet-4-6', false, false, 'high', false, 'Original', defaultSettings)
      worker.updateSessionName('s1', 'Renamed')
      expect(worker.getSession('s1')?.sessionName).toBe('Renamed')
    })
  })

  describe('startSession', () => {
    it('emits done on successful completion', async () => {
      mockQuery.mockReturnValue(makeAsyncIterable([
        { type: 'assistant', message: { content: [{ type: 'text', text: 'hello' }] } }
      ]))
      await worker.startSession('s1', 'wt-1', 'test', '/tmp', 'hi', 'claude-sonnet-4-6', false, false, 'high', false, 'Chat', defaultSettings)

      const doneEvents = emitted.filter(e => e.type === 'done')
      expect(doneEvents).toHaveLength(1)
      expect(doneEvents[0]).toMatchObject({ type: 'done', sessionId: 's1' })
    })

    it('emits init when SDK sends system.init message', async () => {
      mockQuery.mockReturnValue(makeAsyncIterable([
        { type: 'system', subtype: 'init', session_id: 'sdk-123', slash_commands: ['help'], skills: ['my-skill'] }
      ]))
      await worker.startSession('s1', 'wt-1', 'test', '/tmp', 'hi', 'claude-sonnet-4-6', false, false, 'high', false, 'Chat', defaultSettings)

      const initEvents = emitted.filter(e => e.type === 'init')
      expect(initEvents).toHaveLength(1)
      expect(initEvents[0]).toMatchObject({
        type: 'init',
        sessionId: 's1',
        sdkSessionId: 'sdk-123'
      })
    })

    it('emits sdk_message for non-init messages', async () => {
      const msg = { type: 'assistant', message: { content: [{ type: 'text', text: 'yo' }] } }
      mockQuery.mockReturnValue(makeAsyncIterable([msg]))
      await worker.startSession('s1', 'wt-1', 'test', '/tmp', 'hi', 'claude-sonnet-4-6', false, false, 'high', false, 'Chat', defaultSettings)

      const sdkMsgs = emitted.filter(e => e.type === 'sdk_message')
      expect(sdkMsgs).toHaveLength(1)
      expect(sdkMsgs[0]).toMatchObject({ type: 'sdk_message', sessionId: 's1', message: msg })
    })

    it('emits error on SDK failure', async () => {
      mockQuery.mockImplementation(() => {
        throw new Error('SDK exploded')
      })
      await worker.startSession('s1', 'wt-1', 'test', '/tmp', 'hi', 'claude-sonnet-4-6', false, false, 'high', false, 'Chat', defaultSettings)

      const errors = emitted.filter(e => e.type === 'error')
      expect(errors).toHaveLength(1)
      expect(errors[0]).toMatchObject({ type: 'error', sessionId: 's1', message: 'SDK exploded' })
    })

    it('applies API key from settings', async () => {
      const origKey = process.env.ANTHROPIC_API_KEY
      mockQuery.mockReturnValue(makeAsyncIterable([]))
      await worker.startSession('s1', 'wt-1', 'test', '/tmp', 'hi', 'claude-sonnet-4-6', false, false, 'high', false, 'Chat', {
        apiKey: 'sk-test-key',
        systemPromptSuffix: '', claudeCodeExecutablePath: '', bypassPermissions: true, outputCompression: false, rtkDebug: false
      })
      expect(process.env.ANTHROPIC_API_KEY).toBe('sk-test-key')
      // Cleanup
      if (origKey !== undefined) process.env.ANTHROPIC_API_KEY = origKey
      else delete process.env.ANTHROPIC_API_KEY
    })
  })

  describe('sendMessage', () => {
    it('emits error when no sdkSessionId available', async () => {
      await worker.sendMessage('s1', 'msg', '', '/tmp', 'claude-sonnet-4-6', false, 'high', false, 'Chat', defaultSettings)
      const errors = emitted.filter(e => e.type === 'error')
      expect(errors).toHaveLength(1)
      expect(errors[0]).toMatchObject({ message: 'No active SDK session to resume' })
    })

    it('recovers state from params when session map is empty', async () => {
      mockQuery.mockReturnValue(makeAsyncIterable([]))
      await worker.sendMessage('s2', 'msg', 'sdk-abc', '/tmp/proj', 'claude-sonnet-4-6', false, 'high', false, 'Recovered', defaultSettings)
      expect(worker.getSession('s2')).toBeDefined()
      expect(worker.getSession('s2')?.sessionName).toBe('Recovered')
    })

    it('emits done on successful resume', async () => {
      mockQuery.mockReturnValue(makeAsyncIterable([]))
      await worker.sendMessage('s3', 'msg', 'sdk-abc', '/tmp', 'claude-sonnet-4-6', false, 'high', false, 'Chat', defaultSettings)
      const doneEvents = emitted.filter(e => e.type === 'done')
      expect(doneEvents).toHaveLength(1)
    })
  })

  describe('stopSession', () => {
    it('aborts but preserves session state for resume', async () => {
      mockQuery.mockReturnValue(makeAsyncIterable([]))
      await worker.startSession('s1', 'wt-1', 'test', '/tmp', 'hi', 'claude-sonnet-4-6', false, false, 'high', false, 'Chat', defaultSettings)
      await worker.stopSession('s1')
      // Session state still exists
      expect(worker.getSession('s1')).toBeDefined()
      expect(worker.getSession('s1')?.cwd).toBe('/tmp')
    })
  })

  describe('closeSession', () => {
    it('aborts and removes session state', async () => {
      mockQuery.mockReturnValue(makeAsyncIterable([]))
      await worker.startSession('s1', 'wt-1', 'test', '/tmp', 'hi', 'claude-sonnet-4-6', false, false, 'high', false, 'Chat', defaultSettings)
      worker.closeSession('s1')
      expect(worker.getSession('s1')).toBeUndefined()
    })
  })

  describe('generateCommitMessage', () => {
    it('throws on empty staged changes', async () => {
      vi.mocked(gitService.getStagedDiff as Mock).mockResolvedValue('')
      vi.mocked(gitService.getStagedFiles as Mock).mockResolvedValue([])
      await expect(worker.generateCommitMessage('/tmp', defaultSettings)).rejects.toThrow('No staged changes')
    })

    it('returns cleaned commit message from SDK', async () => {
      vi.mocked(gitService.getStagedDiff as Mock).mockResolvedValue('diff --git a/file.ts')
      vi.mocked(gitService.getStagedFiles as Mock).mockResolvedValue(['file.ts'])
      mockQuery.mockReturnValue(makeAsyncIterable([
        { type: 'assistant', message: { content: [{ type: 'text', text: '```\nfeat: add feature\n```' }] } }
      ]))
      const result = await worker.generateCommitMessage('/tmp', defaultSettings)
      expect(result).toBe('feat: add feature')
    })
  })

  describe('generateSessionTitle', () => {
    it('returns cleaned title from SDK', async () => {
      mockQuery.mockReturnValue(makeAsyncIterable([
        { type: 'assistant', message: { content: [{ type: 'text', text: '"Fix auth middleware"</output>' }] } }
      ]))
      const result = await worker.generateSessionTitle('fix auth', 'done', defaultSettings)
      expect(result).toBe('Fix auth middleware')
    })

    it('returns "New Chat" on empty SDK response', async () => {
      mockQuery.mockReturnValue(makeAsyncIterable([]))
      const result = await worker.generateSessionTitle('hi', 'hello', defaultSettings)
      expect(result).toBe('New Chat')
    })
  })

  describe('getSlashCommands', () => {
    it('returns commands from SDK discovery', async () => {
      const iter = makeAsyncIterable([
        { type: 'system', subtype: 'init', session_id: 'x', slash_commands: [], skills: ['my-skill'] }
      ])
      iter.supportedCommands.mockResolvedValue([
        { name: 'help', description: 'Get help' },
        { name: 'my-skill', description: 'Custom skill' }
      ])
      mockQuery.mockReturnValue(iter)
      const result = await worker.getSlashCommands('/tmp')
      expect(result).toHaveLength(2)
      expect(result.find(c => c.name === 'help')).toMatchObject({ source: 'builtin' })
      expect(result.find(c => c.name === 'my-skill')).toMatchObject({ source: 'skill' })
    })

    it('caches results for same cwd', async () => {
      mockQuery.mockReturnValue(makeAsyncIterable([
        { type: 'system', subtype: 'init', session_id: 'x', slash_commands: [], skills: [] }
      ]))
      await worker.getSlashCommands('/cached')
      mockQuery.mockClear()
      await worker.getSlashCommands('/cached')
      expect(mockQuery).not.toHaveBeenCalled()
    })
  })
})
