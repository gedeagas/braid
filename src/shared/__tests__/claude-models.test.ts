import { describe, it, expect } from 'vitest'
import {
  CLAUDE_MODELS,
  apiDefaultEffort,
  canDisableThinking,
  effortToSend,
  isClaudeModelId,
  modelLabel,
} from '../claude-models'

describe('CLAUDE_MODELS', () => {
  it('lists the current generation first', () => {
    expect(CLAUDE_MODELS.slice(0, 4).map((m) => m.id)).toEqual([
      'claude-fable-5-1', 'claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5',
    ])
  })

  it('has unique ids, without date suffixes on current models', () => {
    const ids = CLAUDE_MODELS.map((m) => m.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(isClaudeModelId('claude-opus-5-5')).toBe(true)
    expect(isClaudeModelId('claude-opus-5-5-20260401')).toBe(false)
  })
})

describe('modelLabel', () => {
  it('labels raw API model ids, preferring the most specific match', () => {
    expect(modelLabel('claude-opus-5-5')).toBe('Opus 5.5')
    expect(modelLabel('claude-opus-5')).toBe('Opus 5')
    expect(modelLabel('claude-fable-5-1')).toBe('Fable 5.1')
    expect(modelLabel('claude-fable-5')).toBe('Fable 5')
    expect(modelLabel('claude-sonnet-5-5')).toBe('Sonnet 5.5')
    expect(modelLabel('claude-haiku-4-5')).toBe('Haiku 4.5')
    expect(modelLabel('claude-haiku-4-5-20251001')).toBe('Haiku 4.5')
    expect(modelLabel('something-else')).toBeNull()
  })
})

describe('canDisableThinking', () => {
  it('never disables thinking on models that reject it', () => {
    for (const m of ['claude-fable-5-1', 'claude-fable-5', 'claude-opus-5-5', 'claude-sonnet-5-5']) {
      expect(canDisableThinking(m, 'low')).toBe(false)
    }
  })

  it('allows it on Opus 5 and Haiku 5.5 only at high effort or below', () => {
    expect(canDisableThinking('claude-opus-5', 'high')).toBe(true)
    expect(canDisableThinking('claude-opus-5', 'max')).toBe(false)
    expect(canDisableThinking('claude-haiku-5-5', 'medium')).toBe(true)
    expect(canDisableThinking('claude-haiku-5-5', 'max')).toBe(false)
  })

  it('allows it on older models', () => {
    expect(canDisableThinking('claude-opus-4-8', 'max')).toBe(true)
    expect(canDisableThinking('claude-sonnet-4-6', 'high')).toBe(true)
    expect(canDisableThinking('claude-haiku-4-5-20251001', 'high')).toBe(true)
  })
})

describe('effort', () => {
  it('knows which models default to medium', () => {
    expect(apiDefaultEffort('claude-opus-5-5')).toBe('medium')
    expect(apiDefaultEffort('claude-haiku-5-5')).toBe('medium')
    expect(apiDefaultEffort('claude-sonnet-5-5')).toBe('high')
  })

  it('sends the effort explicitly whenever it differs from the API default', () => {
    expect(effortToSend('claude-opus-5-5', 'high')).toBe('high')
    expect(effortToSend('claude-opus-5-5', 'medium')).toBeUndefined()
    expect(effortToSend('claude-sonnet-5-5', 'high')).toBeUndefined()
    expect(effortToSend('claude-sonnet-5-5', 'low')).toBe('low')
    expect(effortToSend('claude-sonnet-5-5', '')).toBeUndefined()
  })
})
