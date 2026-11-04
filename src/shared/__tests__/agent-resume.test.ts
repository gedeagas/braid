import { describe, it, expect } from 'vitest'
import {
  buildResumeCommand,
  isDeliberateSessionEnd,
  isResumableAgent,
  normalizeResumeSession,
  normalizeSessionCwd,
  normalizeSessionId,
  parseHookSessionUpdate,
  shellQuote,
} from '../agent-resume'

describe('normalizeSessionId', () => {
  it('accepts uuid-style and prefixed ids', () => {
    expect(normalizeSessionId('5f0c2a1e-9b7d-4c1e-8f00-1234567890ab')).toBe('5f0c2a1e-9b7d-4c1e-8f00-1234567890ab')
    expect(normalizeSessionId('  session_abc.123:x  ')).toBe('session_abc.123:x')
  })

  it('rejects anything that could break out of a shell word', () => {
    for (const bad of ['a b', 'a;rm -rf ~', '$(id)', '`id`', "a'b", 'a"b', 'a\nb', '-rf', '']) {
      expect(normalizeSessionId(bad)).toBeNull()
    }
  })

  it('rejects non-strings and oversized ids', () => {
    expect(normalizeSessionId(42)).toBeNull()
    expect(normalizeSessionId(undefined)).toBeNull()
    expect(normalizeSessionId('a'.repeat(257))).toBeNull()
  })
})

describe('normalizeSessionCwd', () => {
  it('accepts absolute paths, including spaces', () => {
    expect(normalizeSessionCwd('/Users/me/My Repo/pkg')).toBe('/Users/me/My Repo/pkg')
  })

  it('strips a trailing slash but keeps root', () => {
    expect(normalizeSessionCwd('/repo/pkg/')).toBe('/repo/pkg')
    expect(normalizeSessionCwd('/')).toBe('/')
  })

  it('rejects relative paths and control characters', () => {
    expect(normalizeSessionCwd('repo/pkg')).toBeNull()
    expect(normalizeSessionCwd('/repo\n/pkg')).toBeNull()
    expect(normalizeSessionCwd('/repo\u0007')).toBeNull()
    expect(normalizeSessionCwd(7)).toBeNull()
  })
})

describe('normalizeResumeSession', () => {
  it('round-trips a valid persisted session', () => {
    expect(normalizeResumeSession({ agent: 'claude', id: 'abc-1', cwd: '/r' })).toEqual({ agent: 'claude', id: 'abc-1', cwd: '/r' })
    expect(normalizeResumeSession({ agent: 'codex', id: 'abc-1' })).toEqual({ agent: 'codex', id: 'abc-1' })
  })

  it('drops an invalid cwd but keeps the session', () => {
    expect(normalizeResumeSession({ agent: 'claude', id: 'abc', cwd: 'relative' })).toEqual({ agent: 'claude', id: 'abc' })
  })

  it('rejects unknown agents, bad ids and junk (persisted data is untrusted)', () => {
    expect(normalizeResumeSession({ agent: 'aider', id: 'abc' })).toBeNull()
    expect(normalizeResumeSession({ agent: 'claude', id: '$(id)' })).toBeNull()
    expect(normalizeResumeSession(null)).toBeNull()
    expect(normalizeResumeSession('claude')).toBeNull()
  })
})

describe('isResumableAgent', () => {
  it('covers agents with a resume-by-id CLI flag', () => {
    for (const a of ['claude', 'codex', 'gemini', 'cursor', 'copilot', 'grok', 'droid', 'hermes']) {
      expect(isResumableAgent(a)).toBe(true)
    }
    expect(isResumableAgent('aider')).toBe(false)
    expect(isResumableAgent(undefined)).toBe(false)
  })
})

describe('isDeliberateSessionEnd', () => {
  it('treats an explicit Claude exit or logout as deliberate', () => {
    expect(isDeliberateSessionEnd('claude', 'prompt_input_exit')).toBe(true)
    expect(isDeliberateSessionEnd('claude', 'logout')).toBe(true)
  })

  it('keeps the session on /clear (a new id follows) and on unknown reasons (could be a kill)', () => {
    expect(isDeliberateSessionEnd('claude', 'clear')).toBe(false)
    expect(isDeliberateSessionEnd('claude', 'other')).toBe(false)
    expect(isDeliberateSessionEnd('claude', undefined)).toBe(false)
  })
})

describe('shellQuote', () => {
  it('single-quotes and escapes embedded single quotes', () => {
    expect(shellQuote('/a b')).toBe("'/a b'")
    expect(shellQuote("it's")).toBe("'it'\\''s'")
  })
})

describe('buildResumeCommand', () => {
  const wt = '/Users/me/wt'

  it('builds the per-agent resume invocation from the launch command', () => {
    const cases: Array<[string, string, string]> = [
      ['claude', 'claude', "claude --resume 'S1'"],
      ['codex', 'codex', "codex resume 'S1'"],
      ['gemini', 'gemini', "gemini --resume 'S1'"],
      ['cursor', 'cursor-agent', "cursor-agent --resume 'S1'"],
      ['copilot', 'copilot', "copilot '--resume=S1'"],
      ['grok', 'grok', "grok --resume 'S1'"],
      ['droid', 'droid', "droid --resume 'S1'"],
      ['hermes', 'hermes --tui', "hermes --tui --resume 'S1'"],
    ]
    for (const [agent, launchCmd, expected] of cases) {
      expect(buildResumeCommand({ agent, id: 'S1' }, launchCmd, wt)).toBe(expected)
    }
  })

  it('resumes in the folder the agent ran in when it is inside the worktree', () => {
    expect(buildResumeCommand({ agent: 'claude', id: 'S1', cwd: '/Users/me/wt/packages/app' }, 'claude', wt))
      .toBe("cd '/Users/me/wt/packages/app' && claude --resume 'S1'")
  })

  it('ignores a cwd equal to, or outside, the worktree', () => {
    expect(buildResumeCommand({ agent: 'claude', id: 'S1', cwd: wt }, 'claude', wt)).toBe("claude --resume 'S1'")
    expect(buildResumeCommand({ agent: 'claude', id: 'S1', cwd: '/Users/me/other' }, 'claude', wt)).toBe("claude --resume 'S1'")
    // Prefix-but-not-child must not count as inside.
    expect(buildResumeCommand({ agent: 'claude', id: 'S1', cwd: '/Users/me/wt-2' }, 'claude', wt)).toBe("claude --resume 'S1'")
  })

  it('returns null for agents without resume support or unsafe ids', () => {
    expect(buildResumeCommand({ agent: 'aider', id: 'S1' }, 'aider', wt)).toBeNull()
    expect(buildResumeCommand({ agent: 'claude', id: 'x;y' }, 'claude', wt)).toBeNull()
  })

  it('returns null without a launch command', () => {
    expect(buildResumeCommand({ agent: 'claude', id: 'S1' }, '', wt)).toBeNull()
  })
})

describe('parseHookSessionUpdate', () => {
  it('extracts a session from any hook event carrying an id', () => {
    expect(parseHookSessionUpdate('claude', { terminalId: 'bt-1', event: 'PreToolUse', sessionId: 'S1', cwd: '/r' }))
      .toEqual({ terminalId: 'bt-1', session: { agent: 'claude', id: 'S1', cwd: '/r' } })
  })

  it('clears the session on a deliberate exit', () => {
    expect(parseHookSessionUpdate('claude', { terminalId: 'bt-1', event: 'SessionEnd', sessionId: 'S1', reason: 'prompt_input_exit' }))
      .toEqual({ terminalId: 'bt-1', session: null })
  })

  it('ignores a SessionEnd that is not deliberate (clear / kill)', () => {
    expect(parseHookSessionUpdate('claude', { terminalId: 'bt-1', event: 'SessionEnd', sessionId: 'S1', reason: 'clear' })).toBeNull()
    expect(parseHookSessionUpdate('claude', { terminalId: 'bt-1', event: 'SessionEnd', sessionId: 'S1', reason: 'other' })).toBeNull()
  })

  it('ignores unsafe ids, missing terminals and non-resumable agents', () => {
    expect(parseHookSessionUpdate('claude', { terminalId: 'bt-1', event: 'Stop', sessionId: 'a b' })).toBeNull()
    expect(parseHookSessionUpdate('claude', { event: 'Stop', sessionId: 'S1' })).toBeNull()
    expect(parseHookSessionUpdate('antigravity', { terminalId: 'bt-1', event: 'Stop', sessionId: 'S1' })).toBeNull()
    expect(parseHookSessionUpdate('claude', null)).toBeNull()
  })
})
