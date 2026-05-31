import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockExecFile = vi.hoisted(() => vi.fn())
const mockWaitForEnrichedEnv = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const mockRefreshEnrichedEnv = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const mockMkdirSync = vi.hoisted(() => vi.fn())
const mockChmodSync = vi.hoisted(() => vi.fn())
const mockExistsSync = vi.hoisted(() => vi.fn())
const mockAccessSync = vi.hoisted(() => vi.fn())

vi.mock('child_process', () => ({ execFile: mockExecFile }))
vi.mock('fs', () => ({
  accessSync: mockAccessSync,
  chmodSync: mockChmodSync,
  constants: { W_OK: 2 },
  existsSync: mockExistsSync,
  mkdirSync: mockMkdirSync,
}))
vi.mock('../../lib/enrichedEnv', () => ({
  enrichedEnv: () => ({ PATH: '/mock/bin' }),
  waitForEnrichedEnv: mockWaitForEnrichedEnv,
  refreshEnrichedEnv: mockRefreshEnrichedEnv,
}))

import { toolInstaller } from '../toolInstaller'

type ExecCallback = (error: Error | null, stdout: string, stderr: string) => void

function installExecMock(
  handler: (file: string, args: string[]) => { error?: Error | null; stdout?: string; stderr?: string },
): void {
  mockExecFile.mockImplementation((file: string, args: string[], _opts: object, callback: ExecCallback) => {
    const response = handler(file, args)
    callback(response.error ?? null, response.stdout ?? '', response.stderr ?? '')
  })
}

describe('toolInstaller', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockExistsSync.mockReturnValue(true)
    mockAccessSync.mockReturnValue(undefined)
  })

  it('returns a typed failure for unknown tools', async () => {
    await expect(toolInstaller.install('nope')).resolves.toMatchObject({
      success: false,
      installed: false,
      reason: 'unknown_tool',
    })
    expect(mockExecFile).not.toHaveBeenCalled()
  })

  it('reports missing prerequisites before running an installer', async () => {
    installExecMock((file, args) => {
      if (file === 'which' && args[0] === 'acli') return { error: new Error('not found') }
      if (file === 'which' && args[0] === 'brew') return { error: new Error('not found') }
      if (file === 'which' && args[0] === 'curl') return { error: new Error('not found') }
      throw new Error(`unexpected command: ${file} ${args.join(' ')}`)
    })

    await expect(toolInstaller.install('acli')).resolves.toMatchObject({
      success: false,
      installed: false,
      reason: 'missing_prerequisite',
    })
    expect(mockExecFile).not.toHaveBeenCalledWith('npm', expect.any(Array), expect.any(Object), expect.any(Function))
    expect(mockRefreshEnrichedEnv).not.toHaveBeenCalled()
  })

  it('prefers the official Homebrew ACLI installer on macOS when brew is available', async () => {
    if (process.platform !== 'darwin') return

    const calls: string[] = []
    installExecMock((file, args) => {
      calls.push(`${file} ${args.join(' ')}`)
      if (calls.length === 1) return { error: new Error('not found') }
      if (calls.length === 2) return { stdout: '/opt/homebrew/bin/brew\n' }
      if (calls.length === 3) return { stdout: 'tapped\n' }
      if (calls.length === 4) return { stdout: 'installed\n' }
      if (calls.length === 5) return { stdout: '/opt/homebrew/bin/acli\n' }
      throw new Error(`unexpected command: ${file} ${args.join(' ')}`)
    })

    await expect(toolInstaller.install('acli')).resolves.toMatchObject({
      success: true,
      installed: true,
      reason: 'installed',
    })
    expect(calls).toEqual([
      'which acli',
      'which brew',
      'brew tap atlassian/homebrew-acli',
      'brew install acli',
      'which acli',
    ])
    expect(mockExecFile).not.toHaveBeenCalledWith('npm', expect.any(Array), expect.any(Object), expect.any(Function))
    expect(mockRefreshEnrichedEnv).toHaveBeenCalledOnce()
  })

  it('falls back to direct ACLI download when Homebrew is unavailable', async () => {
    const calls: string[] = []
    installExecMock((file, args) => {
      calls.push(`${file} ${args.join(' ')}`)
      if (calls.length === 1) return { error: new Error('not found') }
      if (process.platform === 'darwin' && calls.length === 2) return { error: new Error('not found') }
      const curlCheckCall = process.platform === 'darwin' ? 3 : 2
      const curlInstallCall = process.platform === 'darwin' ? 4 : 3
      const postCheckCall = process.platform === 'darwin' ? 5 : 4
      if (calls.length === curlCheckCall) return { stdout: '/mock/bin/curl\n' }
      if (calls.length === curlInstallCall && file === 'curl') return { stdout: 'downloaded\n' }
      if (calls.length === postCheckCall) return { stdout: '/mock/bin/acli\n' }
      throw new Error(`unexpected command: ${file} ${args.join(' ')}`)
    })

    await expect(toolInstaller.install('acli')).resolves.toMatchObject({
      success: true,
      installed: true,
      reason: 'installed',
    })
    expect(calls[0]).toBe('which acli')
    if (process.platform === 'darwin') expect(calls[1]).toBe('which brew')
    const curlCall = calls.find((call) => call.startsWith('curl '))
    expect(curlCall).toContain('curl -fL https://acli.atlassian.com/')
    expect(curlCall).toContain('/usr/local/bin/acli')
    expect(calls.at(-1)).toBe('which acli')
    expect(mockMkdirSync).toHaveBeenCalledWith('/usr/local/bin', { recursive: true })
    expect(mockChmodSync).toHaveBeenCalledWith('/usr/local/bin/acli', 0o755)
    expect(mockExecFile).not.toHaveBeenCalledWith('npm', expect.any(Array), expect.any(Object), expect.any(Function))
    expect(mockRefreshEnrichedEnv).toHaveBeenCalledOnce()
  })

  it('returns admin_required before writing ACLI to /usr/local/bin without permission', async () => {
    mockAccessSync.mockImplementation(() => { throw new Error('readonly') })

    installExecMock((file, args) => {
      if (file === 'which' && args[0] === 'acli') return { error: new Error('not found') }
      if (file === 'which' && args[0] === 'brew') return { error: new Error('not found') }
      if (file === 'which' && args[0] === 'curl') return { stdout: '/usr/bin/curl\n' }
      throw new Error(`unexpected command: ${file} ${args.join(' ')}`)
    })

    await expect(toolInstaller.install('acli')).resolves.toMatchObject({
      success: false,
      installed: false,
      reason: 'admin_required',
      requiresAdmin: true,
      targetPath: '/usr/local/bin/acli',
    })
    expect(mockExecFile).not.toHaveBeenCalledWith('osascript', expect.any(Array), expect.any(Object), expect.any(Function))
  })

  it('uses macOS administrator authorization after admin approval', async () => {
    if (process.platform !== 'darwin') return

    mockAccessSync.mockImplementation(() => { throw new Error('readonly') })
    const calls: string[] = []
    installExecMock((file, args) => {
      calls.push(`${file} ${args.join(' ')}`)
      if (calls.length === 1) return { error: new Error('not found') }
      if (calls.length === 2) return { error: new Error('not found') }
      if (calls.length === 3) return { stdout: '/usr/bin/curl\n' }
      if (file === 'osascript') return { stdout: 'authorized\n' }
      if (calls.at(-1) === 'which acli') return { stdout: '/usr/local/bin/acli\n' }
      throw new Error(`unexpected command: ${file} ${args.join(' ')}`)
    })

    await expect(toolInstaller.install('acli', { allowAdmin: true })).resolves.toMatchObject({
      success: true,
      installed: true,
      reason: 'installed',
    })
    const osascriptCall = mockExecFile.mock.calls.find(([file]) => file === 'osascript')
    expect(osascriptCall?.[1]).toEqual(expect.arrayContaining([
      expect.stringContaining('with administrator privileges'),
    ]))
    expect(String(osascriptCall?.[1])).toContain('/usr/local/bin/acli')
  })

  it('includes installer stderr in install failures', async () => {
    installExecMock((file, args) => {
      if (file === 'which' && args[0] === 'acli') return { error: new Error('not found') }
      if (file === 'which' && args[0] === 'brew') return { error: new Error('not found') }
      if (file === 'which' && args[0] === 'curl') return { stdout: '/mock/bin/curl\n' }
      if (file === 'curl') return { error: new Error('exit 1'), stderr: 'permission denied' }
      throw new Error(`unexpected command: ${file} ${args.join(' ')}`)
    })

    const response = await toolInstaller.install('acli')
    expect(response).toMatchObject({
      success: false,
      installed: false,
      reason: 'install_failed',
    })
    expect(response.message).toContain('permission denied')
    expect(mockRefreshEnrichedEnv).not.toHaveBeenCalled()
  })

  it('reports post-check failures when the installer exits cleanly but the tool is still absent', async () => {
    const calls: string[] = []
    installExecMock((file, args) => {
      calls.push(`${file} ${args.join(' ')}`)
      if (calls.length === 1) return { error: new Error('not found') }
      if (process.platform === 'darwin' && calls.length === 2) return { error: new Error('not found') }
      const curlCheckCall = process.platform === 'darwin' ? 3 : 2
      const curlInstallCall = process.platform === 'darwin' ? 4 : 3
      const postCheckCall = process.platform === 'darwin' ? 5 : 4
      if (calls.length === curlCheckCall) return { stdout: '/mock/bin/curl\n' }
      if (calls.length === curlInstallCall && file === 'curl') return { stdout: 'downloaded\n' }
      if (calls.length === postCheckCall) return { error: new Error('not found') }
      throw new Error(`unexpected command: ${file} ${args.join(' ')}`)
    })

    await expect(toolInstaller.install('acli')).resolves.toMatchObject({
      success: false,
      installed: false,
      reason: 'postcheck_failed',
    })
    expect(mockRefreshEnrichedEnv).toHaveBeenCalledOnce()
  })
})
