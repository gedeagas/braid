// ---------------------------------------------------------------------------
// Selector stability tests — prevents infinite re-render loops (React #185)
//
// When a selector passed to useShallow() returns values that fail zustand's
// shallow() check (e.g. `.map(() => ({...}))` creates new objects each call),
// the comparison always reports "changed" → forceStoreRerender → infinite loop.
//
// These tests call each selector twice on the same state and assert that
// zustand's `shallow()` considers them equal.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest'
import { assertSelectorStable } from './selectorStability'
import type { AgentSession } from '@/types'
import type { SessionsState } from '@/store/sessions/storeTypes'

// ── Mock data ───────────────────────────────────────────────────────────────

const mockSession: AgentSession = {
  id: 'sess-1',
  worktreeId: 'wt-1',
  name: 'Test',
  customName: false,
  status: 'idle',
  model: 'claude-sonnet-4-6',
  thinkingEnabled: false,
  extendedContext: false,
  planModeEnabled: false,
  messages: [],
  activity: null,
  runStartedAt: null,
  runCompletedAt: null,
  totalRunDurationMs: 0,
  tokenUsage: null,
  contextTokens: null,
  createdAt: Date.now(),
  linkedWorktrees: [{ worktreeId: 'wt-2', projectId: 'p1', projectName: 'alpha', branch: 'feature-x', path: '/tmp/feature-x' }],
  slashCommands: [{ name: 'help', description: 'Show help', source: 'builtin' }],
}

const mockSessionsState: Pick<SessionsState, 'sessions' | 'activeSessionId' | 'draftSnippets'> = {
  sessions: { 'sess-1': mockSession },
  activeSessionId: 'sess-1',
  draftSnippets: { 'sess-1': [{ id: 'sn-1', content: 'code', firstLine: 'code', lineCount: 1, charCount: 4 }] },
}

const mockProjectsState = {
  projects: [
    { id: 'p1', name: 'alpha', path: '/repos/alpha', settings: { remoteOrigin: 'https://github.com/org/alpha.git' } },
    { id: 'p2', name: 'beta', path: '/repos/beta', settings: { remoteOrigin: '' } },
    { id: 'p3', name: 'gamma', path: '/repos/gamma', settings: undefined },
  ],
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('selector stability — projects store', () => {
  it('projects selector returns stable reference', () => {
    // Used in AddProjectDialog — the selector for useShallow
    assertSelectorStable(mockProjectsState, (s) => s.projects, 'projects')
  })

  it('new Set() of primitives is stable (zustand shallow handles Sets)', () => {
    // zustand's shallow() compares Sets by value — this is safe
    assertSelectorStable(
      mockProjectsState,
      (s) => new Set(s.projects.map((p) => p.path)),
      'new Set(projects.map(...))',
    )
  })

  it('REGRESSION: .map(() => ({...})) inside selector is UNSTABLE', () => {
    // This was the root cause of AddProjectDialog infinite loop.
    // .map() creates new objects → shallow() compares array elements by
    // reference → always different → forceStoreRerender → infinite loop.
    expect(() => {
      assertSelectorStable(
        mockProjectsState,
        (s) => s.projects.map((p) => ({ name: p.name, origin: p.settings?.remoteOrigin ?? '' })),
        'projects.map(p => ({name, origin}))',
      )
    }).toThrow(/unstable/)
  })

  it('KNOWLEDGE: .map() of primitives is stable', () => {
    // Mapping to primitives (strings, numbers) is safe — shallow compares by value
    assertSelectorStable(
      mockProjectsState,
      (s) => s.projects.map((p) => p.path),
      'projects.map(p => p.path)',
    )
  })

  it('KNOWLEDGE: .map() preserving store references is stable', () => {
    // Returning the same object references from the store is safe
    assertSelectorStable(
      mockProjectsState,
      (s) => s.projects.map((p) => p.settings),
      'projects.map(p => p.settings)',
    )
  })
})

describe('selector stability — sessions store', () => {
  it('sessions record selector is stable', () => {
    assertSelectorStable(mockSessionsState, (s) => s.sessions, 'sessions')
  })

  it('activeSession selector returns stable reference', () => {
    assertSelectorStable(
      mockSessionsState,
      (s) => (s.activeSessionId ? s.sessions[s.activeSessionId] ?? null : null),
      'activeSession',
    )
  })

  it('linkedWorktrees selector returns stable reference', () => {
    const EMPTY_LINKED: AgentSession['linkedWorktrees'] = []
    const sessionId = 'sess-1'
    assertSelectorStable(
      mockSessionsState,
      (s) => s.sessions[sessionId]?.linkedWorktrees ?? EMPTY_LINKED,
      'linkedWorktrees',
    )
  })

  it('draftSnippets selector returns stable reference', () => {
    const sessionId = 'sess-1'
    assertSelectorStable(
      mockSessionsState,
      (s) => s.draftSnippets[sessionId] ?? [],
      'draftSnippets (hit)',
    )
  })

  it('draftSnippets fallback for missing session is stable', () => {
    // Empty array fallbacks are fine — shallow() considers two empty arrays equal
    assertSelectorStable(
      mockSessionsState,
      (s) => s.draftSnippets['nonexistent'] ?? [],
      'draftSnippets (miss)',
    )
  })

  it('slashCommands selector returns stable reference', () => {
    const EMPTY_COMMANDS: AgentSession['slashCommands'] = []
    assertSelectorStable(
      mockSessionsState,
      (s) =>
        s.activeSessionId
          ? (s.sessions[s.activeSessionId]?.slashCommands ?? EMPTY_COMMANDS)
          : EMPTY_COMMANDS,
      'slashCommands',
    )
  })

  it('notify status selector returns primitive', () => {
    // Returns a string or null — always passes shallow()
    const worktreeIds = ['wt-1']
    assertSelectorStable(
      mockSessionsState,
      (s) => {
        let hasError = false
        for (const session of Object.values(s.sessions)) {
          if (!worktreeIds.includes(session.worktreeId)) continue
          if (session.status === 'waiting_input') return 'waiting_input' as const
          if (session.status === 'error') hasError = true
        }
        return hasError ? ('error' as const) : null
      },
      'projectNotifyStatus',
    )
  })
})

describe('selector stability — object selectors', () => {
  it('object with stable values is stable', () => {
    // Pattern used in SettingsProject, SettingsClaudeSkills, etc.
    const state = { activeThemeId: 'dark', customThemes: [{ id: 't1' }] }
    assertSelectorStable(
      state,
      (s) => ({ activeThemeId: s.activeThemeId, customThemes: s.customThemes }),
      '{ activeThemeId, customThemes }',
    )
  })

  it('tuple selector is stable', () => {
    // Pattern used in SettingsGit: returns [value, setter] as const
    const state = { discoveryPatterns: ['.git'], setDiscoveryPatterns: () => {} }
    assertSelectorStable(
      state,
      (s) => [s.discoveryPatterns, s.setDiscoveryPatterns] as const,
      '[discoveryPatterns, setter]',
    )
  })
})
