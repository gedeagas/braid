import { useReducer, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Tooltip } from '@/components/shared/Tooltip'
import { IconRefresh } from '@/components/shared/icons'
import { useProjectsStore } from '@/store/projects'
import { usePrCacheStore } from '@/store/prCache'
import { PullStrategyDialog } from './PullStrategyDialog'
import { DiscardDialog } from './DiscardDialog'
import { changesReducer, initialState, saveCommitDraft, restoreCommitDraft } from './changesState'
import { PushBanner } from './PushBanner'
import { ChangeFileList } from './ChangeFileList'
import { useChangesActions } from './useChangesActions'
import { useUIStore } from '@/store/ui'
import { isOnline, onOnline, useOnlineStatus } from '@/lib/online'

interface Props {
  worktreePath: string
}

export function ChangesView({ worktreePath }: Props) {
  const { t } = useTranslation('right')
  const online = useOnlineStatus()
  const [state, dispatch] = useReducer(changesReducer, initialState, (base) => ({
    ...base,
    ...restoreCommitDraft(worktreePath),
  }))

  // Save commit draft to module-level cache on unmount
  const stateRef = useRef(state)
  stateRef.current = state
  useEffect(() => {
    return () => saveCommitDraft(worktreePath, stateRef.current)
  }, [worktreePath])

  // ─── PR merged/closed — stop polling, nothing useful to show ─
  const prState = usePrCacheStore((s) => s.cache[worktreePath]?.data?.state)
  const isMergedOrClosed = prState === 'MERGED' || prState === 'CLOSED'

  // ─── Upstream from projects store (reactive) ──────────────
  const upstreamFromStore = useProjectsStore((s) => {
    for (const p of s.projects) {
      const wt = p.worktrees.find((w) => w.path === worktreePath)
      if (wt) return wt.upstream ?? null
    }
    return null
  })

  useEffect(() => {
    dispatch({ type: 'SET_UPSTREAM', upstream: upstreamFromStore })
  }, [upstreamFromStore])

  // ─── Actions hook ──────────────────────────────────────────
  const actions = useChangesActions(worktreePath, state, dispatch)

  // ─── Auto-load status ──────────────────────────────────────
  useEffect(() => {
    if (isMergedOrClosed) return
    actions.loadStatus()
    const interval = setInterval(() => { if (isOnline()) actions.loadStatus() }, 10_000)
    const unsubOnline = onOnline(() => actions.loadStatus())
    return () => { clearInterval(interval); unsubOnline() }
  }, [actions.loadStatus, isMergedOrClosed])

  // ─── Auto-load sync status ─────────────────────────────────
  useEffect(() => {
    if (state.upstream === undefined) return
    actions.loadSyncStatus()
    const interval = setInterval(() => { if (isOnline()) actions.loadSyncStatus() }, 30_000)
    const unsubOnline = onOnline(() => actions.loadSyncStatus())
    return () => { clearInterval(interval); unsubOnline() }
  }, [actions.loadSyncStatus, state.upstream])

  // ─── Derived ──────────────────────────────────────────────
  const stagedChanges = state.changes.filter((c) => c.staged)
  const unstagedChanges = state.changes.filter((c) => !c.staged)

  const isClean = state.changes.length === 0
  const noUpstream = state.upstream === null
  const pullLabel =
    state.pullState === 'pulling'      ? t('pulling') :
    state.pullState === 'success'      ? t('pullUpToDate') :
    state.pullState === 'error'        ? t('pullError') :
                                          t('pull')
  const pullBtnClass =
    state.pullState === 'error'   ? 'changes-pull-btn changes-pull-btn--error' :
    state.pullState === 'success' ? 'changes-pull-btn changes-pull-btn--success' :
    state.pullState === 'pulling' ? 'changes-pull-btn changes-pull-btn--pulling' :
                                     'changes-pull-btn'

  const commitBtnLabel =
    state.commitState === 'committing' ? t('committing') :
    state.commitState === 'success'    ? t('commitSuccess') :
    state.commitState === 'error'      ? t('commitError') :
                                          t('commit')
  const commitBtnClass =
    state.commitState === 'success' ? 'changes-commit-btn changes-commit-btn--success' :
    state.commitState === 'error'   ? 'changes-commit-btn changes-commit-btn--error' :
                                       'changes-commit-btn'
  const canCommit = stagedChanges.length > 0 && state.commitMessage.trim() !== '' && state.commitState === 'idle'

  const showPushBanner = state.aheadCount > 0 || state.pushState === 'success' || !!state.pushError
  const showPullBtn = state.upstream !== undefined && (state.behindCount > 0 || state.pullState !== 'idle')

  return (
    <div className="changes-root">
      <div className="panel-toolbar">
        <span className="panel-toolbar-label">
          {isClean
            ? t('noChanges')
            : t('changesCount', { staged: stagedChanges.length, unstaged: unstagedChanges.length })}
        </span>
        <div className="panel-toolbar-actions">
          {showPullBtn && (
            <Tooltip content={!online ? t('offlineDisabled') : t('pullNoUpstream')} position="bottom" disabled={online && !noUpstream}>
              <button
                className={pullBtnClass}
                onClick={actions.handlePull}
                disabled={!online || state.pullState === 'pulling' || state.pullState === 'success' || noUpstream}
              >
                {pullLabel}
              </button>
            </Tooltip>
          )}
          <button
            className={`panel-refresh-btn${state.refreshing ? ' refreshing' : ''}`}
            onClick={() => actions.loadStatus(true)}
            disabled={state.refreshing}
          >
            <IconRefresh />
            {t('refresh', { ns: 'common' })}
          </button>
        </div>
      </div>
      {/* Commit box */}
      <div className={`changes-commit-collapse${isClean ? ' collapsed' : ''}`}>
      <div className="changes-commit-box">
        <textarea
          className={`changes-commit-input${state.generateState === 'generating' ? ' generating' : ''}`}
          placeholder={state.generateState === 'generating' ? t('generatingCommitMessagePlaceholder') : t('commitMessagePlaceholder')}
          value={state.commitMessage}
          onChange={(e) => dispatch({ type: 'SET_COMMIT_MESSAGE', message: e.target.value })}
          rows={1}
          readOnly={state.generateState === 'generating'}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && canCommit) {
              e.preventDefault()
              actions.handleCommit()
            }
          }}
        />
        <Tooltip content={
          stagedChanges.length === 0 ? t('generateCommitMessageNoStaged') :
          state.generateState === 'error' ? t('generateCommitMessageError') :
          ''
        } disabled={stagedChanges.length > 0 && state.generateState !== 'error'}>
          <button
            className={`changes-generate-link${state.generateState === 'generating' ? ' generating' : ''}${state.generateState === 'error' ? ' error' : ''}`}
            onClick={actions.handleGenerateCommitMessage}
            disabled={stagedChanges.length === 0 || state.generateState === 'generating'}
          >
            {state.generateState === 'generating'
              ? `⟳ ${t('generatingCommitMessage')}`
              : state.generatedViaAI && state.commitMessage
                ? `↻ ${t('regenerateCommitMessage')}`
                : `✦ ${t('generateCommitMessage')}`}
          </button>
        </Tooltip>
        <Tooltip content={stagedChanges.length === 0 ? t('noStagedFiles') : ''} disabled={stagedChanges.length > 0}>
          <button
            className={commitBtnClass}
            onClick={actions.handleCommit}
            disabled={!canCommit}
          >
            {commitBtnLabel}
            {stagedChanges.length > 0 && state.commitState === 'idle' && (
              <span className="changes-commit-count"> · {t('commitFileCount', { count: stagedChanges.length })}</span>
            )}
          </button>
        </Tooltip>
      </div>
      </div>

      {/* Push banner */}
      {showPushBanner && (
        <PushBanner
          aheadCount={state.aheadCount}
          upstream={state.syncUpstream}
          pushState={state.pushState}
          onPush={actions.handlePush}
          errorMessage={state.pushError}
          onDismissError={() => dispatch({ type: 'SET_PUSH_ERROR', message: null })}
        />
      )}

      {/* File list */}
      <ChangeFileList
        stagedChanges={stagedChanges}
        unstagedChanges={unstagedChanges}
        stagedCollapsed={state.stagedCollapsed}
        unstagedCollapsed={state.unstagedCollapsed}
        isClean={isClean}
        stagingInProgress={state.stagingInProgress}
        onStageFile={actions.handleStageFile}
        onUnstageFile={actions.handleUnstageFile}
        onStageAll={actions.handleStageAll}
        onUnstageAll={actions.handleUnstageAll}
        onToggleSection={(section) => dispatch({ type: 'TOGGLE_SECTION', section })}
        onDiscardRequest={actions.handleDiscardRequest}
        onDiscardAllRequest={actions.handleDiscardAllRequest}
        onDiscardAllStagedRequest={actions.handleDiscardAllStagedRequest}
        onOpenDiffReview={(file, status, staged) => useUIStore.getState().openChanges(file, status, staged)}
      />

      {/* Discard dialog */}
      {state.discardConfirmFiles && (
        <DiscardDialog
          files={state.discardConfirmFiles}
          onConfirm={actions.handleDiscardConfirm}
          onCancel={() => dispatch({ type: 'HIDE_DISCARD_CONFIRM' })}
        />
      )}

      {/* Pull strategy dialog */}
      {state.showStrategyDialog && (
        <PullStrategyDialog onConfirm={actions.handleStrategyConfirm} onCancel={actions.handleStrategyCancel} />
      )}
    </div>
  )
}
