import { memo, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { ContentBlock } from '@/types'
import { useUIStore } from '@/store/ui'
import { IconFile } from '@/components/shared/icons'
import { DiffPreviewPopover, useDiffPreviewHover, type DiffChunk } from './DiffPreviewPopover'

interface TurnFileEdit {
  filePath: string
  filePathFull: string
  additions: number
  deletions: number
  chunks: DiffChunk[]
}

/** Take the first N lines from a string without splitting the entire content. */
function takeLines(text: string, n: number): string {
  let end = 0
  for (let i = 0; i < n; i++) {
    const nl = text.indexOf('\n', end)
    if (nl === -1) return text // fewer than n lines total
    end = nl + 1
  }
  return text.slice(0, end > 0 ? end - 1 : 0)
}

function aggregateFileEdits(blocks: ContentBlock[]): TurnFileEdit[] {
  const map = new Map<string, TurnFileEdit>()
  for (const b of blocks) {
    if (b.type !== 'tool_use') continue
    const tc = b.toolCall
    if (!tc.diffStats || !tc.filePathFull) continue

    let existing = map.get(tc.filePathFull)
    if (!existing) {
      existing = {
        filePath: tc.filePath ?? tc.filePathFull.split('/').slice(-2).join('/'),
        filePathFull: tc.filePathFull,
        additions: 0,
        deletions: 0,
        chunks: [],
      }
      map.set(tc.filePathFull, existing)
    }
    existing.additions += tc.diffStats.additions
    existing.deletions += tc.diffStats.deletions

    // Extract diff content from Edit/Write tool inputs
    if (typeof tc.input !== 'string') continue
    try {
      const p = JSON.parse(tc.input)
      if (tc.name === 'Edit' && (p.old_string != null || p.new_string != null)) {
        existing.chunks.push({ oldString: p.old_string ?? '', newString: p.new_string ?? '' })
      } else if (tc.name === 'Write' && p.content) {
        // For Write, show first ~15 lines as "all additions"
        existing.chunks.push({ oldString: '', newString: takeLines(p.content, 15) })
      }
    } catch { /* skip unparseable inputs */ }
  }
  return Array.from(map.values())
}

interface Props {
  blocks: ContentBlock[]
}

export const TurnFooter = memo(function TurnFooter({ blocks }: Props) {
  const { t } = useTranslation('center')
  const edits = useMemo(() => aggregateFileEdits(blocks), [blocks])

  if (edits.length === 0) return null

  return (
    <div className="turn-footer">
      <span className="turn-footer-label">
        {t('turnFooterFiles', { count: edits.length })}
      </span>
      <div className="turn-footer-badges">
        {edits.map((edit) => (
          <TurnFooterBadge key={edit.filePathFull} edit={edit} />
        ))}
      </div>
    </div>
  )
})

// ── Badge with hover popover ────────────────────────────────────────────────────

const TurnFooterBadge = memo(function TurnFooterBadge({ edit }: { edit: TurnFileEdit }) {
  const { visible, anchorRect, badgeRef, onBadgeEnter, onBadgeLeave, onPopoverEnter, onPopoverLeave } =
    useDiffPreviewHover()

  const hasChunks = edit.chunks.length > 0

  const handleClick = useCallback(() => {
    useUIStore.getState().openFile(edit.filePathFull)
  }, [edit.filePathFull])

  return (
    <>
      <span
        ref={badgeRef}
        className="tcg-file-badge tcg-file-badge--clickable"
        title={hasChunks ? undefined : edit.filePathFull}
        onClick={handleClick}
        onMouseEnter={hasChunks ? onBadgeEnter : undefined}
        onMouseLeave={hasChunks ? onBadgeLeave : undefined}
      >
        <IconFile size={12} />
        <span className="turn-footer-file-name">{edit.filePath}</span>
        <span className="tcg-diff">
          <span className="tcg-diff-add">+{edit.additions}</span>
          <span className="tcg-diff-del">{'\u2212'}{edit.deletions}</span>
        </span>
      </span>
      {visible && anchorRect && hasChunks && (
        <DiffPreviewPopover
          filePath={edit.filePathFull}
          chunks={edit.chunks}
          anchorRect={anchorRect}
          onMouseEnter={onPopoverEnter}
          onMouseLeave={onPopoverLeave}
        />
      )}
    </>
  )
})
