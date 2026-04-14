import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { PendingToolPermission } from '@/types'
import { IconLock } from '@/components/shared/icons'

interface Props {
  pendingToolPermission: PendingToolPermission
  onAllow: () => void
  onAlwaysAllow: (rule: string) => void
  onDeny: () => void
}

// ── Tool badge colour (CSS class suffix) ─────────────────────────────────────

function toolColorClass(toolName: string): string {
  switch (toolName) {
    case 'Bash':
    case 'BashOutput':
    case 'KillBash':
      return 'orange'
    case 'Read':
    case 'Glob':
    case 'Grep':
      return 'blue'
    case 'Write':
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit':
      return 'yellow'
    case 'WebFetch':
    case 'WebSearch':
      return 'purple'
    case 'Task':
    case 'TaskOutput':
      return 'green'
    default:
      return 'accent'
  }
}

// ── Input display ─────────────────────────────────────────────────────────────

/** Extract the primary value from tool input for display. */
function primaryValue(toolName: string, input: Record<string, unknown>): string {
  if (toolName === 'Bash' || toolName === 'BashOutput' || toolName === 'KillBash') {
    return typeof input.command === 'string' ? input.command : ''
  }
  const val = input.file_path ?? input.path ?? input.url ?? input.query ?? input.pattern
  if (typeof val === 'string') return val
  if (Object.keys(input).length === 0) return ''
  try { return JSON.stringify(input, null, 2) } catch { return '' }
}

// ── "Always Allow" rule derivation ───────────────────────────────────────────

/**
 * Derive a wildcard allow-list rule from the tool + input.
 * Follows Claude Code's permission rule format exactly.
 *
 * Returns null when no useful pattern can be derived.
 */
export function deriveAlwaysAllowRule(
  toolName: string,
  input: Record<string, unknown>
): string | null {
  // Bash family — allow all invocations of the same program
  // "git commit -m '...'" → "Bash(git *)"
  if (toolName === 'Bash' || toolName === 'BashOutput' || toolName === 'KillBash') {
    const cmd = (typeof input.command === 'string' ? input.command : '').trim()
    const firstWord = cmd.split(/\s+/)[0]
    if (!firstWord) return null
    return `Bash(${firstWord} *)`
  }

  // Read family — bare "Read" covers Glob and Grep per Claude Code docs
  if (toolName === 'Read' || toolName === 'Glob' || toolName === 'Grep') {
    return 'Read'
  }

  // Edit family — bare "Edit" covers Write, MultiEdit, NotebookEdit per Claude Code docs
  if (toolName === 'Write' || toolName === 'Edit' || toolName === 'MultiEdit' || toolName === 'NotebookEdit') {
    return 'Edit'
  }

  // WebFetch — domain-scoped rule: "WebFetch(domain:example.com)"
  if (toolName === 'WebFetch') {
    const url = typeof input.url === 'string' ? input.url : ''
    try {
      const { hostname } = new URL(url)
      if (hostname) return `WebFetch(domain:${hostname})`
    } catch { /* invalid URL */ }
    return 'WebFetch'
  }

  // WebSearch — bare rule (no meaningful specifier)
  if (toolName === 'WebSearch') {
    return 'WebSearch'
  }

  // Task family — bare rule
  if (toolName === 'Task' || toolName === 'TaskOutput') {
    return 'Task'
  }

  // MCP tools — server-level wildcard: "mcp__server__tool" → "mcp__server__*"
  if (toolName.startsWith('mcp__')) {
    const parts = toolName.split('__')
    if (parts.length >= 3) {
      return `${parts[0]}__${parts[1]}__*`
    }
    // Already bare server name
    return toolName
  }

  return null
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ToolPermissionPrompt({ pendingToolPermission, onAllow, onAlwaysAllow, onDeny }: Props) {
  const { t } = useTranslation('center')
  const promptRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    promptRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [])

  const { toolName, toolInput, displayName } = pendingToolPermission
  const colorClass = toolColorClass(toolName)
  const value = primaryValue(toolName, toolInput)
  const alwaysAllowRule = deriveAlwaysAllowRule(toolName, toolInput)
  // Derive a human-readable label for the button:
  //   "Bash(git *)"                → "git *"
  //   "WebFetch(domain:example.com)" → "example.com"
  //   "Read" / "Edit" / "WebSearch"  → shown as-is
  //   "mcp__server__*"             → "server (all tools)"
  const ruleLabel = (() => {
    if (!alwaysAllowRule) return null
    // Has specifier — strip wrapper
    const inner = alwaysAllowRule.replace(/^[^(]+\(/, '').replace(/\)$/, '')
    if (inner !== alwaysAllowRule) {
      // Strip "domain:" prefix for WebFetch for cleaner display
      return inner.replace(/^domain:/, '')
    }
    // MCP server wildcard — show friendly name
    if (alwaysAllowRule.endsWith('__*')) {
      const server = alwaysAllowRule.split('__')[1]
      return server ? `${server} (all tools)` : alwaysAllowRule
    }
    return alwaysAllowRule
  })()

  return (
    <div className="tool-permission-prompt" ref={promptRef}>
      <div className="tool-permission-header">
        <IconLock size={11} className="tool-permission-header-icon" />
        <span className="tool-permission-header-text">{t('toolPermissionTitle')}</span>
      </div>

      <div className="tool-permission-body">
        <div className="tool-permission-meta">
          <span className={`tool-permission-badge tool-permission-badge--${colorClass}`}>
            {toolName}
          </span>
          {displayName && displayName !== toolName && (
            <span className="tool-permission-display-name">{displayName}</span>
          )}
        </div>

        {value && (
          <pre className="tool-permission-input">
            {toolName === 'Bash' && (
              <span className="tool-permission-input-prefix">$ </span>
            )}
            {value}
          </pre>
        )}
      </div>

      <div className="tool-permission-actions">
        <button className="tool-permission-allow-btn" onClick={onAllow}>
          {t('toolPermissionAllow')}
        </button>
        {alwaysAllowRule && ruleLabel && (
          <button
            className="tool-permission-always-btn"
            onClick={() => onAlwaysAllow(alwaysAllowRule)}
            title={t('toolPermissionAlwaysAllowTooltip', { rule: alwaysAllowRule })}
          >
            {t('toolPermissionAlwaysAllow', { pattern: ruleLabel })}
          </button>
        )}
        <button className="tool-permission-deny-btn" onClick={onDeny}>
          {t('toolPermissionDeny')}
        </button>
      </div>
    </div>
  )
}
