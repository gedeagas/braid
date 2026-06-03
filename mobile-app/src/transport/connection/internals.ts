// The manager's shared mutable state, threaded explicitly through the
// lifecycle/heartbeat/notification function groups instead of captured in one
// giant closure. Passing `self` keeps each group in its own file while still
// sharing one entries map, one heartbeat timer, and the listener fan-out.
import { BraidRpcClient } from '@/transport/rpc-client';
import type { ConnectionLogLevel } from '@/transport/connection-health';
import type { PairedHost } from '@/transport/types';

import { CONNECTION_LOG_LIMIT, type Entry, type ManagerDeps } from './types';

export interface ManagerInternals {
  readonly createClient: (host: PairedHost) => BraidRpcClient;
  readonly entries: Map<string, Entry>;
  readonly listeners: Set<() => void>;
  readonly activityListeners: Set<(hostId: string) => void>;
  /**
   * Desired state, not an observed delta: true means "the app wants its hosts
   * connected" (foregrounded). Every trigger reconciles reality toward this
   * instead of reacting to a specific lifecycle event, so a missed/coalesced
   * AppState transition can't strand a dead socket.
   */
  desiredConnected: boolean;
  /** Single foreground heartbeat timer (null while backgrounded / stopped). */
  heartbeatTimer: ReturnType<typeof setInterval> | null;
  logSeq: number;
  /** Notify connection-state listeners (drives UI re-renders). */
  emit(): void;
  /** Wake activity listeners (home screen "Needs attention" live refresh). */
  emitActivity(hostId: string): void;
  /**
   * Append a bounded connection-log entry. Newest entries live at the end; the
   * ring buffer is trimmed from the front so the log can't grow unbounded over a
   * long-lived session of reconnect churn.
   */
  pushLog(entry: Entry, level: ConnectionLogLevel, message: string, detail?: string): void;
}

export function createInternals(deps: ManagerDeps): ManagerInternals {
  const self: ManagerInternals = {
    createClient: deps.createClient ?? ((host: PairedHost) => new BraidRpcClient(host)),
    entries: new Map(),
    listeners: new Set(),
    activityListeners: new Set(),
    desiredConnected: true,
    heartbeatTimer: null,
    logSeq: 0,
    emit() {
      for (const listener of self.listeners) listener();
    },
    emitActivity(hostId: string) {
      for (const listener of self.activityListeners) listener(hostId);
    },
    pushLog(entry, level, message, detail) {
      entry.log.push({ id: `clog-${++self.logSeq}`, ts: Date.now(), level, message, detail });
      if (entry.log.length > CONNECTION_LOG_LIMIT) entry.log.splice(0, entry.log.length - CONNECTION_LOG_LIMIT);
    },
  };
  return self;
}
