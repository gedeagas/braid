import type { Terminal } from '@xterm/xterm'

const CODEX_QUESTION_HEADER = /\bQuestions?\s+\d+\s*\/\s*\d+\b/i
const CODEX_FIELD_HEADER = /\b(?:Question|Field)\s+\d+\s*\/\s*\d+\b/i
const CODEX_SUBMIT_HINT = /\b(?:Submit with|to submit (?:answer|all))\b/i
const CODEX_INPUT_MARKER = /\b(?:unanswered|answer:|user_note:|option\s+\d+\s*\/\s*\d+)\b/i

/**
 * Fallback for Codex request_user_input when the first-class hook path is not
 * available, for example when hooks are not installed or are still untrusted.
 * Detect only the structured pane text so ordinary command output in a Codex
 * terminal does not become a waiting notification.
 */
export function isCodexUserInputPromptText(text: string): boolean {
  if (!text) return false

  const hasQuestionHeader = CODEX_QUESTION_HEADER.test(text) || CODEX_FIELD_HEADER.test(text)
  if (!hasQuestionHeader) return false

  return CODEX_INPUT_MARKER.test(text) || CODEX_SUBMIT_HINT.test(text)
}

/** Read the tail of the active xterm buffer as plain text for status detection. */
export function readTerminalBufferTail(term: Terminal, maxLines = 32): string {
  const buffer = term.buffer.active
  const start = Math.max(0, buffer.length - maxLines)
  const lines: string[] = []

  for (let i = start; i < buffer.length; i++) {
    const line = buffer.getLine(i)
    if (line) lines.push(line.translateToString(true))
  }

  return lines.join('\n')
}
