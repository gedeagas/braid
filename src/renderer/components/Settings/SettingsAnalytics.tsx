import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useClaudeUsageStore } from '@/store/claudeUsage'
import { useCodexUsageStore } from '@/store/codexUsage'
import { Toggle } from '@/components/shared/Toggle'
import { SegmentedControl } from '@/components/shared/SegmentedControl'
import { IconRefresh } from '@/components/shared/icons'
import { Button, FormField, Spinner } from '@/components/ui'
import { ClaudeDailyChart, CodexDailyChart } from './analytics/DailyTokenChart'
import { fmtTokens, fmtCost, fmtTime, fmtUpdated } from './analytics/formatters'
import type {
  ClaudeUsageBreakdownRow,
  ClaudeUsageRange,
  ClaudeUsageScope,
  ClaudeUsageSessionRow,
  ClaudeUsageSummary,
} from '../../../shared/claude-usage-types'
import type {
  CodexUsageBreakdownRow,
  CodexUsageRange,
  CodexUsageScope,
  CodexUsageSessionRow,
  CodexUsageSummary,
} from '../../../shared/codex-usage-types'
import {
  USAGE_MULTIPLE_LOCATIONS_LABEL,
  USAGE_UNKNOWN_LOCATION_LABEL,
} from '../../../shared/usage-labels'

type Tab = 'claude' | 'codex'

type Option<T extends string> = { value: T; label: string }

function totalClaudeTokens(summary: ClaudeUsageSummary): number {
  return summary.inputTokens + summary.outputTokens + summary.cacheReadTokens + summary.cacheWriteTokens
}

function pct(numerator: number, denominator: number, emptyLabel: string): string {
  if (denominator <= 0) return emptyLabel
  return `${Math.round((numerator / denominator) * 100)}%`
}

function formatUsageLabel(
  label: string,
  labels: { unknownLocation: string; multipleLocations: string }
): string {
  if (label === USAGE_UNKNOWN_LOCATION_LABEL) return labels.unknownLocation
  if (label === USAGE_MULTIPLE_LOCATIONS_LABEL) return labels.multipleLocations
  return label
}

function StatCard({ label, value, tone = 'default' }: { label: string; value: string; tone?: 'default' | 'primary' }) {
  return (
    <div className={`analytics-stat-card${tone === 'primary' ? ' analytics-stat-card--primary' : ''}`}>
      <span className="analytics-stat-value">{value}</span>
      <span className="analytics-stat-label">{label}</span>
    </div>
  )
}

function SectionTitle({ title, detail }: { title: string; detail?: string | null }) {
  return (
    <div className="analytics-section-title">
      <h4 className="settings-section-subtitle">{title}</h4>
      {detail && <span className="settings-hint">{detail}</span>}
    </div>
  )
}

function EmptyOrLoading({
  isLoading,
  title,
  hint,
}: {
  isLoading: boolean
  title: string
  hint: string
}) {
  return (
    <div className="analytics-empty">
      {isLoading ? <Spinner size="sm" /> : null}
      <span>{isLoading ? hint : title}</span>
    </div>
  )
}

function BreakdownSection<T extends ClaudeUsageBreakdownRow | CodexUsageBreakdownRow>({
  title,
  rows,
  getValue,
  getMeta,
  formatLabel = (label) => label,
}: {
  title: string
  rows: T[]
  getValue: (row: T) => number
  getMeta: (row: T) => string
  formatLabel?: (label: string) => string
}) {
  const sliced = rows.slice(0, 5)
  const max = Math.max(1, ...sliced.map(getValue))
  if (sliced.length === 0) return null

  return (
    <div>
      <SectionTitle title={title} />
      <div className="analytics-breakdown-list">
        {sliced.map((row) => {
          const value = getValue(row)
          const label = formatLabel(row.label)
          return (
            <div key={row.key} className="analytics-breakdown-row">
              <div className="analytics-breakdown-copy">
                <span className="analytics-breakdown-name" title={label}>{label}</span>
                <span className="analytics-breakdown-meta">{getMeta(row)}</span>
              </div>
              <div className="analytics-breakdown-value">
                <span>{fmtTokens(value)}</span>
                <div className="analytics-breakdown-track">
                  <div style={{ width: `${Math.max(3, Math.round((value / max) * 100))}%` }} />
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function PaneControls<TScope extends string, TRange extends string>({
  scope,
  range,
  scopeOptions,
  rangeOptions,
  isLoading,
  onScope,
  onRange,
  onRefresh,
  refreshLabel,
}: {
  scope: TScope
  range: TRange
  scopeOptions: Option<TScope>[]
  rangeOptions: Option<TRange>[]
  isLoading: boolean
  onScope: (scope: TScope) => void
  onRange: (range: TRange) => void
  onRefresh: () => void
  refreshLabel: string
}) {
  return (
    <div className="analytics-controls">
      <div className="analytics-control-group">
        <SegmentedControl options={scopeOptions} value={scope} onChange={onScope} disabled={isLoading} />
        <SegmentedControl options={rangeOptions} value={range} onChange={onRange} disabled={isLoading} />
      </div>
      <Button
        size="icon"
        className="analytics-refresh-btn"
        onClick={onRefresh}
        disabled={isLoading}
        title={refreshLabel}
        aria-label={refreshLabel}
      >
        {isLoading ? <Spinner size="sm" /> : <IconRefresh size={13} />}
      </Button>
    </div>
  )
}

function StatusLine({
  updatedAt,
  isLoading,
  error,
  labels,
  onClear,
}: {
  updatedAt: number | null | undefined
  isLoading: boolean
  error: string | null | undefined
  labels: { updated: string; notScanned: string; updating: string; clear: string; clearConfirm: string }
  onClear: () => void
}) {
  const clear = () => {
    if (window.confirm(labels.clearConfirm)) onClear()
  }

  return (
    <div className="analytics-status-row">
      <span className={`settings-hint${error ? ' analytics-status-error' : ''}`}>
        {error || (updatedAt ? `${labels.updated} ${fmtUpdated(updatedAt)}` : labels.notScanned)}
        {isLoading && !error ? ` - ${labels.updating}` : ''}
      </span>
      <button className="analytics-clear-link" onClick={clear} type="button" disabled={isLoading}>
        {labels.clear}
      </button>
    </div>
  )
}

function ClaudeSessionsTable({ sessions, labels }: { sessions: ClaudeUsageSessionRow[]; labels: Record<string, string> }) {
  if (sessions.length === 0) return null
  return (
    <div>
      <SectionTitle title={labels.recentSessions} />
      <div className="analytics-table-wrap">
        <table className="analytics-table">
          <thead>
            <tr>
              <th>{labels.time}</th>
              <th>{labels.project}</th>
              <th>{labels.model}</th>
              <th>{labels.turns}</th>
              <th>{labels.input}</th>
              <th>{labels.output}</th>
              <th>{labels.cache}</th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((row) => {
              const projectLabel = formatUsageLabel(row.projectLabel, {
                unknownLocation: labels.unknownLocation,
                multipleLocations: labels.multipleLocations,
              })
              return (
                <tr key={row.sessionId}>
                  <td>{fmtTime(row.lastActiveAt)}</td>
                  <td className="analytics-table-primary" title={projectLabel}>{projectLabel}</td>
                  <td title={row.model ?? labels.unknown}>{row.model ?? labels.unknown}</td>
                  <td>{row.turns}</td>
                  <td>{fmtTokens(row.inputTokens)}</td>
                  <td>{fmtTokens(row.outputTokens)}</td>
                  <td>{fmtTokens(row.cacheReadTokens + row.cacheWriteTokens)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function CodexSessionsTable({ sessions, labels }: { sessions: CodexUsageSessionRow[]; labels: Record<string, string> }) {
  if (sessions.length === 0) return null
  return (
    <div>
      <SectionTitle title={labels.recentSessions} />
      <div className="analytics-table-wrap">
        <table className="analytics-table">
          <thead>
            <tr>
              <th>{labels.time}</th>
              <th>{labels.project}</th>
              <th>{labels.model}</th>
              <th>{labels.events}</th>
              <th>{labels.input}</th>
              <th>{labels.output}</th>
              <th>{labels.reasoning}</th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((row) => {
              const projectLabel = formatUsageLabel(row.projectLabel, {
                unknownLocation: labels.unknownLocation,
                multipleLocations: labels.multipleLocations,
              })
              return (
                <tr key={row.sessionId}>
                  <td>{fmtTime(row.lastActiveAt)}</td>
                  <td className="analytics-table-primary" title={projectLabel}>{projectLabel}</td>
                  <td title={row.model ?? labels.unknown}>{row.model ?? labels.unknown}</td>
                  <td>{row.events}</td>
                  <td>{fmtTokens(row.inputTokens)}</td>
                  <td>{fmtTokens(row.outputTokens)}</td>
                  <td>{fmtTokens(row.reasoningOutputTokens)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function ClaudePane() {
  const { t } = useTranslation('settings')
  const scan = useClaudeUsageStore((s) => s.scanState)
  const summary = useClaudeUsageStore((s) => s.summary)
  const daily = useClaudeUsageStore((s) => s.daily)
  const models = useClaudeUsageStore((s) => s.modelBreakdown)
  const projects = useClaudeUsageStore((s) => s.projectBreakdown)
  const sessions = useClaudeUsageStore((s) => s.recentSessions)
  const scope = useClaudeUsageStore((s) => s.scope)
  const range = useClaudeUsageStore((s) => s.range)
  const isLoading = useClaudeUsageStore((s) => s.isLoading)
  const error = useClaudeUsageStore((s) => s.error)
  const setEnabled = useClaudeUsageStore((s) => s.setEnabled)
  const clearData = useClaudeUsageStore((s) => s.clearData)
  const setScope = useClaudeUsageStore((s) => s.setScope)
  const setRange = useClaudeUsageStore((s) => s.setRange)
  const fetchUsage = useClaudeUsageStore((s) => s.fetchUsage)
  const refreshUsage = useClaudeUsageStore((s) => s.refreshUsage)

  useEffect(() => { void fetchUsage() }, [fetchUsage])

  const enabled = scan?.enabled ?? false
  const hasData = summary?.hasAnyData ?? false
  const totalTokens = summary ? totalClaudeTokens(summary) : 0
  const locationLabels = useMemo(() => ({
    unknownLocation: t('analytics.unknownLocation'),
    multipleLocations: t('analytics.multipleLocations'),
  }), [t])

  const scopeOptions = useMemo<Option<ClaudeUsageScope>[]>(() => [
    { value: 'braid', label: t('analytics.scopeBraid') },
    { value: 'all', label: t('analytics.scopeAll') },
  ], [t])
  const rangeOptions = useMemo<Option<ClaudeUsageRange>[]>(() => [
    { value: '7d', label: t('analytics.range7d') },
    { value: '30d', label: t('analytics.range30d') },
    { value: '90d', label: t('analytics.range90d') },
    { value: 'all', label: t('analytics.rangeAll') },
  ], [t])

  return (
    <div className="analytics-pane">
      <FormField label={t('analytics.claudeTracking')} hint={t('analytics.claudeHint')} horizontal>
        <Toggle checked={enabled} onChange={(v) => void setEnabled(v)} disabled={isLoading} />
      </FormField>

      {enabled && (
        <>
          <PaneControls
            scope={scope}
            range={range}
            scopeOptions={scopeOptions}
            rangeOptions={rangeOptions}
            isLoading={isLoading}
            onScope={(v) => void setScope(v)}
            onRange={(v) => void setRange(v)}
            onRefresh={() => void refreshUsage()}
            refreshLabel={t('analytics.refresh')}
          />
          <StatusLine
            updatedAt={scan?.lastScanCompletedAt}
            isLoading={isLoading}
            error={error || scan?.lastScanError}
            labels={{
              updated: t('analytics.updated'),
              notScanned: t('analytics.notScanned'),
              updating: t('analytics.updating'),
              clear: t('analytics.clearCache'),
              clearConfirm: t('analytics.clearConfirm'),
            }}
            onClear={() => void clearData()}
          />

          {!hasData && (
            <EmptyOrLoading
              isLoading={isLoading}
              title={t('analytics.noData')}
              hint={t('analytics.loading')}
            />
          )}

          {hasData && summary && (
            <>
              <div className="analytics-primary-grid">
                <StatCard label={t('analytics.totalTokens')} value={fmtTokens(totalTokens)} tone="primary" />
                <StatCard label={t('analytics.estimatedCost')} value={fmtCost(summary.estimatedCostUsd, t('analytics.notAvailable'))} tone="primary" />
                <StatCard label={t('analytics.sessionsTurns')} value={`${summary.sessions} / ${summary.turns}`} tone="primary" />
                <StatCard label={t('analytics.cacheReuseRate')} value={summary.cacheReuseRate != null ? `${Math.round(summary.cacheReuseRate * 100)}%` : t('analytics.notAvailable')} tone="primary" />
              </div>

              <div className="analytics-detail-grid">
                <StatCard label={t('analytics.inputTokens')} value={fmtTokens(summary.inputTokens)} />
                <StatCard label={t('analytics.outputTokens')} value={fmtTokens(summary.outputTokens)} />
                <StatCard label={t('analytics.cacheRead')} value={fmtTokens(summary.cacheReadTokens)} />
                <StatCard label={t('analytics.cacheWrite')} value={fmtTokens(summary.cacheWriteTokens)} />
                <StatCard label={t('analytics.zeroCacheTurns')} value={`${summary.zeroCacheReadTurns}`} />
              </div>

              <p className="settings-hint analytics-cost-note">{t('analytics.costNote')}</p>

              {daily.length > 0 && (
                <div>
                  <SectionTitle title={t('analytics.dailyUsage')} detail={t('analytics.chartLastDays')} />
                  <ClaudeDailyChart
                    daily={daily}
                    labels={{
                      input: t('analytics.inputTokens'),
                      output: t('analytics.outputTokens'),
                      cacheRead: t('analytics.cacheRead'),
                      cacheWrite: t('analytics.cacheWrite'),
                    }}
                  />
                </div>
              )}

              <BreakdownSection
                title={t('analytics.byModel')}
                rows={models}
                getValue={(row) => row.inputTokens + row.outputTokens + row.cacheReadTokens + row.cacheWriteTokens}
                getMeta={(row) => t('analytics.sessionsTurnsMeta', { sessions: row.sessions, turns: row.turns })}
              />

              <BreakdownSection
                title={t('analytics.byProject')}
                rows={projects}
                getValue={(row) => row.inputTokens + row.outputTokens + row.cacheReadTokens + row.cacheWriteTokens}
                getMeta={(row) => t('analytics.sessionsTurnsMeta', { sessions: row.sessions, turns: row.turns })}
                formatLabel={(label) => formatUsageLabel(label, locationLabels)}
              />

              <ClaudeSessionsTable
                sessions={sessions}
                labels={{
                  recentSessions: t('analytics.recentSessions'),
                  time: t('analytics.colTime'),
                  project: t('analytics.colProject'),
                  model: t('analytics.colModel'),
                  turns: t('analytics.colTurns'),
                  input: t('analytics.colInput'),
                  output: t('analytics.colOutput'),
                  cache: t('analytics.colCache'),
                  unknown: t('analytics.unknown'),
                  unknownLocation: locationLabels.unknownLocation,
                  multipleLocations: locationLabels.multipleLocations,
                }}
              />
            </>
          )}
        </>
      )}
    </div>
  )
}

function CodexPane() {
  const { t } = useTranslation('settings')
  const scan = useCodexUsageStore((s) => s.scanState)
  const summary = useCodexUsageStore((s) => s.summary)
  const daily = useCodexUsageStore((s) => s.daily)
  const models = useCodexUsageStore((s) => s.modelBreakdown)
  const projects = useCodexUsageStore((s) => s.projectBreakdown)
  const sessions = useCodexUsageStore((s) => s.recentSessions)
  const scope = useCodexUsageStore((s) => s.scope)
  const range = useCodexUsageStore((s) => s.range)
  const isLoading = useCodexUsageStore((s) => s.isLoading)
  const error = useCodexUsageStore((s) => s.error)
  const setEnabled = useCodexUsageStore((s) => s.setEnabled)
  const clearData = useCodexUsageStore((s) => s.clearData)
  const setScope = useCodexUsageStore((s) => s.setScope)
  const setRange = useCodexUsageStore((s) => s.setRange)
  const fetchUsage = useCodexUsageStore((s) => s.fetchUsage)
  const refreshUsage = useCodexUsageStore((s) => s.refreshUsage)

  useEffect(() => { void fetchUsage() }, [fetchUsage])

  const enabled = scan?.enabled ?? false
  const hasData = summary?.hasAnyData ?? false
  const cacheRate = summary
    ? pct(summary.cachedInputTokens, summary.inputTokens, t('analytics.notAvailable'))
    : t('analytics.notAvailable')
  const locationLabels = useMemo(() => ({
    unknownLocation: t('analytics.unknownLocation'),
    multipleLocations: t('analytics.multipleLocations'),
  }), [t])

  const scopeOptions = useMemo<Option<CodexUsageScope>[]>(() => [
    { value: 'braid', label: t('analytics.scopeBraid') },
    { value: 'all', label: t('analytics.scopeAll') },
  ], [t])
  const rangeOptions = useMemo<Option<CodexUsageRange>[]>(() => [
    { value: '7d', label: t('analytics.range7d') },
    { value: '30d', label: t('analytics.range30d') },
    { value: '90d', label: t('analytics.range90d') },
    { value: 'all', label: t('analytics.rangeAll') },
  ], [t])

  return (
    <div className="analytics-pane">
      <FormField label={t('analytics.codexTracking')} hint={t('analytics.codexHint')} horizontal>
        <Toggle checked={enabled} onChange={(v) => void setEnabled(v)} disabled={isLoading} />
      </FormField>

      {enabled && (
        <>
          <PaneControls
            scope={scope}
            range={range}
            scopeOptions={scopeOptions}
            rangeOptions={rangeOptions}
            isLoading={isLoading}
            onScope={(v) => void setScope(v)}
            onRange={(v) => void setRange(v)}
            onRefresh={() => void refreshUsage()}
            refreshLabel={t('analytics.refresh')}
          />
          <StatusLine
            updatedAt={scan?.lastScanCompletedAt}
            isLoading={isLoading}
            error={error || scan?.lastScanError}
            labels={{
              updated: t('analytics.updated'),
              notScanned: t('analytics.notScanned'),
              updating: t('analytics.updating'),
              clear: t('analytics.clearCache'),
              clearConfirm: t('analytics.clearConfirm'),
            }}
            onClear={() => void clearData()}
          />

          {!hasData && (
            <EmptyOrLoading
              isLoading={isLoading}
              title={t('analytics.noData')}
              hint={t('analytics.loading')}
            />
          )}

          {hasData && summary && (
            <>
              <div className="analytics-primary-grid">
                <StatCard label={t('analytics.totalTokens')} value={fmtTokens(summary.totalTokens)} tone="primary" />
                <StatCard label={t('analytics.estimatedCost')} value={fmtCost(summary.estimatedCostUsd, t('analytics.notAvailable'))} tone="primary" />
                <StatCard label={t('analytics.sessionsEvents')} value={`${summary.sessions} / ${summary.events}`} tone="primary" />
                <StatCard label={t('analytics.cachedInputRate')} value={cacheRate} tone="primary" />
              </div>

              <div className="analytics-detail-grid">
                <StatCard label={t('analytics.inputTokens')} value={fmtTokens(summary.inputTokens)} />
                <StatCard label={t('analytics.cachedInput')} value={fmtTokens(summary.cachedInputTokens)} />
                <StatCard label={t('analytics.outputTokens')} value={fmtTokens(summary.outputTokens)} />
                <StatCard label={t('analytics.reasoningOutput')} value={fmtTokens(summary.reasoningOutputTokens)} />
              </div>

              <p className="settings-hint analytics-cost-note">{t('analytics.costNote')}</p>

              {daily.length > 0 && (
                <div>
                  <SectionTitle title={t('analytics.dailyUsage')} detail={t('analytics.chartLastDays')} />
                  <CodexDailyChart
                    daily={daily}
                    labels={{
                      input: t('analytics.inputTokens'),
                      cached: t('analytics.cachedInput'),
                      output: t('analytics.outputTokens'),
                      reasoning: t('analytics.reasoningOutput'),
                    }}
                  />
                </div>
              )}

              <BreakdownSection
                title={t('analytics.byModel')}
                rows={models}
                getValue={(row) => row.totalTokens}
                getMeta={(row) => t('analytics.sessionsEventsMeta', { sessions: row.sessions, events: row.events })}
              />

              <BreakdownSection
                title={t('analytics.byProject')}
                rows={projects}
                getValue={(row) => row.totalTokens}
                getMeta={(row) => t('analytics.sessionsEventsMeta', { sessions: row.sessions, events: row.events })}
                formatLabel={(label) => formatUsageLabel(label, locationLabels)}
              />

              <CodexSessionsTable
                sessions={sessions}
                labels={{
                  recentSessions: t('analytics.recentSessions'),
                  time: t('analytics.colTime'),
                  project: t('analytics.colProject'),
                  model: t('analytics.colModel'),
                  events: t('analytics.colEvents'),
                  input: t('analytics.colInput'),
                  output: t('analytics.colOutput'),
                  reasoning: t('analytics.colReasoning'),
                  unknown: t('analytics.unknown'),
                  unknownLocation: locationLabels.unknownLocation,
                  multipleLocations: locationLabels.multipleLocations,
                }}
              />
            </>
          )}
        </>
      )}
    </div>
  )
}

export function SettingsAnalytics() {
  const { t } = useTranslation('settings')
  const [tab, setTab] = useState<Tab>('claude')
  const tabOptions = useMemo<Option<Tab>[]>(() => [
    { value: 'claude', label: t('analytics.tabClaude') },
    { value: 'codex', label: t('analytics.tabCodex') },
  ], [t])

  return (
    <div className="settings-section analytics-section">
      <div className="analytics-tabs">
        <SegmentedControl options={tabOptions} value={tab} onChange={setTab} />
      </div>
      {tab === 'claude' ? <ClaudePane /> : <CodexPane />}
    </div>
  )
}
