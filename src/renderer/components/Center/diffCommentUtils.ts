/**
 * Shared utilities for building and parsing diff comment / snippet XML blocks.
 * Used by DiffReviewView (inline comments), ChatView (chat send),
 * ChatMessage (display), and QueuedMessageBanner (preview).
 */
import type { DiffComment } from '@/types'

/* ---- Escape / unescape ---- */

function escXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export function unescXml(s: string): string {
  return s.replace(/&quot;/g, '"').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&')
}

/* ---- Build (serialize) ---- */

export function buildDiffCommentBlocks(comments: DiffComment[]): string {
  if (comments.length === 0) return ''
  const blocks = comments.map((c) => {
    const lineAttr = c.endLine != null ? `lines="${c.line}-${c.endLine}"` : `line="${c.line}"`
    const codeLines = c.lineContents?.length ? c.lineContents : [c.lineContent]
    const codeBlock = `\n<code>\n${codeLines.map(escXml).join('\n')}\n</code>`
    return `<diff-comment file="${escXml(c.file)}" ${lineAttr} line-type="${c.lineType}">${codeBlock}\n${escXml(c.text)}\n</diff-comment>`
  }).join('\n')
  return `<diff-comments>\n${blocks}\n</diff-comments>`
}

/* ---- Parse (deserialize) ---- */

export interface ParsedDiffComment {
  file: string
  lines: string
  lineType: 'add' | 'del' | 'ctx'
  code: string[]
  comment: string
}

export function parseDiffComments(raw: string): ParsedDiffComment[] {
  const result: ParsedDiffComment[] = []
  const re = /<diff-comment\s+file="([^"]*)"\s+lines?="([^"]*)"\s+line-type="([^"]*)">\s*<code>\s*([\s\S]*?)\s*<\/code>\s*([\s\S]*?)\s*<\/diff-comment>/g
  for (const m of raw.matchAll(re)) {
    const code = unescXml(m[4].trim()).split('\n')
    result.push({
      file: unescXml(m[1]),
      lines: m[2],
      lineType: m[3] as 'add' | 'del' | 'ctx',
      code,
      comment: unescXml(m[5]).trim(),
    })
  }
  return result
}

export interface ParsedSnippet {
  lines: number
  content: string
  firstLine: string
}

export function parseSnippets(raw: string): ParsedSnippet[] {
  const result: ParsedSnippet[] = []
  for (const m of raw.matchAll(/<snippet lines="(\d+)">([\s\S]*?)<\/snippet>/g)) {
    const content = m[2].trim()
    const firstLine = content.split('\n').find((l) => l.trim()) || ''
    result.push({ lines: Number(m[1]), content, firstLine })
  }
  return result
}

/* ---- Terminal blocks ---- */

export interface ParsedTerminalBlock {
  content: string
  lineCount: number
  terminalCount: number
  firstLine: string
}

export function parseTerminalBlocks(raw: string): ParsedTerminalBlock[] {
  const result: ParsedTerminalBlock[] = []
  for (const m of raw.matchAll(/<terminal>([\s\S]*?)<\/terminal>/g)) {
    const content = m[1].trim()
    const lines = content.split('\n')
    const terminalCount = (content.match(/^--- Terminal \d+/gm) || []).length || 1
    const firstLine = lines.find((l) => l.trim() && !l.startsWith('--- Terminal')) || lines[0] || ''
    result.push({ content, lineCount: lines.length, terminalCount, firstLine })
  }
  return result
}

/**
 * Strip attachment blocks (snippets, diff comments, images, file tags, terminal)
 * from a message string, returning only human-readable text.
 */
export function stripAttachmentBlocks(text: string): string {
  return text
    .replace(/<snippet lines="\d+">[\s\S]*?<\/snippet>\s*/g, '')
    .replace(/<diff-comments>[\s\S]*?<\/diff-comments>\s*/g, '')
    .replace(/\[Image \d+\]: data:[^\s]+/g, '')
    .replace(/<file path="[^"]*">[\s\S]*?<\/file>\s*/g, '')
    .replace(/<terminal>[\s\S]*?<\/terminal>\s*/g, '')
    .trim()
}
