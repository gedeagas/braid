import { claudeConfigService } from '../claudeConfig'
import { matchesRuleList } from '../agentPermissions'
import { USER_INPUT_TOOLS, BRAID_SYSTEM_PROMPT, loadPlugins } from '../agentUtils'
import { getCliPath } from '../claudePath'
import { wrapWithRtk } from '../rtk'
import type { SlashCommand, WorkerEvent } from '../agentTypes'

type EmitFn = (event: WorkerEvent) => void
type PendingInputMap = Map<string, { resolve: (result: Record<string, unknown>) => void }>

export function createCanUseTool(
  sessionId: string,
  worktreePath: string,
  bypassPermissions: boolean,
  emit: EmitFn,
  pendingUserInput: PendingInputMap,
  log: (sessionId: string, ...args: unknown[]) => void,
  rtkBinaryPath?: string | null,
) {
  // Helper: apply RTK wrapping to Bash commands when enabled
  const maybeWrapRtk = (
    toolName: string,
    inp: Record<string, unknown>,
  ): Record<string, unknown> => {
    if (rtkBinaryPath && toolName === 'Bash' && typeof inp.command === 'string') {
      return { ...inp, command: wrapWithRtk(rtkBinaryPath, inp.command) }
    }
    return inp
  }

  return (
    toolName: string,
    input: Record<string, unknown>,
    context: { signal: AbortSignal; toolUseID?: string; displayName?: string; description?: string }
  ): Promise<{ behavior: string; updatedInput?: Record<string, unknown>; message?: string }> => {
    const { signal } = context

    // ── 1. Deny list always wins (even in bypass mode) ─────────────────
    try {
      const { deny: globalDeny } = claudeConfigService.getPermissions()
      const { deny: projectDeny } = claudeConfigService.getProjectPermissions(worktreePath)
      const allDeny = [...globalDeny, ...projectDeny]
      if (allDeny.length > 0 && matchesRuleList(toolName, input, allDeny)) {
        log(sessionId, `canUseTool: denied by rules — ${toolName}`)
        return Promise.resolve({ behavior: 'deny' as const, message: `Blocked by deny list` })
      }
    } catch (err) {
      log(sessionId, 'canUseTool: deny list check failed:', err)
    }

    // ── 2. AskUserQuestion / ExitPlanMode — always block for user input ─
    if (USER_INPUT_TOOLS.has(toolName)) {
      log(sessionId, `canUseTool blocking for ${toolName}`)
      const reason = toolName === 'ExitPlanMode' ? 'plan_approval' : 'question'
      emit({ type: 'waiting_input', sessionId, reason })
      return new Promise((resolve, reject) => {
        if (signal.aborted) { reject(new Error('Aborted')); return }
        pendingUserInput.set(sessionId, {
          resolve: (result) => resolve(result as { behavior: string; updatedInput?: Record<string, unknown> })
        })
        signal.addEventListener('abort', () => {
          pendingUserInput.delete(sessionId)
          reject(new Error('Aborted'))
        }, { once: true })
      })
    }

    // ── 3. Allow list — auto-approve pre-approved tools ────────────────
    try {
      const { allow: globalAllow } = claudeConfigService.getPermissions()
      const { allow: projectAllow } = claudeConfigService.getProjectPermissions(worktreePath)
      const allAllow = [...globalAllow, ...projectAllow]
      if (allAllow.length > 0 && matchesRuleList(toolName, input, allAllow)) {
        log(sessionId, `canUseTool: auto-allowed by rules — ${toolName}`)
        return Promise.resolve({ behavior: 'allow' as const, updatedInput: maybeWrapRtk(toolName, input) })
      }
    } catch (err) {
      log(sessionId, 'canUseTool: allow list check failed:', err)
    }

    // ── 4. Bypass mode — auto-allow everything else ─────────────────────
    if (bypassPermissions) {
      return Promise.resolve({ behavior: 'allow' as const, updatedInput: maybeWrapRtk(toolName, input) })
    }

    // ── 5. Confirmation required — ask the user ─────────────────────────
    log(sessionId, `canUseTool: asking user for permission — ${toolName}`)
    const toolUseId = context.toolUseID ?? `tool-${Date.now()}`
    emit({
      type: 'waiting_input',
      sessionId,
      reason: 'tool_permission',
      toolName,
      toolInput: input,
      toolUseId,
      displayName: context.displayName,
      description: context.description,
    })
    return new Promise((resolve, reject) => {
      if (signal.aborted) { reject(new Error('Aborted')); return }
      pendingUserInput.set(sessionId, {
        resolve: (result) => {
          const r = result as { behavior: string; updatedInput?: Record<string, unknown> }
          if (r.behavior === 'allow' && r.updatedInput) {
            r.updatedInput = maybeWrapRtk(toolName, r.updatedInput)
          }
          resolve(r)
        }
      })
      signal.addEventListener('abort', () => {
        pendingUserInput.delete(sessionId)
        reject(new Error('Aborted'))
      }, { once: true })
    })
  }
}

export async function fetchSlashCommands(
  cwd: string,
  importSdk: () => Promise<typeof import('@anthropic-ai/claude-agent-sdk').query>,
  userCliPath: string,
): Promise<SlashCommand[]> {
  console.log('[AgentgetSlashCommands]', cwd)
  let queryFn: typeof import('@anthropic-ai/claude-agent-sdk').query
  try {
    queryFn = await importSdk()
  } catch {
    return []
  }

  delete process.env.CLAUDECODE
  const abortController = new AbortController()
  let skillNameSet = new Set<string>()

  try {
    const q = queryFn({
      prompt: ' ',
      options: {
        cwd,
        maxTurns: 0,
        persistSession: false,
        abortController,
        settingSources: ['user', 'project'],
        systemPrompt: { type: 'preset', preset: 'claude_code', append: BRAID_SYSTEM_PROMPT },
        stderr: () => {},
        ...(getCliPath(userCliPath) ? { pathToClaudeCodeExecutable: getCliPath(userCliPath) } : {}),
      } as Parameters<typeof queryFn>[0]['options']
    })

    for await (const message of q) {
      if (message.type === 'system' && 'subtype' in message && message.subtype === 'init') {
        const msg = message as Record<string, unknown>
        skillNameSet = new Set((msg.skills as string[]) ?? [])
      }
    }

    const richCmds = await q.supportedCommands()
    const commands = richCmds.map((cmd) => ({
      name: cmd.name,
      description: cmd.description ?? '',
      argumentHint: cmd.argumentHint ?? undefined,
      source: skillNameSet.has(cmd.name) ? ('skill' as const) : ('builtin' as const)
    }))
    console.log('[AgentgetSlashCommands] Got', commands.length, 'commands')
    return commands
  } catch (err) {
    console.log('[AgentgetSlashCommands] Error:', err)
    return []
  }
}
