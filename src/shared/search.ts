/**
 * Shared types for the content-search IPC channel.
 *
 * Lives in src/shared/ so main, preload, and renderer can all import the same
 * types without drift. Keep this file dependency-free.
 */

export interface SearchOptions {
  caseSensitive: boolean
  wholeWord: boolean
  regex: boolean
  includeGlobs: string[]
  excludeGlobs: string[]
  maxResults: number
}

export interface SearchMatch {
  lineNumber: number
  lineText: string
  matchStart: number
  matchEnd: number
}

export interface SearchFileResult {
  path: string
  relativePath: string
  matches: SearchMatch[]
}

export type SearchErrorCode = 'INVALID_REGEX' | 'INVALID_GLOB' | 'RG_MISSING' | 'SPAWN_FAILED'

export interface SearchResult {
  files: SearchFileResult[]
  totalMatches: number
  truncated: boolean
  elapsedMs: number
  error?: { code: SearchErrorCode; message: string }
}

export interface ReplaceResult {
  filesChanged: number
  replaced: number
  failed: Array<{ path: string; message: string }>
}

export const DEFAULT_MAX_RESULTS = 1000
