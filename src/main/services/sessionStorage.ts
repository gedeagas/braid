import { app } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, unlinkSync } from 'fs'
import { DATA_DIR_NAME } from '../appBrand'

export interface PersistedSession {
  id: string
  worktreeId: string
  name: string
  customName: boolean
  sdkSessionId?: string
  status: string
  model: string
  thinkingEnabled: boolean
  messages: unknown[]
  createdAt: number
  worktreePath: string
  totalRunDurationMs?: number
  pendingPlanApproval?: { toolUseId: string; planFilePath?: string }
  linkedWorktrees?: Array<{
    worktreeId: string
    projectId: string
    projectName: string
    branch: string
    path: string
  }>
  backend?: { type: 'claude-sdk' } | { type: 'acp' }
}

class SessionStorageService {
  private sessionsDir: string

  constructor() {
    this.sessionsDir = join(app?.getPath('home') ?? process.env.HOME ?? '~', DATA_DIR_NAME, 'sessions')
  }

  saveSession(data: PersistedSession): void {
    mkdirSync(this.sessionsDir, { recursive: true })
    const filePath = join(this.sessionsDir, `${data.id}.json`)
    writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8')
  }

  loadAllSessions(): PersistedSession[] {
    try {
      if (!existsSync(this.sessionsDir)) return []
      const files = readdirSync(this.sessionsDir).filter((f) => f.endsWith('.json'))
      const sessions: PersistedSession[] = []
      for (const file of files) {
        try {
          const raw = readFileSync(join(this.sessionsDir, file), 'utf-8')
          sessions.push(JSON.parse(raw) as PersistedSession)
        } catch {
          // Skip corrupted files
        }
      }
      return sessions
    } catch {
      return []
    }
  }

  deleteSession(sessionId: string): void {
    try {
      const filePath = join(this.sessionsDir, `${sessionId}.json`)
      if (existsSync(filePath)) {
        unlinkSync(filePath)
      }
    } catch {
      // Ignore deletion errors
    }
  }

  /** Bulk-delete every session file belonging to a given worktreeId */
  deleteSessionsByWorktree(worktreeId: string): number {
    let deleted = 0
    try {
      if (!existsSync(this.sessionsDir)) return 0
      const files = readdirSync(this.sessionsDir).filter((f) => f.endsWith('.json'))
      for (const file of files) {
        try {
          const raw = readFileSync(join(this.sessionsDir, file), 'utf-8')
          const session = JSON.parse(raw) as PersistedSession
          if (session.worktreeId === worktreeId) {
            unlinkSync(join(this.sessionsDir, file))
            deleted++
          }
        } catch {
          // Skip unreadable files
        }
      }
    } catch {
      // Ignore errors
    }
    return deleted
  }

  /** Delete all session files whose worktreeId doesn't appear in the given set */
  purgeOrphaned(activeWorktreeIds: Set<string>): number {
    let deleted = 0
    try {
      if (!existsSync(this.sessionsDir)) return 0
      const files = readdirSync(this.sessionsDir).filter((f) => f.endsWith('.json'))
      for (const file of files) {
        try {
          const raw = readFileSync(join(this.sessionsDir, file), 'utf-8')
          const session = JSON.parse(raw) as PersistedSession
          if (!activeWorktreeIds.has(session.worktreeId)) {
            unlinkSync(join(this.sessionsDir, file))
            deleted++
          }
        } catch {
          // Skip unreadable files
        }
      }
    } catch {
      // Ignore errors
    }
    return deleted
  }
}

export const sessionStorageService = new SessionStorageService()
