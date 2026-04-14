/**
 * ChecksSections — rendering sub-components for the Checks panel.
 *
 * Contains: shared types, helper functions, primitive UI atoms, and all
 * section-level components (GitStatusSection, DeploymentsSection, ChecksSection).
 * Also exports ChecksViewSkeleton and ChecksNoPr for the empty states.
 *
 * Extracted from ChecksView.tsx to keep each file under the 450-line limit.
 */
import React from 'react'
import * as ipc from '@/lib/ipc'
import { useUIStore } from '@/store/ui'
import type { JiraResult } from '@/types'
import { useTranslation } from 'react-i18next'
import {
  IconCheckCircle, IconXCircleStatus, IconSkipCircle, IconSpinner, IconDeployment,
} from '@/components/shared/icons'
import { SectionHeader, StatusDot } from '@/components/ui'
import { JiraSection } from './JiraSection'

// ─── Types ────────────────────────────────────────────────────────────────────

import type { PrStatus } from '@/store/prCache'

export interface CheckRun {
  name: string
  status: string
  conclusion: string | null
  url: string
  startedAt?: string | null
  completedAt?: string | null
  workflowName?: string | null
}

export interface Deployment {
  environment: string
  state: string
  url?: string
  updatedAt?: string
}

export interface GitSyncStatus {
  uncommittedChanges: number
  behindCount: number
  aheadCount: number
  baseBranch: string | null
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function getCheckConclusion(check: CheckRun): 'success' | 'failure' | 'pending' | 'skipped' {
  if (check.status === 'completed') {
    if (check.conclusion === 'success') return 'success'
    if (check.conclusion === 'skipped' || check.conclusion === 'neutral') return 'skipped'
    if (
      check.conclusion === 'failure' || check.conclusion === 'timed_out' ||
      check.conclusion === 'cancelled' || check.conclusion === 'action_required'
    ) return 'failure'
  }
  return 'pending'
}

function getDuration(
  startedAt: string | null | undefined,
  completedAt: string | null | undefined,
): string | null {
  if (!startedAt || !completedAt) return null
  const ms = new Date(completedAt).getTime() - new Date(startedAt).getTime()
  if (isNaN(ms) || ms < 0) return null
  const secs = Math.floor(ms / 1000)
  if (secs < 60) return `${secs}s`
  const mins = Math.floor(secs / 60)
  const rem = secs % 60
  return rem > 0 ? `${mins}m ${rem}s` : `${mins}m`
}

function getDeploymentState(state: string): 'success' | 'failure' | 'pending' {
  if (state === 'success') return 'success'
  if (state === 'failure' || state === 'error' || state === 'inactive') return 'failure'
  return 'pending'
}

// ─── Primitive atoms ──────────────────────────────────────────────────────────

function CheckStatusIcon({ check }: { check: CheckRun }) {
  const state = getCheckConclusion(check)
  if (state === 'success') return <IconCheckCircle />
  if (state === 'failure') return <IconXCircleStatus />
  if (state === 'skipped') return <IconSkipCircle />
  return <IconSpinner />
}

export function ActionButton({
  label, onClick, variant = 'secondary', disabled = false,
}: {
  label: string
  onClick?: (e?: React.MouseEvent) => void
  variant?: 'primary' | 'secondary' | 'danger'
  disabled?: boolean
}) {
  return (
    <button
      className={`checks-action-btn checks-action-btn--${variant}`}
      onClick={onClick}
      disabled={disabled}
      style={disabled ? { opacity: 0.5, cursor: 'default' } : undefined}
    >
      {label}
    </button>
  )
}

// ─── Section components ───────────────────────────────────────────────────────

export function GitStatusSection({
  pr, sync, pulling, onPull, pushing, onPush, markingReady, onMarkReady,
}: {
  pr: PrStatus; sync: GitSyncStatus
  pulling: boolean; onPull: () => void
  pushing: boolean; onPush: () => void
  markingReady: boolean; onMarkReady: () => void
}) {
  const { t } = useTranslation('right')

  const rows: Array<{
    label: string
    state: 'success' | 'failure' | 'pending'
    action?: { label: string; onClick: () => void; variant?: 'primary' | 'secondary' | 'danger'; disabled?: boolean }
  }> = []

  rows.push({
    label: pr.isDraft ? t('prIsDraft') : t('readyForReview'),
    state: pr.isDraft ? 'pending' : 'success',
    action: pr.isDraft
      ? { label: markingReady ? t('markingReady') : t('markReady'), onClick: onMarkReady, variant: 'primary', disabled: markingReady }
      : undefined,
  })

  if (sync.uncommittedChanges > 0) {
    rows.push({
      label: t('uncommittedChanges', { count: sync.uncommittedChanges }),
      state: 'pending',
      action: { label: t('viewChanges'), onClick: () => useUIStore.getState().setRightPanelTab('changes') },
    })
  }

  if (sync.behindCount > 0) {
    rows.push({
      label: t('commitsBehind', { count: sync.behindCount, baseBranch: sync.baseBranch ?? 'main' }),
      state: 'pending',
      action: { label: pulling ? t('pulling') : t('pull'), onClick: onPull, disabled: pulling },
    })
  }

  if (sync.aheadCount > 0) {
    rows.push({
      label: t('commitsAhead', { count: sync.aheadCount, baseBranch: sync.baseBranch ?? 'main' }),
      state: 'pending',
      action: { label: pushing ? t('pushing') : t('push'), onClick: onPush, disabled: pushing },
    })
  }

  return (
    <div className="checks-section">
      <SectionHeader title={t('gitStatus')} />
      <div className="checks-rows">
        {rows.map((row) => (
          <div key={row.label} className="checks-row">
            <StatusDot state={row.state} />
            <span className="checks-row-label">{row.label}</span>
            {row.action && (
              <ActionButton
                label={row.action.label}
                onClick={row.action.onClick}
                variant={row.action.variant ?? 'secondary'}
                disabled={row.action.disabled}
              />
            )}
          </div>
        ))}
        {rows.length === 0 && (
          <div className="checks-row">
            <StatusDot state="success" />
            <span className="checks-row-label">{t('allUpToDate')}</span>
          </div>
        )}
      </div>
    </div>
  )
}

export function DeploymentsSection({ deployments }: { deployments: Deployment[] }) {
  const { t } = useTranslation('right')
  const openUrl = (url: string) =>
    ipc.shell.openExternal(url)

  return (
    <div className="checks-section">
      <SectionHeader title={t('deployments')} />
      <div className="checks-rows">
        {deployments.map((d) => (
          <div
            key={d.environment}
            className="checks-row checks-row--clickable"
            onClick={() => d.url && openUrl(d.url)}
          >
            <span className="checks-deployment-icon"><IconDeployment /></span>
            <span className="checks-row-label">{d.environment}</span>
            <StatusDot state={getDeploymentState(d.state)} />
          </div>
        ))}
      </div>
    </div>
  )
}

export function ChecksSection({ checks, onSelectCheck, openingLog, onFixWithAI, fixingCheck }: {
  checks: CheckRun[]
  onSelectCheck: (check: CheckRun) => void
  openingLog: string | null
  onFixWithAI: (check: CheckRun) => void
  fixingCheck: string | null
}) {
  const { t } = useTranslation('right')
  const groups = new Map<string, CheckRun[]>()
  for (const check of checks) {
    const key = check.workflowName ?? check.name
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(check)
  }

  return (
    <div className="checks-section">
      <SectionHeader title={t('checks')} />
      {checks.length === 0 ? (
        <div className="checks-empty">{t('noChecks')}</div>
      ) : (
        <div className="checks-rows">
          {Array.from(groups.entries()).map(([groupName, groupChecks]) => (
            <div key={groupName} className="checks-group">
              {groupChecks.length > 1 && <div className="checks-group-label">{groupName}</div>}
              {groupChecks.map((check) => {
                const duration = getDuration(check.startedAt, check.completedAt)
                const state = getCheckConclusion(check)
                const isFailed = state === 'failure'
                const isOpening = openingLog === check.name
                return (
                  <div
                    key={check.name}
                    className="checks-row checks-row--check checks-row--clickable"
                    onClick={() => !isOpening && onSelectCheck(check)}
                  >
                    <CheckStatusIcon check={check} />
                    <span className="checks-row-label">{check.name}</span>
                    {isOpening ? (
                      <span className="checks-row-meta" style={{ color: 'var(--text-muted)' }}>
                        {t('checkLogLoading')}
                      </span>
                    ) : isFailed ? (
                      <ActionButton
                        label={fixingCheck === check.name ? t('fixingCheck') : t('fixWithAI')}
                        variant="danger"
                        disabled={fixingCheck !== null}
                        onClick={(e) => { e?.stopPropagation(); onFixWithAI(check) }}
                      />
                    ) : duration ? (
                      <span className="checks-row-meta" style={{ color: 'var(--text-muted)' }}>
                        {duration}
                      </span>
                    ) : (
                      <span className={`check-status-badge check-status-badge--${state}`}>
                        {state === 'pending' ? t('checkStatusInProgress') : state === 'skipped' ? t('checkStatusSkipped') : check.conclusion ?? check.status}
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Empty / loading states ───────────────────────────────────────────────────

export function ChecksViewSkeleton() {
  return (
    <div className="checks-view">
      <div className="checks-skeleton-header">
        <div className="checks-skeleton-header-title">
          <span className="skeleton-bar skeleton-bar--sm" style={{ width: 28 }} />
          <span className="skeleton-bar skeleton-bar--title" />
        </div>
        <div className="checks-skeleton-header-meta">
          <span className="skeleton-bar skeleton-bar--state" />
          <span className="skeleton-bar skeleton-bar--branch" />
        </div>
      </div>
      <div className="checks-body">
        <div className="checks-section">
          <div className="checks-section-header">
            <span className="skeleton-bar" style={{ width: 72, height: 10 }} />
          </div>
          <div className="checks-rows">
            {([1, 2, 3] as const).map((i) => (
              <div key={i} className="skeleton-row">
                <span className="skeleton-dot" />
                <span className="skeleton-bar skeleton-bar--flex" style={{ maxWidth: i === 1 ? 180 : i === 2 ? 140 : 200 }} />
              </div>
            ))}
          </div>
        </div>
        <div className="checks-section">
          <div className="checks-section-header">
            <span className="skeleton-bar" style={{ width: 56, height: 10 }} />
          </div>
          <div className="checks-rows">
            {([1, 2] as const).map((i) => (
              <div key={i} className="skeleton-row">
                <span className="skeleton-dot" />
                <span className="skeleton-bar skeleton-bar--sm" />
                <span className="skeleton-bar skeleton-bar--flex" style={{ maxWidth: i === 1 ? 160 : 120 }} />
                <span className="skeleton-bar skeleton-bar--badge" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

export function ChecksNoPr({ creatingPr, onCreatePr, jiraResult }: {
  creatingPr: boolean
  onCreatePr: () => void
  jiraResult: JiraResult | null | 'error'
}) {
  const { t } = useTranslation('right')
  return (
    <div className="checks-view">
      <div className="checks-body">
        <div className="checks-no-pr">
          <div className="checks-no-pr-title">{t('noPr')}</div>
          <div className="checks-no-pr-hint">{t('noPrHint')}</div>
          <ActionButton
            label={creatingPr ? t('creatingPr') : t('createPr')}
            onClick={onCreatePr}
            variant="primary"
            disabled={creatingPr}
          />
        </div>
        <JiraSection result={jiraResult} />
      </div>
    </div>
  )
}
