import { Tooltip } from '@/components/shared/Tooltip'
import { IconPrBranch } from '@/components/shared/icons'
import { usePrStatus } from '@/store/prCache'

const STATE_COLORS: Record<string, string> = {
  open: '#3fb950',    // --green
  closed: '#f85149',  // --red
  merged: '#a371f7',  // purple
}

const STATE_LABELS: Record<string, string> = {
  open: 'Open PR',
  closed: 'Closed PR',
  merged: 'Merged PR',
}

interface Props {
  worktreePath: string
}

export function PrIcon({ worktreePath }: Props) {
  const pr = usePrStatus(worktreePath)

  // undefined = still loading first fetch, null = no PR found
  if (!pr) return null

  const state = pr.state.toLowerCase()
  const color = STATE_COLORS[state] ?? 'var(--text-muted)'
  const label = STATE_LABELS[state] ?? state

  return (
    <Tooltip content={`${label}: #${pr.number} ${pr.title}`} position="top">
      <span className="pr-icon">
        <IconPrBranch color={color} />
      </span>
    </Tooltip>
  )
}
