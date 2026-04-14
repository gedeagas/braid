import { useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { IconCodeBrackets, IconChevronRight, IconChevronDown, IconClose } from '@/components/shared/icons'
import type { SnippetAttachment } from '@/types'

const MAX_PREVIEW_LINES = 6

function formatCharCount(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)
}

interface SnippetChipsProps {
  snippets: SnippetAttachment[]
  onRemove: (id: string) => void
}

export function SnippetChips({ snippets, onRemove }: SnippetChipsProps) {
  const { t } = useTranslation('center')
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())

  const toggleExpand = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  return (
    <div className="snippet-chips">
      {snippets.map((snippet) => {
        const expanded = expandedIds.has(snippet.id)
        return (
          <div key={snippet.id} className="snippet-chip">
            <div className="snippet-chip-header">
              <button
                className="snippet-chip-toggle"
                onClick={() => toggleExpand(snippet.id)}
                title={expanded ? t('snippetCollapse') : t('snippetExpand')}
              >
                {expanded
                  ? <IconChevronDown size={12} />
                  : <IconChevronRight size={12} />
                }
              </button>
              <IconCodeBrackets size={13} style={{ flexShrink: 0, opacity: 0.6 }} />
              <span className="snippet-chip-preview">{snippet.firstLine || t('snippetLabel')}</span>
              <span className="snippet-chip-badge">
                {snippet.lineCount} {t('snippetLines')} / {formatCharCount(snippet.charCount)}
              </span>
              <button
                className="snippet-chip-remove"
                onClick={() => onRemove(snippet.id)}
                title={t('removeSnippet')}
              >
                <IconClose />
              </button>
            </div>
            {expanded && (
              <pre className="snippet-chip-expanded">
                {snippet.content.split('\n').slice(0, MAX_PREVIEW_LINES).join('\n')}
                {snippet.lineCount > MAX_PREVIEW_LINES && '\n...'}
              </pre>
            )}
          </div>
        )
      })}
    </div>
  )
}
