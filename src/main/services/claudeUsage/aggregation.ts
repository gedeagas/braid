import type {
  ClaudeUsageAttributedTurn,
  ClaudeUsageDailyAggregate,
  ClaudeUsageSession,
} from './types'
import {
  USAGE_MULTIPLE_LOCATIONS_LABEL,
  USAGE_UNKNOWN_LOCATION_LABEL,
} from '../../../shared/usage-labels'

export function finalizeSessions(sessionsById: Map<string, ClaudeUsageSession>): ClaudeUsageSession[] {
  for (const session of sessionsById.values()) {
    session.locationBreakdown.sort((a, b) => {
      const aTotal = a.inputTokens + a.outputTokens
      const bTotal = b.inputTokens + b.outputTokens
      return bTotal - aTotal
    })
    const primary = session.locationBreakdown[0]
    if (primary) session.primaryWorktreeId = primary.worktreeId
  }
  return [...sessionsById.values()].sort((a, b) =>
    b.lastTimestamp.localeCompare(a.lastTimestamp)
  )
}

export function mergeSessions(target: Map<string, ClaudeUsageSession>, sessions: ClaudeUsageSession[]): void {
  for (const session of sessions) {
    const existing = target.get(session.sessionId)
    if (!existing) {
      target.set(session.sessionId, structuredClone(session))
      continue
    }
    if (session.firstTimestamp < existing.firstTimestamp) existing.firstTimestamp = session.firstTimestamp
    if (session.lastTimestamp > existing.lastTimestamp) {
      existing.lastTimestamp = session.lastTimestamp
      existing.lastCwd = session.lastCwd
      existing.lastGitBranch = session.lastGitBranch
    }
    existing.model = session.model ?? existing.model
    existing.turnCount += session.turnCount
    existing.totalInputTokens += session.totalInputTokens
    existing.totalOutputTokens += session.totalOutputTokens
    existing.totalCacheReadTokens += session.totalCacheReadTokens
    existing.totalCacheWriteTokens += session.totalCacheWriteTokens

    for (const loc of session.locationBreakdown) {
      const existingLoc = existing.locationBreakdown.find((e) => e.locationKey === loc.locationKey)
      if (existingLoc) {
        existingLoc.turnCount += loc.turnCount
        existingLoc.inputTokens += loc.inputTokens
        existingLoc.outputTokens += loc.outputTokens
        existingLoc.cacheReadTokens += loc.cacheReadTokens
        existingLoc.cacheWriteTokens += loc.cacheWriteTokens
      } else {
        existing.locationBreakdown.push({ ...loc })
      }
    }
  }
}

export function mergeDailyAggregates(
  target: Map<string, ClaudeUsageDailyAggregate>,
  aggregates: ClaudeUsageDailyAggregate[]
): void {
  for (const agg of aggregates) {
    const key = [agg.day, agg.model ?? 'unknown', agg.projectKey].join('::')
    const existing = target.get(key)
    if (!existing) {
      target.set(key, { ...agg })
      continue
    }
    existing.turnCount += agg.turnCount
    existing.zeroCacheReadTurnCount += agg.zeroCacheReadTurnCount
    existing.inputTokens += agg.inputTokens
    existing.outputTokens += agg.outputTokens
    existing.cacheReadTokens += agg.cacheReadTokens
    existing.cacheWriteTokens += agg.cacheWriteTokens
  }
}

export function aggregateTurns(turns: ClaudeUsageAttributedTurn[]): {
  sessions: ClaudeUsageSession[]
  dailyAggregates: ClaudeUsageDailyAggregate[]
} {
  const sessionsById = new Map<string, ClaudeUsageSession>()
  const dailyByKey = new Map<string, ClaudeUsageDailyAggregate>()

  for (const turn of turns) {
    let session = sessionsById.get(turn.sessionId)
    if (!session) {
      session = {
        sessionId: turn.sessionId,
        firstTimestamp: turn.timestamp,
        lastTimestamp: turn.timestamp,
        model: turn.model,
        lastCwd: turn.cwd,
        lastGitBranch: turn.gitBranch,
        primaryWorktreeId: turn.worktreeId,
        turnCount: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalCacheReadTokens: 0,
        totalCacheWriteTokens: 0,
        locationBreakdown: [],
      }
      sessionsById.set(turn.sessionId, session)
    }

    if (turn.timestamp < session.firstTimestamp) session.firstTimestamp = turn.timestamp
    if (turn.timestamp > session.lastTimestamp) {
      session.lastTimestamp = turn.timestamp
      session.lastCwd = turn.cwd
      session.lastGitBranch = turn.gitBranch
    }
    session.model = turn.model ?? session.model
    session.turnCount++
    session.totalInputTokens += turn.inputTokens
    session.totalOutputTokens += turn.outputTokens
    session.totalCacheReadTokens += turn.cacheReadTokens
    session.totalCacheWriteTokens += turn.cacheWriteTokens

    const loc = session.locationBreakdown.find((e) => e.locationKey === turn.projectKey)
    if (loc) {
      loc.turnCount++
      loc.inputTokens += turn.inputTokens
      loc.outputTokens += turn.outputTokens
      loc.cacheReadTokens += turn.cacheReadTokens
      loc.cacheWriteTokens += turn.cacheWriteTokens
    } else {
      session.locationBreakdown.push({
        locationKey: turn.projectKey,
        projectLabel: turn.projectLabel,
        worktreeId: turn.worktreeId,
        turnCount: 1,
        inputTokens: turn.inputTokens,
        outputTokens: turn.outputTokens,
        cacheReadTokens: turn.cacheReadTokens,
        cacheWriteTokens: turn.cacheWriteTokens,
      })
    }

    const dailyKey = [turn.day, turn.model ?? 'unknown', turn.projectKey].join('::')
    const existing = dailyByKey.get(dailyKey)
    if (existing) {
      existing.turnCount++
      if (turn.cacheReadTokens === 0) existing.zeroCacheReadTurnCount++
      existing.inputTokens += turn.inputTokens
      existing.outputTokens += turn.outputTokens
      existing.cacheReadTokens += turn.cacheReadTokens
      existing.cacheWriteTokens += turn.cacheWriteTokens
    } else {
      dailyByKey.set(dailyKey, {
        day: turn.day,
        model: turn.model,
        projectKey: turn.projectKey,
        projectLabel: turn.projectLabel,
        worktreeId: turn.worktreeId,
        turnCount: 1,
        zeroCacheReadTurnCount: turn.cacheReadTokens === 0 ? 1 : 0,
        inputTokens: turn.inputTokens,
        outputTokens: turn.outputTokens,
        cacheReadTokens: turn.cacheReadTokens,
        cacheWriteTokens: turn.cacheWriteTokens,
      })
    }
  }

  const sessions = finalizeSessions(sessionsById)
  const dailyAggregates = [...dailyByKey.values()].sort((a, b) =>
    a.day === b.day ? a.projectLabel.localeCompare(b.projectLabel) : a.day.localeCompare(b.day)
  )

  return { sessions, dailyAggregates }
}

export function getSessionProjectLabel(breakdown: { projectLabel: string }[]): string {
  if (breakdown.length === 0) return USAGE_UNKNOWN_LOCATION_LABEL
  if (breakdown.length === 1) return breakdown[0].projectLabel
  return USAGE_MULTIPLE_LOCATIONS_LABEL
}
