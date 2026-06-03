// Pure decision function for the connection manager's reconcile loop.
//
// The manager does NOT react to AppState deltas ("I saw `background`, so I know
// to reconnect on `active`"). That assumption is what stranded the terminal
// after a long iOS background: the OS can freeze the JS thread mid-transition,
// coalesce lifecycle events, or tear the TCP socket down without ever delivering
// a `close`. Instead the manager holds a *desired* state and, on every trigger
// (foreground, network change, screen mount, heartbeat failure), reconciles
// reality toward it by calling decideReconcile() and applying the action.
//
// Keeping the decision pure (no timers, no sockets, no React) makes the entire
// resume/liveness matrix unit-testable without a WebSocket or a fake clock.

import type { ConnectionState } from './connection-health';

/** What the manager should do to move an entry toward the desired state. */
export type ReconcileAction =
  | 'none' // already in the desired shape; leave it alone
  | 'connect' // start a fresh connect (idle -> connecting)
  | 'reconnect' // the socket is dead/half-open; tear down and reconnect
  | 'close'; // we no longer want this connected (app backgrounded)

export interface ReconcileInput {
  /** Whether the app currently wants this host connected (true while foregrounded). */
  desiredConnected: boolean;
  /** The manager's cached coarse state for the entry. */
  state: ConnectionState;
  /** Ground truth from the socket: is it actually OPEN right now? */
  socketOpen: boolean;
  /** A connect() handshake is currently in flight (don't kick a second one). */
  connectInFlight: boolean;
  /** A backoff reconnect timer is already armed (let it fire). */
  reconnectScheduled: boolean;
}

/**
 * Decide the single action that moves an entry toward the desired state. Pure
 * and idempotent: calling it repeatedly with the same input yields the same
 * action, so the manager can reconcile on any trigger without tracking deltas.
 */
export function decideReconcile(input: ReconcileInput): ReconcileAction {
  const { desiredConnected, state, socketOpen, connectInFlight, reconnectScheduled } = input;

  // Backgrounded: we want the socket gone. Close it unless it's already down.
  if (!desiredConnected) {
    return state === 'disconnected' && !socketOpen ? 'none' : 'close';
  }

  // A rejected pairing is terminal - retrying the dead token only churns. The
  // user must explicitly Reconnect / Re-pair (forceReconnect resets this).
  if (state === 'auth-failed') return 'none';

  // We believe we're connected. Trust the socket, not the cached state: a
  // half-open socket (TCP dead, no close event) reads connected but is useless,
  // so reconnect it. This is the case the old delta-reactive code missed on
  // resume from a long background.
  if (state === 'connected') {
    return socketOpen ? 'none' : 'reconnect';
  }

  // A connect/reconnect is already progressing - don't pile on a duplicate.
  if (connectInFlight || reconnectScheduled) return 'none';

  // Idle (disconnected) or a stalled connecting/reconnecting with nothing in
  // flight: drive a fresh connect.
  return 'connect';
}
