import type { ContentBlock, Message, ToolCall } from '@/types'

/** Search backwards through messages for the most recently written .md file path. */
export function findPlanFilePath(messages: Message[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    const writeCalls = msg.toolCalls?.filter((tc) => tc.name === 'Write') ?? []
    for (let j = writeCalls.length - 1; j >= 0; j--) {
      try {
        const inp = JSON.parse(writeCalls[j].input) as Record<string, unknown>
        const fp = inp.file_path as string | undefined
        if (fp && fp.endsWith('.md')) return fp
      } catch { /* ignore */ }
    }
  }
  return undefined
}

export function findLastAssistantWithTools(messages: Message[]): Message | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'assistant' && messages[i].toolCalls && messages[i].toolCalls!.length > 0) {
      return messages[i]
    }
  }
  return null
}

/** Extract content blocks in order, preserving text/tool_use interleaving */
export function extractContentBlocks(msg: Record<string, unknown>): ContentBlock[] {
  const content = msg.content
  if (typeof content === 'string') {
    return content ? [{ type: 'text', text: content }] : []
  }
  if (!Array.isArray(content)) return []

  const blocks: ContentBlock[] = []
  for (const c of content) {
    const block = c as Record<string, unknown>
    if (block.type === 'text') {
      const text = (block.text as string) ?? ''
      if (text) blocks.push({ type: 'text', text })
    } else if (block.type === 'tool_use') {
      blocks.push({ type: 'tool_use', toolCall: parseToolCall(block) })
    }
  }
  return blocks
}

/** Parse a tool_use content block into a ToolCall with file info and diff stats */
export function parseToolCall(block: Record<string, unknown>): ToolCall {
  const id = (block.id as string) ?? `tc-${Date.now()}`
  const name = (block.name as string) ?? 'unknown'
  const rawInput = block.input
  const inputObj = (typeof rawInput === 'object' && rawInput !== null)
    ? rawInput as Record<string, unknown>
    : {}
  const inputStr = typeof rawInput === 'string' ? rawInput : JSON.stringify(rawInput, null, 2)

  const tc: ToolCall = { id, name, input: inputStr }

  // Extract file path from known tools
  const filePath = inputObj.file_path as string | undefined
    ?? inputObj.path as string | undefined

  if (filePath) {
    tc.filePathFull = filePath
    // Show just the filename (or last 2 segments for context)
    const parts = filePath.split('/')
    tc.filePath = parts.length > 2
      ? parts.slice(-2).join('/')
      : parts[parts.length - 1]
  }

  // Compute diff stats for Edit tool
  if (name === 'Edit' || name === 'edit') {
    const oldStr = (inputObj.old_string as string) ?? ''
    const newStr = (inputObj.new_string as string) ?? ''
    if (oldStr || newStr) {
      const additions = newStr ? newStr.split('\n').length : 0
      const deletions = oldStr ? oldStr.split('\n').length : 0
      tc.diffStats = { additions, deletions }
    }
  }

  // Compute diff stats for Write tool (all additions)
  if (name === 'Write' || name === 'write') {
    const content = (inputObj.content as string) ?? ''
    if (content) {
      tc.diffStats = { additions: content.split('\n').length, deletions: 0 }
    }
  }

  return tc
}
