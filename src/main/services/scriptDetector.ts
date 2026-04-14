/**
 * Detects runnable scripts from project config files.
 *
 * Reads package.json, Makefile, Cargo.toml, go.mod, composer.json, and
 * pyproject.toml to auto-populate the Run Scripts panel.
 */

import fs from 'fs'
import path from 'path'
import { ServiceCache } from '../lib/serviceCache'

// These types mirror src/renderer/src/types/index.ts (separate tsconfig, can't share)
type ScriptSource = 'npm' | 'yarn' | 'pnpm' | 'bun' | 'makefile' | 'cargo' | 'go' | 'composer' | 'python' | 'custom'

interface RunCommand {
  id: string
  name: string
  command: string
  source: ScriptSource
}

const scriptCache = new ServiceCache<RunCommand[]>(120_000) // 2 min

/**
 * Detect runnable scripts in a project directory.
 * Checks common config files and returns a unified list of commands.
 * Results are cached for 2 minutes to avoid re-reading config files on every tab switch.
 */
export function detectScripts(projectPath: string, forceRefresh?: boolean): Promise<RunCommand[]> {
  return scriptCache.get(projectPath, async () => _detectScripts(projectPath), { forceRefresh })
}

function _detectScripts(projectPath: string): RunCommand[] {
  const scripts: RunCommand[] = []
  scripts.push(...detectNodeScripts(projectPath))
  scripts.push(...detectMakeTargets(projectPath))
  scripts.push(...detectCargoCommands(projectPath))
  scripts.push(...detectGoCommands(projectPath))
  scripts.push(...detectComposerScripts(projectPath))
  scripts.push(...detectPythonScripts(projectPath))
  return scripts
}

// ─── Node (package.json) ──────────────────────────────────────────────────

function detectNodeScripts(dir: string): RunCommand[] {
  const pkgPath = path.join(dir, 'package.json')
  if (!fs.existsSync(pkgPath)) return []

  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))
    const scripts = pkg.scripts as Record<string, string> | undefined
    if (!scripts || typeof scripts !== 'object') return []

    const runner = detectNodeRunner(dir)
    return Object.keys(scripts).map((name) => ({
      id: `${runner}:${name}`,
      name,
      command: `${runner} run ${name}`,
      source: runner as ScriptSource,
    }))
  } catch { return [] }
}

function detectNodeRunner(dir: string): 'bun' | 'pnpm' | 'yarn' | 'npm' {
  if (fs.existsSync(path.join(dir, 'bun.lockb')) || fs.existsSync(path.join(dir, 'bun.lock'))) return 'bun'
  if (fs.existsSync(path.join(dir, 'pnpm-lock.yaml'))) return 'pnpm'
  if (fs.existsSync(path.join(dir, 'yarn.lock'))) return 'yarn'
  return 'npm'
}

// ─── Makefile ─────────────────────────────────────────────────────────────

const MAKE_TARGET_RE = /^([a-zA-Z_][\w-]*)\s*:/gm
const MAKE_INTERNAL = new Set(['.PHONY', '.DEFAULT', '.SUFFIXES', '.PRECIOUS', '.INTERMEDIATE', '.SECONDARY', '.DELETE_ON_ERROR'])

function detectMakeTargets(dir: string): RunCommand[] {
  const makePath = path.join(dir, 'Makefile')
  if (!fs.existsSync(makePath)) return []

  try {
    const content = fs.readFileSync(makePath, 'utf-8')
    const targets: RunCommand[] = []
    MAKE_TARGET_RE.lastIndex = 0
    let match: RegExpExecArray | null
    const seen = new Set<string>()

    while ((match = MAKE_TARGET_RE.exec(content)) !== null) {
      const name = match[1]
      if (MAKE_INTERNAL.has(name) || seen.has(name)) continue
      seen.add(name)
      targets.push({ id: `make:${name}`, name, command: `make ${name}`, source: 'makefile' })
    }
    return targets
  } catch { return [] }
}

// ─── Cargo (Rust) ─────────────────────────────────────────────────────────

function detectCargoCommands(dir: string): RunCommand[] {
  if (!fs.existsSync(path.join(dir, 'Cargo.toml'))) return []
  return [
    { id: 'cargo:build', name: 'build', command: 'cargo build', source: 'cargo' },
    { id: 'cargo:run', name: 'run', command: 'cargo run', source: 'cargo' },
    { id: 'cargo:test', name: 'test', command: 'cargo test', source: 'cargo' },
    { id: 'cargo:check', name: 'check', command: 'cargo check', source: 'cargo' },
  ]
}

// ─── Go ───────────────────────────────────────────────────────────────────

function detectGoCommands(dir: string): RunCommand[] {
  if (!fs.existsSync(path.join(dir, 'go.mod'))) return []
  return [
    { id: 'go:run', name: 'run .', command: 'go run .', source: 'go' },
    { id: 'go:test', name: 'test ./...', command: 'go test ./...', source: 'go' },
    { id: 'go:build', name: 'build', command: 'go build ./...', source: 'go' },
  ]
}

// ─── Composer (PHP) ───────────────────────────────────────────────────────

function detectComposerScripts(dir: string): RunCommand[] {
  const composerPath = path.join(dir, 'composer.json')
  if (!fs.existsSync(composerPath)) return []

  try {
    const pkg = JSON.parse(fs.readFileSync(composerPath, 'utf-8'))
    const scripts = pkg.scripts as Record<string, unknown> | undefined
    if (!scripts || typeof scripts !== 'object') return []

    return Object.keys(scripts)
      .filter((name) => !name.startsWith('pre-') && !name.startsWith('post-'))
      .map((name) => ({
        id: `composer:${name}`,
        name,
        command: `composer run ${name}`,
        source: 'composer' as const,
      }))
  } catch { return [] }
}

// ─── Python (pyproject.toml / Pipfile) ────────────────────────────────────

const POETRY_SCRIPT_RE = /^\[tool\.poetry\.scripts\]\s*\n((?:[a-zA-Z_][\w-]*\s*=.*\n?)+)/m
const PEP_SCRIPT_RE = /^\[project\.scripts\]\s*\n((?:[a-zA-Z_][\w-]*\s*=.*\n?)+)/m
const TOML_KV_RE = /^([a-zA-Z_][\w-]*)\s*=/gm

function detectPythonScripts(dir: string): RunCommand[] {
  const pyprojectPath = path.join(dir, 'pyproject.toml')
  if (!fs.existsSync(pyprojectPath)) return []

  try {
    const content = fs.readFileSync(pyprojectPath, 'utf-8')
    const scripts: RunCommand[] = []
    const seen = new Set<string>()

    for (const sectionRe of [POETRY_SCRIPT_RE, PEP_SCRIPT_RE]) {
      const sectionMatch = sectionRe.exec(content)
      if (!sectionMatch) continue
      const block = sectionMatch[1]
      TOML_KV_RE.lastIndex = 0
      let kv: RegExpExecArray | null
      while ((kv = TOML_KV_RE.exec(block)) !== null) {
        const name = kv[1]
        if (seen.has(name)) continue
        seen.add(name)
        scripts.push({ id: `python:${name}`, name, command: name, source: 'python' })
      }
    }
    return scripts
  } catch { return [] }
}
