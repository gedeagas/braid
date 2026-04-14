import { useRef, useEffect, type ReactNode } from 'react'
import { useShallow } from 'zustand/shallow'
import { useSessionsStore } from '@/store/sessions'
import type { SlashCommand } from '@/types'
import { IconSparkle } from '@/components/shared/icons'

const EMPTY_COMMANDS: SlashCommand[] = []

// ─── Fuzzy / ranked filter ──────────────────────────────────────────────────

function fuzzyMatch(text: string, pattern: string): number[] | null {
  const indices: number[] = []
  let j = 0
  for (let i = 0; i < text.length && j < pattern.length; i++) {
    if (text[i] === pattern[j]) { indices.push(i); j++ }
  }
  return j === pattern.length ? indices : null
}

/**
 * Filter and rank slash commands against a search string.
 * Priority: exact > prefix > word-boundary > substring > fuzzy > description.
 */
export function filterSlashCommands(commands: SlashCommand[], filter: string): SlashCommand[] {
  if (!filter) return commands
  const lower = filter.toLowerCase()

  interface Scored { cmd: SlashCommand; score: number }
  const results: Scored[] = []

  for (const cmd of commands) {
    const name = cmd.name.toLowerCase()
    const desc = (cmd.description ?? '').toLowerCase()

    if (name === lower) {
      results.push({ cmd, score: 110 })
    } else if (name.startsWith(lower)) {
      results.push({ cmd, score: 100 })
    } else if (name.split(/[-:.]/).some((seg) => seg.startsWith(lower))) {
      results.push({ cmd, score: 80 })
    } else if (name.includes(lower)) {
      results.push({ cmd, score: 60 })
    } else if (fuzzyMatch(name, lower)) {
      results.push({ cmd, score: 40 })
    } else if (desc.includes(lower)) {
      results.push({ cmd, score: 20 })
    }
  }

  results.sort((a, b) => b.score - a.score)
  return results.map((r) => r.cmd)
}

// ─── Highlight helpers ──────────────────────────────────────────────────────

function highlightText(text: string, filter: string): ReactNode {
  if (!filter) return <>{text}</>
  const lower = filter.toLowerCase()
  const textLower = text.toLowerCase()

  // Contiguous substring match
  const idx = textLower.indexOf(lower)
  if (idx !== -1) {
    return (
      <>
        {text.slice(0, idx)}
        <span className="slash-item-match">{text.slice(idx, idx + filter.length)}</span>
        {text.slice(idx + filter.length)}
      </>
    )
  }

  // Fuzzy character match
  const indices = fuzzyMatch(textLower, lower)
  if (indices) {
    const parts: ReactNode[] = []
    let last = 0
    for (const i of indices) {
      if (i > last) parts.push(text.slice(last, i))
      parts.push(<span key={i} className="slash-item-match">{text[i]}</span>)
      last = i + 1
    }
    if (last < text.length) parts.push(text.slice(last))
    return <>{parts}</>
  }

  return <>{text}</>
}

// ─── Types ──────────────────────────────────────────────────────────────────

interface Props {
  filter: string
  selectedIndex: number
  onSelect: (command: string) => void
}

interface GroupProps {
  label: string
  icon: ReactNode
  commands: Array<{ cmd: SlashCommand; globalIndex: number }>
  filter: string
  selectedIndex: number
  itemRefs: React.MutableRefObject<(HTMLDivElement | null)[]>
  onSelect: (command: string) => void
}

function CommandGroup({ label, icon, commands, filter, selectedIndex, itemRefs, onSelect }: GroupProps) {
  if (commands.length === 0) return null
  return (
    <div className="slash-group">
      <div className="slash-group-header">
        <span className="slash-group-icon">{icon}</span>
        <span className="slash-group-label">{label}</span>
      </div>
      {commands.map(({ cmd, globalIndex }) => {
        const isSelected = globalIndex === selectedIndex
        const hasDesc = cmd.description && cmd.description.length > 0
        const hasHint = cmd.argumentHint && cmd.argumentHint.length > 0
        return (
          <div
            key={cmd.name}
            ref={(el) => { itemRefs.current[globalIndex] = el }}
            className={`slash-item${isSelected ? ' selected' : ''}`}
            onMouseDown={(e) => { e.preventDefault(); onSelect(cmd.name) }}
          >
            <div className="slash-item-header">
              <span className="slash-item-name">
                /{highlightText(cmd.name, filter)}
              </span>
              {hasHint && (
                <span className="slash-item-hint">{cmd.argumentHint}</span>
              )}
            </div>
            {hasDesc && (
              <span className="slash-item-desc">{highlightText(cmd.description!, filter)}</span>
            )}
          </div>
        )
      })}
    </div>
  )
}

export function SlashAutocomplete({ filter, selectedIndex, onSelect }: Props) {
  const slashCommands = useSessionsStore(
    useShallow((s) => s.activeSessionId ? (s.sessions[s.activeSessionId]?.slashCommands ?? EMPTY_COMMANDS) : EMPTY_COMMANDS)
  )
  const listRef = useRef<HTMLDivElement>(null)
  const itemRefs = useRef<(HTMLDivElement | null)[]>([])

  const filtered = filterSlashCommands(slashCommands, filter)

  // Auto-scroll selected item into view when selection or filter changes.
  // selectedIndex alone is insufficient: the parent resets it to 0 on every
  // keystroke, so consecutive filter changes (e.g. /c -> /co) keep it at 0
  // and the effect wouldn't re-fire. Adding `filter` as a dependency ensures
  // we scroll to the top whenever the result set reorders.
  useEffect(() => {
    if (selectedIndex === 0) {
      listRef.current?.scrollTo({ top: 0 })
    } else {
      itemRefs.current[selectedIndex]?.scrollIntoView({ block: 'nearest' })
    }
  }, [selectedIndex, filter])

  // Reset refs array length when filtered list changes
  useEffect(() => {
    itemRefs.current = itemRefs.current.slice(0, filtered.length)
  }, [filtered.length])

  if (filtered.length === 0) {
    // No commands yet — show skeleton placeholder rows
    if (slashCommands.length === 0) {
      const skeletonWidths = [
        { name: '72px', desc: '140px' },
        { name: '48px', desc: '110px' },
        { name: '88px', desc: '160px' },
        { name: '56px', desc: '96px' },
        { name: '64px', desc: '128px' },
      ]
      return (
        <div className="slash-autocomplete">
          <div className="slash-list">
            <div className="slash-group">
              {skeletonWidths.map((w, i) => (
                <div key={i} className="slash-item slash-item-skeleton">
                  <div className="slash-item-header">
                    <span className="slash-skeleton-chip" style={{ width: w.name }} />
                  </div>
                  <span className="slash-skeleton-chip slash-skeleton-desc" style={{ width: w.desc }} />
                </div>
              ))}
            </div>
          </div>
        </div>
      )
    }
    // Commands exist but nothing matches the current filter
    return null
  }

  const skillItems = filtered
    .map((cmd, i) => ({ cmd, globalIndex: i }))
    .filter(({ cmd }) => cmd.source === 'skill')

  const builtinItems = filtered
    .map((cmd, i) => ({ cmd, globalIndex: i }))
    .filter(({ cmd }) => cmd.source === 'builtin')

  const hasBoth = skillItems.length > 0 && builtinItems.length > 0

  return (
    <div className="slash-autocomplete">
      <div className="slash-list" ref={listRef}>
        <CommandGroup
          label="Skills"
          icon={<span className="slash-group-icon-skill"><IconSparkle size={12} /></span>}
          commands={skillItems}
          filter={filter}
          selectedIndex={selectedIndex}
          itemRefs={itemRefs}
          onSelect={onSelect}
        />
        {hasBoth && <div className="slash-group-divider" />}
        <CommandGroup
          label="Commands"
          icon="/"
          commands={builtinItems}
          filter={filter}
          selectedIndex={selectedIndex}
          itemRefs={itemRefs}
          onSelect={onSelect}
        />
      </div>
      <div className="slash-footer">
        <span>↑↓ navigate</span>
        <span className="slash-footer-dot">·</span>
        <span>↵ select</span>
        <span className="slash-footer-dot">·</span>
        <span>esc dismiss</span>
      </div>
    </div>
  )
}
