import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const TEST_DIR = join(tmpdir(), `braid-lifecycle-test-${process.pid}`)
const TEST_PID_FILE = join(TEST_DIR, 'pty-daemon.pid')
const TEST_SOCKET = join(TEST_DIR, 'pty-v1.sock')

vi.mock('../protocol', async () => {
  const actual = await vi.importActual<typeof import('../protocol')>('../protocol')
  return {
    ...actual,
    DAEMON_DIR: TEST_DIR,
    PID_FILE_PATH: TEST_PID_FILE,
    SOCKET_PATH: TEST_SOCKET,
  }
})

const {
  writePidFile, removePidFile, removeSocketFile,
  readPidFile, isProcessRunning, isDaemonRunning,
} = await import('../lifecycle')

describe('lifecycle', () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true })
  })

  afterEach(() => {
    try { rmSync(TEST_DIR, { recursive: true, force: true }) } catch { /* */ }
  })

  describe('PID file', () => {
    it('writes and reads current PID', () => {
      writePidFile()
      expect(existsSync(TEST_PID_FILE)).toBe(true)
      const pid = readPidFile()
      expect(pid).toBe(process.pid)
    })

    it('removes PID file', () => {
      writePidFile()
      removePidFile()
      expect(existsSync(TEST_PID_FILE)).toBe(false)
    })

    it('returns null for missing PID file', () => {
      expect(readPidFile()).toBeNull()
    })

    it('returns null for invalid PID content', () => {
      writeFileSync(TEST_PID_FILE, 'not-a-number')
      expect(readPidFile()).toBeNull()
    })
  })

  describe('isProcessRunning', () => {
    it('returns true for current process', () => {
      expect(isProcessRunning(process.pid)).toBe(true)
    })

    it('returns false for non-existent process', () => {
      // PID 99999999 is unlikely to exist
      expect(isProcessRunning(99_999_999)).toBe(false)
    })
  })

  describe('isDaemonRunning', () => {
    it('returns current PID when process is alive', () => {
      writePidFile()
      const result = isDaemonRunning()
      expect(result).toBe(process.pid)
    })

    it('returns null when no PID file exists', () => {
      expect(isDaemonRunning()).toBeNull()
    })

    it('cleans up stale PID file when process is dead', () => {
      writeFileSync(TEST_PID_FILE, '99999999')
      // Also create a stale socket file
      writeFileSync(TEST_SOCKET, '')

      const result = isDaemonRunning()
      expect(result).toBeNull()
      // Stale files should be cleaned up
      expect(existsSync(TEST_PID_FILE)).toBe(false)
      expect(existsSync(TEST_SOCKET)).toBe(false)
    })
  })

  describe('removeSocketFile', () => {
    it('removes socket file', () => {
      writeFileSync(TEST_SOCKET, '')
      removeSocketFile()
      expect(existsSync(TEST_SOCKET)).toBe(false)
    })

    it('does not throw for missing file', () => {
      expect(() => removeSocketFile()).not.toThrow()
    })
  })
})
