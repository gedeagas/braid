import os from 'node:os'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import { app } from 'electron'
import type { AppMemory, HostMemory, ResourceSnapshot } from '../../../shared/rate-limit-types'
import { ptyService } from '../pty'

const execAsync = promisify(exec)
const PS_TIMEOUT_MS = 5_000
const PS_MAX_BUFFER = 10 * 1024 * 1024
const HISTORY_CAPACITY = 60

export type PtyUsage = {
  ptyId: string
  cwd: string
  pid: number | null
  cpu: number
  memory: number
}

type ProcRow = { pid: number; ppid: number; cpu: number; memory: number }
type ProcIndex = { byPid: Map<number, ProcRow>; childrenOf: Map<number, number[]> }

function clamp(v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return 0
  return Math.max(0, v)
}

function hostMetrics(): HostMemory {
  const total = clamp(os.totalmem())
  const free = clamp(os.freemem())
  const used = Math.max(0, total - free)
  return {
    totalMemory: total, freeMemory: free, usedMemory: used,
    memoryUsagePercent: total > 0 ? (used / total) * 100 : 0,
    cpuCoreCount: Math.max(1, os.cpus().length),
    loadAverage1m: clamp(os.loadavg()[0]),
  }
}

function bucketElectronMetrics(): AppMemory {
  const main = { cpu: 0, memory: 0 }
  const renderer = { cpu: 0, memory: 0 }
  const other = { cpu: 0, memory: 0 }
  for (const proc of app.getAppMetrics()) {
    const cpu = clamp(proc.cpu?.percentCPUUsage)
    const memoryBytes = clamp(proc.memory?.workingSetSize) * 1024
    const type = (typeof proc.type === 'string' ? proc.type : '').toLowerCase()
    let target = other
    if (type === 'browser') target = main
    else if (type === 'renderer' || type === 'tab') target = renderer
    target.cpu += cpu
    target.memory += memoryBytes
  }
  return {
    main, renderer, other,
    cpu: main.cpu + renderer.cpu + other.cpu,
    memory: main.memory + renderer.memory + other.memory,
    history: [],
  }
}

// -- History ring buffers --

const APP_HISTORY_KEY = '__app__'
const historyByKey = new Map<string, number[]>()

function pushHistory(key: string, memBytes: number): void {
  let arr = historyByKey.get(key)
  if (!arr) { arr = []; historyByKey.set(key, arr) }
  arr.push(memBytes)
  if (arr.length > HISTORY_CAPACITY) arr.shift()
}

function readHistory(key: string): number[] {
  return [...(historyByKey.get(key) ?? [])]
}

// -- Process enumeration via `ps` (Unix) --

async function enumerateProcesses(): Promise<ProcIndex> {
  const byPid = new Map<number, ProcRow>()
  const childrenOf = new Map<number, number[]>()
  if (process.platform === 'win32') return { byPid, childrenOf }
  try {
    const { stdout } = await execAsync('ps -eo pid=,ppid=,pcpu=,rss=', {
      maxBuffer: PS_MAX_BUFFER, timeout: PS_TIMEOUT_MS,
      env: { ...process.env, LC_ALL: 'C', LANG: 'C' },
    })
    for (const line of stdout.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue
      const fields = trimmed.split(/\s+/, 4)
      if (fields.length < 4) continue
      const pid = parseInt(fields[0], 10)
      const ppid = parseInt(fields[1], 10)
      const cpu = parseFloat(fields[2])
      const rssKb = parseInt(fields[3], 10)
      if (isNaN(pid) || isNaN(ppid)) continue
      const row: ProcRow = {
        pid, ppid,
        cpu: isFinite(cpu) && cpu > 0 ? cpu : 0,
        memory: isFinite(rssKb) && rssKb > 0 ? rssKb * 1024 : 0,
      }
      byPid.set(pid, row)
      const siblings = childrenOf.get(ppid)
      if (siblings) siblings.push(pid)
      else childrenOf.set(ppid, [pid])
    }
  } catch { /* ps failed */ }
  return { byPid, childrenOf }
}

function collectSubtree(index: ProcIndex, root: number): number[] {
  const result: number[] = []
  const seen = new Set<number>()
  const queue = [root]
  while (queue.length > 0) {
    const pid = queue.pop()!
    if (seen.has(pid)) continue
    seen.add(pid)
    if (index.byPid.has(pid)) result.push(pid)
    const kids = index.childrenOf.get(pid)
    if (kids) queue.push(...kids)
  }
  return result
}

// -- Public API --

let inflight: Promise<ResourceSnapshot> | null = null

export async function collectResourceSnapshot(): Promise<ResourceSnapshot> {
  if (inflight) return inflight
  inflight = runSnapshot().catch(() => emptySnapshot()).finally(() => { inflight = null })
  return inflight
}

function emptySnapshot(): ResourceSnapshot {
  const zero = { cpu: 0, memory: 0 }
  return {
    app: { ...zero, main: zero, renderer: zero, other: zero, history: [] },
    ptyUsage: [],
    host: hostMetrics(),
    totalCpu: 0, totalMemory: 0, collectedAt: Date.now(),
  }
}

async function runSnapshot(): Promise<ResourceSnapshot> {
  const processIndex = await enumerateProcesses()
  const appBuckets = bucketElectronMetrics()
  const ptyInstances = ptyService.listInstancesWithPid()
  const claimed = new Set<number>()
  const ptyUsages: PtyUsage[] = []

  for (const inst of ptyInstances) {
    let sessionCpu = 0
    let sessionMemory = 0
    if (inst.pid != null) {
      for (const pid of collectSubtree(processIndex, inst.pid)) {
        if (claimed.has(pid)) continue
        const row = processIndex.byPid.get(pid)
        if (!row) continue
        claimed.add(pid)
        sessionCpu += row.cpu
        sessionMemory += row.memory
      }
    }
    ptyUsages.push({
      ptyId: inst.ptyId, cwd: inst.cwd, pid: inst.pid,
      cpu: clamp(sessionCpu), memory: clamp(sessionMemory),
    })
  }

  let sessionCpuTotal = 0
  let sessionMemTotal = 0
  for (const p of ptyUsages) { sessionCpuTotal += p.cpu; sessionMemTotal += p.memory }

  pushHistory(APP_HISTORY_KEY, appBuckets.memory)

  return {
    app: { ...appBuckets, history: readHistory(APP_HISTORY_KEY) },
    ptyUsage: ptyUsages,
    host: hostMetrics(),
    totalCpu: appBuckets.cpu + sessionCpuTotal,
    totalMemory: appBuckets.memory + sessionMemTotal,
    collectedAt: Date.now(),
  }
}
