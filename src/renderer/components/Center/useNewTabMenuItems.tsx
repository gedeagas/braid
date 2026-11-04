import { useMemo, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useSessionsStore } from '@/store/sessions'
import { useUIStore, type PaneId } from '@/store/ui'
import { placeTabInPane } from '@/lib/centerPanes'
import type { ContextMenuItem } from '@/components/shared/ContextMenu'
import { IconGlobe, IconMessageBubble, IconTerminal, AgentIcon } from '@/components/shared/icons'
import { useDetectedAgents } from '@/lib/agentDetection'
import type { AgentCatalogEntry } from '@/lib/agentCatalog'
import { openBrowserTab } from '@/lib/browser/browserCommands'

type MenuItem = { key: string; icon: ReactNode; label: string; onClick: () => void }

/**
 * Items for the tab bar's "+" menu: Chat, detected agents, Terminal, Browser.
 * The last-used action floats to the very top.
 */
export function useNewTabMenuItems(worktreeId: string | null, worktreePath: string | undefined, pane: PaneId = 'primary'): ContextMenuItem[] {
  const { t } = useTranslation('center')
  const createSession = useSessionsStore((s) => s.createSession)
  const createBigTerminal = useUIStore((s) => s.createBigTerminal)
  const lastNewTabAction = useUIStore((s) => s.lastNewTabAction)
  const setLastNewTabAction = useUIStore((s) => s.setLastNewTabAction)
  const detectedAgents = useDetectedAgents()

  return useMemo((): ContextMenuItem[] => {
    const chatItem: MenuItem = {
      key: 'chat',
      icon: <IconMessageBubble size={14} />,
      label: t('newChat'),
      onClick: () => {
        if (!worktreeId || !worktreePath) return
        setLastNewTabAction('chat')
        const id = createSession(worktreeId, worktreePath)
        placeTabInPane(worktreeId, `s:${id}`, 'primary')
      },
    }

    const agentItems = detectedAgents.map((entry: AgentCatalogEntry): MenuItem => ({
      key: `agent:${entry.id}`,
      icon: <AgentIcon agentId={entry.id} size={14} />,
      label: entry.label,
      onClick: () => {
        if (!worktreeId) return
        setLastNewTabAction(`agent:${entry.id}`)
        const id = createBigTerminal(worktreeId, entry.label, entry.launchCmd, entry.id)
        placeTabInPane(worktreeId, `t:${id}`, pane)
      },
    }))

    const terminalItem: MenuItem = {
      key: 'terminal',
      icon: <IconTerminal size={14} />,
      label: t('newBigTerminal'),
      onClick: () => {
        if (!worktreeId) return
        setLastNewTabAction('terminal')
        const id = createBigTerminal(worktreeId)
        placeTabInPane(worktreeId, `t:${id}`, pane)
      },
    }

    const browserItem: MenuItem = {
      key: 'browser',
      icon: <IconGlobe size={14} />,
      label: t('browser.newBrowserTab'),
      onClick: () => {
        if (!worktreeId) return
        setLastNewTabAction('browser')
        openBrowserTab(worktreeId, { pane })
      },
    }

    const sections: MenuItem[][] = [[chatItem], agentItems, [terminalItem, browserItem]]

    const lastKey = lastNewTabAction === 'claudeCode' ? 'agent:claude' : lastNewTabAction
    let floated: MenuItem | null = null
    for (const section of sections) {
      const idx = section.findIndex((item) => item.key === lastKey)
      if (idx >= 0) {
        [floated] = section.splice(idx, 1)
        break
      }
    }

    const result: ContextMenuItem[] = []
    if (floated) {
      result.push(floated)
      result.push({ label: '---', onClick: () => {} })
    }
    const nonEmpty = sections.filter((section) => section.length > 0)
    nonEmpty.forEach((section, i) => {
      result.push(...section)
      if (i < nonEmpty.length - 1) result.push({ label: '---', onClick: () => {} })
    })
    return result
  }, [lastNewTabAction, worktreeId, worktreePath, pane, detectedAgents, createSession, createBigTerminal, setLastNewTabAction, t])
}
