/**
 * ACP Client interface implementation.
 *
 * Handles callbacks from the ACP agent: session updates, permission requests,
 * file operations, and terminal operations. Maps everything to Braid's
 * WorkerEvent system so the coordinator/renderer stay unchanged.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { dirname } from 'path'
import type { WorkerEvent } from '../agentTypes'
import { mapSessionUpdate, finalizeTurn, createTurnState, type TurnState } from './eventMapper'

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
}

export function createClientHandlers(
  sessionId: string,
  _worktreePath: string,
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
      const content = readFileSync(path, 'utf-8')
      return { content }
    },

    async writeTextFile({ path, content }: { path: string; content: string }): Promise<null> {
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, content, 'utf-8')
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
    }
  }
}
