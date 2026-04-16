/**
 * ACP agent configuration storage.
 *
 * Persists registered ACP agents to ~/Braid/acp-agents.json.
 * Follows the same pattern as storage.ts (JSON file in the Braid data dir).
 */

import { app } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { DATA_DIR_NAME } from '../appBrand'
import type { AcpAgentConfig } from './agentTypes'

class AcpConfigService {
  private configDir: string
  private configPath: string

  constructor() {
    this.configDir = join(app?.getPath('home') ?? process.env.HOME ?? '~', DATA_DIR_NAME)
    this.configPath = join(this.configDir, 'acp-agents.json')
  }

  load(): AcpAgentConfig[] {
    try {
      if (!existsSync(this.configPath)) return []
      const raw = readFileSync(this.configPath, 'utf-8')
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }

  save(agents: AcpAgentConfig[]): void {
    mkdirSync(this.configDir, { recursive: true })
    writeFileSync(this.configPath, JSON.stringify(agents, null, 2), 'utf-8')
  }

  get(id: string): AcpAgentConfig | undefined {
    return this.load().find((a) => a.id === id)
  }
}

export const acpConfigService = new AcpConfigService()
