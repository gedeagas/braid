// ── Mobile push notification bridge (Expo) ───────────────────────────────────
//
// Delivers agent alerts (done / needs-input / error) to paired devices that are
// NOT currently connected - i.e. the app is backgrounded or killed, so the live
// E2EE WebSocket is closed and the in-app `notifications.subscribe` path can't
// reach them. Connected devices still get their alert over the socket (handled
// in rpc.ts), and this notifier explicitly skips them, so a device never gets
// both a WS notification and a push for the same event.
//
// PRIVACY: unlike the WS channel, this is NOT end-to-end encrypted. The title /
// body ride Expo's push service and then APNs / FCM, so the notification content
// (project, branch, agent) is visible to those third parties. This is a
// deliberate v1 trade-off for background delivery. A future revision can ship an
// encrypted payload + on-device Notification Service Extension to close that gap.
//
// EXTERNAL SERVICE: this posts to https://exp.host (Expo). That is a third-party
// dependency the desktop did not previously call; enabling it in a shipping
// build is subject to the internal External Service Review.

import { agentService, type MobileNotification } from '../agent'
import { deviceStore } from './deviceStore'
import { mobileServer } from './mobileServer'
import { logger } from '../../lib/logger'

const EXPO_PUSH_ENDPOINT = 'https://exp.host/--/api/v2/push/send'

// NOT a token expiry: Expo push tokens don't expire on a timer (they're stable
// per app install, only rotating on reinstall/restore). This is OUR staleness
// policy on the registration record: the device re-registers on every connect (a
// heartbeat that refreshes `pushTokenUpdatedAt`), so a registration we haven't
// seen refreshed within this window means the device hasn't checked in for a
// long time - removed while offline, uninstalled, or lost. We stop pushing to it
// so a desktop can't keep notifying a phone that walked away without an explicit
// unregister ever reaching us. Generous, since someone relying on background push
// may open the app only occasionally; each open (foreground -> reconnect)
// refreshes the heartbeat.
const MAX_PUSH_REGISTRATION_AGE_MS = 30 * 24 * 60 * 60 * 1000 // 30 days

interface ExpoPushMessage {
  to: string
  title: string
  body: string
  data: Record<string, unknown>
  sound: 'default'
  priority: 'high'
  channelId?: string
}

/** Map an internal notification to the Expo push message for one device token.
 *  `data` carries the desktop instance id (so a tapped push resolves back to the
 *  right paired host) plus the existing deep-link hints. */
function buildMessage(token: string, platform: 'ios' | 'android' | undefined, n: MobileNotification): ExpoPushMessage {
  return {
    to: token,
    title: n.title || 'Braid',
    body: n.body || '',
    data: {
      desktopId: mobileServer.getInstanceId(),
      type: n.type,
      worktreePath: n.worktreePath,
      terminalId: n.terminalId,
      worktreeName: n.branch,
    },
    sound: 'default',
    priority: 'high',
    // The mobile app pre-creates this Android channel; iOS ignores it.
    ...(platform === 'android' ? { channelId: 'braid-desktop' } : {}),
  }
}

/** POST a batch to Expo and reap dead tokens. Expo returns a `data` array of
 *  tickets aligned to the input order; a `DeviceNotRegistered` error means the
 *  token is permanently invalid (app uninstalled / push disabled), so we clear
 *  it to stop sending into the void. Best-effort: any transport error is logged
 *  and dropped, never thrown into the notify path. */
async function send(messages: ExpoPushMessage[], deviceIds: string[]): Promise<void> {
  try {
    const res = await fetch(EXPO_PUSH_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(messages),
    })
    if (!res.ok) {
      logger.warn(`[MobilePush] Expo push failed: HTTP ${res.status}`)
      return
    }
    const json = (await res.json()) as { data?: Array<{ status?: string; details?: { error?: string } }> }
    const tickets = json.data ?? []
    tickets.forEach((ticket, i) => {
      if (ticket?.status === 'error' && ticket.details?.error === 'DeviceNotRegistered') {
        deviceStore.clearPushToken(deviceIds[i])
        logger.info(`[MobilePush] Cleared stale push token for device ${deviceIds[i]}`)
      }
    })
  } catch (err) {
    logger.warn('[MobilePush] Expo push request error:', err)
  }
}

async function handleNotification(n: MobileNotification): Promise<void> {
  // Only devices with a recently-refreshed registration AND not currently
  // connected. A connected device is served by the WS path; pushing to it too
  // would double-notify. A registration we haven't seen refreshed within the max
  // age means the device hasn't checked in for a long time - removed while
  // offline, uninstalled, or lost - so we stop pushing to it.
  const now = Date.now()
  const targets = deviceStore
    .load()
    .filter(
      (d) =>
        d.pushToken &&
        now - (d.pushTokenUpdatedAt ?? 0) < MAX_PUSH_REGISTRATION_AGE_MS &&
        !mobileServer.isDeviceConnected(d.id),
    )
  if (targets.length === 0) return
  const messages = targets.map((d) => buildMessage(d.pushToken!, d.pushPlatform, n))
  await send(messages, targets.map((d) => d.id))
}

/** Subscribe agent notifications to the Expo push bridge. Returns an unsubscribe
 *  fn. Mirrors startMobileTerminalNotifier - both ride the same onNotify stream,
 *  so push content matches the WS notifications exactly.
 *
 *  KILL SWITCH: outbound push to exp.host is a third-party dependency pending
 *  the internal External Service Review, so it stays OFF unless explicitly
 *  enabled via BRAID_ENABLE_MOBILE_PUSH=1. When off we never subscribe, so the
 *  desktop never POSTs to Expo (it still accepts token registrations harmlessly;
 *  they just go unused). Flip the env var once the review clears. */
export function startMobilePushNotifier(): () => void {
  const enabled = process.env.BRAID_ENABLE_MOBILE_PUSH === '1' || process.env.BRAID_ENABLE_MOBILE_PUSH === 'true'
  if (!enabled) {
    logger.info('[MobilePush] disabled (set BRAID_ENABLE_MOBILE_PUSH=1 to enable; pending External Service Review)')
    return () => {}
  }
  return agentService.onNotify((n) => { void handleNotification(n) })
}
