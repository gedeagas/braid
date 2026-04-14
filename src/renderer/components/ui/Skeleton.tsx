import type { CSSProperties } from 'react'

type SkeletonElement =
  | { type: 'dot' }
  | { type: 'bar'; size?: 'sm' | 'md' | 'flex' | 'badge' | 'title' | 'state' | 'branch'; maxWidth?: number | string; width?: number | string }

interface SkeletonRowsProps {
  /** Number of skeleton rows */
  count: number
  /** Template applied to each row (all rows share the same shape) */
  template: SkeletonElement[]
  /** Per-row overrides for maxWidth on flex bars — allows visual variation */
  rowWidths?: Array<Record<number, number | string>>
}

/**
 * Generates shimmer loading rows from a declarative template.
 *
 * Renders bare `skeleton-row` divs (no wrapper) so they integrate directly
 * as children of the parent container (e.g. `checks-rows`).
 *
 * Replaces hand-coded `skeleton-row > skeleton-dot + skeleton-bar` patterns
 * found across ChecksSections, JiraSection, MentionAutocomplete, etc.
 */
export function SkeletonRows({ count, template, rowWidths }: SkeletonRowsProps) {
  return (
    <>
      {Array.from({ length: count }, (_, rowIdx) => (
        <div key={rowIdx} className="skeleton-row">
          {template.map((el, colIdx) => {
            if (el.type === 'dot') {
              return <span key={colIdx} className="skeleton-dot" />
            }
            const sizeClass = el.size ? `skeleton-bar--${el.size}` : ''
            const classes = ['skeleton-bar', sizeClass].filter(Boolean).join(' ')
            const override = rowWidths?.[rowIdx]?.[colIdx]
            const style: CSSProperties | undefined =
              override != null
                ? { maxWidth: override }
                : el.maxWidth != null || el.width != null
                  ? { maxWidth: el.maxWidth, width: el.width }
                  : undefined
            return <span key={colIdx} className={classes} style={style} />
          })}
        </div>
      ))}
    </>
  )
}
