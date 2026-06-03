// Shared types and tuning constants for the connection manager module.
import type { BraidRpcClient } from '@/transport/rpc-client';
import type { ConnectionLogEntry, ConnectionState } from '@/transport/connection-health';
import type { PairedHost } from '@/transport/types';

export const RECONNECT_BASE_MS = 1_000;
export const RECONNECT_MAX_MS = 30_000;
// Heartbeat cadence while foregrounded. Each tick probes every connected entry
// with diagnostics.ping; a probe that doesn't answer within the client's ping
// timeout means the socket is half-open (TCP dead, no close event) and the entry
// reconnects. 20s is frequent enough to surface a dead socket quickly without
// chattering on the wire. iOS only runs this while foregrounded - backgrounded
// timers are suspended, which is exactly when we close the socket anyway.
export const HEARTBEAT_INTERVAL_MS = 20_000;
// Why: stop auto-retrying once the host is clearly unreachable for a long time
// (wrong IP, port closed, host moved) so a phone on the home screen doesn't burn
// a socket open forever. MUST stay aligned with connection-health.ts
// UNREACHABLE_ATTEMPTS so the "Can't reach desktop" verdict appears exactly when
// the loop parks. The UI then offers Reconnect (resets the counter) or Re-pair.
export const GIVE_UP_AFTER_ATTEMPTS = 12;
// Bounded ring buffer of recent connection events per host, shown in the host
// screen / troubleshooter so a user can see why connecting is stuck.
export const CONNECTION_LOG_LIMIT = 40;

export type HostConnectionState = ConnectionState;

/** Per-host connection bookkeeping owned by the manager. */
export interface Entry {
  host: PairedHost;
  client: BraidRpcClient;
  state: HostConnectionState;
  /** Consecutive failed/dropped connect attempts; drives reconnect backoff. */
  attempt: number;
  offNotification: (() => void) | null;
  offClose: (() => void) | null;
  offOpen: (() => void) | null;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  /** A connect() handshake is in flight; gates reconcile from kicking a duplicate. */
  connectInFlight: boolean;
  /** A heartbeat probe is already outstanding for this entry; gates overlap. */
  pingInFlight: boolean;
  disposed: boolean;
  /** True once the first successful connect has happened (drives replay vs initial subscribe). */
  everConnected: boolean;
  /** Epoch ms of the last successful connect; null until first connect. Drives the stale verdict. */
  lastConnectedAt: number | null;
  /** Wall-clock of the in-flight connect attempt, for "connected after Ns" log detail. */
  connectStartedAt: number | null;
  /** Bounded ring buffer of recent connection events (newest last). */
  log: ConnectionLogEntry[];
  /** Desktop capabilities from status.get, fetched once per connection (null
   *  until fetched, reset on each reconnect). Gates capability-negotiated calls
   *  like push registration so we don't fire RPCs an older desktop lacks. */
  capabilities: string[] | null;
}

export interface ClientManager {
  /** Get-or-create the shared client for a host and keep it alive. */
  acquireHost: (host: PairedHost) => BraidRpcClient;
  getClient: (hostId: string) => BraidRpcClient | null;
  dropHost: (hostId: string) => void;
  /**
   * Tell the desktop to forget this device's push token so it stops sending
   * background notifications. Best-effort and only effective while connected;
   * call it before dropHost on host removal so a removed desktop goes quiet
   * (otherwise the desktop keeps the token and keeps pushing to the phone).
   */
  unregisterPush: (hostId: string) => Promise<void>;
  /**
   * Apply the device-wide "desktop notifications" toggle to every connected
   * desktop: register this device's push token everywhere when enabled, or tell
   * every desktop to forget it when disabled. Disabling must reach the desktop
   * because remote pushes are shown by the OS regardless of in-app state.
   */
  syncPushRegistration: (enabled: boolean) => Promise<void>;
  /** Current connection state for a host (for UI status). */
  getState: (hostId: string) => HostConnectionState;
  /** Consecutive failed reconnect attempts (0 when connected/idle). */
  getReconnectAttempt: (hostId: string) => number;
  /** Epoch ms of the last successful connect, or null if never connected this session. */
  getLastConnectedAt: (hostId: string) => number | null;
  /** Recent connection events for a host (oldest first), for the troubleshooter. */
  getConnectionLog: (hostId: string) => ConnectionLogEntry[];
  /**
   * Force an immediate fresh connect: clears any auth-failed/give-up state and
   * resets the retry counter. Used by the "Reconnect" affordance after the loop
   * has parked or the pairing was rejected.
   */
  forceReconnect: (hostId: string) => void;
  /** Subscribe to connection-state changes (for UI re-renders). */
  subscribe: (listener: () => void) => () => void;
  /**
   * Subscribe to desktop `notification` events (agent done / needs-input). The
   * home screen uses this to live-refresh a host's terminal states - and thus
   * its "Needs attention" list - the moment an event arrives.
   */
  subscribeActivity: (listener: (hostId: string) => void) => () => void;
}

/** Injectable seams so the manager is unit-testable without real sockets/timers. */
export interface ManagerDeps {
  /** Builds the RPC client for a host (defaults to a real BraidRpcClient). */
  createClient?: (host: PairedHost) => BraidRpcClient;
}
