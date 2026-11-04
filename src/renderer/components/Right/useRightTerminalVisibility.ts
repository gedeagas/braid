import { useEffect, useRef } from 'react'
import { setShown } from '@/lib/ptyOutput/visibility'
import type { TermTab } from './terminalCache'

/**
 * Report which right-panel tab is on screen. `shownTabId` is the active tab
 * when the panel is open and expanded (null otherwise). This component only
 * shows the active worktree's tabs, so switching worktree or unmounting the
 * panel hides them all. Changes are diffed, so unrelated re-renders never
 * flip a tab hidden and back.
 */
export function useRightTerminalVisibility(tabs: readonly TermTab[], shownTabId: string | null): void {
  const shownRef = useRef<TermTab | null>(null)

  useEffect(() => {
    const next = shownTabId ? tabs.find((t) => t.id === shownTabId) ?? null : null
    const prev = shownRef.current
    if (prev && prev !== next) setShown(prev, false)
    for (const tab of tabs) if (tab !== next && tab.shown) setShown(tab, false)
    if (next) setShown(next, true)
    shownRef.current = next
  }, [tabs, shownTabId])

  useEffect(() => () => {
    if (shownRef.current) setShown(shownRef.current, false)
    shownRef.current = null
  }, [])
}
