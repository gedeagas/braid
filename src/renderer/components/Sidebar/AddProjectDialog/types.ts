// ── Types ────────────────────────────────────────────────────────────────────

export type Tab = 'quickstart' | 'local' | 'github'

export type DialogPhase =
  | { kind: 'idle' }
  | { kind: 'scanning' }
  | { kind: 'picker'; repos: string[] }
  | { kind: 'adding' }

export interface State {
  tab: Tab
  // Local tab
  localPath: string
  // GitHub tab
  githubUrl: string
  // Shared
  phase: DialogPhase
  selectedRepos: Set<string>
  error: string
  cloning: boolean
  // Quick Start tab
  projectName: string
  projectLocation: string
  selectedTemplate: string
  creating: boolean
}

export type Action =
  | { type: 'setTab'; tab: Tab }
  | { type: 'setLocalPath'; value: string }
  | { type: 'setGithubUrl'; value: string }
  | { type: 'setError'; error: string }
  | { type: 'startScanning' }
  | { type: 'showPicker'; repos: string[]; alreadyAdded: Set<string> }
  | { type: 'resetToIdle' }
  | { type: 'toggleRepo'; path: string }
  | { type: 'startAdding' }
  | { type: 'startCloning' }
  | { type: 'cloneDone' }
  // Quick Start actions
  | { type: 'setProjectName'; value: string }
  | { type: 'setProjectLocation'; value: string }
  | { type: 'setTemplate'; value: string }
  | { type: 'startCreating' }
  | { type: 'doneCreating' }

export const initialState: State = {
  tab: 'local',
  localPath: '',
  githubUrl: '',
  phase: { kind: 'idle' },
  selectedRepos: new Set(),
  error: '',
  cloning: false,
  projectName: '',
  projectLocation: '',
  selectedTemplate: 'empty',
  creating: false,
}

export function reducer(s: State, a: Action): State {
  switch (a.type) {
    case 'setTab':
      return { ...s, tab: a.tab, error: '' }
    case 'setLocalPath':
      return { ...s, localPath: a.value, error: '', phase: { kind: 'idle' }, selectedRepos: new Set() }
    case 'setGithubUrl':
      return { ...s, githubUrl: a.value, error: '' }
    case 'setError':
      return { ...s, error: a.error }
    case 'startScanning':
      return { ...s, phase: { kind: 'scanning' }, error: '' }
    case 'showPicker': {
      const selectable = a.repos.filter((r) => !a.alreadyAdded.has(r))
      return { ...s, phase: { kind: 'picker', repos: a.repos }, selectedRepos: new Set(selectable), error: '' }
    }
    case 'resetToIdle':
      return { ...s, phase: { kind: 'idle' } }
    case 'toggleRepo': {
      const next = new Set(s.selectedRepos)
      if (next.has(a.path)) next.delete(a.path)
      else next.add(a.path)
      return { ...s, selectedRepos: next }
    }
    case 'startAdding':
      return { ...s, phase: { kind: 'adding' } }
    case 'startCloning':
      return { ...s, cloning: true, error: '' }
    case 'cloneDone':
      return { ...s, cloning: false }
    // Quick Start
    case 'setProjectName':
      return { ...s, projectName: a.value, error: '' }
    case 'setProjectLocation':
      return { ...s, projectLocation: a.value, error: '' }
    case 'setTemplate':
      return { ...s, selectedTemplate: a.value }
    case 'startCreating':
      return { ...s, creating: true, error: '' }
    case 'doneCreating':
      return { ...s, creating: false }
    default:
      return s
  }
}

// ── URL helpers ──────────────────────────────────────────────────────────────

/** Normalize a GitHub URL to a canonical clone URL, or return null if invalid. */
export function normalizeGitHubUrl(raw: string): string | null {
  const trimmed = raw.trim().replace(/\/+$/, '')

  // SSH: git@github.com:owner/repo[.git]
  const sshMatch = trimmed.match(/^git@github\.com:([^/\s]+)\/([^/\s]+?)(?:\.git)?$/)
  if (sshMatch) return `git@github.com:${sshMatch[1]}/${sshMatch[2]}.git`

  // HTTPS: https://github.com/owner/repo[.git][/tree/branch/...]
  const httpsMatch = trimmed.match(/^https?:\/\/github\.com\/([^/\s]+)\/([^/\s.]+)(?:\.git)?(?:\/.*)?$/)
  if (httpsMatch) return `https://github.com/${httpsMatch[1]}/${httpsMatch[2]}.git`

  return null
}

/** Extract "owner/repo" slug from a normalized GitHub URL. */
export function extractRepoSlug(normalizedUrl: string): string {
  const sshMatch = normalizedUrl.match(/^git@github\.com:(.+?)(?:\.git)?$/)
  if (sshMatch) return sshMatch[1]
  const httpsMatch = normalizedUrl.match(/github\.com\/(.+?)(?:\.git)?$/)
  if (httpsMatch) return httpsMatch[1]
  return normalizedUrl
}

/** Validate a project name for filesystem safety. */
export const PROJECT_NAME_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/
