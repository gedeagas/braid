import { useMemo } from 'react'
import { fmtTokens } from './formatters'

const CHART_H = 120
const BAR_COLORS = {
  input: 'var(--accent)',
  output: 'var(--text-muted)',
  cacheRead: 'var(--border)',
  cacheWrite: 'var(--text-secondary)',
}

interface ClaudeDay { day: string; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number }
interface CodexDay { day: string; inputTokens: number; cachedInputTokens: number; outputTokens: number; reasoningOutputTokens: number; totalTokens: number }

function tokenValue(v: number | undefined): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

function barHeight(total: number, max: number): number {
  if (max <= 0 || total <= 0) return 2
  return Math.max(2, Math.round((total / max) * CHART_H))
}

function claudeTotal(d: ClaudeDay) {
  return tokenValue(d.inputTokens) + tokenValue(d.outputTokens) + tokenValue(d.cacheReadTokens) + tokenValue(d.cacheWriteTokens)
}

function codexTotal(d: CodexDay) {
  const total = tokenValue(d.totalTokens)
  if (total > 0) return total
  return tokenValue(d.inputTokens) + tokenValue(d.outputTokens) + tokenValue(d.reasoningOutputTokens)
}

export function ClaudeDailyChart({
  daily,
  labels,
}: {
  daily: ClaudeDay[]
  labels: { input: string; output: string; cacheRead: string; cacheWrite: string }
}) {
  const { sliced, max } = useMemo(() => {
    const sliced = daily.slice(-10)
    return { sliced, max: Math.max(1, ...sliced.map(claudeTotal)) }
  }, [daily])
  if (sliced.length === 0) return null

  return (
    <div className="analytics-chart">
      <div className="analytics-chart-bars" style={{ height: CHART_H }}>
        {sliced.map((d) => {
          const t = claudeTotal(d)
          return (
            <div key={d.day} className="analytics-chart-col">
              <div className="analytics-chart-bar" style={{ height: `${barHeight(t, max)}px` }} title={`${d.day}: ${fmtTokens(t)}`}>
                {tokenValue(d.inputTokens) > 0 && <div style={{ flex: tokenValue(d.inputTokens), background: BAR_COLORS.input }} />}
                {tokenValue(d.outputTokens) > 0 && <div style={{ flex: tokenValue(d.outputTokens), background: BAR_COLORS.output }} />}
                {tokenValue(d.cacheReadTokens) > 0 && <div style={{ flex: tokenValue(d.cacheReadTokens), background: BAR_COLORS.cacheRead }} />}
                {tokenValue(d.cacheWriteTokens) > 0 && <div style={{ flex: tokenValue(d.cacheWriteTokens), background: BAR_COLORS.cacheWrite }} />}
              </div>
              <span className="analytics-chart-label">{d.day.slice(5)}</span>
            </div>
          )
        })}
      </div>
      <div className="analytics-chart-legend">
        <span><span className="analytics-dot" style={{ background: BAR_COLORS.input }} />{labels.input}</span>
        <span><span className="analytics-dot" style={{ background: BAR_COLORS.output }} />{labels.output}</span>
        <span><span className="analytics-dot" style={{ background: BAR_COLORS.cacheRead }} />{labels.cacheRead}</span>
        <span><span className="analytics-dot" style={{ background: BAR_COLORS.cacheWrite }} />{labels.cacheWrite}</span>
      </div>
    </div>
  )
}

export function CodexDailyChart({
  daily,
  labels,
}: {
  daily: CodexDay[]
  labels: { input: string; cached: string; output: string; reasoning: string }
}) {
  const { sliced, max } = useMemo(() => {
    const sliced = daily.slice(-10)
    return { sliced, max: Math.max(1, ...sliced.map(codexTotal)) }
  }, [daily])
  if (sliced.length === 0) return null

  return (
    <div className="analytics-chart">
      <div className="analytics-chart-bars" style={{ height: CHART_H }}>
        {sliced.map((d) => {
          const total = codexTotal(d)
          const uncached = Math.max(tokenValue(d.inputTokens) - tokenValue(d.cachedInputTokens), 0)
          return (
            <div key={d.day} className="analytics-chart-col">
              <div className="analytics-chart-bar" style={{ height: `${barHeight(total, max)}px` }} title={`${d.day}: ${fmtTokens(total)}`}>
                {uncached > 0 && <div style={{ flex: uncached, background: BAR_COLORS.input }} />}
                {tokenValue(d.cachedInputTokens) > 0 && <div style={{ flex: tokenValue(d.cachedInputTokens), background: BAR_COLORS.cacheRead }} />}
                {tokenValue(d.outputTokens) > 0 && <div style={{ flex: tokenValue(d.outputTokens), background: BAR_COLORS.output }} />}
                {tokenValue(d.reasoningOutputTokens) > 0 && <div style={{ flex: tokenValue(d.reasoningOutputTokens), background: BAR_COLORS.cacheWrite }} />}
              </div>
              <span className="analytics-chart-label">{d.day.slice(5)}</span>
            </div>
          )
        })}
      </div>
      <div className="analytics-chart-legend">
        <span><span className="analytics-dot" style={{ background: BAR_COLORS.input }} />{labels.input}</span>
        <span><span className="analytics-dot" style={{ background: BAR_COLORS.cacheRead }} />{labels.cached}</span>
        <span><span className="analytics-dot" style={{ background: BAR_COLORS.output }} />{labels.output}</span>
        <span><span className="analytics-dot" style={{ background: BAR_COLORS.cacheWrite }} />{labels.reasoning}</span>
      </div>
    </div>
  )
}
