import { Spinner } from '@/components/ui'
import { useState, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import hljs from 'highlight.js/lib/core'
import hljsBash from 'highlight.js/lib/languages/bash'
import hljsTs from 'highlight.js/lib/languages/typescript'
import hljsJs from 'highlight.js/lib/languages/javascript'
import hljsJson from 'highlight.js/lib/languages/json'
import hljsCss from 'highlight.js/lib/languages/css'
import hljsPython from 'highlight.js/lib/languages/python'
import hljsGo from 'highlight.js/lib/languages/go'
import hljsRust from 'highlight.js/lib/languages/rust'
import hljsXml from 'highlight.js/lib/languages/xml'
import hljsSql from 'highlight.js/lib/languages/sql'
import AnsiToHtml from 'ansi-to-html'
import type { ToolCall } from '@/types'
import { useUIStore } from '@/store/ui'
import { useAsyncHighlight } from '@/hooks/useAsyncHighlight'
import {
  IconFile, IconXCircle, IconChevronRight, IconChevronDown,
  IconCopy, IconExternalLink, IconCheckmark, IconPlay, IconCircle,
} from '@/components/shared/icons'
import { TOOL_ICONS, DEFAULT_TOOL_ICON } from './toolMeta'
import { getToolDetail } from './toolDetail'
import {
  EditDiffRenderer, WriteRenderer, ReadResultRenderer,
  GrepResultRenderer, GlobResultRenderer, McpJsonRenderer,
} from './toolRenderers'

hljs.registerLanguage('bash', hljsBash)
hljs.registerLanguage('typescript', hljsTs)
hljs.registerLanguage('javascript', hljsJs)
hljs.registerLanguage('json', hljsJson)
hljs.registerLanguage('css', hljsCss)
hljs.registerLanguage('python', hljsPython)
hljs.registerLanguage('go', hljsGo)
hljs.registerLanguage('rust', hljsRust)
hljs.registerLanguage('xml', hljsXml)
hljs.registerLanguage('sql', hljsSql)

const RESULT_TRUNCATE_LIMIT = 2000
const ansiConverter = new AnsiToHtml({ escapeXML: true })

/** Move focus to the next or previous .tcg-row-main button within the body */
function focusSiblingRow(current: HTMLElement, direction: 'next' | 'prev') {
  const body = current.closest('.tcg-body')
  if (!body) return
  const rows = Array.from(body.querySelectorAll<HTMLElement>('.tcg-row-main'))
  const idx = rows.indexOf(current)
  if (idx < 0) return
  const target = direction === 'next' ? rows[idx + 1] : rows[idx - 1]
  target?.focus()
}

function formatElapsed(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 10000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.round(ms / 1000)}s`
}

interface ToolCallRowProps {
  toolCall: ToolCall
  isInFlight?: boolean
  defaultOpen?: boolean
}

export function ToolCallRow({ toolCall, isInFlight, defaultOpen }: ToolCallRowProps) {
  const { t } = useTranslation('center')
  const [open, setOpen] = useState(defaultOpen ?? false)
  const [resultExpanded, setResultExpanded] = useState(false)
  const toolMessageStyle = useUIStore((s) => s.toolMessageStyle)
  const icon = TOOL_ICONS[toolCall.name] ?? DEFAULT_TOOL_ICON
  const displayName = toolMessageStyle === 'funny'
    ? t(`toolNameFunny.${toolCall.name}`, { defaultValue: toolCall.name })
    : t(`toolName.${toolCall.name}`, { defaultValue: toolCall.name })
  const detail = getToolDetail(toolCall)

  const isBash = toolCall.name === 'Bash' || toolCall.name === 'BashOutput'
  const isTodoWrite = toolCall.name === 'TodoWrite'
  const isEdit = toolCall.name === 'Edit'
  const isWrite = toolCall.name === 'Write'
  const isRead = toolCall.name === 'Read'
  const isGrep = toolCall.name === 'Grep'
  const isGlob = toolCall.name === 'Glob'
  const isMcp = toolCall.name === 'Mcp' || toolCall.name.startsWith('ListMcp')
    || toolCall.name.startsWith('ReadMcp') || toolCall.name.startsWith('mcp__')

  const parsedTodos = useMemo<TodoItem[] | null>(() => {
    if (!isTodoWrite) return null
    try {
      const p = JSON.parse(toolCall.input)
      return Array.isArray(p.todos) ? p.todos : null
    } catch { return null }
  }, [isTodoWrite, toolCall.input])

  const editParts = useMemo<{ oldString: string; newString: string } | null>(() => {
    if (!isEdit) return null
    try {
      const p = JSON.parse(toolCall.input)
      return { oldString: (p.old_string as string) ?? '', newString: (p.new_string as string) ?? '' }
    } catch { return null }
  }, [isEdit, toolCall.input])

  const writeContent = useMemo<string | null>(() => {
    if (!isWrite) return null
    try {
      const p = JSON.parse(toolCall.input)
      return (p.content as string) ?? null
    } catch { return null }
  }, [isWrite, toolCall.input])

  const grepPattern = useMemo(() => {
    if (!isGrep) return ''
    try {
      const p = JSON.parse(toolCall.input)
      return (p.pattern as string) ?? ''
    } catch { return '' }
  }, [isGrep, toolCall.input])

  const filePath = toolCall.filePathFull ?? toolCall.filePath ?? ''

  const handleFileClick = useCallback((path: string) => {
    useUIStore.getState().openFile(path)
  }, [])

  const highlightedInput = useAsyncHighlight(
    isBash ? detail.input : null,
    'bash',
    isBash,
  )

  const elapsed = toolCall.startedAt != null && toolCall.completedAt != null
    ? toolCall.completedAt - toolCall.startedAt
    : null

  const handleCopy = useCallback((text: string) => (e: React.MouseEvent) => {
    e.stopPropagation()
    navigator.clipboard.writeText(text)
  }, [])

  const handleRowKeyDown = useCallback((e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      focusSiblingRow(e.currentTarget, 'next')
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      focusSiblingRow(e.currentTarget, 'prev')
    }
  }, [])

  const resultText = toolCall.result ?? ''
  const isResultLong = resultText.length > RESULT_TRUNCATE_LIMIT
  const displayResult = resultExpanded ? resultText : (
    isResultLong ? resultText.slice(0, RESULT_TRUNCATE_LIMIT) : resultText
  )

  const renderedResult = useMemo(() => {
    if (!isBash || !displayResult) return null
    try {
      return ansiConverter.toHtml(displayResult)
    } catch {
      return null
    }
  }, [isBash, displayResult])

  return (
    <div className={`tcg-row ${open ? 'tcg-row-open' : ''}`}>
      <button
        className="tcg-row-main"
        onClick={() => setOpen(!open)}
        onKeyDown={handleRowKeyDown}
        aria-expanded={open}
      >
        {isInFlight ? (
          <Spinner size="sm" />
        ) : (
          <span className={`tcg-row-chevron ${open ? 'open' : ''}`}>{open ? <IconChevronDown /> : <IconChevronRight />}</span>
        )}
        <span className="tcg-row-icon">{icon}</span>
        <span className="tcg-row-name">{displayName}</span>
        {toolCall.filePath && (
          <span
            className="tcg-file-badge tcg-file-badge--clickable"
            title={toolCall.filePath}
            onClick={(e) => {
              e.stopPropagation()
              useUIStore.getState().openFile(toolCall.filePathFull!)
            }}
          >
            <span className="tcg-file-icon"><IconFile size={12} /></span>
            {toolCall.filePath}
          </span>
        )}
        {!open && detail.summary && !toolCall.filePath && (
          <span className="tcg-summary">{detail.summary}</span>
        )}
        {toolCall.diffStats && (
          <span className="tcg-diff">
            <span className="tcg-diff-add">+{toolCall.diffStats.additions}</span>
            <span className="tcg-diff-del">{'\u2212'}{toolCall.diffStats.deletions}</span>
          </span>
        )}
        {toolCall.error && <span className="tcg-error-icon"><IconXCircle /></span>}
        {elapsed != null && (
          <span className="tcg-row-elapsed">{formatElapsed(elapsed)}</span>
        )}
      </button>

      {open && (
        <div className="tcg-row-detail">
          {toolCall.filePath && (
            <button
              className="tcg-open-editor-btn"
              onClick={() => useUIStore.getState().openFile(toolCall.filePathFull!)}
              title={t('toolOpenInEditor')}
            >
              <IconExternalLink size={12} />
              {t('toolOpenInEditor')}
            </button>
          )}
          {isTodoWrite && parsedTodos ? (
            <TodoList todos={parsedTodos} />
          ) : isEdit && editParts ? (
            <div className="tcg-code-wrapper">
              <EditDiffRenderer oldString={editParts.oldString} newString={editParts.newString} filePath={filePath} />
              <button className="tcg-copy-btn tcg-copy-btn--inline" onClick={handleCopy(detail.input ?? '')} title={t('copy', { ns: 'common' })}>
                <IconCopy />
              </button>
            </div>
          ) : isWrite && writeContent ? (
            <div className="tcg-code-wrapper">
              <WriteRenderer content={writeContent} filePath={filePath} />
              <button className="tcg-copy-btn" onClick={handleCopy(writeContent)} title={t('copy', { ns: 'common' })}>
                <IconCopy />
              </button>
            </div>
          ) : isMcp && detail.input ? (
            <div className="tcg-code-wrapper">
              <McpJsonRenderer json={detail.input} />
              <button className="tcg-copy-btn" onClick={handleCopy(detail.input)} title={t('copy', { ns: 'common' })}>
                <IconCopy />
              </button>
            </div>
          ) : detail.input && (
            <div className="tcg-code-wrapper">
              {isBash && highlightedInput != null ? (
                <pre className="tcg-row-code hljs">
                  <code dangerouslySetInnerHTML={{ __html: highlightedInput }} />
                </pre>
              ) : (
                <pre className="tcg-row-code">{detail.input}</pre>
              )}
              <button className="tcg-copy-btn" onClick={handleCopy(detail.input)} title={t('copy', { ns: 'common' })}>
                <IconCopy />
              </button>
            </div>
          )}
          {toolCall.error && (
            <div className="tcg-code-wrapper">
              <pre className="tcg-row-code tcg-row-code-error">{toolCall.error}</pre>
              <button className="tcg-copy-btn" onClick={handleCopy(toolCall.error)} title={t('copy', { ns: 'common' })}>
                <IconCopy />
              </button>
            </div>
          )}
          {toolCall.result && (
            <div className="tcg-code-wrapper">
              {isRead ? (
                <ReadResultRenderer result={displayResult} filePath={filePath} />
              ) : isGrep ? (
                <GrepResultRenderer result={displayResult} pattern={grepPattern} onFileClick={handleFileClick} />
              ) : isGlob ? (
                <GlobResultRenderer result={displayResult} onFileClick={handleFileClick} />
              ) : isMcp ? (
                <McpJsonRenderer json={displayResult} isResult />
              ) : isBash && renderedResult != null ? (
                <pre
                  className="tcg-row-code tcg-row-code-result"
                  dangerouslySetInnerHTML={{ __html: renderedResult }}
                />
              ) : (
                <pre className="tcg-row-code tcg-row-code-result">{displayResult}</pre>
              )}
              <div className="tcg-code-actions">
                {isResultLong && (
                  <button
                    className="tcg-show-more-btn"
                    onClick={() => setResultExpanded(!resultExpanded)}
                  >
                    {resultExpanded
                      ? t('toolShowLess')
                      : t('toolShowMore', { count: Math.round(resultText.length / 1000) })}
                  </button>
                )}
                <button className="tcg-copy-btn tcg-copy-btn--inline" onClick={handleCopy(resultText)} title={t('copy', { ns: 'common' })}>
                  <IconCopy />
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── TodoList sub-component ────────────────────────────────────────────────────

interface TodoItem { content: string; status: string }

function TodoList({ todos }: { todos: TodoItem[] }) {
  return (
    <div className="tcg-todo-list">
      {todos.map((todo, i) => (
        <div key={i} className={`tcg-todo-item tcg-todo-item--${todo.status}`}>
          <span className="tcg-todo-icon">
            {todo.status === 'completed'
              ? <IconCheckmark size={12} />
              : todo.status === 'in_progress'
                ? <IconPlay size={11} />
                : <IconCircle size={12} />}
          </span>
          <span className="tcg-todo-content">{todo.content}</span>
        </div>
      ))}
    </div>
  )
}
