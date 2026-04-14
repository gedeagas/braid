import { useState } from 'react'
import type { ToolCall } from '@/types'

interface Props {
  toolCall: ToolCall
}

export function ToolCallBlock({ toolCall }: Props) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="tool-call">
      <div className="tool-call-header" onClick={() => setExpanded(!expanded)}>
        <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{expanded ? '▼' : '▶'}</span>
        <span className="tool-call-name">{toolCall.name}</span>
        {toolCall.result && (
          <span style={{ fontSize: 10, color: 'var(--green)', marginLeft: 'auto' }}>✓</span>
        )}
      </div>
      {expanded && (
        <div className="tool-call-body">
          <div style={{ color: 'var(--text-muted)', marginBottom: 4 }}>Input:</div>
          {toolCall.input}
          {toolCall.result && (
            <>
              <div style={{ color: 'var(--text-muted)', marginTop: 8, marginBottom: 4 }}>
                Result:
              </div>
              {toolCall.result}
            </>
          )}
        </div>
      )}
    </div>
  )
}
