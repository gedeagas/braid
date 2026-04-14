import { describe, it, expect } from 'vitest'
import type { AgentSession } from '@/types'
import { buildResumedSessionState } from '../handlers/userInputActions'

// ---------------------------------------------------------------------------
// Fixture factory
// ---------------------------------------------------------------------------

function makeSession(overrides?: Partial<AgentSession>): AgentSession {
  return {
    id: 'sess-1',
    worktreeId: 'wt-1',
    name: 'Test',
    customName: false,
    status: 'waiting_input',
    model: 'claude-sonnet-4-6',
    thinkingEnabled: true,
    planModeEnabled: false,
    messages: [],
    activity: 'Waiting...',
    runStartedAt: 1000,
    runCompletedAt: null,
    totalRunDurationMs: 0,
    tokenUsage: null, contextTokens: null,
    createdAt: 1000,
    ...overrides
  }
}

// ---------------------------------------------------------------------------
// buildResumedSessionState
// ---------------------------------------------------------------------------

describe('buildResumedSessionState', () => {
  // ── required fields ────────────────────────────────────────────────────────

  it('sets status to "running"', () => {
    const result = buildResumedSessionState(makeSession())
    expect(result.status).toBe('running')
  })

  it('sets runCompletedAt to null', () => {
    const result = buildResumedSessionState(makeSession({ runCompletedAt: 5000 }))
    expect(result.runCompletedAt).toBeNull()
  })

  it('sets runStartedAt to a recent timestamp', () => {
    const before = Date.now()
    const result = buildResumedSessionState(makeSession())
    const after = Date.now()
    expect(result.runStartedAt).toBeGreaterThanOrEqual(before)
    expect(result.runStartedAt).toBeLessThanOrEqual(after)
  })

  it('sets activity to a non-empty string', () => {
    const result = buildResumedSessionState(makeSession())
    expect(typeof result.activity).toBe('string')
    expect((result.activity as string).length).toBeGreaterThan(0)
  })

  // ── pending state clearing ─────────────────────────────────────────────────

  it('clears pendingQuestion', () => {
    const session = makeSession({
      pendingQuestion: { toolUseId: 'tu-1', questions: [] }
    })
    const result = buildResumedSessionState(session)
    expect(result.pendingQuestion).toBeUndefined()
  })

  it('clears pendingPlanApproval', () => {
    const session = makeSession({
      pendingPlanApproval: { toolUseId: 'tu-2' }
    })
    const result = buildResumedSessionState(session)
    expect(result.pendingPlanApproval).toBeUndefined()
  })

  it('clears pendingToolPermission', () => {
    const session = makeSession({
      pendingToolPermission: { toolUseId: 'tu-3', toolName: 'Bash', toolInput: {} }
    })
    const result = buildResumedSessionState(session)
    expect(result.pendingToolPermission).toBeUndefined()
  })

  // ── overrides ─────────────────────────────────────────────────────────────

  it('applies overrides on top of the base resumed state', () => {
    const result = buildResumedSessionState(makeSession(), { planModeEnabled: false })
    expect(result.planModeEnabled).toBe(false)
  })

  it('override can re-enable planMode (approvePlan → false, rejectPlan → true)', () => {
    const resultApprove = buildResumedSessionState(makeSession(), { planModeEnabled: false })
    const resultReject = buildResumedSessionState(makeSession(), { planModeEnabled: true })
    expect(resultApprove.planModeEnabled).toBe(false)
    expect(resultReject.planModeEnabled).toBe(true)
  })

  it('override can set any AgentSession field', () => {
    const result = buildResumedSessionState(makeSession(), { name: 'Custom Name' })
    expect(result.name).toBe('Custom Name')
  })

  // ── immutability ─────────────────────────────────────────────────────────

  it('does not mutate the input session', () => {
    const session = makeSession({ status: 'waiting_input', runStartedAt: 100 })
    const copy = { ...session }
    buildResumedSessionState(session, { planModeEnabled: true })
    expect(session).toEqual(copy)
  })

  it('returns a new object each call', () => {
    const session = makeSession()
    const r1 = buildResumedSessionState(session)
    const r2 = buildResumedSessionState(session)
    expect(r1).not.toBe(r2)
  })

  // ── always clears pending fields regardless of overrides ─────────────────

  it('does not allow override to re-set pendingQuestion via overrides object', () => {
    // overrides object does not include pendingQuestion → it stays undefined
    const session = makeSession({ pendingQuestion: { toolUseId: 'tu-1', questions: [] } })
    const result = buildResumedSessionState(session, {})
    expect(result.pendingQuestion).toBeUndefined()
  })
})
