import { describe, expect, it } from 'vitest'
import { MODELS } from '@/components/Center/ModelSelector'
import {
  DEFAULT_EFFORT,
  getEffortLevelsForModel,
  needsExtendedContextBeta,
  supportsExtendedContext,
} from '../constants'

describe('Claude model capabilities', () => {
  it('exposes Fable 5 in the chat model picker', () => {
    expect(MODELS).toContainEqual({ id: 'claude-fable-5', label: 'Fable 5' })
  })

  it('treats Fable 5 as native 1M context and effort capable', () => {
    expect(supportsExtendedContext('claude-fable-5')).toBe(true)
    expect(needsExtendedContextBeta('claude-fable-5')).toBe(false)
    expect(getEffortLevelsForModel('claude-fable-5')).toEqual(['low', 'medium', DEFAULT_EFFORT, 'max'])
  })
})
