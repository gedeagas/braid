import { describe, expect, it, vi, beforeEach } from 'vitest'
import { reapOrphanedTerminals } from '../orphanedTerminals'
import * as ipc from '@/lib/ipc'

vi.mock('@/lib/ipc', () => ({
  shell: {
    isPackaged: vi.fn(),
  },
  pty: {
    listOrphanedBigTerminals: vi.fn(),
    killOrphanedBigTerminals: vi.fn(),
  },
}))

const isPackaged = vi.mocked(ipc.shell.isPackaged)
const listOrphans = vi.mocked(ipc.pty.listOrphanedBigTerminals)
const killOrphans = vi.mocked(ipc.pty.killOrphanedBigTerminals)

describe('reapOrphanedTerminals', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    isPackaged.mockResolvedValue(true)
  })

  it('skips scanning outside packaged production builds', async () => {
    isPackaged.mockResolvedValue(false)

    const count = await reapOrphanedTerminals(['bt-live'])

    expect(count).toBe(0)
    expect(listOrphans).not.toHaveBeenCalled()
    expect(killOrphans).not.toHaveBeenCalled()
  })

  it('passes unique known terminal ids when scanning', async () => {
    listOrphans.mockResolvedValue([])

    const count = await reapOrphanedTerminals(['bt-live', 'rt-live', 'bt-live'])

    expect(count).toBe(0)
    expect(listOrphans).toHaveBeenCalledWith(['bt-live', 'rt-live'])
    expect(killOrphans).not.toHaveBeenCalled()
  })

  it('kills unique orphan terminal ids returned by the scan', async () => {
    listOrphans.mockResolvedValue([
      { terminalId: 'bt-orphan', cwd: '/repo' },
      { terminalId: 'rt-orphan', cwd: '/repo' },
      { terminalId: 'bt-orphan', cwd: '/repo' },
    ])
    killOrphans.mockResolvedValue(2)

    const count = await reapOrphanedTerminals(['bt-live'])

    expect(count).toBe(2)
    expect(killOrphans).toHaveBeenCalledWith(['bt-orphan', 'rt-orphan'])
  })
})
