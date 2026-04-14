// Per-tool render components for rich tool call display.
// Each component handles a specific tool type's input or result rendering
// with syntax highlighting, diff coloring, or structured layouts.

import { useMemo } from 'react'
import { useAsyncHighlight } from '@/hooks/useAsyncHighlight'
import { extToHljsLang } from './toolMeta'
import { IconFile } from '@/components/shared/icons'

// ── EditDiffRenderer ──────────────────────────────────────────────────────────
// Renders old_string as deletion lines and new_string as addition lines.
// No diff algorithm needed - the Edit tool IS a direct replacement, so showing
// all deletions then all additions is semantically correct (matches git diff -U0).

interface EditDiffRendererProps {
  oldString: string
  newString: string
  filePath: string
}

export function EditDiffRenderer({ oldString, newString, filePath }: EditDiffRendererProps) {
  const lang = extToHljsLang(filePath)
  const enabled = lang != null

  const highlightedOld = useAsyncHighlight(oldString || null, lang ?? 'plaintext', enabled)
  const highlightedNew = useAsyncHighlight(newString || null, lang ?? 'plaintext', enabled)

  const oldLines = useMemo(() => oldString.split('\n'), [oldString])
  const newLines = useMemo(() => newString.split('\n'), [newString])

  // Split highlighted HTML on \n to get per-line fragments.
  // hljs emits \n between lines. Multi-line <span> tags (e.g., block comments)
  // can produce unbalanced fragments - this is rare for the short strings Claude
  // produces and browsers render them gracefully.
  const oldHtmlLines = useMemo(() => highlightedOld?.split('\n') ?? null, [highlightedOld])
  const newHtmlLines = useMemo(() => highlightedNew?.split('\n') ?? null, [highlightedNew])

  return (
    <div className="tcg-inline-diff">
      {oldLines.map((line, i) => (
        <div key={`del-${i}`} className="diff-line diff-line-del">
          <span className="diff-line-gutter">-</span>
          <span
            className="diff-line-content"
            {...(oldHtmlLines
              ? { dangerouslySetInnerHTML: { __html: oldHtmlLines[i] ?? '' } }
              : { children: line }
            )}
          />
        </div>
      ))}
      {newLines.map((line, i) => (
        <div key={`add-${i}`} className="diff-line diff-line-add">
          <span className="diff-line-gutter">+</span>
          <span
            className="diff-line-content"
            {...(newHtmlLines
              ? { dangerouslySetInnerHTML: { __html: newHtmlLines[i] ?? '' } }
              : { children: line }
            )}
          />
        </div>
      ))}
    </div>
  )
}

// ── WriteRenderer ─────────────────────────────────────────────────────────────
// Syntax-highlighted file content for the Write tool.

interface WriteRendererProps {
  content: string
  filePath: string
}

export function WriteRenderer({ content, filePath }: WriteRendererProps) {
  const lang = extToHljsLang(filePath)
  const enabled = lang != null
  const highlighted = useAsyncHighlight(content || null, lang ?? 'plaintext', enabled)

  if (highlighted != null) {
    return (
      <pre className="tcg-row-code hljs">
        <code dangerouslySetInnerHTML={{ __html: highlighted }} />
      </pre>
    )
  }
  return <pre className="tcg-row-code">{content}</pre>
}

// ── ReadResultRenderer ────────────────────────────────────────────────────────
// Syntax-highlighted result text for the Read tool.

interface ReadResultRendererProps {
  result: string
  filePath: string
}

export function ReadResultRenderer({ result, filePath }: ReadResultRendererProps) {
  const lang = extToHljsLang(filePath)
  const enabled = lang != null
  const highlighted = useAsyncHighlight(result || null, lang ?? 'plaintext', enabled)

  if (highlighted != null) {
    return (
      <pre className="tcg-row-code tcg-row-code-result hljs">
        <code dangerouslySetInnerHTML={{ __html: highlighted }} />
      </pre>
    )
  }
  return <pre className="tcg-row-code tcg-row-code-result">{result}</pre>
}

// ── GrepResultRenderer ────────────────────────────────────────────────────────
// Parses ripgrep output format and renders with clickable file paths,
// muted line numbers, and highlighted pattern matches.

interface GrepResultRendererProps {
  result: string
  pattern: string
  onFileClick: (path: string) => void
}

function parseGrepLine(line: string): { filePath: string; lineNum: string; content: string } | null {
  const match = line.match(/^(.+?):(\d+):(.*)$/)
  if (!match) return null
  return { filePath: match[1], lineNum: match[2], content: match[3] }
}

function highlightPattern(text: string, regex: RegExp | null): React.ReactNode {
  if (!regex || !text) return text
  const parts = text.split(regex)
  if (parts.length === 1) return text
  return parts.map((part, i) =>
    i % 2 === 1
      ? <mark key={i} className="tcg-grep-match">{part}</mark>
      : part
  )
}

export function GrepResultRenderer({ result, pattern, onFileClick }: GrepResultRendererProps) {
  const lines = result.split('\n').filter(Boolean)

  const patternRegex = useMemo(() => {
    if (!pattern || pattern.length > 200) return null
    try { return new RegExp(`(${pattern})`, 'i') } catch { return null }
  }, [pattern])

  return (
    <div className="tcg-grep-results">
      {lines.map((line, i) => {
        const parsed = parseGrepLine(line)
        if (!parsed) {
          return <div key={i} className="tcg-grep-line tcg-grep-line--raw">{line}</div>
        }
        return (
          <div key={i} className="tcg-grep-line">
            <button
              className="tcg-grep-filepath"
              onClick={() => onFileClick(parsed.filePath)}
              title={parsed.filePath}
            >
              {parsed.filePath.split('/').pop()}
            </button>
            <span className="tcg-grep-linenum">{parsed.lineNum}</span>
            <span className="tcg-grep-content">
              {highlightPattern(parsed.content, patternRegex)}
            </span>
          </div>
        )
      })}
    </div>
  )
}

// ── GlobResultRenderer ────────────────────────────────────────────────────────
// Renders matched file paths as clickable file badges.

interface GlobResultRendererProps {
  result: string
  onFileClick: (path: string) => void
}

export function GlobResultRenderer({ result, onFileClick }: GlobResultRendererProps) {
  const paths = result.split('\n').filter(Boolean)

  return (
    <div className="tcg-glob-results">
      {paths.map((p, i) => (
        <button
          key={i}
          className="tcg-file-badge tcg-file-badge--clickable tcg-glob-badge"
          onClick={() => onFileClick(p)}
          title={p}
        >
          <span className="tcg-file-icon"><IconFile size={12} /></span>
          <span className="tcg-glob-path">{p.split('/').slice(-2).join('/')}</span>
        </button>
      ))}
    </div>
  )
}

// ── McpJsonRenderer ───────────────────────────────────────────────────────────
// Pretty-prints and syntax-highlights JSON for MCP tool inputs/results.

interface McpJsonRendererProps {
  json: string
  isResult?: boolean
}

export function McpJsonRenderer({ json, isResult }: McpJsonRendererProps) {
  const { prettyJson, isValidJson } = useMemo(() => {
    try {
      return { prettyJson: JSON.stringify(JSON.parse(json), null, 2), isValidJson: true }
    } catch {
      return { prettyJson: json, isValidJson: false }
    }
  }, [json])

  const highlighted = useAsyncHighlight(isValidJson ? prettyJson : null, 'json', isValidJson)
  const cls = isResult ? 'tcg-row-code tcg-row-code-result' : 'tcg-row-code'

  if (highlighted != null) {
    return (
      <pre className={`${cls} hljs`}>
        <code dangerouslySetInnerHTML={{ __html: highlighted }} />
      </pre>
    )
  }
  return <pre className={cls}>{prettyJson}</pre>
}
