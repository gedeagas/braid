// Check that a saved agent conversation still exists before relaunching it,
// so a deleted transcript starts the agent fresh instead of failing with an
// error inside the terminal.
//
// Only says `missing` when it is sure. Anything it cannot see (another config
// dir, an agent without a known session store) is `unverifiable`, and the
// resume is attempted.

import { promises as fs } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import type { AgentResumeSession } from '../../../shared/agent-resume'

export type SessionVerdict = 'ok' | 'missing' | 'unverifiable'

export interface AgentConfigDirs {
  claudeConfigDir: string
  codexHome: string
}

export function defaultAgentConfigDirs(env: NodeJS.ProcessEnv = process.env): AgentConfigDirs {
  return {
    claudeConfigDir: env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'),
    codexHome: env.CODEX_HOME || join(homedir(), '.codex'),
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await fs.access(path)
    return true
  } catch {
    return false
  }
}

async function listDirs(path: string): Promise<string[] | null> {
  try {
    const entries = await fs.readdir(path, { withFileTypes: true })
    return entries.filter((e) => e.isDirectory()).map((e) => join(path, e.name))
  } catch {
    return null
  }
}

async function verifyClaude(session: AgentResumeSession, dirs: AgentConfigDirs): Promise<SessionVerdict> {
  if (session.transcriptPath && await exists(session.transcriptPath)) return 'ok'
  // The transcript lives at projects/<encoded cwd>/<id>.jsonl. Search every
  // project folder rather than re-deriving Claude's cwd encoding.
  const projects = await listDirs(join(dirs.claudeConfigDir, 'projects'))
  for (const dir of projects ?? []) {
    if (await exists(join(dir, `${session.id}.jsonl`))) return 'ok'
  }
  // Without a reported path the session may live in a config dir we can't see.
  return session.transcriptPath ? 'missing' : 'unverifiable'
}

async function verifyCodex(session: AgentResumeSession, dirs: AgentConfigDirs): Promise<SessionVerdict> {
  // Rollouts are stored as sessions/YYYY/MM/DD/rollout-<timestamp>-<id>.jsonl[.zst].
  const root = join(dirs.codexHome, 'sessions')
  const years = await listDirs(root)
  if (!years) return 'unverifiable'
  const suffixes = [`${session.id}.jsonl`, `${session.id}.jsonl.zst`]
  for (const year of years) {
    for (const month of (await listDirs(year)) ?? []) {
      for (const day of (await listDirs(month)) ?? []) {
        let files: string[] = []
        try { files = await fs.readdir(day) } catch { continue }
        if (files.some((f) => f.startsWith('rollout-') && suffixes.some((s) => f.endsWith(s)))) return 'ok'
      }
    }
  }
  return 'missing'
}

export async function verifyAgentSession(
  session: AgentResumeSession,
  dirs: AgentConfigDirs = defaultAgentConfigDirs(),
): Promise<SessionVerdict> {
  try {
    if (session.agent === 'claude') return await verifyClaude(session, dirs)
    if (session.agent === 'codex') return await verifyCodex(session, dirs)
  } catch {
    // Fall through: never block a resume on a verification error.
  }
  return 'unverifiable'
}
