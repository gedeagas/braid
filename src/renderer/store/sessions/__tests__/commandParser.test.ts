import { describe, it, expect } from 'vitest'
import { parseRawCommands, parseRichCommands, parseLegacyCommands } from '../handlers/commandParser'

describe('parseRawCommands', () => {
  it('returns empty array for empty input', () => {
    expect(parseRawCommands([])).toEqual([])
  })

  it('maps name and sets empty description + undefined argumentHint', () => {
    const result = parseRawCommands([{ name: 'commit', source: 'builtin' }])
    expect(result).toEqual([{ name: 'commit', description: '', argumentHint: undefined, source: 'builtin' }])
  })

  it('defaults source to builtin when missing', () => {
    const result = parseRawCommands([{ name: 'test' }])
    expect(result[0].source).toBe('builtin')
  })

  it('preserves skill source', () => {
    const result = parseRawCommands([{ name: 'deploy', source: 'skill' }])
    expect(result[0].source).toBe('skill')
  })

  it('maps multiple commands correctly', () => {
    const result = parseRawCommands([
      { name: 'a', source: 'builtin' },
      { name: 'b', source: 'skill' }
    ])
    expect(result).toHaveLength(2)
    expect(result[0].name).toBe('a')
    expect(result[1].name).toBe('b')
  })
})

describe('parseRichCommands', () => {
  it('returns empty array for empty input', () => {
    expect(parseRichCommands([])).toEqual([])
  })

  it('preserves name, description, argumentHint, source', () => {
    const result = parseRichCommands([
      { name: 'commit', description: 'Create a commit', argumentHint: '-m <msg>', source: 'builtin' }
    ])
    expect(result).toEqual([
      { name: 'commit', description: 'Create a commit', argumentHint: '-m <msg>', source: 'builtin' }
    ])
  })

  it('defaults description to empty string when missing', () => {
    const result = parseRichCommands([{ name: 'foo' }])
    expect(result[0].description).toBe('')
  })

  it('passes through undefined argumentHint', () => {
    const result = parseRichCommands([{ name: 'foo', description: 'bar' }])
    expect(result[0].argumentHint).toBeUndefined()
  })

  it('defaults source to builtin when missing', () => {
    const result = parseRichCommands([{ name: 'foo' }])
    expect(result[0].source).toBe('builtin')
  })

  it('preserves skill source', () => {
    const result = parseRichCommands([{ name: 'deploy', description: 'Deploy app', source: 'skill' }])
    expect(result[0].source).toBe('skill')
  })
})

describe('parseLegacyCommands', () => {
  it('returns empty array when both lists are empty', () => {
    expect(parseLegacyCommands([], [])).toEqual([])
  })

  it('tags builtins with source: builtin', () => {
    const result = parseLegacyCommands(['commit', 'test'], [])
    expect(result.every((c) => c.source === 'builtin')).toBe(true)
  })

  it('tags skills with source: skill', () => {
    const result = parseLegacyCommands([], ['deploy', 'review'])
    expect(result.every((c) => c.source === 'skill')).toBe(true)
  })

  it('puts builtins before skills', () => {
    const result = parseLegacyCommands(['a'], ['b'])
    expect(result[0].name).toBe('a')
    expect(result[0].source).toBe('builtin')
    expect(result[1].name).toBe('b')
    expect(result[1].source).toBe('skill')
  })

  it('sets empty description and undefined argumentHint for all', () => {
    const result = parseLegacyCommands(['x'], ['y'])
    for (const cmd of result) {
      expect(cmd.description).toBe('')
      expect(cmd.argumentHint).toBeUndefined()
    }
  })

  it('handles only builtins', () => {
    const result = parseLegacyCommands(['a', 'b', 'c'], [])
    expect(result).toHaveLength(3)
    expect(result.map((c) => c.name)).toEqual(['a', 'b', 'c'])
  })

  it('handles only skills', () => {
    const result = parseLegacyCommands([], ['x', 'y'])
    expect(result).toHaveLength(2)
    expect(result.map((c) => c.name)).toEqual(['x', 'y'])
  })
})
