// Typed IPC wrappers — thin layer over window.api
const api = () => window.api

/** Strip Electron's "Error invoking remote method '...': Error: " prefix */
export function cleanIpcError(err: unknown, fallback = 'Unknown error'): string {
  const raw = err instanceof Error ? err.message : fallback
  return raw.replace(/^Error invoking remote method '[^']+': Error: /, '')
}

export const storage = {
  load: () => api().storage.load(),
  save: (data: unknown) => api().storage.save(data)
}

export const git = {
  getWorktrees: (repoPath: string) => api().git.getWorktrees(repoPath),
  addWorktree: (repoPath: string, branch: string, projectName: string, baseBranch?: string) =>
    api().git.addWorktree(repoPath, branch, projectName, baseBranch),
  removeWorktree: (repoPath: string, worktreePath: string) =>
    api().git.removeWorktree(repoPath, worktreePath),
  getBranches: (repoPath: string) => api().git.getBranches(repoPath),
  getStatus: (worktreePath: string) => api().git.getStatus(worktreePath),
  getDiff: (worktreePath: string) => api().git.getDiff(worktreePath),
  getFileDiff: (worktreePath: string, file: string, status: string, staged: boolean) =>
    api().git.getFileDiff(worktreePath, file, status, staged),
  getFileTree: (worktreePath: string, forceRefresh?: boolean) =>
    api().git.getFileTree(worktreePath, forceRefresh),
  invalidateFileTree: (worktreePath: string) => api().git.invalidateFileTree(worktreePath),
  invalidateTrackedFiles: (worktreePath: string) => api().git.invalidateTrackedFiles(worktreePath),
  readFile: (filePath: string) => api().git.readFile(filePath),
  readFileAsBase64: (filePath: string) =>
    api().git.readFileAsBase64(filePath) as Promise<{ base64: string | null; size: number } | null>,
  getFileSize: (filePath: string) =>
    api().git.getFileSize(filePath) as Promise<number>,
  writeFile: (filePath: string, content: string) => api().git.writeFile(filePath, content),
  getTrackingBranch: (worktreePath: string, branch: string) =>
    api().git.getTrackingBranch(worktreePath, branch),
  getRemoteBranches: (worktreePath: string, forceRefresh?: boolean) =>
    api().git.getRemoteBranches(worktreePath, forceRefresh) as Promise<{ branches: string[]; defaultBranch?: string }>,
  getRemoteUrl: (repoPath: string) =>
    api().git.getRemoteUrl(repoPath),
  getRemotes: (repoPath: string) =>
    api().git.getRemotes(repoPath),
  renameBranch: (worktreePath: string, oldName: string, newName: string) =>
    api().git.renameBranch(worktreePath, oldName, newName),
  setUpstream: (worktreePath: string, branch: string, upstream: string) =>
    api().git.setUpstream(worktreePath, branch, upstream),
  isBranchProtected: (worktreePath: string, branch: string) =>
    api().git.isBranchProtected(worktreePath, branch),
  cloneRepo: (url: string) => api().git.cloneRepo(url),
  stageFiles: (worktreePath: string, files: string[]) =>
    api().git.stageFiles(worktreePath, files),
  unstageFiles: (worktreePath: string, files: string[]) =>
    api().git.unstageFiles(worktreePath, files),
  discardChanges: (worktreePath: string, file: string, status: string, staged?: boolean) =>
    api().git.discardChanges(worktreePath, file, status, staged),
  commit: (worktreePath: string, message: string) =>
    api().git.commit(worktreePath, message),
  pull: (worktreePath: string, strategy?: 'rebase' | 'merge') => api().git.pull(worktreePath, strategy),
  push: (worktreePath: string) => api().git.push(worktreePath),
  getTrackedFiles: (worktreePath: string) =>
    api().git.getTrackedFiles(worktreePath) as Promise<string[]>,
  getGitUserConfig: (repoPath: string) =>
    api().git.getGitUserConfig(repoPath) as Promise<{
      global: { name: string; email: string }
      local: { name: string | null; email: string | null }
    }>,
  setGitUserConfig: (repoPath: string, name: string, email: string) =>
    api().git.setGitUserConfig(repoPath, name, email) as Promise<void>,
  clearGitUserConfig: (repoPath: string) =>
    api().git.clearGitUserConfig(repoPath) as Promise<void>,
  initRepo: (dirPath: string) =>
    api().git.initRepo(dirPath) as Promise<void>,
  isRepoRoot: (repoPath: string) =>
    api().git.isRepoRoot(repoPath) as Promise<boolean>,
  findChildRepos: (parentPath: string) =>
    api().git.findChildRepos(parentPath) as Promise<string[]>,
  createSnapshot: (worktreePath: string) =>
    api().git.createSnapshot(worktreePath) as Promise<string>,
  restoreSnapshot: (worktreePath: string, snapSha: string) =>
    api().git.restoreSnapshot(worktreePath, snapSha) as Promise<void>,
}

export const agent = {
  startSession: (sessionId: string, worktreeId: string, worktreePath: string, prompt: string, model: string, thinking: boolean, extendedContext: boolean, effortLevel: string, planMode: boolean, sessionName: string, images?: string[], additionalDirectories?: string[], linkedWorktreeContext?: string, connectedDeviceId?: string, mobileFramework?: string) =>
    api().agent.startSession(sessionId, worktreeId, worktreePath, prompt, model, thinking, extendedContext, effortLevel, planMode, sessionName, images, additionalDirectories, linkedWorktreeContext, connectedDeviceId, mobileFramework),
  sendMessage: (sessionId: string, message: string, sdkSessionId: string, cwd: string, model: string, extendedContext: boolean, effortLevel: string, planMode: boolean, sessionName: string, images?: string[], additionalDirectories?: string[], linkedWorktreeContext?: string, connectedDeviceId?: string, mobileFramework?: string, resumeSessionAt?: string) =>
    api().agent.sendMessage(sessionId, message, sdkSessionId, cwd, model, extendedContext, effortLevel, planMode, sessionName, images, additionalDirectories, linkedWorktreeContext, connectedDeviceId, mobileFramework, resumeSessionAt),
  updateSessionName: (sessionId: string, name: string) => api().agent.updateSessionName(sessionId, name),
  notify: (sessionId: string, type: 'done' | 'error' | 'waiting_input', sessionName?: string, errorMessage?: string, reason?: 'question' | 'plan_approval') =>
    api().agent.notify(sessionId, type, sessionName, errorMessage, reason),
  getSlashCommands: (cwd: string) => api().agent.getSlashCommands(cwd),
  answerToolInput: (sessionId: string, result: Record<string, unknown>) =>
    api().agent.answerToolInput(sessionId, result),
  answerElicitation: (sessionId: string, result: { action: string; content?: Record<string, unknown> }) =>
    api().agent.answerElicitation(sessionId, result),
  reAuth: () => api().agent.reAuth() as Promise<{ success: boolean }>,
  stopSession: (sessionId: string) => api().agent.stopSession(sessionId),
  closeSession: (sessionId: string) => api().agent.closeSession(sessionId),
  generateCommitMessage: (worktreePath: string) => api().agent.generateCommitMessage(worktreePath) as Promise<string>,
  generateSessionTitle: (userMessage: string, assistantSummary: string, currentTitle?: string) =>
    api().agent.generateSessionTitle(userMessage, assistantSummary, currentTitle) as Promise<string>,
  onEvent: (callback: (data: { sessionId: string; event: unknown }) => void) =>
    api().agent.onEvent(callback)
}

export const pty = {
  spawn: (cwd: string) => api().pty.spawn(cwd),
  write: (id: string, data: string) => api().pty.write(id, data),
  resize: (id: string, cols: number, rows: number) => api().pty.resize(id, cols, rows),
  kill: (id: string) => api().pty.kill(id),
  runScript: (cwd: string, command: string) => api().pty.runScript(cwd, command),
  readTerminalOutput: (worktreePath: string) => api().pty.readTerminalOutput(worktreePath),
  onData: (callback: (id: string, data: string) => void) => api().pty.onData(callback),
  onExit: (callback: (id: string, exitCode: number) => void) => api().pty.onExit(callback)
}

export const simulator = {
  listDevices: () => api().simulator.listDevices() as Promise<Array<{ id: string; name: string; platform: string; type: string; version: string; state: string; model: string }>>,
  checkCli: () => api().simulator.checkCli(),
  checkPlatformTools: () => api().simulator.checkPlatformTools() as Promise<{ xcode: boolean; androidSdk: boolean }>,
  boot: (deviceId: string) => api().simulator.boot(deviceId),
  shutdown: (deviceId: string) => api().simulator.shutdown(deviceId),
  createStreamSession: (deviceId: string, displayHeight?: number) =>
    api().simulator.createStreamSession(deviceId, displayHeight) as Promise<{ streamUrl: string; screenSize: { width: number; height: number } }>,
  gesture: (deviceId: string, actions: Record<string, unknown>[]) =>
    api().simulator.gesture(deviceId, actions) as Promise<string | null>,
  sendText: (deviceId: string, text: string) =>
    api().simulator.sendText(deviceId, text) as Promise<string | null>,
  pressButton: (deviceId: string, button: string) =>
    api().simulator.pressButton(deviceId, button) as Promise<string | null>,
  screenshot: (deviceId: string) =>
    api().simulator.screenshot(deviceId) as Promise<string | null>,
  getOrientation: (deviceId: string) =>
    api().simulator.getOrientation(deviceId) as Promise<string>,
  setOrientation: (deviceId: string, orientation: string) =>
    api().simulator.setOrientation(deviceId, orientation) as Promise<void>,
  getScreenSize: (deviceId: string) => api().simulator.getScreenSize(deviceId) as Promise<{ width: number; height: number }>,
  hideWindow: () => api().simulator.hideWindow() as Promise<void>,
  metroReload: () => api().simulator.metroReload() as Promise<void>,
  sendKeyCombo: (deviceId: string, platform: string, combo: string) =>
    api().simulator.sendKeyCombo(deviceId, platform, combo) as Promise<void>,
  flutterSignal: (signal: string) =>
    api().simulator.flutterSignal(signal) as Promise<void>,
}

export const windowCapture = {
  getSources: () => api().windowCapture.getSources() as Promise<Array<{ id: string; name: string; appName: string; thumbnailDataUrl: string }>>,
  checkPermission: () => api().windowCapture.checkPermission() as Promise<string>,
  openPermissionSettings: () => api().windowCapture.openPermissionSettings(),
  listAllWindows: () => api().windowCapture.listAllWindows() as Promise<Array<{ id: string; name: string }>>,
  selectSource: (sourceId: string) => api().windowCapture.selectSource(sourceId),
  tap: (sourceId: string, relX: number, relY: number) =>
    api().windowCapture.tap(sourceId, relX, relY) as Promise<string>,
}

export const github = {
  getPrStatus: (worktreePath: string, forceRefresh?: boolean) =>
    api().github.getPrStatus(worktreePath, forceRefresh),
  getChecks: (worktreePath: string, forceRefresh?: boolean) =>
    api().github.getChecks(worktreePath, forceRefresh),
  getDeployments: (worktreePath: string, forceRefresh?: boolean) =>
    api().github.getDeployments(worktreePath, forceRefresh),
  getOwnerAvatarUrl: (cwd: string): Promise<string> =>
    api().github.getOwnerAvatarUrl(cwd),
  getGitSyncStatus: (worktreePath: string, baseBranch: string, forceRefresh?: boolean) =>
    api().github.getGitSyncStatus(worktreePath, baseBranch, forceRefresh),
  getCheckRunLog: (worktreePath: string, checkUrl: string) =>
    api().github.getCheckRunLog(worktreePath, checkUrl),
  openCheckLog: (worktreePath: string, checkUrl: string, checkName: string) =>
    api().github.openCheckLog(worktreePath, checkUrl, checkName),
  mergePr: (worktreePath: string, strategy: 'merge' | 'squash' | 'rebase') =>
    api().github.mergePr(worktreePath, strategy),
  markPrReady: (worktreePath: string) =>
    api().github.markPrReady(worktreePath),
  startDeviceFlow: () =>
    api().github.startDeviceFlow(),
  cancelDeviceFlow: () =>
    api().github.cancelDeviceFlow(),
  feedGhToken: (token: string) =>
    api().github.feedGhToken(token),
  onDeviceFlowEvent: (callback: (event: { status: string; token?: string; error?: string }) => void) =>
    api().github.onDeviceFlowEvent(callback),
}

export const sessions = {
  save: (data: unknown) => api().sessions.save(data),
  loadAll: () => api().sessions.loadAll(),
  delete: (sessionId: string) => api().sessions.delete(sessionId),
  deleteByWorktree: (worktreeId: string) => api().sessions.deleteByWorktree(worktreeId),
  purgeOrphaned: (activeWorktreeIds: string[]) => api().sessions.purgeOrphaned(activeWorktreeIds)
}

export const shell = {
  openExternal: (url: string) => api().shell.openExternal(url),
  showItemInFolder: (path: string) => api().shell.showItemInFolder(path),
  getInstalledApps: () => api().shell.getInstalledApps(),
  openInApp: (appId: string, targetPath: string) => api().shell.openInApp(appId, targetPath),
  checkTool: (tool: string) => api().shell.checkTool(tool),
  checkGhAuth: () => api().shell.checkGhAuth(),
  installTool: (key: string) => api().shell.installTool(key),
}

export const scripts = {
  detect: (projectPath: string, forceRefresh?: boolean) => api().scripts.detect(projectPath, forceRefresh) as Promise<import('@/types').RunCommand[]>,
}

export type { CreateFailureReason as CreateTemplateFailureReason, CreateTemplateResult, TemplateLogEntry } from '@shared/templates'
import type { TemplateKind, CreateTemplateArgs, CreateTemplateResult, TemplateLogEntry } from '@shared/templates'

export const templates = {
  create: (kind: TemplateKind, args: CreateTemplateArgs) =>
    api().templates.create(kind, args) as Promise<CreateTemplateResult>,
  cancel: () => api().templates.cancel() as Promise<boolean>,
  /** Subscribe to per-line stdout/stderr from the active scaffold. Returns unsubscribe. */
  onLog: (handler: (entry: TemplateLogEntry) => void): (() => void) =>
    (api().templates.onLog as (h: (e: TemplateLogEntry) => void) => () => void)(handler),
}

export const files = {
  getIgnored: (worktreePath: string, patterns?: string[]) => api().files.getIgnored(worktreePath, patterns),
  getFileInfo: (worktreePath: string, paths: string[]) => api().files.getFileInfo(worktreePath, paths),
  copyToWorktree: (src: string, dest: string, paths: string[]) => api().files.copyToWorktree(src, dest, paths),
  toRelativePaths: (basePath: string, absolutePaths: string[]) => api().files.toRelativePaths(basePath, absolutePaths),
  pathExists: (dirPath: string) => api().files.pathExists(dirPath) as Promise<boolean>,
  detectPlatform: (repoPath: string) => api().files.detectPlatform(repoPath) as Promise<import('@/types').ProjectPlatform>,
  detectFramework: (repoPath: string) => api().files.detectFramework(repoPath) as Promise<import('@/types').MobileFramework>,
}

export const dialog = {
  openDirectory: () => api().dialog.openDirectory(),
  openFiles: (defaultPath?: string) => api().dialog.openFiles(defaultPath),
}

export const claudeCli = {
  detectPath: () => api().claudeCli.detectPath(),
}

export const appWindow = {
  setZoomFactor: (factor: number) => api().window.setZoomFactor(factor),
  closeWindow: () => api().menu.closeWindow(),
}

export const dock = {
  setBadgeCount: (count: number) => api().dock.setBadgeCount(count),
}

export const claudeConfig = {
  getPermissions: () => api().claudeConfig.getPermissions() as Promise<{ allow: string[]; deny: string[] }>,
  setPermissions: (perms: { allow: string[]; deny: string[] }) => api().claudeConfig.setPermissions(perms),
  getProjectPermissions: (projectPath: string) => api().claudeConfig.getProjectPermissions(projectPath) as Promise<{ allow: string[]; deny: string[] }>,
  setProjectPermissions: (projectPath: string, perms: { allow: string[]; deny: string[] }) =>
    api().claudeConfig.setProjectPermissions(projectPath, perms),
  getHooks: () => api().claudeConfig.getHooks() as Promise<Record<string, Array<{ hooks: Array<{ type: string; command: string }> }>>>,
  setHooks: (hooks: Record<string, unknown>) => api().claudeConfig.setHooks(hooks),
  getGlobalInstructions: () => api().claudeConfig.getGlobalInstructions() as Promise<string>,
  setGlobalInstructions: (content: string) => api().claudeConfig.setGlobalInstructions(content),
  getProjectInstructions: (projectPath: string) => api().claudeConfig.getProjectInstructions(projectPath) as Promise<string>,
  setProjectInstructions: (projectPath: string, content: string) =>
    api().claudeConfig.setProjectInstructions(projectPath, content),
  getPlugins: () => api().claudeConfig.getPlugins() as Promise<Array<{ id: string; name: string; version: string; scope: string; enabled: boolean }>>,
  setPluginEnabled: (pluginId: string, enabled: boolean) => api().claudeConfig.setPluginEnabled(pluginId, enabled),
  getSkills: (projectPath?: string) =>
    api().claudeConfig.getSkills(projectPath) as Promise<Array<{ name: string; description: string; path: string; scope: 'global' | 'project' }>>,
  getSkillDetail: (skillPath: string) =>
    api().claudeConfig.getSkillDetail(skillPath) as Promise<{
      name: string; description: string; argumentHint: string
      disableModelInvocation: boolean; allowedTools: string; body: string; additionalFiles: string[]
    }>,
  setSkillDetail: (skillPath: string, detail: {
    name: string; description: string; argumentHint: string
    disableModelInvocation: boolean; allowedTools: string; body: string; additionalFiles: string[]
  }) => api().claudeConfig.setSkillDetail(skillPath, detail as unknown as Record<string, unknown>),
  createSkill: (scope: string, name: string, description: string, projectPath?: string) =>
    api().claudeConfig.createSkill(scope, name, description, projectPath) as Promise<{ name: string; description: string; path: string; scope: 'global' | 'project' }>,
  deleteSkill: (skillPath: string) => api().claudeConfig.deleteSkill(skillPath),
  getMcpServers: () => api().claudeConfig.getMcpServers() as Promise<import('@/types').McpServerEntry[]>,
  setMcpServers: (servers: import('@/types').McpServerEntry[]) => api().claudeConfig.setMcpServers(servers as unknown[]),
  getProjectMcpServers: (projectPath: string) =>
    api().claudeConfig.getProjectMcpServers(projectPath) as Promise<import('@/types').McpServerEntry[]>,
  getPluginMcpServers: () =>
    api().claudeConfig.getPluginMcpServers() as Promise<import('@/types').McpServerEntry[]>,
  checkMcpHealth: (servers: Array<{ name: string; config: import('@/types').McpServerConfig }>) =>
    api().claudeConfig.checkMcpHealth(servers as Array<{ name: string; config: unknown }>) as Promise<import('@/types').McpHealthResult[]>,
  authenticateMcpServer: (serverName: string, serverConfig: import('@/types').McpServerConfig) =>
    api().claudeConfig.authenticateMcpServer(serverName, serverConfig) as Promise<{ success: boolean; error?: string }>,
}

export const settings = {
  sync: (values: Record<string, unknown>) => api().settings.sync(values),
  getApiKey: () => api().settings.getApiKey(),
  getTerminalShell: () => api().settings.getTerminalShell(),
  getWorktreeStoragePath: () => api().settings.getWorktreeStoragePath(),
  getSystemPromptSuffix: () => api().settings.getSystemPromptSuffix(),
}

export const notes = {
  load: (worktreeId: string) => api().notes.load(worktreeId),
  save: (worktreeId: string, content: string) => api().notes.save(worktreeId, content),
  delete: (worktreeId: string) => api().notes.delete(worktreeId),
}

export const jira = {
  isAvailable: () => api().jira.isAvailable(),
  recheckAvailability: () => api().jira.recheckAvailability() as Promise<boolean>,
  getIssuesForBranch: (worktreePath: string, overrideBaseUrl?: string) =>
    api().jira.getIssuesForBranch(worktreePath, overrideBaseUrl) as Promise<import('@/types').JiraResult>,
  getIssueByKey: (key: string, overrideBaseUrl?: string) =>
    api().jira.getIssueByKey(key, overrideBaseUrl) as Promise<import('@/types').JiraIssue | null>,
}

export const lsp = {
  detectServers: (projectPath: string, userConfigs: import('@/types').LspServerConfig[]) =>
    api().lsp.detectServers(projectPath, userConfigs) as Promise<import('@/types').LspDetectedServer[]>,
  detectServersForFile: (filePath: string, boundary: string, userConfigs: import('@/types').LspServerConfig[] = []) =>
    (api().lsp as unknown as { detectServersForFile: (f: string, b: string, c: unknown[]) => Promise<unknown> })
      .detectServersForFile(filePath, boundary, userConfigs) as Promise<import('@/types').LspDetectedServer[]>,
  getStatus: (projectRoot: string) =>
    api().lsp.getStatus(projectRoot) as Promise<import('@/types').LspServerHandle[]>,
  startServer: (projectRoot: string, configId: string, userConfigs: import('@/types').LspServerConfig[]) =>
    api().lsp.startServer(projectRoot, configId, userConfigs) as Promise<void>,
  openFile: (projectRoot: string, filePath: string, content: string, languageId: string) =>
    api().lsp.openFile(projectRoot, filePath, content, languageId) as Promise<void>,
  closeFile: (projectRoot: string, filePath: string) =>
    api().lsp.closeFile(projectRoot, filePath) as Promise<void>,
  changeFile: (projectRoot: string, filePath: string, content: string) =>
    api().lsp.changeFile(projectRoot, filePath, content) as Promise<void>,
  hover: (projectRoot: string, filePath: string, line: number, col: number) =>
    api().lsp.hover(projectRoot, filePath, line, col) as Promise<import('@/types').LspHoverResult | null>,
  definition: (projectRoot: string, filePath: string, line: number, col: number) =>
    api().lsp.definition(projectRoot, filePath, line, col) as Promise<import('@/types').LspLocation[] | null>,
  getDiagnostics: (projectRoot: string, filePath: string) =>
    api().lsp.getDiagnostics(projectRoot, filePath) as Promise<import('@/types').LspDiagnostic[]>,
  rename: (projectRoot: string, filePath: string, line: number, col: number, newName: string) =>
    api().lsp.rename(projectRoot, filePath, line, col, newName) as Promise<import('@/types').LspRenameResult | null>,
  shutdown: (projectRoot: string) =>
    api().lsp.shutdown(projectRoot) as Promise<void>,
  installServer: (configId: string, userConfigs: import('@/types').LspServerConfig[]) =>
    (api().lsp as unknown as { installServer: (id: string, c: unknown[]) => Promise<void> }).installServer(configId, userConfigs) as Promise<void>,
  onStatusUpdate: (cb: (update: { configId: string; languageId: string; projectRoot: string; status: import('@/types').LspServerStatus; error?: string }) => void) =>
    api().lsp.onStatusUpdate(cb as (update: unknown) => void) as () => void,
  onDiagnosticsUpdate: (cb: (update: { filePath: string; diagnostics: import('@/types').LspDiagnostic[] }) => void) =>
    api().lsp.onDiagnosticsUpdate(cb as (update: unknown) => void) as () => void,
}
