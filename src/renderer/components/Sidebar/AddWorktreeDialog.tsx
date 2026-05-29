import { useEffect, useCallback, useReducer } from 'react'
import { useProjectsStore } from '@/store/projects'
import { useUIStore } from '@/store/ui'
import * as ipc from '@/lib/ipc'
import { cleanIpcError } from '@/lib/ipc'
import { validateBranchName } from '@/lib/branchValidation'
import { randomBranchName } from '@/lib/randomBranch'
import { useTranslation } from 'react-i18next'
import { IconGitBranch, IconChevronDownFill, IconCheckFill, IconSettings, IconRefresh } from '@/components/shared/icons'
import { Button, Combobox, Dialog, Spinner } from '@/components/ui'
import { copyFilesReducer } from './copyFilesReducer'
import { JiraLookupField, useJiraAvailable } from './JiraLookupField'
import { CopyFilesSection } from './CopyFilesSection'
import type { JiraIssue } from '@/types'

// ── Dialog state reducer ────────────────────────────────────────────────────

interface DialogState {
  branch: string; userEdited: boolean; error: string
  origin: string; remotes: string[]; loadingRemotes: boolean
  creating: boolean
}

type DialogAction =
  | { type: 'setBranch'; value: string; error?: string } | { type: 'reroll'; name: string }
  | { type: 'setError'; error: string } | { type: 'remotesLoaded'; remotes: string[]; origin: string; branch: string }
  | { type: 'remotesFailed'; branch: string } | { type: 'selectOrigin'; origin: string; branch?: string }
  | { type: 'setCreating'; value: boolean }

function dialogReducer(s: DialogState, a: DialogAction): DialogState {
  switch (a.type) {
    case 'setBranch': return { ...s, branch: a.value, userEdited: true, error: a.error ?? '' }
    case 'reroll': return { ...s, branch: a.name, userEdited: true, error: '' }
    case 'setError': return { ...s, error: a.error }
    case 'remotesLoaded':
      return {
        ...s,
        remotes: a.remotes,
        origin: a.origin,
        branch: s.userEdited ? s.branch : a.branch,
        loadingRemotes: false,
      }
    case 'remotesFailed':
      return { ...s, loadingRemotes: false, branch: s.userEdited ? s.branch : a.branch }
    case 'selectOrigin': return { ...s, origin: a.origin, ...(a.branch != null ? { branch: a.branch } : {}) }
    case 'setCreating': return { ...s, creating: a.value }
  }
}

interface Props {
  projectId: string
  repoPath: string
  onClose: () => void
}

/** Strip the remote prefix from a remote-tracking ref, e.g. "origin/main" -> "main" */
function stripRemote(b: string): string {
  const slash = b.indexOf('/')
  return slash !== -1 ? b.slice(slash + 1) : b
}

export function AddWorktreeDialog({ projectId, repoPath, onClose }: Props) {
  const [d, dd] = useReducer(dialogReducer, {
    branch: '', userEdited: false, error: '',
    origin: '', remotes: [], loadingRemotes: true,
    creating: false,
  })

  const [copyState, copyDispatch] = useReducer(copyFilesReducer, {
    savedFiles: [], discoveredFiles: [], loading: false, sourceBranch: '',
  })

  const jiraAvailable = useJiraAvailable()

  const addWorktree = useProjectsStore((s) => s.addWorktree)
  const project = useProjectsStore((s) => s.projects.find((p) => p.id === projectId))
  const globalBranchPrefix = useUIStore((s) => s.defaultBranchPrefix)
  const discoveryPatterns = useUIStore((s) => s.discoveryPatterns)
  const jiraBaseUrl = useUIStore((s) => s.jiraBaseUrl)
  const defaultBranchPrefix = project?.settings?.branchPrefix || globalBranchPrefix
  const { t } = useTranslation('sidebar')

  // Fetch remote branches via gh CLI on mount
  useEffect(() => {
    const withPrefix = (name: string) => defaultBranchPrefix ? `${defaultBranchPrefix}${name}` : name
    ipc.git.getRemoteBranches(repoPath)
      .then((result) => {
        const branches: string[] = Array.isArray(result) ? result : (result?.branches ?? [])
        const defaultBranch: string | undefined = Array.isArray(result) ? undefined : result?.defaultBranch
        const projectDefault = project?.settings?.defaultBaseBranch || undefined
        const preferred = (projectDefault && branches.find((b) => b === projectDefault))
          || (defaultBranch && branches.find((b) => b === defaultBranch))
          || branches.find((b) => b === 'origin/main' || b === 'origin/master')
        const initial = preferred || branches[0] || ''
        const stripped = initial ? stripRemote(initial) : ''
        const baseName = !stripped || stripped === 'main' || stripped === 'master' ? randomBranchName() : stripped
        dd({ type: 'remotesLoaded', remotes: branches, origin: initial, branch: withPrefix(baseName) })
      })
      .catch(() => {
        dd({ type: 'remotesFailed', branch: withPrefix(randomBranchName()) })
      })
  }, [repoPath]) // eslint-disable-line react-hooks/exhaustive-deps

  // Load copy files (saved + discovered gitignored)
  useEffect(() => {
    const savedPaths = project?.settings?.copyFiles ?? []
    if (savedPaths.length === 0 && !project) return
    const sourceWt = project?.worktrees.find((w) => w.isMain)
    if (!sourceWt) return

    copyDispatch({ type: 'startLoading' })
    const loadFiles = async () => {
      const [fileInfo, ignored] = await Promise.all([
        savedPaths.length > 0 ? ipc.files.getFileInfo(sourceWt.path, savedPaths) : Promise.resolve([]),
        ipc.files.getIgnored(sourceWt.path, discoveryPatterns),
      ])
      const savedSet = new Set(savedPaths)
      const saved = fileInfo.map((f: { path: string; exists: boolean; size: number }) => ({ ...f, checked: f.exists }))
      const discovered = ignored
        .filter((f: { path: string; size: number }) => !savedSet.has(f.path))
        .map((f: { path: string; size: number }) => ({ ...f, exists: true, checked: false }))
      copyDispatch({ type: 'setFiles', saved, discovered, sourceBranch: sourceWt.branch })
    }
    loadFiles().catch(() => copyDispatch({ type: 'setFiles', saved: [], discovered: [], sourceBranch: '' }))
  }, [project?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const selectOriginBranch = useCallback((b: string) => {
    const stripped = stripRemote(b)
    const localBranch = !d.userEdited
      ? (stripped === 'main' || stripped === 'master' ? randomBranchName() : stripped)
      : undefined
    dd({ type: 'selectOrigin', origin: b, branch: localBranch })
  }, [d.userEdited])

  const handleReroll = () => dd({ type: 'reroll', name: randomBranchName() })

  const handleJiraResolved = useCallback((_issue: JiraIssue, branch: string, validationError: string | null) => {
    dd({ type: 'setBranch', value: branch, error: validationError ?? '' })
  }, [])

  const handleAdd = async () => {
    const trimmed = d.branch.trim()
    const validationError = validateBranchName(trimmed)
    if (validationError) { dd({ type: 'setError', error: validationError }); return }
    const filesToCopy = [
      ...copyState.savedFiles.filter((f) => f.checked && f.exists),
      ...copyState.discoveredFiles.filter((f) => f.checked),
    ].map((f) => f.path)
    dd({ type: 'setCreating', value: true })
    try {
      await addWorktree(projectId, trimmed, d.origin || undefined, filesToCopy.length > 0 ? filesToCopy : undefined)
      onClose()
    } catch (e) {
      dd({ type: 'setCreating', value: false })
      dd({ type: 'setError', error: cleanIpcError(e, t('failedCreateWorktree')) })
    }
  }

  return (
    <Dialog
      isOpen={true}
      onClose={onClose}
      title={t('addWorktreeTitle')}
      className="dialog--add-worktree"
      actions={
        <>
          <Button onClick={onClose} disabled={d.creating}>
            {t('cancel', { ns: 'common' })}
          </Button>
          <Button variant="primary" onClick={handleAdd} disabled={d.loadingRemotes} loading={d.creating}>
            {!d.creating && <IconGitBranch size={14} />}
            {d.creating ? t('creating', { ns: 'common' }) : t('create', { ns: 'common' })}
          </Button>
        </>
      }
    >
      <div className="add-worktree-form">
        <div className={`add-worktree-grid${jiraAvailable ? '' : ' add-worktree-grid--single'}`}>
          <div className="dialog-field">
            <label>
              {t('originBranchLabel')}
              <span className="dialog-label-hint">{t('originBranchHint')}</span>
            </label>
            <Combobox
              items={d.remotes}
              value={d.origin}
              onSelect={selectOriginBranch}
              disabled={d.loadingRemotes || d.creating}
              filterPlaceholder={t('searchOriginBranches')}
              emptyText={t('noBranchesMatch')}
              className="branch-combobox"
              triggerClassName="branch-combobox__trigger"
              renderItem={(item, { isSelected }) => (
                <>
                  <span className="branch-combobox__item-label">{item}</span>
                  {isSelected && (
                    <IconCheckFill className="branch-combobox__check" />
                  )}
                </>
              )}
            >
              <IconGitBranch className="branch-combobox__leading-icon" size={13} />
              <span className="branch-combobox__value">
                {d.loadingRemotes
                  ? t('fetchingBranches')
                  : d.origin || t('noRemoteBranches')}
              </span>
              {!d.loadingRemotes && (
                <IconChevronDownFill className="branch-combobox__chevron" />
              )}
              {d.loadingRemotes && <Spinner size="sm" />}
            </Combobox>
          </div>

          {jiraAvailable && (
            <JiraLookupField
              disabled={d.creating}
              branchPrefix={defaultBranchPrefix}
              jiraBaseUrl={jiraBaseUrl}
              onResolved={handleJiraResolved}
              onError={() => {}}
            />
          )}
        </div>

        <div className="dialog-field add-worktree-branch-field">
          <label>{t('localBranchLabel')}</label>
          <div className="add-worktree-branch-row">
            <input
              value={d.branch}
              onChange={(e) => {
                const val = e.target.value
                dd({ type: 'setBranch', value: val, error: val.trim() ? (validateBranchName(val.trim()) ?? '') : '' })
              }}
              onKeyDown={(e) => e.key === 'Enter' && !d.loadingRemotes && !d.creating && handleAdd()}
              autoFocus
              disabled={d.loadingRemotes || d.creating}
              placeholder={d.loadingRemotes ? t('fetchingBranches') : t('localBranchPlaceholder')}
            />
            <Button
              className="add-worktree-reroll-button"
              onClick={handleReroll}
              title={t('randomNameTitle')}
              aria-label={t('randomNameTitle')}
              disabled={d.loadingRemotes || d.creating}
            >
              <IconRefresh size={14} />
            </Button>
          </div>
          {d.error && (
            <div className="add-worktree-field-error">
              {d.error}
            </div>
          )}
        </div>

        <CopyFilesSection state={copyState} dispatch={copyDispatch} />
        {!copyState.loading && (
          <button
            className="copy-files-settings-link"
            onClick={() => {
              useUIStore.getState().openSettings(`project:${projectId}`)
              onClose()
            }}
          >
            <IconSettings size={11} />
            {t('configureInSettings')}
          </button>
        )}
      </div>
    </Dialog>
  )
}
