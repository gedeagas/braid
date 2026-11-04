import { describe, it, expect } from 'vitest'
import { recordVisit, updateHistoryTitle, rankSuggestions, MAX_HISTORY_ENTRIES, type HistoryEntry } from '../history'

const NOW = 1_700_000_000_000
const DAY = 86_400_000

function entry(url: string, partial: Partial<HistoryEntry> = {}): HistoryEntry {
  return { url, title: '', visitCount: 1, lastVisit: NOW, ...partial }
}

describe('recordVisit', () => {
  it('adds a new entry at the front', () => {
    const next = recordVisit([entry('https://a.com/')], 'https://b.com/', 'B', NOW)
    expect(next.map((e) => e.url)).toEqual(['https://b.com/', 'https://a.com/'])
    expect(next[0]).toEqual({ url: 'https://b.com/', title: 'B', visitCount: 1, lastVisit: NOW })
  })

  it('bumps an existing entry and moves it to the front', () => {
    const next = recordVisit([entry('https://a.com/'), entry('https://b.com/', { title: 'Old', visitCount: 3 })], 'https://b.com/', '', NOW + 5)
    expect(next[0]).toEqual({ url: 'https://b.com/', title: 'Old', visitCount: 4, lastVisit: NOW + 5 })
    expect(next).toHaveLength(2)
  })

  it('ignores about:blank and non-browsable URLs', () => {
    const list = [entry('https://a.com/')]
    expect(recordVisit(list, 'about:blank', '', NOW)).toBe(list)
    expect(recordVisit(list, 'devtools://x', '', NOW)).toBe(list)
  })

  it('caps the list size', () => {
    const many = Array.from({ length: MAX_HISTORY_ENTRIES }, (_, i) => entry(`https://s${i}.com/`))
    const next = recordVisit(many, 'https://new.com/', '', NOW)
    expect(next).toHaveLength(MAX_HISTORY_ENTRIES)
    expect(next[0].url).toBe('https://new.com/')
  })
})

describe('updateHistoryTitle', () => {
  it('sets the title of a known URL', () => {
    const next = updateHistoryTitle([entry('https://a.com/')], 'https://a.com/', 'A')
    expect(next[0].title).toBe('A')
  })

  it('returns the same array when nothing changes', () => {
    const list = [entry('https://a.com/', { title: 'A' })]
    expect(updateHistoryTitle(list, 'https://a.com/', 'A')).toBe(list)
    expect(updateHistoryTitle(list, 'https://zzz.com/', 'Z')).toBe(list)
  })
})

describe('rankSuggestions', () => {
  it('returns nothing for an empty query', () => {
    expect(rankSuggestions([entry('https://a.com/')], '', NOW)).toEqual([])
  })

  it('prefers host prefix matches', () => {
    const list = [
      entry('https://example.com/localhost-guide', { title: 'Guide' }),
      entry('http://localhost:3000/', { title: 'Dev' }),
    ]
    expect(rankSuggestions(list, 'local', NOW).map((s) => s.url)[0]).toBe('http://localhost:3000/')
  })

  it('matches titles and fuzzy subsequences', () => {
    const list = [entry('https://github.com/pulls', { title: 'Pull requests' }), entry('https://news.ycombinator.com/')]
    expect(rankSuggestions(list, 'pull req', NOW).map((s) => s.url)).toEqual(['https://github.com/pulls'])
    expect(rankSuggestions(list, 'ycmb', NOW).map((s) => s.url)).toEqual(['https://news.ycombinator.com/'])
  })

  it('breaks ties by frecency', () => {
    const list = [
      entry('https://docs.a.com/', { visitCount: 1, lastVisit: NOW - 30 * DAY }),
      entry('https://docs.b.com/', { visitCount: 10, lastVisit: NOW }),
    ]
    expect(rankSuggestions(list, 'docs', NOW).map((s) => s.url)).toEqual(['https://docs.b.com/', 'https://docs.a.com/'])
  })

  it('respects the limit', () => {
    const list = Array.from({ length: 20 }, (_, i) => entry(`https://site${i}.com/`))
    expect(rankSuggestions(list, 'site', NOW, 5)).toHaveLength(5)
  })
})
