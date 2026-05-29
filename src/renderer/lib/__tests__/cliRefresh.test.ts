import { describe, expect, it } from 'vitest'
import { classifyCliRefreshCommand } from '../cliRefresh'

describe('classifyCliRefreshCommand', () => {
  it('classifies git mutations', () => {
    expect(classifyCliRefreshCommand('git commit -m test')).toEqual(expect.objectContaining({
      reason: 'git-mutation',
      resources: ['gitStatus', 'syncStatus', 'pr', 'checks'],
      force: true,
    }))
  })

  it('classifies git push as a remote/worktree refresh', () => {
    expect(classifyCliRefreshCommand('git push -u origin HEAD')).toEqual(expect.objectContaining({
      reason: 'git-mutation',
      resources: ['gitStatus', 'syncStatus', 'pr', 'checks'],
      refreshWorktrees: true,
    }))
  })

  it('classifies mutating gh pr commands', () => {
    expect(classifyCliRefreshCommand('gh pr edit 123 --add-label ready')).toEqual(expect.objectContaining({
      reason: 'pr-mutation',
      resources: ['pr', 'checks', 'syncStatus'],
    }))
  })

  it('classifies gh api mutations', () => {
    expect(classifyCliRefreshCommand('gh api repos/o/r/issues/1 -X PATCH -f title=x')).toEqual(expect.objectContaining({
      reason: 'pr-mutation',
      resources: ['pr', 'checks', 'syncStatus', 'jira'],
      invalidateJiraCache: true,
    }))
  })

  it('classifies acli Jira workitem mutations', () => {
    expect(classifyCliRefreshCommand('acli jira workitem transition USRN-123 --status "In Progress"')).toEqual(expect.objectContaining({
      reason: 'jira-mutation',
      resources: ['jira'],
      invalidateJiraCache: true,
    }))
  })

  it('ignores read-only gh and acli commands', () => {
    expect(classifyCliRefreshCommand('gh pr view --json title')).toBeNull()
    expect(classifyCliRefreshCommand('acli jira workitem view USRN-123 --json')).toBeNull()
  })

  it('finds commands after shell separators and wrappers', () => {
    expect(classifyCliRefreshCommand('cd app && GH_FORCE_TTY=1 gh pr merge --squash')).toEqual(expect.objectContaining({
      reason: 'pr-mutation',
    }))
    expect(classifyCliRefreshCommand('sudo env FOO=1 git switch feature')).toEqual(expect.objectContaining({
      reason: 'git-mutation',
      refreshWorktrees: true,
    }))
  })
})
