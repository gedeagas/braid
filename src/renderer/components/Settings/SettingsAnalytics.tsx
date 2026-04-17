import { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useSessionsStore } from '@/store/sessions'
import type { ModelId } from '@/types'

const MODEL_LABELS: Record<ModelId, string> = {
  'claude-opus-4-7': 'Opus 4.7',
  'claude-sonnet-4-6': 'Sonnet 4.6',
  'claude-opus-4-6': 'Opus 4.6',
  'claude-haiku-4-5-20251001': 'Haiku 4.5',
}

const MODEL_ORDER: ModelId[] = [
  'claude-opus-4-7',
  'claude-sonnet-4-6',
  'claude-opus-4-6',
  'claude-haiku-4-5-20251001',
]

const HOUR_CHART_H = 44 // px — activity bar chart max height
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

type Range = 'today' | 'week' | 'month' | 'all'
type ActivityView = 'today' | 'yesterday' | 'week'

const RANGE_CUTOFFS: Record<Range, () => number> = {
  today: () => new Date().setHours(0, 0, 0, 0),
  week:  () => Date.now() - 7 * 86_400_000,
  month: () => Date.now() - 30 * 86_400_000,
  all:   () => 0,
}

function formatNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toLocaleString()
}

function formatDuration(ms: number): string {
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m`
  return '<1m'
}

function formatMs(ms: number): string {
  return ms >= 1_000 ? `${(ms / 1_000).toFixed(1)}s` : `${Math.round(ms)}ms`
}

export function SettingsAnalytics() {
  const { t } = useTranslation('settings')
  const sessions = useSessionsStore((s) => s.sessions)
  const [range, setRange] = useState<Range>('all')
  const [activityView, setActivityView] = useState<ActivityView>('today')

  // ── Main stats (filtered by range) ──────────────────────────────────────
  const stats = useMemo(() => {
    const cutoff = RANGE_CUTOFFS[range]()
    const all = Object.values(sessions).filter((s) => s.createdAt >= cutoff || range === 'all')
    if (all.length === 0) return null

    const toolCounts: Record<string, number> = {}
    const toolDurations: Record<string, { total: number; n: number }> = {}
    const modelCounts: Partial<Record<ModelId, number>> = {}
    let totalMessages = 0
    let tokensIn = 0
    let tokensOut = 0
    let totalRunMs = 0
    let linesWritten = 0
    let thinkingCount = 0
    let planModeCount = 0
    let errorCount = 0
    let firstSessionAt = Infinity

    for (const s of all) {
      tokensIn += s.tokenUsage?.input ?? 0
      tokensOut += s.tokenUsage?.output ?? 0
      modelCounts[s.model] = (modelCounts[s.model] ?? 0) + 1
      if (s.thinkingEnabled) thinkingCount++
      if (s.planModeEnabled) planModeCount++
      if (s.status === 'error') errorCount++
      totalRunMs += s.totalRunDurationMs ?? 0
      if (s.createdAt < firstSessionAt) firstSessionAt = s.createdAt

      for (const m of s.messages) {
        const inRange = range === 'all' || m.timestamp >= cutoff
        if (!inRange) continue
        if (m.role === 'user') totalMessages++
        for (const tc of m.toolCalls ?? []) {
          toolCounts[tc.name] = (toolCounts[tc.name] ?? 0) + 1
          if (tc.startedAt && tc.completedAt) {
            const dur = toolDurations[tc.name] ?? { total: 0, n: 0 }
            dur.total += tc.completedAt - tc.startedAt
            dur.n++
            toolDurations[tc.name] = dur
          }
          if (tc.diffStats?.additions) linesWritten += tc.diffStats.additions
        }
      }
    }

    const topTools = Object.entries(toolCounts).sort((a, b) => b[1] - a[1]).slice(0, 8)
    const daysActive = firstSessionAt === Infinity
      ? 0
      : Math.max(1, Math.ceil((Date.now() - firstSessionAt) / 86_400_000))

    return {
      totalSessions: all.length, totalMessages, tokensIn, tokensOut,
      totalRunMs, linesWritten, daysActive, modelCounts,
      topTools, maxToolCount: topTools[0]?.[1] ?? 1, toolDurations,
      thinkingCount, planModeCount, errorCount,
    }
  }, [sessions, range])

  // ── Activity chart (independent of main range) ───────────────────────────
  const activity = useMemo(() => {
    const allMessages = Object.values(sessions).flatMap((s) => s.messages)
    const todayStart = new Date().setHours(0, 0, 0, 0)
    const yesterdayStart = todayStart - 86_400_000

    if (activityView === 'today' || activityView === 'yesterday') {
      const start = activityView === 'today' ? todayStart : yesterdayStart
      const end = activityView === 'today' ? Date.now() : todayStart
      const buckets = new Array(24).fill(0) as number[]
      for (const m of allMessages) {
        if (m.role === 'user' && m.timestamp >= start && m.timestamp < end) {
          buckets[new Date(m.timestamp).getHours()]++
        }
      }
      const max = Math.max(...buckets, 1)
      const labels = Array.from({ length: 24 }, (_, h) => (h % 6 === 0 ? `${h}h` : ''))
      return { buckets, max, labels, isEmpty: buckets.every((b) => b === 0) }
    }

    // week: 7 daily buckets (oldest first)
    const buckets = new Array(7).fill(0) as number[]
    for (const m of allMessages) {
      if (m.role !== 'user') continue
      const daysAgo = Math.floor((todayStart - m.timestamp) / 86_400_000)
      if (daysAgo >= 0 && daysAgo < 7) buckets[6 - daysAgo]++
    }
    const max = Math.max(...buckets, 1)
    const labels = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(todayStart - (6 - i) * 86_400_000)
      return DAY_NAMES[d.getDay()]
    })
    return { buckets, max, labels, isEmpty: buckets.every((b) => b === 0) }
  }, [sessions, activityView])

  const ranges: Range[] = ['today', 'week', 'month', 'all']
  const rangeLabels: Record<Range, string> = {
    today: t('analytics.rangeToday'),
    week:  t('analytics.rangeWeek'),
    month: t('analytics.rangeMonth'),
    all:   t('analytics.rangeAll'),
  }
  const activityViews: ActivityView[] = ['today', 'yesterday', 'week']
  const activityLabels: Record<ActivityView, string> = {
    today:     t('analytics.activityToday'),
    yesterday: t('analytics.activityYesterday'),
    week:      t('analytics.activityWeek'),
  }

  const totalTokens = (stats?.tokensIn ?? 0) + (stats?.tokensOut ?? 0)
  const totalModels = stats?.totalSessions ?? 0

  return (
    <div className="settings-section">
      {/* Range selector */}
      <div className="analytics-range-bar">
        {ranges.map((r) => (
          <button
            key={r}
            className={`btn analytics-range-btn${range === r ? ' analytics-range-btn--active' : ''}`}
            onClick={() => setRange(r)}
          >
            {rangeLabels[r]}
          </button>
        ))}
      </div>

      {!stats ? (
        <p className="settings-hint" style={{ padding: '16px 0' }}>{t('analytics.noData')}</p>
      ) : (
        <>
          {/* Overview */}
          <div className="settings-group-header">{t('analytics.overview')}</div>
          <div className="analytics-stats-grid">
            <div className="analytics-stat-card">
              <span className="analytics-stat-value">{formatNum(stats.totalSessions)}</span>
              <span className="analytics-stat-label">{t('analytics.sessions')}</span>
            </div>
            <div className="analytics-stat-card">
              <span className="analytics-stat-value">{formatNum(stats.totalMessages)}</span>
              <span className="analytics-stat-label">{t('analytics.messages')}</span>
            </div>
            <div className="analytics-stat-card">
              <span className="analytics-stat-value">{formatNum(totalTokens)}</span>
              <span className="analytics-stat-label">{t('analytics.totalTokens')}</span>
            </div>
            <div className="analytics-stat-card">
              <span className="analytics-stat-value">{stats.totalRunMs > 0 ? formatDuration(stats.totalRunMs) : '—'}</span>
              <span className="analytics-stat-label">{t('analytics.timeInvested')}</span>
            </div>
            <div className="analytics-stat-card">
              <span className="analytics-stat-value">{stats.linesWritten > 0 ? formatNum(stats.linesWritten) : '—'}</span>
              <span className="analytics-stat-label">{t('analytics.linesWritten')}</span>
            </div>
            {range === 'all' && (
              <div className="analytics-stat-card">
                <span className="analytics-stat-value">{t('analytics.activeSinceDays', { count: stats.daysActive })}</span>
                <span className="analytics-stat-label">{t('analytics.activeSince')}</span>
              </div>
            )}
          </div>
          {range !== 'all' && (
            <p className="settings-hint analytics-token-note">{t('analytics.tokenNote')}</p>
          )}

          {/* Activity chart */}
          <div className="analytics-activity-header">
            <span className="settings-group-header" style={{ margin: 0 }}>{t('analytics.activity')}</span>
            <div className="analytics-activity-tabs">
              {activityViews.map((v) => (
                <button
                  key={v}
                  className={`analytics-activity-tab${activityView === v ? ' analytics-activity-tab--active' : ''}`}
                  onClick={() => setActivityView(v)}
                >
                  {activityLabels[v]}
                </button>
              ))}
            </div>
          </div>

          {activity.isEmpty ? (
            <p className="settings-hint" style={{ fontSize: 11, padding: '8px 0' }}>{t('analytics.activityEmpty')}</p>
          ) : (
            <>
              <div className="analytics-hour-grid">
                {activity.buckets.map((count, i) => (
                  <div
                    key={i}
                    className="analytics-hour-bar"
                    title={`${activity.labels[i] || i} — ${count} ${count === 1 ? 'message' : 'messages'}`}
                    style={{ height: `${Math.max(2, Math.round((count / activity.max) * HOUR_CHART_H))}px` }}
                  />
                ))}
              </div>
              <div className="analytics-hour-label-row">
                {activity.labels.map((label, i) => (
                  <div key={i} className="analytics-hour-label-cell">
                    {label && <span className="analytics-hour-label">{label}</span>}
                  </div>
                ))}
              </div>
            </>
          )}

          {/* Model Distribution */}
          <div className="settings-group-header" style={{ marginTop: 20 }}>{t('analytics.modelUsage')}</div>
          <div className="analytics-bars">
            {MODEL_ORDER.map((modelId) => {
              const count = stats.modelCounts[modelId] ?? 0
              if (count === 0) return null
              const pct = Math.round((count / totalModels) * 100)
              return (
                <div key={modelId} className="analytics-bar-row">
                  <span className="analytics-bar-label">{MODEL_LABELS[modelId]}</span>
                  <div className="analytics-bar-track">
                    <div className="analytics-bar-fill" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="analytics-bar-count">{count} ({pct}%)</span>
                </div>
              )
            })}
          </div>

          {/* Top Tools */}
          {stats.topTools.length > 0 && (
            <>
              <div className="settings-group-header" style={{ marginTop: 20 }}>{t('analytics.topTools')}</div>
              <div className="analytics-bars">
                {stats.topTools.map(([name, count]) => {
                  const dur = stats.toolDurations[name]
                  const avgMs = dur && dur.n >= 3 ? dur.total / dur.n : null
                  return (
                    <div key={name} className="analytics-bar-row analytics-bar-row--tools">
                      <span className="analytics-bar-label">{name}</span>
                      <div className="analytics-bar-track">
                        <div className="analytics-bar-fill" style={{ width: `${Math.round((count / stats.maxToolCount) * 100)}%` }} />
                      </div>
                      <span className="analytics-bar-count">{t('analytics.invocations', { count })}</span>
                      <span className="analytics-bar-time">
                        {avgMs !== null ? t('analytics.toolAvgTime', { time: formatMs(avgMs) }) : ''}
                      </span>
                    </div>
                  )
                })}
              </div>
            </>
          )}

          {/* Feature Usage */}
          <div className="settings-group-header" style={{ marginTop: 20 }}>{t('analytics.features')}</div>
          <div className="analytics-stats-grid">
            <div className="analytics-stat-card">
              <span className="analytics-stat-value">{stats.thinkingCount}</span>
              <span className="analytics-stat-label">{t('analytics.thinking')}</span>
            </div>
            <div className="analytics-stat-card">
              <span className="analytics-stat-value">{stats.planModeCount}</span>
              <span className="analytics-stat-label">{t('analytics.planMode')}</span>
            </div>
            <div className="analytics-stat-card">
              <span className="analytics-stat-value">{stats.errorCount}</span>
              <span className="analytics-stat-label">{t('analytics.errors')}</span>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
