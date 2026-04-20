import React from 'react'
import { useTranslation } from 'react-i18next'
import * as ipc from '@/lib/ipc'
import type { LinearIssue, LinearResult } from '@/types'
import { SectionHeader, StatusDot, SkeletonRows } from '@/components/ui'

interface Props {
  /** null = still loading; 'error' = fetch failed; LinearResult = data from parent */
  result: LinearResult | null | 'error'
  /** PR state from GitHub — used to warn when a PR is open but the Linear issue hasn't started */
  prState?: string
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const DOT_STATE: Record<LinearIssue['statusCategory'], 'success' | 'pending' | 'skipped'> = {
  done:          'success',
  indeterminate: 'pending',
  new:           'skipped',
}

function openExternal(url: string): void {
  if (url) ipc.shell.openExternal(url)
}

// ─── Skeleton template ────────────────────────────────────────────────────────

const LINEAR_SKELETON_TEMPLATE = [
  { type: 'dot' as const },
  { type: 'bar' as const, size: 'sm' as const },
  { type: 'bar' as const, size: 'flex' as const },
  { type: 'bar' as const, size: 'badge' as const },
]
const LINEAR_SKELETON_WIDTHS = [{ 2: 160 }, { 2: 120 }]

// ─── Component ───────────────────────────────────────────────────────────────

export function LinearSection({ result, prState }: Props) {
  const { t } = useTranslation('right')

  // Silently hidden when no API key is configured or branch has no Linear keys
  if (result !== null && result !== 'error' && (!result.available || result.issues.length === 0)) {
    return null
  }

  return (
    <div className="checks-section">
      <SectionHeader title={t('linear')} />

      {result === null && (
        <div className="checks-rows">
          <SkeletonRows count={2} template={LINEAR_SKELETON_TEMPLATE} rowWidths={LINEAR_SKELETON_WIDTHS} />
        </div>
      )}

      {result === 'error' && (
        <div className="checks-empty">{t('linearLoadError')}</div>
      )}

      {result !== null && result !== 'error' && result.available && result.issues.length > 0 && (
        <div className="checks-rows">
          {result.issues.map((issue) => {
            const warnNotStarted = prState === 'OPEN' && issue.statusCategory === 'new'
            return (
              <React.Fragment key={issue.key}>
                <div
                  className="checks-row checks-row--clickable"
                  onClick={() => openExternal(issue.url)}
                  title={issue.assignee ? `${t('linearAssignee')}: ${issue.assignee}` : undefined}
                >
                  <StatusDot state={DOT_STATE[issue.statusCategory]} />
                  <span className="linear-issue-key">{issue.key}</span>
                  <span className="checks-row-label">{issue.summary}</span>
                  <span className={`linear-status-badge linear-status-badge--${issue.statusCategory}`}>
                    {issue.status}
                  </span>
                </div>
                {warnNotStarted && (
                  <div className="linear-warn-row">
                    <span className="linear-warn-icon">⚠</span>
                    {t('linearPrOpenNotStarted')}
                  </div>
                )}
              </React.Fragment>
            )
          })}
        </div>
      )}
    </div>
  )
}
