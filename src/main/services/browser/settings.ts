// Browser settings persisted by main (userData/browser-settings.json). Main owns
// them because some apply before any window exists (user agent identity).
import { app } from 'electron'
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { dirname, join } from 'path'
import {
  DEFAULT_BROWSER_PROFILE_ID,
  DEFAULT_BROWSER_SETTINGS,
  type BrowserProfile,
  type BrowserSettings,
} from '../../../shared/browser'

const PROFILE_ID = /^[A-Za-z0-9._-]{1,64}$/

/** Validate and fill defaults; never trusts the file or the renderer blindly. */
export function normalizeBrowserSettings(raw: unknown): BrowserSettings {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const d = DEFAULT_BROWSER_SETTINGS
  const profiles = Array.isArray(r.profiles)
    ? r.profiles
        .filter((p): p is BrowserProfile => typeof p === 'object' && p !== null
          && typeof (p as BrowserProfile).id === 'string' && PROFILE_ID.test((p as BrowserProfile).id)
          && typeof (p as BrowserProfile).name === 'string')
        .map((p) => ({ id: p.id, name: p.name.trim().slice(0, 64) || p.id }))
    : []
  if (!profiles.some((p) => p.id === DEFAULT_BROWSER_PROFILE_ID)) profiles.unshift({ ...d.profiles[0] })
  const unique = profiles.filter((p, i) => profiles.findIndex((q) => q.id === p.id) === i)
  return {
    linkRouting: r.linkRouting === 'system' ? 'system' : 'braid',
    invertWithShiftModifier: typeof r.invertWithShiftModifier === 'boolean' ? r.invertWithShiftModifier : d.invertWithShiftModifier,
    searchEngine: r.searchEngine === 'duckduckgo' || r.searchEngine === 'bing' ? r.searchEngine : 'google',
    downloadsDir: typeof r.downloadsDir === 'string' ? r.downloadsDir : '',
    identity: r.identity === 'native' ? 'native' : 'cleaned',
    profiles: unique,
    exposeToTerminalAgents: typeof r.exposeToTerminalAgents === 'boolean' ? r.exposeToTerminalAgents : d.exposeToTerminalAgents,
  }
}

let cached: BrowserSettings | null = null

function settingsPath(): string {
  return join(app.getPath('userData'), 'browser-settings.json')
}

export function getBrowserSettings(): BrowserSettings {
  if (cached) return cached
  try {
    cached = normalizeBrowserSettings(JSON.parse(readFileSync(settingsPath(), 'utf8')))
  } catch {
    cached = normalizeBrowserSettings({})
  }
  return cached
}

export function setBrowserSettings(patch: Partial<BrowserSettings>): BrowserSettings {
  cached = normalizeBrowserSettings({ ...getBrowserSettings(), ...patch })
  try {
    mkdirSync(dirname(settingsPath()), { recursive: true })
    writeFileSync(settingsPath(), JSON.stringify(cached, null, 2))
  } catch {
    // Disk full / read-only: keep the in-memory value for this run.
  }
  return cached
}
