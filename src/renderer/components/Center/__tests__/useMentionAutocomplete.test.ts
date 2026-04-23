import { describe, it, expect } from 'vitest'
import {
  reducer,
  initialState,
  MAX_ATTACHED_FILES,
  type MentionState,
} from '../useMentionAutocomplete'
import type { AttachedFile } from '@/types'

function makeFile(path: string): AttachedFile {
  return { path, content: `content of ${path}` }
}

function stateWith(overrides: Partial<MentionState>): MentionState {
  return { ...initialState, ...overrides }
}

// ═══════════════════════════════════════════════════════════════════════
// ADD_FILE — single file attachment
// ═══════════════════════════════════════════════════════════════════════

describe('reducer — ADD_FILE', () => {
  it('appends a new file', () => {
    const state = stateWith({ attachedFiles: [makeFile('a.ts')] })
    const next = reducer(state, { type: 'ADD_FILE', file: makeFile('b.ts') })
    expect(next.attachedFiles).toHaveLength(2)
    expect(next.attachedFiles[1].path).toBe('b.ts')
  })

  it('deduplicates by path', () => {
    const state = stateWith({ attachedFiles: [makeFile('a.ts')] })
    const next = reducer(state, { type: 'ADD_FILE', file: makeFile('a.ts') })
    expect(next.attachedFiles).toHaveLength(1)
  })

  it('rejects when at MAX_ATTACHED_FILES', () => {
    const files = Array.from({ length: MAX_ATTACHED_FILES }, (_, i) => makeFile(`${i}.ts`))
    const state = stateWith({ attachedFiles: files })
    const next = reducer(state, { type: 'ADD_FILE', file: makeFile('extra.ts') })
    expect(next.attachedFiles).toHaveLength(MAX_ATTACHED_FILES)
    expect(next.attachedFiles.find(f => f.path === 'extra.ts')).toBeUndefined()
  })

  it('closes mention autocomplete on add', () => {
    const state = stateWith({ showMention: true, mentionFilter: 'foo' })
    const next = reducer(state, { type: 'ADD_FILE', file: makeFile('a.ts') })
    expect(next.showMention).toBe(false)
    expect(next.mentionFilter).toBe('')
  })
})

// ═══════════════════════════════════════════════════════════════════════
// ADD_FILES — batch file attachment (folder drop)
// ═══════════════════════════════════════════════════════════════════════

describe('reducer — ADD_FILES', () => {
  it('appends multiple files in one dispatch', () => {
    const state = stateWith({ attachedFiles: [makeFile('existing.ts')] })
    const next = reducer(state, {
      type: 'ADD_FILES',
      files: [makeFile('a.ts'), makeFile('b.ts')],
    })
    expect(next.attachedFiles).toHaveLength(3)
    expect(next.attachedFiles.map(f => f.path)).toEqual(['existing.ts', 'a.ts', 'b.ts'])
  })

  it('deduplicates against existing files', () => {
    const state = stateWith({ attachedFiles: [makeFile('a.ts'), makeFile('b.ts')] })
    const next = reducer(state, {
      type: 'ADD_FILES',
      files: [makeFile('b.ts'), makeFile('c.ts')],
    })
    expect(next.attachedFiles).toHaveLength(3)
    expect(next.attachedFiles.map(f => f.path)).toEqual(['a.ts', 'b.ts', 'c.ts'])
  })

  it('does not add when all files are duplicates', () => {
    const state = stateWith({ attachedFiles: [makeFile('a.ts')] })
    const next = reducer(state, { type: 'ADD_FILES', files: [makeFile('a.ts')] })
    expect(next.attachedFiles).toHaveLength(1)
    expect(next.showMention).toBe(false)
  })

  it('caps total attached files at MAX_ATTACHED_FILES', () => {
    const existing = Array.from({ length: MAX_ATTACHED_FILES - 2 }, (_, i) => makeFile(`${i}.ts`))
    const state = stateWith({ attachedFiles: existing })
    const newFiles = [makeFile('new1.ts'), makeFile('new2.ts'), makeFile('new3.ts'), makeFile('new4.ts')]
    const next = reducer(state, { type: 'ADD_FILES', files: newFiles })
    expect(next.attachedFiles).toHaveLength(MAX_ATTACHED_FILES)
    // Only first 2 of the 4 new files should be added (remaining = 2)
    expect(next.attachedFiles.map(f => f.path)).toContain('new1.ts')
    expect(next.attachedFiles.map(f => f.path)).toContain('new2.ts')
    expect(next.attachedFiles.map(f => f.path)).not.toContain('new3.ts')
  })

  it('does not add when already at cap', () => {
    const files = Array.from({ length: MAX_ATTACHED_FILES }, (_, i) => makeFile(`${i}.ts`))
    const state = stateWith({ attachedFiles: files })
    const next = reducer(state, { type: 'ADD_FILES', files: [makeFile('extra.ts')] })
    expect(next.attachedFiles).toHaveLength(MAX_ATTACHED_FILES)
    expect(next.attachedFiles.find(f => f.path === 'extra.ts')).toBeUndefined()
  })

  it('handles empty files array and closes autocomplete', () => {
    const state = stateWith({ showMention: true, mentionFilter: 'foo', attachedFiles: [makeFile('a.ts')] })
    const next = reducer(state, { type: 'ADD_FILES', files: [] })
    expect(next.showMention).toBe(false)
    expect(next.mentionFilter).toBe('')
  })

  it('closes mention autocomplete on add', () => {
    const state = stateWith({ showMention: true, mentionFilter: 'foo' })
    const next = reducer(state, { type: 'ADD_FILES', files: [makeFile('a.ts')] })
    expect(next.showMention).toBe(false)
    expect(next.mentionFilter).toBe('')
  })
})
