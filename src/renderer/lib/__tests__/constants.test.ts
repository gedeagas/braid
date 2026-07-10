import { describe, expect, it } from 'vitest'
import { MODELS } from '@/components/Center/ModelSelector'
import {
  DEFAULT_EFFORT,
  getEffortLevelsForModel,
  needsExtendedContextBeta,
  supportsExtendedContext,
} from '../constants'

describe('Claude model capabilities', () => {
  it('exposes current Claude models in the chat model picker', () => {
    expect(MODELS).toContainEqual({ id: 'claude-fable-5', label: 'Fable 5' })
    expect(MODELS).toContainEqual({ id: 'claude-opus-4-8', label: 'Opus 4.8' })
    expect(MODELS).toContainEqual({ id: 'claude-sonnet-5', label: 'Sonnet 5' })
  })

  it.each(['claude-fable-5', 'claude-opus-4-8', 'claude-sonnet-5'])(
    'treats %s as native 1M context and effort capable',
    (model) => {
      expect(supportsExtendedContext(model)).toBe(true)
      expect(needsExtendedContextBeta(model)).toBe(false)
      expect(getEffortLevelsForModel(model)).toEqual(['low', 'medium', DEFAULT_EFFORT, 'max'])
    },
  )

  it('keeps the 1M beta header for older Sonnet models', () => {
    expect(needsExtendedContextBeta('claude-sonnet-4-5')).toBe(true)
  })
})
