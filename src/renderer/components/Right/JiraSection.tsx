import React from 'react'
import { useTranslation } from 'react-i18next'
import * as ipc from '@/lib/ipc'
import type { JiraIssue, JiraResult } from '@/types'
import { SectionHeader, StatusDot, SkeletonRows } from '@/components/ui'

interface Props {
  /** null = still loading; 'error' = fetch failed; JiraResult = data from parent */
  result: JiraResult | null | 'error'
  /** PR state from GitHub — used to warn when a PR is open but the Jira ticket hasn't started */
  prState?: string
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const DOT_STATE: Record<JiraIssue['statusCategory'], 'success' | 'pending' | 'skipped'> = {
  done:          'success',
  indeterminate: 'pending',
  new:           'skipped',
}

function openExternal(url: string): void {
  if (url) ipc.shell.openExternal(url)
}

// ─── Skeleton template ────────────────────────────────────────────────────────

const JIRA_SKELETON_TEMPLATE = [
  { type: 'dot' as const },
  { type: 'bar' as const, size: 'sm' as const },
  { type: 'bar' as const, size: 'flex' as const },
  { type: 'bar' as const, size: 'badge' as const },
]
const JIRA_SKELETON_WIDTHS = [{ 2: 160 }, { 2: 120 }]

// ─── Component ───────────────────────────────────────────────────────────────

export function JiraSection({ result, prState }: Props) {
  const { t } = useTranslation('right')

  // Silently hidden when acli is not installed or branch has no Jira keys
  if (result !== null && result !== 'error' && (!result.available || result.issues.length === 0)) {
    return null
  }

  return (
    <div className="checks-section">
      <SectionHeader title={t('jira')} />

      {result === null && (
        <div className="checks-rows">
          <SkeletonRows count={2} template={JIRA_SKELETON_TEMPLATE} rowWidths={JIRA_SKELETON_WIDTHS} />
        </div>
      )}

      {result === 'error' && (
        <div className="checks-empty">{t('jiraLoadError')}</div>
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
                  title={issue.assignee ? `${t('jiraAssignee')}: ${issue.assignee}` : undefined}
                >
                  <StatusDot state={DOT_STATE[issue.statusCategory]} />
                  <span className="jira-issue-key">{issue.key}</span>
                  <span className="checks-row-label">{issue.summary}</span>
                  <span className={`jira-status-badge jira-status-badge--${issue.statusCategory}`}>
                    {issue.status}
                  </span>
                </div>
                {warnNotStarted && (
                  <div className="jira-warn-row">
                    <span className="jira-warn-icon">⚠</span>
                    {t('jiraPrOpenNotStarted')}
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
