// ---------------------------------------------------------------------------
// Side-maps and localStorage utilities for session ordering & tracking
// ---------------------------------------------------------------------------

import { SK } from '@/lib/storageKeys'

/** localStorage key for last-active session per worktree */
export const LAST_ACTIVE_KEY = SK.lastActivePerWorktree
/** localStorage key for explicit tab ordering per worktree */
export const SESSION_ORDER_KEY = SK.sessionOrderPerWorktree

/** Maps session ID → worktree filesystem path (not serialized) */
export const sessionWorktreePaths = new Map<string, string>()

/** Maps session ID → array of additional worktree paths for linked workspaces */
export const sessionLinkedPaths = new Map<string, string[]>()

// ---------------------------------------------------------------------------
// localStorage helpers
// ---------------------------------------------------------------------------

export function loadMapFromStorage(key: string): Map<string, string> {
  try {
    const raw = localStorage.getItem(key)
    if (raw) return new Map(Object.entries(JSON.parse(raw)))
  } catch {}
  return new Map()
}

export function loadMapArrayFromStorage(key: string): Map<string, string[]> {
  try {
    const raw = localStorage.getItem(key)
    if (raw) {
      const obj = JSON.parse(raw) as Record<string, string[]>
      return new Map(Object.entries(obj))
    }
  } catch {}
  return new Map()
}

export function saveMapToStorage(key: string, map: Map<string, string | string[]>): void {
  try {
    localStorage.setItem(key, JSON.stringify(Object.fromEntries(map)))
  } catch {}
}

// ---------------------------------------------------------------------------
// Eagerly-loaded side-maps (populated from localStorage at module init)
// ---------------------------------------------------------------------------

/** Last active session per worktree — used for tab restoration */
export const lastActivePerWorktree = loadMapFromStorage(LAST_ACTIVE_KEY)

/** Explicit session tab ordering per worktree — used for drag-reorder */
export const sessionOrderPerWorktree = loadMapArrayFromStorage(SESSION_ORDER_KEY)

/** In-flight title generation promises — keyed by sessionId */
export const pendingTitleGenerations = new Map<string, Promise<string>>()
