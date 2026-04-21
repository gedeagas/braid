import type { ReactNode } from 'react'
import { createElement } from 'react'
import {
  IconPencil, IconFile, IconTerminal, IconSearch, IconGlobe,
  IconGitFork, IconChecklist, IconInbox, IconXCircle, IconBook,
  IconCodeBrackets, IconBolt, IconPlug, IconSliders, IconMessageQuestion,
  IconClipboardCheck, IconWrench,
} from '@/components/shared/icons'

// Tool name → SVG icon mapping
export const TOOL_ICONS: Record<string, ReactNode> = {
  Edit: createElement(IconPencil), Write: createElement(IconPencil),
  Read: createElement(IconFile),
  Bash: createElement(IconTerminal), BashOutput: createElement(IconTerminal),
  Grep: createElement(IconSearch), Glob: createElement(IconSearch),
  WebFetch: createElement(IconGlobe), WebSearch: createElement(IconGlobe),
  Task: createElement(IconGitFork),
  TodoWrite: createElement(IconChecklist),
  TaskCreate: createElement(IconChecklist),
  TaskUpdate: createElement(IconChecklist),
  TaskList: createElement(IconChecklist),
  TaskGet: createElement(IconChecklist),
  TaskOutput: createElement(IconInbox),
  KillShell: createElement(IconXCircle),
  NotebookEdit: createElement(IconBook),
  LSP: createElement(IconCodeBrackets),
  Skill: createElement(IconBolt),
  Mcp: createElement(IconPlug), ListMcpResources: createElement(IconPlug), ReadMcpResource: createElement(IconPlug),
  Config: createElement(IconSliders),
  AskUserQuestion: createElement(IconMessageQuestion),
  ExitPlanMode: createElement(IconClipboardCheck),
}

export const DEFAULT_TOOL_ICON = createElement(IconWrench)

// Tool name → summary group key (for collapsed summary counts, e.g. "3 edits · 2 searches")
// Display text is resolved via i18n: toolSummary.{groupKey} in center.json
export const TOOL_SUMMARY_GROUPS: Record<string, string> = {
  Edit: 'edit', Write: 'edit',
  Read: 'read',
  Bash: 'bash', BashOutput: 'bash',
  Grep: 'grep', Glob: 'glob',
  WebFetch: 'fetch', WebSearch: 'search',
  Task: 'task', TaskCreate: 'task', TaskUpdate: 'task', TaskList: 'task', TaskGet: 'task', TaskOutput: 'taskOutput',
  KillShell: 'kill',
  NotebookEdit: 'notebook',
  LSP: 'lsp',
  Skill: 'skill',
  Mcp: 'mcp', ListMcpResources: 'mcp', ReadMcpResource: 'mcp',
  Config: 'config',
  AskUserQuestion: 'question',
  ExitPlanMode: 'plan',
  TodoWrite: 'todo',
}

// Markdown link renderer
export function LinkRenderer({ href, children }: React.AnchorHTMLAttributes<HTMLAnchorElement>) {
  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (href) {
      e.preventDefault()
      window.api.shell.openExternal(href)
    }
  }
  return createElement('a', { href, onClick: handleClick }, children)
}

export const markdownComponents = { a: LinkRenderer }

// ── File extension → highlight.js language mapping ────────────────────────────
// Only includes languages that are registered in ToolCallRow.tsx at module level.
const EXT_HLJS: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript',
  js: 'javascript', jsx: 'javascript',
  json: 'json',
  css: 'css', scss: 'css',
  py: 'python',
  go: 'go',
  rs: 'rust',
  xml: 'xml', svg: 'xml', html: 'xml',
  sql: 'sql',
  sh: 'bash', bash: 'bash', zsh: 'bash',
}

/** Returns an hljs language name for the given file path, or null if unsupported. */
export function extToHljsLang(filePath: string): string | null {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? ''
  return EXT_HLJS[ext] ?? null
}
