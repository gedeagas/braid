import { describe, it, expect } from 'vitest'
import {
  MAX_PROJECT_NAME_LENGTH,
  PROJECT_NAME_REGEX,
  isValidProjectName,
  validateProjectName,
} from '../projectName'

describe('validateProjectName', () => {
  it('accepts typical names', () => {
    expect(validateProjectName('my-app')).toBeNull()
    expect(validateProjectName('my_app')).toBeNull()
    expect(validateProjectName('next.js-blog')).toBeNull()
    expect(validateProjectName('a')).toBeNull()
    expect(validateProjectName('123abc')).toBeNull()
  })

  it('rejects empty strings', () => {
    expect(validateProjectName('')).toEqual({ reason: 'empty' })
  })

  it('rejects names exceeding the npm length cap', () => {
    const tooLong = 'a'.repeat(MAX_PROJECT_NAME_LENGTH + 1)
    expect(validateProjectName(tooLong)).toEqual({ reason: 'too-long' })
  })

  it('accepts names at the exact length cap', () => {
    const exact = 'a'.repeat(MAX_PROJECT_NAME_LENGTH)
    expect(validateProjectName(exact)).toBeNull()
  })

  it('rejects leading dot, underscore, hyphen with specific reasons', () => {
    expect(validateProjectName('.env')).toEqual({ reason: 'starts-with-dot' })
    expect(validateProjectName('_lodash')).toEqual({ reason: 'starts-with-underscore' })
    expect(validateProjectName('-next')).toEqual({ reason: 'starts-with-hyphen' })
  })

  it('reports spaces before other lint errors', () => {
    expect(validateProjectName('my app')).toEqual({ reason: 'has-space' })
    expect(validateProjectName('my\tapp')).toEqual({ reason: 'has-space' })
  })

  it('reports uppercase distinctly from other invalid chars', () => {
    expect(validateProjectName('MyApp')).toEqual({ reason: 'uppercase' })
    expect(validateProjectName('app-V2')).toEqual({ reason: 'uppercase' })
  })

  it('surfaces the first invalid char in `detail`', () => {
    expect(validateProjectName('my@app')).toEqual({ reason: 'invalid-chars', detail: '@' })
    expect(validateProjectName('my/app')).toEqual({ reason: 'invalid-chars', detail: '/' })
    expect(validateProjectName('café')).toEqual({ reason: 'invalid-chars', detail: 'é' })
  })

  it('rejects reserved names', () => {
    expect(validateProjectName('node_modules')).toEqual({ reason: 'reserved', detail: 'node_modules' })
    expect(validateProjectName('favicon.ico')).toEqual({ reason: 'reserved', detail: 'favicon.ico' })
  })

  it('accepts names that only differ from reserved by case-sensitivity (still caught by uppercase rule)', () => {
    // Node_Modules -> caught by uppercase *before* reserved check; that's fine.
    expect(validateProjectName('Node_Modules')).toEqual({ reason: 'uppercase' })
  })

  it('isValidProjectName is consistent with validateProjectName', () => {
    expect(isValidProjectName('my-app')).toBe(true)
    expect(isValidProjectName('MyApp')).toBe(false)
    expect(isValidProjectName('')).toBe(false)
  })

  it('PROJECT_NAME_REGEX accepts same set as validateProjectName (excluding reserved/length)', () => {
    // Spot check that the two agree on a handful of cases.
    const cases = ['ok', 'ok.2', 'ok-2', 'ok_2', '1up', 'a.b.c']
    for (const c of cases) {
      expect(PROJECT_NAME_REGEX.test(c)).toBe(true)
      expect(validateProjectName(c)).toBeNull()
    }
    for (const bad of ['Ok', '.a', '_a', '-a', 'a b', 'a/b']) {
      expect(PROJECT_NAME_REGEX.test(bad)).toBe(false)
      expect(validateProjectName(bad)).not.toBeNull()
    }
  })
})
