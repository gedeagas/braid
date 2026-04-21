import { describe, it, expect, vi } from 'vitest'
import { getPlatformTarget, rewriteCommand, createRtkPreToolUseHook } from '../rtk'

// Mock child_process to control `rtk rewrite` behavior
vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>()
  return {
    ...actual,
    execFileSync: vi.fn(),
    execFile: actual.execFile,
  }
})

import { execFileSync } from 'child_process'
const mockExecFileSync = vi.mocked(execFileSync)

describe('RTK service', () => {
  describe('getPlatformTarget', () => {
    it('returns correct target for known platforms', () => {
      const result = getPlatformTarget()
      if (process.platform === 'darwin' && process.arch === 'arm64') {
        expect(result).toBe('aarch64-apple-darwin')
      } else if (process.platform === 'darwin' && process.arch === 'x64') {
        expect(result).toBe('x86_64-apple-darwin')
      } else if (process.platform === 'linux' && process.arch === 'arm64') {
        expect(result).toBe('aarch64-unknown-linux-gnu')
      } else if (process.platform === 'linux' && process.arch === 'x64') {
        expect(result).toBe('x86_64-unknown-linux-musl')
      } else {
        expect(result).toBeNull()
      }
    })
  })

  describe('rewriteCommand', () => {
    const rtkPath = '/Users/test/Braid/binaries/rtk/rtk'

    it('returns rewritten command with full path when rtk rewrite exits 0', () => {
      mockExecFileSync.mockReturnValue('rtk git status\n')
      const result = rewriteCommand(rtkPath, 'git status')
      expect(result).toEqual({ rewritten: true, command: `${rtkPath} git status` })
      expect(mockExecFileSync).toHaveBeenCalledWith(rtkPath, ['rewrite', 'git status'], expect.any(Object))
    })

    it('returns unchanged when rtk rewrite exits 0 with same output', () => {
      mockExecFileSync.mockReturnValue('git status\n')
      const result = rewriteCommand(rtkPath, 'git status')
      expect(result).toEqual({ rewritten: false, command: 'git status' })
    })

    it('returns unchanged on exit code 1 (no RTK equivalent)', () => {
      const err = new Error('exit 1') as Error & { status: number }
      err.status = 1
      mockExecFileSync.mockImplementation(() => { throw err })
      const result = rewriteCommand(rtkPath, 'echo hello')
      expect(result).toEqual({ rewritten: false, command: 'echo hello' })
    })

    it('returns unchanged on exit code 2 (deny rule)', () => {
      const err = new Error('exit 2') as Error & { status: number }
      err.status = 2
      mockExecFileSync.mockImplementation(() => { throw err })
      const result = rewriteCommand(rtkPath, 'rm -rf /')
      expect(result).toEqual({ rewritten: false, command: 'rm -rf /' })
    })

    it('returns rewritten command with full path on exit code 3 (ask rule)', () => {
      const err = new Error('exit 3') as Error & { status: number; stdout: string }
      err.status = 3
      err.stdout = 'rtk npm install\n'
      mockExecFileSync.mockImplementation(() => { throw err })
      const result = rewriteCommand(rtkPath, 'npm install')
      expect(result).toEqual({ rewritten: true, command: `${rtkPath} npm install` })
    })

    it('returns unchanged on exit code 3 with no stdout', () => {
      const err = new Error('exit 3') as Error & { status: number; stdout?: string }
      err.status = 3
      err.stdout = ''
      mockExecFileSync.mockImplementation(() => { throw err })
      const result = rewriteCommand(rtkPath, 'npm install')
      expect(result).toEqual({ rewritten: false, command: 'npm install' })
    })

    it('falls back to prefix wrapping on unknown exit code (old rtk version)', () => {
      const err = new Error('command not found') as Error & { status: number | null }
      err.status = null as unknown as number
      mockExecFileSync.mockImplementation(() => { throw err })
      const result = rewriteCommand(rtkPath, 'git status')
      expect(result).toEqual({ rewritten: true, command: `${rtkPath} git status` })
    })

    it('fallback skips interactive commands', () => {
      const err = new Error('ENOENT') as Error & { status: number | null }
      err.status = null as unknown as number
      mockExecFileSync.mockImplementation(() => { throw err })

      expect(rewriteCommand(rtkPath, 'vim file.txt')).toEqual({ rewritten: false, command: 'vim file.txt' })
      expect(rewriteCommand(rtkPath, 'nano README.md')).toEqual({ rewritten: false, command: 'nano README.md' })
      expect(rewriteCommand(rtkPath, 'less output.log')).toEqual({ rewritten: false, command: 'less output.log' })
      expect(rewriteCommand(rtkPath, 'top')).toEqual({ rewritten: false, command: 'top' })
      expect(rewriteCommand(rtkPath, 'htop')).toEqual({ rewritten: false, command: 'htop' })
      expect(rewriteCommand(rtkPath, 'man git')).toEqual({ rewritten: false, command: 'man git' })
      expect(rewriteCommand(rtkPath, 'emacs file.ts')).toEqual({ rewritten: false, command: 'emacs file.ts' })
    })

    it('fallback does not wrap commands already prefixed with rtk', () => {
      const err = new Error('ENOENT') as Error & { status: number | null }
      err.status = null as unknown as number
      mockExecFileSync.mockImplementation(() => { throw err })

      expect(rewriteCommand(rtkPath, 'rtk git status')).toEqual({ rewritten: false, command: 'rtk git status' })
      expect(rewriteCommand(rtkPath, `${rtkPath} git status`)).toEqual({ rewritten: false, command: `${rtkPath} git status` })
    })

    it('fallback wraps normal commands', () => {
      const err = new Error('ENOENT') as Error & { status: number | null }
      err.status = null as unknown as number
      mockExecFileSync.mockImplementation(() => { throw err })

      expect(rewriteCommand(rtkPath, 'yarn test')).toEqual({ rewritten: true, command: `${rtkPath} yarn test` })
      expect(rewriteCommand(rtkPath, 'ls -la')).toEqual({ rewritten: true, command: `${rtkPath} ls -la` })
    })

    it('logs rewrite decisions when debug is true', () => {
      mockExecFileSync.mockReturnValue('rtk git status\n')
      // Should not throw - just verifies debug path executes without error
      const result = rewriteCommand(rtkPath, 'git status', true)
      expect(result).toEqual({ rewritten: true, command: `${rtkPath} git status` })
    })
  })

  describe('createRtkPreToolUseHook', () => {
    const rtkPath = '/Users/test/Braid/binaries/rtk/rtk'
    const mockLog = vi.fn()

    it('returns empty for non-Bash tools', async () => {
      const hook = createRtkPreToolUseHook(rtkPath, false, mockLog, 'sess1')
      const result = await hook({ hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: '/foo' } })
      expect(result).toEqual({})
    })

    it('resolves bare rtk commands to full path', async () => {
      const hook = createRtkPreToolUseHook(rtkPath, false, mockLog, 'sess1')
      const result = await hook({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'rtk gain' } })
      expect(result).toEqual({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          updatedInput: { command: `${rtkPath} gain` },
        },
      })
    })

    it('rewrites commands via rtk rewrite', async () => {
      mockExecFileSync.mockReturnValue('rtk git status\n')
      const hook = createRtkPreToolUseHook(rtkPath, false, mockLog, 'sess1')
      const result = await hook({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'git status' } })
      expect(result).toEqual({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          updatedInput: { command: `${rtkPath} git status` },
        },
      })
    })

    it('passes through when no rewrite available', async () => {
      const err = new Error('exit 1') as Error & { status: number }
      err.status = 1
      mockExecFileSync.mockImplementation(() => { throw err })
      const hook = createRtkPreToolUseHook(rtkPath, false, mockLog, 'sess1')
      const result = await hook({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'echo hello' } })
      expect(result).toEqual({})
    })

    it('preserves extra tool input fields', async () => {
      mockExecFileSync.mockReturnValue('rtk git status\n')
      const hook = createRtkPreToolUseHook(rtkPath, false, mockLog, 'sess1')
      const result = await hook({
        hook_event_name: 'PreToolUse',
        tool_name: 'Bash',
        tool_input: { command: 'git status', description: 'check status', timeout: 5000 },
      })
      expect(result).toEqual({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          updatedInput: { command: `${rtkPath} git status`, description: 'check status', timeout: 5000 },
        },
      })
    })

    it('logs when debug is enabled', async () => {
      mockExecFileSync.mockReturnValue('rtk git status\n')
      mockLog.mockClear()
      const hook = createRtkPreToolUseHook(rtkPath, true, mockLog, 'sess1')
      await hook({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'git status' } })
      expect(mockLog).toHaveBeenCalledWith('sess1', expect.stringContaining('[RTK hook] rewrite'))
    })
  })
})
