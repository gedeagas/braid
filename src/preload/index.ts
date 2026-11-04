import { contextBridge, ipcRenderer, webFrame, webUtils } from 'electron'
import { ptyBridge } from './ptyBridge'
import { githubBridge } from './githubBridge'
import { gitBridge } from './gitBridge'
import { mobileBridge } from './mobileBridge'
import { browserBridge } from './browserBridge'
import type { TemplateKind, CreateTemplateArgs, CreateTemplateResult, TemplateLogEntry } from '../shared/templates'
import type { ToolInstallKey, ToolInstallOptions, ToolInstallResult } from '../shared/tool-install'

const api = {
  // Storage
  storage: {
    load: () => ipcRenderer.invoke('storage:load'),
    save: (data: unknown) => ipcRenderer.invoke('storage:save', data),
    syncWorktreeIds: (map: Record<string, string>) =>
      ipcRenderer.invoke('storage:syncWorktreeIds', map)
  },

  // Git
  git: gitBridge,

  // Agent
  agent: {
    startSession: (sessionId: string, worktreeId: string, worktreePath: string, prompt: string, model: string, thinking: boolean, extendedContext: boolean, effortLevel: string, planMode: boolean, sessionName: string, images?: string[], additionalDirectories?: string[], linkedWorktreeContext?: string, connectedDeviceId?: string, mobileFramework?: string) =>
      ipcRenderer.invoke('agent:startSession', sessionId, worktreeId, worktreePath, prompt, model, thinking, extendedContext, effortLevel, planMode, sessionName, images, additionalDirectories, linkedWorktreeContext, connectedDeviceId, mobileFramework),
    sendMessage: (sessionId: string, message: string, sdkSessionId: string, cwd: string, model: string, extendedContext: boolean, effortLevel: string, planMode: boolean, sessionName: string, images?: string[], additionalDirectories?: string[], linkedWorktreeContext?: string, connectedDeviceId?: string, mobileFramework?: string, resumeSessionAt?: string) =>
      ipcRenderer.invoke('agent:sendMessage', sessionId, message, sdkSessionId, cwd, model, extendedContext, effortLevel, planMode, sessionName, images, additionalDirectories, linkedWorktreeContext, connectedDeviceId, mobileFramework, resumeSessionAt),
    updateSessionName: (sessionId: string, name: string) =>
      ipcRenderer.invoke('agent:updateSessionName', sessionId, name),
    notify: (sessionId: string, type: 'done' | 'error' | 'waiting_input', sessionName?: string, errorMessage?: string, reason?: 'question' | 'plan_approval', branch?: string, projectName?: string, worktreePath?: string, terminalId?: string) =>
      ipcRenderer.invoke('agent:notify', sessionId, type, sessionName, errorMessage, reason, branch, projectName, worktreePath, terminalId),
    getSlashCommands: (cwd: string) =>
      ipcRenderer.invoke('agent:getSlashCommands', cwd),
    answerToolInput: (sessionId: string, result: Record<string, unknown>) =>
      ipcRenderer.invoke('agent:answerToolInput', sessionId, result),
    answerElicitation: (sessionId: string, result: { action: string; content?: Record<string, unknown> }) =>
      ipcRenderer.invoke('agent:answerElicitation', sessionId, result),
    reAuth: () => ipcRenderer.invoke('agent:reAuth') as Promise<{ success: boolean }>,
    stopSession: (sessionId: string) => ipcRenderer.invoke('agent:stopSession', sessionId),
    closeSession: (sessionId: string) => ipcRenderer.invoke('agent:closeSession', sessionId),
    generateCommitMessage: (worktreePath: string) => ipcRenderer.invoke('agent:generateCommitMessage', worktreePath),
    generateSessionTitle: (userMessage: string, assistantSummary: string, currentTitle?: string) =>
      ipcRenderer.invoke('agent:generateSessionTitle', userMessage, assistantSummary, currentTitle),
    onEvent: (callback: (data: { sessionId: string; event: unknown }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { sessionId: string; event: unknown }) => callback(data)
      ipcRenderer.on('agent:event', handler)
      return () => ipcRenderer.removeListener('agent:event', handler)
    }
  },

  // PTY
  pty: ptyBridge,

  // Simulator
  simulator: {
    listDevices: () => ipcRenderer.invoke('simulator:listDevices'),
    checkCli: () => ipcRenderer.invoke('simulator:checkCli') as Promise<boolean>,
    checkPlatformTools: () => ipcRenderer.invoke('simulator:checkPlatformTools') as Promise<{ xcode: boolean; androidSdk: boolean }>,
    boot: (deviceId: string) => ipcRenderer.invoke('simulator:boot', deviceId),
    shutdown: (deviceId: string) => ipcRenderer.invoke('simulator:shutdown', deviceId),
    createStreamSession: (deviceId: string, displayHeight?: number) =>
      ipcRenderer.invoke('simulator:createStreamSession', deviceId, displayHeight),
    gesture: (deviceId: string, actions: Record<string, unknown>[]) =>
      ipcRenderer.invoke('simulator:gesture', deviceId, actions),
    sendText: (deviceId: string, text: string) =>
      ipcRenderer.invoke('simulator:sendText', deviceId, text),
    pressButton: (deviceId: string, button: string) =>
      ipcRenderer.invoke('simulator:pressButton', deviceId, button),
    screenshot: (deviceId: string) =>
      ipcRenderer.invoke('simulator:screenshot', deviceId),
    getOrientation: (deviceId: string) =>
      ipcRenderer.invoke('simulator:getOrientation', deviceId),
    setOrientation: (deviceId: string, orientation: string) =>
      ipcRenderer.invoke('simulator:setOrientation', deviceId, orientation),
    getScreenSize: (deviceId: string) => ipcRenderer.invoke('simulator:getScreenSize', deviceId),
    hideWindow: () => ipcRenderer.invoke('simulator:hideWindow'),
    metroReload: () => ipcRenderer.invoke('simulator:metroReload'),
    sendKeyCombo: (deviceId: string, platform: string, combo: string) =>
      ipcRenderer.invoke('simulator:sendKeyCombo', deviceId, platform, combo),
    flutterSignal: (signal: string) =>
      ipcRenderer.invoke('simulator:flutterSignal', signal),
    serveSimAvailable: () => ipcRenderer.invoke('simulator:serveSimAvailable') as Promise<boolean>,
    serveSimStart: (deviceId: string) => ipcRenderer.invoke('simulator:serveSimStart', deviceId) as Promise<string>,
    serveSimStop: (deviceId: string) => ipcRenderer.invoke('simulator:serveSimStop', deviceId) as Promise<void>,
    onServeSimExited: (callback: (deviceId: string) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, deviceId: string) => callback(deviceId)
      ipcRenderer.on('simulator:serveSimExited', handler)
      return () => ipcRenderer.removeListener('simulator:serveSimExited', handler)
    },
  },

  // Scripts
  scripts: {
    detect: (projectPath: string, forceRefresh?: boolean) =>
      ipcRenderer.invoke('scripts:detect', projectPath, forceRefresh) as Promise<Array<{ id: string; name: string; command: string; source: string }>>,
  },

  // Templates - scaffold new projects from built-in starter templates
  templates: {
    create: (kind: TemplateKind, args: CreateTemplateArgs) =>
      ipcRenderer.invoke('templates:create', kind, args) as Promise<CreateTemplateResult>,
    cancel: () => ipcRenderer.invoke('templates:cancel') as Promise<boolean>,
    /**
     * Subscribe to per-line stdout/stderr from the active scaffold.
     * Returns an unsubscribe function.
     */
    onLog: (handler: (entry: TemplateLogEntry) => void) => {
      const listener = (_: Electron.IpcRendererEvent, entry: TemplateLogEntry) => handler(entry)
      ipcRenderer.on('templates:log', listener)
      return () => {
        ipcRenderer.off('templates:log', listener)
      }
    },
  },

  // Window Capture
  windowCapture: {
    getSources: () => ipcRenderer.invoke('windowCapture:getSources'),
    checkPermission: () => ipcRenderer.invoke('windowCapture:checkPermission') as Promise<string>,
    openPermissionSettings: () => ipcRenderer.invoke('windowCapture:openPermissionSettings'),
    listAllWindows: () => ipcRenderer.invoke('windowCapture:listAllWindows') as Promise<Array<{ id: string; name: string }>>,
    selectSource: (sourceId: string) => ipcRenderer.invoke('windowCapture:selectSource', sourceId),
    tap: (sourceId: string, relX: number, relY: number) =>
      ipcRenderer.invoke('windowCapture:tap', sourceId, relX, relY),
  },

  // GitHub
  github: githubBridge,

  // Jira (optional — only available when acli is installed)
  jira: {
    isAvailable: () => ipcRenderer.invoke('jira:isAvailable') as Promise<boolean>,
    recheckAvailability: () => ipcRenderer.invoke('jira:recheckAvailability') as Promise<boolean>,
    getIssuesForBranch: (worktreePath: string, overrideBaseUrl?: string, forceRefresh?: boolean) =>
      ipcRenderer.invoke('jira:getIssuesForBranch', worktreePath, overrideBaseUrl, forceRefresh),
    getIssueByKey: (key: string, overrideBaseUrl?: string, forceRefresh?: boolean, includeContext?: boolean) =>
      ipcRenderer.invoke('jira:getIssueByKey', key, overrideBaseUrl, forceRefresh, includeContext),
    invalidateCache: (key?: string) => ipcRenderer.invoke('jira:invalidateCache', key),
  },

  // Sessions
  sessions: {
    save: (data: unknown) => ipcRenderer.invoke('sessions:save', data),
    loadAll: () => ipcRenderer.invoke('sessions:loadAll'),
    delete: (sessionId: string) => ipcRenderer.invoke('sessions:delete', sessionId),
    deleteByWorktree: (worktreeId: string) => ipcRenderer.invoke('sessions:deleteByWorktree', worktreeId),
    purgeOrphaned: (activeWorktreeIds: string[]) => ipcRenderer.invoke('sessions:purgeOrphaned', activeWorktreeIds)
  },

  // Shell
  shell: {
    platform: process.platform,
    isPackaged: () => ipcRenderer.invoke('shell:isPackaged') as Promise<boolean>,
    openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url),
    showItemInFolder: (path: string) => ipcRenderer.invoke('shell:showItemInFolder', path),
    getInstalledApps: () => ipcRenderer.invoke('shell:getInstalledApps') as Promise<Array<{ id: string; name: string; icon: string | null }>>,
    openInApp: (appId: string, targetPath: string) => ipcRenderer.invoke('shell:openInApp', appId, targetPath),
    checkTool: (tool: string) => ipcRenderer.invoke('shell:checkTool', tool) as Promise<boolean>,
    checkGhAuth: () => ipcRenderer.invoke('shell:checkGhAuth') as Promise<boolean>,
    installTool: (key: ToolInstallKey, options?: ToolInstallOptions) =>
      ipcRenderer.invoke('shell:installTool', key, options) as Promise<ToolInstallResult>,
  },

  // Files
  files: {
    getIgnored: (worktreePath: string, patterns?: string[]) =>
      ipcRenderer.invoke('files:getIgnored', worktreePath, patterns) as Promise<Array<{ path: string; size: number }>>,
    getFileInfo: (worktreePath: string, paths: string[]) =>
      ipcRenderer.invoke('files:getFileInfo', worktreePath, paths) as Promise<Array<{ path: string; exists: boolean; size: number }>>,
    copyToWorktree: (src: string, dest: string, paths: string[]) =>
      ipcRenderer.invoke('files:copyToWorktree', src, dest, paths) as Promise<{ copied: string[]; failed: string[] }>,
    toRelativePaths: (basePath: string, absolutePaths: string[]) =>
      ipcRenderer.invoke('files:toRelativePaths', basePath, absolutePaths) as Promise<string[]>,
    pathExists: (dirPath: string) =>
      ipcRenderer.invoke('files:pathExists', dirPath) as Promise<boolean>,
    detectPlatform: (repoPath: string) =>
      ipcRenderer.invoke('files:detectPlatform', repoPath) as Promise<'mobile' | 'web' | 'unknown'>,
    detectFramework: (repoPath: string) =>
      ipcRenderer.invoke('files:detectFramework', repoPath) as Promise<'react-native' | 'flutter' | null>,
  },

  // Search
  search: {
    content: (worktreePath: string, query: string, options: import('../shared/search').SearchOptions) =>
      ipcRenderer.invoke('search:content', worktreePath, query, options) as Promise<import('../shared/search').SearchResult>,
    replace: (worktreePath: string, results: import('../shared/search').SearchFileResult[], replacement: string) =>
      ipcRenderer.invoke('search:replace', worktreePath, results, replacement) as Promise<import('../shared/search').ReplaceResult>,
    replaceOne: (worktreePath: string, relativePath: string, matches: import('../shared/search').SearchMatch[], replacement: string) =>
      ipcRenderer.invoke('search:replaceOne', worktreePath, relativePath, matches, replacement) as Promise<{ replaced: number }>,
  },

  // Clipboard
  clipboard: {
    saveImageAsTempFile: () => ipcRenderer.invoke('clipboard:saveImageAsTempFile') as Promise<string | null>,
  },

  // Claude CLI
  claudeCli: {
    detectPath: () => ipcRenderer.invoke('claude:detectCliPath') as Promise<string | null>,
  },

  // Dialog
  dialog: {
    openDirectory: () => ipcRenderer.invoke('dialog:openDirectory'),
    openFiles: (defaultPath?: string) =>
      ipcRenderer.invoke('dialog:openFiles', defaultPath) as Promise<string[] | null>,
  },

  // Window
  window: {
    setZoomFactor: (factor: number) => webFrame.setZoomFactor(factor),
  },

  // Claude Config
  claudeConfig: {
    getPermissions: () => ipcRenderer.invoke('claudeConfig:getPermissions'),
    setPermissions: (perms: { allow: string[]; deny: string[] }) => ipcRenderer.invoke('claudeConfig:setPermissions', perms),
    getProjectPermissions: (projectPath: string) => ipcRenderer.invoke('claudeConfig:getProjectPermissions', projectPath),
    setProjectPermissions: (projectPath: string, perms: { allow: string[]; deny: string[] }) =>
      ipcRenderer.invoke('claudeConfig:setProjectPermissions', projectPath, perms),
    getHooks: () => ipcRenderer.invoke('claudeConfig:getHooks'),
    setHooks: (hooks: Record<string, unknown>) => ipcRenderer.invoke('claudeConfig:setHooks', hooks),
    getGlobalInstructions: () => ipcRenderer.invoke('claudeConfig:getGlobalInstructions'),
    setGlobalInstructions: (content: string) => ipcRenderer.invoke('claudeConfig:setGlobalInstructions', content),
    getProjectInstructions: (projectPath: string) => ipcRenderer.invoke('claudeConfig:getProjectInstructions', projectPath),
    setProjectInstructions: (projectPath: string, content: string) =>
      ipcRenderer.invoke('claudeConfig:setProjectInstructions', projectPath, content),
    getPlugins: () => ipcRenderer.invoke('claudeConfig:getPlugins'),
    setPluginEnabled: (pluginId: string, enabled: boolean) => ipcRenderer.invoke('claudeConfig:setPluginEnabled', pluginId, enabled),
    getSkills: (projectPath?: string) => ipcRenderer.invoke('claudeConfig:getSkills', projectPath),
    getSkillDetail: (skillPath: string) => ipcRenderer.invoke('claudeConfig:getSkillDetail', skillPath),
    setSkillDetail: (skillPath: string, detail: Record<string, unknown>) =>
      ipcRenderer.invoke('claudeConfig:setSkillDetail', skillPath, detail),
    createSkill: (scope: string, name: string, description: string, projectPath?: string) =>
      ipcRenderer.invoke('claudeConfig:createSkill', scope, name, description, projectPath),
    deleteSkill: (skillPath: string) => ipcRenderer.invoke('claudeConfig:deleteSkill', skillPath),
    getMcpServers: () => ipcRenderer.invoke('claudeConfig:getMcpServers'),
    setMcpServers: (servers: unknown[]) => ipcRenderer.invoke('claudeConfig:setMcpServers', servers),
    getProjectMcpServers: (projectPath: string) => ipcRenderer.invoke('claudeConfig:getProjectMcpServers', projectPath),
    getPluginMcpServers: () => ipcRenderer.invoke('claudeConfig:getPluginMcpServers'),
    checkMcpHealth: (servers: Array<{ name: string; config: unknown }>) =>
      ipcRenderer.invoke('claudeConfig:checkMcpHealth', servers),
    authenticateMcpServer: (serverName: string, serverConfig: unknown) =>
      ipcRenderer.invoke('claudeConfig:authenticateMcpServer', serverName, serverConfig),
  },

  // Menu actions (from Electron menu → renderer)
  menu: {
    onAction: (callback: (action: string) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, action: string) => callback(action)
      ipcRenderer.on('menu:action', handler)
      return () => { ipcRenderer.removeListener('menu:action', handler) }
    },
    closeWindow: () => ipcRenderer.send('menu:closeWindow'),
  },

  // Dock badge
  dock: {
    setBadgeCount: (count: number) => ipcRenderer.send('dock:setBadgeCount', count),
  },

  // Browser tabs (main -> renderer events from browser guests)
  browser: browserBridge,

  // Notes
  notes: {
    load: (worktreeId: string) => ipcRenderer.invoke('notes:load', worktreeId) as Promise<string>,
    save: (worktreeId: string, content: string) => ipcRenderer.invoke('notes:save', worktreeId, content) as Promise<void>,
    delete: (worktreeId: string) => ipcRenderer.invoke('notes:delete', worktreeId) as Promise<void>,
  },

  // LSP
  lsp: {
    detectServers: (projectPath: string, userConfigs: unknown[]) =>
      ipcRenderer.invoke('lsp:detectServers', projectPath, userConfigs),
    detectServersForFile: (filePath: string, boundary: string, userConfigs: unknown[]) =>
      ipcRenderer.invoke('lsp:detectServersForFile', filePath, boundary, userConfigs),
    getStatus: (projectRoot: string) =>
      ipcRenderer.invoke('lsp:getStatus', projectRoot),
    startServer: (projectRoot: string, configId: string, userConfigs: unknown[]) =>
      ipcRenderer.invoke('lsp:startServer', projectRoot, configId, userConfigs),
    openFile: (projectRoot: string, filePath: string, content: string, languageId: string) =>
      ipcRenderer.invoke('lsp:openFile', projectRoot, filePath, content, languageId),
    closeFile: (projectRoot: string, filePath: string) =>
      ipcRenderer.invoke('lsp:closeFile', projectRoot, filePath),
    changeFile: (projectRoot: string, filePath: string, content: string) =>
      ipcRenderer.invoke('lsp:changeFile', projectRoot, filePath, content),
    hover: (projectRoot: string, filePath: string, line: number, col: number) =>
      ipcRenderer.invoke('lsp:hover', projectRoot, filePath, line, col),
    definition: (projectRoot: string, filePath: string, line: number, col: number) =>
      ipcRenderer.invoke('lsp:definition', projectRoot, filePath, line, col),
    getDiagnostics: (projectRoot: string, filePath: string) =>
      ipcRenderer.invoke('lsp:getDiagnostics', projectRoot, filePath),
    rename: (projectRoot: string, filePath: string, line: number, col: number, newName: string) =>
      ipcRenderer.invoke('lsp:rename', projectRoot, filePath, line, col, newName),
    shutdown: (projectRoot: string) =>
      ipcRenderer.invoke('lsp:shutdown', projectRoot),
    installServer: (configId: string, userConfigs: unknown[]) =>
      ipcRenderer.invoke('lsp:installServer', configId, userConfigs),
    onStatusUpdate: (cb: (update: unknown) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, update: unknown) => cb(update)
      ipcRenderer.on('lsp:statusUpdate', handler)
      return () => ipcRenderer.removeListener('lsp:statusUpdate', handler)
    },
    onDiagnosticsUpdate: (cb: (update: unknown) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, update: unknown) => cb(update)
      ipcRenderer.on('lsp:diagnosticsUpdate', handler)
      return () => ipcRenderer.removeListener('lsp:diagnosticsUpdate', handler)
    },
  },

  // Auto-updater
  updater: {
    download: () => ipcRenderer.invoke('updater:download'),
    install: () => ipcRenderer.invoke('updater:install'),
    onUpdateAvailable: (cb: (info: { version: string; releaseNotes: string; releaseDate: string }) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, info: { version: string; releaseNotes: string; releaseDate: string }) => cb(info)
      ipcRenderer.on('updater:update-available', handler)
      return () => ipcRenderer.removeListener('updater:update-available', handler)
    },
    onUpdateDownloaded: (cb: (info: { version: string }) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, info: { version: string }) => cb(info)
      ipcRenderer.on('updater:update-downloaded', handler)
      return () => ipcRenderer.removeListener('updater:update-downloaded', handler)
    },
    onError: (cb: (info: { message: string }) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, info: { message: string }) => cb(info)
      ipcRenderer.on('updater:error', handler)
      return () => ipcRenderer.removeListener('updater:error', handler)
    },
    check: () => ipcRenderer.invoke('updater:check') as Promise<boolean>,
    onUpToDate: (cb: () => void) => {
      const handler = () => cb()
      ipcRenderer.on('updater:up-to-date', handler)
      return () => ipcRenderer.removeListener('updater:up-to-date', handler)
    },
  },

  // Drag — Electron 28+ replacement for deprecated File.path
  drag: {
    getPathForFile: (file: File) => webUtils.getPathForFile(file),
  },

  // Settings sync
  settings: {
    sync: (values: Record<string, unknown>) => ipcRenderer.invoke('settings:sync', values),
    getApiKey: () => ipcRenderer.invoke('settings:getApiKey'),
    getTerminalShell: () => ipcRenderer.invoke('settings:getTerminalShell'),
    getWorktreeStoragePath: () => ipcRenderer.invoke('settings:getWorktreeStoragePath'),
    getSystemPromptSuffix: () => ipcRenderer.invoke('settings:getSystemPromptSuffix'),
  },

  // Mobile Companion Server
  mobile: mobileBridge,
  // Claude Usage Analytics
  claudeUsage: {
    getScanState: () => ipcRenderer.invoke('claudeUsage:getScanState'),
    setEnabled: (args: { enabled: boolean }) => ipcRenderer.invoke('claudeUsage:setEnabled', args),
    clearData: () => ipcRenderer.invoke('claudeUsage:clearData'),
    refresh: (args?: { force?: boolean }) => ipcRenderer.invoke('claudeUsage:refresh', args),
    getSnapshot: (args: { scope: string; range: string; limit?: number; force?: boolean }) => ipcRenderer.invoke('claudeUsage:getSnapshot', args),
    getSummary: (args: { scope: string; range: string }) => ipcRenderer.invoke('claudeUsage:getSummary', args),
    getDaily: (args: { scope: string; range: string }) => ipcRenderer.invoke('claudeUsage:getDaily', args),
    getBreakdown: (args: { scope: string; range: string; kind: string }) => ipcRenderer.invoke('claudeUsage:getBreakdown', args),
    getRecentSessions: (args: { scope: string; range: string; limit?: number }) => ipcRenderer.invoke('claudeUsage:getRecentSessions', args),
  },

  // Codex Usage Analytics
  codexUsage: {
    getScanState: () => ipcRenderer.invoke('codexUsage:getScanState'),
    setEnabled: (args: { enabled: boolean }) => ipcRenderer.invoke('codexUsage:setEnabled', args),
    clearData: () => ipcRenderer.invoke('codexUsage:clearData'),
    refresh: (args?: { force?: boolean }) => ipcRenderer.invoke('codexUsage:refresh', args),
    getSnapshot: (args: { scope: string; range: string; limit?: number; force?: boolean }) => ipcRenderer.invoke('codexUsage:getSnapshot', args),
    getSummary: (args: { scope: string; range: string }) => ipcRenderer.invoke('codexUsage:getSummary', args),
    getDaily: (args: { scope: string; range: string }) => ipcRenderer.invoke('codexUsage:getDaily', args),
    getBreakdown: (args: { scope: string; range: string; kind: string }) => ipcRenderer.invoke('codexUsage:getBreakdown', args),
    getRecentSessions: (args: { scope: string; range: string; limit?: number }) => ipcRenderer.invoke('codexUsage:getRecentSessions', args),
  },

  // Rate Limits
  rateLimits: {
    get: () => ipcRenderer.invoke('rateLimits:get'),
    refresh: () => ipcRenderer.invoke('rateLimits:refresh'),
    onUpdate: (cb: (state: unknown) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, state: unknown) => cb(state)
      ipcRenderer.on('rateLimits:update', handler)
      return () => { ipcRenderer.removeListener('rateLimits:update', handler) }
    },
  },

  // Resource Usage
  resource: {
    getSnapshot: () => ipcRenderer.invoke('resource:getSnapshot'),
  },
}

export type ElectronAPI = typeof api

contextBridge.exposeInMainWorld('api', api)

// Prevent dropping files anywhere from navigating the Electron window to file:///...
// Capture phase so it fires before any React handlers; no stopPropagation so React still sees the event.
document.addEventListener('dragover', (e) => { e.preventDefault() }, true)
document.addEventListener('drop', (e) => { e.preventDefault() }, true)
