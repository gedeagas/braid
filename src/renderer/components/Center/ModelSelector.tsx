/**
 * ModelSelector - Reusable model picker chip + dropdown menu.
 * Self-contained: manages its own open/close state and keyboard navigation.
 *
 * When the experimentalAcp flag is on, Gemini models appear below a
 * separator alongside Claude models. Selecting a Gemini model switches
 * the session to the ACP backend with that model in one click.
 */
import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useUIStore } from '@/store/ui'
import { Tooltip } from '@/components/shared/Tooltip'
import { IconSparkle, IconCheckmark, IconChevronDown, IconBolt } from '@/components/shared/icons'
import type { AgentBackend, ModelId } from '@/types'

export const MODELS: { id: ModelId; label: string }[] = [
  { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
  { id: 'claude-opus-4-6', label: 'Opus 4.6' },
  { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5' },
]

export const GEMINI_MODELS: { id: string; label: string }[] = [
  { id: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro' },
  { id: 'gemini-3-flash-preview', label: 'Gemini 3 Flash' },
  { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
  { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
]

interface ModelSelectorProps {
  currentModelId: ModelId
  /** Current backend for this session. Undefined = claude-sdk. */
  backend?: AgentBackend
  onSelect: (modelId: ModelId) => void
  /** Called when the backend changes (ACP selected or cleared). */
  onSelectBackend?: (backend: AgentBackend | undefined) => void
  /** Called when the user picks a different model within the active ACP agent. */
  onSelectAcpModel?: (modelId: string) => void
  /** Menu opens above the button (for bottom-anchored inputs) */
  above?: boolean
}

export function ModelSelector({ currentModelId, backend, onSelect, onSelectBackend, onSelectAcpModel, above }: ModelSelectorProps) {
  const { t } = useTranslation('center')
  const [isOpen, setIsOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)

  const experimentalAcp = useUIStore((s) => s.experimentalAcp)

  const isAcp = backend?.type === 'acp'
  const acpCurrentModelId = isAcp ? backend.currentModelId : undefined

  // Derive chip label
  const displayLabel = useMemo(() => {
    if (isAcp) {
      const match = GEMINI_MODELS.find((m) => m.id === acpCurrentModelId)
      return match?.label ?? acpCurrentModelId ?? 'Gemini'
    }
    return (MODELS.find((m) => m.id === currentModelId) ?? MODELS[0]).label
  }, [isAcp, acpCurrentModelId, currentModelId])

  const toggle = useCallback(() => setIsOpen((v) => !v), [])
  const close = useCallback(() => setIsOpen(false), [])

  const handleSelectModel = useCallback((modelId: ModelId) => {
    onSelect(modelId)
    onSelectBackend?.(undefined)
    setIsOpen(false)
    btnRef.current?.focus()
  }, [onSelect, onSelectBackend])

  const handleSelectGeminiModel = useCallback((modelId: string) => {
    onSelectBackend?.({ type: 'acp', currentModelId: modelId })
    onSelectAcpModel?.(modelId)
    setIsOpen(false)
    btnRef.current?.focus()
  }, [onSelectBackend, onSelectAcpModel])

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
          <span className="chip-icon">{isAcp ? <IconBolt size={12} /> : <IconSparkle />}</span>
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
            {experimentalAcp && (
              <>
                <div role="separator" className="model-menu-separator" />
                {GEMINI_MODELS.map((m) => (
                  <button
                    key={m.id}
                    role="menuitem"
                    className={`model-menu-item${isAcp && acpCurrentModelId === m.id ? ' model-menu-item--active' : ''}`}
                    onClick={() => handleSelectGeminiModel(m.id)}
                  >
                    <span className="chip-icon" style={{ opacity: 0.7 }}><IconBolt size={12} /></span>
                    <span>{m.label}</span>
                    {isAcp && acpCurrentModelId === m.id && (
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
