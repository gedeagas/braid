import { describe, it, expect, vi, beforeEach } from 'vitest'

// Build per-test fs + os mocks. The module under test caches
// installed_plugins.json at import time in a module-scoped IIFE,
// so each scenario resets modules and re-imports.
type FsFiles = Record<string, string>
type FsDirs = Set<string>

function installFsMock(files: FsFiles, dirs: FsDirs = new Set()): void {
  vi.doMock('fs', async () => {
    const actual = await vi.importActual<typeof import('fs')>('fs')
    const readFileSync = (p: string | Buffer | URL, _enc?: unknown): string => {
      const key = String(p)
      if (key in files) return files[key]
      throw Object.assign(new Error(`ENOENT: ${key}`), { code: 'ENOENT' })
    }
    const existsSync = (p: string | Buffer | URL): boolean => {
      const key = String(p)
      return key in files || dirs.has(key)
    }
    return {
      ...actual,
      default: { ...actual, readFileSync, existsSync },
      readFileSync,
      existsSync
    }
  })
  vi.doMock('os', async () => {
    const actual = await vi.importActual<typeof import('os')>('os')
    return { ...actual, default: { ...actual, homedir: () => '/tmp/home' }, homedir: () => '/tmp/home' }
  })
}

const installedPluginsPath = '/tmp/home/.claude/plugins/installed_plugins.json'
const settingsPath = '/tmp/home/.claude/settings.json'

const installedPlugins = JSON.stringify({
  version: 2,
  plugins: {
    'superpowers@claude-plugins-official': [
      { scope: 'user', installPath: '/plugins/superpowers', version: '5.0.7' }
    ],
    'swift-lsp@claude-plugins-official': [
      { scope: 'user', installPath: '/plugins/swift-lsp', version: '1.0.0' }
    ],
    'extended@other-marketplace': [
      { scope: 'user', installPath: '/plugins/extended', version: '4.3.3' }
    ]
  }
})

describe('loadPlugins', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.doUnmock('fs')
    vi.doUnmock('os')
  })

  it('includes all installed user plugins when settings.json is missing', async () => {
    installFsMock({ [installedPluginsPath]: installedPlugins })
    const { loadPlugins } = await import('../agentUtils')
    const result = loadPlugins('/tmp/cwd')
    expect(result.map((p) => p.path).sort()).toEqual([
      '/plugins/extended',
      '/plugins/superpowers',
      '/plugins/swift-lsp'
    ])
  })

  it('filters out plugins marked false in enabledPlugins', async () => {
    installFsMock({
      [installedPluginsPath]: installedPlugins,
      [settingsPath]: JSON.stringify({
        enabledPlugins: {
          'superpowers@claude-plugins-official': false,
          'extended@other-marketplace': false
        }
      })
    })
    const { loadPlugins } = await import('../agentUtils')
    const result = loadPlugins('/tmp/cwd')
    expect(result.map((p) => p.path)).toEqual(['/plugins/swift-lsp'])
  })

  it('keeps plugins marked true or absent from enabledPlugins', async () => {
    installFsMock({
      [installedPluginsPath]: installedPlugins,
      [settingsPath]: JSON.stringify({
        enabledPlugins: {
          'superpowers@claude-plugins-official': true
          // swift-lsp and extended absent → default on
        }
      })
    })
    const { loadPlugins } = await import('../agentUtils')
    const result = loadPlugins('/tmp/cwd')
    expect(result.map((p) => p.path).sort()).toEqual([
      '/plugins/extended',
      '/plugins/superpowers',
      '/plugins/swift-lsp'
    ])
  })

  it('treats extended form (array of versions) as enabled', async () => {
    installFsMock({
      [installedPluginsPath]: installedPlugins,
      [settingsPath]: JSON.stringify({
        enabledPlugins: {
          'superpowers@claude-plugins-official': ['5.0.7']
        }
      })
    })
    const { loadPlugins } = await import('../agentUtils')
    const result = loadPlugins('/tmp/cwd')
    expect(result.map((p) => p.path)).toContain('/plugins/superpowers')
  })

  it('still appends project-scope plugin when <cwd>/.claude/skills exists', async () => {
    installFsMock(
      {
        [installedPluginsPath]: installedPlugins,
        [settingsPath]: JSON.stringify({
          enabledPlugins: { 'superpowers@claude-plugins-official': false }
        })
      },
      new Set(['/tmp/cwd/.claude/skills'])
    )
    const { loadPlugins } = await import('../agentUtils')
    const result = loadPlugins('/tmp/cwd')
    expect(result.map((p) => p.path).sort()).toEqual([
      '/plugins/extended',
      '/plugins/swift-lsp',
      '/tmp/cwd/.claude'
    ])
  })

  it('falls back gracefully when settings.json is malformed JSON', async () => {
    installFsMock({
      [installedPluginsPath]: installedPlugins,
      [settingsPath]: '{ not json'
    })
    const { loadPlugins } = await import('../agentUtils')
    const result = loadPlugins('/tmp/cwd')
    expect(result).toHaveLength(3)
  })
})
