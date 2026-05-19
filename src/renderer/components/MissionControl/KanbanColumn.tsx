import { memo } from 'react'
import type { BoardCardData } from '@/types'
import { useMissionControlStore } from '@/store/missionControl'
import { SessionCard } from './SessionCard'
import { PrCard } from './PrCard'
import { TerminalCard } from './TerminalCard'
import { useTranslation } from 'react-i18next'

interface Props {
  labelKey: string
  color: string
  cards: BoardCardData[]
  emptyKey?: string
  onClear?: () => void
}

export const KanbanColumn = memo(function KanbanColumn({ labelKey, color, cards, emptyKey = 'emptyColumnSessions', onClear }: Props) {
  const { t } = useTranslation('missionControl')
  const filterQuery = useMissionControlStore((s) => s.filterQuery)
  const filterProjectIds = useMissionControlStore((s) => s.filterProjectIds)
  const hasActiveFilters = filterQuery !== '' || filterProjectIds.size > 0

  const emptyMessage = hasActiveFilters ? t('emptyColumnFiltered') : t(emptyKey)

  return (
    <div className="mc-column">
      <div className="mc-column-header" style={{ '--column-color': color } as React.CSSProperties}>
        <span className="mc-column-title">{t(labelKey)}</span>
        <span className={`mc-column-count${cards.length === 0 && hasActiveFilters ? ' mc-column-count--muted' : ''}`}>
          {cards.length}
        </span>
        {onClear != null && cards.length > 0 && (
          <button className="mc-column-clear" onClick={onClear} title={t('clearDone')}>
            {t('clearDone')}
          </button>
        )}
      </div>
      <div className="mc-column-body">
        {cards.length === 0 ? (
          <div className="mc-column-empty">{emptyMessage}</div>
        ) : (
          cards.map((card) => <BoardCard key={cardKey(card)} data={card} />)
        )}
      </div>
    </div>
  )
})

function cardKey(card: BoardCardData): string {
  switch (card.kind) {
    case 'session': return `s-${card.sessionId}`
    case 'pr': return `pr-${card.worktreeId}`
    case 'terminal': return `t-${card.terminalId}`
  }
}

const BoardCard = memo(function BoardCard({ data }: { data: BoardCardData }) {
  const dismissSession = useMissionControlStore((s) => s.dismissSession)
  const dismissTerminal = useMissionControlStore((s) => s.dismissTerminal)

  switch (data.kind) {
    case 'session': {
      const onDismiss = data.column === 'need_attention'
        ? () => dismissSession(data.sessionId)
        : undefined
      return <SessionCard data={data} onDismiss={onDismiss} />
    }
    case 'terminal': {
      const onDismiss = data.column === 'need_attention'
        ? () => dismissTerminal(data.terminalId)
        : undefined
      return <TerminalCard data={data} onDismiss={onDismiss} />
    }
    case 'pr': return <PrCard data={data} />
  }
})
