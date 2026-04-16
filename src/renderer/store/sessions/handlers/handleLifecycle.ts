// ---------------------------------------------------------------------------
// Lifecycle handlers — init, slashCommands, systemInit
// ---------------------------------------------------------------------------

import type { HandlerContext } from './types'
import type { AcpModelInfo } from '@/types'
import { parseRawCommands, parseRichCommands, parseLegacyCommands } from './commandParser'
import { updateSession } from '../stateUtils'
import { persistSession } from '../persistence'

/**
 * Handle `init` event: first contact from the SDK/ACP agent.
 * Sets sdkSessionId, seeds slash commands, and (for ACP) populates
 * the backend's available models from the agent's session/new response.
 */
export function handleInit(ctx: HandlerContext, ev: Record<string, unknown>): void {
  type RawCmd = { name: string; source?: 'builtin' | 'skill' }
  const commands = parseRawCommands(ev.slashCommands as RawCmd[] ?? [])

  // ACP model discovery: merge into existing backend if present
  const acpModels = ev.acpModels as AcpModelInfo[] | undefined
  const acpCurrentModelId = ev.acpCurrentModelId as string | undefined

  if (!updateSession(ctx.store, ctx.sessionId, (current) => {
    const updates: Record<string, unknown> = {
      sdkSessionId: ev.sdkSessionId as string,
      slashCommands: commands,
    }

    // Enrich ACP backend with model data from the agent
    if (acpModels && current.backend?.type === 'acp') {
      updates.backend = {
        ...current.backend,
        availableModels: acpModels,
        currentModelId: acpCurrentModelId,
      }
    }

    return updates
  })) return
  persistSession(ctx.sessionId)
}

/**
 * Handle `slashCommands` event: enriched command metadata from the SDK.
 * Replaces the initial stub commands with full descriptions and hints.
 */
export function handleSlashCommands(ctx: HandlerContext, ev: Record<string, unknown>): void {
  type RichCmd = { name: string; description?: string; argumentHint?: string; source?: 'builtin' | 'skill' }
  const commands = parseRichCommands(ev.commands as RichCmd[] ?? [])
  updateSession(ctx.store, ctx.sessionId, () => ({ slashCommands: commands }))
}

/**
 * Handle `system` + `subtype: init` — legacy SDK initialization fallback.
 * Merges separate builtin and skill command lists with correct source tags.
 */
export function handleSystemInit(ctx: HandlerContext, ev: Record<string, unknown>): void {
  const commands = parseLegacyCommands(
    ev.slash_commands as string[] ?? [],
    ev.skills as string[] ?? []
  )
  updateSession(ctx.store, ctx.sessionId, () => ({
    sdkSessionId: ev.session_id as string,
    slashCommands: commands
  }))
}
