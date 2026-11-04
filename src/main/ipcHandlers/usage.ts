// Usage analytics, rate limits and resource usage IPC handlers, split out of ipc.ts.

import { ipcMain } from 'electron'
import { storageService } from '../services/storage'
import { ClaudeUsageStore } from '../services/claudeUsage'
import type { ClaudeUsageScope, ClaudeUsageRange, ClaudeUsageBreakdownKind } from '../../shared/claude-usage-types'
import { CodexUsageStore } from '../services/codexUsage'
import type { CodexUsageScope, CodexUsageRange, CodexUsageBreakdownKind } from '../../shared/codex-usage-types'
import { rateLimitService } from '../services/rateLimits/service'
import { collectResourceSnapshot } from '../services/rateLimits/resourceCollector'
import { execFile, type ExecFileOptionsWithStringEncoding } from 'child_process'

function execFileText(
  file: string,
  args: string[],
  options: ExecFileOptionsWithStringEncoding
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, args, options, (error, stdout) => {
      if (error) {
        reject(error)
        return
      }
      resolve(stdout)
    })
  })
}

export function registerUsageIpc(): void {
  // Usage Analytics (shared worktree provider)
  const usageWorktreeProvider = async () => {
    const data = storageService.load()
    const refs: Array<{ worktreeId: string; path: string; displayName: string }> = []
    for (const project of data.projects ?? []) {
      try {
        const output = await execFileText('git', ['worktree', 'list', '--porcelain'], {
          cwd: project.path,
          encoding: 'utf-8',
          timeout: 5000,
        })
        let currentPath: string | null = null
        let currentBranch: string | null = null
        for (const line of output.split('\n')) {
          if (line.startsWith('worktree ')) currentPath = line.slice(9)
          else if (line.startsWith('branch refs/heads/')) currentBranch = line.slice(18)
          else if (line === '' && currentPath) {
            refs.push({ worktreeId: `${project.id}:${currentPath}`, path: currentPath, displayName: currentBranch ? `${project.name}/${currentBranch}` : project.name })
            currentPath = null; currentBranch = null
          }
        }
        if (currentPath) refs.push({ worktreeId: `${project.id}:${currentPath}`, path: currentPath, displayName: currentBranch ? `${project.name}/${currentBranch}` : project.name })
      } catch { /* not a git repo */ }
    }
    return refs
  }

  const claudeUsageStore = new ClaudeUsageStore(usageWorktreeProvider)
  ipcMain.handle('claudeUsage:getScanState', () => claudeUsageStore.getScanState())
  ipcMain.handle('claudeUsage:setEnabled', (_e, args: { enabled: boolean }) =>
    claudeUsageStore.setEnabled(args.enabled)
  )
  ipcMain.handle('claudeUsage:clearData', () => claudeUsageStore.clearData())
  ipcMain.handle('claudeUsage:refresh', (_e, args?: { force?: boolean }) =>
    claudeUsageStore.refresh(args?.force ?? false)
  )
  ipcMain.handle('claudeUsage:getSnapshot', (_e, args: { scope: ClaudeUsageScope; range: ClaudeUsageRange; limit?: number; force?: boolean }) =>
    claudeUsageStore.getSnapshot(args.scope, args.range, args.limit, args.force ?? false)
  )
  ipcMain.handle('claudeUsage:getSummary', (_e, args: { scope: ClaudeUsageScope; range: ClaudeUsageRange }) =>
    claudeUsageStore.getSummary(args.scope, args.range)
  )
  ipcMain.handle('claudeUsage:getDaily', (_e, args: { scope: ClaudeUsageScope; range: ClaudeUsageRange }) =>
    claudeUsageStore.getDaily(args.scope, args.range)
  )
  ipcMain.handle('claudeUsage:getBreakdown', (_e, args: { scope: ClaudeUsageScope; range: ClaudeUsageRange; kind: ClaudeUsageBreakdownKind }) =>
    claudeUsageStore.getBreakdown(args.scope, args.range, args.kind)
  )
  ipcMain.handle('claudeUsage:getRecentSessions', (_e, args: { scope: ClaudeUsageScope; range: ClaudeUsageRange; limit?: number }) =>
    claudeUsageStore.getRecentSessions(args.scope, args.range, args.limit)
  )

  // Codex Usage Analytics
  const codexUsage = new CodexUsageStore(usageWorktreeProvider)

  ipcMain.handle('codexUsage:getScanState', () => codexUsage.getScanState())
  ipcMain.handle('codexUsage:setEnabled', (_e, args: { enabled: boolean }) =>
    codexUsage.setEnabled(args.enabled)
  )
  ipcMain.handle('codexUsage:clearData', () => codexUsage.clearData())
  ipcMain.handle('codexUsage:refresh', (_e, args?: { force?: boolean }) =>
    codexUsage.refresh(args?.force ?? false)
  )
  ipcMain.handle('codexUsage:getSnapshot', (_e, args: { scope: CodexUsageScope; range: CodexUsageRange; limit?: number; force?: boolean }) =>
    codexUsage.getSnapshot(args.scope, args.range, args.limit, args.force ?? false)
  )
  ipcMain.handle('codexUsage:getSummary', (_e, args: { scope: CodexUsageScope; range: CodexUsageRange }) =>
    codexUsage.getSummary(args.scope, args.range)
  )
  ipcMain.handle('codexUsage:getDaily', (_e, args: { scope: CodexUsageScope; range: CodexUsageRange }) =>
    codexUsage.getDaily(args.scope, args.range)
  )
  ipcMain.handle('codexUsage:getBreakdown', (_e, args: { scope: CodexUsageScope; range: CodexUsageRange; kind: CodexUsageBreakdownKind }) =>
    codexUsage.getBreakdown(args.scope, args.range, args.kind)
  )
  ipcMain.handle('codexUsage:getRecentSessions', (_e, args: { scope: CodexUsageScope; range: CodexUsageRange; limit?: number }) =>
    codexUsage.getRecentSessions(args.scope, args.range, args.limit)
  )

  // Rate Limits
  ipcMain.handle('rateLimits:get', () => rateLimitService.getState())
  ipcMain.handle('rateLimits:refresh', () => rateLimitService.refresh())

  // Resource Usage
  ipcMain.handle('resource:getSnapshot', () => collectResourceSnapshot())
}
