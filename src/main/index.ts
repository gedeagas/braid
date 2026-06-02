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
import { registerIpcHandlers, rateLimitService, mainSettings } from './ipc'
import { createAppMenu } from './menu'
import { windowCaptureService } from './services/windowCapture'
import { lspService } from './services/lsp'
import { initAutoUpdater, stopAutoUpdater } from './services/autoUpdate'
import { waitForEnrichedEnv } from './lib/enrichedEnv'
import { ensureAllAgentHooks } from './services/agentHooks'
import { startAgentHookServer, stopAgentHookServer } from './services/agentHookServer'
import { startAgentAwakeService, stopAgentAwakeService } from './services/agentAwake'
import { startMobileTerminalNotifier } from './services/mobileServer/terminalNotifier'
import { startTerminalActivityTracking } from './services/mobileServer/terminalActivity'
import { startTerminalRunTimer } from './services/terminalRunTimer'
import { ptyService } from './services/pty'
import { mobileServer } from './services/mobileServer'
import { mobileNgrokTunnel } from './services/mobileServer/ngrokTunnel'
import { HTML_PREVIEW_PARTITION } from '../shared/html-preview'

// Prevent EPIPE errors from crashing the process when stdout/stderr pipes break
// (common in Electron when the renderer detaches or during hot-reload).
process.stdout?.on?.('error', () => {})
process.stderr?.on?.('error', () => {})

let mainWindow: BrowserWindow | null = null
const htmlPreviewSessions = new WeakSet<import('electron').Session>()
let htmlPreviewSession: import('electron').Session | null = null

function isHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

function isFileUrl(url: string): boolean {
  try {
    return new URL(url).protocol === 'file:'
  } catch {
    return false
  }
}

function isWebAppPartition(partition: string): boolean {
  return /^persist:webapp-[A-Za-z0-9._-]+$/.test(partition)
}

function configureHtmlPreviewSession(sess: import('electron').Session): void {
  if (htmlPreviewSessions.has(sess)) return
  htmlPreviewSessions.add(sess)
  sess.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
  sess.setPermissionCheckHandler(() => false)
  sess.setDisplayMediaRequestHandler((_request, callback) => {
    callback({ video: undefined, audio: undefined })
  })
}

function getHtmlPreviewSession(): import('electron').Session {
  if (!htmlPreviewSession) {
    htmlPreviewSession = session.fromPartition(HTML_PREVIEW_PARTITION)
    configureHtmlPreviewSession(htmlPreviewSession)
  }
  return htmlPreviewSession
}

function createWindow(): void {
  const iconPath = join(__dirname, '../../build/icon.png')

  const windowOptions: Electron.BrowserWindowConstructorOptions = {
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 600,
    show: false,
    icon: iconPath,
    ...(process.platform === 'darwin'
      ? {
          titleBarStyle: 'hiddenInset' as const,
          trafficLightPosition: { x: 16, y: 16 },
        }
      : {}),
    backgroundColor: '#0d1117',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      webviewTag: true,
      contextIsolation: true,
      nodeIntegration: false,
      plugins: true
    }
  }

  mainWindow = new BrowserWindow(windowOptions)

  mainWindow.on('ready-to-show', () => {
    mainWindow!.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  mainWindow.webContents.on('will-attach-webview', (event, webPreferences, params) => {
    const src = typeof params.src === 'string' ? params.src : ''
    const partition =
      typeof params.partition === 'string'
        ? params.partition
        : typeof webPreferences.partition === 'string'
          ? webPreferences.partition
          : ''
    const isHtmlPreview =
      partition === HTML_PREVIEW_PARTITION && isFileUrl(src)
    const isEmbeddedWebApp =
      isWebAppPartition(partition) && isHttpUrl(src)

    if (!isHtmlPreview && !isEmbeddedWebApp) {
      event.preventDefault()
      return
    }

    delete webPreferences.preload
    delete (webPreferences as Record<string, unknown>).preloadURL
    webPreferences.nodeIntegration = false
    webPreferences.nodeIntegrationInSubFrames = false
    webPreferences.contextIsolation = true
    webPreferences.sandbox = true
    webPreferences.webSecurity = true
    webPreferences.allowRunningInsecureContent = false
    webPreferences.partition = partition

    if (isHtmlPreview) {
      webPreferences.plugins = false
      configureHtmlPreviewSession(getHtmlPreviewSession())
    }
  })

  // When a <webview> tries to open a new window (e.g. Slack auth, links),
  // navigate the webview in-place instead of spawning a popup.
  // Also enable native right-click context menu (copy, paste, etc.).
  mainWindow.webContents.on('did-attach-webview', (_event, webviewContents) => {
    const isHtmlPreview = htmlPreviewSessions.has(webviewContents.session)
    // Belt-and-suspenders: also configure the webview's session here in case
    // session-created fires too late for some Electron/ASAR edge case.
    if (isHtmlPreview) {
      configureHtmlPreviewSession(webviewContents.session)
    } else {
      configureWebAppSession(webviewContents.session)
    }

    // Auth flows (OAuth popups, SSO) should open in the system browser where
    // the user's session cookies already exist. Regular same-origin navigations
    // are handled in-place by the webview itself.
    webviewContents.setWindowOpenHandler(({ url }) => {
      if (!isHtmlPreview || isHttpUrl(url)) shell.openExternal(url)
      return { action: 'deny' }
    })

    if (isHtmlPreview) {
      webviewContents.on('will-navigate', (event, url) => {
        if (url === 'about:blank') return
        event.preventDefault()
        if (isHttpUrl(url)) {
          shell.openExternal(url)
        }
      })
    }

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

// Allow embedded web apps to autoplay audio/video without a gesture.
// Must be set before app.whenReady() to take effect.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')

// Spoof Chrome UA only for webapp partition sessions so embedded apps serve
// their standard Chrome-compatible bundles.
function getChromeUserAgent(): string {
  const chromeSuffix = 'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36'
  if (process.platform === 'darwin') {
    return `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ${chromeSuffix}`
  }
  if (process.platform === 'linux') {
    const linuxArch = process.arch === 'arm64' ? 'aarch64' : 'x86_64'
    return `Mozilla/5.0 (X11; Linux ${linuxArch}) ${chromeSuffix}`
  }
  if (process.platform === 'win32') {
    return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) ${chromeSuffix}`
  }
  return `Mozilla/5.0 ${chromeSuffix}`
}

const CHROME_UA = getChromeUserAgent()

function configureWebAppSession(sess: import('electron').Session): void {
  sess.setUserAgent(CHROME_UA)

  // Web app sessions are user-initiated - grant all permissions so playback,
  // DRM, clipboard, and other features work without prompts.
  sess.setPermissionRequestHandler((_wc, _permission, callback) => {
    callback(true)
  })

  sess.setPermissionCheckHandler(() => {
    return true
  })
}

app.whenReady().then(async () => {
  getHtmlPreviewSession()
  app.on('session-created', (sess) => {
    if (sess === session.defaultSession) return
    if (sess === getHtmlPreviewSession()) {
      configureHtmlPreviewSession(sess)
      return
    }
    configureWebAppSession(sess)
  })

  // Resolve login-shell PATH early so all CLI lookups see the user's full PATH.
  await waitForEnrichedEnv()

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

  // Ensure the PTY daemon is running (non-blocking)
  if ('ensureDaemon' in ptyService && typeof ptyService.ensureDaemon === 'function') {
    ptyService.ensureDaemon().catch((err: unknown) =>
      console.warn('[pty-daemon] Failed to start daemon:', err)
    )
  }

  // Start the agent hook HTTP server, then install hooks for all supported agents.
  // The server must be running before hooks are installed so the port is known.
  startAgentHookServer()
    .then(() => ensureAllAgentHooks())
    .catch((err) => console.warn('[agentHookServer] Failed to start:', err))

  // Bridge big-terminal agent status to paired mobile devices (main-process,
  // independent of the renderer observing the terminal).
  startMobileTerminalNotifier()

  // Track each big terminal's current agent state so terminal.list can report
  // which agents need attention on the mobile homepage.
  startTerminalActivityTracking()

  // Accumulate per-terminal agent "working" time into terminal metadata so the
  // mobile homepage can report real agent time for terminal-driven sessions.
  startTerminalRunTimer()

  // Keep the computer awake while agents are actively working (opt-in). The
  // initial enabled flag is the persisted setting; the renderer re-syncs the
  // real value shortly after launch via settings:sync.
  startAgentAwakeService(mainSettings.keepAwakeWhileAgentsRun)

  // Mobile companion server starts on demand via the mobile:start IPC handler
  // when the user enables it in Settings > Mobile Companion.

  createWindow()
  createAppMenu(mainWindow!)

  // Rate limit polling service
  rateLimitService.attach(mainWindow!)
  rateLimitService.start()

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
  stopAgentHookServer()
  stopAgentAwakeService()
  mobileNgrokTunnel.stop()
  mobileServer.stop()
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
