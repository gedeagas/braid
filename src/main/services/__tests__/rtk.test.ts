import { describe, it, expect } from 'vitest'
import { getPlatformTarget, wrapWithRtk } from '../rtk'

describe('RTK service', () => {
  describe('getPlatformTarget', () => {
    it('returns correct target for known platforms', () => {
      // This test verifies the mapping exists - actual platform depends on CI environment
      const result = getPlatformTarget()
      // On macOS ARM (M-series), should be aarch64-apple-darwin
      // On macOS Intel, should be x86_64-apple-darwin
      // On Linux, should be one of the linux targets
      // On unsupported, should be null
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

  describe('wrapWithRtk', () => {
    const rtkPath = '/Users/test/Braid/binaries/rtk/rtk'

    it('wraps a normal command with rtk path', () => {
      expect(wrapWithRtk(rtkPath, 'git status')).toBe(`${rtkPath} git status`)
    })

    it('wraps compound commands', () => {
      expect(wrapWithRtk(rtkPath, 'git add . && git commit -m "test"'))
        .toBe(`${rtkPath} git add . && git commit -m "test"`)
    })

    it('does not wrap if already prefixed with rtk', () => {
      expect(wrapWithRtk(rtkPath, 'rtk git status')).toBe('rtk git status')
    })

    it('does not wrap if already prefixed with full rtk path', () => {
      const cmd = `${rtkPath} git status`
      expect(wrapWithRtk(rtkPath, cmd)).toBe(cmd)
    })

    it('skips interactive commands - vim', () => {
      expect(wrapWithRtk(rtkPath, 'vim file.txt')).toBe('vim file.txt')
    })

    it('skips interactive commands - nano', () => {
      expect(wrapWithRtk(rtkPath, 'nano README.md')).toBe('nano README.md')
    })

    it('skips interactive commands - less', () => {
      expect(wrapWithRtk(rtkPath, 'less output.log')).toBe('less output.log')
    })

    it('skips interactive commands - top', () => {
      expect(wrapWithRtk(rtkPath, 'top')).toBe('top')
    })

    it('skips interactive commands - htop', () => {
      expect(wrapWithRtk(rtkPath, 'htop')).toBe('htop')
    })

    it('skips interactive commands - man', () => {
      expect(wrapWithRtk(rtkPath, 'man git')).toBe('man git')
    })

    it('skips interactive commands - emacs', () => {
      expect(wrapWithRtk(rtkPath, 'emacs file.ts')).toBe('emacs file.ts')
    })

    it('handles leading whitespace correctly', () => {
      expect(wrapWithRtk(rtkPath, '  git status')).toBe(`${rtkPath}   git status`)
    })

    it('wraps ls, cd, and other short commands', () => {
      expect(wrapWithRtk(rtkPath, 'ls -la')).toBe(`${rtkPath} ls -la`)
      expect(wrapWithRtk(rtkPath, 'cd /tmp')).toBe(`${rtkPath} cd /tmp`)
    })

    it('wraps npm/yarn commands', () => {
      expect(wrapWithRtk(rtkPath, 'yarn test')).toBe(`${rtkPath} yarn test`)
      expect(wrapWithRtk(rtkPath, 'npm run build')).toBe(`${rtkPath} npm run build`)
    })
  })
})
