import { memo, useLayoutEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import type { SessionCardData } from '@/types'
import { useMissionControlStore } from '@/store/missionControl'
import { usePrCacheStore } from '@/store/prCache'
import { IconExternalLink } from '@/components/shared/icons'
import * as ipc from '@/lib/ipc'

interface Props {
  data: SessionCardData
  anchorRect: DOMRect
  onMouseEnter: () => void
  onMouseLeave: () => void
}

const STATUS_LABELS: Record<string, string> = {
  running: 'statusRunning',
  waiting_input: 'statusWaiting',
  error: 'statusError',
  idle: 'statusIdle',
  inactive: 'statusInactive',
}

const PR_STATE_KEYS: Record<string, string> = {
  OPEN: 'hoverPrOpen',
  MERGED: 'hoverPrMerged',
  CLOSED: 'hoverPrClosed',
}

export const SessionHoverCard = memo(function SessionHoverCard({ data, anchorRect, onMouseEnter, onMouseLeave }: Props) {
  const { t } = useTranslation('missionControl')
  const ref = useRef<HTMLDivElement>(null)

  const gitStats = useMissionControlStore((s) => s.gitStats[data.path])
  const prEntry = usePrCacheStore((s) => s.cache[data.path])
  const pr = prEntry?.data ?? null

  // Position the popover to the right of the card, or left if it overflows
  useLayoutEffect(() => {
    if (!ref.current) return
    const el = ref.current
    const rect = el.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight

    // Try right side first
    let left = anchorRect.right + 8
    if (left + rect.width > vw - 8) {
      // Flip to left
      left = anchorRect.left - rect.width - 8
    }
    // Clamp left
    left = Math.max(8, Math.min(left, vw - rect.width - 8))

    // Vertically align to top of anchor, clamp to viewport
    let top = anchorRect.top
    if (top + rect.height > vh - 8) {
      top = vh - rect.height - 8
    }
    top = Math.max(8, top)

    el.style.left = `${left}px`
    el.style.top = `${top}px`
  }, [anchorRect])

  const handlePrClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (pr?.url) ipc.shell.openExternal(pr.url)
  }

  return createPortal(
    <div
      ref={ref}
      className="mc-hover-card"
      role="tooltip"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div className="mc-hover-header">
        <span className={`mc-hover-badge mc-hover-badge--${data.status}`}>
          {t(STATUS_LABELS[data.status] ?? 'statusInactive')}
        </span>
      </div>

      <div className="mc-hover-name" title={data.sessionName}>
        {data.sessionName}
      </div>

      <div className="mc-hover-rows">
        <div className="mc-hover-row">
          <span className="mc-hover-label">{t('hoverBranch')}</span>
          <span className="mc-hover-value" title={data.branch}>{data.branch}</span>
        </div>

        <div className="mc-hover-row">
          <span className="mc-hover-label">{t('hoverChanges')}</span>
          <span className="mc-hover-value">
            {gitStats && (gitStats.additions > 0 || gitStats.deletions > 0) ? (
              <>
                <span className="additions">+{gitStats.additions}</span>
                {' '}
                <span className="deletions">-{gitStats.deletions}</span>
              </>
            ) : (
              <span className="mc-hover-muted">{t('hoverNoChanges')}</span>
            )}
          </span>
        </div>

        <div className="mc-hover-row">
          <span className="mc-hover-label">{t('hoverPr')}</span>
          <span className="mc-hover-value">
            {pr ? (
              <>
                <span>#{pr.number} {t(PR_STATE_KEYS[pr.state] ?? 'hoverPrOpen')}</span>
                <button className="mc-hover-link" onClick={handlePrClick} title={pr.url}>
                  <IconExternalLink size={12} />
                </button>
              </>
            ) : (
              <span className="mc-hover-muted">{t('hoverNoPr')}</span>
            )}
          </span>
        </div>
      </div>
    </div>,
    document.body
  )
})
