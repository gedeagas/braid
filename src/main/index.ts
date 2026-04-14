// ─── electron-log must be initialized before any other imports ────────────────
// This registers IPC channels so renderer/utility-process log calls are captured.
import log from 'electron-log/main'
import { setErrorReporter, logger } from './lib/logger'

log.initialize()
// Writes warn/error to ~/Library/Logs/Braid/main.log (macOS) — silent in dev console.
log.transports.file.level = 'warn'
log.transports.file.maxSize = 10 * 1024 * 1024   // 10 MB — rolls over automatically
log.transports.console.level = false              // suppress electron-log's own console output (we use our logger directly)

// Wire logger.error() → electron-log file transport.
// To add Sentry: replace this reporter with Sentry.captureException() + log.error().
setErrorReporter((msg, err) => log.error(msg, err ?? ''))

// ─── Global unhandled error catchers ─────────────────────────────────────────
// Ensures crashes in main-process async code reach the log file.
process.on('uncaughtException', (err) => logger.error('Uncaught exception', err))
process.on('unhandledRejection', (reason) => logger.error('Unhandled rejection', reason))

import { app, BrowserWindow, clipboard, components, desktopCapturer, Menu, session, shell, nativeImage } from 'electron'
import { join } from 'path'
import { APP_DISPLAY_NAME } from './appBrand'
import { registerIpcHandlers } from './ipc'
import { createAppMenu } from './menu'
import { windowCaptureService } from './services/windowCapture'
import { lspService } from './services/lsp'
import { initAutoUpdater, stopAutoUpdater } from './services/autoUpdate'

// Prevent EPIPE errors from crashing the process when stdout/stderr pipes break
// (common in Electron when the renderer detaches or during hot-reload).
process.stdout?.on?.('error', () => {})
process.stderr?.on?.('error', () => {})

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  const iconPath = join(__dirname, '../../build/icon.png')

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 600,
    show: false,
    icon: iconPath,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    backgroundColor: '#0d1117',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      webviewTag: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow!.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // When a <webview> tries to open a new window (e.g. Slack auth, links),
  // navigate the webview in-place instead of spawning a popup.
  // Also enable native right-click context menu (copy, paste, etc.).
  mainWindow.webContents.on('did-attach-webview', (_event, webviewContents) => {
    // Auth flows (OAuth popups, SSO) should open in the system browser where
    // the user's session cookies already exist. Regular same-origin navigations
    // are handled in-place by the webview itself.
    webviewContents.setWindowOpenHandler(({ url }) => {
      shell.openExternal(url)
      return { action: 'deny' }
    })

    // Suppress ERR_ABORTED (-3) from auth redirect chains — these are expected
    // when sites redirect through SSO (e.g. Notion → Google SSO → back).
    webviewContents.on('did-fail-load', (_e, errorCode, _errorDesc, _validatedURL, isMainFrame) => {
      if (isMainFrame && errorCode === -3) return // ERR_ABORTED — benign redirect
    })

    webviewContents.on('context-menu', (_e, params) => {
      const items: Electron.MenuItemConstructorOptions[] = []
      if (params.selectionText) {
        items.push({ label: 'Copy', role: 'copy' })
      }
      if (params.isEditable) {
        items.push({ label: 'Paste', role: 'paste' })
        items.push({ label: 'Cut', role: 'cut' })
        items.push({ label: 'Select All', role: 'selectAll' })
      }
      if (params.linkURL) {
        items.push({ label: 'Copy Link', click: () => { clipboard.writeText(params.linkURL) } })
      }
      if (items.length > 0) {
        Menu.buildFromTemplate(items).popup()
      }
    })
  })

  // Dev server or production file
  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// Allow Spotify and other web apps to autoplay audio/video without a gesture.
// Must be set before app.whenReady() to take effect.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')

const ALLOWED_PERMISSIONS = new Set([
  'media', 'notifications', 'clipboard-read',
  'camera', 'microphone',
])

// Spoof Chrome UA only for webapp partition sessions so sites like Spotify
// serve their standard Chrome-compatible player bundles.
const CHROME_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ' +
  'AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/147.0.0.0 Safari/537.36'

function configureWebAppSession(sess: import('electron').Session): void {
  sess.setUserAgent(CHROME_UA)

  // Allow audio/video playback and notifications
  sess.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(ALLOWED_PERMISSIONS.has(permission))
  })

  // Allow EME (Widevine) key system checks — required for Spotify, etc.
  sess.setPermissionCheckHandler((_wc, permission) => {
    if (permission === 'mediaKeySystem') return true
    return true // allow everything else for embedded web apps
  })
}

app.on('session-created', (sess) => {
  if (sess === session.defaultSession) return
  configureWebAppSession(sess)
})

app.whenReady().then(async () => {
  // Wait for Widevine CDM to be ready before opening windows.
  await components.whenReady()
  console.log('[ECS] Widevine status:', JSON.stringify(components.status()))

  app.name = APP_DISPLAY_NAME

  // Set Dock icon in dev mode (macOS)
  if (process.platform === 'darwin') {
    const dockIcon = nativeImage.createFromPath(join(__dirname, '../../build/icon.png'))
    if (!dockIcon.isEmpty()) {
      app.dock?.setIcon(dockIcon)
    }
  }

  // Register display media handler so renderer can use getDisplayMedia()
  // for window capture. The renderer sets pendingSourceId via IPC before
  // calling getDisplayMedia(); the handler finds that source and grants it.
  session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
    const targetId = windowCaptureService.pendingSourceId
    console.log('[DisplayMedia] Handler fired, pendingSourceId:', targetId)
    const sources = await desktopCapturer.getSources({ types: ['window'] })
    console.log('[DisplayMedia] Available sources:', sources.map((s) => `${s.id} "${s.name}"`))
    const match = targetId ? sources.find((s) => s.id === targetId) : null
    console.log('[DisplayMedia] Matched source:', match ? `${match.id} "${match.name}"` : 'NONE — falling back to first')
    const granted = match ?? sources[0] ?? null
    console.log('[DisplayMedia] Granting:', granted ? `${granted.id} "${granted.name}"` : 'NULL')
    callback({ video: granted })
    windowCaptureService.pendingSourceId = null
  })

  registerIpcHandlers()
  createWindow()
  createAppMenu(mainWindow!)

  // Auto-updater (only in packaged builds)
  if (app.isPackaged) {
    initAutoUpdater(mainWindow!)
  }

  // Forward LSP events to renderer
  lspService.on('status', (update) => {
    mainWindow?.webContents.send('lsp:statusUpdate', update)
  })
  lspService.on('diagnostics', (update) => {
    mainWindow?.webContents.send('lsp:diagnosticsUpdate', update)
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
      createAppMenu(mainWindow!)
    }
  })
})

app.on('before-quit', () => {
  if (process.platform === 'darwin' && app.dock) {
    app.dock.setBadge('')
  }
  stopAutoUpdater()
  lspService.shutdownAll()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}
