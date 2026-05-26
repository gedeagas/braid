import type { WorktreeStatus } from '@/types'

interface Props {
  status: WorktreeStatus
  count?: number
}

export function StatusDot({ status, count }: Props) {
  if (count && count > 0) {
    return (
      <span className={`status-dot status-badge ${status}`}>
        {count > 9 ? '9+' : count}
      </span>
    )
  }
  return <span className={`status-dot ${status}`} />
}
