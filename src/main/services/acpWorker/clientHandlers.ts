/**
 * ACP Client interface implementation.
 *
 * Handles callbacks from the ACP agent: session updates, permission requests,
 * file operations, and terminal operations. Maps everything to Braid's
 * WorkerEvent system so the coordinator/renderer stay unchanged.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { dirname, resolve, relative } from 'path'
import type { WorkerEvent } from '../agentTypes'
import { mapSessionUpdate, createTurnState, type TurnState } from './eventMapper'

/**
 * Resolve and validate that a file path stays within the worktree root.
 * Prevents path traversal attacks from ACP agents reading/writing arbitrary files.
 */
function assertWithinWorktree(worktreePath: string, filePath: string): string {
  const resolved = resolve(worktreePath, filePath)
  const rel = relative(worktreePath, resolved)
  if (rel.startsWith('..') || resolve(resolved) !== resolved) {
    throw new Error(`Path traversal denied: "${filePath}" escapes worktree root`)
  }
  return resolved
}

export interface ClientHandlers {
  /** Called for every ACP session/update notification. */
  sessionUpdate(update: Record<string, unknown>): void
  /** Called when the agent requests user permission. */
  requestPermission(options: Record<string, unknown>): Promise<{ optionId: string }>
  /** Read a text file from the filesystem. */
  readTextFile(params: { path: string }): Promise<{ content: string }>
  /** Write a text file to the filesystem. */
  writeTextFile(params: { path: string; content: string }): Promise<null>
  /** Resolve a pending permission request (called from answerToolInput). */
  resolvePermission(permId: string, result: Record<string, unknown>): void
  /** Get the current turn state (for finalization). */
  getTurnState(): TurnState
  /** Reset turn state for a new prompt. */
  resetTurn(): void
  /** Reject all pending permission promises (called on session close/stop). */
  cleanup(): void
}

export function createClientHandlers(
  sessionId: string,
  worktreePath: string,
  emit: (event: WorkerEvent) => void
): ClientHandlers {
  const pendingPermissions = new Map<string, { resolve: (value: { optionId: string }) => void }>()
  let turnState = createTurnState()

  return {
    sessionUpdate(update: Record<string, unknown>): void {
      const events = mapSessionUpdate(sessionId, update, turnState)
      for (const event of events) {
        emit(event)
      }
    },

    async requestPermission(options: Record<string, unknown>): Promise<{ optionId: string }> {
      const permId = `acp-perm-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
      const toolCall = options.toolCall as Record<string, unknown> | undefined

      emit({
        type: 'waiting_input',
        sessionId,
        reason: 'tool_permission',
        toolName: (toolCall?.name as string) ?? 'Unknown',
        toolInput: (toolCall?.input as Record<string, unknown>) ?? {},
        toolUseId: permId,
        description: (options.message as string) ?? undefined
      })

      return new Promise((resolve) => {
        pendingPermissions.set(permId, { resolve })
      })
    },

    async readTextFile({ path }: { path: string }): Promise<{ content: string }> {
      const safePath = assertWithinWorktree(worktreePath, path)
      const content = readFileSync(safePath, 'utf-8')
      return { content }
    },

    async writeTextFile({ path, content }: { path: string; content: string }): Promise<null> {
      const safePath = assertWithinWorktree(worktreePath, path)
      mkdirSync(dirname(safePath), { recursive: true })
      writeFileSync(safePath, content, 'utf-8')
      return null
    },

    resolvePermission(permId: string, result: Record<string, unknown>): void {
      const pending = pendingPermissions.get(permId)
      if (pending) {
        pendingPermissions.delete(permId)
        const behavior = (result.behavior as string) ?? 'allow'
        pending.resolve({ optionId: behavior === 'deny' ? 'reject_once' : 'allow_once' })
      }
    },

    getTurnState(): TurnState {
      return turnState
    },

    resetTurn(): void {
      turnState = createTurnState()
    },

    cleanup(): void {
      // Resolve all pending permission promises as "reject" so they don't hang forever
      for (const [, pending] of pendingPermissions) {
        pending.resolve({ optionId: 'reject_once' })
      }
      pendingPermissions.clear()
    }
  }
}
