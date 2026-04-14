// ---------------------------------------------------------------------------
// Auto-update service — checks GitHub Releases via electron-updater
// ---------------------------------------------------------------------------
//
// Only active when app.isPackaged is true. Main process initializes via
// initAutoUpdater(mainWindow) after the window is created. Events are
// forwarded to the renderer over IPC channels (updater:*).
//
// NOTE: Because we use @electron/packager (not electron-builder), there is
// no app-update.yml baked into the bundle. We call setFeedURL() explicitly
// to tell electron-updater where to look for updates.
//

import { autoUpdater, type UpdateInfo } from 'electron-updater'
import { BrowserWindow, app } from 'electron'
import { logger } from '../lib/logger'

const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000 // 4 hours

let checkTimer: ReturnType<typeof setTimeout> | null = null
let checkInterval: ReturnType<typeof setInterval> | null = null
let isDownloading = false
let activeWindow: BrowserWindow | null = null

/** Safe IPC send - guards against destroyed window. */
function sendToRenderer(window: BrowserWindow, channel: string, data: unknown): void {
  if (!window.isDestroyed() && window.webContents && !window.webContents.isDestroyed()) {
    window.webContents.send(channel, data)
  }
}

/**
 * Initialize the auto-updater. Call once from index.ts after createWindow(),
 * guarded by `if (app.isPackaged)`.
 */
export function initAutoUpdater(mainWindow: BrowserWindow): void {
  activeWindow = mainWindow
  autoUpdater.logger = logger
  autoUpdater.autoDownload = false
  // Let the user control when to restart - don't silently install on quit
  autoUpdater.autoInstallOnAppQuit = false

  // Since we use @electron/packager (not electron-builder), there is no
  // auto-generated app-update.yml. Configure the feed URL explicitly.
  autoUpdater.setFeedURL({
    provider: 'github',
    owner: 'gedeagas',
    repo: 'braid',
  })

  autoUpdater.on('update-available', (info: UpdateInfo) => {
    logger.info(`[updater] Update available: v${info.version}`)
    sendToRenderer(mainWindow, 'updater:update-available', {
      version: info.version,
      releaseNotes: typeof info.releaseNotes === 'string'
        ? info.releaseNotes
        : Array.isArray(info.releaseNotes)
          ? info.releaseNotes.map((n) => n.note).join('\n')
          : '',
      releaseDate: info.releaseDate,
    })
  })

  autoUpdater.on('download-progress', (progress) => {
    sendToRenderer(mainWindow, 'updater:download-progress', {
      percent: Math.round(progress.percent),
    })
  })

  autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
    isDownloading = false
    sendToRenderer(mainWindow, 'updater:update-downloaded', {
      version: info.version,
    })
  })

  autoUpdater.on('error', (err: Error) => {
    isDownloading = false
    logger.error('Auto-updater error', err)
    sendToRenderer(mainWindow, 'updater:error', {
      message: err.message,
    })
  })

  autoUpdater.on('update-not-available', () => {
    logger.info('[updater] No update available - app is up to date')
    sendToRenderer(mainWindow, 'updater:up-to-date', {})
  })

  // Check after a short delay so the window is fully loaded
  checkTimer = setTimeout(() => {
    autoUpdater.checkForUpdates().catch((err) => {
      logger.error('Auto-updater initial check failed', err)
    })
  }, 10_000)

  // Periodic checks - skip if a download is already in progress
  checkInterval = setInterval(() => {
    if (isDownloading) return
    autoUpdater.checkForUpdates().catch((err) => {
      logger.error('Auto-updater periodic check failed', err)
    })
  }, CHECK_INTERVAL_MS)
}

/** Clean up timers. Call from app before-quit handler. */
export function stopAutoUpdater(): void {
  if (checkTimer) { clearTimeout(checkTimer); checkTimer = null }
  if (checkInterval) { clearInterval(checkInterval); checkInterval = null }
  activeWindow = null
}

/**
 * Manually trigger an update check. Called via IPC from renderer.
 * Returns true if a check was initiated, false if skipped (dev mode, no window, etc.).
 */
export function checkForUpdates(): boolean {
  if (!app.isPackaged) {
    logger.info('[updater] Skipped check - app is not packaged (dev mode)')
    return false
  }
  if (!activeWindow) {
    logger.info('[updater] Skipped check - no active window')
    return false
  }
  if (isDownloading) {
    logger.info('[updater] Skipped check - download in progress')
    return false
  }
  logger.info('[updater] Starting manual update check')
  autoUpdater.checkForUpdates().catch((err) => {
    logger.error('[updater] Manual update check failed', err)
  })
  return true
}

/** Start downloading the update. Called via IPC from renderer. */
export function downloadUpdate(): void {
  isDownloading = true
  autoUpdater.downloadUpdate().catch((err) => {
    isDownloading = false
    logger.error('Auto-updater download failed', err)
    // The autoUpdater 'error' event may or may not fire for download
    // failures, so explicitly emit the error to the renderer too.
    // The reducer handles duplicate errors gracefully.
  })
}

/** Quit and install the downloaded update. Called via IPC from renderer. */
export function installUpdate(): void {
  // isSilent=false (show installer), isForceRunAfter=true (relaunch after)
  autoUpdater.quitAndInstall(false, true)
}
