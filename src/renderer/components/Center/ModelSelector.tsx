/**
 * ModelSelector - Reusable model picker chip + dropdown menu.
 * Self-contained: manages its own open/close state and keyboard navigation.
 */
import { useState, useRef, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Tooltip } from '@/components/shared/Tooltip'
import { IconSparkle, IconCheckmark, IconChevronDown } from '@/components/shared/icons'
import { supportsExtendedContext } from '@/lib/constants'
import type { ModelId } from '@/types'

export const MODELS: { id: ModelId; label: string }[] = [
  { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
  { id: 'claude-opus-4-6', label: 'Opus 4.6' },
  { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5' },
]

interface ModelSelectorProps {
  currentModelId: ModelId
  /** Whether extended (1M) context is active */
  extendedContext?: boolean
  onSelect: (modelId: ModelId) => void
  /** Menu opens above the button (for bottom-anchored inputs) */
  above?: boolean
}

export function ModelSelector({ currentModelId, extendedContext, onSelect, above }: ModelSelectorProps) {
  const { t } = useTranslation('center')
  const [isOpen, setIsOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)

  const currentModel = MODELS.find((m) => m.id === currentModelId) ?? MODELS[0]
  const show1M = extendedContext && supportsExtendedContext(currentModelId)

  const toggle = useCallback(() => setIsOpen((v) => !v), [])
  const close = useCallback(() => setIsOpen(false), [])

  const handleSelect = useCallback((modelId: ModelId) => {
    onSelect(modelId)
    setIsOpen(false)
    btnRef.current?.focus()
  }, [onSelect])

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
          <span>{currentModel.label}</span>
          {show1M && <span className="model-1m-badge">1M</span>}
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
                className={`model-menu-item${m.id === currentModelId ? ' model-menu-item--active' : ''}`}
                onClick={() => handleSelect(m.id)}
              >
                <span className="chip-icon"><IconSparkle /></span>
                <span>{m.label}</span>
                {m.id === currentModelId && (
                  <IconCheckmark style={{ marginLeft: 'auto' }} />
                )}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
