export type WorktreeResource =
  | 'files'
  | 'gitStatus'
  | 'syncStatus'
  | 'pr'
  | 'checks'
  | 'jira'
  | 'worktrees'

export type WorktreeRefreshTopic = WorktreeResource
export type WorktreeResourceKey = `worktree:${string}:${WorktreeResource}`

export type WorktreeRefreshReason =
  | 'manual'
  | 'poll'
  | 'online'
  | 'agent-done'
  | 'git-mutation'
  | 'pr-mutation'
  | 'jira-mutation'
  | 'external'

export interface WorktreeRefreshEvent {
  worktreePath: string
  topic: WorktreeResource
  resource: WorktreeResource
  topics: WorktreeResource[]
  resources: WorktreeResource[]
  resourceKey: WorktreeResourceKey
  resourceKeys: WorktreeResourceKey[]
  reason: WorktreeRefreshReason
  force: boolean
  requestedAt: number
}

export interface WorktreeResourcePolicy {
  staleTimeMs: number
}

export interface WorktreeRefreshMetrics {
  resourceKey: WorktreeResourceKey
  worktreePath: string
  resource: WorktreeResource
  observerCount: number
  requestCount: number
  dispatchCount: number
  completionCount: number
  errorCount: number
  skippedFreshCount: number
  dedupedInFlightCount: number
  lastRequestedAt: number
  lastStartedAt: number
  lastCompletedAt: number
  lastReason: WorktreeRefreshReason | null
  inFlight: boolean
  pending: boolean
}

type WorktreeRefreshHandler = (event: WorktreeRefreshEvent) => void | Promise<void>

interface PendingWorktreeRefresh {
  resources: Set<WorktreeResource>
  reason: WorktreeRefreshReason
  force: boolean
  requestedAt: number
  timer: ReturnType<typeof setTimeout>
}

interface QueuedResourceRefresh {
  reason: WorktreeRefreshReason
  force: boolean
  requestedAt: number
}

interface WorktreeResourceState {
  key: WorktreeResourceKey
  worktreePath: string
  resource: WorktreeResource
  inFlight: Promise<void> | null
  queued: QueuedResourceRefresh | null
  requestCount: number
  dispatchCount: number
  completionCount: number
  errorCount: number
  skippedFreshCount: number
  dedupedInFlightCount: number
  lastRequestedAt: number
  lastStartedAt: number
  lastCompletedAt: number
  lastReason: WorktreeRefreshReason | null
}

export const WORKTREE_RESOURCE_POLICIES: Record<WorktreeResource, WorktreeResourcePolicy> = {
  files: { staleTimeMs: 5_000 },
  gitStatus: { staleTimeMs: 1_000 },
  syncStatus: { staleTimeMs: 15_000 },
  pr: { staleTimeMs: 30_000 },
  checks: { staleTimeMs: 30_000 },
  jira: { staleTimeMs: 30_000 },
  worktrees: { staleTimeMs: 15_000 },
}

const REASON_PRIORITY: Record<WorktreeRefreshReason, number> = {
  manual: 6,
  'agent-done': 5,
  'git-mutation': 4,
  'pr-mutation': 4,
  'jira-mutation': 4,
  online: 3,
  external: 2,
  poll: 1,
}

const observers = new Map<WorktreeResourceKey, Set<WorktreeRefreshHandler>>()
const resourceStates = new Map<WorktreeResourceKey, WorktreeResourceState>()
const pendingRefreshes = new Map<string, PendingWorktreeRefresh>()
const ALL_WORKTREE_RESOURCES = Object.keys(WORKTREE_RESOURCE_POLICIES) as WorktreeResource[]

export function worktreeResourceKey(
  worktreePath: string,
  resource: WorktreeResource
): WorktreeResourceKey {
  return `worktree:${worktreePath}:${resource}`
}

function asResources(resources: WorktreeResource | WorktreeResource[]): WorktreeResource[] {
  return Array.isArray(resources) ? resources : [resources]
}

function mergeReason(
  current: WorktreeRefreshReason,
  next: WorktreeRefreshReason | undefined
): WorktreeRefreshReason {
  if (!next) return current
  return REASON_PRIORITY[next] > REASON_PRIORITY[current] ? next : current
}

function getResourceState(worktreePath: string, resource: WorktreeResource): WorktreeResourceState {
  const key = worktreeResourceKey(worktreePath, resource)
  let state = resourceStates.get(key)
  if (!state) {
    state = {
      key,
      worktreePath,
      resource,
      inFlight: null,
      queued: null,
      requestCount: 0,
      dispatchCount: 0,
      completionCount: 0,
      errorCount: 0,
      skippedFreshCount: 0,
      dedupedInFlightCount: 0,
      lastRequestedAt: 0,
      lastStartedAt: 0,
      lastCompletedAt: 0,
      lastReason: null,
    }
    resourceStates.set(key, state)
  }
  return state
}

function observerSet(
  worktreePath: string,
  resource: WorktreeResource,
  create: boolean
): Set<WorktreeRefreshHandler> | null {
  const key = worktreeResourceKey(worktreePath, resource)
  let handlers = observers.get(key)
  if (!handlers) {
    if (!create) return null
    handlers = new Set()
    observers.set(key, handlers)
  }
  getResourceState(worktreePath, resource)
  return handlers
}

function isFresh(state: WorktreeResourceState, now: number): boolean {
  if (state.lastCompletedAt === 0) return false
  return now - state.lastCompletedAt < WORKTREE_RESOURCE_POLICIES[state.resource].staleTimeMs
}

function mergeQueuedRefresh(
  current: QueuedResourceRefresh | null,
  next: QueuedResourceRefresh
): QueuedResourceRefresh {
  if (!current) return next
  return {
    reason: mergeReason(current.reason, next.reason),
    force: current.force || next.force,
    requestedAt: Math.min(current.requestedAt, next.requestedAt),
  }
}

function addObserverEvent(
  events: Map<WorktreeRefreshHandler, WorktreeRefreshEvent>,
  handler: WorktreeRefreshHandler,
  event: WorktreeRefreshEvent
): void {
  const existing = events.get(handler)
  if (!existing) {
    events.set(handler, event)
    return
  }

  for (const resource of event.resources) {
    if (!existing.resources.includes(resource)) existing.resources.push(resource)
  }
  for (const topic of event.topics) {
    if (!existing.topics.includes(topic)) existing.topics.push(topic)
  }
  for (const key of event.resourceKeys) {
    if (!existing.resourceKeys.includes(key)) existing.resourceKeys.push(key)
  }
  existing.force = existing.force || event.force
  existing.reason = mergeReason(existing.reason, event.reason)
  existing.requestedAt = Math.min(existing.requestedAt, event.requestedAt)
}

function queueInFlightRefresh(
  state: WorktreeResourceState,
  pending: PendingWorktreeRefresh
): void {
  state.dedupedInFlightCount += 1
  state.queued = mergeQueuedRefresh(state.queued, {
    reason: pending.reason,
    force: pending.force,
    requestedAt: pending.requestedAt,
  })
}

function completeResourceDispatch(
  state: WorktreeResourceState,
  promise: Promise<void>
): void {
  if (state.inFlight !== promise) return
  state.inFlight = null
  state.completionCount += 1
  state.lastCompletedAt = Date.now()

  const queued = state.queued
  state.queued = null
  if (queued) {
    requestWorktreeRefresh(state.worktreePath, state.resource, {
      reason: queued.reason,
      force: queued.force,
    })
  }
}

function flushWorktreeRefresh(worktreePath: string): void {
  const pending = pendingRefreshes.get(worktreePath)
  if (!pending) return
  pendingRefreshes.delete(worktreePath)

  const now = Date.now()
  const observerEvents = new Map<WorktreeRefreshHandler, WorktreeRefreshEvent>()
  const resourceHandlers = new Map<WorktreeResource, Set<WorktreeRefreshHandler>>()

  for (const resource of pending.resources) {
    const state = getResourceState(worktreePath, resource)
    state.requestCount += 1
    state.lastRequestedAt = pending.requestedAt
    state.lastReason = pending.reason

    if (state.inFlight) {
      queueInFlightRefresh(state, pending)
      continue
    }

    if (!pending.force && isFresh(state, now)) {
      state.skippedFreshCount += 1
      continue
    }

    const handlers = observerSet(worktreePath, resource, false)
    if (!handlers || handlers.size === 0) continue

    state.dispatchCount += 1
    state.lastStartedAt = now

    const key = worktreeResourceKey(worktreePath, resource)
    for (const handler of [...handlers]) {
      let handlersForResource = resourceHandlers.get(resource)
      if (!handlersForResource) {
        handlersForResource = new Set()
        resourceHandlers.set(resource, handlersForResource)
      }
      handlersForResource.add(handler)

      addObserverEvent(observerEvents, handler, {
        worktreePath,
        topic: resource,
        resource,
        topics: [resource],
        resources: [resource],
        resourceKey: key,
        resourceKeys: [key],
        reason: pending.reason,
        force: pending.force,
        requestedAt: pending.requestedAt,
      })
    }
  }

  const handlerPromises = new Map<WorktreeRefreshHandler, Promise<void>>()
  for (const [handler, event] of observerEvents) {
    const promise = Promise.resolve()
      .then(() => handler(event))
      .then(() => {})
      .catch((err) => {
        for (const resource of event.resources) {
          getResourceState(worktreePath, resource).errorCount += 1
        }
        console.warn('[worktreeRefresh] refresh observer failed:', err)
      })
    handlerPromises.set(handler, promise)
  }

  for (const [resource, handlersForResource] of resourceHandlers) {
    const state = getResourceState(worktreePath, resource)
    const promises = [...handlersForResource]
      .map((handler) => handlerPromises.get(handler))
      .filter((promise): promise is Promise<void> => Boolean(promise))
    if (promises.length === 0) continue

    const inFlight = Promise.allSettled(promises).then(() => {})
    state.inFlight = inFlight
    inFlight.finally(() => completeResourceDispatch(state, inFlight))
  }
}

export function requestWorktreeRefresh(
  worktreePath: string | null | undefined,
  resources: WorktreeResource | WorktreeResource[],
  options: { reason?: WorktreeRefreshReason; force?: boolean } = {}
): void {
  if (!worktreePath) return

  const now = Date.now()
  const existing = pendingRefreshes.get(worktreePath)
  if (existing) {
    for (const resource of asResources(resources)) existing.resources.add(resource)
    existing.force = existing.force || options.force === true
    existing.reason = mergeReason(existing.reason, options.reason)
    existing.requestedAt = Math.min(existing.requestedAt, now)
    return
  }

  const pending: PendingWorktreeRefresh = {
    resources: new Set(asResources(resources)),
    reason: options.reason ?? 'external',
    force: options.force === true,
    requestedAt: now,
    timer: setTimeout(() => flushWorktreeRefresh(worktreePath), 0),
  }
  pendingRefreshes.set(worktreePath, pending)
}

export function subscribeWorktreeRefresh(
  worktreePath: string | null | undefined,
  resources: WorktreeResource | WorktreeResource[],
  handler: WorktreeRefreshHandler
): () => void {
  if (!worktreePath) return () => {}

  const sets = asResources(resources).map((resource) => observerSet(worktreePath, resource, true)!)
  for (const handlers of sets) handlers.add(handler)

  return () => {
    for (const handlers of sets) handlers.delete(handler)
    for (const resource of asResources(resources)) {
      const key = worktreeResourceKey(worktreePath, resource)
      const handlers = observers.get(key)
      if (handlers && handlers.size === 0) observers.delete(key)
    }
  }
}

export function getWorktreeRefreshMetrics(): WorktreeRefreshMetrics[] {
  return [...resourceStates.values()].map((state) => ({
    resourceKey: state.key,
    worktreePath: state.worktreePath,
    resource: state.resource,
    observerCount: observers.get(state.key)?.size ?? 0,
    requestCount: state.requestCount,
    dispatchCount: state.dispatchCount,
    completionCount: state.completionCount,
    errorCount: state.errorCount,
    skippedFreshCount: state.skippedFreshCount,
    dedupedInFlightCount: state.dedupedInFlightCount,
    lastRequestedAt: state.lastRequestedAt,
    lastStartedAt: state.lastStartedAt,
    lastCompletedAt: state.lastCompletedAt,
    lastReason: state.lastReason,
    inFlight: state.inFlight !== null,
    pending: state.queued !== null,
  }))
}

export function cleanupWorktreeRefresh(worktreePath: string | null | undefined): void {
  if (!worktreePath) return

  const pending = pendingRefreshes.get(worktreePath)
  if (pending) {
    clearTimeout(pending.timer)
    pendingRefreshes.delete(worktreePath)
  }

  for (const resource of ALL_WORKTREE_RESOURCES) {
    const key = worktreeResourceKey(worktreePath, resource)
    observers.delete(key)
    resourceStates.delete(key)
  }
}

export function resetWorktreeRefreshForTests(): void {
  for (const pending of pendingRefreshes.values()) clearTimeout(pending.timer)
  pendingRefreshes.clear()
  observers.clear()
  resourceStates.clear()
}
