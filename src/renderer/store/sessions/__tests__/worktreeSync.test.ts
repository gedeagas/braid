import { describe, it, expect, vi } from 'vitest'
import { findCliRefreshTrigger, findSyncTriggerCommand, triggerWorktreeRefreshIfNeeded } from '../handlers/worktreeSync'
import type { WorktreeSyncDeps } from '../handlers/types'
import type { ToolCall } from '@/types'

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeBashToolCall(id: string, command: string): ToolCall {
  return { id, name: 'Bash', input: JSON.stringify({ command }) }
}

function makeToolCall(id: string, name: string): ToolCall {
  return { id, name, input: '{}' }
}

function makeDeps(overrides: Partial<WorktreeSyncDeps> = {}): WorktreeSyncDeps {
  return {
    getWorktreePath: vi.fn().mockReturnValue('/home/user/project'),
    findProjectByWorktreePath: vi.fn().mockReturnValue({ id: 'proj-1' }),
    refreshWorktrees: vi.fn().mockResolvedValue(undefined),
    invalidateJiraCache: vi.fn().mockResolvedValue(undefined),
    ...overrides
  }
}

// ---------------------------------------------------------------------------
// findSyncTriggerCommand — pure function
// ---------------------------------------------------------------------------

describe('findSyncTriggerCommand', () => {
  it('returns null for empty patches', () => {
    expect(findSyncTriggerCommand([], [])).toBeNull()
  })

  it('returns null when no patch matches any tool call', () => {
    const patches = [{ toolUseId: 'tc-1' }]
    const toolCalls = [makeToolCall('tc-2', 'Bash')]
    expect(findSyncTriggerCommand(patches, toolCalls)).toBeNull()
  })

  it('returns null for non-Bash tool calls', () => {
    const patches = [{ toolUseId: 'tc-1' }]
    const toolCalls = [makeToolCall('tc-1', 'Read')]
    expect(findSyncTriggerCommand(patches, toolCalls)).toBeNull()
  })

  it('returns null for Bash commands without refresh-triggering CLI commands', () => {
    const patches = [{ toolUseId: 'tc-1' }]
    const toolCalls = [makeBashToolCall('tc-1', 'ls -la')]
    expect(findSyncTriggerCommand(patches, toolCalls)).toBeNull()
  })

  it('returns command string for git push', () => {
    const patches = [{ toolUseId: 'tc-1' }]
    const toolCalls = [makeBashToolCall('tc-1', 'git push origin main')]
    expect(findSyncTriggerCommand(patches, toolCalls)).toBe('git push origin main')
  })

  it('returns command string for gh pr create', () => {
    const patches = [{ toolUseId: 'tc-1' }]
    const toolCalls = [makeBashToolCall('tc-1', 'gh pr create --title "My PR"')]
    expect(findSyncTriggerCommand(patches, toolCalls)).toBe('gh pr create --title "My PR"')
  })

  it('returns command string for mutating gh pr commands', () => {
    const patches = [{ toolUseId: 'tc-1' }]
    const toolCalls = [makeBashToolCall('tc-1', 'gh pr edit 12 --add-label ready')]
    expect(findSyncTriggerCommand(patches, toolCalls)).toBe('gh pr edit 12 --add-label ready')
  })

  it('returns command string for mutating acli workitem commands', () => {
    const patches = [{ toolUseId: 'tc-1' }]
    const toolCalls = [makeBashToolCall('tc-1', 'acli jira workitem transition USRN-123 --status "In Progress"')]
    expect(findSyncTriggerCommand(patches, toolCalls)).toBe('acli jira workitem transition USRN-123 --status "In Progress"')
  })

  it('ignores read-only gh and acli commands', () => {
    const patches = [{ toolUseId: 'tc-1' }, { toolUseId: 'tc-2' }]
    const toolCalls = [
      makeBashToolCall('tc-1', 'gh pr view --json title'),
      makeBashToolCall('tc-2', 'acli jira workitem view USRN-123 --json')
    ]
    expect(findSyncTriggerCommand(patches, toolCalls)).toBeNull()
  })

  it('returns null when Bash input is malformed JSON', () => {
    const patches = [{ toolUseId: 'tc-1' }]
    const toolCalls: ToolCall[] = [{ id: 'tc-1', name: 'Bash', input: 'not-json' }]
    expect(findSyncTriggerCommand(patches, toolCalls)).toBeNull()
  })

  it('returns null when Bash input is valid JSON but missing command key', () => {
    const patches = [{ toolUseId: 'tc-1' }]
    const toolCalls: ToolCall[] = [{ id: 'tc-1', name: 'Bash', input: '{"arg": "val"}' }]
    expect(findSyncTriggerCommand(patches, toolCalls)).toBeNull()
  })

  it('returns all matched commands for multi-result events', () => {
    const patches = [{ toolUseId: 'tc-1' }, { toolUseId: 'tc-2' }]
    const toolCalls = [
      makeBashToolCall('tc-1', 'git push'),
      makeBashToolCall('tc-2', 'gh pr create')
    ]
    expect(findSyncTriggerCommand(patches, toolCalls)).toBe('git push\ngh pr create')
  })

  it('merges refresh resources for multi-result events', () => {
    const patches = [{ toolUseId: 'tc-1' }, { toolUseId: 'tc-2' }]
    const toolCalls = [
      makeBashToolCall('tc-1', 'git push'),
      makeBashToolCall('tc-2', 'acli jira workitem transition USRN-123 --status Done')
    ]
    expect(findCliRefreshTrigger(patches, toolCalls)?.plan).toEqual(expect.objectContaining({
      resources: ['gitStatus', 'syncStatus', 'pr', 'checks', 'jira'],
      refreshWorktrees: true,
      invalidateJiraCache: true,
    }))
  })

  it('matches git push with flags', () => {
    const patches = [{ toolUseId: 'tc-1' }]
    const toolCalls = [makeBashToolCall('tc-1', 'git push --force-with-lease origin feature/my-branch')]
    expect(findSyncTriggerCommand(patches, toolCalls)).toBeTruthy()
  })
})

// ---------------------------------------------------------------------------
// triggerWorktreeRefreshIfNeeded — side effect
// ---------------------------------------------------------------------------

describe('triggerWorktreeRefreshIfNeeded', () => {
  it('does not call refreshWorktrees when no sync trigger found', async () => {
    const deps = makeDeps()
    const patches = [{ toolUseId: 'tc-1' }]
    const toolCalls = [makeBashToolCall('tc-1', 'ls -la')]
    triggerWorktreeRefreshIfNeeded('sess-1', patches, toolCalls, deps)
    // Allow any microtask queue to flush
    await Promise.resolve()
    expect(deps.refreshWorktrees).not.toHaveBeenCalled()
  })

  it('does not call refreshWorktrees when getWorktreePath returns undefined', async () => {
    const deps = makeDeps({ getWorktreePath: vi.fn().mockReturnValue(undefined) })
    const patches = [{ toolUseId: 'tc-1' }]
    const toolCalls = [makeBashToolCall('tc-1', 'git push')]
    triggerWorktreeRefreshIfNeeded('sess-1', patches, toolCalls, deps)
    await Promise.resolve()
    expect(deps.refreshWorktrees).not.toHaveBeenCalled()
  })

  it('does not call refreshWorktrees when project is not found', async () => {
    const deps = makeDeps({ findProjectByWorktreePath: vi.fn().mockReturnValue(undefined) })
    const patches = [{ toolUseId: 'tc-1' }]
    const toolCalls = [makeBashToolCall('tc-1', 'git push')]
    triggerWorktreeRefreshIfNeeded('sess-1', patches, toolCalls, deps)
    await Promise.resolve()
    expect(deps.refreshWorktrees).not.toHaveBeenCalled()
  })

  it('calls refreshWorktrees with the project id on git push', async () => {
    const deps = makeDeps()
    const patches = [{ toolUseId: 'tc-1' }]
    const toolCalls = [makeBashToolCall('tc-1', 'git push origin main')]
    triggerWorktreeRefreshIfNeeded('sess-1', patches, toolCalls, deps)
    await Promise.resolve()
    expect(deps.refreshWorktrees).toHaveBeenCalledWith('proj-1')
  })

  it('calls refreshWorktrees with the project id on gh pr create', async () => {
    const deps = makeDeps()
    const patches = [{ toolUseId: 'tc-1' }]
    const toolCalls = [makeBashToolCall('tc-1', 'gh pr create --title "Test"')]
    triggerWorktreeRefreshIfNeeded('sess-1', patches, toolCalls, deps)
    await Promise.resolve()
    expect(deps.refreshWorktrees).toHaveBeenCalledWith('proj-1')
  })

  it('invalidates Jira cache on mutating acli commands', async () => {
    const deps = makeDeps()
    const patches = [{ toolUseId: 'tc-1' }]
    const toolCalls = [makeBashToolCall('tc-1', 'acli jira workitem edit USRN-123 --summary "Updated"')]
    triggerWorktreeRefreshIfNeeded('sess-1', patches, toolCalls, deps)
    await Promise.resolve()
    expect(deps.invalidateJiraCache).toHaveBeenCalled()
    expect(deps.refreshWorktrees).not.toHaveBeenCalled()
  })

  it('refreshes merged resources for multi-result events', async () => {
    const deps = makeDeps()
    const patches = [{ toolUseId: 'tc-1' }, { toolUseId: 'tc-2' }]
    const toolCalls = [
      makeBashToolCall('tc-1', 'git push origin main'),
      makeBashToolCall('tc-2', 'acli jira workitem transition USRN-123 --status Done')
    ]
    triggerWorktreeRefreshIfNeeded('sess-1', patches, toolCalls, deps)
    await Promise.resolve()
    expect(deps.invalidateJiraCache).toHaveBeenCalled()
    expect(deps.refreshWorktrees).toHaveBeenCalledWith('proj-1')
  })

  it('swallows errors from refreshWorktrees', async () => {
    const deps = makeDeps({ refreshWorktrees: vi.fn().mockRejectedValue(new Error('network error')) })
    const patches = [{ toolUseId: 'tc-1' }]
    const toolCalls = [makeBashToolCall('tc-1', 'git push')]
    // Should not throw
    triggerWorktreeRefreshIfNeeded('sess-1', patches, toolCalls, deps)
    await new Promise((r) => setTimeout(r, 10))
  })
})
