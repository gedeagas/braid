// ---------------------------------------------------------------------------
// AttentionChips - human-readable session attention indicators
//
// Renders compact pill-shaped chips in the web app overlay's drag region for
// sessions that need user action (waiting_input / error). Click navigates to
// that session. Overflow shows "+N more" pill linking to Mission Control.
// ---------------------------------------------------------------------------

import { memo, useMemo, useCallback, useRef, useState, useEffect, useSyncExternalStore } from 'react'
import type { SessionStatus } from '@/types'
import { useSessionsStore } from '@/store/sessions'
import { useProjectsStore } from '@/store/projects'
import { useUIStore } from '@/store/ui'
import { Tooltip } from '@/components/shared/Tooltip'
import { useTranslation } from 'react-i18next'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AttentionSession {
  id: string
  worktreeId: string
  projectId: string
  name: string
  status: 'waiting_input' | 'error'
  branch: string
}

interface SessionSlice {
  id: string
  worktreeId: string
  name: string
  status: SessionStatus
}

// ---------------------------------------------------------------------------
// Efficient store subscription - only re-renders on attention session changes
// ---------------------------------------------------------------------------

const subscribeToSessions = useSessionsStore.subscribe

let cachedFp = ''
let cachedSlices: SessionSlice[] = []

function getAttentionSnapshot(): SessionSlice[] {
  const { sessions } = useSessionsStore.getState()
  let fp = ''
  const result: SessionSlice[] = []
  for (const sess of Object.values(sessions)) {
    if (sess.status !== 'waiting_input' && sess.status !== 'error') continue
    result.push({ id: sess.id, worktreeId: sess.worktreeId, name: sess.name, status: sess.status })
  }
  // Sort: error first (most urgent), then waiting_input, then by id for stability
  result.sort((a, b) => {
    if (a.status !== b.status) return a.status === 'error' ? -1 : 1
    return a.id < b.id ? -1 : 1
  })
  for (const s of result) fp += `${s.id}|${s.worktreeId}|${s.name}|${s.status}\n`
  if (fp === cachedFp) return cachedSlices
  cachedFp = fp
  cachedSlices = result
  return result
}

// ---------------------------------------------------------------------------
// AttentionChip - single session pill
// ---------------------------------------------------------------------------

function AttentionChip({
  session,
  onClick,
}: {
  session: AttentionSession
  onClick: (session: AttentionSession) => void
}) {
  const { t } = useTranslation('sidebar')
  const statusLabel = session.status === 'error'
    ? t('attentionError')
    : t('attentionWaiting')

  const handleClick = useCallback(() => onClick(session), [onClick, session])

  return (
    <Tooltip content={`${session.name}\n${session.branch}`} position="bottom" delay={200}>
      <button
        className="attention-chip"
        data-role="chip"
        onClick={handleClick}
        aria-label={`${session.branch} - ${statusLabel}`}
      >
        <span className={`attention-chip-dot ${session.status}`} />
        <span className="attention-chip-branch">{session.branch}</span>
        <span className="attention-chip-separator">&middot;</span>
        <span className="attention-chip-status">{statusLabel}</span>
      </button>
    </Tooltip>
  )
}

// ---------------------------------------------------------------------------
// AttentionChips - main component
// ---------------------------------------------------------------------------

export const AttentionChips = memo(function AttentionChips() {
  const { t } = useTranslation('sidebar')
  const containerRef = useRef<HTMLDivElement>(null)
  const chipWidthsRef = useRef<number[]>([])
  const [maxVisible, setMaxVisible] = useState(Infinity)

  const sessionData = useSyncExternalStore(subscribeToSessions, getAttentionSnapshot)

  // Build worktree -> project/branch lookup
  const projects = useProjectsStore((s) => s.projects)
  const worktreeLookup = useMemo(() => {
    const map = new Map<string, { branch: string; projectId: string }>()
    for (const proj of projects) {
      for (const wt of proj.worktrees) {
        map.set(wt.id, { branch: wt.branch, projectId: proj.id })
      }
    }
    return map
  }, [projects])

  // Merge session data with worktree info
  const attentionSessions = useMemo(() => {
    return sessionData.map((s): AttentionSession => {
      const wt = worktreeLookup.get(s.worktreeId)
      return {
        id: s.id,
        worktreeId: s.worktreeId,
        projectId: wt?.projectId ?? '',
        name: s.name,
        status: s.status as 'waiting_input' | 'error',
        branch: wt?.branch ?? '',
      }
    })
  }, [sessionData, worktreeLookup])

  // Two-phase overflow: first render shows all chips (container clips via
  // overflow:hidden). A ResizeObserver measures their actual widths, caches
  // them, and computes how many fit. Subsequent resizes reuse cached widths
  // so the count can grow back when the container widens.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const GAP = 8 // matches var(--space-8)
    const OVERFLOW_BADGE = 56 // generous estimate for "+N" pill

    const measure = () => {
      // On first call after sessions change, read widths from DOM and cache
      const chips = el.querySelectorAll<HTMLElement>('[data-role="chip"]')
      if (chips.length > 0) {
        chipWidthsRef.current = Array.from(chips, (c) => c.offsetWidth)
      }
      const widths = chipWidthsRef.current
      if (widths.length === 0) return

      const containerWidth = el.clientWidth
      const total = widths.length

      // Try fitting all chips
      let used = 0
      let fitAll = 0
      for (let i = 0; i < total; i++) {
        const w = widths[i] + (i > 0 ? GAP : 0)
        if (used + w > containerWidth) break
        used += w
        fitAll++
      }

      if (fitAll >= total) {
        setMaxVisible(total)
        return
      }

      // Need overflow badge - recalculate with reserved space
      const available = containerWidth - OVERFLOW_BADGE - GAP
      used = 0
      let fitWithOverflow = 0
      for (let i = 0; i < total; i++) {
        const w = widths[i] + (i > 0 ? GAP : 0)
        if (used + w > available) break
        used += w
        fitWithOverflow++
      }
      setMaxVisible(Math.max(1, fitWithOverflow))
    }

    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [attentionSessions])

  // Navigation actions
  const selectWorktree = useUIStore((s) => s.selectWorktree)
  const setActiveCenterView = useUIStore((s) => s.setActiveCenterView)
  const setMissionControlActive = useUIStore((s) => s.setMissionControlActive)
  const closeWebApp = useUIStore((s) => s.closeWebApp)
  const setActiveSession = useSessionsStore((s) => s.setActiveSession)

  const handleChipClick = useCallback(
    (session: AttentionSession) => {
      selectWorktree(session.projectId, session.worktreeId)
      setActiveSession(session.id)
      setActiveCenterView({ type: 'session', sessionId: session.id })
      closeWebApp()
      if (useUIStore.getState().missionControlActive) setMissionControlActive(false)
    },
    [selectWorktree, setActiveSession, setActiveCenterView, closeWebApp, setMissionControlActive]
  )

  const handleOverflowClick = useCallback(() => {
    closeWebApp()
    setMissionControlActive(true)
  }, [closeWebApp, setMissionControlActive])

  if (attentionSessions.length === 0) return null

  const visible = attentionSessions.slice(0, Math.max(1, maxVisible))
  const overflow = attentionSessions.length - visible.length

  return (
    <div className="attention-chips" ref={containerRef}>
      {visible.map((s) => (
        <AttentionChip key={s.id} session={s} onClick={handleChipClick} />
      ))}
      {overflow > 0 && (
        <Tooltip content={t('attentionOverflow', { count: overflow })} position="bottom">
          <button
            className="attention-overflow"
            data-role="overflow"
            onClick={handleOverflowClick}
          >
            +{overflow}
          </button>
        </Tooltip>
      )}
    </div>
  )
})
