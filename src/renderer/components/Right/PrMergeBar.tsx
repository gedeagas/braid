import React, { useEffect, useReducer, useRef, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import * as ipc from '@/lib/ipc'
import { cleanIpcError } from '@/lib/ipc'
import { usePrStatus, usePrCacheStore, type PrStatus } from '@/store/prCache'
import { useSessionsStore } from '@/store/sessions'
import { useUIStore } from '@/store/ui'
import { flash } from '@/store/flash'
import { DEFAULT_MERGE_CONFLICT_PROMPT } from '@/lib/mergeConflictPrompt'
import { Button, Spinner } from '@/components/ui'
import { IconMergeGraph, IconExternalLinkSmall, IconChevronDownSmall } from '@/components/shared/icons'

// ─── State ────────────────────────────────────────────────────────────────────

type MergeStrategy = 'merge' | 'squash' | 'rebase'
type BarVariant = 'clean' | 'warning' | 'danger' | 'draft' | 'merged'

interface MergeBarState {
  dropdownOpen: boolean
  merging: boolean
  markingReady: boolean
  fixingConflicts: boolean
  error: string | null
}

type MergeBarAction =
  | { type: 'TOGGLE_DROPDOWN' }
  | { type: 'CLOSE_DROPDOWN' }
  | { type: 'START_MERGE' }
  | { type: 'MERGE_SUCCESS' }
  | { type: 'MERGE_ERROR'; error: string }
  | { type: 'MARK_READY_START' }
  | { type: 'MARK_READY_SUCCESS' }
  | { type: 'MARK_READY_ERROR'; error: string }
  | { type: 'SET_FIXING_CONFLICTS'; value: boolean }

function mergeBarReducer(state: MergeBarState, action: MergeBarAction): MergeBarState {
  switch (action.type) {
    case 'TOGGLE_DROPDOWN': return { ...state, dropdownOpen: !state.dropdownOpen, error: null }
    case 'CLOSE_DROPDOWN': return { ...state, dropdownOpen: false }
    case 'START_MERGE': return { ...state, dropdownOpen: false, merging: true, error: null }
    case 'MERGE_SUCCESS': return { ...state, merging: false, error: null }
    case 'MERGE_ERROR': return { ...state, dropdownOpen: false, merging: false, error: action.error }
    case 'MARK_READY_START': return { ...state, markingReady: true, error: null }
    case 'MARK_READY_SUCCESS': return { ...state, markingReady: false, error: null }
    case 'MARK_READY_ERROR': return { ...state, markingReady: false, error: action.error }
    case 'SET_FIXING_CONFLICTS': return { ...state, fixingConflicts: action.value }
  }
}

const INITIAL_STATE: MergeBarState = {
  dropdownOpen: false,
  merging: false,
  markingReady: false,
  fixingConflicts: false,
  error: null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STRATEGY_KEYS: Array<{ key: MergeStrategy; i18nKey: string }> = [
  { key: 'merge', i18nKey: 'mergeCommit' },
  { key: 'squash', i18nKey: 'mergeSquash' },
  { key: 'rebase', i18nKey: 'mergeRebase' },
]

interface StatusInfo { i18nKey: string; color: string; variant: BarVariant }

function getStatusInfo(pr: PrStatus): StatusInfo {
  if (pr.isDraft)
    return { i18nKey: 'mergeStatusDraft', color: 'var(--text-muted)', variant: 'draft' }
  if (pr.mergeable === 'CONFLICTING')
    return { i18nKey: 'mergeStatusConflicting', color: 'var(--red)', variant: 'danger' }
  if (pr.mergeable === 'MERGEABLE' && pr.mergeStateStatus === 'CLEAN')
    return { i18nKey: 'mergeStatusReady', color: 'var(--green)', variant: 'clean' }
  if (pr.mergeable === 'MERGEABLE' && pr.mergeStateStatus === 'UNSTABLE')
    return { i18nKey: 'mergeStatusChecksFailing', color: 'var(--amber)', variant: 'warning' }
  if (pr.mergeable === 'MERGEABLE' && pr.mergeStateStatus === 'BEHIND')
    return { i18nKey: 'mergeStatusBehind', color: 'var(--amber)', variant: 'warning' }
  if (pr.mergeStateStatus === 'BLOCKED')
    return { i18nKey: 'mergeStatusBlocked', color: 'var(--red)', variant: 'danger' }
  if (pr.mergeable === 'MERGEABLE')
    return { i18nKey: 'mergeStatusReady', color: 'var(--green)', variant: 'clean' }
  return { i18nKey: 'mergeStatusChecking', color: 'var(--amber)', variant: 'warning' }
}

/** Collect i18n keys for each blocking reason. */
function getBlockReasonKeys(pr: PrStatus): string[] {
  const keys: string[] = []
  if (pr.reviewDecision === 'CHANGES_REQUESTED') keys.push('mergeBlockChangesRequested')
  else if (pr.reviewDecision === 'REVIEW_REQUIRED') keys.push('mergeBlockReviewRequired')
  if (pr.mergeStateStatus === 'UNSTABLE') keys.push('mergeBlockChecksFailing')
  else if (pr.mergeStateStatus === 'BLOCKED' && !keys.length) keys.push('mergeBlockBranchProtection')
  if (pr.mergeStateStatus === 'BEHIND') keys.push('mergeBlockBehind')
  if (pr.mergeable === 'CONFLICTING') keys.push('mergeBlockConflicts')
  return keys
}

/** True when the merge state is fully clean — no blockers of any kind. */
function isMergeClean(pr: PrStatus): boolean {
  return pr.mergeable === 'MERGEABLE' && !pr.isDraft &&
    (pr.mergeStateStatus === 'CLEAN' || pr.mergeStateStatus === 'HAS_HOOKS' || !pr.mergeStateStatus)
}

const openExternal = (url: string) => ipc.shell.openExternal(url)

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  worktreePath: string
  worktreeId: string
}

export function PrMergeBar({ worktreePath, worktreeId }: Props) {
  const { t } = useTranslation('right')
  const pr = usePrStatus(worktreePath)
  const [state, dispatch] = useReducer(mergeBarReducer, INITIAL_STATE)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Session creation for "Fix conflicts with AI"
  const createSession = useSessionsStore((s) => s.createSession)
  const sendMessage = useSessionsStore((s) => s.sendMessage)
  const setActiveSession = useSessionsStore((s) => s.setActiveSession)
  const setActiveCenterView = useUIStore((s) => s.setActiveCenterView)

  // Close dropdown on outside click
  useEffect(() => {
    if (!state.dropdownOpen) return
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        dispatch({ type: 'CLOSE_DROPDOWN' })
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [state.dropdownOpen])

  const handleMerge = useCallback(async (strategy: MergeStrategy) => {
    dispatch({ type: 'START_MERGE' })

    // Optimistic update — show MERGED immediately while the API call completes.
    // Snapshot the current cache entry for rollback on error.
    const prev = usePrCacheStore.getState().cache[worktreePath]
    if (prev?.data) {
      usePrCacheStore.setState((s) => ({
        cache: { ...s.cache, [worktreePath]: { ...prev, data: { ...prev.data!, state: 'MERGED' } } }
      }))
    }

    try {
      await ipc.github.mergePr(worktreePath, strategy)
      dispatch({ type: 'MERGE_SUCCESS' })
      flash('success', t('mergeSuccessFlash'))
    } catch (err) {
      // Rollback optimistic update
      if (prev) {
        usePrCacheStore.setState((s) => ({ cache: { ...s.cache, [worktreePath]: prev } }))
      }
      const msg = cleanIpcError(err, t('mergeFailed'))
      dispatch({ type: 'MERGE_ERROR', error: msg })
      flash('error', msg, 5_000)
    } finally {
      // Always refresh PR status — confirm with real data from GitHub.
      usePrCacheStore.getState().fetchPr(worktreePath)
    }
  }, [worktreePath, t])

  const handleMarkReady = useCallback(async () => {
    dispatch({ type: 'MARK_READY_START' })

    // Optimistic update — show as non-draft immediately.
    const prev = usePrCacheStore.getState().cache[worktreePath]
    if (prev?.data) {
      usePrCacheStore.setState((s) => ({
        cache: { ...s.cache, [worktreePath]: { ...prev, data: { ...prev.data!, isDraft: false } } }
      }))
    }

    try {
      await ipc.github.markPrReady(worktreePath)
      dispatch({ type: 'MARK_READY_SUCCESS' })
      flash('success', t('markReadySuccessFlash'))
    } catch (err) {
      // Rollback optimistic update
      if (prev) {
        usePrCacheStore.setState((s) => ({ cache: { ...s.cache, [worktreePath]: prev } }))
      }
      const msg = cleanIpcError(err, t('markReadyFailed'))
      dispatch({ type: 'MARK_READY_ERROR', error: msg })
      flash('error', msg, 5_000)
    } finally {
      usePrCacheStore.getState().fetchPr(worktreePath)
    }
  }, [worktreePath, t])

  const handleFixConflicts = useCallback(async () => {
    if (state.fixingConflicts || !pr) return
    dispatch({ type: 'SET_FIXING_CONFLICTS', value: true })
    try {
      const sessionId = createSession(worktreeId, worktreePath)
      setActiveSession(sessionId)
      setActiveCenterView({ type: 'session', sessionId })
      const baseBranch = pr.baseRefName ?? 'main'
      const customPrompt = useUIStore.getState().mergeConflictPrompt.trim()
      const instructions = (customPrompt || DEFAULT_MERGE_CONFLICT_PROMPT)
        .replaceAll('{{baseBranch}}', baseBranch)
      const prompt = `PR #${pr.number} (${pr.title}) has merge conflicts with \`${baseBranch}\`.\n\n${instructions}`
      await sendMessage(sessionId, prompt)
    } catch (err) {
      flash('error', cleanIpcError(err, t('fixConflictsFailed')), 5_000)
    } finally {
      dispatch({ type: 'SET_FIXING_CONFLICTS', value: false })
    }
  }, [state.fixingConflicts, pr, worktreeId, worktreePath,
      createSession, sendMessage, setActiveSession, setActiveCenterView])

  // Show if open, or if we have a pending error/merge-in-progress to display
  const hasActiveState = state.merging || state.error !== null
  if (!pr) return null
  if (pr.state !== 'OPEN' && !hasActiveState) return null

  const isMerged = pr.state === 'MERGED'
  const statusInfo: StatusInfo = isMerged
    ? { i18nKey: 'mergeStatusMerged', color: 'var(--purple, #8b5cf6)', variant: 'merged' }
    : getStatusInfo(pr)
  const canMerge = isMergeClean(pr) && !isMerged

  const blockReasonKeys = !isMerged && !pr.isDraft ? getBlockReasonKeys(pr) : []

  return (
    <div className={`pr-merge-bar pr-merge-bar--${statusInfo.variant}`}>
      <span className="pr-merge-badge" onClick={() => openExternal(pr.url)}>
        <IconMergeGraph />
        #{pr.number}
        <IconExternalLinkSmall className="pr-merge-badge-link-icon" />
      </span>

      <span className="pr-merge-status">
        <span className="pr-merge-dot" style={{ background: statusInfo.color }} />
        {t(statusInfo.i18nKey)}
      </span>

      {state.error && (
        <span className="pr-merge-error" role="alert" title={state.error}>
          {state.error}
        </span>
      )}
      {!state.error && blockReasonKeys.length > 0 && (
        <span className="pr-merge-block-reasons">
          {blockReasonKeys.map((k) => (
            <span key={k} className="pr-merge-block-pill">{t(k)}</span>
          ))}
        </span>
      )}

      {isMerged ? null : pr.isDraft ? (
        <Button
          variant="primary"
          size="sm"
          loading={state.markingReady}
          onClick={handleMarkReady}
        >
          {state.markingReady ? t('markingReady') : t('markAsReady')}
        </Button>
      ) : pr.mergeable === 'CONFLICTING' ? (
        <Button
          variant="primary"
          size="sm"
          loading={state.fixingConflicts}
          onClick={handleFixConflicts}
        >
          {state.fixingConflicts ? t('fixingConflicts') : t('fixConflicts')}
        </Button>
      ) : (
        <div className="pr-merge-btn-wrap" ref={dropdownRef}>
          <button
            className="pr-merge-btn"
            disabled={!canMerge || state.merging}
            onClick={() => dispatch({ type: 'TOGGLE_DROPDOWN' })}
          >
            {state.merging ? (
              <Spinner size="sm" />
            ) : (
              <IconMergeGraph />
            )}
            {state.merging ? t('mergeMerging') : t('mergeButton')}
            {!state.merging && <IconChevronDownSmall />}
          </button>
          {state.dropdownOpen && (
            <div className="pr-merge-dropdown">
              {STRATEGY_KEYS.map((s) => (
                <button key={s.key} className="pr-merge-dropdown-item" onClick={() => handleMerge(s.key)}>
                  {t(s.i18nKey)}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
