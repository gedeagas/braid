import crypto from 'crypto'
import { BrowserWindow, ipcMain } from 'electron'
import { gitService } from '../git'

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

interface PendingCreation {
  resolve: () => void
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
    (_event, result: { requestId: string; ok: boolean; reason?: string }) => {
      const entry = pending.get(result.requestId)
      if (!entry) return
      pending.delete(result.requestId)
      clearTimeout(entry.timer)
      if (result.ok) entry.resolve()
      else entry.reject(new Error(result.reason ?? 'renderer_creation_failed'))
    }
  )
}

function firstLiveWindow(): BrowserWindow | undefined {
  return BrowserWindow.getAllWindows().find((win) => !win.isDestroyed())
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
): Promise<void> {
  ensureListener()
  const win = firstLiveWindow()
  if (!win) {
    // Headless / no renderer: do the bare git add so the op never no-ops.
    // The renderer reconciles its own state on next launch via refreshWorktrees.
    await gitService.addWorktree(repoPath, branch, projectName, baseBranch)
    return
  }

  const requestId = crypto.randomUUID()
  const ack = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(requestId)
      reject(new Error('renderer_creation_timeout'))
    }, RENDERER_CREATION_TIMEOUT_MS)
    pending.set(requestId, { resolve, reject, timer })
  })

  win.webContents.send('mobile:createWorktreeRequest', { requestId, repoPath, branch, baseBranch })

  try {
    await ack
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    // The renderer couldn't locate the project (e.g. its state is stale or the
    // project was added out-of-band): fall back to a direct git add so mobile's
    // request still takes effect.
    if (reason === 'not_found') {
      await gitService.addWorktree(repoPath, branch, projectName, baseBranch)
      return
    }
    throw err
  }
}
