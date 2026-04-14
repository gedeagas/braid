/**
 * MCP OAuth Authentication Service
 *
 * Spawns an ephemeral SDK query to trigger the MCP server's OAuth flow.
 * When the server returns 401, the SDK fires onElicitation with mode='url',
 * which opens the browser for the user. Once the OAuth callback completes,
 * the SDK emits elicitation_complete and we resolve successfully.
 *
 * Used by the Settings page "Authenticate" button for proactive auth
 * (no active session required).
 */

import type { McpServerConfig } from './claudeConfig'
import type { AgentSettings } from './agentTypes'
import { getCliPath } from './claudePath'

const AUTH_TIMEOUT_MS = 90_000

type ElicitationResult = { action: 'accept' | 'decline' | 'cancel'; content?: Record<string, unknown> }

export async function authenticateMcpServer(
  serverName: string,
  serverConfig: McpServerConfig,
  settings: AgentSettings,
  onOpenUrl: (url: string) => void
): Promise<{ success: boolean; error?: string }> {
  let queryFn: typeof import('@anthropic-ai/claude-agent-sdk').query

  try {
    const sdk = await import('@anthropic-ai/claude-agent-sdk')
    queryFn = sdk.query
  } catch (err) {
    return { success: false, error: `SDK import failed: ${err}` }
  }

  // Apply API key if set
  if (settings.apiKey) {
    process.env.ANTHROPIC_API_KEY = settings.apiKey
  }
  delete process.env.CLAUDECODE

  const abortController = new AbortController()
  const timeout = setTimeout(() => abortController.abort(), AUTH_TIMEOUT_MS)

  // Shared mutable state between onElicitation callback and message loop
  let elicitationResolved = false
  let elicitationResolve: ((result: ElicitationResult) => void) | undefined

  try {
    const q = queryFn({
      // Minimal prompt - just enough to trigger MCP server connection
      prompt: 'ping',
      options: {
        cwd: process.cwd(),
        model: 'claude-haiku-4-5-20251001',
        maxTurns: 1,
        permissionMode: 'plan',
        abortController,
        mcpServers: {
          [serverName]: serverConfig as Record<string, unknown>,
        },
        onElicitation: (request, opts) => {
          if (request.mode === 'url' && request.url) {
            onOpenUrl(request.url)
            // Return a promise that resolves when elicitation_complete arrives
            return new Promise<ElicitationResult>((resolve) => {
              const checkAbort = (): void => {
                if (opts.signal.aborted) resolve({ action: 'cancel' })
              }
              opts.signal.addEventListener('abort', checkAbort)
              elicitationResolve = resolve
            })
          }
          // For form mode or unknown, decline - Settings page doesn't handle forms
          return Promise.resolve({ action: 'decline' as const })
        },
        ...(getCliPath(settings.claudeCodeExecutablePath)
          ? { pathToClaudeCodeExecutable: getCliPath(settings.claudeCodeExecutablePath) }
          : {}),
      } as Parameters<typeof queryFn>[0]['options'],
    })

    for await (const message of q) {
      if (abortController.signal.aborted) break

      // Detect elicitation_complete - the OAuth flow finished
      if (
        message.type === 'system' &&
        'subtype' in message &&
        (message as Record<string, unknown>).subtype === 'elicitation_complete'
      ) {
        elicitationResolved = true
        if (elicitationResolve) {
          elicitationResolve({ action: 'accept' })
        }
        // Auth complete - abort the rest of the query
        abortController.abort()
        break
      }
    }

    if (elicitationResolved) {
      return { success: true }
    }

    return { success: false, error: 'OAuth flow did not complete' }
  } catch (err) {
    if (elicitationResolved) {
      // Abort error after successful auth is expected
      return { success: true }
    }
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('aborted') || msg.includes('abort')) {
      return { success: false, error: 'Authentication timed out' }
    }
    return { success: false, error: msg }
  } finally {
    clearTimeout(timeout)
  }
}
