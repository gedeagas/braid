/**
 * Pure utilities shared by agentWorker and agentGenerate.
 *
 * ⚠️  DO NOT import from 'electron' or '../ipc' (mainSettings) here.
 * This file must stay free of Electron dependencies so it remains
 * unit-testable without an Electron runtime.
 */

import path from 'path'
import fs from 'fs'
import os from 'os'

/** User-installed plugins — read once and cached for the process lifetime. */
const userPluginsCache: Array<{ type: 'local'; path: string }> = (() => {
  try {
    const pluginsFile = path.join(os.homedir(), '.claude', 'plugins', 'installed_plugins.json')
    const data = JSON.parse(fs.readFileSync(pluginsFile, 'utf-8')) as {
      plugins: Record<string, Array<{ scope: string; installPath: string }>>
    }
    return Object.values(data.plugins).flatMap((versions) =>
      versions
        .filter((v) => v.scope === 'user' && v.installPath)
        .map((v) => ({ type: 'local' as const, path: v.installPath }))
    )
  } catch {
    return []
  }
})()

/**
 * Returns plugin entries for a session rooted at `cwd`:
 *   • User-scope — ~/.claude/plugins/installed_plugins.json (cached at startup)
 *   • Project-scope — <cwd>/.claude (if it contains a skills/ subdirectory)
 */
export function loadPlugins(cwd: string): Array<{ type: 'local'; path: string }> {
  const projectPlugin = path.join(cwd, '.claude')
  const projectPlugins = fs.existsSync(path.join(projectPlugin, 'skills'))
    ? [{ type: 'local' as const, path: projectPlugin }]
    : []
  return [...userPluginsCache, ...projectPlugins]
}

export const BRAID_SYSTEM_PROMPT = `
You are running inside Braid — a desktop app that orchestrates Claude Code across multiple Git worktrees in parallel.

Context:
- Each chat session in Braid is scoped to a specific Git worktree (branch). You are one potentially-concurrent Claude instance among several, each working on a different branch of the same project.
- The user interacts with you through the Braid UI. You do not need to explain what Braid is.

Behavioral guidelines:
- Be concise. Avoid unnecessary preamble, summaries, or filler.
- Prefer tools over asking. If you can look something up or run a command to get the answer, do it rather than asking the user.
- Work autonomously. Make reasonable decisions and proceed without asking for confirmation on routine steps.

Hosting images/screenshots in PR descriptions:
- Use the gh-image extension: \`gh image <file> --repo <owner/repo>\`
- Install once with: \`gh extension install drogers0/gh-image\`
- This uploads directly to GitHub's CDN (github.com/user-attachments/assets/…), the same URL format as browser drag-and-drop. Repo visibility is inherited — images on private repos stay private.
- Do NOT use draft releases or curl uploads for images. gh-image is the preferred method.
- For videos, convert to GIF first with ffmpeg (GitHub does not render <video> tags inline in PR descriptions).
`.trim()

/**
 * Appended to the system prompt when a mobile device is connected.
 * Steers the LLM toward the accessibility-tree-based workflow.
 */
export const MOBILE_SYSTEM_PROMPT = `
Mobile Device Interaction:
You have a connected mobile device. Follow this workflow for ALL device interactions:

1. ALWAYS use mobile_tap_element to tap buttons, links, text fields, tabs, and any labeled UI element. It queries the accessibility tree for pixel-perfect coordinates — never guess coordinates yourself.
2. Use mobile_list_elements if you need to see what elements are on screen before deciding what to tap (e.g. when the screen structure is unclear).
3. Use mobile_take_screenshot only for visual context — to understand what the screen looks like. NEVER estimate (x,y) coordinates from screenshots.
4. Use mobile_tap (coordinate-based) ONLY for non-interactive areas like tapping a specific spot on a map, image, or canvas where no accessibility element exists.
5. After any tap or navigation, take a screenshot to confirm the result before proceeding.

Order of preference: mobile_tap_element > mobile_list_elements + mobile_tap > mobile_take_screenshot + mobile_tap
`.trim()

export const RN_FRAMEWORK_PROMPT = `
React Native Development:
- Use mobile_reload_app to trigger fast refresh after code changes.
- Use mobile_open_dev_menu to access the React Native developer menu (inspect element, toggle profiler, etc.).
- Use mobile_open_devtools to launch React DevTools in the browser.
`.trim()

export const FLUTTER_FRAMEWORK_PROMPT = `
Flutter Development:
- Use mobile_reload_app for hot reload (preserves state).
- Use mobile_hot_restart for a full restart (resets state).
- Use mobile_open_devtools to launch Flutter DevTools in the browser.
`.trim()

/**
 * Appended for Opus models to suppress excessive false-positive security
 * warnings (e.g. "this looks like malware", "potential security risk") that
 * burn tokens without adding value. See: reddit.com/r/ClaudeAI/comments/1snbtc9
 */
export const OPUS_NOISE_REDUCTION_PROMPT = `
Security analysis calibration:
- Do NOT preface tool calls or code with security/malware disclaimers unless the user is explicitly asking you to write malicious software.
- Do NOT warn about "potential security implications" for routine operations (file I/O, git commands, network requests, shell scripts, dependency installation).
- Do NOT ask for confirmation before reading, writing, or searching files in the project directory - these are normal development operations.
- If code could theoretically be misused, assume the development context is legitimate and proceed without commentary.
- Reserve security warnings for genuinely dangerous operations (rm -rf /, dropping production databases, exposing secrets in public repos).
`.trim()

/** Build the framework-specific system prompt suffix. */
export function frameworkPrompt(mobileFramework?: string): string {
  if (mobileFramework === 'react-native') return `\n\n${RN_FRAMEWORK_PROMPT}`
  if (mobileFramework === 'flutter') return `\n\n${FLUTTER_FRAMEWORK_PROMPT}`
  return ''
}

/** Tools that require user input — canUseTool will block on these. */
export const USER_INPUT_TOOLS = new Set(['AskUserQuestion', 'ExitPlanMode'])

/**
 * Build a multimodal content array from text and optional base64 image data URIs.
 * Returns Anthropic content blocks (image blocks first, then text).
 */
export function buildUserContent(text: string, images?: string[]): Array<Record<string, unknown>> {
  const blocks: Array<Record<string, unknown>> = []
  if (images && images.length > 0) {
    for (const dataUri of images) {
      const match = dataUri.match(/^data:([^;]+);base64,(.+)$/)
      if (!match) continue
      blocks.push({
        type: 'image',
        source: { type: 'base64', media_type: match[1], data: match[2] }
      })
    }
  }
  if (text && text.trim()) {
    blocks.push({ type: 'text', text })
  }
  return blocks
}

/** Strip markdown fences / preamble from a raw commit message. */
export function cleanCommitMessage(raw: string): string {
  let cleaned = raw.trim()
  cleaned = cleaned.replace(/^```[\s\S]*?\n([\s\S]*?)\n```$/m, '$1').trim()
  const validTypes = /^(feat|fix|refactor|style|docs|test|chore|perf|ci|build)(\(.*?\))?:/
  if (!validTypes.test(cleaned)) {
    const lines = cleaned.split('\n')
    const commitLine = lines.find((l) => validTypes.test(l.trim()))
    if (commitLine) {
      const idx = lines.indexOf(commitLine)
      cleaned = lines.slice(idx).join('\n').trim()
    }
  }
  return cleaned
}

/** Strip tags, quotes, fences, punctuation from a raw session title. Cap at 50 chars. */
export function cleanSessionTitle(raw: string): string {
  let cleaned = raw.trim()
  cleaned = cleaned.replace(/<\/output>\s*$/i, '').trim()
  cleaned = cleaned.replace(/^["'](.+)["']$/, '$1')
  cleaned = cleaned.replace(/^```[\s\S]*?\n([\s\S]*?)\n```$/m, '$1').trim()
  cleaned = cleaned.replace(/[.!?]+$/, '')
  cleaned = cleaned.replace(/^.*?:\s*/s, (match) => {
    const remainder = cleaned.slice(match.length)
    return remainder.length > 0 && match.length > remainder.length ? '' : match
  })
  if (cleaned.length > 50) {
    cleaned = cleaned.slice(0, 47) + '…'
  }
  return cleaned || 'New Chat'
}
