// Browser tools for the in-process Braid MCP server. Runs in the agent worker
// (no electron import): each call is forwarded to main via the data channel.
import { z } from 'zod'
import { BROWSER_TOOLS, type BrowserToolParam, type BrowserToolResult } from '../../shared/browserTools'

/** Browser calls can wait on page loads; give them longer than plain data requests. */
export const BROWSER_TOOL_TIMEOUT_MS = 90_000

type ToolFactory = typeof import('@anthropic-ai/claude-agent-sdk').tool
type RequestFn = (dataType: string, params: Record<string, unknown>, timeoutMs: number) => Promise<unknown>

function zodFor(p: BrowserToolParam): z.ZodType {
  let schema: z.ZodType = p.type === 'number' ? z.number() : p.type === 'boolean' ? z.boolean()
    : p.enum ? z.enum(p.enum as [string, ...string[]]) : z.string()
  schema = schema.describe(p.description)
  return p.optional ? schema.optional() : schema
}

export function createBrowserTools(tool: ToolFactory, request: RequestFn) {
  return BROWSER_TOOLS.map((spec) => {
    const shape = Object.fromEntries(Object.entries(spec.params).map(([k, p]) => [k, zodFor(p)]))
    return tool(spec.name, spec.description, shape, async (args: Record<string, unknown>) => {
      let result: BrowserToolResult
      try {
        result = await request('browser_tool', { name: spec.name, args }, BROWSER_TOOL_TIMEOUT_MS) as BrowserToolResult
      } catch (err) {
        result = { text: err instanceof Error ? err.message : String(err), isError: true }
      }
      const content: Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }> = [
        { type: 'text', text: result.text },
      ]
      if (result.imageBase64) content.push({ type: 'image', data: result.imageBase64, mimeType: 'image/png' })
      return { content, ...(result.isError ? { isError: true } : {}) }
    })
  })
}
