import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockExecFile = vi.hoisted(() => vi.fn())

vi.mock('child_process', () => ({ execFile: mockExecFile }))
vi.mock('util', () => ({ promisify: (fn: unknown) => fn }))
vi.mock('fs/promises', () => ({
  readFile: vi.fn().mockRejectedValue(new Error('not found')),
}))
vi.mock('../../lib/enrichedEnv', () => ({
  enrichedEnv: () => ({}),
}))

import { jiraService } from '../jira'

function issuePayload(summary: string) {
  return {
    key: 'USRN-123',
    self: 'https://example.atlassian.net/rest/api/3/issue/USRN-123',
    fields: {
      summary,
      status: { name: 'To Do', statusCategory: { key: 'new' } },
      issuetype: { name: 'Story' },
      assignee: null,
    },
  }
}

describe('jiraService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    jiraService.invalidateCache()
    mockExecFile.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === 'which' && args[0] === 'acli') {
        return Promise.resolve({ stdout: '/usr/local/bin/acli\n', stderr: '' })
      }
      if (cmd === 'acli') {
        return Promise.resolve({ stdout: JSON.stringify(issuePayload('First')), stderr: '' })
      }
      return Promise.reject(new Error(`unexpected command: ${cmd}`))
    })
  })

  it('normalizes issue lookup and cache invalidation to uppercase keys', async () => {
    await expect(jiraService.getIssueByKey('usrn-123')).resolves.toMatchObject({
      key: 'USRN-123',
      summary: 'First',
    })
    expect(mockExecFile).toHaveBeenCalledWith('acli', ['jira', 'workitem', 'view', 'USRN-123', '--json'], expect.any(Object))

    await jiraService.getIssueByKey('usrn-123')
    expect(mockExecFile.mock.calls.filter(([cmd]) => cmd === 'acli')).toHaveLength(1)

    jiraService.invalidateCache('USRN-123')
    mockExecFile.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === 'which' && args[0] === 'acli') {
        return Promise.resolve({ stdout: '/usr/local/bin/acli\n', stderr: '' })
      }
      if (cmd === 'acli') {
        return Promise.resolve({ stdout: JSON.stringify(issuePayload('Updated')), stderr: '' })
      }
      return Promise.reject(new Error(`unexpected command: ${cmd}`))
    })

    await expect(jiraService.getIssueByKey('usrn-123')).resolves.toMatchObject({
      key: 'USRN-123',
      summary: 'Updated',
    })
    expect(mockExecFile.mock.calls.filter(([cmd]) => cmd === 'acli')).toHaveLength(2)
  })
})
