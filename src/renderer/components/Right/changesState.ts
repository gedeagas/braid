import type { GitChange } from '@/types'
import { flash } from '@/store/flash'
import i18n from '@/lib/i18n'
import { cleanIpcError } from '@/lib/ipc'

// ─── Constants ───────────────────────────────────────────────

export const STATUS_META: Record<string, { label: string; className: string; titleKey: string }> = {
  M: { label: 'M', className: 'change-badge-M', titleKey: 'statusModified' },
  A: { label: 'A', className: 'change-badge-A', titleKey: 'statusAdded' },
  D: { label: 'D', className: 'change-badge-D', titleKey: 'statusDeleted' },
  '?': { label: '?', className: 'change-badge-U', titleKey: 'statusUntracked' },
  R: { label: 'R', className: 'change-badge-R', titleKey: 'statusRenamed' },
}

// ─── State ───────────────────────────────────────────────────

export interface ChangesState {
  changes: GitChange[]
  upstream: string | null | undefined
  refreshing: boolean
  stagingInProgress: boolean
  pullState: 'idle' | 'pulling' | 'success' | 'error'
  commitMessage: string
  commitState: 'idle' | 'committing' | 'success' | 'error'
  generateState: 'idle' | 'generating' | 'error'
  generatedViaAI: boolean
  discardConfirmFiles: Array<{ file: string; status: string; staged?: boolean }> | null
  stagedCollapsed: boolean
  unstagedCollapsed: boolean
  showStrategyDialog: boolean
  // Push / sync
  aheadCount: number
  behindCount: number
  syncUpstream: string | null
  pushState: 'idle' | 'pushing' | 'success' | 'error'
  pushError: string | null
}

export type ChangesAction =
  | { type: 'SET_CHANGES'; changes: GitChange[] }
  | { type: 'SET_UPSTREAM'; upstream: string | null }
  | { type: 'SET_REFRESHING'; value: boolean }
  | { type: 'SET_STAGING_IN_PROGRESS'; value: boolean }
  | { type: 'SET_PULL_STATE'; pullState: 'idle' | 'pulling' | 'success' | 'error' }
  | { type: 'SET_COMMIT_MESSAGE'; message: string }
  | { type: 'SET_COMMIT_STATE'; commitState: 'idle' | 'committing' | 'success' | 'error' }
  | { type: 'SET_GENERATE_STATE'; generateState: 'idle' | 'generating' | 'error' }
  | { type: 'SET_GENERATED_VIA_AI'; value: boolean }
  | { type: 'SHOW_DISCARD_CONFIRM'; files: Array<{ file: string; status: string; staged?: boolean }> }
  | { type: 'HIDE_DISCARD_CONFIRM' }
  | { type: 'TOGGLE_SECTION'; section: 'staged' | 'unstaged' }
  | { type: 'SHOW_STRATEGY_DIALOG' }
  | { type: 'HIDE_STRATEGY_DIALOG' }
  | { type: 'SET_SYNC_STATUS'; aheadCount: number; behindCount: number; upstream: string | null }
  | { type: 'SET_PUSH_STATE'; pushState: 'idle' | 'pushing' | 'success' | 'error' }
  | { type: 'SET_PUSH_ERROR'; message: string | null }

export const initialState: ChangesState = {
  changes: [],
  upstream: undefined,
  refreshing: false,
  stagingInProgress: false,
  pullState: 'idle',
  commitMessage: '',
  commitState: 'idle',
  generateState: 'idle',
  generatedViaAI: false,
  discardConfirmFiles: null,
  stagedCollapsed: false,
  unstagedCollapsed: false,
  showStrategyDialog: false,
  aheadCount: 0,
  behindCount: 0,
  syncUpstream: null,
  pushState: 'idle',
  pushError: null,
}

// ─── Reducer ─────────────────────────────────────────────────

export function changesReducer(state: ChangesState, action: ChangesAction): ChangesState {
  switch (action.type) {
    case 'SET_CHANGES':
      return { ...state, changes: action.changes }
    case 'SET_UPSTREAM':
      return { ...state, upstream: action.upstream }
    case 'SET_REFRESHING':
      return { ...state, refreshing: action.value }
    case 'SET_STAGING_IN_PROGRESS':
      return { ...state, stagingInProgress: action.value }
    case 'SET_PULL_STATE':
      return { ...state, pullState: action.pullState }
    case 'SET_COMMIT_MESSAGE':
      return { ...state, commitMessage: action.message, generatedViaAI: action.message === '' ? false : state.generatedViaAI }
    case 'SET_COMMIT_STATE':
      return { ...state, commitState: action.commitState }
    case 'SET_GENERATE_STATE':
      return { ...state, generateState: action.generateState }
    case 'SET_GENERATED_VIA_AI':
      return { ...state, generatedViaAI: action.value }
    case 'SHOW_DISCARD_CONFIRM':
      return { ...state, discardConfirmFiles: action.files }
    case 'HIDE_DISCARD_CONFIRM':
      return { ...state, discardConfirmFiles: null }
    case 'TOGGLE_SECTION':
      return action.section === 'staged'
        ? { ...state, stagedCollapsed: !state.stagedCollapsed }
        : { ...state, unstagedCollapsed: !state.unstagedCollapsed }
    case 'SHOW_STRATEGY_DIALOG':
      return { ...state, showStrategyDialog: true, pullState: 'idle' }
    case 'HIDE_STRATEGY_DIALOG':
      return { ...state, showStrategyDialog: false }
    case 'SET_SYNC_STATUS':
      return { ...state, aheadCount: action.aheadCount, behindCount: action.behindCount, syncUpstream: action.upstream }
    case 'SET_PUSH_STATE':
      return { ...state, pushState: action.pushState }
    case 'SET_PUSH_ERROR':
      return { ...state, pushError: action.message }
    default:
      return state
  }
}

// ─── Commit Draft Cache ─────────────────────────────────────
// Module-level cache so commit message drafts (and in-flight AI
// generation results) survive worktree switches.

export interface CommitDraft {
  commitMessage: string
  generatedViaAI: boolean
  generateState: 'idle' | 'generating' | 'error'
}

export const commitDraftCache = new Map<string, CommitDraft>()

export function saveCommitDraft(worktreePath: string, state: ChangesState): void {
  commitDraftCache.set(worktreePath, {
    commitMessage: state.commitMessage,
    generatedViaAI: state.generatedViaAI,
    generateState: state.generateState,
  })
}

export function restoreCommitDraft(worktreePath: string): Partial<ChangesState> {
  const draft = commitDraftCache.get(worktreePath)
  if (!draft) return {}
  return {
    commitMessage: draft.commitMessage,
    generatedViaAI: draft.generatedViaAI,
    // Never restore 'generating' - the IPC call belongs to the old component
    // instance and won't dispatch into this one's reducer.
    generateState: draft.generateState === 'generating' ? 'idle' : draft.generateState,
  }
}

// ─── Helpers ─────────────────────────────────────────────────

/** Extract error message, falling back to a translated key */
export function flashError(err: unknown, fallbackKey: string, duration?: number): void {
  const msg = cleanIpcError(err, i18n.t(fallbackKey, { ns: 'right' }))
  flash('error', msg, duration, 'bottom-right')
}
