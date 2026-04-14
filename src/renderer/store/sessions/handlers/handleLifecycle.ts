// ---------------------------------------------------------------------------
// Lifecycle handlers — init, slashCommands, systemInit
// ---------------------------------------------------------------------------

import type { HandlerContext } from './types'
import { parseRawCommands, parseRichCommands, parseLegacyCommands } from './commandParser'
import { updateSession } from '../stateUtils'
import { persistSession } from '../persistence'

/**
 * Handle `init` event: first contact from the SDK.
 * Sets sdkSessionId and seeds slash commands with name-only metadata.
 */
export function handleInit(ctx: HandlerContext, ev: Record<string, unknown>): void {
  type RawCmd = { name: string; source?: 'builtin' | 'skill' }
  const commands = parseRawCommands(ev.slashCommands as RawCmd[] ?? [])
  if (!updateSession(ctx.store, ctx.sessionId, () => ({
    sdkSessionId: ev.sdkSessionId as string,
    slashCommands: commands
  }))) return
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
