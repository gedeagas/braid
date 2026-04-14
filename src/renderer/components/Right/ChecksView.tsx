/**
 * ChecksView — data-fetching composition root for the Checks tab.
 *
 * Manages: PR status, CI checks, deployments, git sync, Jira, polling, and
 * all action callbacks (pull, push, mark-ready, fix-with-AI, create-PR).
 *
 * Rendering sub-components live in ChecksSections.tsx.
 */
import { useReducer, useCallback, useMemo, useEffect, useRef } from 'react'
import * as ipc from '@/lib/ipc'
import { cleanIpcError } from '@/lib/ipc'
import { useSessionsStore } from '@/store/sessions'
import { useUIStore } from '@/store/ui'
import type { JiraResult } from '@/types'
import { flash } from '@/store/flash'
import { useTranslation } from 'react-i18next'
import { usePrCacheStore, type PrStatus } from '@/store/prCache'
import { useProjectsStore } from '@/store/projects'
import { IconRefresh } from '@/components/shared/icons'
import { DEFAULT_PR_PROMPT } from '@/lib/prPrompt'
import { isOnline, onOnline } from '@/lib/online'
import { JiraSection } from './JiraSection'
import { PushErrorPanel } from './PushErrorPanel'
import {
  type CheckRun, type Deployment, type GitSyncStatus,
  getCheckConclusion,
  GitStatusSection, DeploymentsSection, ChecksSection,
  ChecksViewSkeleton, ChecksNoPr,
} from './ChecksSections'

// ─── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  worktreePath: string
  worktreeId: string
  /** When true the tab is visible — enables polling. When false/unmounted, polling stops. */
  isActive?: boolean
}

// ─── Snapshot cache ───────────────────────────────────────────────────────────
// Persists full checks-view data across worktree switches (key remounts).
// Written at the end of every successful load(); read at mount to skip skeletons.

interface ChecksSnapshot {
  pr: PrStatus | null
  checks: CheckRun[]
  deployments: Deployment[]
  sync: GitSyncStatus | null
  jiraResult: JiraResult | null | 'error'
  lastUpdated: Date
}

const checksCache = new Map<string, ChecksSnapshot>()

// ─── Reducer ──────────────────────────────────────────────────────────────────

interface ChecksViewState {
  pr: PrStatus | null
  checks: CheckRun[]
  deployments: Deployment[]
  sync: GitSyncStatus | null
  jiraResult: JiraResult | null | 'error'
  loading: boolean
  lastUpdated: Date | null
  fixingCheck: string | null
  openingLog: string | null
  creatingPr: boolean
  refreshing: boolean
  pulling: boolean
  pushing: boolean
  pushError: string | null
  markingReady: boolean
}

type ChecksAction =
  | { type: 'LOAD_DONE'; pr: PrStatus | null; checks: CheckRun[]; deployments: Deployment[]; sync: GitSyncStatus | null; jiraResult: JiraResult | null | 'error'; lastUpdated: Date }
  | { type: 'LOAD_ERROR' }
  | { type: 'SET_FIXING_CHECK'; name: string | null }
  | { type: 'SET_OPENING_LOG'; name: string | null }
  | { type: 'SET_CREATING_PR'; value: boolean }
  | { type: 'SET_REFRESHING'; value: boolean }
  | { type: 'SET_PULLING'; value: boolean }
  | { type: 'SET_PUSHING'; value: boolean }
  | { type: 'SET_PUSH_ERROR'; message: string | null }
  | { type: 'SET_MARKING_READY'; value: boolean }

function checksViewReducer(state: ChecksViewState, action: ChecksAction): ChecksViewState {
  switch (action.type) {
    case 'LOAD_DONE': return {
      ...state, loading: false,
      pr: action.pr, checks: action.checks, deployments: action.deployments,
      sync: action.sync, jiraResult: action.jiraResult, lastUpdated: action.lastUpdated,
    }
    case 'LOAD_ERROR': return { ...state, loading: false }
    case 'SET_FIXING_CHECK': return { ...state, fixingCheck: action.name }
    case 'SET_OPENING_LOG': return { ...state, openingLog: action.name }
    case 'SET_CREATING_PR': return { ...state, creatingPr: action.value }
    case 'SET_REFRESHING': return { ...state, refreshing: action.value }
    case 'SET_PULLING': return { ...state, pulling: action.value }
    case 'SET_PUSHING': return { ...state, pushing: action.value }
    case 'SET_PUSH_ERROR': return { ...state, pushError: action.message }
    case 'SET_MARKING_READY': return { ...state, markingReady: action.value }
    default: return state
  }
}

function buildInitialState(worktreePath: string): ChecksViewState {
  const snapshot = checksCache.get(worktreePath)
  const cachedEntry = usePrCacheStore.getState().cache[worktreePath]
  const hasCachedData = !!(snapshot || (cachedEntry && cachedEntry.fetchedAt > 0))
  return {
    pr: snapshot?.pr ?? (cachedEntry?.fetchedAt ? (cachedEntry.data as PrStatus | null) : null),
    checks: snapshot?.checks ?? [],
    deployments: snapshot?.deployments ?? [],
    sync: snapshot?.sync ?? null,
    jiraResult: snapshot?.jiraResult ?? null,
    loading: !hasCachedData,
    lastUpdated: snapshot?.lastUpdated ?? null,
    fixingCheck: null, openingLog: null,
    creatingPr: false, refreshing: false, pulling: false, pushing: false, pushError: null, markingReady: false,
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ChecksView({ worktreePath, worktreeId, isActive = true }: Props) {
  const [state, dispatch] = useReducer(checksViewReducer, worktreePath, buildInitialState)
  const {
    pr, checks, deployments, sync, jiraResult, loading, lastUpdated,
    fixingCheck, openingLog, creatingPr, refreshing, pulling, pushing, pushError, markingReady,
  } = state

  const lastOwnFetchRef = useRef(0)
  const { t } = useTranslation('right')

  // Current upstream tracking branch used as the sync-status base branch
  const upstream = useProjectsStore((s) => {
    for (const p of s.projects) {
      const wt = p.worktrees.find((w) => w.path === worktreePath)
      if (wt) return wt.upstream
    }
    return undefined
  })

  const jiraBaseUrl = useUIStore((s) => s.jiraBaseUrl)
  const createSession = useSessionsStore((s) => s.createSession)
  const sendMessage = useSessionsStore((s) => s.sendMessage)
  const setActiveSession = useSessionsStore((s) => s.setActiveSession)
  const openFile = useUIStore((s) => s.openFile)
  const setActiveCenterView = useUIStore((s) => s.setActiveCenterView)

  // ─── Data fetching ────────────────────────────────────────────────────────

  const load = useCallback(async (forceRefresh?: boolean) => {
    try {
      const [prResult, jiraFetch] = await Promise.all([
        ipc.github.getPrStatus(worktreePath, forceRefresh) as Promise<PrStatus | null>,
        (ipc.jira.getIssuesForBranch(worktreePath, jiraBaseUrl || undefined) as Promise<JiraResult>)
          .catch((): 'error' => 'error'),
      ])

      // Keep the sidebar prCache in sync — no need to wait for its 90s poll.
      // prResult is already typed as PrStatus (canonical), so pass it through
      // directly instead of hand-picking fields (which silently drops new ones).
      const cacheData = prResult
      const now = Date.now()
      lastOwnFetchRef.current = now
      usePrCacheStore.setState((s) => ({
        cache: { ...s.cache, [worktreePath]: { data: cacheData, fetchedAt: now, loading: false } },
      }))

      let latestChecks: CheckRun[] = []
      let latestDeployments: Deployment[] = []
      let latestSync: GitSyncStatus | null = null

      if (prResult) {
        const syncBranch = upstream ?? prResult.baseRefName ?? 'main'
        const [checksData, deploymentsData, syncData] = await Promise.all([
          ipc.github.getChecks(worktreePath, forceRefresh),
          ipc.github.getDeployments(worktreePath, forceRefresh),
          ipc.github.getGitSyncStatus(worktreePath, syncBranch, forceRefresh),
        ])
        latestChecks = (checksData as CheckRun[]) ?? []
        latestDeployments = (deploymentsData as Deployment[]) ?? []
        latestSync = syncData as GitSyncStatus
      }

      const now2 = new Date()
      dispatch({ type: 'LOAD_DONE', pr: prResult, checks: latestChecks, deployments: latestDeployments, sync: latestSync, jiraResult: jiraFetch, lastUpdated: now2 })
      checksCache.set(worktreePath, { pr: prResult, checks: latestChecks, deployments: latestDeployments, sync: latestSync, jiraResult: jiraFetch, lastUpdated: now2 })
    } catch (err) {
      const st = usePrCacheStore.getState().cache[worktreePath]?.data?.state
      if (st !== 'MERGED' && st !== 'CLOSED') flash('error', cleanIpcError(err, t('loadChecksError')))
      dispatch({ type: 'LOAD_ERROR' })
    }
  }, [worktreePath, upstream, jiraBaseUrl, t])

  // ─── Action handlers ───────────────────────────────────────────────────────

  const handleRefresh = useCallback(async () => {
    dispatch({ type: 'SET_REFRESHING', value: true })
    try { await load(true) } finally { dispatch({ type: 'SET_REFRESHING', value: false }) }
  }, [load])

  const handlePull = useCallback(async () => {
    if (pulling) return
    dispatch({ type: 'SET_PULLING', value: true })
    try {
      await ipc.git.pull(worktreePath)
      flash('success', t('pullSuccessFlash'))
      await load()
    } catch (err) {
      flash('error', cleanIpcError(err, t('pullChecksError')), 5_000)
    } finally { dispatch({ type: 'SET_PULLING', value: false }) }
  }, [pulling, worktreePath, load, t])

  const handlePush = useCallback(async () => {
    if (pushing) return
    dispatch({ type: 'SET_PUSHING', value: true })
    dispatch({ type: 'SET_PUSH_ERROR', message: null })
    try {
      await ipc.git.push(worktreePath)
      flash('success', t('pushSuccessFlash'))
      await load()
    } catch (err) {
      dispatch({ type: 'SET_PUSH_ERROR', message: cleanIpcError(err, t('pushChecksError')) })
    } finally { dispatch({ type: 'SET_PUSHING', value: false }) }
  }, [pushing, worktreePath, load, t])

  const handleMarkReady = useCallback(async () => {
    if (markingReady) return
    dispatch({ type: 'SET_MARKING_READY', value: true })
    try {
      await ipc.github.markPrReady(worktreePath)
      flash('success', t('markReadySuccessFlash'))
      await load()
    } catch (err) {
      flash('error', cleanIpcError(err, t('markReadyChecksError')), 5_000)
    } finally { dispatch({ type: 'SET_MARKING_READY', value: false }) }
  }, [markingReady, worktreePath, load, t])

  const openLog = useCallback(async (check: CheckRun) => {
    if (openingLog || !check.url) return
    dispatch({ type: 'SET_OPENING_LOG', name: check.name })
    try {
      const tmpPath = await ipc.github.openCheckLog(worktreePath, check.url, check.name) as string
      if (tmpPath) openFile(tmpPath)
    } catch (err) {
      flash('error', cleanIpcError(err, t('openLogError')))
    } finally { dispatch({ type: 'SET_OPENING_LOG', name: null }) }
  }, [openingLog, worktreePath, openFile, t])

  const fixWithAI = useCallback(async (check: CheckRun) => {
    if (fixingCheck) return
    dispatch({ type: 'SET_FIXING_CHECK', name: check.name })
    try {
      const log = check.url ? (await ipc.github.getCheckRunLog(worktreePath, check.url) as string) : ''
      const sessionId = createSession(worktreeId, worktreePath)
      setActiveSession(sessionId)
      setActiveCenterView({ type: 'session', sessionId })
      const logSection = log ? `\n\nHere are the CI logs:\n\`\`\`\n${log}\n\`\`\`` : ''
      const prompt = `The CI check **${check.name}** failed${pr ? ` on PR #${pr.number} (${pr.title})` : ''}.${logSection}\n\nPlease investigate the failure, find the root cause in the codebase, and fix it.`
      await sendMessage(sessionId, prompt)
    } finally { dispatch({ type: 'SET_FIXING_CHECK', name: null }) }
  }, [fixingCheck, worktreePath, worktreeId, pr, createSession, sendMessage, setActiveSession, setActiveCenterView])

  const createPrWithAI = useCallback(async () => {
    if (creatingPr) return
    dispatch({ type: 'SET_CREATING_PR', value: true })
    try {
      const sessionId = createSession(worktreeId, worktreePath)
      setActiveSession(sessionId)
      setActiveCenterView({ type: 'session', sessionId })
      const customPrompt = useUIStore.getState().prPrompt.trim()
      await sendMessage(sessionId, customPrompt || DEFAULT_PR_PROMPT, undefined, { tag: 'create-pr' })
    } finally { dispatch({ type: 'SET_CREATING_PR', value: false }) }
  }, [creatingPr, worktreeId, worktreePath, createSession, sendMessage, setActiveSession, setActiveCenterView])

  // ─── Effects ──────────────────────────────────────────────────────────────

  useEffect(() => {
    if (isActive) load()
  }, [isActive, load])

  // Re-fetch when external code (e.g. PrMergeBar) updates the PR cache
  const cacheFetchedAt = usePrCacheStore((s) => s.cache[worktreePath]?.fetchedAt ?? 0)
  useEffect(() => {
    if (!isActive || cacheFetchedAt === 0) return
    if (cacheFetchedAt === lastOwnFetchRef.current) return  // skip our own writes
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only react to external cache updates
  }, [cacheFetchedAt])

  // Smart polling: pending checks at 30s, settled at 60s; pauses on tab/window hide
  const hasPending = useMemo(() => checks.some((c) => getCheckConclusion(c) === 'pending'), [checks])
  const POLL_FAST_MS = 30_000
  const POLL_SLOW_MS = 60_000

  useEffect(() => {
    if (!isActive) return
    if (pr?.state === 'MERGED' || pr?.state === 'CLOSED') return

    let timer: ReturnType<typeof setInterval> | null = null
    const start = () => { if (!timer) timer = setInterval(() => { if (isOnline()) load() }, hasPending ? POLL_FAST_MS : POLL_SLOW_MS) }
    const stop = () => { if (timer) { clearInterval(timer); timer = null } }
    const onVisibility = () => { if (document.hidden) { stop() } else { load(); start() } }

    if (!document.hidden) start()
    document.addEventListener('visibilitychange', onVisibility)
    const unsubOnline = onOnline(() => { load(); stop(); start() })
    return () => { stop(); document.removeEventListener('visibilitychange', onVisibility); unsubOnline() }
  }, [isActive, pr?.state, hasPending, load])

  // ─── Render ───────────────────────────────────────────────────────────────

  if (loading) return <ChecksViewSkeleton />

  if (!pr) return <ChecksNoPr creatingPr={creatingPr} onCreatePr={createPrWithAI} jiraResult={jiraResult} />

  const openPrUrl = () => {
    if (pr.url) ipc.shell.openExternal(pr.url)
  }

  return (
    <div className="checks-view">
      {/* PR Header */}
      <div className="checks-pr-header" onClick={openPrUrl}>
        <div className="checks-pr-title">
          <span className="checks-pr-number">#{pr.number}</span>
          <span className="checks-pr-name">{pr.title}</span>
        </div>
        <div className="checks-pr-meta">
          <span className={`checks-pr-state checks-pr-state--${pr.isDraft ? 'draft' : pr.state.toLowerCase()}`}>
            {pr.isDraft ? t('prStateDraft') : pr.state === 'OPEN' ? t('prStateOpen') : pr.state === 'MERGED' ? t('prStateMerged') : pr.state === 'CLOSED' ? t('prStateClosed') : pr.state}
          </span>
          <span className="checks-pr-branch">{pr.headBranch}</span>
          <button
            className={`panel-refresh-btn${refreshing ? ' refreshing' : ''}`}
            onClick={(e) => { e.stopPropagation(); handleRefresh() }}
            disabled={refreshing}
            style={{ marginLeft: 'auto' }}
          >
            <IconRefresh />
            {t('refresh', { ns: 'common' })}
          </button>
        </div>
      </div>

      <div className="checks-body">
        <JiraSection result={jiraResult} prState={pr.state} />

        {sync && pr.state === 'OPEN' && (
          <GitStatusSection
            pr={pr} sync={sync}
            pulling={pulling} onPull={handlePull}
            pushing={pushing} onPush={handlePush}
            markingReady={markingReady} onMarkReady={handleMarkReady}
          />
        )}
        {pushError && (
          <PushErrorPanel
            message={pushError}
            onDismiss={() => dispatch({ type: 'SET_PUSH_ERROR', message: null })}
          />
        )}

        {deployments.length > 0 && <DeploymentsSection deployments={deployments} />}

        {pr.state === 'OPEN' && (
          lastUpdated === null ? (
            <div className="checks-section">
              <div className="checks-section-header">
                <span className="skeleton-bar" style={{ width: 56, height: 10 }} />
              </div>
              <div className="checks-rows">
                {([1, 2, 3] as const).map((i) => (
                  <div key={i} className="skeleton-row">
                    <span className="skeleton-dot" />
                    <span className="skeleton-bar skeleton-bar--flex" style={{ maxWidth: i === 1 ? 180 : i === 2 ? 220 : 150 }} />
                    <span className="skeleton-bar skeleton-bar--sm" />
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <ChecksSection
              checks={checks}
              onSelectCheck={openLog}
              openingLog={openingLog}
              onFixWithAI={fixWithAI}
              fixingCheck={fixingCheck}
            />
          )
        )}

        {pr.state === 'MERGED' && (
          <div className="checks-empty" style={{ padding: '16px 14px', color: '#a371f7' }}>
            {t('prMerged')}
          </div>
        )}
        {pr.state === 'CLOSED' && (
          <div className="checks-empty" style={{ padding: '16px 14px', color: 'var(--red)' }}>
            {t('prClosed')}
          </div>
        )}
      </div>

      {lastUpdated && (
        <div className="checks-footer">
          <span className="checks-last-updated">
            {t('updatedAt', { time: lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) })}
          </span>
        </div>
      )}
    </div>
  )
}
