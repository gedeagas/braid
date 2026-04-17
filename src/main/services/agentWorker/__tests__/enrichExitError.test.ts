import { describe, it, expect } from 'vitest'
import { enrichExitError } from '../core'

describe('enrichExitError', () => {
  // ── passthrough ────────────────────────────────────────────────────────────

  it('passes through messages that are not exit-code errors', () => {
    expect(enrichExitError('Network timeout', 'some stderr output')).toBe('Network timeout')
  })

  it('passes through exit-code errors when stderr buffer is empty', () => {
    expect(enrichExitError('Claude Code process exited with code 1', '')).toBe(
      'Claude Code process exited with code 1'
    )
  })

  it('passes through exit-code errors when stderr buffer is whitespace only', () => {
    expect(enrichExitError('Claude Code process exited with code 1', '  \n\n  ')).toBe(
      'Claude Code process exited with code 1'
    )
  })

  // ── enrichment ─────────────────────────────────────────────────────────────

  it('prepends stderr content to exit-code errors', () => {
    const result = enrichExitError(
      'Claude Code process exited with code 1',
      'invalid --effort value: xhigh'
    )
    expect(result).toBe('invalid --effort value: xhigh (Claude Code process exited with code 1)')
  })

  it('keeps only the last 3 lines of stderr', () => {
    const stderr = 'line1\nline2\nline3\nline4\nline5'
    const result = enrichExitError('Claude Code process exited with code 127', stderr)
    expect(result).toBe('line3\nline4\nline5 (Claude Code process exited with code 127)')
  })

  it('strips "Error:" prefix from each stderr line', () => {
    const stderr = 'Error: first\nError: second\nError: third'
    const result = enrichExitError('Claude Code process exited with code 1', stderr)
    expect(result).toBe('first\nsecond\nthird (Claude Code process exited with code 1)')
  })

  it('strips "Error:" prefix case-insensitively and with leading whitespace', () => {
    const stderr = '  error: indented\n\tERROR: tabbed\nError:   padded'
    const result = enrichExitError('Claude Code process exited with code 1', stderr)
    expect(result).toBe('indented\ntabbed\npadded (Claude Code process exited with code 1)')
  })

  // ── case sensitivity on the detection regex ────────────────────────────────

  it('matches "process exited with code" case-insensitively', () => {
    const result = enrichExitError(
      'Claude Code PROCESS EXITED WITH CODE 42',
      'subscriber limit reached'
    )
    expect(result).toBe('subscriber limit reached (Claude Code PROCESS EXITED WITH CODE 42)')
  })
})
