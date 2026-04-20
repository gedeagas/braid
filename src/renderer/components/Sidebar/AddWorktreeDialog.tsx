import { useEffect, useRef, useCallback, useReducer } from 'react'
import { useProjectsStore } from '@/store/projects'
import { useUIStore } from '@/store/ui'
import * as ipc from '@/lib/ipc'
import { cleanIpcError } from '@/lib/ipc'
import { validateBranchName } from '@/lib/branchValidation'
import { randomBranchName } from '@/lib/randomBranch'
import { useTranslation } from 'react-i18next'
import { IconGitBranch, IconChevronDownFill, IconCheckFill, IconSettings } from '@/components/shared/icons'
import { Button, Combobox, Dialog, Spinner } from '@/components/ui'
import { copyFilesReducer } from './copyFilesReducer'
import { JiraLookupField, useJiraAvailable } from './JiraLookupField'
import { LinearLookupField, useLinearAvailable } from './LinearLookupField'
import { CopyFilesSection } from './CopyFilesSection'
import type { JiraIssue, LinearIssue } from '@/types'

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
    case 'remotesLoaded': return { ...s, remotes: a.remotes, origin: a.origin, branch: a.branch, loadingRemotes: false }
    case 'remotesFailed': return { ...s, loadingRemotes: false, branch: a.branch }
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
  const linearApiKey = useUIStore((s) => s.linearApiKey)
  const linearAvailable = useLinearAvailable(linearApiKey)

  // Ref so the fetch callback always sees the latest value without re-running the effect
  const userEditedRef = useRef(false)

  const addWorktree = useProjectsStore((s) => s.addWorktree)
  const project = useProjectsStore((s) => s.projects.find((p) => p.id === projectId))
  const globalBranchPrefix = useUIStore((s) => s.defaultBranchPrefix)
  const discoveryPatterns = useUIStore((s) => s.discoveryPatterns)
  const jiraBaseUrl = useUIStore((s) => s.jiraBaseUrl)
  const defaultBranchPrefix = project?.settings?.branchPrefix || globalBranchPrefix
  const { t } = useTranslation('sidebar')

  useEffect(() => { userEditedRef.current = d.userEdited }, [d.userEdited])

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
        dd({ type: 'remotesLoaded', remotes: branches, origin: initial,
          branch: userEditedRef.current ? d.branch : withPrefix(baseName) })
      })
      .catch(() => {
        if (!userEditedRef.current) dd({ type: 'remotesFailed', branch: withPrefix(randomBranchName()) })
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

  const handleLinearResolved = useCallback((_issue: LinearIssue, branch: string, validationError: string | null) => {
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
      actions={
        <>
          <Button onClick={onClose} disabled={d.creating}>
            {t('cancel', { ns: 'common' })}
          </Button>
          <Button variant="primary" onClick={handleAdd} disabled={d.loadingRemotes} loading={d.creating}>
            {d.creating ? t('creating', { ns: 'common' }) : t('create', { ns: 'common' })}
          </Button>
        </>
      }
    >
      {/* Origin branch selector */}
      <div className="dialog-field">
        <label>{t('originBranchLabel')} <span style={{ color: 'var(--text-tertiary)', fontWeight: 400 }}>{t('originBranchHint')}</span></label>
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
              {item}
              {isSelected && (
                <IconCheckFill style={{ marginLeft: 'auto', color: 'var(--accent)', flexShrink: 0 }} />
              )}
            </>
          )}
        >
          <IconGitBranch size={13} style={{ opacity: 0.6, flexShrink: 0 }} />
          <span className="branch-combobox__value">
            {d.loadingRemotes
              ? t('fetchingBranches')
              : d.origin || t('noRemoteBranches')}
          </span>
          {!d.loadingRemotes && (
            <IconChevronDownFill style={{ opacity: 0.5, flexShrink: 0 }} />
          )}
          {d.loadingRemotes && <Spinner size="sm" />}
        </Combobox>
      </div>

      {/* Jira ticket lookup */}
      {jiraAvailable && (
        <JiraLookupField
          disabled={d.creating}
          branchPrefix={defaultBranchPrefix}
          jiraBaseUrl={jiraBaseUrl}
          onResolved={handleJiraResolved}
          onError={() => {}}
        />
      )}

      {/* Linear issue lookup */}
      {linearAvailable && (
        <LinearLookupField
          disabled={d.creating}
          branchPrefix={defaultBranchPrefix}
          linearApiKey={linearApiKey}
          onResolved={handleLinearResolved}
          onError={() => {}}
        />
      )}

      {/* Local branch name */}
      <div className="dialog-field">
        <label>{t('localBranchLabel')}</label>
        <div style={{ display: 'flex', gap: 'var(--space-8)' }}>
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
          <Button onClick={handleReroll} title={t('randomNameTitle')} disabled={d.loadingRemotes || d.creating}>
            🎲
          </Button>
        </div>
        {d.error && (
          <div style={{ color: 'var(--red)', fontSize: 'var(--text-base)', marginTop: 'var(--space-4)' }}>
            {d.error}
          </div>
        )}
      </div>

      {/* Copy files */}
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
    </Dialog>
  )
}
