import { describe, it, expect, beforeEach } from 'vitest'
import { RendererBudget } from '../delivery/rendererBudget'

const limits = { perTerminal: 100, total: 300, interactivePerTerminal: 100, interactiveTotal: 50 }

describe('RendererBudget (Stage A)', () => {
  let budget: RendererBudget
  beforeEach(() => { budget = new RendererBudget(limits) })

  it('tracks unacknowledged output as sent minus processed', () => {
    budget.onSent('a', 80)
    expect(budget.unacked('a')).toBe(80)
    budget.ack('a', 30)
    expect(budget.unacked('a')).toBe(50)
  })

  it('stops a terminal at its own limit', () => {
    budget.onSent('a', 99)
    expect(budget.canSend('a')).toBe(true)
    budget.onSent('a', 1)
    expect(budget.canSend('a')).toBe(false)
    budget.ack('a', 50)
    expect(budget.canSend('a')).toBe(true)
  })

  it('stops every terminal at the total limit', () => {
    budget.onSent('a', 99)
    budget.onSent('b', 99)
    budget.onSent('c', 99)
    expect(budget.canSend('d')).toBe(true) // 297 < 300
    budget.onSent('c', 3)
    expect(budget.canSend('d')).toBe(false)
  })

  it('gives the terminal the user interacts with extra room on top of both limits', () => {
    budget.onSent('a', 99)
    budget.onSent('b', 99)
    budget.onSent('c', 102) // total 300: others are stopped
    expect(budget.canSend('d')).toBe(false)
    expect(budget.canSend('d', true)).toBe(true) // total limit 300 + 50
    budget.onSent('d', 50)
    expect(budget.canSend('d', true)).toBe(false)
    // Its own limit grows too: 100 + 100.
    const solo = new RendererBudget(limits)
    solo.onSent('x', 150)
    expect(solo.canSend('x')).toBe(false)
    expect(solo.canSend('x', true)).toBe(true)
    solo.onSent('x', 50)
    expect(solo.canSend('x', true)).toBe(false)
  })

  it('only accepts a running total higher than the last one', () => {
    budget.onSent('a', 100)
    expect(budget.ack('a', 60)).toBe(true)
    expect(budget.ack('a', 60)).toBe(false)
    expect(budget.ack('a', 40)).toBe(false)
    expect(budget.unacked('a')).toBe(40)
    expect(budget.ack('a', 70)).toBe(true)
    expect(budget.unacked('a')).toBe(30)
  })

  it('clamps a running total to what was sent', () => {
    budget.onSent('a', 10)
    budget.ack('a', 50)
    expect(budget.unacked('a')).toBe(0)
    expect(budget.totalUnacked()).toBe(0)
    // Later output is still counted: the clamp did not bank 40 chars of credit.
    budget.onSent('a', 30)
    expect(budget.unacked('a')).toBe(30)
  })

  it('ignores non-finite or negative totals', () => {
    budget.onSent('a', 10)
    expect(budget.ack('a', Number.NaN)).toBe(false)
    expect(budget.ack('a', -5)).toBe(false)
    expect(budget.unacked('a')).toBe(10)
  })

  it('resets every count (renderer reload)', () => {
    budget.onSent('a', 100)
    budget.ack('a', 20)
    budget.reset()
    expect(budget.unacked('a')).toBe(0)
    expect(budget.totalUnacked()).toBe(0)
    // A fresh renderer starts its running totals at 0 again.
    budget.onSent('a', 10)
    expect(budget.ack('a', 5)).toBe(true)
    expect(budget.unacked('a')).toBe(5)
  })

  it('leaves uncounted terminals out of the total', () => {
    budget.onSent('a', 90)
    budget.onSent('b', 90)
    expect(budget.totalUnacked()).toBe(180)
    budget.setCounted('a', false)
    expect(budget.totalUnacked()).toBe(90)
    budget.setCounted('a', true)
    expect(budget.totalUnacked()).toBe(180)
  })

  it('forgets a removed terminal', () => {
    budget.onSent('a', 90)
    budget.remove('a')
    expect(budget.totalUnacked()).toBe(0)
    expect(budget.unacked('a')).toBe(0)
  })
})
