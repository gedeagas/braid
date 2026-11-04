// Agent status detection inside the daemon, against a session's headless
// terminal: OSC 9999 / OSC 9 braid sequences, title markers, and the Codex
// request_user_input pane. The same detectors the renderer ran, from
// @shared/agent-detection, so results are identical. With a daemon that has
// them, the renderer turns its own detectors off (nothing fires twice).

import type { Terminal } from '@xterm/headless'
import { registerAgentStatusOsc, registerBraidOsc9 } from '../../../../shared/agent-detection/osc'
import { registerTitleDetection } from '../../../../shared/agent-detection/title'
import { isCodexUserInputPromptText, readTerminalBufferTail } from '../../../../shared/agent-detection/codex'
import { isKnownAgentType, type AgentType } from '../../../../shared/agent-detection/types'
import type { AgentStatusEvent } from '../protocol'

const CODEX_SCAN_DEBOUNCE_MS = 80
/** Re-announce a still-visible Codex prompt at most this often. */
const CODEX_SCAN_REPEAT_MS = 2_000

export interface DetectorContext {
  /** Catalog agent of the tab (session metadata), when known. */
  expectedAgentType(): string | undefined
  /** False while the output being parsed is seeded or replayed history. */
  isLive(): boolean
  emit(event: Omit<AgentStatusEvent, 'type' | 'sessionId'>): void
}

export function registerDaemonDetectors(term: Terminal, ctx: DetectorContext): () => void {
  let lastAgentType: string | undefined
  let scanTimer: ReturnType<typeof setTimeout> | null = null
  let lastScanAt = 0
  let scanMatched = false

  const emit = (event: Omit<AgentStatusEvent, 'type' | 'sessionId'>): void => {
    if (event.status.agentType) lastAgentType = event.status.agentType
    ctx.emit(event)
  }
  const expected = (): AgentType | undefined => {
    const a = ctx.expectedAgentType()
    return isKnownAgentType(a) ? a : undefined
  }

  registerAgentStatusOsc(term, (payload) => {
    emit({ kind: 'osc', status: payload, replayed: !ctx.isLive() })
  })
  registerBraidOsc9(term, (payload) => {
    emit({ kind: 'osc9', status: payload, replayed: !ctx.isLive() })
  })
  registerTitleDetection(term, (result) => {
    emit({ kind: 'title', status: { state: result.state, agentType: result.agentType ?? undefined }, replayed: !ctx.isLive() })
  }, { get expectedAgentType() { return expected() } })

  const isCodex = (): boolean => ctx.expectedAgentType() === 'codex' || lastAgentType === 'codex'
  const scan = (): void => {
    scanTimer = null
    if (!ctx.isLive() || !isCodex()) return
    const matched = isCodexUserInputPromptText(readTerminalBufferTail(term))
    const now = Date.now()
    if (matched && (!scanMatched || now - lastScanAt >= CODEX_SCAN_REPEAT_MS)) {
      lastScanAt = now
      emit({ kind: 'scan', status: { state: 'waiting', agentType: 'codex' }, replayed: false })
    }
    scanMatched = matched
  }
  const parsed = term.onWriteParsed(() => {
    if (scanTimer || !isCodex()) return
    scanTimer = setTimeout(scan, CODEX_SCAN_DEBOUNCE_MS)
  })

  return () => {
    parsed.dispose()
    if (scanTimer) clearTimeout(scanTimer)
  }
}
