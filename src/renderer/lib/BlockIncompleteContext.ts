// ---------------------------------------------------------------------------
// Context indicating whether the current block has an incomplete code fence.
// Child components (e.g., code highlighters) can use this to defer expensive
// renders until the code block is fully streamed.
// Ported from Streamdown's `block-incomplete-context.ts`.
// ---------------------------------------------------------------------------

import { createContext, useContext } from 'react'

const BlockIncompleteContext = createContext(false)

/**
 * Returns `true` when the current block has an unclosed code fence.
 * Useful for deferring syntax highlighting until the fence closes.
 */
export const useIsCodeFenceIncomplete = (): boolean =>
  useContext(BlockIncompleteContext)

export { BlockIncompleteContext }
