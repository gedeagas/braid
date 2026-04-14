/**
 * Permission rule matching — extracted from agentWorker.ts.
 *
 * ⚠️  DO NOT import from 'electron' here. This module must stay free of
 * Electron dependencies so it remains unit-testable in isolation.
 */

// ── Glob / rule helpers ────────────────────────────────────────────────────

/**
 * Glob match supporting * (any chars except /), ** (any chars incl. /),
 * and ? (single non-/ char).
 *
 * Uses a linear-scan algorithm instead of RegExp to avoid ReDoS risk
 * from patterns like `*a*a*a*b` which cause exponential backtracking.
 */
export function globMatch(pattern: string, str: string): boolean {
  // Tokenise the pattern into literal, *, **, ? segments
  const tokens: Array<{ type: 'literal'; value: string } | { type: '**' } | { type: '*' } | { type: '?' }> = []
  let i = 0
  let lit = ''
  while (i < pattern.length) {
    if (pattern[i] === '*' && pattern[i + 1] === '*') {
      if (lit) { tokens.push({ type: 'literal', value: lit }); lit = '' }
      tokens.push({ type: '**' })
      i += 2
    } else if (pattern[i] === '*') {
      if (lit) { tokens.push({ type: 'literal', value: lit }); lit = '' }
      tokens.push({ type: '*' })
      i++
    } else if (pattern[i] === '?') {
      if (lit) { tokens.push({ type: 'literal', value: lit }); lit = '' }
      tokens.push({ type: '?' })
      i++
    } else {
      lit += pattern[i]
      i++
    }
  }
  if (lit) tokens.push({ type: 'literal', value: lit })

  // DP-free recursive match with memoisation (O(tokens × str.length))
  const memo = new Map<string, boolean>()
  function match(ti: number, si: number): boolean {
    const key = `${ti},${si}`
    if (memo.has(key)) return memo.get(key)!
    let result: boolean
    if (ti === tokens.length) {
      result = si === str.length
    } else {
      const tok = tokens[ti]
      if (tok.type === 'literal') {
        result = str.startsWith(tok.value, si) && match(ti + 1, si + tok.value.length)
      } else if (tok.type === '?') {
        result = si < str.length && str[si] !== '/' && match(ti + 1, si + 1)
      } else if (tok.type === '*') {
        // * matches zero or more non-/ chars
        result = false
        for (let j = si; j <= str.length; j++) {
          if (j > si && str[j - 1] === '/') break
          if (match(ti + 1, j)) { result = true; break }
        }
      } else {
        // ** matches zero or more chars including /
        result = false
        for (let j = si; j <= str.length; j++) {
          if (match(ti + 1, j)) { result = true; break }
        }
      }
    }
    memo.set(key, result)
    return result
  }
  return match(0, 0)
}

/**
 * Match a permission rule detail pattern against an input string, using
 * Claude Code–compatible semantics:
 *
 *   - "command:subpattern"  → Legacy Claude Code format for Bash rules.
 *   - "cmd *" (space + * at end) → Word-boundary format.
 *   - Bash pattern without wildcards → prefix match with word boundary.
 *   - Bash pattern with wildcards → command glob.
 *   - File path pattern without "/"  → match against basename.
 *   - File path pattern → standard glob (* = non-slash, ** = any).
 */
export function ruleMatch(pattern: string, inputStr: string, isCommand: boolean): boolean {
  if (isCommand) {
    // Legacy "prefix:subpattern" convention
    const colonIdx = pattern.indexOf(':')
    if (colonIdx !== -1) {
      const prefix = pattern.slice(0, colonIdx)
      const subPattern = pattern.slice(colonIdx + 1)
      if (inputStr !== prefix && !inputStr.startsWith(prefix + ' ')) return false
      const rest = inputStr.startsWith(prefix + ' ') ? inputStr.slice(prefix.length + 1) : ''
      return globMatch(subPattern, rest)
    }
    // No wildcards → prefix match with word boundary
    if (!pattern.includes('*') && !pattern.includes('?')) {
      return inputStr === pattern || inputStr.startsWith(pattern + ' ')
    }
    // Space + * at end → canonical new format
    if (pattern.endsWith(' *')) {
      const prefix = pattern.slice(0, -2)
      return inputStr === prefix || inputStr.startsWith(prefix + ' ')
    }
    // General wildcard for commands: * matches any chars, ? matches single char
    // Use globMatch with ** semantics (/ is not a separator in command strings)
    const cmdGlob = pattern.replace(/\*(?!\*)/g, '**')
    return globMatch(cmdGlob, inputStr)
  }

  // File path: if pattern has no path separator, match against the basename
  if (!pattern.includes('/')) {
    const basename = inputStr.includes('/')
      ? inputStr.slice(inputStr.lastIndexOf('/') + 1)
      : inputStr
    if (globMatch(pattern, basename)) return true
  }
  return globMatch(pattern, inputStr)
}

/**
 * Extract the "primary" string from a tool's input that permission rule
 * patterns should be matched against.
 */
function getToolInputString(toolName: string, input: Record<string, unknown>): string | null {
  switch (toolName) {
    case 'Bash':
    case 'BashOutput':
    case 'KillBash':
      return typeof input.command === 'string' ? input.command : null
    case 'Read':
    case 'Write':
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit':
    case 'Glob':
    case 'Grep':
      return typeof input.file_path === 'string' ? input.file_path
        : typeof input.path === 'string' ? input.path
        : typeof input.pattern === 'string' ? input.pattern
        : null
    case 'WebFetch':
      return typeof input.url === 'string' ? input.url : null
    default: {
      const val = input.command ?? input.file_path ?? input.path ?? input.url
      return typeof val === 'string' ? val : null
    }
  }
}

/**
 * Check whether a rule's tool-name token matches an actual tool name.
 *
 * Supports:
 *   "Bash"            → exact match
 *   "mcp__server__*"  → wildcard: all tools from that MCP server
 *   "mcp__server"     → bare server name: same as mcp__server__*
 */
function toolNameMatches(ruleToolName: string, actualToolName: string): boolean {
  if (ruleToolName === actualToolName) return true

  // Edit rules cover all file-editing tools
  if (ruleToolName === 'Edit' &&
    (actualToolName === 'Write' || actualToolName === 'MultiEdit' || actualToolName === 'NotebookEdit')) {
    return true
  }

  // Read rules cover all read tools
  if (ruleToolName === 'Read' && (actualToolName === 'Glob' || actualToolName === 'Grep')) {
    return true
  }

  // Bash rules cover BashOutput and KillBash
  if (ruleToolName === 'Bash' && (actualToolName === 'BashOutput' || actualToolName === 'KillBash')) {
    return true
  }

  // MCP wildcard
  if (ruleToolName.endsWith('__*') && actualToolName.startsWith(ruleToolName.slice(0, -1))) {
    return true
  }

  // MCP bare server name
  if (
    ruleToolName.startsWith('mcp__') &&
    !ruleToolName.slice(5).includes('__') &&
    actualToolName.startsWith(ruleToolName + '__')
  ) {
    return true
  }

  return false
}

/**
 * Returns true if the tool call matches any rule in the given list.
 *
 * Rule format: "ToolName" or "ToolName(specifier)"
 *   - Bash(npm run *)      → command prefix wildcard
 *   - Bash(git:*)          → legacy colon format
 *   - Read(./src/**)       → gitignore-style path pattern
 *   - Edit(/src/**)        → covers Write, MultiEdit, NotebookEdit too
 *   - mcp__server__*       → all tools from an MCP server
 */
export function matchesRuleList(toolName: string, input: Record<string, unknown>, rules: string[]): boolean {
  const isCommand = toolName === 'Bash' || toolName === 'BashOutput' || toolName === 'KillBash'
  for (const rule of rules) {
    const m = rule.match(/^([^(]+?)(?:\((.+)\))?$/)
    if (!m) continue
    const [, ruleTool, ruleDetail] = m
    if (!toolNameMatches(ruleTool.trim(), toolName)) continue
    if (!ruleDetail) return true
    const inputStr = getToolInputString(toolName, input)
    if (inputStr !== null && ruleMatch(ruleDetail, inputStr, isCommand)) return true
  }
  return false
}

/** @deprecated Use matchesRuleList — kept for any external callers. */
export function matchesDenyList(toolName: string, input: Record<string, unknown>, rules: string[]): boolean {
  return matchesRuleList(toolName, input, rules)
}
