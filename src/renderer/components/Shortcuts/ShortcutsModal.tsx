import { useState, useEffect, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { useUIStore } from '@/store/ui'
import { SHORTCUTS, SHORTCUT_CATEGORIES } from '@/lib/shortcuts'
import type { ShortcutCategory } from '@/lib/shortcuts'
import { ShortcutBadge } from './ShortcutBadge'

export function ShortcutsModal() {
  const { t } = useTranslation('shortcuts')
  const shortcutsOpen = useUIStore((s) => s.shortcutsOpen)
  const closeShortcuts = useUIStore((s) => s.closeShortcuts)
  const [search, setSearch] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeShortcuts()
    },
    [closeShortcuts]
  )

  useEffect(() => {
    if (!shortcutsOpen) return
    document.addEventListener('keydown', handleKeyDown)
    // Focus search input on open
    requestAnimationFrame(() => inputRef.current?.focus())
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [shortcutsOpen, handleKeyDown])

  // Reset search when closed
  useEffect(() => {
    if (!shortcutsOpen) setSearch('')
  }, [shortcutsOpen])

  if (!shortcutsOpen) return null

  const filtered = search.trim()
    ? SHORTCUTS.filter((s) => {
        const label = t(s.id).toLowerCase()
        return label.includes(search.toLowerCase())
      })
    : SHORTCUTS

  const groupedByCategory = SHORTCUT_CATEGORIES.reduce<
    Record<ShortcutCategory, typeof SHORTCUTS>
  >(
    (acc, cat) => {
      const items = filtered.filter((s) => s.category === cat)
      if (items.length > 0) acc[cat] = items
      return acc
    },
    {} as Record<ShortcutCategory, typeof SHORTCUTS>
  )

  return createPortal(
    <div className="shortcuts-overlay" onClick={closeShortcuts}>
      <div className="shortcuts-modal" onClick={(e) => e.stopPropagation()}>
        <div className="shortcuts-header">
          <h2 className="shortcuts-title">{t('title')}</h2>
          <button className="shortcuts-close" onClick={closeShortcuts}>
            &times;
          </button>
        </div>

        <div className="shortcuts-search-wrap">
          <input
            ref={inputRef}
            type="text"
            className="shortcuts-search"
            placeholder={t('searchPlaceholder')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="shortcuts-body">
          {(Object.entries(groupedByCategory) as [ShortcutCategory, typeof SHORTCUTS][]).map(
            ([category, items]) => (
              <div key={category} className="shortcuts-category">
                <h3 className="shortcuts-category-title">
                  {t(`categories.${category}`)}
                </h3>
                {items.map((shortcut) => (
                  <div key={shortcut.id} className="shortcuts-row">
                    <span className="shortcuts-label">{t(shortcut.id)}</span>
                    <ShortcutBadge symbols={shortcut.symbols} />
                  </div>
                ))}
              </div>
            )
          )}

          {filtered.length === 0 && (
            <div className="shortcuts-empty">
              {search.trim() ? t('noResults', { query: search }) : t('empty')}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}
