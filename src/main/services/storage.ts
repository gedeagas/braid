import { app } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { DATA_DIR_NAME } from '../appBrand'
import { logger } from '../lib/logger'

export interface StorageLspServerConfig {
  id: string
  label: string
  command: string
  args: string[]
  extensions: string[]
  detectFiles: string[]
  languageId: string
}

export interface StorageProjectSettings {
  workspacesPath: string
  defaultBaseBranch: string
  branchPrefix: string
  remoteOrigin: string
  setupScript: string
  runScript: string
  archiveScript: string
  copyFiles: string[]
  lspServers?: StorageLspServerConfig[]
  lspDisabled?: boolean
}

export interface StorageData {
  projects: Array<{
    id: string
    name: string
    path: string
    createdAt: number
    settings?: StorageProjectSettings
    avatarUrl?: string
  }>
}

const DEFAULT_DATA: StorageData = { projects: [] }

class StorageService {
  private configDir: string
  private configPath: string
  private worktreeIdsPath: string

  constructor() {
    this.configDir = join(app?.getPath('home') ?? process.env.HOME ?? '~', DATA_DIR_NAME)
    this.configPath = join(this.configDir, 'config.json')
    this.worktreeIdsPath = join(this.configDir, 'worktree-ids.json')
  }

  load(): StorageData {
    try {
      if (!existsSync(this.configPath)) {
        return DEFAULT_DATA
      }
      const raw = readFileSync(this.configPath, 'utf-8')
      return JSON.parse(raw) as StorageData
    } catch {
      return DEFAULT_DATA
    }
  }

  save(data: StorageData): void {
    mkdirSync(this.configDir, { recursive: true })
    writeFileSync(this.configPath, JSON.stringify(data, null, 2), 'utf-8')
  }

  getWorktreeBaseDir(projectName: string): string {
    return join(this.configDir, 'worktrees', projectName)
  }

  /**
   * Stable worktree-id registry (worktree path -> renderer-assigned id).
   *
   * The renderer is the authority for worktree ids (it mints them and keys
   * sessions/terminals by them). It mirrors the registry here so the main
   * process - and therefore the mobile RPC (`projects.list`) - can return the
   * same id the desktop uses. Without this, mobile-created terminals carry an
   * undefined worktreeId and never bind to a desktop worktree.
   */
  loadWorktreeIds(): Record<string, string> {
    try {
      if (!existsSync(this.worktreeIdsPath)) return {}
      const raw = readFileSync(this.worktreeIdsPath, 'utf-8')
      const parsed = JSON.parse(raw) as unknown
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : {}
    } catch {
      return {}
    }
  }

  saveWorktreeIds(map: Record<string, string>): void {
    // Best-effort cache (see loadWorktreeIds): an unwritable config dir (bad
    // permissions, disk full) must not crash the main process. Swallow and log.
    try {
      mkdirSync(this.configDir, { recursive: true })
      writeFileSync(this.worktreeIdsPath, JSON.stringify(map, null, 2), 'utf-8')
    } catch (err) {
      logger.warn('[storage] failed to persist worktree id registry:', err)
    }
  }
}

export const storageService = new StorageService()
