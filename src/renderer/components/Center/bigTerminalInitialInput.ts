// Pastes a launch draft (e.g. ticket context) into a freshly started agent
// TUI once its input box is ready to accept bracketed paste.

import * as ipc from '@/lib/ipc'

/** The parts of a big terminal entry this module reads. */
export interface InputTarget {
  disposed: boolean
  ptyId: string | null
}

const BRACKETED_PASTE_BEGIN = '\x1b[200~'
const BRACKETED_PASTE_END = '\x1b[201~'
// DECSET 2004 (bracketed-paste-enable): every TUI agent we launch emits this on
// its output stream once its input layer is wired up. Treat it as the protocol
// "I accept bracketed paste" handshake.
const DECSET_BRACKETED_PASTE = '\x1b[?2004h'
// After the handshake, wait for the agent's render burst to go quiet before
// pasting - some TUIs (e.g. OpenCode) emit DECSET during alt-screen setup, then
// keep painting for ~1s; pasting into that gap drops bytes.
const AGENT_READY_QUIET_MS = 1500
const AGENT_READY_TIMEOUT_MS = 8000

export function sanitizeInitialInput(input: string): string {
  return input
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, '')
}

/**
 * Resolve once the agent on `ptyId` has rendered an input box that accepts
 * bracketed paste, or on timeout. Taps the global PTY data stream as a sidecar
 * observer (it does not take over the primary handler that feeds xterm): waits
 * for DECSET 2004, then for `AGENT_READY_QUIET_MS` of stream silence so the
 * paste lands in the mounted input buffer instead of being dropped mid-render.
 * On hard timeout it resolves true only if the handshake was seen at all.
 */
function waitForAgentInputReady(entry: InputTarget, ptyId: string): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false
    let saw2004 = false
    let recent = ''
    let quietTimer: ReturnType<typeof setTimeout> | null = null
    let hardTimer: ReturnType<typeof setTimeout> | null = null
    let unsubscribe: (() => void) | null = null
    // Guards the case where ipc.pty.onData invokes the callback synchronously
    // (and finish() runs) before the unsubscribe handle is assigned below.
    let pendingUnsubscribe = false

    const finish = (value: boolean): void => {
      if (settled) return
      settled = true
      if (quietTimer) clearTimeout(quietTimer)
      if (hardTimer) clearTimeout(hardTimer)
      if (unsubscribe) { try { unsubscribe() } catch {} }
      else pendingUnsubscribe = true
      resolve(value)
    }

    const armQuietTimer = (): void => {
      if (quietTimer) clearTimeout(quietTimer)
      quietTimer = setTimeout(() => finish(true), AGENT_READY_QUIET_MS)
    }

    unsubscribe = ipc.pty.onData((id, data) => {
      if (settled || id !== ptyId) return
      if (entry.disposed || entry.ptyId !== ptyId) { finish(false); return }
      if (!saw2004) {
        // Keep a small tail so the escape sequence is still found if it splits
        // across two IPC frames.
        const combined = recent + data
        recent = combined.slice(-512)
        if (combined.indexOf(DECSET_BRACKETED_PASTE) === -1) return
        saw2004 = true
      }
      armQuietTimer()
    })
    // If the callback already settled synchronously, tear down the listener now.
    if (pendingUnsubscribe) { try { unsubscribe?.() } catch {} unsubscribe = null }

    if (!settled) hardTimer = setTimeout(() => finish(saw2004), AGENT_READY_TIMEOUT_MS)
  })
}

export async function writeInitialAgentInput(entry: InputTarget, ptyId: string, input: string): Promise<void> {
  const sanitized = sanitizeInitialInput(input).trim()
  if (!sanitized) return

  const ready = await waitForAgentInputReady(entry, ptyId)
  if (!ready || entry.disposed || entry.ptyId !== ptyId) return

  // Bracketed-paste the ticket context as an editable DRAFT. No trailing
  // newline → the agent does not auto-submit; the user reviews and sends.
  ipc.pty.write(ptyId, `${BRACKETED_PASTE_BEGIN}${sanitized}${BRACKETED_PASTE_END}`)
}
