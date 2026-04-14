/**
 * Reducer, state types, and action types for DiffReviewView.
 * Extracted to keep the component file under the 450-line limit.
 */
import type { DiffHunk, DiffLine } from '@/lib/diffUtils'
import type { DiffComment } from '@/types'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface EditingRange {
  hunkIdx: number
  anchorLineIdx: number
  startLineIdx: number
  endLineIdx: number
}

export interface DiffReviewState {
  diff: string
  hunks: DiffHunk[]
  loading: boolean
  isBinary: boolean
  stats: { add: number; del: number } | null
  editing: EditingRange | null
  commentDraft: string
  comments: DiffComment[]
  expandedGaps: Set<number>
  fileLines: string[] | null
}

export type Action =
  | { type: 'LOADING' }
  | { type: 'LOADED'; diff: string; hunks: DiffHunk[]; stats: { add: number; del: number } | null }
  | { type: 'LOADED_BINARY' }
  | { type: 'ERROR' }
  | { type: 'START_DRAG'; hunkIdx: number; lineIdx: number }
  | { type: 'EXTEND_DRAG'; lineIdx: number }
  | { type: 'FINISH_DRAG'; existingText?: string }
  | { type: 'OPEN_EXISTING'; hunkIdx: number; lineIdx: number; endLineIdx?: number; existingText: string }
  | { type: 'SET_DRAFT'; text: string }
  | { type: 'CLOSE_EDITOR' }
  | { type: 'ADD_COMMENT'; comment: DiffComment }
  | { type: 'REMOVE_COMMENT'; commentId: string }
  | { type: 'CLEAR_COMMENTS' }
  | { type: 'FILE_LOADED'; lines: string[] }
  | { type: 'EXPAND_GAP'; gapIndex: number; lines: DiffLine[] }

// ─── Helpers ─────────────────────────────────────────────────────────────────

function rangesOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart <= bEnd && bStart <= aEnd
}

// ─── Reducer ─────────────────────────────────────────────────────────────────

export const initialState: DiffReviewState = {
  diff: '', hunks: [], loading: true, isBinary: false, stats: null,
  editing: null, commentDraft: '', comments: [],
  expandedGaps: new Set(), fileLines: null,
}

export function reducer(state: DiffReviewState, action: Action): DiffReviewState {
  switch (action.type) {
    case 'LOADING':
      return { ...state, loading: true, isBinary: false, editing: null, commentDraft: '', expandedGaps: new Set(), fileLines: null }
    case 'LOADED':
      return { ...state, loading: false, isBinary: false, diff: action.diff, hunks: action.hunks, stats: action.stats }
    case 'LOADED_BINARY':
      return { ...state, loading: false, isBinary: true, diff: '', hunks: [], stats: null }
    case 'ERROR':
      return { ...state, loading: false, diff: '', hunks: [], stats: null }
    case 'START_DRAG':
      return {
        ...state,
        editing: {
          hunkIdx: action.hunkIdx, anchorLineIdx: action.lineIdx,
          startLineIdx: action.lineIdx, endLineIdx: action.lineIdx,
        },
        commentDraft: '',
      }
    case 'EXTEND_DRAG': {
      if (!state.editing) return state
      const anchor = state.editing.anchorLineIdx
      const start = Math.min(anchor, action.lineIdx)
      const end = Math.max(anchor, action.lineIdx)
      if (start === state.editing.startLineIdx && end === state.editing.endLineIdx) return state
      return { ...state, editing: { ...state.editing, startLineIdx: start, endLineIdx: end } }
    }
    case 'FINISH_DRAG':
      return { ...state, commentDraft: action.existingText ?? '' }
    case 'OPEN_EXISTING':
      return {
        ...state,
        editing: {
          hunkIdx: action.hunkIdx, anchorLineIdx: action.lineIdx,
          startLineIdx: action.lineIdx, endLineIdx: action.endLineIdx ?? action.lineIdx,
        },
        commentDraft: action.existingText,
      }
    case 'SET_DRAFT':
      return { ...state, commentDraft: action.text }
    case 'CLOSE_EDITOR':
      return { ...state, editing: null, commentDraft: '' }
    case 'ADD_COMMENT': {
      const c = action.comment
      const cEnd = c.endLine ?? c.line
      const isDel = c.lineType === 'del'
      const filtered = state.comments.filter((existing) => {
        if (existing.file !== c.file) return true
        if ((existing.lineType === 'del') !== isDel) return true
        const eEnd = existing.endLine ?? existing.line
        return !rangesOverlap(existing.line, eEnd, c.line, cEnd)
      })
      return { ...state, comments: [...filtered, c] }
    }
    case 'REMOVE_COMMENT':
      return { ...state, comments: state.comments.filter((c) => c.id !== action.commentId) }
    case 'CLEAR_COMMENTS':
      return { ...state, comments: [] }
    case 'FILE_LOADED':
      return { ...state, fileLines: action.lines }
    case 'EXPAND_GAP': {
      // Insert gap ctx lines into the adjacent hunk, close editor
      const targetIdx = action.gapIndex === 0 ? 0
        : action.gapIndex >= state.hunks.length ? state.hunks.length - 1
        : action.gapIndex - 1
      const prepend = action.gapIndex === 0
      const newHunks = state.hunks.map((h, i) => {
        if (i !== targetIdx) return h
        return {
          ...h,
          lines: prepend ? [...action.lines, ...h.lines] : [...h.lines, ...action.lines],
        }
      })
      const newExpanded = new Set(state.expandedGaps)
      newExpanded.add(action.gapIndex)
      return { ...state, hunks: newHunks, expandedGaps: newExpanded, editing: null, commentDraft: '' }
    }
    default:
      return state
  }
}
