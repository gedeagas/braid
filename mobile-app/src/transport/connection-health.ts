// Graduated connection-health verdict. The shared client only tracks a coarse
// socket state ('connecting' / 'connected' / 'reconnecting' / 'auth-failed');
// this turns that plus the retry counter and last-connected timestamp into the
// user-facing severity both the home screen and host screen render identically.

/** Coarse transport state owned by the ClientManager. */
export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'auth-failed';

// Why: thresholds for escalating the connection UX from a neutral
// "Reconnecting…" to an alarming "Can't reach desktop, re-pair?".
//
// - WARNING_ATTEMPTS: 3 -> label flips to "Can't connect". Calibrated to absorb
//   a normal laptop wake / brief network blip without alarming the user.
// - UNREACHABLE_ATTEMPTS: 12 -> the trigger to surface a "re-pair?" affordance.
//   MUST stay aligned with client-manager.ts GIVE_UP_AFTER_ATTEMPTS so the
//   "unreachable" verdict matches the moment the retry loop actually parks - if
//   they drift the user sees "Reconnecting…" while the loop is silently stopped.
// - STALE_SINCE_LAST_CONNECT_MS: 60s -> if we WERE connected this session but
//   haven't been for >= 1 minute despite the retry loop spinning, treat it the
//   same as never-connected. Catches the desktop's IP changing mid-session.
export const WARNING_ATTEMPTS = 3;
export const UNREACHABLE_ATTEMPTS = 12;
const STALE_SINCE_LAST_CONNECT_MS = 60_000;

export type ConnectionVerdict =
  | { kind: 'normal'; label: string }
  | { kind: 'warning'; label: string } // "Can't connect"
  | { kind: 'unreachable'; label: string; reason: 'never-connected' | 'stale' }
  | { kind: 'auth-failed'; label: string };

/** True for any verdict the UI should surface as a problem (dot turns red/amber). */
export function isErrorVerdict(verdict: ConnectionVerdict): boolean {
  return verdict.kind === 'warning' || verdict.kind === 'unreachable' || verdict.kind === 'auth-failed';
}

// Why: the manager's lastConnectedAt is a one-shot timestamp; "are we currently
// stale" has to be recomputed against now() each render. Centralized so home +
// host-detail show identical verdicts.
export function classifyConnection(args: {
  state: ConnectionState;
  reconnectAttempts: number;
  lastConnectedAt: number | null;
  nowMs?: number;
}): ConnectionVerdict {
  const { state, reconnectAttempts, lastConnectedAt } = args;
  const now = args.nowMs ?? Date.now();

  if (state === 'auth-failed') {
    return { kind: 'auth-failed', label: 'Pairing rejected' };
  }
  if (state === 'connected') {
    return { kind: 'normal', label: 'Connected' };
  }
  if (state === 'connecting') {
    return { kind: 'normal', label: 'Connecting…' };
  }
  if (state === 'disconnected') {
    return { kind: 'normal', label: 'Disconnected' };
  }

  // state === 'reconnecting' from here.
  if (reconnectAttempts >= UNREACHABLE_ATTEMPTS) {
    if (lastConnectedAt == null) {
      return { kind: 'unreachable', label: "Can't reach desktop", reason: 'never-connected' };
    }
    if (now - lastConnectedAt >= STALE_SINCE_LAST_CONNECT_MS) {
      return { kind: 'unreachable', label: "Can't reach desktop", reason: 'stale' };
    }
  }

  if (reconnectAttempts >= WARNING_ATTEMPTS) {
    return { kind: 'warning', label: "Can't connect" };
  }

  return { kind: 'normal', label: 'Reconnecting…' };
}

export type ConnectionLogLevel = 'info' | 'success' | 'warn' | 'error';

export interface ConnectionLogEntry {
  id: string;
  ts: number;
  level: ConnectionLogLevel;
  /** Short human-readable phase label, e.g. 'Opening connection'. */
  message: string;
  /** Optional second line for endpoint / error / elapsed detail. */
  detail?: string;
}
