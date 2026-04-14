// ---------------------------------------------------------------------------
// Pure tool result extraction — no side effects, no store dependency
// ---------------------------------------------------------------------------

import type { ToolResultPatch } from './types'

/**
 * Extract tool result patches from the content array of a `user` event message.
 * Returns one patch per tool_result block, with result text or error.
 *
 * Pure function: inspects raw event payload only, never reads state.
 */
export function extractToolResultPatches(
  content: Array<Record<string, unknown>>
): ToolResultPatch[] {
  const patches: ToolResultPatch[] = []

  for (const block of content) {
    if (block.type !== 'tool_result') continue

    const toolUseId = block.tool_use_id as string | undefined
    if (!toolUseId) continue

    const isError = block.is_error === true
    const rc = block.content
    let resultText = ''

    if (typeof rc === 'string') {
      resultText = rc
    } else if (Array.isArray(rc)) {
      resultText = rc
        .filter((c): c is Record<string, unknown> =>
          typeof c === 'object' && c !== null && (c as Record<string, unknown>).type === 'text'
        )
        .map((c) => {
          const text = c.text
          return typeof text === 'string' ? text : ''
        })
        .join('')
    }

    patches.push(
      isError
        ? { toolUseId, error: resultText || 'Tool execution failed' }
        : { toolUseId, result: resultText }
    )
  }

  return patches
}
