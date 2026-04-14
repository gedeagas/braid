import { useReducer, useCallback, useRef, useMemo } from 'react'
import type { AttachedFile, AgentSession } from '@/types'
import * as ipc from '@/lib/ipc'
import { sessionWorktreePaths } from '@/store/sessions/storage'

const MAX_FILE_SIZE = 100 * 1024 // 100 KB
const MAX_RESULTS = 15

/** Virtual path used for the "all terminals" mention entry. */
export const TERMINAL_ENTRY = '__terminal__'

// ─── State & Actions ─────────────────────────────────────────────────────────

interface MentionState {
  showMention: boolean
  mentionFilter: string
  mentionIndex: number
  attachedFiles: AttachedFile[]
  trackedFiles: string[]
  fetchedOnce: boolean
}

type MentionAction =
  | { type: 'OPEN'; filter: string }
  | { type: 'CLOSE' }
  | { type: 'SET_FILTER'; filter: string }
  | { type: 'SET_INDEX'; index: number }
  | { type: 'SET_TRACKED_FILES'; files: string[] }
  | { type: 'ADD_FILE'; file: AttachedFile }
  | { type: 'REMOVE_FILE'; index: number }
  | { type: 'CLEAR_FILES' }

const initialState: MentionState = {
  showMention: false,
  mentionFilter: '',
  mentionIndex: 0,
  attachedFiles: [],
  trackedFiles: [],
  fetchedOnce: false,
}

function reducer(state: MentionState, action: MentionAction): MentionState {
  switch (action.type) {
    case 'OPEN':
      return { ...state, showMention: true, mentionFilter: action.filter, mentionIndex: 0 }
    case 'CLOSE':
      return { ...state, showMention: false, mentionFilter: '', mentionIndex: 0 }
    case 'SET_FILTER':
      return { ...state, mentionFilter: action.filter, mentionIndex: 0 }
    case 'SET_INDEX':
      return { ...state, mentionIndex: action.index }
    case 'SET_TRACKED_FILES':
      return { ...state, trackedFiles: action.files, fetchedOnce: true }
    case 'ADD_FILE':
      // Deduplicate: skip if file already attached
      if (state.attachedFiles.some(f => f.path === action.file.path)) {
        return { ...state, showMention: false, mentionFilter: '', mentionIndex: 0 }
      }
      return { ...state, attachedFiles: [...state.attachedFiles, action.file], showMention: false, mentionFilter: '', mentionIndex: 0 }
    case 'REMOVE_FILE':
      return { ...state, attachedFiles: state.attachedFiles.filter((_, i) => i !== action.index) }
    case 'CLEAR_FILES':
      return { ...state, attachedFiles: [] }
    default:
      return state
  }
}

// ─── @ detection ─────────────────────────────────────────────────────────────

function findMentionTrigger(text: string, cursorPos: number): { start: number; filter: string } | null {
  const beforeCursor = text.slice(0, cursorPos)
  const atIndex = beforeCursor.lastIndexOf('@')
  if (atIndex === -1) return null
  if (atIndex > 0 && !/\s/.test(beforeCursor[atIndex - 1])) return null
  const filter = beforeCursor.slice(atIndex + 1)
  if (filter.includes(' ')) return null
  return { start: atIndex, filter }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Strip ANSI escape sequences from terminal output. */
function stripAnsi(text: string): string {
  // CSI sequences (incl. ? modifier), OSC sequences, single-char escapes, carriage returns
  return text.replace(/\x1b\[[\x20-\x3f]*[0-9;]*[\x40-\x7e]|\x1b\].*?(?:\x07|\x1b\\)|\x1b[()][0-9A-B]|\r/g, '')
}

/** Check whether the filter text matches the terminal keyword. */
function isTerminalFilter(filter: string): boolean {
  return 'terminal'.startsWith(filter.toLowerCase()) && filter.length > 0
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export interface UseMentionReturn {
  showMention: boolean
  mentionFilter: string
  mentionIndex: number
  attachedFiles: AttachedFile[]
  filteredFiles: string[]
  isLoadingFiles: boolean
  handleInputChangeForMention: (value: string, cursorPos: number) => void
  handleMentionKeyDown: (e: React.KeyboardEvent) => boolean
  selectMention: (filePath: string) => void
  removeFile: (index: number) => void
  clearFiles: () => void
  buildPromptWithFiles: (text: string) => string
}

export function useMentionAutocomplete(
  session: AgentSession | null,
  input: string,
  setInput: (value: string) => void
): UseMentionReturn {
  const [state, dispatch] = useReducer(reducer, initialState)
  const fetchingRef = useRef(false)
  const triggerRef = useRef<{ start: number; filter: string } | null>(null)
  // Refs to avoid stale closures in async callbacks
  const inputRef = useRef(input)
  inputRef.current = input
  const setInputRef = useRef(setInput)
  setInputRef.current = setInput

  const getWorktreePath = useCallback((): string | null => {
    if (!session) return null
    return sessionWorktreePaths.get(session.id) ?? null
  }, [session])

  const fetchTrackedFiles = useCallback(async (worktreePath: string) => {
    if (fetchingRef.current) return
    fetchingRef.current = true
    try {
      const files = await ipc.git.getTrackedFiles(worktreePath)
      dispatch({ type: 'SET_TRACKED_FILES', files })
    } finally {
      fetchingRef.current = false
    }
  }, [])

  // Compute filtered files once - used by both keyDown handler and component
  const filteredFiles = useMemo(() => {
    if (!state.showMention) return []
    const filter = state.mentionFilter

    // When filter matches "terminal", show the terminal entry at the top
    const items: string[] = []
    if (isTerminalFilter(filter)) {
      items.push(TERMINAL_ENTRY)
    }

    // Also show matching tracked files
    const fileMatches = state.trackedFiles
      .filter(f => f.toLowerCase().includes(filter.toLowerCase()))
      .slice(0, MAX_RESULTS - items.length)
    items.push(...fileMatches)

    return items
  }, [state.showMention, state.trackedFiles, state.mentionFilter])

  const handleInputChangeForMention = useCallback((value: string, cursorPos: number) => {
    const trigger = findMentionTrigger(value, cursorPos)
    if (trigger) {
      triggerRef.current = trigger
      // If we already have files, show them immediately. The main-process cache
      // (60s TTL) ensures the IPC round-trip returns in <5ms on cache hit,
      // and we silently refresh in the background anyway.
      const worktreePath = getWorktreePath()
      if (worktreePath && !(state.fetchedOnce && state.trackedFiles.length > 0)) {
        fetchTrackedFiles(worktreePath)
      }
      if (state.showMention) {
        dispatch({ type: 'SET_FILTER', filter: trigger.filter })
      } else {
        dispatch({ type: 'OPEN', filter: trigger.filter })
      }
    } else {
      triggerRef.current = null
      if (state.showMention) {
        dispatch({ type: 'CLOSE' })
      }
    }
  }, [getWorktreePath, state.showMention, state.fetchedOnce, state.trackedFiles.length, fetchTrackedFiles])

  const selectMention = useCallback(async (filePath: string) => {
    const worktreePath = getWorktreePath()
    if (!worktreePath) return
    // Capture and clear trigger before the async gap to prevent race conditions
    // when two files are selected rapidly - the second call would otherwise find
    // triggerRef.current already nulled by the first and skip text replacement.
    const trigger = triggerRef.current
    triggerRef.current = null

    if (filePath === TERMINAL_ENTRY) {
      // Fetch terminal output via IPC
      try {
        const terminals = await ipc.pty.readTerminalOutput(worktreePath)
        if (terminals.length === 0) {
          dispatch({ type: 'CLOSE' })
          return
        }
        const sections = terminals.map((t: { ptyId: string; output: string }, i: number) => {
          const cleaned = stripAnsi(t.output)
          const lines = cleaned.split('\n')
          // Keep last 200 lines per terminal
          return `--- Terminal ${i + 1} (${t.ptyId}) ---\n${lines.slice(-200).join('\n')}`
        })
        dispatch({ type: 'ADD_FILE', file: { path: TERMINAL_ENTRY, content: sections.join('\n\n') } })
      } catch {
        dispatch({ type: 'ADD_FILE', file: { path: TERMINAL_ENTRY, content: '(no terminal output available)' } })
      }
      // Replace @filter with @terminal in the input
      if (trigger) {
        const currentInput = inputRef.current
        const before = currentInput.slice(0, trigger.start)
        const after = currentInput.slice(trigger.start + 1 + trigger.filter.length)
        setInputRef.current(`${before}@terminal ${after}`)
      }
      return
    }

    try {
      const content = await ipc.git.readFile(`${worktreePath}/${filePath}`)
      // File size guard: skip files over 100KB
      if (content.length > MAX_FILE_SIZE) {
        dispatch({ type: 'CLOSE' })
        return
      }
      dispatch({ type: 'ADD_FILE', file: { path: filePath, content } })
    } catch {
      dispatch({ type: 'ADD_FILE', file: { path: filePath, content: '(failed to read file)' } })
    }
    // Replace @filter with @path in the input (use refs for fresh values)
    if (trigger) {
      const currentInput = inputRef.current
      const before = currentInput.slice(0, trigger.start)
      const after = currentInput.slice(trigger.start + 1 + trigger.filter.length)
      setInputRef.current(`${before}@${filePath} ${after}`)
    }
  }, [getWorktreePath])

  const handleMentionKeyDown = useCallback((e: React.KeyboardEvent): boolean => {
    if (!state.showMention) return false
    const maxIndex = filteredFiles.length - 1

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        dispatch({ type: 'SET_INDEX', index: Math.min(state.mentionIndex + 1, maxIndex) })
        return true
      case 'ArrowUp':
        e.preventDefault()
        dispatch({ type: 'SET_INDEX', index: Math.max(state.mentionIndex - 1, 0) })
        return true
      case 'Enter':
      case 'Tab': {
        e.preventDefault()
        const selected = filteredFiles[state.mentionIndex]
        if (selected) selectMention(selected)
        return true
      }
      case 'Escape':
        e.preventDefault()
        dispatch({ type: 'CLOSE' })
        return true
      default:
        return false
    }
  }, [state.showMention, state.mentionIndex, filteredFiles, selectMention])

  const removeFile = useCallback((index: number) => {
    dispatch({ type: 'REMOVE_FILE', index })
  }, [])

  const clearFiles = useCallback(() => {
    dispatch({ type: 'CLEAR_FILES' })
  }, [])

  const buildPromptWithFiles = useCallback((text: string): string => {
    if (state.attachedFiles.length === 0) return text
    const fileBlocks = state.attachedFiles.map(f => {
      if (f.path === TERMINAL_ENTRY) {
        return `<terminal>\n${f.content}\n</terminal>`
      }
      return `<file path="${f.path}">\n${f.content}\n</file>`
    }).join('\n\n')
    return `${fileBlocks}\n\n${text}`
  }, [state.attachedFiles])

  return {
    showMention: state.showMention,
    mentionFilter: state.mentionFilter,
    mentionIndex: state.mentionIndex,
    attachedFiles: state.attachedFiles,
    filteredFiles,
    isLoadingFiles: state.showMention && !state.fetchedOnce,
    handleInputChangeForMention,
    handleMentionKeyDown,
    selectMention,
    removeFile,
    clearFiles,
    buildPromptWithFiles,
  }
}
