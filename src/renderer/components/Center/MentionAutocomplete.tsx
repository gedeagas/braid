import { useRef, useEffect, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { TERMINAL_ENTRY } from './useMentionAutocomplete'

interface Props {
  filter: string
  files: string[]          // pre-filtered + sliced list from the hook
  isLoading: boolean       // true while tracked files are being fetched
  selectedIndex: number
  onSelect: (filePath: string) => void
}

function highlightMatch(text: string, filter: string): ReactNode {
  if (!filter) return <>{text}</>
  const idx = text.toLowerCase().indexOf(filter.toLowerCase())
  if (idx === -1) return <>{text}</>
  return (
    <>
      {text.slice(0, idx)}
      <span className="mention-item-match">{text.slice(idx, idx + filter.length)}</span>
      {text.slice(idx + filter.length)}
    </>
  )
}

function basename(filePath: string): string {
  const idx = filePath.lastIndexOf('/')
  return idx === -1 ? filePath : filePath.slice(idx + 1)
}

function dirname(filePath: string): string {
  const idx = filePath.lastIndexOf('/')
  return idx === -1 ? '' : filePath.slice(0, idx)
}

export function MentionAutocomplete({ filter, files, isLoading, selectedIndex, onSelect }: Props) {
  const { t } = useTranslation('center')
  const listRef = useRef<HTMLDivElement>(null)
  const itemRefs = useRef<(HTMLDivElement | null)[]>([])

  // Auto-scroll selected item into view
  useEffect(() => {
    itemRefs.current[selectedIndex]?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])

  // Reset refs when list changes
  useEffect(() => {
    itemRefs.current = itemRefs.current.slice(0, files.length)
  }, [files.length])

  // Skeleton loading when files haven't loaded yet
  if (isLoading) {
    const skeletonWidths = [
      { name: '120px', dir: '180px' },
      { name: '80px', dir: '140px' },
      { name: '100px', dir: '200px' },
      { name: '90px', dir: '160px' },
      { name: '110px', dir: '150px' },
    ]
    return (
      <div className="mention-autocomplete">
        <div className="mention-list">
          {skeletonWidths.map((w, i) => (
            <div key={i} className="mention-item mention-item-skeleton">
              <span className="mention-skeleton-chip" style={{ width: w.name }} />
              <span className="mention-skeleton-chip mention-skeleton-dir" style={{ width: w.dir }} />
            </div>
          ))}
        </div>
      </div>
    )
  }

  // Files loaded but nothing matches current filter
  if (files.length === 0) return null

  return (
    <div className="mention-autocomplete">
      <div className="mention-list" ref={listRef}>
        {files.map((filePath, i) => {
          const isSelected = i === selectedIndex
          const isTerminal = filePath === TERMINAL_ENTRY

          if (isTerminal) {
            return (
              <div
                key={filePath}
                ref={(el) => { itemRefs.current[i] = el }}
                className={`mention-item mention-item-terminal${isSelected ? ' selected' : ''}`}
                onMouseDown={(e) => { e.preventDefault(); onSelect(filePath) }}
              >
                <span className="mention-item-terminal-icon">{'>'}_</span>
                <span className="mention-item-name">
                  {highlightMatch(t('mentionTerminal'), filter)}
                </span>
              </div>
            )
          }

          const name = basename(filePath)
          const dir = dirname(filePath)
          return (
            <div
              key={filePath}
              ref={(el) => { itemRefs.current[i] = el }}
              className={`mention-item${isSelected ? ' selected' : ''}`}
              onMouseDown={(e) => { e.preventDefault(); onSelect(filePath) }}
            >
              <span className="mention-item-name">
                {highlightMatch(name, filter)}
              </span>
              {dir && (
                <span className="mention-item-dir">{highlightMatch(dir, filter)}</span>
              )}
            </div>
          )
        })}
      </div>
      <div className="mention-footer">
        <span>↑↓ navigate</span>
        <span className="mention-footer-dot">·</span>
        <span>↵ select</span>
        <span className="mention-footer-dot">·</span>
        <span>esc dismiss</span>
      </div>
    </div>
  )
}
