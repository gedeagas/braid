// Maps desktop notification payloads to local-notification data and to the
// in-app deep-link path. Braid consolidates on the terminal screen, so taps
// route to `/terminal/[hostId]` and, when the desktop supplied a terminal id,
// pre-select that exact tab.

/** Params as delivered by the desktop `notification` RPC (minus subscriptionId). */
export interface DesktopNotificationParams {
  type?: string;
  title?: string;
  body?: string;
  worktreePath?: string;
  terminalId?: string;
  branch?: string;
  projectName?: string;
}

/** Data embedded in the scheduled local notification, read back on tap. */
export interface LocalNotificationData {
  // Index signature: expo-notifications types `content.data` as Record<string, unknown>.
  [key: string]: unknown;
  hostId: string;
  worktreePath?: string;
  terminalId?: string;
  worktreeName?: string;
}

export interface NotificationNavigationOptions {
  knownHostIds?: ReadonlySet<string>;
}

function readNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

export function buildLocalNotificationData(
  params: DesktopNotificationParams,
  hostId: string,
): LocalNotificationData {
  const data: LocalNotificationData = { hostId };
  if (params.worktreePath) data.worktreePath = params.worktreePath;
  if (params.terminalId) data.terminalId = params.terminalId;
  if (params.branch) data.worktreeName = params.branch;
  return data;
}

/**
 * Resolves the deep-link path for a tapped notification, or null when the
 * payload is unusable (unknown host, missing host id).
 */
export function getNotificationNavigationPath(
  data: unknown,
  options: NotificationNavigationOptions = {},
): string | null {
  if (!data || typeof data !== 'object') return null;

  const record = data as Record<string, unknown>;
  const hostId = readNonEmptyString(record.hostId);
  if (!hostId) return null;
  if (options.knownHostIds && !options.knownHostIds.has(hostId)) return null;

  const base = `/terminal/${encodeURIComponent(hostId)}`;
  const worktreePath = readNonEmptyString(record.worktreePath);
  if (!worktreePath) return base;

  const query: string[] = [`worktreePath=${encodeURIComponent(worktreePath)}`];
  const worktreeName = readNonEmptyString(record.worktreeName);
  if (worktreeName) query.push(`worktreeName=${encodeURIComponent(worktreeName)}`);
  const terminalId = readNonEmptyString(record.terminalId);
  if (terminalId) query.push(`terminalId=${encodeURIComponent(terminalId)}`);

  return `${base}?${query.join('&')}`;
}
