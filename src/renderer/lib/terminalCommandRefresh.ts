import { jira } from '@/lib/ipc'
import { useProjectsStore } from '@/store/projects'
import { classifyCliRefreshCommand, type CliRefreshPlan } from './cliRefresh'
import { requestWorktreeRefresh } from './worktreeRefresh'

interface ApplyOptions {
  refreshWorktrees?: boolean
}

export interface TerminalCommandObserver {
  accept: (data: string) => void
  dispose: () => void
}

const FOLLOW_UP_DELAYS_MS = [1_200, 4_000]

function applyCliRefreshPlan(
  worktreePath: string,
  plan: CliRefreshPlan,
  options: ApplyOptions = {}
): void {
  if (plan.invalidateJiraCache) {
    void jira.invalidateCache().catch(() => {})
  }

  requestWorktreeRefresh(worktreePath, plan.resources, {
    reason: plan.reason,
    force: plan.force,
  })

  if (options.refreshWorktrees && plan.refreshWorktrees) {
    const project = useProjectsStore.getState().projects.find((p) =>
      p.worktrees.some((w) => w.path === worktreePath)
    )
    if (project) void useProjectsStore.getState().refreshWorktrees(project.id).catch(() => {})
  }
}

export function triggerCliCommandRefresh(worktreePath: string, command: string, options?: ApplyOptions): boolean {
  const plan = classifyCliRefreshCommand(command)
  if (!plan) return false
  applyCliRefreshPlan(worktreePath, plan, options)
  return true
}

export function scheduleTerminalCommandRefresh(
  worktreePath: string,
  command: string,
  options?: ApplyOptions
): Array<ReturnType<typeof setTimeout>> {
  const plan = classifyCliRefreshCommand(command)
  if (!plan) return []

  return FOLLOW_UP_DELAYS_MS.map((delay) => setTimeout(() => {
    applyCliRefreshPlan(worktreePath, plan, options)
  }, delay))
}

function stripPasteMarkers(input: string): string {
  return input
    .replace(/\x1b\[200~/g, '')
    .replace(/\x1b\[201~/g, '')
}

export function createTerminalCommandObserver(
  worktreePath: string,
  options: ApplyOptions = {}
): TerminalCommandObserver {
  let line = ''
  let disposed = false
  const timers = new Set<ReturnType<typeof setTimeout>>()

  const schedule = (command: string) => {
    if (disposed) return
    const plan = classifyCliRefreshCommand(command)
    if (!plan) return
    for (const delay of FOLLOW_UP_DELAYS_MS) {
      const timer = setTimeout(() => {
        timers.delete(timer)
        if (disposed) return
        applyCliRefreshPlan(worktreePath, plan, options)
      }, delay)
      timers.add(timer)
    }
  }

  const accept = (data: string) => {
    if (disposed) return
    const input = stripPasteMarkers(data)
    for (let i = 0; i < input.length; i += 1) {
      const ch = input[i]
      if (ch === '\u0003') {
        line = ''
        continue
      }
      if (ch === '\r' || ch === '\n') {
        const command = line.trim()
        line = ''
        if (command) schedule(command)
        continue
      }
      if (ch === '\u007f' || ch === '\b') {
        line = line.slice(0, -1)
        continue
      }
      if (ch === '\x1b') {
        while (i + 1 < input.length && !/[A-Za-z~]/.test(input[i + 1])) i += 1
        if (i + 1 < input.length) i += 1
        continue
      }
      if (ch >= ' ') line += ch
    }
  }

  const dispose = () => {
    disposed = true
    for (const timer of timers) clearTimeout(timer)
    timers.clear()
  }

  return { accept, dispose }
}
