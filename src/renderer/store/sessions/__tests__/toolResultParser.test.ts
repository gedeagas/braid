import { describe, it, expect } from 'vitest'
import { extractToolResultPatches } from '../handlers/toolResultParser'

describe('extractToolResultPatches', () => {
  // ── empty / no-op ─────────────────────────────────────────────────────────

  it('returns empty array for empty content', () => {
    expect(extractToolResultPatches([])).toEqual([])
  })

  it('ignores non-tool_result blocks', () => {
    const content = [
      { type: 'text', text: 'hello' },
      { type: 'tool_use', id: 'tc-1', name: 'Bash' }
    ]
    expect(extractToolResultPatches(content)).toEqual([])
  })

  it('ignores tool_result blocks missing tool_use_id', () => {
    const content = [{ type: 'tool_result', content: 'output' }]
    expect(extractToolResultPatches(content)).toEqual([])
  })

  // ── string content ────────────────────────────────────────────────────────

  it('extracts result when content is a plain string', () => {
    const content = [{ type: 'tool_result', tool_use_id: 'tc-1', content: 'output text' }]
    expect(extractToolResultPatches(content)).toEqual([{ toolUseId: 'tc-1', result: 'output text' }])
  })

  it('extracts empty string result when content is empty string', () => {
    const content = [{ type: 'tool_result', tool_use_id: 'tc-1', content: '' }]
    expect(extractToolResultPatches(content)).toEqual([{ toolUseId: 'tc-1', result: '' }])
  })

  // ── array content ─────────────────────────────────────────────────────────

  it('joins text blocks from array content', () => {
    const content = [{
      type: 'tool_result',
      tool_use_id: 'tc-2',
      content: [{ type: 'text', text: 'line1' }, { type: 'text', text: 'line2' }]
    }]
    expect(extractToolResultPatches(content)).toEqual([{ toolUseId: 'tc-2', result: 'line1line2' }])
  })

  it('skips non-text blocks within array content', () => {
    const content = [{
      type: 'tool_result',
      tool_use_id: 'tc-3',
      content: [{ type: 'image', data: 'base64' }, { type: 'text', text: 'result' }]
    }]
    expect(extractToolResultPatches(content)).toEqual([{ toolUseId: 'tc-3', result: 'result' }])
  })

  it('returns empty result for empty array content', () => {
    const content = [{ type: 'tool_result', tool_use_id: 'tc-4', content: [] }]
    expect(extractToolResultPatches(content)).toEqual([{ toolUseId: 'tc-4', result: '' }])
  })

  it('skips null and non-object elements in array content without throwing', () => {
    const content = [{
      type: 'tool_result',
      tool_use_id: 'tc-null',
      content: [null, undefined, 42, 'raw string', { type: 'text', text: 'valid' }]
    }]
    expect(extractToolResultPatches(content)).toEqual([{ toolUseId: 'tc-null', result: 'valid' }])
  })

  it('treats non-string text field as empty string without producing "null"', () => {
    const content = [{
      type: 'tool_result',
      tool_use_id: 'tc-badtext',
      content: [{ type: 'text', text: null }, { type: 'text', text: 'real' }]
    }]
    const result = extractToolResultPatches(content)[0].result ?? ''
    expect(result).not.toContain('null')
    expect(result).toBe('real')
  })

  // ── error flag ────────────────────────────────────────────────────────────

  it('maps is_error: true to error field', () => {
    const content = [{ type: 'tool_result', tool_use_id: 'tc-5', is_error: true, content: 'Command failed' }]
    expect(extractToolResultPatches(content)).toEqual([{ toolUseId: 'tc-5', error: 'Command failed' }])
  })

  it('defaults error text to "Tool execution failed" when content is empty and is_error', () => {
    const content = [{ type: 'tool_result', tool_use_id: 'tc-6', is_error: true, content: '' }]
    expect(extractToolResultPatches(content)).toEqual([{ toolUseId: 'tc-6', error: 'Tool execution failed' }])
  })

  it('uses result field when is_error is false', () => {
    const content = [{ type: 'tool_result', tool_use_id: 'tc-7', is_error: false, content: 'ok' }]
    expect(extractToolResultPatches(content)).toEqual([{ toolUseId: 'tc-7', result: 'ok' }])
  })

  it('uses result field when is_error is absent', () => {
    const content = [{ type: 'tool_result', tool_use_id: 'tc-8', content: 'ok' }]
    expect(extractToolResultPatches(content)).toEqual([{ toolUseId: 'tc-8', result: 'ok' }])
  })

  // ── multiple patches ──────────────────────────────────────────────────────

  it('extracts multiple patches in order', () => {
    const content = [
      { type: 'tool_result', tool_use_id: 'tc-a', content: 'result-a' },
      { type: 'text', text: 'ignored' },
      { type: 'tool_result', tool_use_id: 'tc-b', is_error: true, content: 'err-b' }
    ]
    expect(extractToolResultPatches(content)).toEqual([
      { toolUseId: 'tc-a', result: 'result-a' },
      { toolUseId: 'tc-b', error: 'err-b' }
    ])
  })
})
