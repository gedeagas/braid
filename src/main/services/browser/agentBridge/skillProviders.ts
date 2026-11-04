// Where agent CLIs look for user-level skills, and how to tell they're installed.
// An agent is detected when one of its CLI commands is found on PATH or in a
// well-known install folder (see lib/cliCommandDetection). Agents with
// `segments: null` read the shared ~/.agents/skills folder; the rest get a copy
// in their own folder when detected.
import { homedir } from 'os'
import { join } from 'path'

export interface SkillProvider {
  id: string
  displayName: string
  /** CLI commands that identify the agent (any one found = installed). */
  commands: readonly string[]
  /** Extra commands that must also exist (wrapper CLIs). */
  requires?: readonly string[]
  /** Path segments under $HOME for the agent's skills folder; null = shared ~/.agents/skills. */
  segments: readonly string[] | null
  /** Env var that relocates the agent's home (skills then live in `<home>/skills`). */
  homeEnv?: string
}

const own = (id: string, displayName: string, commands: string[], segments: string[], homeEnv?: string): SkillProvider =>
  ({ id, displayName, commands, segments, ...(homeEnv ? { homeEnv } : {}) })
const shared = (id: string, displayName: string, commands: string[], requires?: string[]): SkillProvider =>
  ({ id, displayName, commands, segments: null, ...(requires ? { requires } : {}) })

export const SKILL_PROVIDERS: readonly SkillProvider[] = [
  own('claude', 'Claude Code', ['claude'], ['.claude', 'skills'], 'CLAUDE_CONFIG_DIR'),
  own('cursor', 'Cursor', ['cursor-agent'], ['.cursor', 'skills']),
  own('gemini', 'Gemini CLI', ['gemini'], ['.gemini', 'skills']),
  own('droid', 'Droid', ['droid'], ['.factory', 'skills']),
  own('continue', 'Continue', ['cn'], ['.continue', 'skills']),
  own('trae', 'Trae', ['traecli'], ['.trae-cn', 'skills']),
  own('grok', 'Grok', ['grok'], ['.grok', 'skills'], 'GROK_HOME'),
  own('augment', 'Augment', ['auggie'], ['.augment', 'skills']),
  own('zcode', 'ZCode', ['zcode'], ['.zcode', 'skills']),
  own('codebuddy', 'CodeBuddy', ['codebuddy', 'cbc'], ['.codebuddy', 'skills']),
  own('kiro', 'Kiro', ['kiro-cli'], ['.kiro', 'skills'], 'KIRO_HOME'),
  own('antigravity', 'Antigravity', ['agy'], ['.gemini', 'config', 'skills']),
  own('openclaude', 'OpenClaude', ['openclaude'], ['.openclaude', 'skills'], 'OPENCLAUDE_CONFIG_DIR'),
  // Read the shared ~/.agents/skills folder.
  shared('codex', 'Codex', ['codex']),
  shared('copilot', 'GitHub Copilot', ['copilot']),
  shared('opencode', 'OpenCode', ['opencode']),
  shared('opencode2', 'OpenCode 2', ['opencode2']),
  shared('amp', 'Amp', ['amp']),
  shared('goose', 'Goose', ['goose']),
  shared('crush', 'Crush', ['crush']),
  shared('qwen-code', 'Qwen Code', ['qwen']),
  shared('kimi', 'Kimi', ['kimi', 'kimi-code']),
  shared('kilo', 'Kilo Code', ['kilo']),
  shared('rovo', 'Rovo Dev', ['acli']),
  shared('devin', 'Devin', ['devin']),
  shared('pi', 'Pi', ['pi']),
  shared('mistral-vibe', 'Mistral Vibe', ['vibe', 'mistral-vibe']),
  shared('command-code', 'Command Code', ['command-code']),
  shared('autohand', 'Autohand Code', ['autohand']),
  shared('openclaw', 'OpenClaw', ['openclaw']),
  shared('muse', 'Muse', ['muse']),
  shared('mimo-code', 'MiMo Code', ['mimo']),
  shared('omp', 'OMP', ['omp']),
  shared('prime-agent', 'Prime Agent', ['prime-agent']),
  shared('qoder', 'Qoder', ['qodercli', 'qoder']),
  shared('qoder-cn', 'Qoder CN', ['qoderclicn', 'qodercn']),
  shared('codebuff', 'Codebuff', ['codebuff']),
  shared('freebuff', 'Freebuff', ['freebuff']),
  shared('ante', 'Ante', ['ante']),
  shared('jcode', 'Jcode', ['jcode']),
  shared('dsh', 'DeepSeek Harness', ['dsh-tui', 'dst'], ['dsh']),
]

/** Every command worth probing (each agent's commands + required helpers). */
export function allProviderCommands(): string[] {
  return [...new Set(SKILL_PROVIDERS.flatMap((p) => [...p.commands, ...(p.requires ?? [])]))]
}

export function isProviderDetected(provider: SkillProvider, found: ReadonlySet<string>): boolean {
  return provider.commands.some((c) => found.has(c)) && (provider.requires ?? []).every((c) => found.has(c))
}

export interface SkillTarget {
  /** 'shared' or a provider id. */
  agent: string
  /** Display names of the detected agents served by this folder. */
  agents: string[]
  skillsDir: string
}

/**
 * Skill folders to manage: the shared root (always - agents installed later
 * pick it up too) plus the own folder of each detected agent.
 */
export function resolveSkillTargets(
  foundCommands: ReadonlySet<string>,
  home: string = homedir(),
  env: NodeJS.ProcessEnv = process.env,
): SkillTarget[] {
  const detected = SKILL_PROVIDERS.filter((p) => isProviderDetected(p, foundCommands))
  const targets: SkillTarget[] = [{
    agent: 'shared',
    agents: detected.filter((p) => p.segments === null).map((p) => p.displayName),
    skillsDir: join(home, '.agents', 'skills'),
  }]
  for (const p of detected) {
    if (!p.segments) continue
    const override = p.homeEnv ? env[p.homeEnv] : undefined
    targets.push({ agent: p.id, agents: [p.displayName], skillsDir: override ? join(override, 'skills') : join(home, ...p.segments) })
  }
  return targets
}
