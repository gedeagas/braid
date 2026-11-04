// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { MIN_ICON_SIZE } from '@/components/shared/icons/types'

/**
 * Static guards for readability regressions. These scan source rather than
 * rendered output so they run fast and catch problems at review time.
 */

const RENDERER = resolve(__dirname, '../..')

function walk(dir: string, exts: string[], out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === '__tests__' || name === 'node_modules') continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, exts, out)
    else if (exts.some((e) => name.endsWith(e))) out.push(full)
  }
  return out
}

function findMatches(files: string[], re: RegExp, allow?: RegExp): string[] {
  const hits: string[] = []
  for (const file of files) {
    readFileSync(file, 'utf8')
      .split('\n')
      .forEach((line, i) => {
        if (re.test(line) && !(allow && allow.test(line))) hits.push(`${relative(RENDERER, file)}:${i + 1}: ${line.trim()}`)
      })
  }
  return hits
}

describe('sizing guards', () => {
  it(`icons are never smaller than ${MIN_ICON_SIZE}px`, () => {
    const files = walk(join(RENDERER, 'components'), ['.tsx', '.ts'])
    const sizes = new RegExp(`\\bsize(?:=\\{| = )(\\d+)\\b`)
    const hits = findMatches(files, sizes).filter((h) => Number(sizes.exec(h)?.[1]) < MIN_ICON_SIZE)
    expect(hits).toEqual([])
  })

  it('stylesheets use font-size tokens instead of hardcoded px', () => {
    const files = walk(join(RENDERER, 'styles'), ['.css'])
    const hits = findMatches(files, /font-size:\s*[\d.]+px/, /intentionally below the UI type floor/)
    expect(hits).toEqual([])
  })
})
