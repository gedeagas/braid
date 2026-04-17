/**
 * ModelSelector - Reusable model picker chip + dropdown menu.
 * Self-contained: manages its own open/close state and keyboard navigation.
 * Includes an inline 1M context toggle and effort level selector for compatible models.
 */
import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Tooltip } from '@/components/shared/Tooltip'
import { Toggle } from '@/components/shared/Toggle'
import { IconSparkle, IconCheckmark, IconChevronDown, IconStar, IconStarFilled } from '@/components/shared/icons'
import { supportsExtendedContext, getEffortLevelsForModel, EFFORT_LEVELS, DEFAULT_EFFORT } from '@/lib/constants'
import type { ModelId, EffortLevel } from '@/types'

export const MODELS: { id: ModelId; label: string }[] = [
  { id: 'claude-opus-4-7', label: 'Opus 4.7' },
  { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
  { id: 'claude-opus-4-6', label: 'Opus 4.6' },
  { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5' },
]

interface ModelSelectorProps {
  currentModelId: ModelId
  /** Whether extended (1M) context is active */
  extendedContext?: boolean
  /** Current effort level */
  effortLevel?: EffortLevel
  /** The global default model (shown with filled star) */
  defaultModelId?: ModelId
  onSelect: (modelId: ModelId) => void
  onToggleExtendedContext?: (enabled: boolean) => void
  onChangeEffortLevel?: (level: EffortLevel) => void
  /** Toggle a model as the global default */
  onSetDefault?: (modelId: ModelId) => void
  /** Menu opens above the button (for bottom-anchored inputs) */
  above?: boolean
}

export function ModelSelector({ currentModelId, extendedContext, effortLevel, defaultModelId, onSelect, onToggleExtendedContext, onChangeEffortLevel, onSetDefault, above }: ModelSelectorProps) {
  const { t } = useTranslation('center')
  const [isOpen, setIsOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)

  const currentModel = MODELS.find((m) => m.id === currentModelId) ?? MODELS[0]
  const show1M = extendedContext && supportsExtendedContext(currentModelId)
  const showToggle = supportsExtendedContext(currentModelId) && onToggleExtendedContext
  const supportedEffort = useMemo(() => getEffortLevelsForModel(currentModelId), [currentModelId])
  const showEffort = supportedEffort.length > 0 && onChangeEffortLevel
  const effortBadge = effortLevel && effortLevel !== DEFAULT_EFFORT ? effortLevel : null

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
          {effortBadge && <span className="model-effort-badge">{t(`effort_${effortBadge}`, effortBadge)}</span>}
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
            {MODELS.map((m) => {
              const isActive = m.id === currentModelId
              const isDefault = m.id === defaultModelId
              return (
                <div key={m.id} className="model-menu-row">
                  <button
                    role="menuitem"
                    className={`model-menu-item${isActive ? ' model-menu-item--active' : ''}`}
                    onClick={() => handleSelect(m.id)}
                  >
                    <span className="model-menu-item-label">{m.label}</span>
                    <span className="model-menu-check">
                      {isActive && <IconCheckmark size={14} />}
                    </span>
                  </button>
                  {onSetDefault && (
                    <Tooltip content={isDefault ? t('defaultModelUnpin') : t('defaultModelPin')}>
                      <button
                        className={`model-menu-star${isDefault ? ' model-menu-star--active' : ''}`}
                        onClick={(e) => { e.stopPropagation(); onSetDefault(m.id) }}
                        aria-label={isDefault ? t('defaultModelUnpin') : t('defaultModelPin')}
                      >
                        {isDefault ? <IconStarFilled size={12} /> : <IconStar size={12} />}
                      </button>
                    </Tooltip>
                  )}
                </div>
              )
            })}
            {showToggle && (
              <>
                <div className="model-menu-divider" />
                <div className="model-menu-toggle-row">
                  <span className="model-menu-toggle-label">{t('extendedContext')}</span>
                  <Toggle checked={!!extendedContext} onChange={onToggleExtendedContext} />
                </div>
              </>
            )}
            {showEffort && (
              <>
                <div className="model-menu-divider" />
                <div className="model-effort-row">
                  <span className="model-effort-label">{t('effort')}</span>
                  <div className="model-effort-pills">
                    {EFFORT_LEVELS.filter((l) => supportedEffort.includes(l.id)).map((l) => (
                      <button
                        key={l.id}
                        className={`model-effort-pill${l.id === (effortLevel ?? DEFAULT_EFFORT) ? ' model-effort-pill--active' : ''}`}
                        onClick={() => onChangeEffortLevel!(l.id)}
                      >
                        {t(`effort_${l.id}`, l.label)}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}
