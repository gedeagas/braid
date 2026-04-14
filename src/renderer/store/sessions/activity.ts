import i18n from '@/lib/i18n'
import { useUIStore } from '@/store/ui'

const t = (key: string, opts?: Record<string, unknown>): string =>
  i18n.t(key, { ns: 'center', ...opts })

const KNOWN_TOOLS = new Set([
  'Task', 'Bash', 'BashOutput', 'Read', 'Edit', 'Write',
  'Grep', 'Glob', 'WebFetch', 'WebSearch', 'TodoWrite',
  'TaskOutput', 'KillShell', 'NotebookEdit', 'LSP', 'Skill',
  'Mcp', 'ListMcpResources', 'ReadMcpResource', 'Config',
  'AskUserQuestion', 'ExitPlanMode',
])

export function toolActivity(
  toolName: string,
  mode: 'calling' | 'running',
  elapsed?: number,
): string {
  const style = useUIStore.getState().toolMessageStyle
  const elapsedStr = elapsed && elapsed > 2 ? ` (${Math.round(elapsed)}s)` : ''
  const modeKey = mode === 'calling' ? 'Calling' : 'Running'

  if (style === 'funny') {
    const key = KNOWN_TOOLS.has(toolName)
      ? `toolActivityFunny${toolName}${modeKey}`
      : `toolActivityFunnyFallback${modeKey}`
    const msg = t(key)
    return mode === 'running' ? msg + elapsedStr : msg
  }

  const translatedName = t(`toolName.${toolName}`, { defaultValue: toolName })
  const msg = t(`toolActivityBoring${modeKey}`, { toolName: translatedName })
  return mode === 'running' ? msg + elapsedStr : msg
}

export function thinkingActivity(): string {
  const style = useUIStore.getState().toolMessageStyle
  return style === 'funny'
    ? t('toolActivityThinkingFunny')
    : t('toolActivityThinkingBoring')
}

export function compactingActivity(): string {
  const style = useUIStore.getState().toolMessageStyle
  return style === 'funny'
    ? t('toolActivityCompactingFunny')
    : t('toolActivityCompactingBoring')
}
