// Browser profile sessions: one persistent partition per profile, hardened
// independently from the embedded web-app sessions (which grant everything).
import { app, session, type Session } from 'electron'
import { getBrowserSettings } from './settings'
import { handlePermissionCheck, handlePermissionRequest } from './permissions'
import { attachDownloadTracking } from './downloads'

const browserSessions = new WeakSet<Session>()
let creating = 0

// Hosts that reject a browser claiming to be Chrome inside Electron: they get
// Electron's native identity even when the cleaned identity is selected.
const NATIVE_IDENTITY_HOSTS = ['*://accounts.google.com/*', '*://accounts.youtube.com/*']

/** Electron's UA without the app/Electron tokens, so sites see a Chrome-shaped identity. */
export function cleanedUserAgent(native: string): string {
  return native
    .replace(/\s+Electron\/\S+/g, '')
    .replace(/\s+[A-Za-z][\w-]*\/\d+\.\d+\.\d+(?:-[\w.]+)?(?=\s+Chrome\/)/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

function configure(sess: Session): void {
  if (browserSessions.has(sess)) return
  browserSessions.add(sess)
  const native = app.userAgentFallback
  const identity = getBrowserSettings().identity
  sess.setUserAgent(identity === 'native' ? native : cleanedUserAgent(native))
  if (identity === 'cleaned') {
    sess.webRequest.onBeforeSendHeaders({ urls: NATIVE_IDENTITY_HOSTS }, (details, callback) => {
      callback({ requestHeaders: { ...details.requestHeaders, 'User-Agent': native } })
    })
  }
  sess.setPermissionRequestHandler((wc, permission, callback, details) =>
    handlePermissionRequest(sess, wc, permission, details.requestingUrl ?? wc.getURL(), callback))
  sess.setPermissionCheckHandler((_wc, permission, requestingOrigin) =>
    handlePermissionCheck(sess, permission, requestingOrigin))
  sess.setDisplayMediaRequestHandler((_request, callback) => callback({ video: undefined, audio: undefined }))
  attachDownloadTracking(sess)
}

/** Get (and configure on first use) the session backing a browser partition. */
export function getBrowserSession(partition: string): Session {
  creating++
  try {
    const sess = session.fromPartition(partition)
    configure(sess)
    return sess
  } finally {
    creating--
  }
}

/**
 * True for browser sessions, including one being created right now - the app's
 * `session-created` hook runs inside `session.fromPartition` and must not apply
 * the embedded web-app configuration to it.
 */
export function isBrowserSession(sess: Session): boolean {
  return creating > 0 || browserSessions.has(sess)
}
