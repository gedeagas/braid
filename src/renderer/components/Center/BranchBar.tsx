import { useState, useReducer, useRef, useEffect, useCallback } from 'react'
import { useUIStore } from '@/store/ui'
import { useProjectsStore } from '@/store/projects'
import { Tooltip } from '@/components/shared/Tooltip'
import { IconRefresh, IconGitBranch, IconLock, IconChevronDownFill, IconCheckFill } from '@/components/shared/icons'
import { AsyncCombobox, Badge, Button, Dialog } from '@/components/ui'
import * as ipc from '@/lib/ipc'
import { cleanIpcError } from '@/lib/ipc'
import { validateBranchName } from '@/lib/branchValidation'
import { useTranslation } from 'react-i18next'
import { isOnline } from '@/lib/online'

type RenameState = { editing: boolean; value: string; error: string; checking: boolean; showUpstreamWarning: boolean }
type RenameAction =
  | { type: 'START'; initialValue: string }
  | { type: 'CHANGE'; value: string }
  | { type: 'ERROR'; error: string }
  | { type: 'SET_CHECKING'; checking: boolean }
  | { type: 'SHOW_UPSTREAM_WARNING' }
  | { type: 'DISMISS_UPSTREAM_WARNING' }
  | { type: 'CANCEL' }
  | { type: 'DONE' }

function renameReducer(state: RenameState, action: RenameAction): RenameState {
  switch (action.type) {
    case 'START': return { editing: true, value: action.initialValue, error: '', checking: false, showUpstreamWarning: false }
    case 'CHANGE': return { ...state, value: action.value, error: '' }
    case 'ERROR': return { ...state, error: action.error, checking: false }
    case 'SET_CHECKING': return { ...state, checking: action.checking, error: action.checking ? '' : state.error }
    case 'SHOW_UPSTREAM_WARNING': return { ...state, showUpstreamWarning: true, checking: false }
    case 'DISMISS_UPSTREAM_WARNING': return { ...state, showUpstreamWarning: false }
    case 'CANCEL': return { editing: false, value: '', error: '', checking: false, showUpstreamWarning: false }
    case 'DONE': return { editing: false, value: '', error: '', checking: false, showUpstreamWarning: false }
  }
}

export function BranchBar() {
  const selectedProjectId = useUIStore((s) => s.selectedProjectId)
  const selectedWorktreeId = useUIStore((s) => s.selectedWorktreeId)
  const project = useProjectsStore((s) => s.projects.find((p) => p.id === selectedProjectId))
  const refreshWorktrees = useProjectsStore((s) => s.refreshWorktrees)
  const worktree = project?.worktrees.find((w) => w.id === selectedWorktreeId)

  // Branch rename
  const [renameState, renameDispatch] = useReducer(renameReducer, { editing: false, value: '', error: '', checking: false, showUpstreamWarning: false })
  const { editing: editingBranch, value: branchValue, error: renameError, checking: renameChecking, showUpstreamWarning } = renameState
  const branchInputRef = useRef<HTMLInputElement>(null)

  // Upstream-warning confirmation dialog
  const pendingRenameRef = useRef<string | null>(null)

  // Upstream dropdown
  const { t } = useTranslation('center')
  const [defaultBranch, setDefaultBranch] = useState<string | undefined>()

  useEffect(() => {
    if (editingBranch && branchInputRef.current) {
      branchInputRef.current.focus()
      branchInputRef.current.select()
    }
  }, [editingBranch])

  // Branch rename
  const startBranchEdit = useCallback(() => {
    if (!worktree) return
    // Guard: main worktree rename is not allowed
    if (worktree.isMain) return
    renameDispatch({ type: 'START', initialValue: worktree.branch })
  }, [worktree])

  const cancelBranchEdit = useCallback(() => {
    renameDispatch({ type: 'CANCEL' })
    pendingRenameRef.current = null
  }, [])

  /** Actually performs the rename after all checks have passed */
  const executeRename = useCallback(async (newName: string) => {
    if (!worktree || !project) return
    renameDispatch({ type: 'SET_CHECKING', checking: true })
    try {
      await ipc.git.renameBranch(worktree.path, worktree.branch, newName)
      await refreshWorktrees(project.id)
      renameDispatch({ type: 'DONE' })
    } catch (err) {
      const clean = cleanIpcError(err, t('branchRenameFailed'))
      renameDispatch({ type: 'ERROR', error: clean })
      // Re-focus the input so the user can correct the name
      branchInputRef.current?.focus()
    }
  }, [worktree, project, refreshWorktrees])

  const saveBranchEdit = useCallback(async () => {
    if (!worktree || !project) return

    const newName = branchValue.trim()

    // No-op: nothing changed
    if (!newName || newName === worktree.branch) {
      cancelBranchEdit()
      return
    }

    // 1. Validate branch name format
    const validationError = validateBranchName(newName)
    if (validationError) {
      renameDispatch({ type: 'ERROR', error: validationError })
      branchInputRef.current?.focus()
      return
    }

    renameDispatch({ type: 'SET_CHECKING', checking: true })

    try {
      // 2. Check GitHub branch protection
      const isProtected = await ipc.git.isBranchProtected(worktree.path, worktree.branch)
      if (isProtected) {
        renameDispatch({ type: 'ERROR', error: t('branchProtectedError', { branch: worktree.branch }) })
        branchInputRef.current?.focus()
        return
      }

      // 3. Warn if branch has a remote upstream (rename is local-only)
      if (worktree.upstream) {
        pendingRenameRef.current = newName
        renameDispatch({ type: 'SHOW_UPSTREAM_WARNING' })
        return
      }
    } catch {
      // If the pre-checks fail (e.g. no network), proceed with rename anyway
    }

    renameDispatch({ type: 'SET_CHECKING', checking: false })
    // 4. All clear — rename
    await executeRename(newName)
  }, [worktree, project, branchValue, cancelBranchEdit, executeRename])

  const handleBranchKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') { e.preventDefault(); saveBranchEdit() }
      else if (e.key === 'Escape') cancelBranchEdit()
    },
    [saveBranchEdit, cancelBranchEdit]
  )

  const handleBranchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    renameDispatch({ type: 'CHANGE', value: e.target.value })
  }, [])

  // Confirm upstream warning dialog — proceed with local-only rename
  const confirmRenameWithUpstream = useCallback(async () => {
    renameDispatch({ type: 'DISMISS_UPSTREAM_WARNING' })
    const newName = pendingRenameRef.current
    pendingRenameRef.current = null
    if (newName) await executeRename(newName)
  }, [executeRename])

  const cancelRenameWithUpstream = useCallback(() => {
    renameDispatch({ type: 'DISMISS_UPSTREAM_WARNING' })
    pendingRenameRef.current = null
    // Leave editing mode open so user can change the name or press Escape
    branchInputRef.current?.focus()
  }, [])

  // Upstream dropdown — fetch remote branches on each open
  const fetchRemoteBranches = useCallback(async () => {
    if (!worktree) return []
    const result = await ipc.git.getRemoteBranches(worktree.path).catch(() => ({ branches: [] as string[], defaultBranch: undefined }))
    setDefaultBranch(result.defaultBranch)
    return result.branches
  }, [worktree])

  const selectUpstream = useCallback(async (branch: string) => {
    if (!worktree || !project) return
    if (branch === worktree.upstream) return
    try {
      await ipc.git.setUpstream(worktree.path, worktree.branch, branch)
      await refreshWorktrees(project.id)
    } catch (err) {
      console.error('[BranchBar] set upstream failed:', err)
    }
  }, [worktree, project, refreshWorktrees])

  const handleRefresh = useCallback(async () => {
    if (!project) return
    await refreshWorktrees(project.id)
  }, [project, refreshWorktrees])

  // Auto-detect upstream/branch changes made externally (e.g. via CLI).
  // Polling is cheap — just one `git worktree list` + `rev-parse` per worktree.
  // Pauses when tab hidden or offline.
  useEffect(() => {
    if (!project) return
    let timer: ReturnType<typeof setInterval> | null = null
    const start = () => { if (!timer) timer = setInterval(() => { if (isOnline()) refreshWorktrees(project.id) }, 15_000) }
    const stop = () => { if (timer) { clearInterval(timer); timer = null } }
    const onVisibility = () => { if (document.hidden) stop(); else { refreshWorktrees(project.id); start() } }

    if (!document.hidden) start()
    document.addEventListener('visibilitychange', onVisibility)
    return () => { stop(); document.removeEventListener('visibilitychange', onVisibility) }
  }, [project?.id, refreshWorktrees])

  if (!worktree) return null

  const isMainWorktree = worktree.isMain
  const renameTooltip = isMainWorktree ? t('branchRenameLockedTooltip') : t('branchRenameTooltip')

  return (
    <>
      <div className="branch-bar">
        <IconGitBranch className="branch-bar-icon" />

        {editingBranch ? (
          <div className="branch-bar-edit-wrap">
            <input
              ref={branchInputRef}
              className={`branch-bar-input${renameError ? ' branch-bar-input--error' : ''}`}
              value={branchValue}
              onChange={handleBranchChange}
              onKeyDown={handleBranchKeyDown}
              onBlur={saveBranchEdit}
              spellCheck={false}
              disabled={renameChecking}
            />
            {renameChecking && (
              <div className="branch-bar-checking">{t('branchChecking')}</div>
            )}
            {renameError && (
              <div className="branch-bar-error">{renameError}</div>
            )}
          </div>
        ) : (
          <Tooltip content={renameTooltip} position="bottom">
            <button
              className={`branch-bar-name${isMainWorktree ? ' branch-bar-name--locked' : ''}`}
              onClick={startBranchEdit}
              disabled={isMainWorktree}
            >
              {worktree.branch}
              {isMainWorktree && (
                <IconLock style={{ marginLeft: 'var(--space-5)', opacity: 0.5 }} />
              )}
            </button>
          </Tooltip>
        )}

        <span className="branch-bar-sep">→</span>

        <AsyncCombobox
          value={worktree.upstream}
          onSelect={selectUpstream}
          fetchItems={fetchRemoteBranches}
          filterPlaceholder={t('filterBranchesPlaceholder')}
          emptyText={t('noRemoteBranches')}
          className="branch-bar-upstream-wrap"
          triggerClassName="branch-bar-upstream"
          renderItem={(item, { isSelected }) => {
            const isDefault = defaultBranch != null && item === defaultBranch
            return (
              <>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', flex: 1, minWidth: 0 }}>{item}</span>
                {(isDefault || isSelected) && (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-6)', flexShrink: 0 }}>
                    {isDefault && <Badge variant="muted" size="sm">{t('defaultBranch')}</Badge>}
                    {isSelected && <IconCheckFill style={{ color: 'var(--accent)' }} />}
                  </span>
                )}
              </>
            )
          }}
        >
          <span className="branch-bar-upstream-label">{worktree.upstream ?? t('noUpstream')}</span>
          <IconChevronDownFill style={{ marginLeft: 'var(--space-5)', flexShrink: 0, opacity: 0.6 }} />
        </AsyncCombobox>

        <Tooltip content={t('branchRefreshTooltip')} position="bottom">
          <button className="branch-bar-refresh" onClick={handleRefresh}>
            <IconRefresh />
          </button>
        </Tooltip>
      </div>

      {/* Upstream warning dialog — shown when renaming a branch that has a remote upstream */}
      {showUpstreamWarning && worktree && (
        <Dialog
          isOpen={true}
          onClose={cancelRenameWithUpstream}
          title={t('branchRenameLocalOnly')}
          actions={
            <>
              <Button onClick={cancelRenameWithUpstream}>
                {t('cancel', { ns: 'common' })}
              </Button>
              <Button variant="primary" onClick={confirmRenameWithUpstream}>
                {t('branchRenameLocal')}
              </Button>
            </>
          }
        >
          <p style={{ color: 'var(--text-secondary)', fontSize: 'var(--text-md)', marginBottom: 'var(--space-16)' }}>
            <strong>{worktree.branch}</strong> is tracked by remote{' '}
            <strong>{worktree.upstream}</strong>.
          </p>
          <p style={{ color: 'var(--text-secondary)', fontSize: 'var(--text-md)', marginBottom: 'var(--space-16)' }}>
            The local branch will be renamed to{' '}
            <strong>{pendingRenameRef.current}</strong>, but the remote branch will
            not be changed. You will need to manually push the new branch and delete
            the old one on the remote if desired.
          </p>
        </Dialog>
      )}
    </>
  )
}
