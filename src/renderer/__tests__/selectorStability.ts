// ---------------------------------------------------------------------------
// Selector stability assertion for Zustand useShallow
// ---------------------------------------------------------------------------
//
// useShallow(selector) prevents re-renders by comparing the previous and
// current selector results with `shallow()` from zustand/shallow.
//
// If a selector returns a new reference every call for the SAME store state
// (e.g. `new Set(...)`, `.map(() => ({...}))`), `shallow()` will consider
// them different → forceStoreRerender → new reference → infinite loop
// (React error #185: "Maximum update depth exceeded").
//
// This utility catches that class of bug at test time by invoking a selector
// twice on the same state and asserting shallow equality of the results.
// ---------------------------------------------------------------------------

import { shallow } from 'zustand/shallow'

/**
 * Asserts that a selector produces a result which passes zustand's `shallow()`
 * equality check when called twice with identical state.
 *
 * A selector that fails this check will cause an infinite re-render loop when
 * wrapped in `useShallow()`.
 *
 * @example
 * ```ts
 * const state = { projects: [{ path: '/a' }] }
 *
 * // ✓ Stable — returns the same array reference
 * assertSelectorStable(state, (s) => s.projects)
 *
 * // ✗ Unstable — .map() creates new objects, shallow compares by reference
 * assertSelectorStable(state, (s) => s.projects.map(p => ({ name: p.name })))
 * ```
 */
export function assertSelectorStable<S, R>(
  state: S,
  selector: (s: S) => R,
  description?: string,
): void {
  const a = selector(state)
  const b = selector(state)
  const stable = shallow(a, b)
  if (!stable) {
    const label = description ? ` "${description}"` : ''
    throw new Error(
      `Selector${label} is unstable: calling it twice with the same state ` +
        `produces values that fail shallow equality.\n` +
        `This WILL cause an infinite re-render loop when used with useShallow().\n\n` +
        `Fix: return stable references (primitives, store refs), or derive ` +
        `complex objects outside the selector via useMemo.`,
    )
  }
}
