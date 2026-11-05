import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const home = vi.hoisted(() => ({ dir: '' }))
vi.mock('os', async (orig) => ({ ...(await orig<typeof import('os')>()), homedir: () => home.dir }))

import { deleteScrollbackFile, readScrollbackFile, writeScrollbackFile } from '../scrollbackFiles'

describe('scrollback files', () => {
  beforeEach(() => { home.dir = mkdtempSync(join(tmpdir(), 'sb-')) })
  afterEach(() => rmSync(home.dir, { recursive: true, force: true }))

  it('persists big terminals and right-panel terminals', () => {
    for (const id of ['bt-1700000000000-1', 'rt-1700000000000-2']) {
      writeScrollbackFile(id, `history of ${id}`)
      expect(readScrollbackFile(id)).toBe(`history of ${id}`)
      deleteScrollbackFile(id)
      expect(readScrollbackFile(id)).toBe('')
    }
  })

  it('rejects ids that could leave the directory', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    for (const id of ['../x', 'rt-1/../../x', 'pty-d-1', 'bt-1-1/']) {
      writeScrollbackFile(id, 'x')
      expect(readScrollbackFile(id)).toBe('')
    }
    warn.mockRestore()
  })
})
