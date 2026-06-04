// Barrel preserving the `@/transport/client-manager` import path. The
// implementation lives in `./connection` (decomposed into types, internals,
// lifecycle, heartbeat, notifications, manager, provider).
export {
  ClientManagerProvider,
  useClientManager,
  createManager,
  type ClientManager,
  type ManagerDeps,
  type HostConnectionState,
} from './connection';
