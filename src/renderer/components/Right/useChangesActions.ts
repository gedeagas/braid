import { useCallback, useRef, useEffect, type Dispatch } from 'react'
import { useTranslation } from 'react-i18next'
import type { GitChange } from '@/types'
import { useUIStore } from '@/store/ui'
import { usePrCacheStore } from '@/store/prCache'
import { flash } from '@/store/flash'
import i18n from '@/lib/i18n'
import * as ipc from '@/lib/ipc'
import { cleanIpcError } from '@/lib/ipc'
import type { ChangesAction } from './changesState'
import { flashError, commitDraftCache } from './changesState'

interface ChangesState {
  changes: GitChange[]
  upstream: string | null | undefined
  commitMessage: string
  commitState: string
  generateState: string
  generatedViaAI: boolean
  pullState: string
  pushState: string
  discardConfirmFiles: Array<{ file: string; status: string; staged?: boolean }> | null
}

export function useChangesActions(
  worktreePath: string,
  state: ChangesState,
  dispatch: Dispatch<ChangesAction>,
) {
  const { t } = useTranslation('right')
  const pullTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const commitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const generateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mountedRef = useRef(true)
  useEffect(() => () => { mountedRef.current = false }, [])

  // Cleanup timers
  useEffect(() => {
    return () => {
      if (pullTimerRef.current) clearTimeout(pullTimerRef.current)
      if (commitTimerRef.current) clearTimeout(commitTimerRef.current)
      if (pushTimerRef.current) clearTimeout(pushTimerRef.current)
    }
  }, [])

  // ─── Load status ──────────────────────────────────────────
  const loadStatus = useCallback(async (showSpinner = false) => {
    if (showSpinner) dispatch({ type: 'SET_REFRESHING', value: true })
    try {
      const status = await ipc.git.getStatus(worktreePath) as GitChange[]
      dispatch({ type: 'SET_CHANGES', changes: status })
      useUIStore.getState().setChangesCount(worktreePath, status.length)
      useUIStore.getState().bumpDiffRevision(worktreePath)
    } catch (err) {
      const { cache } = usePrCacheStore.getState()
      const st = cache[worktreePath]?.data?.state
      if (st === 'MERGED' || st === 'CLOSED') return
      flashError(err, 'refreshError')
    } finally {
      if (showSpinner) dispatch({ type: 'SET_REFRESHING', value: false })
    }
  }, [worktreePath, dispatch])

  // ─── Load sync status (ahead count) ───────────────────────
  const loadSyncStatus = useCallback(async () => {
    if (!state.upstream) {
      dispatch({ type: 'SET_SYNC_STATUS', aheadCount: 0, behindCount: 0, upstream: null })
      return
    }
    try {
      const base = state.upstream.replace(/^origin\//, '')
      const sync = await ipc.github.getGitSyncStatus(worktreePath, base)
      if (mountedRef.current) {
        dispatch({ type: 'SET_SYNC_STATUS', aheadCount: sync.aheadCount, behindCount: sync.behindCount ?? 0, upstream: state.upstream })
      }
    } catch {
      // Silent — banner just won't show
    }
  }, [worktreePath, state.upstream, dispatch])

  // ─── Pull ─────────────────────────────────────────────────
  const executePull = useCallback(async (strategy?: 'rebase' | 'merge') => {
    if (pullTimerRef.current) clearTimeout(pullTimerRef.current)
    dispatch({ type: 'SET_PULL_STATE', pullState: 'pulling' })
    try {
      const { alreadyUpToDate } = await ipc.git.pull(worktreePath, strategy) as { alreadyUpToDate: boolean }
      dispatch({ type: 'SET_PULL_STATE', pullState: alreadyUpToDate ? 'success' : 'idle' })
      if (alreadyUpToDate) {
        pullTimerRef.current = setTimeout(() => dispatch({ type: 'SET_PULL_STATE', pullState: 'idle' }), 2500)
      } else {
        flash('success', t('pullSuccessFlash'), undefined, 'bottom-right')
        loadStatus()
      }
    } catch (err) {
      const msg = cleanIpcError(err, 'Pull failed')
      if (msg === 'DIVERGENT_BRANCHES') {
        dispatch({ type: 'SHOW_STRATEGY_DIALOG' })
        return
      }
      dispatch({ type: 'SET_PULL_STATE', pullState: 'error' })
      flash('error', msg, 5_000, 'bottom-right')
      pullTimerRef.current = setTimeout(() => dispatch({ type: 'SET_PULL_STATE', pullState: 'idle' }), 5_000)
    }
  }, [worktreePath, loadStatus, dispatch, t])

  const handlePull = useCallback(() => {
    const saved = useUIStore.getState().pullStrategy
    if (!saved) {
      dispatch({ type: 'SHOW_STRATEGY_DIALOG' })
      return
    }
    executePull(saved)
  }, [executePull, dispatch])

  const handleStrategyConfirm = useCallback(async (strategy: 'rebase' | 'merge', remember: boolean) => {
    dispatch({ type: 'HIDE_STRATEGY_DIALOG' })
    if (remember) useUIStore.getState().setPullStrategy(strategy)
    executePull(strategy)
  }, [executePull, dispatch])

  const handleStrategyCancel = useCallback(() => {
    dispatch({ type: 'HIDE_STRATEGY_DIALOG' })
  }, [dispatch])

  // ─── Push ─────────────────────────────────────────────────
  const handlePush = useCallback(async () => {
    if (pushTimerRef.current) clearTimeout(pushTimerRef.current)
    dispatch({ type: 'SET_PUSH_STATE', pushState: 'pushing' })
    dispatch({ type: 'SET_PUSH_ERROR', message: null })
    try {
      await ipc.git.push(worktreePath)
      dispatch({ type: 'SET_PUSH_STATE', pushState: 'success' })
      flash('success', t('pushSuccessFlash'), undefined, 'bottom-right')
      loadSyncStatus()
      pushTimerRef.current = setTimeout(() => dispatch({ type: 'SET_PUSH_STATE', pushState: 'idle' }), 2500)
    } catch (err) {
      dispatch({ type: 'SET_PUSH_STATE', pushState: 'error' })
      dispatch({ type: 'SET_PUSH_ERROR', message: cleanIpcError(err, i18n.t('pushError', { ns: 'right' })) })
      pushTimerRef.current = setTimeout(() => dispatch({ type: 'SET_PUSH_STATE', pushState: 'idle' }), 5_000)
    }
  }, [worktreePath, loadSyncStatus, dispatch, t])

  // ─── Stage / Unstage ──────────────────────────────────────
  const handleStageFile = useCallback(async (e: React.MouseEvent, file: string) => {
    e.stopPropagation()
    dispatch({ type: 'SET_STAGING_IN_PROGRESS', value: true })
    try {
      await ipc.git.stageFiles(worktreePath, [file])
      loadStatus()
    } catch (err) {
      flashError(err, 'stageFailed')
    } finally {
      dispatch({ type: 'SET_STAGING_IN_PROGRESS', value: false })
    }
  }, [worktreePath, loadStatus, dispatch])

  const handleUnstageFile = useCallback(async (e: React.MouseEvent, file: string) => {
    e.stopPropagation()
    dispatch({ type: 'SET_STAGING_IN_PROGRESS', value: true })
    try {
      await ipc.git.unstageFiles(worktreePath, [file])
      loadStatus()
    } catch (err) {
      flashError(err, 'unstageFailed')
    } finally {
      dispatch({ type: 'SET_STAGING_IN_PROGRESS', value: false })
    }
  }, [worktreePath, loadStatus, dispatch])

  const handleStageAll = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation()
    const unstaged = state.changes.filter((c) => !c.staged).map((c) => c.file)
    if (unstaged.length) {
      dispatch({ type: 'SET_STAGING_IN_PROGRESS', value: true })
      try {
        await ipc.git.stageFiles(worktreePath, unstaged)
        loadStatus()
      } catch (err) {
        flashError(err, 'stageFailed')
      } finally {
        dispatch({ type: 'SET_STAGING_IN_PROGRESS', value: false })
      }
    }
  }, [state.changes, worktreePath, loadStatus, dispatch])

  const handleUnstageAll = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation()
    const staged = state.changes.filter((c) => c.staged).map((c) => c.file)
    if (staged.length) {
      dispatch({ type: 'SET_STAGING_IN_PROGRESS', value: true })
      try {
        await ipc.git.unstageFiles(worktreePath, staged)
        loadStatus()
      } catch (err) {
        flashError(err, 'unstageFailed')
      } finally {
        dispatch({ type: 'SET_STAGING_IN_PROGRESS', value: false })
      }
    }
  }, [state.changes, worktreePath, loadStatus, dispatch])

  // ─── Discard ──────────────────────────────────────────────
  const handleDiscardRequest = useCallback((e: React.MouseEvent, file: string, status: string) => {
    e.stopPropagation()
    dispatch({ type: 'SHOW_DISCARD_CONFIRM', files: [{ file, status }] })
  }, [dispatch])

  const handleDiscardAllRequest = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    const unstaged = state.changes.filter((c) => !c.staged)
    if (unstaged.length === 0) return
    dispatch({ type: 'SHOW_DISCARD_CONFIRM', files: unstaged.map((c) => ({ file: c.file, status: c.status })) })
  }, [state.changes, dispatch])

  const handleDiscardAllStagedRequest = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    const staged = state.changes.filter((c) => c.staged)
    if (staged.length === 0) return
    dispatch({ type: 'SHOW_DISCARD_CONFIRM', files: staged.map((c) => ({ file: c.file, status: c.status, staged: true })) })
  }, [state.changes, dispatch])

  const handleDiscardConfirm = useCallback(async () => {
    const files = state.discardConfirmFiles
    if (!files) return
    dispatch({ type: 'HIDE_DISCARD_CONFIRM' })
    const results = await Promise.allSettled(
      files.map(({ file, status, staged }) => ipc.git.discardChanges(worktreePath, file, status, staged))
    )
    const firstErr = results.find((r) => r.status === 'rejected') as PromiseRejectedResult | undefined
    if (firstErr) flashError(firstErr.reason, 'discardFailed')
    loadStatus()
  }, [state.discardConfirmFiles, worktreePath, loadStatus, dispatch])

  // ─── Commit ───────────────────────────────────────────────
  const handleCommit = useCallback(async () => {
    if (commitTimerRef.current) clearTimeout(commitTimerRef.current)
    dispatch({ type: 'SET_COMMIT_STATE', commitState: 'committing' })
    try {
      await ipc.git.commit(worktreePath, state.commitMessage)
      dispatch({ type: 'SET_COMMIT_STATE', commitState: 'success' })
      dispatch({ type: 'SET_COMMIT_MESSAGE', message: '' })
      flash('success', i18n.t('commitSuccessFlash', { ns: 'right' }), undefined, 'bottom-right')
      loadStatus()
      loadSyncStatus()
      commitTimerRef.current = setTimeout(() => dispatch({ type: 'SET_COMMIT_STATE', commitState: 'idle' }), 2500)
    } catch (err) {
      const msg = cleanIpcError(err, 'Commit failed')
      dispatch({ type: 'SET_COMMIT_STATE', commitState: 'error' })
      flash('error', msg, 5_000, 'bottom-right')
      commitTimerRef.current = setTimeout(() => dispatch({ type: 'SET_COMMIT_STATE', commitState: 'idle' }), 5_000)
    }
  }, [worktreePath, state.commitMessage, loadStatus, loadSyncStatus, dispatch])

  const handleGenerateCommitMessage = useCallback(async () => {
    if (generateTimerRef.current) clearTimeout(generateTimerRef.current)
    dispatch({ type: 'SET_GENERATE_STATE', generateState: 'generating' })
    dispatch({ type: 'SET_COMMIT_MESSAGE', message: '' })
    try {
      const message = await ipc.agent.generateCommitMessage(worktreePath)
      if (!mountedRef.current) {
        // Component unmounted (worktree switched) - save result to cache
        // so it's available when the user switches back
        commitDraftCache.set(worktreePath, {
          commitMessage: message,
          generatedViaAI: true,
          generateState: 'idle',
        })
        return
      }
      dispatch({ type: 'SET_COMMIT_MESSAGE', message })
      dispatch({ type: 'SET_GENERATED_VIA_AI', value: true })
      dispatch({ type: 'SET_GENERATE_STATE', generateState: 'idle' })
    } catch (err) {
      if (!mountedRef.current) {
        const existing = commitDraftCache.get(worktreePath)
        if (existing) {
          existing.generateState = 'idle'
        }
        return
      }
      dispatch({ type: 'SET_GENERATE_STATE', generateState: 'error' })
      flashError(err, 'generateCommitMessageError')
      generateTimerRef.current = setTimeout(() => dispatch({ type: 'SET_GENERATE_STATE', generateState: 'idle' }), 3_000)
    }
  }, [worktreePath, dispatch])

  return {
    loadStatus,
    loadSyncStatus,
    executePull,
    handlePull,
    handleStrategyConfirm,
    handleStrategyCancel,
    handlePush,
    handleStageFile,
    handleUnstageFile,
    handleStageAll,
    handleUnstageAll,
    handleDiscardRequest,
    handleDiscardAllRequest,
    handleDiscardAllStagedRequest,
    handleDiscardConfirm,
    handleCommit,
    handleGenerateCommitMessage,
  }
}
