// ---------------------------------------------------------------------------
// Auto-update service - discovers releases through update.electronjs.org and
// delegates download/install to Electron's built-in Squirrel.Mac updater.
// ---------------------------------------------------------------------------

import { app, autoUpdater, BrowserWindow, net } from 'electron'
import { logger } from '../lib/logger'
import {
  buildUpdateFeedUrl,
  parseUpdateFeedRelease,
  type UpdateFeedRelease,
} from './autoUpdateFeed'

const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000
const CHECK_TIMEOUT_MS = 20_000
const INITIAL_CHECK_DELAY_MS = 10_000
const REPOSITORY_OWNER = 'gedeagas'
const REPOSITORY_NAME = 'braid'

let checkTimer: ReturnType<typeof setTimeout> | null = null
let checkInterval: ReturnType<typeof setInterval> | null = null
let checkAbortController: AbortController | null = null
let isChecking = false
let isDownloading = false
let isInstallingUpdate = false
let availableUpdate: UpdateFeedRelease | null = null
let downloadingVersion: string | null = null
let activeWindow: BrowserWindow | null = null

function getFeedUrl(): string {
  return buildUpdateFeedUrl(
    REPOSITORY_OWNER,
    REPOSITORY_NAME,
    process.platform,
    process.arch,
    app.getVersion()
  )
}

function getActiveWindow(): BrowserWindow | null {
  if (activeWindow && !activeWindow.isDestroyed()) return activeWindow
  return BrowserWindow.getAllWindows().find((window) => !window.isDestroyed()) ?? null
}

function sendToRenderer(channel: string, data: unknown): void {
  const window = getActiveWindow()
  if (window?.webContents && !window.webContents.isDestroyed()) {
    window.webContents.send(channel, data)
  }
}

async function fetchAvailableUpdate(): Promise<UpdateFeedRelease | null> {
  checkAbortController?.abort()
  const controller = new AbortController()
  checkAbortController = controller
  const timeout = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS)

  try {
    const response = await net.fetch(getFeedUrl(), {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    })

    if (response.status === 204) return null
    if (!response.ok) {
      throw new Error(`Update service returned HTTP ${response.status}`)
    }

    return parseUpdateFeedRelease(await response.json())
  } finally {
    clearTimeout(timeout)
    if (checkAbortController === controller) checkAbortController = null
  }
}

async function discoverUpdate(): Promise<void> {
  if (isChecking || isDownloading) return
  isChecking = true

  try {
    const release = await fetchAvailableUpdate()
    availableUpdate = release

    if (release) {
      logger.info(`[updater] Update available: v${release.version}`)
      sendToRenderer('updater:update-available', release)
    } else {
      logger.info('[updater] No update available - app is up to date')
      sendToRenderer('updater:up-to-date', {})
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.error('[updater] Update check failed', error)
    sendToRenderer('updater:error', { message })
  } finally {
    isChecking = false
  }
}

/** Initialize update discovery and Squirrel.Mac event handling. */
export function initAutoUpdater(mainWindow: BrowserWindow): void {
  if (!app.isPackaged) {
    logger.info('[updater] Skipping auto-updater setup in dev mode')
    return
  }

  activeWindow = mainWindow
  autoUpdater.setFeedURL({ url: getFeedUrl(), serverType: 'json' })

  autoUpdater.on('update-available', () => {
    logger.info(`[updater] Downloading update v${downloadingVersion ?? 'unknown'}`)
  })

  autoUpdater.on('update-downloaded', (_event, _releaseNotes, releaseName) => {
    const version = releaseName.replace(/^v/, '') || downloadingVersion || app.getVersion()
    isDownloading = false
    downloadingVersion = null
    availableUpdate = null
    logger.info(`[updater] Update downloaded: v${version}`)
    sendToRenderer('updater:update-downloaded', { version })
  })

  autoUpdater.on('update-not-available', () => {
    if (isDownloading) {
      isDownloading = false
      downloadingVersion = null
      sendToRenderer('updater:error', {
        message: 'The selected update is no longer available. Please check again.',
      })
    }
  })

  autoUpdater.on('error', (error: Error) => {
    isDownloading = false
    downloadingVersion = null
    if (isInstallingUpdate) return

    logger.error('[updater] Auto-updater error', error)
    sendToRenderer('updater:error', { message: error.message })
  })

  checkTimer = setTimeout(() => void discoverUpdate(), INITIAL_CHECK_DELAY_MS)
  checkInterval = setInterval(() => void discoverUpdate(), CHECK_INTERVAL_MS)
}

/** Clean up timers and an in-flight discovery request before quitting. */
export function stopAutoUpdater(): void {
  if (checkTimer) clearTimeout(checkTimer)
  if (checkInterval) clearInterval(checkInterval)
  checkTimer = null
  checkInterval = null
  checkAbortController?.abort()
  checkAbortController = null
  activeWindow = null
}

/** Manually trigger update discovery from the renderer. */
export function checkForUpdates(): boolean {
  if (!app.isPackaged) {
    logger.info('[updater] Skipped check - app is not packaged')
    return false
  }
  if (!getActiveWindow()) {
    logger.info('[updater] Skipped check - no active window')
    return false
  }
  if (isDownloading) {
    logger.info('[updater] Skipped check - download in progress')
    return false
  }

  void discoverUpdate()
  return true
}

/** Ask Squirrel.Mac to download the release selected during discovery. */
export function downloadUpdate(): void {
  if (isDownloading) return
  if (!availableUpdate) {
    sendToRenderer('updater:error', {
      message: 'No update is available to download. Please check again.',
    })
    return
  }

  isDownloading = true
  downloadingVersion = availableUpdate.version
  try {
    autoUpdater.checkForUpdates()
  } catch (error) {
    isDownloading = false
    downloadingVersion = null
    const message = error instanceof Error ? error.message : String(error)
    logger.error('[updater] Failed to start update download', error)
    sendToRenderer('updater:error', { message })
  }
}

/** Restart Braid and let Squirrel.Mac swap in the downloaded application. */
export function installUpdate(): void {
  isInstallingUpdate = true
  try {
    autoUpdater.quitAndInstall()
  } catch (error) {
    isInstallingUpdate = false
    const message = error instanceof Error ? error.message : String(error)
    logger.error('[updater] Failed to install update', error)
    sendToRenderer('updater:error', { message })
    return
  }

  setTimeout(() => { isInstallingUpdate = false }, 5_000)
}
