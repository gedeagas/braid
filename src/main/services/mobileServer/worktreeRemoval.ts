import crypto from 'crypto'
import { BrowserWindow, ipcMain } from 'electron'
import { gitService } from '../git'

// Mobile-initiated worktree removal must run the SAME teardown the desktop does
// (archive script, dispose terminals/PTYs, cascade-delete sessions, drop
// localStorage + Zustand state, then git-remove). That orchestration lives in
// the renderer store (store/projects.ts removeWorktree) because the bulk of it
// touches renderer-only state (xterm instances, Zustand stores, localStorage)
// the main process cannot reach. So instead of calling git directly — which
// would leave orphaned PTYs, stale sessions, and a dangling worktree row on the
// desktop — we ask a desktop window to perform its normal removal flow, and only
// fall back to a bare `git worktree remove` when no window can do it.

interface PendingRemoval {
  resolve: () => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
}

const pending = new Map<string, PendingRemoval>()
let listenerRegistered = false

// Generous ceiling: the renderer flow may run a project archive script before
// the git remove. We deliberately do NOT auto-fall-back on timeout — a window is
// actively handling the request, and a concurrent git remove could fight the
// archive script. The timeout only guards against a leaked pending entry.
const RENDERER_REMOVAL_TIMEOUT_MS = 120_000

function ensureListener(): void {
  if (listenerRegistered) return
  listenerRegistered = true
  ipcMain.on(
    'mobile:removeWorktreeResult',
    (_event, result: { requestId: string; ok: boolean; reason?: string }) => {
      const entry = pending.get(result.requestId)
      if (!entry) return
      pending.delete(result.requestId)
      clearTimeout(entry.timer)
      if (result.ok) entry.resolve()
      else entry.reject(new Error(result.reason ?? 'renderer_removal_failed'))
    }
  )
}

function firstLiveWindow(): BrowserWindow | undefined {
  return BrowserWindow.getAllWindows().find((win) => !win.isDestroyed())
}

/**
 * Remove a worktree by driving the desktop renderer's full teardown flow.
 * Falls back to a bare `git worktree remove` only when no window is available or
 * the renderer doesn't know the worktree (stale state), so a mobile request
 * always takes effect.
 */
export async function removeWorktreeViaDesktop(repoPath: string, worktreePath: string): Promise<void> {
  ensureListener()
  const win = firstLiveWindow()
  if (!win) {
    // Headless / no renderer: do the bare git removal so the op never no-ops.
    // The renderer reconciles its own state on next launch via refreshWorktrees.
    await gitService.removeWorktree(repoPath, worktreePath)
    return
  }

  const requestId = crypto.randomUUID()
  let timer: ReturnType<typeof setTimeout>
  const ack = new Promise<void>((resolve, reject) => {
    timer = setTimeout(() => {
      pending.delete(requestId)
      reject(new Error('renderer_removal_timeout'))
    }, RENDERER_REMOVAL_TIMEOUT_MS)
    pending.set(requestId, { resolve, reject, timer })
  })

  try {
    // send() can throw if the webContents was destroyed between the liveness
    // check and here; clear the pending entry + timer so it doesn't leak and
    // later fire an unhandled rejection.
    win.webContents.send('mobile:removeWorktreeRequest', { requestId, repoPath, worktreePath })
  } catch (err) {
    clearTimeout(timer!)
    pending.delete(requestId)
    throw err
  }

  try {
    await ack
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    // The renderer couldn't locate the worktree (e.g. its state is stale or the
    // worktree was created out-of-band): fall back to a direct git removal so
    // mobile's request still takes effect.
    if (reason === 'not_found') {
      await gitService.removeWorktree(repoPath, worktreePath)
      return
    }
    throw err
  }
}
