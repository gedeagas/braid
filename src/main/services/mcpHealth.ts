/**
 * MCP Server Health Checker
 *
 * Probes MCP servers to determine if they're reachable and functional.
 * - stdio servers: spawns the command with a brief timeout, checks if it starts
 * - SSE/HTTP servers: sends a GET request to the URL to check reachability
 *
 * Returns status per server: 'ok' | 'error' | 'auth_required' | 'unknown'
 */

import { spawn } from 'child_process'
import { net } from 'electron'
import type { McpServerConfig } from './claudeConfig'

export type McpHealthStatus = 'ok' | 'error' | 'auth_required' | 'unknown'

export interface McpHealthResult {
  name: string
  status: McpHealthStatus
  error?: string
}

const STDIO_TIMEOUT_MS = 8_000
const HTTP_TIMEOUT_MS = 6_000

/** Check a single stdio server by spawning its process briefly. */
function checkStdio(
  name: string,
  config: { command: string; args?: string[]; env?: Record<string, string> },
): Promise<McpHealthResult> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      // If process is still running after timeout, it's likely healthy (MCP servers are long-lived)
      try { child.kill() } catch { /* ignore */ }
      resolve({ name, status: 'ok' })
    }, STDIO_TIMEOUT_MS)

    const env = { ...process.env, ...config.env }
    let child: ReturnType<typeof spawn>

    try {
      child = spawn(config.command, config.args ?? [], {
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
        // Detach so we can kill cleanly
        detached: false,
      })
    } catch (err) {
      clearTimeout(timer)
      resolve({
        name,
        status: 'error',
        error: err instanceof Error ? err.message : 'Failed to spawn process',
      })
      return
    }

    let stderr = ''

    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString().slice(0, 500)
    })

    // If stdout produces any data, the server started successfully
    child.stdout?.once('data', () => {
      clearTimeout(timer)
      try { child.kill() } catch { /* ignore */ }
      resolve({ name, status: 'ok' })
    })

    child.on('error', (err) => {
      clearTimeout(timer)
      const msg = err.message
      // ENOENT = command not found
      if (msg.includes('ENOENT')) {
        resolve({ name, status: 'error', error: `Command not found: ${config.command}` })
      } else {
        resolve({ name, status: 'error', error: msg })
      }
    })

    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) {
        resolve({ name, status: 'ok' })
      } else {
        const hint = stderr.trim().split('\n')[0] || `Exit code ${code}`
        resolve({ name, status: 'error', error: hint })
      }
    })

    // Send an MCP initialize request to stdin to trigger a response
    try {
      const initRequest = JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'braid-health-check', version: '1.0.0' },
        },
      })
      child.stdin?.write(initRequest + '\n')
    } catch { /* ignore write errors */ }
  })
}

/** Check a remote (SSE/HTTP) server by requesting its URL. */
function checkRemote(
  name: string,
  config: { url: string; headers?: Record<string, string> },
): Promise<McpHealthResult> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      resolve({ name, status: 'error', error: 'Connection timed out' })
    }, HTTP_TIMEOUT_MS)

    try {
      const req = net.request({ url: config.url, method: 'GET' })

      // Add custom headers
      if (config.headers) {
        for (const [key, value] of Object.entries(config.headers)) {
          req.setHeader(key, value)
        }
      }

      req.on('response', (response) => {
        clearTimeout(timer)
        const status = response.statusCode

        if (status >= 200 && status < 400) {
          resolve({ name, status: 'ok' })
        } else if (status === 401 || status === 403) {
          resolve({ name, status: 'auth_required', error: `HTTP ${status}: Authentication required` })
        } else {
          resolve({ name, status: 'error', error: `HTTP ${status}` })
        }
        // Consume response body to prevent memory leak
        response.on('data', () => {})
      })

      req.on('error', (err) => {
        clearTimeout(timer)
        const msg = err.message
        if (msg.includes('ECONNREFUSED')) {
          resolve({ name, status: 'error', error: 'Connection refused - server not running' })
        } else if (msg.includes('ENOTFOUND')) {
          resolve({ name, status: 'error', error: 'Host not found' })
        } else if (msg.includes('certificate') || msg.includes('SSL')) {
          resolve({ name, status: 'error', error: 'SSL/TLS error' })
        } else {
          resolve({ name, status: 'error', error: msg })
        }
      })

      req.end()
    } catch (err) {
      clearTimeout(timer)
      resolve({
        name,
        status: 'error',
        error: err instanceof Error ? err.message : 'Request failed',
      })
    }
  })
}

/** Check health of a single MCP server. */
export async function checkMcpServerHealth(
  name: string,
  config: McpServerConfig,
): Promise<McpHealthResult> {
  try {
    const type = config.type ?? 'stdio'
    if (type === 'stdio') {
      return await checkStdio(name, config as { command: string; args?: string[]; env?: Record<string, string> })
    }
    return await checkRemote(name, config as { url: string; headers?: Record<string, string> })
  } catch {
    return { name, status: 'unknown' }
  }
}

/** Check health of multiple MCP servers concurrently. */
export async function checkMcpServersHealth(
  servers: Array<{ name: string; config: McpServerConfig }>,
): Promise<McpHealthResult[]> {
  const results = await Promise.all(
    servers.map((s) => checkMcpServerHealth(s.name, s.config)),
  )
  return results
}
