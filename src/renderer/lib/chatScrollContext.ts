import { createContext, useContext } from 'react'

/**
 * Provides `disengageScroll` to descendants deep inside Virtuoso's item tree
 * (e.g. ToolCallGroup) without prop-drilling through ChatMessage.
 *
 * When the user manually expands a tool group, calling `disengageScroll` stops
 * the rAF auto-scroll loop from immediately yanking the expanded header out of
 * view — the same behaviour as the user scrolling up manually.
 */
export const ChatScrollContext = createContext<() => void>(() => {})
export const useChatScrollDisengage = () => useContext(ChatScrollContext)
