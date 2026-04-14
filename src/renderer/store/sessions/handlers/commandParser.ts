// ---------------------------------------------------------------------------
// Pure slash command parsing — no side effects, no store dependency
// ---------------------------------------------------------------------------

import type { SlashCommand } from '@/types'

interface RawCommand {
  name: string
  source?: 'builtin' | 'skill'
}

interface RichCommand {
  name: string
  description?: string
  argumentHint?: string
  source?: 'builtin' | 'skill'
}

/**
 * Parse raw (name-only) commands from the `init` event.
 * Fills in empty description and undefined argumentHint.
 */
export function parseRawCommands(cmds: RawCommand[]): SlashCommand[] {
  return cmds.map((cmd) => ({
    name: cmd.name,
    description: '',
    argumentHint: undefined,
    source: cmd.source ?? ('builtin' as const)
  }))
}

/**
 * Parse rich (fully-described) commands from the `slashCommands` event.
 */
export function parseRichCommands(cmds: RichCommand[]): SlashCommand[] {
  return cmds.map((cmd) => ({
    name: cmd.name,
    description: cmd.description ?? '',
    argumentHint: cmd.argumentHint,
    source: cmd.source ?? ('builtin' as const)
  }))
}

/**
 * Parse legacy system init format where builtins and skills arrive as separate
 * string arrays (no metadata).
 */
export function parseLegacyCommands(
  builtins: string[],
  skills: string[]
): SlashCommand[] {
  const builtinCmds: SlashCommand[] = builtins.map((name) => ({
    name,
    description: '',
    argumentHint: undefined,
    source: 'builtin' as const
  }))
  const skillCmds: SlashCommand[] = skills.map((name) => ({
    name,
    description: '',
    argumentHint: undefined,
    source: 'skill' as const
  }))
  return [...builtinCmds, ...skillCmds]
}
