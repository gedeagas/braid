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
      labels: [],
      components: [],
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
    expect(mockExecFile).toHaveBeenCalledWith(
      'acli',
      ['jira', 'workitem', 'view', 'USRN-123', '--json', '--fields', 'key,issuetype,summary,status,assignee,description'],
      expect.any(Object)
    )

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

  it('parses rich Jira context for agent prompts', async () => {
    mockExecFile.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === 'which' && args[0] === 'acli') {
        return Promise.resolve({ stdout: '/usr/local/bin/acli\n', stderr: '' })
      }
      if (cmd === 'acli') {
        return Promise.resolve({
          stdout: JSON.stringify({
            key: 'USRN-123',
            self: 'https://example.atlassian.net/rest/api/3/issue/USRN-123',
            names: { customfield_10042: 'Acceptance Criteria' },
            fields: {
              summary: 'Fix cart total',
              description: {
                type: 'doc',
                content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Totals are wrong after discounts.' }] }],
              },
              customfield_10042: {
                type: 'doc',
                content: [{ type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Shows discounted total' }] }] }] }],
              },
              status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
              issuetype: { name: 'Bug' },
              assignee: { displayName: 'Ava Engineer' },
              priority: { name: 'High' },
              labels: ['checkout', 'pricing'],
              components: [{ name: 'Cart' }],
              parent: {
                key: 'USRN-100',
                self: 'https://example.atlassian.net/rest/api/3/issue/USRN-100',
                fields: { summary: 'Checkout epic', issuetype: { name: 'Epic' } },
              },
              comment: {
                comments: [{
                  author: { displayName: 'Sam PM' },
                  created: '2026-05-28T10:00:00.000+0900',
                  body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Please verify coupon stacking.' }] }] },
                }],
              },
              issuelinks: [{
                type: { outward: 'blocks' },
                outwardIssue: {
                  key: 'USRN-124',
                  fields: {
                    summary: 'Refactor discounts',
                    status: { name: 'To Do' },
                  },
                },
              }],
              attachment: [{
                filename: 'cart-total.png',
                content: 'https://example.atlassian.net/secure/attachment/1/cart-total.png',
                mimeType: 'image/png',
                size: 1024,
                author: { displayName: 'Sam PM' },
              }],
            },
          }),
          stderr: '',
        })
      }
      return Promise.reject(new Error(`unexpected command: ${cmd}`))
    })

    await expect(jiraService.getIssueByKey('usrn-123', undefined, true, true)).resolves.toMatchObject({
      key: 'USRN-123',
      summary: 'Fix cart total',
      description: 'Totals are wrong after discounts.',
      acceptanceCriteria: '- Shows discounted total',
      assignee: 'Ava Engineer',
      priority: 'High',
      labels: ['checkout', 'pricing'],
      components: ['Cart'],
      parent: { key: 'USRN-100', summary: 'Checkout epic' },
      epic: { key: 'USRN-100', summary: 'Checkout epic' },
      comments: [{ author: 'Sam PM', body: 'Please verify coupon stacking.' }],
      linkedIssues: [{ key: 'USRN-124', relationship: 'blocks', status: 'To Do' }],
      attachments: [{ filename: 'cart-total.png', mimeType: 'image/png', size: 1024 }],
    })
    expect(mockExecFile).toHaveBeenCalledWith(
      'acli',
      ['jira', 'workitem', 'view', 'USRN-123', '--json', '--fields', '*all'],
      expect.any(Object)
    )
  })
})
