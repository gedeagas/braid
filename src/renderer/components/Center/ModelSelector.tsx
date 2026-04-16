/**
 * ModelSelector - Reusable model picker chip + dropdown menu.
 * Self-contained: manages its own open/close state and keyboard navigation.
 *
 * When the experimentalAcp flag is on, an "ACP Agents" section is appended
 * below the Claude models, allowing users to select non-Claude agent backends.
 */
import { useState, useRef, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import * as ipc from '@/lib/ipc'
import { useUIStore } from '@/store/ui'
import { Tooltip } from '@/components/shared/Tooltip'
import { IconSparkle, IconCheckmark, IconChevronDown } from '@/components/shared/icons'
import type { AgentBackend, ModelId } from '@/types'

export const MODELS: { id: ModelId; label: string }[] = [
  { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
  { id: 'claude-opus-4-6', label: 'Opus 4.6' },
  { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5' },
]

interface AcpAgentItem {
  id: string
  name: string
}

interface ModelSelectorProps {
  currentModelId: ModelId
  /** Current backend for this session. Undefined = claude-sdk. */
  backend?: AgentBackend
  onSelect: (modelId: ModelId) => void
  /** Called when an ACP agent is selected. */
  onSelectBackend?: (backend: AgentBackend | undefined) => void
  /** Menu opens above the button (for bottom-anchored inputs) */
  above?: boolean
}

export function ModelSelector({ currentModelId, backend, onSelect, onSelectBackend, above }: ModelSelectorProps) {
  const { t } = useTranslation('center')
  const [isOpen, setIsOpen] = useState(false)
  const [acpAgents, setAcpAgents] = useState<AcpAgentItem[]>([])
  const menuRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)

  const experimentalAcp = useUIStore((s) => s.experimentalAcp)

  const isAcp = backend?.type === 'acp'
  const currentModel = MODELS.find((m) => m.id === currentModelId) ?? MODELS[0]
  const displayLabel = isAcp ? backend.agentName : currentModel.label

  const toggle = useCallback(() => setIsOpen((v) => !v), [])
  const close = useCallback(() => setIsOpen(false), [])

  // Fetch ACP agents when the flag is on and menu opens
  useEffect(() => {
    if (!experimentalAcp || !isOpen) return
    ipc.agent.getAcpAgents().then((agents) => {
      setAcpAgents(agents.map((a) => ({ id: a.id, name: a.name })))
    }).catch(() => {})
  }, [experimentalAcp, isOpen])

  const handleSelectModel = useCallback((modelId: ModelId) => {
    onSelect(modelId)
    // Switch back to claude-sdk backend
    onSelectBackend?.(undefined)
    setIsOpen(false)
    btnRef.current?.focus()
  }, [onSelect, onSelectBackend])

  const handleSelectAgent = useCallback((agent: AcpAgentItem) => {
    onSelectBackend?.({ type: 'acp', agentId: agent.id, agentName: agent.name })
    setIsOpen(false)
    btnRef.current?.focus()
  }, [onSelectBackend])

  // Focus first menu item when menu opens
  useEffect(() => {
    if (!isOpen) return
    const firstItem = menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')
    firstItem?.focus()
  }, [isOpen])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    const items = menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')
    if (!items?.length) return
    const focused = document.activeElement as HTMLElement
    const idx = Array.from(items).indexOf(focused as HTMLButtonElement)
    if (e.key === 'ArrowDown') { e.preventDefault(); items[Math.min(idx + 1, items.length - 1)].focus() }
    else if (e.key === 'ArrowUp') { e.preventDefault(); items[Math.max(idx - 1, 0)].focus() }
    else if (e.key === 'Escape') {
      e.preventDefault()
      setIsOpen(false)
      btnRef.current?.focus()
    }
  }, [])

  return (
    <div style={{ position: 'relative' }}>
      <Tooltip content={t('switchModel')}>
        <button
          ref={btnRef}
          className={`chat-bottom-chip${isOpen ? ' chip-active' : ''}`}
          onClick={toggle}
          aria-haspopup="menu"
          aria-expanded={isOpen}
          aria-controls={isOpen ? 'model-menu' : undefined}
        >
          <span className="chip-icon"><IconSparkle /></span>
          <span>{displayLabel}</span>
          <IconChevronDown size={10} style={{ opacity: 0.5 }} />
        </button>
      </Tooltip>
      {isOpen && (
        <>
          <div className="model-menu-backdrop" onClick={close} />
          <div
            id="model-menu"
            className={`model-menu${above ? ' model-menu--above' : ''}`}
            role="menu"
            aria-label={t('switchModel')}
            ref={menuRef}
            onKeyDown={handleKeyDown}
          >
            {MODELS.map((m) => (
              <button
                key={m.id}
                role="menuitem"
                className={`model-menu-item${!isAcp && m.id === currentModelId ? ' model-menu-item--active' : ''}`}
                onClick={() => handleSelectModel(m.id)}
              >
                <span className="chip-icon"><IconSparkle /></span>
                <span>{m.label}</span>
                {!isAcp && m.id === currentModelId && (
                  <IconCheckmark style={{ marginLeft: 'auto' }} />
                )}
              </button>
            ))}
            {experimentalAcp && acpAgents.length > 0 && (
              <>
                <div role="separator" className="model-menu-separator">
                  <span className="model-menu-separator-text">ACP Agents</span>
                </div>
                {acpAgents.map((agent) => (
                  <button
                    key={agent.id}
                    role="menuitem"
                    className={`model-menu-item${isAcp && backend.agentId === agent.id ? ' model-menu-item--active' : ''}`}
                    onClick={() => handleSelectAgent(agent)}
                  >
                    <span className="chip-icon" style={{ opacity: 0.7 }}>⚡</span>
                    <span>{agent.name}</span>
                    {isAcp && backend.agentId === agent.id && (
                      <IconCheckmark style={{ marginLeft: 'auto' }} />
                    )}
                  </button>
                ))}
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}
