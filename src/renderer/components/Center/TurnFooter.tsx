import { memo, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { ContentBlock } from '@/types'
import { useUIStore } from '@/store/ui'
import { IconFile } from '@/components/shared/icons'

interface TurnFileEdit {
  filePath: string
  filePathFull: string
  additions: number
  deletions: number
}

function aggregateFileEdits(blocks: ContentBlock[]): TurnFileEdit[] {
  const map = new Map<string, TurnFileEdit>()
  for (const b of blocks) {
    if (b.type !== 'tool_use') continue
    const tc = b.toolCall
    if (!tc.diffStats || !tc.filePathFull) continue
    const existing = map.get(tc.filePathFull)
    if (existing) {
      existing.additions += tc.diffStats.additions
      existing.deletions += tc.diffStats.deletions
    } else {
      map.set(tc.filePathFull, {
        filePath: tc.filePath ?? tc.filePathFull.split('/').slice(-2).join('/'),
        filePathFull: tc.filePathFull,
        additions: tc.diffStats.additions,
        deletions: tc.diffStats.deletions,
      })
    }
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
          <span
            key={edit.filePathFull}
            className="tcg-file-badge tcg-file-badge--clickable"
            title={edit.filePathFull}
            onClick={() => useUIStore.getState().openFile(edit.filePathFull)}
          >
            <IconFile size={12} />
            <span className="turn-footer-file-name">{edit.filePath}</span>
            <span className="tcg-diff">
              <span className="tcg-diff-add">+{edit.additions}</span>
              <span className="tcg-diff-del">{'\u2212'}{edit.deletions}</span>
            </span>
          </span>
        ))}
      </div>
    </div>
  )
})
