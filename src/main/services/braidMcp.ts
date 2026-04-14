/**
 * In-process MCP server exposing Braid app functionality to the Claude agent SDK.
 *
 * Uses the SDK's own `createSdkMcpServer` + `tool` helpers so the server runs
 * in the same process — no child process spawn, no stdio transport overhead.
 *
 * ⚠️  This file runs inside a UtilityProcess (via agentWorker).
 * DO NOT import from 'electron' or any module that transitively imports it.
 *
 * - git/status.ts  — uses simple-git (safe)
 * - github.ts      — uses child_process.execFile (safe)
 * - git/worktrees.ts — uses simple-git + os (safe)
 * - os.homedir()   — Node built-in (replaces app.getPath('home'))
 * - DATA_DIR_NAME  — pure constant from appBrand.ts (safe)
 */

import { z } from 'zod'
import { homedir } from 'os'
import { join } from 'path'
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { readdir, readFile } from 'fs/promises'
import crypto from 'crypto'
import { DATA_DIR_NAME } from '../appBrand'
import { getStatus } from './git/status'
import { githubService } from './github'
import { addWorktree } from './git/worktrees'

// ─── Types ───────────────────────────────────────────────────────────────────

/** Event sent to the coordinator via the emit callback. */
export interface BraidAction {
  type: 'braid_action'
  action: 'worktree_created' | 'create_session' | 'data_request'
  payload: Record<string, unknown>
}

// ─── Data Request (cross-process request-response) ──────────────────────────

const pendingDataRequests = new Map<string, {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
}>()

/** Called by agentProcess when the coordinator sends back a data response. */
export function resolveBraidDataRequest(requestId: string, value: unknown): void {
  const pending = pendingDataRequests.get(requestId)
  if (pending) {
    pendingDataRequests.delete(requestId)
    pending.resolve(value)
  }
}

/** Called by agentProcess when the coordinator sends back a data error. */
export function rejectBraidDataRequest(requestId: string, message: string): void {
  const pending = pendingDataRequests.get(requestId)
  if (pending) {
    pendingDataRequests.delete(requestId)
    pending.reject(new Error(message))
  }
}

const DATA_REQUEST_TIMEOUT_MS = 10_000

function requestData(
  emit: (event: BraidAction) => void,
  dataType: string,
  params: Record<string, unknown>
): Promise<unknown> {
  const requestId = crypto.randomUUID()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingDataRequests.delete(requestId)
      reject(new Error(`Braid data request timed out: ${dataType}`))
    }, DATA_REQUEST_TIMEOUT_MS)

    pendingDataRequests.set(requestId, {
      resolve: (value) => { clearTimeout(timer); resolve(value) },
      reject: (error) => { clearTimeout(timer); reject(error) },
    })

    emit({
      type: 'braid_action',
      action: 'data_request',
      payload: { requestId, dataType, ...params },
    })
  })
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Strip ANSI escape sequences from terminal output. */
function stripAnsi(text: string): string {
  // CSI sequences (incl. ? modifier), OSC sequences, single-char escapes, carriage returns
  return text.replace(/\x1b\[[\x20-\x3f]*[0-9;]*[\x40-\x7e]|\x1b\].*?(?:\x07|\x1b\\)|\x1b[()][0-9A-B]|\r/g, '')
}

// ─── Lazy-loaded SDK helpers ─────────────────────────────────────────────────

let _createSdkMcpServer: typeof import('@anthropic-ai/claude-agent-sdk').createSdkMcpServer
let _tool: typeof import('@anthropic-ai/claude-agent-sdk').tool

async function loadSdkHelpers() {
  if (_createSdkMcpServer !== undefined && _tool !== undefined) return
  const sdk = await import('@anthropic-ai/claude-agent-sdk')
  _createSdkMcpServer = sdk.createSdkMcpServer
  _tool = sdk.tool
}

// ─── Paths ───────────────────────────────────────────────────────────────────

function notesDir(): string { return join(homedir(), DATA_DIR_NAME, 'notes') }
function sessionsDir(): string { return join(homedir(), DATA_DIR_NAME, 'sessions') }

/** Sanitize worktreeId to prevent path traversal (strip slashes, dots-only segments). */
function safeId(id: string): string {
  return id.replace(/[/\\]/g, '_').replace(/^\.+$/, '_')
}

// ─── MCP Server ──────────────────────────────────────────────────────────────

/**
 * Creates an MCP server config that can be passed directly to the SDK's
 * `mcpServers` option. Returns `{ type: 'sdk', name, instance }`.
 */
export async function createBraidServer(
  worktreeId: string,
  worktreePath: string,
  projectName: string,
  emit: (event: BraidAction) => void
) {
  await loadSdkHelpers()

  return _createSdkMcpServer({
    name: 'braid',
    version: '1.0.0',
    tools: [
      // ── Git status ───────────────────────────────────────────────────
      _tool(
        'braid_get_git_status',
        'Get structured git working tree status for the current worktree. Returns staged and unstaged changes with file paths and status codes (M=modified, A=added, D=deleted, R=renamed, ?=untracked). More reliable than parsing `git status` CLI output.',
        {},
        async () => {
          const changes = await getStatus(worktreePath)
          return { content: [{ type: 'text' as const, text: JSON.stringify(changes, null, 2) }] }
        },
      ),

      // ── PR status ────────────────────────────────────────────────────
      _tool(
        'braid_get_pr_status',
        'Get the pull request status for the current branch. Returns PR number, title, state (OPEN/CLOSED/MERGED), URL, mergeable status, review decision, and draft status. Returns null if no PR exists. Requires `gh` CLI.',
        {},
        async () => {
          const pr = await githubService.getPrStatus(worktreePath)
          if (!pr) {
            return { content: [{ type: 'text' as const, text: 'No pull request found for the current branch.' }] }
          }
          return { content: [{ type: 'text' as const, text: JSON.stringify(pr, null, 2) }] }
        },
      ),

      // ── CI checks ────────────────────────────────────────────────────
      _tool(
        'braid_get_checks',
        'Get CI/CD check results for the current branch\'s pull request. Returns check name, status (in_progress/completed), conclusion (success/failure/cancelled/skipped), URL, and workflow name. Returns empty array if no PR or no checks. Requires `gh` CLI.',
        {},
        async () => {
          const checks = await githubService.getChecks(worktreePath)
          if (checks.length === 0) {
            return { content: [{ type: 'text' as const, text: 'No CI checks found (no PR or no checks configured).' }] }
          }
          return { content: [{ type: 'text' as const, text: JSON.stringify(checks, null, 2) }] }
        },
      ),

      // ── Notes (read) ─────────────────────────────────────────────────
      _tool(
        'braid_read_notes',
        'Read the persistent markdown notes for the current worktree. Notes survive across sessions and are visible in the Braid Notes tab. Returns empty string if no notes exist.',
        {},
        async () => {
          if (!worktreeId) {
            return { content: [{ type: 'text' as const, text: '' }] }
          }
          const filePath = join(notesDir(), `${safeId(worktreeId)}.md`)
          try {
            const content = readFileSync(filePath, 'utf-8')
            return { content: [{ type: 'text' as const, text: content }] }
          } catch (err) {
            if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
              return { content: [{ type: 'text' as const, text: '' }] }
            }
            throw err
          }
        },
      ),

      // ── Notes (write) ────────────────────────────────────────────────
      _tool(
        'braid_write_notes',
        'Write markdown notes for the current worktree. Overwrites existing notes. Notes are persistent (survive session restarts) and visible in the Braid Notes tab. Use this for tracking task progress, design decisions, and context that should persist.',
        { content: z.string().describe('Markdown content to write as the worktree notes') },
        async ({ content }) => {
          if (!worktreeId) {
            throw new Error('Cannot write notes: worktreeId not available')
          }
          const dir = notesDir()
          mkdirSync(dir, { recursive: true })
          writeFileSync(join(dir, `${safeId(worktreeId)}.md`), content, 'utf-8')
          return { content: [{ type: 'text' as const, text: 'Notes saved.' }] }
        },
      ),

      // ── Sessions list ────────────────────────────────────────────────
      _tool(
        'braid_get_sessions',
        'List all Claude sessions across all worktrees. Returns lightweight summaries (id, name, status, worktree path, model, creation time). Use this for cross-worktree awareness — see what other agents are working on.',
        {},
        async () => {
          const dir = sessionsDir()
          let files: string[]
          try {
            files = (await readdir(dir)).filter((f) => f.endsWith('.json'))
          } catch {
            return { content: [{ type: 'text' as const, text: '[]' }] }
          }

          const results = await Promise.allSettled(
            files.map(async (file) => {
              const raw = await readFile(join(dir, file), 'utf-8')
              const session = JSON.parse(raw) as Record<string, unknown>
              return {
                id: session.id,
                worktreeId: session.worktreeId,
                name: session.name,
                status: session.status,
                worktreePath: session.worktreePath,
                model: session.model,
                createdAt: session.createdAt,
                totalRunDurationMs: session.totalRunDurationMs,
              }
            })
          )

          const summaries = results
            .filter((r) => r.status === 'fulfilled')
            .map((r) => (r as PromiseFulfilledResult<Record<string, unknown>>).value)

          return { content: [{ type: 'text' as const, text: JSON.stringify(summaries, null, 2) }] }
        },
      ),

      // ── Create worktree ──────────────────────────────────────────────
      _tool(
        'braid_create_worktree',
        'Create a new git worktree managed by Braid. The worktree appears in the Braid sidebar. Use this instead of `git worktree add` via Bash — that bypasses Braid\'s storage path management.',
        {
          branch: z.string().describe('Name for the new local branch'),
          base_branch: z.string().optional().describe('Remote branch to fork from (e.g. "origin/main"). Defaults to HEAD.'),
        },
        async ({ branch, base_branch }) => {
          const name = projectName || 'unknown'
          await addWorktree(worktreePath, branch, name, base_branch)
          emit({ type: 'braid_action', action: 'worktree_created', payload: { branch } })
          return { content: [{ type: 'text' as const, text: `Worktree created for branch "${branch}" (project: ${name}).` }] }
        },
      ),

      // ── Create session ───────────────────────────────────────────────
      _tool(
        'braid_create_session',
        'Create a new Claude session on a specified worktree path. The session starts automatically with the given prompt. Use braid_get_sessions to check on its progress later.',
        {
          worktree_path: z.string().describe('Absolute path to the target worktree'),
          prompt: z.string().describe('Initial prompt/instructions for the new session'),
          model: z.string().optional().describe('Model to use (defaults to claude-sonnet-4-6)'),
          session_name: z.string().optional().describe('Display name for the session'),
        },
        async ({ worktree_path, prompt, model, session_name }) => {
          const newSessionId = crypto.randomUUID()
          emit({
            type: 'braid_action',
            action: 'create_session',
            payload: {
              sessionId: newSessionId,
              worktreePath: worktree_path,
              prompt,
              model: model ?? 'claude-sonnet-4-6',
              sessionName: session_name ?? 'Delegated Task',
            },
          })
          return {
            content: [{
              type: 'text' as const,
              text: `Session "${session_name ?? 'Delegated Task'}" (${newSessionId}) requested on ${worktree_path}. Check braid_get_sessions for status.`,
            }],
          }
        },
      ),

      // ── Read terminal output ──────────────────────────────────────────
      _tool(
        'braid_read_terminal',
        'Read recent terminal output from the current worktree. Returns the last ~200 lines from each terminal tab. Useful for checking build output, test results, server logs, or command output without asking the user to copy-paste.',
        {
          max_lines: z.number().optional().describe(
            'Maximum number of lines to return per terminal (default: 200, max: 1000). Use lower values to save context.'
          ),
        },
        async ({ max_lines }) => {
          const limit = Math.min(max_lines ?? 200, 1000)
          type TermOutput = { ptyId: string; output: string }
          let terminals: TermOutput[]
          try {
            terminals = await requestData(emit, 'read_terminal', { worktreePath }) as TermOutput[]
          } catch {
            return { content: [{ type: 'text' as const, text: 'No terminal output available.' }] }
          }

          if (terminals.length === 0) {
            return { content: [{ type: 'text' as const, text: 'No active terminals found for this worktree.' }] }
          }

          const sections = terminals.map((t, i) => {
            const cleaned = stripAnsi(t.output)
            const lines = cleaned.split('\n')
            const truncated = lines.slice(-limit).join('\n')
            return `--- Terminal ${i + 1} (${t.ptyId}) ---\n${truncated}`
          })

          return { content: [{ type: 'text' as const, text: sections.join('\n\n') }] }
        },
      ),
    ],
  })
}
