export interface PairingOffer {
  endpoint: string;
  token: string;
  serverPublicKey: string;
}

export interface PairedHost {
  id: string;
  endpoint: string;
  token: string;
  serverPublicKey: string;
  deviceName: string;
  devicePublicKey: string;
  deviceSecretKey: string;
  pairedAt: number;
  lastConnectedAt?: number;
  instanceName?: string;
}

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse<T = unknown> {
  jsonrpc: '2.0';
  id: number | string | null;
  result?: T;
  error?: { code: number; message: string; data?: unknown };
}

export interface BraidStatus {
  instanceName: string;
  version: string;
  protocolVersion: number;
  projects: Array<{ id: string; name: string; path: string }>;
  uptime: number;
}

export interface BraidProject {
  id: string;
  name: string;
  path: string;
  worktrees?: BraidWorktree[];
}

export interface BraidWorktree {
  id?: string;
  path: string;
  branch: string;
  isMain?: boolean;
}

export interface BraidMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: number;
  isPartial?: boolean;
  toolCalls?: Array<{ id: string; name: string; input?: string; result?: string; error?: string }>;
}

export interface BraidSession {
  id: string;
  worktreeId: string;
  name?: string;
  customName?: string;
  sdkSessionId?: string;
  status?: string;
  model?: string;
  thinkingEnabled?: boolean;
  extendedContext?: boolean;
  effortLevel?: string;
  planModeEnabled?: boolean;
  createdAt?: number;
  worktreePath?: string;
  messages?: BraidMessage[];
  messageCount?: number;
  totalRunDurationMs?: number;
}

export interface BraidTerminal {
  id: string;
  terminalId?: string;
  name?: string;
  title?: string;
  label?: string;
  agentId?: string;
  cwd?: string;
  worktreeId?: string;
  worktreePath?: string;
  status?: string;
}

export interface GitChange {
  file: string;
  status: string;
  staged: boolean;
  additions?: number;
  deletions?: number;
}

export interface RpcNotification {
  jsonrpc: '2.0';
  method: string;
  params: Record<string, unknown>;
}
