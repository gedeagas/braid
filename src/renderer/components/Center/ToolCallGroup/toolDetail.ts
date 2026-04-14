import i18n from '@/lib/i18n'
import type { ToolCall } from '@/types'

/** Extract display-friendly input text and a short summary for the collapsed state */
export function getToolDetail(tc: ToolCall): { input: string | null; summary: string | null } {
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(tc.input)
  } catch {
    return { input: tc.input || null, summary: null }
  }

  switch (tc.name) {
    case 'Bash':
    case 'BashOutput': {
      const cmd = parsed.command as string | undefined
      return { input: cmd ?? null, summary: cmd ? truncLine(cmd) : null }
    }
    case 'Task': {
      const desc = parsed.description as string | undefined
      const prompt = parsed.prompt as string | undefined
      return {
        input: prompt ?? desc ?? null,
        summary: desc ? truncLine(desc) : null
      }
    }
    case 'Grep': {
      const pattern = parsed.pattern as string | undefined
      const path = parsed.path as string | undefined
      const parts = [`/${pattern}/`, path].filter(Boolean).join('  ')
      return { input: parts || null, summary: pattern ? `/${truncLine(pattern, 40)}/` : null }
    }
    case 'Glob': {
      const pattern = parsed.pattern as string | undefined
      return { input: pattern ?? null, summary: pattern ? truncLine(pattern, 60) : null }
    }
    case 'Read': {
      const fp = parsed.file_path as string | undefined
      return { input: fp ?? null, summary: null }
    }
    case 'Edit':
    case 'Write': {
      const fp = parsed.file_path as string | undefined
      const oldStr = parsed.old_string as string | undefined
      const newStr = parsed.new_string as string | undefined
      const content = parsed.content as string | undefined
      const lines: string[] = []
      if (fp) lines.push(fp)
      if (oldStr) lines.push(`- ${oldStr}`)
      if (newStr) lines.push(`+ ${newStr}`)
      if (content) lines.push(content.length > 500 ? content.slice(0, 500) + '\n\u2026' : content)
      return { input: lines.join('\n') || null, summary: null }
    }
    case 'WebSearch': {
      const query = parsed.query as string | undefined
      return { input: query ?? null, summary: query ? truncLine(query) : null }
    }
    case 'WebFetch': {
      const url = parsed.url as string | undefined
      return { input: url ?? null, summary: url ? truncLine(url, 60) : null }
    }
    case 'TodoWrite': {
      const todos = parsed.todos
      if (!Array.isArray(todos)) return { input: tc.input || null, summary: null }
      const counts = { pending: 0, in_progress: 0, completed: 0 }
      for (const t of todos) counts[t.status as keyof typeof counts] = (counts[t.status as keyof typeof counts] ?? 0) + 1
      const parts: string[] = []
      if (counts.in_progress) parts.push(i18n.t('toolTodosInProgress', { count: counts.in_progress, ns: 'center' }))
      if (counts.pending) parts.push(i18n.t('toolTodosPending', { count: counts.pending, ns: 'center' }))
      if (counts.completed) parts.push(i18n.t('toolTodosDone', { count: counts.completed, ns: 'center' }))
      const summary = parts.join(', ') || i18n.t('toolTodosDefault', { count: todos.length, ns: 'center' })
      const detail = todos.map((t) => {
        const sym = t.status === 'completed' ? '✓' : t.status === 'in_progress' ? '▶' : '○'
        return `${sym} ${t.content}`
      }).join('\n')
      return { input: detail, summary }
    }
    case 'TaskCreate': {
      const subject = parsed.subject as string | undefined
      return { input: subject ?? null, summary: subject ? truncLine(subject, 60) : null }
    }
    case 'TaskUpdate': {
      const taskId = parsed.taskId as string | undefined
      const status = parsed.status as string | undefined
      const summary = [taskId, status].filter(Boolean).join(' → ')
      return { input: summary || null, summary: summary || null }
    }
    case 'TaskList':
      return { input: null, summary: null }
    case 'TaskGet': {
      const taskId = parsed.taskId as string | undefined
      return { input: taskId ?? null, summary: taskId ? `#${taskId}` : null }
    }
    case 'TaskOutput': {
      const taskId = parsed.task_id as string | undefined
      return { input: taskId ?? null, summary: taskId ? i18n.t('toolTaskSummary', { taskId: truncLine(taskId, 20), ns: 'center' }) : null }
    }
    case 'KillShell': {
      const shellId = parsed.shell_id as string | undefined
      return { input: shellId ?? null, summary: shellId ? i18n.t('toolKillShellSummary', { shellId, ns: 'center' }) : null }
    }
    case 'NotebookEdit': {
      const nbPath = parsed.notebook_path as string | undefined
      const mode = (parsed.edit_mode as string | undefined) ?? 'replace'
      const cellType = parsed.cell_type as string | undefined
      const parts = [nbPath, mode !== 'replace' ? mode : null, cellType].filter(Boolean)
      return { input: parts.join(' · ') || null, summary: nbPath ? truncLine(nbPath, 50) : null }
    }
    case 'LSP': {
      const op = parsed.operation as string | undefined
      const fp = parsed.file_path as string | undefined
      const line = parsed.line as number | undefined
      const summary = [op, fp ? fp.split('/').pop() : null, line != null ? `L${line}` : null].filter(Boolean).join(' ')
      return { input: summary || null, summary: summary || null }
    }
    case 'Skill': {
      const skill = parsed.skill as string | undefined
      const args = parsed.args as string | undefined
      return { input: [skill, args].filter(Boolean).join(' ') || null, summary: skill ? truncLine(skill, 40) : null }
    }
    case 'Mcp': {
      const serverName = parsed.server_name as string | undefined
      const toolName = parsed.tool_name as string | undefined
      const raw = tc.input?.trim()
      return {
        input: raw && raw !== '{}' ? raw : null,
        summary: [serverName, toolName].filter(Boolean).join(' › ') || null
      }
    }
    case 'ListMcpResources': {
      const server = parsed.server as string | undefined
      return { input: server ?? null, summary: server ? truncLine(server, 40) : null }
    }
    case 'ReadMcpResource': {
      const uri = parsed.uri as string | undefined
      return { input: uri ?? null, summary: uri ? truncLine(uri, 60) : null }
    }
    case 'AskUserQuestion': {
      const questions = parsed.questions as Array<{ question: string }> | undefined
      if (!questions) return { input: tc.input || null, summary: null }
      const summary = questions.length === 1
        ? truncLine(questions[0].question, 60)
        : `${questions.length} questions`
      const detail = questions.map((q) => `• ${q.question}`).join('\n')
      return { input: detail, summary }
    }
    case 'ExitPlanMode': {
      return { input: null, summary: i18n.t('toolPlanComplete', { ns: 'center' }) }
    }
    case 'Config': {
      const setting = parsed.setting as string | undefined
      const value = parsed.value as string | undefined
      return {
        input: [setting, value].filter(Boolean).join(' = ') || null,
        summary: setting ? truncLine(setting, 40) : null
      }
    }
    default: {
      const raw = tc.input?.trim()
      const input = raw && raw !== '{}' ? raw : null
      return { input, summary: null }
    }
  }
}

export function truncLine(s: string, max = 80): string {
  const firstLine = s.split('\n')[0]
  return firstLine.length > max ? firstLine.slice(0, max) + '\u2026' : firstLine
}
