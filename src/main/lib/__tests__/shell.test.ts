import { describe, it, expect } from 'vitest'
import { resolveShellLaunchArgs, defaultShellPath } from '../shell'

describe('resolveShellLaunchArgs', () => {
  describe('interactive (no command)', () => {
    it('uses a login shell for POSIX shells', () => {
      expect(resolveShellLaunchArgs('/bin/zsh').args).toEqual(['-l'])
      expect(resolveShellLaunchArgs('/bin/bash').args).toEqual(['-l'])
      expect(resolveShellLaunchArgs('/usr/bin/fish').args).toEqual(['-l'])
    })

    it('keeps cmd.exe interactive with a UTF-8 codepage', () => {
      expect(resolveShellLaunchArgs('C:\\Windows\\System32\\cmd.exe').args).toEqual([
        '/K',
        'chcp 65001 > nul',
      ])
    })

    it('keeps PowerShell open without re-running the logo', () => {
      const expected = ['-NoLogo', '-NoExit']
      expect(resolveShellLaunchArgs('C:\\...\\powershell.exe').args).toEqual(expected)
      expect(resolveShellLaunchArgs('C:\\Program Files\\PowerShell\\7\\pwsh.exe').args).toEqual(
        expected,
      )
    })

    it('launches Git Bash as a login interactive shell', () => {
      expect(resolveShellLaunchArgs('C:\\Program Files\\Git\\bin\\bash.exe').args).toEqual([
        '--login',
        '-i',
      ])
    })

    it('enters a login bash for wsl.exe', () => {
      expect(resolveShellLaunchArgs('C:\\Windows\\System32\\wsl.exe').args).toEqual([
        '--',
        'bash',
        '-li',
      ])
    })
  })

  describe('command execution', () => {
    it('runs a command via a POSIX login shell', () => {
      expect(resolveShellLaunchArgs('/bin/zsh', { command: 'echo hi' }).args).toEqual([
        '-l',
        '-c',
        'echo hi',
      ])
    })

    it('runs a command via cmd.exe /C', () => {
      expect(resolveShellLaunchArgs('cmd.exe', { command: 'echo hi' }).args).toEqual([
        '/C',
        'echo hi',
      ])
    })

    it('runs a command via PowerShell -Command without the profile', () => {
      expect(resolveShellLaunchArgs('pwsh.exe', { command: 'echo hi' }).args).toEqual([
        '-NoLogo',
        '-NoProfile',
        '-Command',
        'echo hi',
      ])
    })

    it('runs a command via Git Bash login shell', () => {
      expect(resolveShellLaunchArgs('bash.exe', { command: 'echo hi' }).args).toEqual([
        '--login',
        '-c',
        'echo hi',
      ])
    })
  })

  it('classifies shells by basename regardless of separator', () => {
    // win32.basename handles both separators, so a forward-slash Windows path
    // still resolves to the cmd branch.
    expect(resolveShellLaunchArgs('C:/Windows/System32/cmd.exe').args).toEqual([
      '/K',
      'chcp 65001 > nul',
    ])
  })
})

describe('defaultShellPath', () => {
  it('returns a POSIX shell on non-Windows hosts', () => {
    // This suite runs on macOS/Linux CI; assert we never hand back a Windows path.
    if (process.platform !== 'win32') {
      const shell = defaultShellPath()
      expect(shell.startsWith('/')).toBe(true)
    }
  })
})
