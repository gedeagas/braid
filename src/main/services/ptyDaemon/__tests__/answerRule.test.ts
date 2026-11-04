import { describe, it, expect } from 'vitest'
import { AnswerRule } from '../headless/answerRule'

// Who answers each live chunk's terminal queries, by seq: the daemon, or the
// renderer that received the chunk. Exactly one of them, however late the
// daemon parses it.

describe('AnswerRule', () => {
  it('answers everything while hidden', () => {
    const r = new AnswerRule()
    expect(r.daemonAnswers(1)).toBe(true)
    expect(r.daemonAnswers(99)).toBe(true)
  })

  it('leaves output after the show point to the renderer, even when parsed late', () => {
    const r = new AnswerRule()
    expect(r.show(5)).toBe(5)
    expect(r.daemonAnswers(5)).toBe(true) // numbered while hidden
    expect(r.daemonAnswers(6)).toBe(false)
  })

  it('takes output back after the last chunk main delivered before hiding', () => {
    const r = new AnswerRule()
    r.show(5)
    r.hide(8)
    expect(r.daemonAnswers(7)).toBe(false) // the renderer parsed it
    expect(r.daemonAnswers(9)).toBe(true) // never delivered
  })

  it('answers everything of a visible period while a snapshot is pending, and the renderer owns what follows it', () => {
    const r = new AnswerRule()
    r.show(5)
    const h = r.beginHandoff()!
    expect(r.daemonAnswers(7)).toBe(true)
    r.endHandoff(h, 10)
    expect(r.daemonAnswers(10)).toBe(true) // covered by the snapshot
    expect(r.daemonAnswers(11)).toBe(false)
  })

  it('a hide during a pending snapshot gives the whole period back', () => {
    const r = new AnswerRule()
    r.show(5)
    const h = r.beginHandoff()!
    r.hide(9)
    r.endHandoff(h, 12) // the capture of a period that ended: no effect
    expect(r.daemonAnswers(7)).toBe(true)
    expect(r.daemonAnswers(13)).toBe(true)
  })

  it('keeps earlier periods for output still waiting to be parsed, and drops them once parsed', () => {
    const r = new AnswerRule()
    r.show(1)
    r.hide(4)
    r.show(8)
    expect(r.daemonAnswers(3)).toBe(false)
    expect(r.daemonAnswers(6)).toBe(true)
    expect(r.daemonAnswers(9)).toBe(false)
    r.prune(5)
    expect(r.periodCount).toBe(1)
  })

  it('showing twice keeps the first show point', () => {
    const r = new AnswerRule()
    r.show(3)
    expect(r.show(7)).toBe(3)
    expect(r.daemonAnswers(5)).toBe(false)
  })
})
