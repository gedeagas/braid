import { logger } from './lib/logger'
import { ipcMain, dialog, shell, app, clipboard, BrowserWindow } from 'electron'
import { writeFile } from 'fs/promises'
import { randomUUID } from 'crypto'
import { execFile } from 'child_process'
import { join } from 'path'
import { storageService } from './services/storage'
import { agentService } from './services/agent'
import { ptyService } from './services/pty'
import { registerPtyIpcHandlers } from './ptyIpc'
import { registerGitIpc } from './ipcHandlers/git'
import { registerGithubIpc } from './ipcHandlers/github'
import { registerAppsIpc } from './ipcHandlers/apps'
import { registerClaudeConfigIpc } from './ipcHandlers/claudeConfig'
import { registerMobileIpc } from './ipcHandlers/mobile'
import { registerUsageIpc } from './ipcHandlers/usage'
import { sessionStorageService, PersistedSession } from './services/sessionStorage'
import { filesService } from './services/files'
import { searchService } from './services/search'
import { simulatorService } from './services/simulator'
import { serveSimService } from './services/serveSim'
import { detectScripts } from './services/scriptDetector'
import { templatesService } from './services/templates'
import type { TemplateKind, CreateTemplateArgs } from '../shared/templates'
import type { SearchFileResult, SearchMatch, SearchOptions } from '../shared/search'
import { windowCaptureService } from './services/windowCapture'
import { notesService } from './services/notes'
import { registerBrowserIpc } from './services/browser'
import { setAgentAwakeEnabled } from './services/agentAwake'
import type { MobileNgrokRegion } from './services/mobileServer/types'
import { lspService, LspServerConfig } from './services/lsp'
import { resolveCliPath } from './services/claudePath'
import { enrichedEnv } from './lib/enrichedEnv'
import { toolInstaller } from './services/toolInstaller'
import { downloadUpdate, installUpdate, checkForUpdates } from './services/autoUpdate'
import { rateLimitService } from './services/rateLimits/service'
import { DEFAULT_TERMINAL_SCROLLBACK_LINES, clampTerminalScrollbackLines, getTerminalScrollbackBufferMaxLength } from '../shared/terminal'

export { rateLimitService }

function defaultUserShell(): string {
  return process.platform === 'darwin' ? '/bin/zsh' : '/bin/sh'
}

function shellArgs(shellPath: string, cmd: string): string[] {
  const shellName = shellPath.split('/').pop() ?? ''
  if (shellName === 'sh' || shellName === 'dash') return ['-c', cmd]
  return ['-lic', cmd]
}

// In-process settings cache — renderer pushes values here so main-process
// services (agent.ts, pty.ts) can read them synchronously.
export const mainSettings = {
  apiKey: null as string | null,
  terminalShell: '',
  terminalScrollback: DEFAULT_TERMINAL_SCROLLBACK_LINES,
  worktreeStoragePath: '',
  systemPromptSuffix: '',
  claudeCodeExecutablePath: '',
  notifyOnDone: true,
  notifyOnError: true,
  notifyOnWaitingInput: true,
  notificationSound: true,
  /** When true, all non-denied tools run without a confirmation prompt. */
  bypassPermissions: true,
  /** When true, the mobile companion WebSocket server is running. */
  mobileServerEnabled: false,
  /** ngrok edge region used for remote mobile pairing. */
  mobileNgrokRegion: 'auto' as MobileNgrokRegion,
  /** When true, prevent the computer from sleeping while an agent is working. */
  keepAwakeWhileAgentsRun: false,
}

export function registerIpcHandlers(): void {
  // Browser tabs (registry, settings, downloads, permissions, design mode, cookies)
  registerBrowserIpc()

  // Storage
  ipcMain.handle('storage:load', () => storageService.load())
  ipcMain.handle('storage:save', (_e, data) => storageService.save(data))
  ipcMain.handle('storage:syncWorktreeIds', (_e, map: Record<string, string>) =>
    storageService.saveWorktreeIds(map)
  )

  registerGitIpc()

  // Agent
  ipcMain.handle('agent:startSession', (_e, sessionId: string, worktreeId: string, worktreePath: string, prompt: string, model: string, thinking: boolean, extendedContext: boolean, effortLevel: string, planMode: boolean, sessionName: string, images?: string[], additionalDirectories?: string[], linkedWorktreeContext?: string, connectedDeviceId?: string, mobileFramework?: string) =>
    agentService.startSession(sessionId, worktreeId, worktreePath, prompt, model, thinking, extendedContext, effortLevel, planMode, sessionName, images, additionalDirectories, linkedWorktreeContext, connectedDeviceId, mobileFramework)
  )
  ipcMain.handle('agent:sendMessage', (_e, sessionId: string, message: string, sdkSessionId: string, cwd: string, model: string, extendedContext: boolean, effortLevel: string, planMode: boolean, sessionName: string, images?: string[], additionalDirectories?: string[], linkedWorktreeContext?: string, connectedDeviceId?: string, mobileFramework?: string, resumeSessionAt?: string) =>
    agentService.sendMessage(sessionId, message, sdkSessionId, cwd, model, extendedContext, effortLevel, planMode, sessionName, images, additionalDirectories, linkedWorktreeContext, connectedDeviceId, mobileFramework, resumeSessionAt)
  )
  ipcMain.handle('agent:updateSessionName', (_e, sessionId: string, name: string) =>
    agentService.updateSessionName(sessionId, name)
  )
  ipcMain.handle('agent:notify', (_e, sessionId: string, type: 'done' | 'error' | 'waiting_input', sessionName?: string, errorMessage?: string, reason?: 'question' | 'plan_approval', branch?: string, projectName?: string, worktreePath?: string, terminalId?: string) =>
    agentService.notify(sessionId, type, sessionName, errorMessage, reason, branch, projectName, worktreePath, terminalId)
  )
  ipcMain.handle('agent:getSlashCommands', (_e, cwd: string) =>
    agentService.getSlashCommands(cwd)
  )
  ipcMain.handle('agent:answerToolInput', (_e, sessionId: string, result: Record<string, unknown>) =>
    agentService.answerToolInput(sessionId, result)
  )
  ipcMain.handle('agent:answerElicitation', (_e, sessionId: string, result: { action: string; content?: Record<string, unknown> }) =>
    agentService.answerElicitation(sessionId, result as { action: 'accept' | 'decline' | 'cancel'; content?: Record<string, unknown> })
  )
  ipcMain.handle('agent:stopSession', (_e, sessionId: string) =>
    agentService.stopSession(sessionId)
  )
  ipcMain.handle('agent:closeSession', (_e, sessionId: string) =>
    agentService.closeSession(sessionId)
  )
  ipcMain.handle('agent:generateCommitMessage', (_e, worktreePath: string) =>
    agentService.generateCommitMessage(worktreePath)
  )
  ipcMain.handle('agent:generateSessionTitle', (_e, userMessage: string, assistantSummary: string, currentTitle?: string) =>
    agentService.generateSessionTitle(userMessage, assistantSummary, currentTitle)
  )

  // Dock badge
  ipcMain.on('dock:setBadgeCount', (_e, count: number) => {
    if (process.platform === 'darwin' && app.dock) {
      const safe = Math.max(0, Math.floor(count) || 0)
      app.dock.setBadge(safe > 0 ? String(safe) : '')
    }
  })
  registerPtyIpcHandlers()

  registerGithubIpc()

  // Sessions
  ipcMain.handle('sessions:save', (_e, data: PersistedSession) => sessionStorageService.saveSession(data))
  ipcMain.handle('sessions:loadAll', () => sessionStorageService.loadAllSessions())
  ipcMain.handle('sessions:delete', (_e, sessionId: string) => sessionStorageService.deleteSession(sessionId))
  ipcMain.handle('sessions:deleteByWorktree', (_e, worktreeId: string) => sessionStorageService.deleteSessionsByWorktree(worktreeId))
  ipcMain.handle('sessions:purgeOrphaned', (_e, activeWorktreeIds: string[]) => sessionStorageService.purgeOrphaned(new Set(activeWorktreeIds)))

  // Shell
  ipcMain.handle('shell:isPackaged', () => app.isPackaged)
  ipcMain.handle('shell:openExternal', (_e, url: string) => shell.openExternal(url))
  ipcMain.handle('shell:showItemInFolder', (_e, fullPath: string) => shell.showItemInFolder(fullPath))

  // Uses the shared installer service so every CLI probe waits for PATH hydration.
  ipcMain.handle('shell:checkTool', (_e, tool: string) => toolInstaller.checkCommand(tool))

  ipcMain.handle('shell:checkGhAuth', async () => {
    if (!(await toolInstaller.checkCommand('gh'))) return false
    return new Promise<boolean>((resolve) => {
      execFile('gh', ['auth', 'status'], { timeout: 8000, env: enrichedEnv() }, (err) => resolve(!err))
    })
  })

  // Runs a known installer and returns a typed result with failure reason.
  ipcMain.handle('shell:installTool', (_e, key: string, options?: import('../shared/tool-install').ToolInstallOptions) => toolInstaller.install(key, options))

  // Re-authenticate with Claude Code CLI (OAuth flow — opens browser)
  ipcMain.handle('agent:reAuth', () => {
    const userShell = process.env.SHELL || defaultUserShell()
    return new Promise<{ success: boolean }>((resolve) => {
      execFile(userShell, shellArgs(userShell, 'claude auth login --web'), { timeout: 300_000 }, (err) => {
        resolve({ success: !err })
      })
    })
  })

  registerAppsIpc()

  // Simulator
  ipcMain.handle('simulator:listDevices', () => simulatorService.listDevices())
  ipcMain.handle('simulator:checkCli', () => simulatorService.checkCli())
  ipcMain.handle('simulator:checkPlatformTools', () => simulatorService.checkPlatformTools())
  ipcMain.handle('simulator:boot', (_e, deviceId: string) => simulatorService.bootDevice(deviceId))
  ipcMain.handle('simulator:shutdown', (_e, deviceId: string) => simulatorService.shutdownDevice(deviceId))
  ipcMain.handle('simulator:createStreamSession', (_e, deviceId: string, displayHeight?: number) =>
    simulatorService.createStreamSession(deviceId, displayHeight))
  ipcMain.handle('simulator:gesture', (_e, deviceId: string, actions: Record<string, unknown>[]) =>
    simulatorService.gesture(deviceId, actions))
  ipcMain.handle('simulator:sendText', (_e, deviceId: string, text: string) =>
    simulatorService.sendText(deviceId, text))
  ipcMain.handle('simulator:pressButton', (_e, deviceId: string, button: string) =>
    simulatorService.pressButton(deviceId, button))
  ipcMain.handle('simulator:screenshot', (_e, deviceId: string) =>
    simulatorService.screenshot(deviceId))
  ipcMain.handle('simulator:getOrientation', (_e, deviceId: string) =>
    simulatorService.getOrientation(deviceId))
  ipcMain.handle('simulator:setOrientation', (_e, deviceId: string, orientation: string) =>
    simulatorService.setOrientation(deviceId, orientation))
  ipcMain.handle('simulator:getScreenSize', (_e, deviceId: string) => simulatorService.getScreenSize(deviceId))
  ipcMain.handle('simulator:hideWindow', () => simulatorService.hideSimulatorWindow())
  ipcMain.handle('simulator:metroReload', () => simulatorService.metroReload())
  ipcMain.handle('simulator:sendKeyCombo', (_e, deviceId: string, platform: string, combo: string) =>
    simulatorService.sendKeyCombo(deviceId, platform, combo))
  ipcMain.handle('simulator:flutterSignal', (_e, signal: string) =>
    simulatorService.flutterSignal(signal))
  ipcMain.handle('simulator:serveSimAvailable', () => serveSimService.isAvailable())
  ipcMain.handle('simulator:serveSimStart', (_e, deviceId: string) => serveSimService.start(deviceId))
  ipcMain.handle('simulator:serveSimStop', (_e, deviceId: string) => serveSimService.stop(deviceId))

  // Scripts
  ipcMain.handle('scripts:detect', (_e, projectPath: string, forceRefresh?: boolean) => detectScripts(projectPath, forceRefresh))

  // Templates - scaffold new projects from built-in starter templates.
  // Progress lines are pushed to the invoking renderer via 'templates:log'.
  ipcMain.handle('templates:create', (e, kind: TemplateKind, args: CreateTemplateArgs) =>
    templatesService.create(kind, args, {
      onLog: (entry) => {
        if (!e.sender.isDestroyed()) e.sender.send('templates:log', entry)
      },
    })
  )
  ipcMain.handle('templates:cancel', () => templatesService.cancel())

  // Window Capture
  ipcMain.handle('windowCapture:getSources', () => windowCaptureService.getSources())
  ipcMain.handle('windowCapture:checkPermission', () => windowCaptureService.checkPermission())
  ipcMain.handle('windowCapture:openPermissionSettings', () => windowCaptureService.openPermissionSettings())
  ipcMain.handle('windowCapture:listAllWindows', () => windowCaptureService.listAllWindows())
  ipcMain.handle('windowCapture:selectSource', (_e, sourceId: string) => windowCaptureService.selectSource(sourceId))
  ipcMain.handle('windowCapture:tap', (_e, sourceId: string, relX: number, relY: number) =>
    windowCaptureService.tapWindow(sourceId, relX, relY)
  )

  // Files
  ipcMain.handle('files:getIgnored', (_e, worktreePath: string, patterns?: string[]) =>
    filesService.getIgnoredFiles(worktreePath, patterns)
  )
  ipcMain.handle('files:getFileInfo', (_e, worktreePath: string, paths: string[]) =>
    filesService.getFileInfo(worktreePath, paths)
  )
  ipcMain.handle('files:copyToWorktree', (_e, src: string, dest: string, paths: string[]) =>
    filesService.copyFiles(src, dest, paths)
  )
  ipcMain.handle('files:toRelativePaths', (_e, basePath: string, absolutePaths: string[]) =>
    filesService.toRelativePaths(basePath, absolutePaths)
  )
  ipcMain.handle('files:pathExists', (_e, dirPath: string) =>
    filesService.pathExists(dirPath)
  )
  ipcMain.handle('files:detectPlatform', (_e, repoPath: string) =>
    filesService.detectPlatform(repoPath)
  )
  ipcMain.handle('files:detectFramework', (_e, repoPath: string) =>
    filesService.detectMobileFramework(repoPath)
  )

  // Search
  ipcMain.handle('search:content', (_e, worktreePath: string, query: string, options: SearchOptions) =>
    searchService.searchContent(worktreePath, query, options)
  )
  ipcMain.handle('search:replace', (_e, worktreePath: string, results: SearchFileResult[], replacement: string) =>
    searchService.replaceAll(worktreePath, results, replacement)
  )
  ipcMain.handle('search:replaceOne', (_e, worktreePath: string, relativePath: string, matches: SearchMatch[], replacement: string) =>
    searchService.replaceInFile(worktreePath, relativePath, matches, replacement)
  )

  // Claude CLI detection — delegates to the single source of truth
  ipcMain.handle('claude:detectCliPath', (): string | null => resolveCliPath() ?? null)

  // Clipboard
  ipcMain.handle('clipboard:saveImageAsTempFile', async () => {
    try {
      const image = clipboard.readImage()
      if (image.isEmpty()) return null
      const filename = `braid-paste-${Date.now()}-${randomUUID().slice(0, 8)}.png`
      const tempPath = join(app.getPath('temp'), filename)
      await writeFile(tempPath, image.toPNG(), { mode: 0o600 })
      return tempPath
    } catch (err) {
      logger.error('[IPC] Failed to save clipboard image as temp file:', err)
      return null
    }
  })

  // Dialog
  ipcMain.handle('dialog:openDirectory', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory']
    })
    return result.canceled ? null : result.filePaths[0]
  })
  ipcMain.handle('dialog:openFiles', async (_e, defaultPath?: string) => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      defaultPath
    })
    return result.canceled ? null : result.filePaths
  })

  // Settings — renderer pushes current values so main process can read them
  ipcMain.handle('settings:sync', (_e, values: Partial<typeof mainSettings>) => {
    const prevScrollback = mainSettings.terminalScrollback
    if ('terminalScrollback' in values) {
      const rawScrollback = values.terminalScrollback as unknown
      const parsedScrollback =
        rawScrollback === null || (typeof rawScrollback === 'string' && rawScrollback.trim() === '')
          ? NaN
          : Number(rawScrollback)
      if (Number.isFinite(parsedScrollback)) {
        values.terminalScrollback = clampTerminalScrollbackLines(parsedScrollback)
      } else {
        delete values.terminalScrollback
      }
    }
    Object.assign(mainSettings, values)
    if (mainSettings.terminalScrollback !== prevScrollback) {
      ptyService.setScrollbackBufferMaxLength(
        getTerminalScrollbackBufferMaxLength(mainSettings.terminalScrollback),
      )
    }
    if ('keepAwakeWhileAgentsRun' in values) {
      setAgentAwakeEnabled(mainSettings.keepAwakeWhileAgentsRun)
    }
  })
  ipcMain.handle('settings:getApiKey', () => mainSettings.apiKey)
  ipcMain.handle('settings:getTerminalShell', () => mainSettings.terminalShell)
  ipcMain.handle('settings:getWorktreeStoragePath', () => mainSettings.worktreeStoragePath)
  ipcMain.handle('settings:getSystemPromptSuffix', () => mainSettings.systemPromptSuffix)

  registerClaudeConfigIpc()

  // Notes
  ipcMain.handle('notes:load', (_e, worktreeId: string) => notesService.load(worktreeId))
  ipcMain.handle('notes:save', (_e, worktreeId: string, content: string) => notesService.save(worktreeId, content))
  ipcMain.handle('notes:delete', (_e, worktreeId: string) => notesService.delete(worktreeId))

  registerMobileIpc()

  // LSP
  ipcMain.handle('lsp:detectServers', (_e, projectPath: string, userConfigs: LspServerConfig[]) =>
    lspService.detectServers(projectPath, userConfigs ?? [])
  )
  ipcMain.handle('lsp:detectServersForFile', (_e, filePath: string, boundary: string, userConfigs: LspServerConfig[]) =>
    lspService.detectServersForFile(filePath, boundary, userConfigs ?? [])
  )
  ipcMain.handle('lsp:getStatus', (_e, projectRoot: string) =>
    lspService.getStatuses(projectRoot)
  )
  ipcMain.handle('lsp:startServer', (_e, projectRoot: string, configId: string, userConfigs: LspServerConfig[]) =>
    lspService.ensureServer(projectRoot, configId, userConfigs ?? [])
  )
  ipcMain.handle('lsp:openFile', (_e, projectRoot: string, filePath: string, content: string, languageId: string) =>
    lspService.openFile(projectRoot, filePath, content, languageId)
  )
  ipcMain.handle('lsp:closeFile', (_e, projectRoot: string, filePath: string) =>
    lspService.closeFile(projectRoot, filePath)
  )
  ipcMain.handle('lsp:changeFile', (_e, projectRoot: string, filePath: string, content: string) =>
    lspService.changeFile(projectRoot, filePath, content)
  )
  ipcMain.handle('lsp:hover', (_e, projectRoot: string, filePath: string, line: number, col: number) =>
    lspService.hover(projectRoot, filePath, line, col)
  )
  ipcMain.handle('lsp:definition', (_e, projectRoot: string, filePath: string, line: number, col: number) =>
    lspService.gotoDefinition(projectRoot, filePath, line, col)
  )
  ipcMain.handle('lsp:getDiagnostics', (_e, projectRoot: string, filePath: string) =>
    lspService.getDiagnostics(projectRoot, filePath)
  )
  ipcMain.handle('lsp:rename', (_e, projectRoot: string, filePath: string, line: number, col: number, newName: string) =>
    lspService.rename(projectRoot, filePath, line, col, newName)
  )
  ipcMain.handle('lsp:shutdown', (_e, projectRoot: string) => {
    lspService.shutdown(projectRoot)
  })
  ipcMain.handle('lsp:installServer', (_e, configId: string, userConfigs: LspServerConfig[]) =>
    lspService.installServer(configId, userConfigs ?? [])
  )

  // Auto-updater
  ipcMain.handle('updater:download', () => downloadUpdate())
  ipcMain.handle('updater:install', () => installUpdate())
  ipcMain.handle('updater:check', () => checkForUpdates())

  registerUsageIpc()

  // ── Menu ──────────────────────────────────────────────────────────────────
  ipcMain.on('menu:closeWindow', () => {
    BrowserWindow.getFocusedWindow()?.close()
  })
}
