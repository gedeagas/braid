import { BrowserWindow } from 'electron'
import { existsSync, accessSync, constants, lstatSync } from 'fs'
import { homedir } from 'os'
import { execFileSync } from 'child_process'
import { mainSettings } from '../ipc'

// ── Ring Buffer ──────────────────────────────────────────────────────────────

const BUFFER_MAX_LENGTH = 50_000 // 50KB per PTY

/** Bounded ring buffer that stores the last N characters of terminal output. */
class RingBuffer {
  private chunks: string[] = []
  private totalLength = 0

  push(data: string): void {
    this.chunks.push(data)
    this.totalLength += data.length
    while (this.totalLength > BUFFER_MAX_LENGTH && this.chunks.length > 1) {
      const evicted = this.chunks.shift()!
      this.totalLength -= evicted.length
    }
    if (this.totalLength > BUFFER_MAX_LENGTH && this.chunks.length === 1) {
      this.chunks[0] = this.chunks[0].slice(this.chunks[0].length - BUFFER_MAX_LENGTH)
      this.totalLength = this.chunks[0].length
    }
  }

  read(): string {
    return this.chunks.join('')
  }
}

// ── Types ────────────────────────────────────────────────────────────────────

interface PtyInstance {
  process: import('node-pty').IPty
  cwd: string
  buffer: RingBuffer
}

export interface TerminalOutput {
  ptyId: string
  output: string
}

export interface IPtyService {
  /** Spawn a new interactive terminal session in the given directory. Returns a session ID. */
  spawn(cwd: string): Promise<string>
  /** Write raw input to the terminal session. */
  write(id: string, data: string): void
  /** Resize the terminal session to the given dimensions. */
  resize(id: string, cols: number, rows: number): void
  /** Kill a specific terminal session. */
  kill(id: string): void
  /** Kill all active terminal sessions. */
  killAll(): void
  /** Run a command non-interactively and resolve when it exits. */
  runScript(cwd: string, command: string, timeoutMs?: number): Promise<{ exitCode: number }>
  /** Read buffered output from all PTYs spawned in the given worktree path. */
  readTerminalOutput(worktreePath: string): TerminalOutput[]
}

// ── Service ──────────────────────────────────────────────────────────────────

class PtyService implements IPtyService {
  private instances = new Map<string, PtyInstance>()
  private counter = 0

  private getWindow(): BrowserWindow | null {
    const windows = BrowserWindow.getAllWindows()
    return windows[0] ?? null
  }

  private isExecutable(path: string): boolean {
    try {
      // Resolve symlinks - catches dangling Homebrew links
      const stat = lstatSync(path)
      if (stat.isSymbolicLink()) {
        if (!existsSync(path)) return false // dangling symlink
      }
      accessSync(path, constants.X_OK)
      return true
    } catch {
      return false
    }
  }

  private resolveShell(): string {
    const configured = mainSettings.terminalShell
    if (configured && this.isExecutable(configured)) return configured
    if (process.env.SHELL && this.isExecutable(process.env.SHELL)) return process.env.SHELL
    // Last resort: ask the system for the user's login shell
    try {
      const result = execFileSync('dscl', ['.', '-read', `/Users/${process.env.USER ?? 'root'}`, 'UserShell'], { encoding: 'utf8', timeout: 2000 })
      const match = result.match(/UserShell:\s*(\S+)/)
      if (match && this.isExecutable(match[1])) return match[1]
    } catch { /* ignore */ }
    return '/bin/zsh'
  }

  async spawn(cwd: string): Promise<string> {
    const nodePty = await import('node-pty')
    const id = `pty-${++this.counter}`
    const shell = this.resolveShell()
    const safeCwd = existsSync(cwd) ? cwd : homedir()

    let ptyProcess: import('node-pty').IPty
    try {
      ptyProcess = nodePty.spawn(shell, ['-l'], {
        name: 'xterm-256color',
        cols: 80,
        rows: 24,
        cwd: safeCwd,
        env: { ...process.env, TERM: 'xterm-256color' } as Record<string, string>
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      throw new Error(
        `Failed to spawn terminal (shell: ${shell}, cwd: ${safeCwd}): ${msg}. ` +
        `Check that the shell binary exists and is executable.`
      )
    }

    const buffer = new RingBuffer()
    const instance: PtyInstance = { process: ptyProcess, cwd: safeCwd, buffer }

    ptyProcess.onData((data: string) => {
      buffer.push(data)
      const win = this.getWindow()
      if (win && !win.isDestroyed()) {
        win.webContents.send('pty:data', id, data)
      }
    })

    ptyProcess.onExit(({ exitCode }: { exitCode: number }) => {
      const win = this.getWindow()
      if (win && !win.isDestroyed()) {
        win.webContents.send('pty:exit', id, exitCode)
      }
      this.instances.delete(id)
    })

    this.instances.set(id, instance)
    return id
  }

  write(id: string, data: string): void {
    this.instances.get(id)?.process.write(data)
  }

  resize(id: string, cols: number, rows: number): void {
    this.instances.get(id)?.process.resize(cols, rows)
  }

  kill(id: string): void {
    this.instances.get(id)?.process.kill()
    this.instances.delete(id)
  }

  killAll(): void {
    for (const [id] of this.instances) {
      this.kill(id)
    }
  }

  readTerminalOutput(worktreePath: string): TerminalOutput[] {
    const results: TerminalOutput[] = []
    for (const [id, instance] of this.instances) {
      if (instance.cwd === worktreePath) {
        results.push({ ptyId: id, output: instance.buffer.read() })
      }
    }
    return results
  }

  /** Run a command synchronously and return when it exits. Used for archive scripts. */
  async runScript(cwd: string, command: string, timeoutMs = 30_000): Promise<{ exitCode: number }> {
    const nodePty = await import('node-pty')
    const shell = this.resolveShell()
    const safeCwd = existsSync(cwd) ? cwd : homedir()

    return new Promise((resolve, reject) => {
      let ptyProcess: import('node-pty').IPty
      try {
        ptyProcess = nodePty.spawn(shell, ['-l', '-c', command], {
          name: 'xterm-256color',
          cols: 80,
          rows: 24,
          cwd: safeCwd,
          env: { ...process.env, TERM: 'xterm-256color' } as Record<string, string>
        })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        reject(new Error(
          `Failed to spawn terminal (shell: ${shell}, cwd: ${safeCwd}): ${msg}. ` +
          `Check that the shell binary exists and is executable.`
        ))
        return
      }

      let settled = false
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true
          ptyProcess.kill()
          resolve({ exitCode: -1 })
        }
      }, timeoutMs)

      ptyProcess.onExit(({ exitCode }: { exitCode: number }) => {
        if (!settled) {
          settled = true
          clearTimeout(timer)
          resolve({ exitCode })
        }
      })
    })
  }
}

export const ptyService = new PtyService()
