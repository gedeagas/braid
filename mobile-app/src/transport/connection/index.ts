// Public surface of the connection manager module.
export { createManager, type InternalManager } from './manager';
export { ClientManagerProvider, useClientManager } from './provider';
export type { ClientManager, ManagerDeps, HostConnectionState } from './types';
