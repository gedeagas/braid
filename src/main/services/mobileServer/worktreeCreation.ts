import crypto from 'crypto'
import { spawn } from 'child_process'
import { BrowserWindow, ipcMain } from 'electron'
import { gitService } from '../git'
import { storageService } from '../storage'
import { resolveShellPath, resolveShellLaunchArgs } from '../../lib/shell'
import { enrichedEnv } from '../../lib/enrichedEnv'

// Mobile-initiated worktree creation must run the SAME flow the desktop's
// "Add worktree" button does (store/projects.ts addWorktree): create the
// worktree honoring the configured storage path, mint + persist its stable
// worktree id, prepend it to the sidebar order, and refresh Zustand state so
// the new row appears live. That orchestration lives in the renderer store
// because it touches renderer-only state (the worktree-id registry, Zustand
// stores, localStorage) the main process cannot reach. Calling git directly —
// as this handler used to — created the worktree on disk but left it without a
// stable id (mobile/desktop then disagree on the worktree), ignored a custom
// worktree storage path, and never surfaced the row on the desktop until a
// manual refresh. So instead we ask a desktop window to run its normal create
// flow, and only fall back to a bare `git worktree add` when no window can.
//
// This mirrors worktreeRemoval.ts (the worktrees.remove counterpart).

/** The new worktree's location, when the renderer flow could report it. */
export interface CreatedWorktree {
  worktreePath?: string
  worktreeId?: string
}

interface PendingCreation {
  resolve: (result: CreatedWorktree) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
}

const pending = new Map<string, PendingCreation>()
let listenerRegistered = false

// Generous ceiling: the renderer flow may copy files before the git add. We
// deliberately do NOT auto-fall-back on timeout — a window is actively handling
// the request, and a concurrent git add could create a duplicate worktree. The
// timeout only guards against a leaked pending entry.
const RENDERER_CREATION_TIMEOUT_MS = 120_000

function ensureListener(): void {
  if (listenerRegistered) return
  listenerRegistered = true
  ipcMain.on(
    'mobile:createWorktreeResult',
    (_event, result: { requestId: string; ok: boolean; reason?: string; worktreePath?: string; worktreeId?: string }) => {
      const entry = pending.get(result.requestId)
      if (!entry) return
      pending.delete(result.requestId)
      clearTimeout(entry.timer)
      if (result.ok) entry.resolve({ worktreePath: result.worktreePath, worktreeId: result.worktreeId })
      else entry.reject(new Error(result.reason ?? 'renderer_creation_failed'))
    }
  )
}

function firstLiveWindow(): BrowserWindow | undefined {
  return BrowserWindow.getAllWindows().find((win) => !win.isDestroyed())
}

/**
 * Run the project's setup script headlessly in a freshly created worktree.
 *
 * A mobile-initiated create never selects the worktree on the desktop, so the
 * desktop's SetupPanel (which normally runs the script in a visible terminal)
 * never mounts for it. We replicate its semantics here instead: join the
 * non-empty lines with `&&` so a failing step short-circuits the rest, and run
 * them in a single login shell at the worktree cwd.
 *
 * Deliberately fire-and-forget: the mobile RPC client times out in ~12s and a
 * real setup step (`npm install`, `bundle`, …) can take minutes, so blocking the
 * create response on it is not an option. Output is captured only for logging —
 * there is no UI surface for it on either side (the desktop user didn't ask for
 * this worktree). Any nonzero exit / spawn error is logged for diagnosis.
 */
function runSetupScriptHeadless(repoPath: string, worktreePath: string): void {
  const project = storageService.load().projects.find((p) => p.path === repoPath)
  const script = project?.settings?.setupScript?.trim()
  if (!script) return

  const lines = script
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  if (lines.length === 0) return

  const shell = resolveShellPath()
  // PowerShell 5.1 (the default Windows shell) has no `&&` separator; chain with
  // `;` so each line still runs in order. POSIX shells / pwsh 7+ keep `&&` so a
  // failing step short-circuits the rest.
  const isPowerShell = /powershell|pwsh/i.test(shell)
  const combined = isPowerShell ? lines.join('; ') : lines.join(' && ')

  const { args } = resolveShellLaunchArgs(shell, { command: combined })
  console.log('[MobileWorktree] running setup script headless', { worktreePath })

  try {
    const child = spawn(shell, args, { cwd: worktreePath, env: enrichedEnv() })
    // Fire-and-forget: detach so a slow setup (npm install can take minutes)
    // never keeps the Electron main process alive at shutdown.
    child.unref()
    let tail = ''
    const capture = (chunk: Buffer) => {
      // Keep only the last ~4KB so a chatty install doesn't grow unbounded.
      tail = (tail + chunk.toString()).slice(-4096)
    }
    child.stdout?.on('data', capture)
    child.stderr?.on('data', capture)
    child.on('error', (err) => {
      console.error('[MobileWorktree] setup script spawn failed', { worktreePath, err })
    })
    child.on('exit', (code) => {
      if (code === 0) console.log('[MobileWorktree] setup script complete', { worktreePath })
      else console.error('[MobileWorktree] setup script failed', { worktreePath, code, tail })
    })
  } catch (err) {
    console.error('[MobileWorktree] setup script error', { worktreePath, err })
  }
}

/**
 * Create a worktree by driving the desktop renderer's full add flow.
 * Falls back to a bare `git worktree add` only when no window is available or
 * the renderer doesn't know the project (stale state), so a mobile request
 * always takes effect.
 */
export async function createWorktreeViaDesktop(
  repoPath: string,
  branch: string,
  projectName: string,
  baseBranch?: string,
  filesToCopy?: string[],
): Promise<CreatedWorktree> {
  ensureListener()
  const win = firstLiveWindow()
  if (!win) {
    // Headless / no renderer: do the bare git add so the op never no-ops.
    // The renderer reconciles its own state on next launch via refreshWorktrees.
    // The path isn't surfaced here, so the device falls back to a list refresh.
    await gitService.addWorktree(repoPath, branch, projectName, baseBranch)
    return {}
  }

  const requestId = crypto.randomUUID()
  let timer: ReturnType<typeof setTimeout>
  const ack = new Promise<CreatedWorktree>((resolve, reject) => {
    timer = setTimeout(() => {
      pending.delete(requestId)
      reject(new Error('renderer_creation_timeout'))
    }, RENDERER_CREATION_TIMEOUT_MS)
    pending.set(requestId, { resolve, reject, timer })
  })

  try {
    // send() can throw if the webContents was destroyed between the liveness
    // check and here; clear the pending entry + timer so it doesn't leak and
    // later fire an unhandled rejection.
    win.webContents.send('mobile:createWorktreeRequest', { requestId, repoPath, branch, baseBranch, filesToCopy })
  } catch (err) {
    clearTimeout(timer!)
    pending.delete(requestId)
    throw err
  }

  try {
    const created = await ack
    // Copy-files already ran inside the renderer's add flow (before the ack), so
    // any .env the setup needs is in place. Fire-and-forget the setup script.
    if (created.worktreePath) runSetupScriptHeadless(repoPath, created.worktreePath)
    return created
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    // The renderer couldn't locate the project (e.g. its state is stale or the
    // project was added out-of-band): fall back to a direct git add so mobile's
    // request still takes effect.
    if (reason === 'not_found') {
      await gitService.addWorktree(repoPath, branch, projectName, baseBranch)
      return {}
    }
    throw err
  }
}
