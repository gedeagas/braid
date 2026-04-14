/**
 * Direct JSON-RPC to the mobilecli simulator server.
 * Bypasses the Electron IPC hop for latency-sensitive input (gestures, text, buttons).
 * The server runs with --cors so renderer fetch works directly.
 */
const SIM_RPC_URL = 'http://localhost:12000/rpc'
let rpcSeq = 0

export function simulatorRpc(method: string, params: Record<string, unknown>): Promise<void> {
  return fetch(SIM_RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcSeq, method, params }),
  }).then(() => undefined)
}
