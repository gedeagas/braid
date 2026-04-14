import { app } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { DATA_DIR_NAME } from '../appBrand'

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
  }>
}

const DEFAULT_DATA: StorageData = { projects: [] }

class StorageService {
  private configDir: string
  private configPath: string

  constructor() {
    this.configDir = join(app?.getPath('home') ?? process.env.HOME ?? '~', DATA_DIR_NAME)
    this.configPath = join(this.configDir, 'config.json')
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
}

export const storageService = new StorageService()
