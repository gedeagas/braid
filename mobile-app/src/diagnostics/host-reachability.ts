const HOST_REACHABILITY_TIMEOUT_MS = 4000;

// Why: the troubleshooter needs a cheap endpoint probe without completing the
// encrypted handshake - just "does the WebSocket open at all". A successful open
// proves the desktop's mobile server is reachable on the LAN; the E2EE auth is a
// separate concern the host screen surfaces.
export async function testHostReachability(endpoint: string): Promise<boolean> {
  return new Promise((resolve) => {
    let ws: WebSocket;
    try {
      ws = new WebSocket(endpoint);
    } catch {
      resolve(false);
      return;
    }

    let settled = false;
    let timeout: ReturnType<typeof setTimeout> | null = null;

    const finish = (reachable: boolean): void => {
      if (settled) return;
      settled = true;
      if (timeout) {
        clearTimeout(timeout);
        timeout = null;
      }
      try {
        ws.close();
      } catch {
        // The probe is already complete; a close failure can't change the result.
      }
      resolve(reachable);
    };

    timeout = setTimeout(() => finish(false), HOST_REACHABILITY_TIMEOUT_MS);
    ws.onopen = () => finish(true);
    ws.onerror = () => finish(false);
  });
}

/** Render an endpoint as a compact host:port for diagnostic rows. */
export function formatEndpoint(endpoint: string): string {
  try {
    return new URL(endpoint).host;
  } catch {
    return endpoint;
  }
}
