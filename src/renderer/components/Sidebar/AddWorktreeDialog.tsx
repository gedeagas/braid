import { useEffect, useCallback, useMemo, useReducer, useState } from 'react'
import { useProjectsStore } from '@/store/projects'
import { useUIStore } from '@/store/ui'
import * as ipc from '@/lib/ipc'
import { cleanIpcError } from '@/lib/ipc'
import { validateBranchName } from '@/lib/branchValidation'
import { buildJiraIssueLink, buildJiraIssuePrompt } from '@/lib/jiraPrompt'
import { randomBranchName } from '@/lib/randomBranch'
import { useDetectedAgents } from '@/lib/agentDetection'
import { useTranslation } from 'react-i18next'
import { IconGitBranch, IconChevronDownFill, IconCheckFill, IconSettings, IconRefresh, AgentIcon } from '@/components/shared/icons'
import { Button, Checkbox, Combobox, Dialog, Spinner } from '@/components/ui'
import { SegmentedControl } from '@/components/shared/SegmentedControl'
import { copyFilesReducer } from './copyFilesReducer'
import { JiraLookupField, useJiraAvailable } from './JiraLookupField'
import { CopyFilesSection } from './CopyFilesSection'
import type { JiraIssue, Worktree } from '@/types'

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

// ── Jira agent-launch preferences ───────────────────────────────────────────

type JiraContextMode = 'full' | 'link'

interface JiraAgentPrefs {
  /** Whether to launch an agent after the worktree is created. */
  start: boolean
  /** How much ticket context to paste: the full fenced dump or a compact link. */
  contextMode: JiraContextMode
}

type JiraAgentAction =
  | { type: 'enable' }
  | { type: 'setStart'; value: boolean }
  | { type: 'setMode'; value: JiraContextMode }

function jiraAgentReducer(s: JiraAgentPrefs, a: JiraAgentAction): JiraAgentPrefs {
  switch (a.type) {
    case 'enable': return { ...s, start: true }
    case 'setStart': return { ...s, start: a.value }
    case 'setMode': return { ...s, contextMode: a.value }
  }
}

interface Props {
  projectId: string
  repoPath: string
  onClose: () => void
  prefill?: AddWorktreeDialogPrefill
  onCreated?: (worktree: Worktree) => void
}

export interface AddWorktreeDialogPrefill {
  branch?: string
  sourceBranch?: string | null
  baseBranch?: string | null
  jiraKey?: string | null
  locked?: boolean
}

/** Strip the remote prefix from a remote-tracking ref, e.g. "origin/main" -> "main" */
function stripRemote(b: string): string {
  const slash = b.indexOf('/')
  return slash !== -1 ? b.slice(slash + 1) : b
}

export function AddWorktreeDialog({ projectId, repoPath, onClose, prefill, onCreated }: Props) {
  const prefilledBranch = prefill?.branch?.trim() ?? ''
  const prefilledJiraKey = prefill?.jiraKey?.trim().toUpperCase() ?? ''
  const branchLocked = Boolean(prefill?.locked && prefilledBranch)
  const jiraLocked = Boolean(prefill?.locked && prefilledJiraKey)
  const sourceBranchLocked = Boolean(prefill?.locked && prefill?.sourceBranch?.trim())
  const [d, dd] = useReducer(dialogReducer, {
    branch: prefilledBranch, userEdited: Boolean(prefilledBranch), error: prefilledBranch ? (validateBranchName(prefilledBranch) ?? '') : '',
    origin: '', remotes: [], loadingRemotes: true,
    creating: false,
  })

  const [copyState, copyDispatch] = useReducer(copyFilesReducer, {
    savedFiles: [], discoveredFiles: [], loading: false, sourceBranch: '',
  })
  const [jiraIssue, setJiraIssue] = useState<JiraIssue | null>(null)
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null)
  const [jiraPrefs, jiraPrefsDispatch] = useReducer(jiraAgentReducer, { start: true, contextMode: 'full' })

  const jiraAvailable = useJiraAvailable()
  const detectedAgents = useDetectedAgents()

  const addWorktree = useProjectsStore((s) => s.addWorktree)
  const project = useProjectsStore((s) => s.projects.find((p) => p.id === projectId))
  const globalBranchPrefix = useUIStore((s) => s.defaultBranchPrefix)
  const discoveryPatterns = useUIStore((s) => s.discoveryPatterns)
  const jiraBaseUrl = useUIStore((s) => s.jiraBaseUrl)
  const setActiveCenterView = useUIStore((s) => s.setActiveCenterView)
  const createBigTerminal = useUIStore((s) => s.createBigTerminal)
  const lastNewTabAction = useUIStore((s) => s.lastNewTabAction)
  const setLastNewTabAction = useUIStore((s) => s.setLastNewTabAction)
  const defaultBranchPrefix = project?.settings?.branchPrefix || globalBranchPrefix
  const { t } = useTranslation('sidebar')

  const selectedAgent = useMemo(() => {
    return detectedAgents.find((agent) => agent.id === selectedAgentId) ?? detectedAgents[0] ?? null
  }, [detectedAgents, selectedAgentId])

  const agentLabels = useMemo(() => detectedAgents.map((agent) => agent.label), [detectedAgents])

  // Fetch remote branches via gh CLI on mount
  useEffect(() => {
    const withPrefix = (name: string) => defaultBranchPrefix ? `${defaultBranchPrefix}${name}` : name
    ipc.git.getRemoteBranches(repoPath)
      .then((result) => {
        const branches: string[] = Array.isArray(result) ? result : (result?.branches ?? [])
        const defaultBranch: string | undefined = Array.isArray(result) ? undefined : result?.defaultBranch
        const projectDefault = project?.settings?.defaultBaseBranch || undefined
        const preferredSource = prefill?.sourceBranch || prefill?.baseBranch || undefined
        const preferredRemoteSource = preferredSource && !preferredSource.includes('/') ? `origin/${preferredSource}` : preferredSource
        const preferredRemoteInList = preferredRemoteSource
          ? branches.find((b) => b === preferredRemoteSource) || branches.find((b) => stripRemote(b) === stripRemote(preferredRemoteSource))
          : undefined
        const remoteBranches = preferredRemoteSource && !branches.some((b) => b === preferredRemoteSource)
          ? [preferredRemoteSource, ...branches]
          : branches
        const preferred = preferredRemoteInList
          || preferredRemoteSource
          || (projectDefault && branches.find((b) => b === projectDefault))
          || (defaultBranch && branches.find((b) => b === defaultBranch))
          || branches.find((b) => b === 'origin/main' || b === 'origin/master')
        const initial = preferred || branches[0] || ''
        const stripped = initial ? stripRemote(initial) : ''
        const baseName = !stripped || stripped === 'main' || stripped === 'master' ? randomBranchName() : stripped
        dd({ type: 'remotesLoaded', remotes: remoteBranches, origin: initial, branch: prefilledBranch || withPrefix(baseName) })
      })
      .catch(() => {
        dd({ type: 'remotesFailed', branch: prefilledBranch || withPrefix(randomBranchName()) })
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

  useEffect(() => {
    if (detectedAgents.length === 0) {
      setSelectedAgentId(null)
      return
    }
    if (selectedAgentId && detectedAgents.some((agent) => agent.id === selectedAgentId)) return
    const lastAgentId = lastNewTabAction === 'claudeCode'
      ? 'claude'
      : lastNewTabAction.startsWith('agent:')
        ? lastNewTabAction.slice(6)
        : null
    const preferred = lastAgentId
      ? detectedAgents.find((agent) => agent.id === lastAgentId)
      : undefined
    setSelectedAgentId((preferred ?? detectedAgents[0]).id)
  }, [detectedAgents, lastNewTabAction, selectedAgentId])

  const selectOriginBranch = useCallback((b: string) => {
    const stripped = stripRemote(b)
    const localBranch = !branchLocked && !d.userEdited
      ? (stripped === 'main' || stripped === 'master' ? randomBranchName() : stripped)
      : undefined
    dd({ type: 'selectOrigin', origin: b, branch: localBranch })
  }, [branchLocked, d.userEdited])

  const handleReroll = () => {
    if (branchLocked) return
    dd({ type: 'reroll', name: randomBranchName() })
  }

  const handleJiraResolved = useCallback((issue: JiraIssue, branch: string, validationError: string | null) => {
    setJiraIssue(issue)
    jiraPrefsDispatch({ type: 'enable' })
    const nextBranch = branchLocked ? d.branch : branch
    dd({ type: 'setBranch', value: nextBranch, error: branchLocked ? (validateBranchName(nextBranch) ?? '') : (validationError ?? '') })
  }, [branchLocked, d.branch])

  const handleJiraCleared = useCallback(() => {
    setJiraIssue(null)
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
      const newWorktree = await addWorktree(projectId, trimmed, d.origin || undefined, filesToCopy.length > 0 ? filesToCopy : undefined)
      onClose()
      if (newWorktree) onCreated?.(newWorktree)
      if (newWorktree && jiraIssue && jiraPrefs.start && selectedAgent) {
        setLastNewTabAction(`agent:${selectedAgent.id}`)
        const initialInput = jiraPrefs.contextMode === 'link'
          ? buildJiraIssueLink(jiraIssue)
          : buildJiraIssuePrompt(jiraIssue)
        const terminalId = createBigTerminal(
          newWorktree.id,
          selectedAgent.label,
          selectedAgent.launchCmd,
          selectedAgent.id,
          initialInput
        )
        setActiveCenterView({ type: 'terminal', terminalId })
      }
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
              <span className="dialog-label-hint">{sourceBranchLocked ? t('lockedFromPullRequest') : t('originBranchHint')}</span>
            </label>
            <Combobox
              items={d.remotes}
              value={d.origin}
              onSelect={selectOriginBranch}
              disabled={d.loadingRemotes || d.creating || sourceBranchLocked}
              filterPlaceholder={t('searchOriginBranches')}
              emptyText={t('noBranchesMatch')}
              className={`branch-combobox${sourceBranchLocked ? ' branch-combobox--locked' : ''}`}
              triggerClassName={`branch-combobox__trigger${sourceBranchLocked ? ' branch-combobox__trigger--locked' : ''}`}
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
              {!d.loadingRemotes && !sourceBranchLocked && (
                <IconChevronDownFill className="branch-combobox__chevron" />
              )}
              {d.loadingRemotes && <Spinner size="sm" />}
            </Combobox>
          </div>

          {jiraAvailable && (
            <JiraLookupField
              disabled={d.creating}
              initialValue={prefilledJiraKey}
              locked={jiraLocked}
              autoLookup={Boolean(prefilledJiraKey)}
              branchPrefix={defaultBranchPrefix}
              jiraBaseUrl={jiraBaseUrl}
              onResolved={handleJiraResolved}
              onError={handleJiraCleared}
              onCleared={handleJiraCleared}
            />
          )}
        </div>

        {jiraIssue && (
          <div className="jira-start-agent-option">
            <Checkbox
              checked={jiraPrefs.start && detectedAgents.length > 0}
              onChange={(value) => jiraPrefsDispatch({ type: 'setStart', value })}
              disabled={d.creating || detectedAgents.length === 0}
              label={t('jiraStartAgentLabel')}
            />
            {jiraPrefs.start && detectedAgents.length > 0 && selectedAgent && (
              <div className="jira-agent-picker">
                <span className="jira-agent-picker__label">{t('jiraAgentLabel')}</span>
                <Combobox
                  items={agentLabels}
                  value={selectedAgent.label}
                  onSelect={(label) => {
                    const agent = detectedAgents.find((entry) => entry.label === label)
                    if (!agent) return
                    setSelectedAgentId(agent.id)
                    setLastNewTabAction(`agent:${agent.id}`)
                  }}
                  disabled={d.creating}
                  filterPlaceholder={t('jiraAgentSearchPlaceholder')}
                  emptyText={t('jiraAgentNoResults')}
                  className="jira-agent-combobox"
                  triggerClassName="jira-agent-combobox__trigger"
                  renderItem={(label) => {
                    const agent = detectedAgents.find((entry) => entry.label === label)
                    return (
                      <>
                        {agent && <AgentIcon agentId={agent.id} size={14} />}
                        <span>{label}</span>
                      </>
                    )
                  }}
                >
                  <AgentIcon agentId={selectedAgent.id} size={14} />
                  <span className="jira-agent-combobox__value">{selectedAgent.label}</span>
                  <IconChevronDownFill className="branch-combobox__chevron" />
                </Combobox>
              </div>
            )}
            {jiraPrefs.start && detectedAgents.length > 0 && selectedAgent && (
              <div className="jira-agent-picker">
                <span className="jira-agent-picker__label">{t('jiraContextLabel')}</span>
                <SegmentedControl
                  options={[
                    { value: 'full', label: t('jiraContextFull') },
                    { value: 'link', label: t('jiraContextLink') },
                  ]}
                  value={jiraPrefs.contextMode}
                  onChange={(value) => jiraPrefsDispatch({ type: 'setMode', value })}
                  disabled={d.creating}
                />
              </div>
            )}
            {detectedAgents.length === 0 && (
              <div className="jira-agent-picker__empty">{t('jiraNoAgentsDetected')}</div>
            )}
          </div>
        )}

        <div className={`dialog-field add-worktree-branch-field${branchLocked ? ' add-worktree-branch-field--locked' : ''}`}>
          <label>
            {t('localBranchLabel')}
            {branchLocked && <span className="dialog-label-hint">{t('lockedFromPullRequest')}</span>}
          </label>
          <div className="add-worktree-branch-row">
            <input
              value={d.branch}
              onChange={(e) => {
                const val = e.target.value
                dd({ type: 'setBranch', value: val, error: val.trim() ? (validateBranchName(val.trim()) ?? '') : '' })
              }}
              onKeyDown={(e) => e.key === 'Enter' && !d.loadingRemotes && !d.creating && handleAdd()}
              autoFocus
              disabled={d.loadingRemotes || d.creating || branchLocked}
              placeholder={d.loadingRemotes ? t('fetchingBranches') : t('localBranchPlaceholder')}
            />
            {!branchLocked && (
              <Button
                className="add-worktree-reroll-button"
                onClick={handleReroll}
                title={t('randomNameTitle')}
                aria-label={t('randomNameTitle')}
                disabled={d.loadingRemotes || d.creating}
              >
                <IconRefresh size={14} />
              </Button>
            )}
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
