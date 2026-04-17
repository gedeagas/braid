import { contextBridge, ipcRenderer, webFrame } from 'electron'

const api = {
  // Storage
  storage: {
    load: () => ipcRenderer.invoke('storage:load'),
    save: (data: unknown) => ipcRenderer.invoke('storage:save', data)
  },

  // Git
  git: {
    getWorktrees: (repoPath: string) => ipcRenderer.invoke('git:getWorktrees', repoPath),
    addWorktree: (repoPath: string, branch: string, projectName: string, baseBranch?: string) =>
      ipcRenderer.invoke('git:addWorktree', repoPath, branch, projectName, baseBranch),
    removeWorktree: (repoPath: string, worktreePath: string) =>
      ipcRenderer.invoke('git:removeWorktree', repoPath, worktreePath),
    getBranches: (repoPath: string) => ipcRenderer.invoke('git:getBranches', repoPath),
    getStatus: (worktreePath: string) => ipcRenderer.invoke('git:getStatus', worktreePath),
    getDiff: (worktreePath: string) => ipcRenderer.invoke('git:getDiff', worktreePath),
    getFileDiff: (worktreePath: string, file: string, status: string, staged: boolean) =>
      ipcRenderer.invoke('git:getFileDiff', worktreePath, file, status, staged),
    getFileTree: (worktreePath: string, forceRefresh?: boolean) =>
      ipcRenderer.invoke('git:getFileTree', worktreePath, undefined, forceRefresh),
    invalidateFileTree: (worktreePath: string) => ipcRenderer.invoke('git:invalidateFileTree', worktreePath),
    invalidateTrackedFiles: (worktreePath: string) => ipcRenderer.invoke('git:invalidateTrackedFiles', worktreePath),
    readFile: (filePath: string) => ipcRenderer.invoke('git:readFile', filePath),
    readFileAsBase64: (filePath: string) =>
      ipcRenderer.invoke('git:readFileAsBase64', filePath) as Promise<{ base64: string | null; size: number } | null>,
    getFileSize: (filePath: string) =>
      ipcRenderer.invoke('git:getFileSize', filePath) as Promise<number>,
    writeFile: (filePath: string, content: string) => ipcRenderer.invoke('git:writeFile', filePath, content),
    getTrackingBranch: (worktreePath: string, branch: string) =>
      ipcRenderer.invoke('git:getTrackingBranch', worktreePath, branch),
    getRemoteBranches: (worktreePath: string, forceRefresh?: boolean) =>
      ipcRenderer.invoke('git:getRemoteBranches', worktreePath, forceRefresh) as Promise<{ branches: string[]; defaultBranch?: string }>,
    getRemoteUrl: (repoPath: string) =>
      ipcRenderer.invoke('git:getRemoteUrl', repoPath) as Promise<string>,
    getRemotes: (repoPath: string) =>
      ipcRenderer.invoke('git:getRemotes', repoPath) as Promise<Array<{ name: string; url: string }>>,
    renameBranch: (worktreePath: string, oldName: string, newName: string) =>
      ipcRenderer.invoke('git:renameBranch', worktreePath, oldName, newName),
    setUpstream: (worktreePath: string, branch: string, upstream: string) =>
      ipcRenderer.invoke('git:setUpstream', worktreePath, branch, upstream),
    isBranchProtected: (worktreePath: string, branch: string) =>
      ipcRenderer.invoke('git:isBranchProtected', worktreePath, branch),
    cloneRepo: (url: string) => ipcRenderer.invoke('git:cloneRepo', url),
    stageFiles: (worktreePath: string, files: string[]) =>
      ipcRenderer.invoke('git:stageFiles', worktreePath, files),
    unstageFiles: (worktreePath: string, files: string[]) =>
      ipcRenderer.invoke('git:unstageFiles', worktreePath, files),
    discardChanges: (worktreePath: string, file: string, status: string, staged?: boolean) =>
      ipcRenderer.invoke('git:discardChanges', worktreePath, file, status, staged),
    commit: (worktreePath: string, message: string) =>
      ipcRenderer.invoke('git:commit', worktreePath, message),
    pull: (worktreePath: string, strategy?: string) => ipcRenderer.invoke('git:pull', worktreePath, strategy),
    push: (worktreePath: string) => ipcRenderer.invoke('git:push', worktreePath),
    getTrackedFiles: (worktreePath: string) =>
      ipcRenderer.invoke('git:getTrackedFiles', worktreePath) as Promise<string[]>,
    getGitUserConfig: (repoPath: string) =>
      ipcRenderer.invoke('git:getGitUserConfig', repoPath) as Promise<{
        global: { name: string; email: string }
        local: { name: string | null; email: string | null }
      }>,
    setGitUserConfig: (repoPath: string, name: string, email: string) =>
      ipcRenderer.invoke('git:setGitUserConfig', repoPath, name, email) as Promise<void>,
    clearGitUserConfig: (repoPath: string) =>
      ipcRenderer.invoke('git:clearGitUserConfig', repoPath) as Promise<void>,
    initRepo: (dirPath: string) =>
      ipcRenderer.invoke('git:initRepo', dirPath) as Promise<void>,
    isRepoRoot: (repoPath: string) =>
      ipcRenderer.invoke('git:isRepoRoot', repoPath) as Promise<boolean>,
    findChildRepos: (parentPath: string) =>
      ipcRenderer.invoke('git:findChildRepos', parentPath) as Promise<string[]>,
  },

  // Agent
  agent: {
    startSession: (sessionId: string, worktreeId: string, worktreePath: string, prompt: string, model: string, thinking: boolean, extendedContext: boolean, effortLevel: string, planMode: boolean, sessionName: string, images?: string[], additionalDirectories?: string[], linkedWorktreeContext?: string, connectedDeviceId?: string, mobileFramework?: string) =>
      ipcRenderer.invoke('agent:startSession', sessionId, worktreeId, worktreePath, prompt, model, thinking, extendedContext, effortLevel, planMode, sessionName, images, additionalDirectories, linkedWorktreeContext, connectedDeviceId, mobileFramework),
    sendMessage: (sessionId: string, message: string, sdkSessionId: string, cwd: string, model: string, extendedContext: boolean, effortLevel: string, planMode: boolean, sessionName: string, images?: string[], additionalDirectories?: string[], linkedWorktreeContext?: string, connectedDeviceId?: string, mobileFramework?: string) =>
      ipcRenderer.invoke('agent:sendMessage', sessionId, message, sdkSessionId, cwd, model, extendedContext, effortLevel, planMode, sessionName, images, additionalDirectories, linkedWorktreeContext, connectedDeviceId, mobileFramework),
    updateSessionName: (sessionId: string, name: string) =>
      ipcRenderer.invoke('agent:updateSessionName', sessionId, name),
    notify: (sessionId: string, type: 'done' | 'error' | 'waiting_input', sessionName?: string, errorMessage?: string, reason?: 'question' | 'plan_approval') =>
      ipcRenderer.invoke('agent:notify', sessionId, type, sessionName, errorMessage, reason),
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
  pty: {
    spawn: (cwd: string) => ipcRenderer.invoke('pty:spawn', cwd),
    write: (id: string, data: string) => ipcRenderer.send('pty:write', id, data),
    resize: (id: string, cols: number, rows: number) => ipcRenderer.send('pty:resize', id, cols, rows),
    kill: (id: string) => ipcRenderer.invoke('pty:kill', id),
    runScript: (cwd: string, command: string) => ipcRenderer.invoke('pty:runScript', cwd, command) as Promise<{ exitCode: number }>,
    readTerminalOutput: (worktreePath: string) => ipcRenderer.invoke('pty:readTerminalOutput', worktreePath) as Promise<Array<{ ptyId: string; output: string }>>,
    onData: (callback: (id: string, data: string) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, id: string, data: string) => callback(id, data)
      ipcRenderer.on('pty:data', handler)
      return () => ipcRenderer.removeListener('pty:data', handler)
    },
    onExit: (callback: (id: string, exitCode: number) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, id: string, exitCode: number) => callback(id, exitCode)
      ipcRenderer.on('pty:exit', handler)
      return () => ipcRenderer.removeListener('pty:exit', handler)
    }
  },

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
  },

  // Scripts
  scripts: {
    detect: (projectPath: string, forceRefresh?: boolean) =>
      ipcRenderer.invoke('scripts:detect', projectPath, forceRefresh) as Promise<Array<{ id: string; name: string; command: string; source: string }>>,
  },

  // Templates - scaffold new projects from built-in starter templates
  templates: {
    create: (kind: 'nextjs', args: { parentDir: string; projectName: string }) =>
      ipcRenderer.invoke('templates:create', kind, args) as Promise<
        | { success: true }
        | {
            success: false
            reason:
              | 'invalid-name'
              | 'missing-parent'
              | 'parent-not-directory'
              | 'tool-missing'
              | 'timeout'
              | 'cancelled'
              | 'failed'
            stderr?: string
          }
      >,
    cancel: () => ipcRenderer.invoke('templates:cancel') as Promise<boolean>,
    /**
     * Subscribe to per-line stdout/stderr from the active scaffold.
     * Returns an unsubscribe function.
     */
    onLog: (handler: (entry: { stream: 'stdout' | 'stderr'; line: string }) => void) => {
      const listener = (
        _: Electron.IpcRendererEvent,
        entry: { stream: 'stdout' | 'stderr'; line: string }
      ) => handler(entry)
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
  github: {
    getPrStatus: (worktreePath: string, forceRefresh?: boolean) =>
      ipcRenderer.invoke('github:getPrStatus', worktreePath, forceRefresh),
    getChecks: (worktreePath: string, forceRefresh?: boolean) =>
      ipcRenderer.invoke('github:getChecks', worktreePath, forceRefresh),
    getDeployments: (worktreePath: string, forceRefresh?: boolean) =>
      ipcRenderer.invoke('github:getDeployments', worktreePath, forceRefresh),
    getOwnerAvatarUrl: (cwd: string) =>
      ipcRenderer.invoke('github:getOwnerAvatarUrl', cwd) as Promise<string>,
    getGitSyncStatus: (worktreePath: string, baseBranch: string, forceRefresh?: boolean) =>
      ipcRenderer.invoke('github:getGitSyncStatus', worktreePath, baseBranch, forceRefresh),
    getCheckRunLog: (worktreePath: string, checkUrl: string) =>
      ipcRenderer.invoke('github:getCheckRunLog', worktreePath, checkUrl),
    openCheckLog: (worktreePath: string, checkUrl: string, checkName: string) =>
      ipcRenderer.invoke('github:openCheckLog', worktreePath, checkUrl, checkName),
    mergePr: (worktreePath: string, strategy: string) =>
      ipcRenderer.invoke('github:mergePr', worktreePath, strategy),
    markPrReady: (worktreePath: string) =>
      ipcRenderer.invoke('github:markPrReady', worktreePath),
    startDeviceFlow: () =>
      ipcRenderer.invoke('github:startDeviceFlow') as Promise<{
        userCode: string; verificationUri: string; expiresIn: number
      }>,
    cancelDeviceFlow: () => ipcRenderer.invoke('github:cancelDeviceFlow'),
    feedGhToken: (token: string) =>
      ipcRenderer.invoke('github:feedGhToken', token) as Promise<{ success: boolean }>,
    onDeviceFlowEvent: (callback: (event: { status: string; token?: string; error?: string }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { status: string; token?: string; error?: string }) => callback(data)
      ipcRenderer.on('github:deviceFlowEvent', handler)
      return () => { ipcRenderer.removeListener('github:deviceFlowEvent', handler) }
    },
  },

  // Jira (optional — only available when acli is installed)
  jira: {
    isAvailable: () => ipcRenderer.invoke('jira:isAvailable') as Promise<boolean>,
    recheckAvailability: () => ipcRenderer.invoke('jira:recheckAvailability') as Promise<boolean>,
    getIssuesForBranch: (worktreePath: string, overrideBaseUrl?: string) =>
      ipcRenderer.invoke('jira:getIssuesForBranch', worktreePath, overrideBaseUrl),
    getIssueByKey: (key: string, overrideBaseUrl?: string) =>
      ipcRenderer.invoke('jira:getIssueByKey', key, overrideBaseUrl),
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
    openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url),
    showItemInFolder: (path: string) => ipcRenderer.invoke('shell:showItemInFolder', path),
    getInstalledApps: () => ipcRenderer.invoke('shell:getInstalledApps') as Promise<Array<{ id: string; name: string; icon: string | null }>>,
    openInApp: (appId: string, targetPath: string) => ipcRenderer.invoke('shell:openInApp', appId, targetPath),
    checkTool: (tool: string) => ipcRenderer.invoke('shell:checkTool', tool) as Promise<boolean>,
    checkGhAuth: () => ipcRenderer.invoke('shell:checkGhAuth') as Promise<boolean>,
    installTool: (key: string) => ipcRenderer.invoke('shell:installTool', key) as Promise<{ success: boolean }>,
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
    onDownloadProgress: (cb: (info: { percent: number }) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, info: { percent: number }) => cb(info)
      ipcRenderer.on('updater:download-progress', handler)
      return () => ipcRenderer.removeListener('updater:download-progress', handler)
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

  // Settings sync
  settings: {
    sync: (values: Record<string, unknown>) => ipcRenderer.invoke('settings:sync', values),
    getApiKey: () => ipcRenderer.invoke('settings:getApiKey'),
    getTerminalShell: () => ipcRenderer.invoke('settings:getTerminalShell'),
    getWorktreeStoragePath: () => ipcRenderer.invoke('settings:getWorktreeStoragePath'),
    getSystemPromptSuffix: () => ipcRenderer.invoke('settings:getSystemPromptSuffix'),
  },
}

export type ElectronAPI = typeof api

contextBridge.exposeInMainWorld('api', api)
