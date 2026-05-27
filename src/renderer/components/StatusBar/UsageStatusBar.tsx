import { useCallback, useState, useRef, useEffect, useMemo } from 'react'
import { useShallow } from 'zustand/shallow'
import { useRateLimitsStore } from '@/store/rateLimits'
import { useProjectsStore } from '@/store/projects'
import { useUIStore } from '@/store/ui'
import * as ipc from '@/lib/ipc'
import type { ProviderRateLimits, RateLimitWindow, ResourceSnapshot } from '../../../shared/rate-limit-types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function barColor(leftPct: number): string {
  if (leftPct > 40) return 'var(--green)'
  if (leftPct > 20) return 'var(--amber)'
  return 'var(--red)'
}

function windowLabel(minutes: number): string {
  if (minutes <= 300) return '5h'
  if (minutes <= 10080) return 'wk'
  return `${Math.round(minutes / 60)}h`
}

function formatTimeAgo(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 60_000) return 'just now'
  const mins = Math.floor(diff / 60_000)
  if (mins < 60) return `${mins}m ago`
  return `${Math.floor(mins / 60)}h ago`
}

function formatDuration(ms: number): string {
  if (ms <= 0) return 'now'
  const totalMins = Math.floor(ms / 60_000)
  if (totalMins < 60) return `${totalMins}m`
  const hours = Math.floor(totalMins / 60)
  const mins = totalMins % 60
  if (hours >= 24) {
    const days = Math.floor(hours / 24)
    const rem = hours % 24
    return rem > 0 ? `${days}d ${rem}h` : `${days}d`
  }
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`
}

function formatMemory(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function formatCpu(percent: number): string {
  return `${percent.toFixed(1)}%`
}

function formatPercent(value: number): string {
  return `${value.toFixed(0)}%`
}

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

function ClaudeIcon({ size = 14 }: { size?: number }) {
  return (
    <svg height={size} width={size} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M4.709 15.955l4.72-2.647.08-.23-.08-.128H9.2l-.79-.048-2.698-.073-2.339-.097-2.266-.122-.571-.121L0 11.784l.055-.352.48-.321.686.06 1.52.103 2.278.158 1.652.097 2.449.255h.389l.055-.157-.134-.098-.103-.097-2.358-1.596-2.552-1.688-1.336-.972-.724-.491-.364-.462-.158-1.008.656-.722.881.06.225.061.893.686 1.908 1.476 2.491 1.833.365.304.145-.103.019-.073-.164-.274-1.355-2.446-1.446-2.49-.644-1.032-.17-.619a2.97 2.97 0 01-.104-.729L6.283.134 6.696 0l.996.134.42.364.62 1.414 1.002 2.229 1.555 3.03.456.898.243.832.091.255h.158V9.01l.128-1.706.237-2.095.23-2.695.08-.76.376-.91.747-.492.584.28.48.685-.067.444-.286 1.851-.559 2.903-.364 1.942h.212l.243-.242.985-1.306 1.652-2.064.73-.82.85-.904.547-.431h1.033l.76 1.129-.34 1.166-1.064 1.347-.881 1.142-1.264 1.7-.79 1.36.073.11.188-.02 2.856-.606 1.543-.28 1.841-.315.833.388.091.395-.328.807-1.969.486-2.309.462-3.439.813-.042.03.049.061 1.549.146.662.036h1.622l3.02.225.79.522.474.638-.079.485-1.215.62-1.64-.389-3.829-.91-1.312-.329h-.182v.11l1.093 1.068 2.006 1.81 2.509 2.33.127.578-.322.455-.34-.049-2.205-1.657-.851-.747-1.926-1.62h-.128v.17l.444.649 2.345 3.521.122 1.08-.17.353-.608.213-.668-.122-1.374-1.925-1.415-2.167-1.143-1.943-.14.08-.674 7.254-.316.37-.729.28-.607-.461-.322-.747.322-1.476.389-1.924.315-1.53.286-1.9.17-.632-.012-.042-.14.018-1.434 1.967-2.18 2.945-1.726 1.845-.414.164-.717-.37.067-.662.401-.589 2.388-3.036 1.44-1.882.93-1.086-.006-.158h-.055L4.132 18.56l-1.13.146-.487-.456.061-.746.231-.243 1.908-1.312-.006.006z"
        fill="#D97757"
        fillRule="nonzero"
      />
    </svg>
  )
}

function CodexIcon({ size = 14 }: { size?: number }) {
  return (
    <svg fill="currentColor" fillRule="evenodd" height={size} width={size} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <path d="M9.205 8.658v-2.26c0-.19.072-.333.238-.428l4.543-2.616c.619-.357 1.356-.523 2.117-.523 2.854 0 4.662 2.212 4.662 4.566 0 .167 0 .357-.024.547l-4.71-2.759a.797.797 0 00-.856 0l-5.97 3.473zm10.609 8.8V12.06c0-.333-.143-.57-.429-.737l-5.97-3.473 1.95-1.118a.433.433 0 01.476 0l4.543 2.617c1.309.76 2.189 2.378 2.189 3.948 0 1.808-1.07 3.473-2.76 4.163zM7.802 12.703l-1.95-1.142c-.167-.095-.239-.238-.239-.428V5.899c0-2.545 1.95-4.472 4.591-4.472 1 0 1.927.333 2.712.928L8.23 5.067c-.285.166-.428.404-.428.737v6.898zM12 15.128l-2.795-1.57v-3.33L12 8.658l2.795 1.57v3.33L12 15.128zm1.796 7.23c-1 0-1.927-.332-2.712-.927l4.686-2.712c.285-.166.428-.404.428-.737v-6.898l1.974 1.142c.167.095.238.238.238.428v5.233c0 2.545-1.974 4.472-4.614 4.472zm-5.637-5.303l-4.544-2.617c-1.308-.761-2.188-2.378-2.188-3.948A4.482 4.482 0 014.21 6.327v5.423c0 .333.143.571.428.738l5.947 3.449-1.95 1.118a.432.432 0 01-.476 0zm-.262 3.9c-2.688 0-4.662-2.021-4.662-4.519 0-.19.024-.38.047-.57l4.686 2.71c.286.167.571.167.856 0l5.97-3.448v2.26c0 .19-.07.333-.237.428l-4.543 2.616c-.619.357-1.356.523-2.117.523zm5.899 2.83a5.947 5.947 0 005.827-4.756C22.287 18.339 24 15.84 24 13.296c0-1.665-.713-3.282-1.998-4.448.119-.5.19-.999.19-1.498 0-3.401-2.759-5.947-5.946-5.947-.642 0-1.26.095-1.88.31A5.962 5.962 0 0010.205 0a5.947 5.947 0 00-5.827 4.757C1.713 5.447 0 7.945 0 10.49c0 1.666.713 3.283 1.998 4.448-.119.5-.19 1-.19 1.499 0 3.401 2.759 5.946 5.946 5.946.642 0 1.26-.095 1.88-.309a5.96 5.96 0 004.162 1.713z" />
    </svg>
  )
}

function MemoryStickIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 19v-3" /><path d="M10 19v-3" /><path d="M14 19v-3" /><path d="M18 19v-3" />
      <path d="M8 11V9" /><path d="M16 11V9" /><path d="M12 11V9" />
      <path d="M2 15h20" /><path d="M2 7a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7z" />
    </svg>
  )
}

function TerminalIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" />
    </svg>
  )
}

function RefreshIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 4 23 10 17 10" />
      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
    </svg>
  )
}

function WarningIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.7 }}>
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  )
}

// ---------------------------------------------------------------------------
// Click-to-open detail panel
// ---------------------------------------------------------------------------

function usePopover() {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (triggerRef.current?.contains(e.target as Node)) return
      if (panelRef.current?.contains(e.target as Node)) return
      setOpen(false)
    }
    function handleKey(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey)
    return () => { document.removeEventListener('mousedown', handleClick); document.removeEventListener('keydown', handleKey) }
  }, [open])

  return { open, setOpen, triggerRef, panelRef }
}

function PanelWindowSection({ w, label }: { w: RateLimitWindow | null; label: string }) {
  if (!w) return null
  const leftPct = Math.max(0, Math.round(100 - w.usedPercent))
  const resetIn = w.resetsAt ? formatDuration(w.resetsAt - Date.now()) : null
  return (
    <div className="usage-panel__window">
      <div className="usage-panel__window-label">{label}</div>
      <div className="usage-panel__bar">
        <div className="usage-panel__bar-fill" style={{ width: `${leftPct}%`, background: barColor(leftPct) }} />
      </div>
      <div className="usage-panel__bar-meta">
        <span>{leftPct}% left</span>
        {resetIn && <span>Resets in {resetIn}</span>}
      </div>
    </div>
  )
}

function ProviderPanel({ p }: { p: ProviderRateLimits }) {
  const name = p.provider === 'claude' ? 'Claude' : 'Codex'
  const Icon = p.provider === 'claude' ? ClaudeIcon : CodexIcon
  const hasData = p.session || p.weekly

  if (p.status === 'unavailable') {
    return (
      <div className="usage-panel">
        <div className="usage-panel__header"><Icon size={15} />{name}</div>
        <div className="usage-panel__error">{p.error ?? 'Unavailable'}</div>
      </div>
    )
  }
  if (p.status === 'error' && !hasData) {
    return (
      <div className="usage-panel">
        <div className="usage-panel__header"><Icon size={15} />{name}</div>
        <div className="usage-panel__error">{p.error ?? 'Unable to fetch usage'}</div>
      </div>
    )
  }
  const updatedAgo = p.updatedAt ? `Updated ${formatTimeAgo(p.updatedAt)}` : 'Not yet updated'
  return (
    <div className="usage-panel">
      <div className="usage-panel__header"><Icon size={15} />{name}</div>
      <div className="usage-panel__updated">{updatedAgo}</div>
      <hr className="usage-panel__divider" />
      <PanelWindowSection w={p.session} label="Session (5h)" />
      <PanelWindowSection w={p.weekly} label="Weekly (7d)" />
      {p.error && hasData && (
        <div className="usage-panel__error">Refresh failed - showing cached data</div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Provider segment (click-to-open)
// ---------------------------------------------------------------------------

function ProviderSegment({ p }: { p: ProviderRateLimits | null }) {
  const { open, setOpen, triggerRef, panelRef } = usePopover()
  if (!p || p.status === 'idle') return null

  const Icon = p.provider === 'claude' ? ClaudeIcon : CodexIcon
  const name = p.provider === 'claude' ? 'Claude' : 'Codex'

  const renderContent = () => {
    if (p.status === 'fetching' && !p.session && !p.weekly) {
      return <><Icon size={14} /><span className="usage-status-bar__loading">&middot;&middot;&middot;</span></>
    }
    if (p.status === 'unavailable') {
      return <><Icon size={14} /><span className="usage-status-bar__dimmed">--</span></>
    }
    if (p.status === 'error' && !p.session && !p.weekly) {
      return <><Icon size={14} /><WarningIcon /></>
    }
    const isStale = p.status === 'error'
    const sLeft = p.session ? Math.max(0, Math.round(100 - p.session.usedPercent)) : null
    const wLeft = p.weekly ? Math.max(0, Math.round(100 - p.weekly.usedPercent)) : null
    return (
      <>
        <Icon size={14} />
        {p.session && <span className="usage-status-bar__minibar"><span className="usage-status-bar__minibar-fill" style={{ width: `${sLeft}%`, background: barColor(sLeft!) }} /></span>}
        {p.session && <span className="usage-status-bar__label">{sLeft}% {windowLabel(p.session.windowMinutes)}</span>}
        {p.session && p.weekly && <span className="usage-status-bar__sep">&middot;</span>}
        {p.weekly && <span className="usage-status-bar__label">{wLeft}% {windowLabel(p.weekly.windowMinutes)}</span>}
        {isStale && <WarningIcon />}
      </>
    )
  }

  return (
    <div style={{ position: 'relative' }}>
      <button ref={triggerRef} className="usage-status-bar__segment" onClick={() => setOpen(v => !v)} aria-label={`${name} usage details`} aria-expanded={open}>
        {renderContent()}
      </button>
      {open && <div ref={panelRef} className="usage-status-bar__popover"><ProviderPanel p={p} /></div>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Resource usage segment (memory/CPU/sessions) - right side
// ---------------------------------------------------------------------------

const RESOURCE_POLL_MS = 2_000
const SESSION_POLL_MS = 10_000

type DaemonSession = { sessionId: string; cwd: string; cols: number; rows: number; createdAt: number }

type WorktreeRow = {
  worktreeId: string
  name: string
  terminals: { id: string; label: string }[]
  cpu: number
  memory: number
}

function ChevronRightIcon() {
  return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
}
function ChevronDownIcon() {
  return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
}

function Sparkline({ samples, width = 48, height = 14 }: { samples: number[]; width?: number; height?: number }) {
  if (samples.length < 2) {
    const mid = (height / 2).toFixed(1)
    return <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden><polyline points={`0,${mid} ${width},${mid}`} fill="none" strokeWidth={1} strokeLinecap="round" strokeLinejoin="round" stroke="var(--text-tertiary)" opacity="0.5" /></svg>
  }
  let min = samples[0], max = samples[0]
  for (const v of samples) { if (v < min) min = v; if (v > max) max = v }
  const range = max - min || 1
  const stepX = width / (samples.length - 1)
  const points = samples.map((v, i) => `${(i * stepX).toFixed(1)},${(height - ((v - min) / range) * height).toFixed(1)}`).join(' ')
  return <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden preserveAspectRatio="none"><polyline points={points} fill="none" strokeWidth={1} strokeLinecap="round" strokeLinejoin="round" stroke="var(--text-tertiary)" opacity="0.7" /></svg>
}

function ResourcePanel({ snapshot }: { snapshot: ResourceSnapshot | null }) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [appCollapsed, setAppCollapsed] = useState(true)
  const projects = useProjectsStore((s) => s.projects)
  const bigTerminalsByWorktree = useUIStore((s) => s.bigTerminalsByWorktree)

  const toggleCollapse = useCallback((id: string) => {
    setCollapsed(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next })
  }, [])

  const worktreeRows = useMemo<WorktreeRow[]>(() => {
    const ptyByCwd = new Map<string, { cpu: number; memory: number }[]>()
    for (const p of snapshot?.ptyUsage ?? []) {
      const arr = ptyByCwd.get(p.cwd) ?? []
      arr.push({ cpu: p.cpu, memory: p.memory })
      ptyByCwd.set(p.cwd, arr)
    }

    const rows: WorktreeRow[] = []
    for (const project of projects) {
      for (const wt of project.worktrees) {
        const bigTerminals = bigTerminalsByWorktree[wt.id] ?? []
        const ptyEntries = ptyByCwd.get(wt.path) ?? []
        let wtCpu = 0, wtMem = 0
        for (const e of ptyEntries) { wtCpu += e.cpu; wtMem += e.memory }

        const terminals = bigTerminals.map(t => ({ id: t.id, label: t.label }))
        if (bigTerminals.length > 0 || ptyEntries.length > 0) {
          rows.push({ worktreeId: wt.id, name: wt.branch || wt.id, terminals, cpu: wtCpu, memory: wtMem })
        }
      }
    }
    return rows
  }, [projects, bigTerminalsByWorktree, snapshot?.ptyUsage])

  const totalCpu = snapshot?.totalCpu ?? 0
  const totalMemory = snapshot?.totalMemory ?? 0
  const hostShare = snapshot && snapshot.host.totalMemory > 0 ? (totalMemory / snapshot.host.totalMemory) * 100 : 0
  const appMem = snapshot?.app

  return (
    <div className="rmpanel">
      <div className="rmpanel__header">
        <div className="rmpanel__header-left">
          <MemoryStickIcon size={13} />
          <span>Resource Manager</span>
        </div>
      </div>

      {snapshot && (
        <div className="rmpanel__stats">
          <span className="rmpanel__stats-val">{formatCpu(totalCpu)}</span>
          <span className="rmpanel__stats-sep">&middot;</span>
          <span className="rmpanel__stats-val">{formatMemory(totalMemory)}</span>
          <span className="rmpanel__stats-sep">&middot;</span>
          <span className="rmpanel__stats-muted">{formatPercent(hostShare)} of system RAM</span>
        </div>
      )}

      <div className="rmpanel__colheader">
        <span className="rmpanel__colheader-name">Name</span>
        <span className="rmpanel__colheader-cpu">CPU</span>
        <span className="rmpanel__colheader-mem">Memory</span>
      </div>

      <div className="rmpanel__body">
        {worktreeRows.map(wt => {
          const isCollapsed = collapsed.has(wt.worktreeId)
          const hasTerminals = wt.terminals.length > 0
          return (
            <div key={wt.worktreeId} className="rmpanel__wt">
              <div className="rmpanel__wt-row">
                {hasTerminals ? (
                  <button className="rmpanel__chevron" onClick={() => toggleCollapse(wt.worktreeId)}>
                    {isCollapsed ? <ChevronRightIcon /> : <ChevronDownIcon />}
                  </button>
                ) : (
                  <span className="rmpanel__chevron-placeholder" />
                )}
                <span className="rmpanel__wt-name">{wt.name}</span>
                <span className="rmpanel__wt-cpu">{formatCpu(wt.cpu)}</span>
                <span className="rmpanel__wt-mem">{formatMemory(wt.memory)}</span>
              </div>
              {!isCollapsed && hasTerminals && wt.terminals.map(t => (
                <div key={t.id} className="rmpanel__session-row">
                  <span className="rmpanel__session-dot" />
                  <span className="rmpanel__session-label">{t.label}</span>
                  <span className="rmpanel__session-cpu">--</span>
                  <span className="rmpanel__session-mem">--</span>
                </div>
              ))}
            </div>
          )
        })}

        {worktreeRows.length === 0 && snapshot && (
          <div className="rmpanel__empty">Nothing running right now</div>
        )}

        {appMem && (
          <div className="rmpanel__app">
            <div className="rmpanel__app-row" onClick={() => setAppCollapsed(v => !v)}>
              <button className="rmpanel__chevron">
                {appCollapsed ? <ChevronRightIcon /> : <ChevronDownIcon />}
              </button>
              <span className="rmpanel__app-label">BRAID</span>
              <Sparkline samples={appMem.history} />
              <span className="rmpanel__wt-cpu">{formatCpu(appMem.cpu)}</span>
              <span className="rmpanel__wt-mem">{formatMemory(appMem.memory)}</span>
            </div>
            {!appCollapsed && (
              <div className="rmpanel__app-details">
                <div className="rmpanel__session-row">
                  <span className="rmpanel__session-dot rmpanel__session-dot--muted" />
                  <span className="rmpanel__session-label">Main</span>
                  <span className="rmpanel__session-cpu">{formatCpu(appMem.main.cpu)}</span>
                  <span className="rmpanel__session-mem">{formatMemory(appMem.main.memory)}</span>
                </div>
                <div className="rmpanel__session-row">
                  <span className="rmpanel__session-dot rmpanel__session-dot--muted" />
                  <span className="rmpanel__session-label">Renderer</span>
                  <span className="rmpanel__session-cpu">{formatCpu(appMem.renderer.cpu)}</span>
                  <span className="rmpanel__session-mem">{formatMemory(appMem.renderer.memory)}</span>
                </div>
                {(appMem.other.cpu > 0 || appMem.other.memory > 0) && (
                  <div className="rmpanel__session-row">
                    <span className="rmpanel__session-dot rmpanel__session-dot--muted" />
                    <span className="rmpanel__session-label">Other</span>
                    <span className="rmpanel__session-cpu">{formatCpu(appMem.other.cpu)}</span>
                    <span className="rmpanel__session-mem">{formatMemory(appMem.other.memory)}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {!snapshot && <div className="rmpanel__empty">Loading...</div>}
      </div>
    </div>
  )
}

function ResourceSegment() {
  const { open, setOpen, triggerRef, panelRef } = usePopover()
  const [snapshot, setSnapshot] = useState<ResourceSnapshot | null>(null)
  const [sessions, setSessions] = useState<DaemonSession[]>([])

  const fetchSnapshot = useCallback(async () => {
    try { setSnapshot(await ipc.resource.getSnapshot()) } catch { /* ignore */ }
  }, [])

  const fetchSessions = useCallback(async () => {
    try { setSessions(await ipc.pty.listSessions()) } catch { setSessions([]) }
  }, [])

  useEffect(() => {
    void fetchSnapshot()
  }, [fetchSnapshot])

  useEffect(() => {
    if (!open) return
    void fetchSnapshot()
    void fetchSessions()
    const memTimer = setInterval(() => void fetchSnapshot(), RESOURCE_POLL_MS)
    const sessTimer = setInterval(() => void fetchSessions(), SESSION_POLL_MS)
    return () => { clearInterval(memTimer); clearInterval(sessTimer) }
  }, [open, fetchSnapshot, fetchSessions])

  const memLabel = snapshot ? formatMemory(snapshot.totalMemory) : '--'
  const sessionCount = open ? sessions.length : (snapshot?.ptyUsage.length ?? 0)

  return (
    <div style={{ position: 'relative' }}>
      <button ref={triggerRef} className="usage-status-bar__segment" onClick={() => setOpen(v => !v)} aria-label="Resource manager" aria-expanded={open}>
        <MemoryStickIcon size={13} />
        <span className="usage-status-bar__label">{memLabel}</span>
        <span className="usage-status-bar__sep">&middot;</span>
        <TerminalIcon size={13} />
        <span className="usage-status-bar__label">{sessionCount}</span>
      </button>
      {open && (
        <div ref={panelRef} className="usage-status-bar__popover usage-status-bar__popover--right usage-status-bar__popover--wide">
          <ResourcePanel snapshot={snapshot} />
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function UsageStatusBar() {
  const { claude, codex } = useRateLimitsStore(useShallow((s) => s.state))
  const refreshStore = useRateLimitsStore((s) => s.refresh)
  const isRefreshing = useRateLimitsStore((s) => s.isRefreshing)

  const anyFetching = isRefreshing || claude?.status === 'fetching' || codex?.status === 'fetching'
  const showClaude = claude !== null
  const showCodex = codex !== null

  const [, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 60_000)
    return () => clearInterval(id)
  }, [])

  const handleRefresh = useCallback(() => {
    if (!isRefreshing) void refreshStore()
  }, [isRefreshing, refreshStore])

  return (
    <div className="usage-status-bar">
      <div className="usage-status-bar__left">
        {showClaude && <ProviderSegment p={claude} />}
        {showCodex && <ProviderSegment p={codex} />}
        {(showClaude || showCodex) && (
          <button
            className={`usage-status-bar__refresh ${anyFetching ? 'usage-status-bar__refresh--spinning' : ''}`}
            onClick={handleRefresh}
            disabled={isRefreshing}
            aria-label="Refresh usage data"
            title="Refresh usage data"
          >
            <RefreshIcon />
          </button>
        )}
      </div>
      <div className="usage-status-bar__spacer" />
      <div className="usage-status-bar__right">
        <ResourceSegment />
      </div>
    </div>
  )
}
