import { describe, it, expect, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp', userAgentFallback: '' },
  session: {}, ipcMain: { handle: vi.fn() }, BrowserWindow: { getAllWindows: () => [] },
  shell: {}, webContents: { fromId: () => null },
}))

import { cleanedUserAgent } from '../session'
import { uniqueSavePath } from '../downloads'
import { normalizeBrowserSettings } from '../settings'
import { clampViewport } from '../viewport'
import { resolveWorktreeByPath, syncWorktree } from '../registry'

describe('cleanedUserAgent', () => {
  it('strips the app and Electron tokens', () => {
    const native = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) braid/26.3.3 Chrome/138.0.7204.0 Electron/41.5.0 Safari/537.36'
    expect(cleanedUserAgent(native)).toBe('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.7204.0 Safari/537.36')
  })

  it('leaves a Chrome UA untouched', () => {
    const chrome = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36'
    expect(cleanedUserAgent(chrome)).toBe(chrome)
  })
})

describe('uniqueSavePath', () => {
  it('adds a counter before the extension when the name is taken', () => {
    const taken = new Set(['/d/report.pdf', '/d/report (1).pdf'])
    expect(uniqueSavePath('/d', 'report.pdf', (p) => taken.has(p))).toBe('/d/report (2).pdf')
  })

  it('sanitizes path separators', () => {
    expect(uniqueSavePath('/d', '../../etc/passwd', () => false)).toBe('/d/passwd')
    expect(uniqueSavePath('/d', '', () => false)).toBe('/d/download')
  })
})

describe('normalizeBrowserSettings', () => {
  it('fills defaults and always keeps the default profile', () => {
    const s = normalizeBrowserSettings({ linkRouting: 'nope', profiles: [{ id: 'work', name: ' Work ' }, { id: 'bad id!', name: 'x' }] })
    expect(s.linkRouting).toBe('braid')
    expect(s.profiles).toEqual([{ id: 'default', name: 'Default' }, { id: 'work', name: 'Work' }])
    expect(s.identity).toBe('cleaned')
  })

  it('dedupes profiles', () => {
    const s = normalizeBrowserSettings({ profiles: [{ id: 'default', name: 'Main' }, { id: 'default', name: 'Dup' }] })
    expect(s.profiles).toEqual([{ id: 'default', name: 'Main' }])
  })
})

describe('clampViewport', () => {
  it('clamps sizes and scale factor', () => {
    expect(clampViewport({ width: 50, height: 99999, deviceScaleFactor: 9, mobile: true }))
      .toEqual({ width: 200, height: 4000, deviceScaleFactor: 4, mobile: true })
  })
})

describe('resolveWorktreeByPath', () => {
  it('picks the longest matching worktree root', () => {
    syncWorktree({ worktreeId: 'outer', worktreePath: '/repo', tabs: [], activeTabId: null })
    syncWorktree({ worktreeId: 'inner', worktreePath: '/repo/.worktrees/feat/', tabs: [], activeTabId: null })
    expect(resolveWorktreeByPath('/repo/.worktrees/feat/src')?.worktreeId).toBe('inner')
    expect(resolveWorktreeByPath('/repo/src')?.worktreeId).toBe('outer')
    expect(resolveWorktreeByPath('/repository')).toBeNull()
  })
})
