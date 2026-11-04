// Installs the braid-browser skill stub into agent skill folders.
//
// Safety rules (same spirit as package managers that share folders with users):
//  - A copy is Braid's "untouched copy" only when its folder holds just SKILL.md
//    and that file matches a version Braid has written (digest in the manifest).
//    Only those copies are rewritten or removed.
//  - Anything else is left alone and reported (edited copy / different skill).
//  - Braid only deletes folders it created, and only when empty.
//  - Symlinked folders are never followed or modified.
import { createHash } from 'crypto'
import * as nodeFs from 'fs'
import { homedir } from 'os'
import { basename, dirname, join } from 'path'
import { SKILL_NAME, skillStub } from './skillContent'
import { allProviderCommands, resolveSkillTargets } from './skillProviders'
import { findCommands } from '../../../lib/cliCommandDetection'

/** Real path through the nearest existing ancestor (linked agent folders resolve to one target). */
function realPathOf(fs: SkillFs, p: string): string {
  const missing: string[] = []
  for (let current = p; ; current = dirname(current)) {
    try { return join(fs.realpathSync(current), ...[...missing].reverse()) } catch { /* not there yet */ }
    if (dirname(current) === current) return p
    missing.push(basename(current))
  }
}

export type SkillOutcome = 'installed' | 'updated' | 'unchanged' | 'removed' | 'edited' | 'foreign' | 'failed'

export interface SkillLocationReport {
  agent: string
  /** Agents served by this folder (several for the shared ~/.agents/skills). */
  agents: string[]
  path: string
  outcome: SkillOutcome
  error?: string
}

export interface SkillFs {
  existsSync(p: string): boolean
  realpathSync(p: string): string
  lstatSync(p: string): { isSymbolicLink(): boolean; isDirectory(): boolean }
  readdirSync(p: string): string[]
  readFileSync(p: string, enc: 'utf8'): string
  writeFileSync(p: string, data: string): void
  mkdirSync(p: string, opts: { recursive: true }): unknown
  unlinkSync(p: string): void
  rmdirSync(p: string): void
}

interface Manifest {
  /** Digests of every SKILL.md version Braid has written. */
  digests: string[]
  /** Skill folders Braid created (eligible for removal when empty). */
  created: string[]
}

export function digest(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

function manifestPath(home: string): string {
  return join(home, '.braid', 'skills', 'manifest.json')
}

function readManifest(fs: SkillFs, home: string): Manifest {
  try {
    const m = JSON.parse(fs.readFileSync(manifestPath(home), 'utf8')) as Partial<Manifest>
    return { digests: Array.isArray(m.digests) ? m.digests : [], created: Array.isArray(m.created) ? m.created : [] }
  } catch {
    return { digests: [], created: [] }
  }
}

function writeManifest(fs: SkillFs, home: string, m: Manifest): void {
  fs.mkdirSync(join(home, '.braid', 'skills'), { recursive: true })
  fs.writeFileSync(manifestPath(home), JSON.stringify(m, null, 2))
}

type CopyState = 'absent' | 'ours-current' | 'ours-old' | 'edited' | 'foreign'

function frontmatterName(content: string): string | null {
  const m = content.match(/^---\s*\n([\s\S]*?)\n---/)
  const name = m?.[1].match(/^name:\s*(.+)$/m)?.[1].trim()
  return name ? name.replace(/^["']|["']$/g, '') : null
}

function classify(fs: SkillFs, folder: string, manifest: Manifest, current: string): CopyState {
  if (!fs.existsSync(folder)) return 'absent'
  const stat = fs.lstatSync(folder)
  if (stat.isSymbolicLink() || !stat.isDirectory()) return 'foreign'
  const files = fs.readdirSync(folder).filter((f) => f !== '.DS_Store')
  if (!files.includes('SKILL.md')) return files.length === 0 ? 'absent' : 'foreign'
  const content = fs.readFileSync(join(folder, 'SKILL.md'), 'utf8')
  const name = frontmatterName(content)
  if (name && name !== SKILL_NAME) return 'foreign'
  if (files.length !== 1) return 'edited'
  const d = digest(content)
  if (d === current) return 'ours-current'
  return manifest.digests.includes(d) ? 'ours-old' : 'edited'
}

/** Install/update (enabled) or remove (disabled) Braid's skill copies. */
export function syncBrowserSkill(
  enabled: boolean,
  opts: { fs?: SkillFs; home?: string; env?: NodeJS.ProcessEnv; foundCommands?: ReadonlySet<string> } = {},
): SkillLocationReport[] {
  const fs = opts.fs ?? (nodeFs as unknown as SkillFs)
  const home = opts.home ?? homedir()
  const content = skillStub()
  const current = digest(content)
  const manifest = readManifest(fs, home)
  if (enabled && !manifest.digests.includes(current)) manifest.digests.push(current)
  const reports: SkillLocationReport[] = []

  // Dedupe by real folder: a linked agent folder (e.g. ~/.claude/skills -> ~/.agents/skills)
  // is one target serving several agents.
  const seen = new Map<string, SkillLocationReport | null>()
  const env = opts.env ?? process.env
  const found = opts.foundCommands ?? new Set(findCommands(allProviderCommands(), { pathEnv: env.PATH, home }).keys())
  for (const loc of resolveSkillTargets(found, home, env)) {
    const real = realPathOf(fs, loc.skillsDir)
    if (seen.has(real)) {
      const prior = seen.get(real)
      if (prior) prior.agents.push(...loc.agents)
      continue
    }
    seen.set(real, null)
    const folder = join(loc.skillsDir, SKILL_NAME)
    const file = join(folder, 'SKILL.md')
    const report = (r: SkillLocationReport) => { reports.push(r); seen.set(real, r) }
    try {
      const state = classify(fs, folder, manifest, current)
      if (!enabled) {
        if (state === 'ours-current' || state === 'ours-old') {
          fs.unlinkSync(file)
          if (manifest.created.includes(folder) && fs.readdirSync(folder).filter((f) => f !== '.DS_Store').length === 0) {
            fs.rmdirSync(folder)
            manifest.created = manifest.created.filter((f) => f !== folder)
          }
          report({ agent: loc.agent, agents: [...loc.agents], path: folder, outcome: 'removed' })
        } else if (state === 'edited' || state === 'foreign') {
          report({ agent: loc.agent, agents: [...loc.agents], path: folder, outcome: state })
        }
        continue
      }
      if (state === 'absent') {
        const existed = fs.existsSync(folder)
        fs.mkdirSync(folder, { recursive: true })
        fs.writeFileSync(file, content)
        if (!existed && !manifest.created.includes(folder)) manifest.created.push(folder)
        report({ agent: loc.agent, agents: [...loc.agents], path: folder, outcome: 'installed' })
      } else if (state === 'ours-old') {
        fs.writeFileSync(file, content)
        report({ agent: loc.agent, agents: [...loc.agents], path: folder, outcome: 'updated' })
      } else if (state === 'ours-current') {
        report({ agent: loc.agent, agents: [...loc.agents], path: folder, outcome: 'unchanged' })
      } else {
        report({ agent: loc.agent, agents: [...loc.agents], path: folder, outcome: state })
      }
    } catch (err) {
      report({ agent: loc.agent, agents: [...loc.agents], path: folder, outcome: 'failed', error: err instanceof Error ? err.message : String(err) })
    }
  }
  try { writeManifest(fs, home, manifest) } catch { /* next run re-derives what it can */ }
  return reports
}
