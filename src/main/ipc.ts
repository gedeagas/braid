import { logger } from './lib/logger'
import { ipcMain, dialog, shell, app, nativeImage, BrowserWindow } from 'electron'
import { existsSync } from 'fs'
import { writeFile } from 'fs/promises'
import { execFile } from 'child_process'
import { tmpdir, homedir } from 'os'
import { join } from 'path'
import { storageService } from './services/storage'
import { gitService } from './services/git'
import { agentService } from './services/agent'
import { ptyService } from './services/pty'
import { githubService } from './services/github'
import { sessionStorageService, PersistedSession } from './services/sessionStorage'
import { filesService } from './services/files'
import { simulatorService } from './services/simulator'
import { detectScripts } from './services/scriptDetector'
import { windowCaptureService } from './services/windowCapture'
import { claudeConfigService, ClaudePermissions, ClaudeHookConfig, SkillDetail, McpServerEntry, McpServerConfig } from './services/claudeConfig'
import { notesService } from './services/notes'
import { lspService, LspServerConfig } from './services/lsp'
import { jiraService } from './services/jira'
import { githubAuthService } from './services/githubAuth'
import { resolveCliPath } from './services/claudePath'
import { downloadUpdate, installUpdate, checkForUpdates } from './services/autoUpdate'

// In-process settings cache — renderer pushes values here so main-process
// services (agent.ts, pty.ts) can read them synchronously.
export const mainSettings = {
  apiKey: null as string | null,
  terminalShell: '',
  worktreeStoragePath: '',
  systemPromptSuffix: '',
  claudeCodeExecutablePath: '',
  notifyOnDone: true,
  notifyOnError: true,
  notifyOnWaitingInput: true,
  notificationSound: true,
  /** When true, all non-denied tools run without a confirmation prompt. */
  bypassPermissions: true,
}

export function registerIpcHandlers(): void {
  // Storage
  ipcMain.handle('storage:load', () => storageService.load())
  ipcMain.handle('storage:save', (_e, data) => storageService.save(data))

  // Git
  ipcMain.handle('git:getWorktrees', (_e, repoPath: string) => gitService.getWorktrees(repoPath))
  ipcMain.handle('git:addWorktree', (_e, repoPath: string, branch: string, projectName: string, baseBranch?: string) =>
    gitService.addWorktree(repoPath, branch, projectName, baseBranch, mainSettings.worktreeStoragePath || undefined)
  )
  ipcMain.handle('git:removeWorktree', (_e, repoPath: string, worktreePath: string, worktreeId?: string) => {
    if (worktreeId) notesService.delete(worktreeId)
    return gitService.removeWorktree(repoPath, worktreePath)
  })
  ipcMain.handle('git:getBranches', (_e, repoPath: string) => gitService.getBranches(repoPath))
  ipcMain.handle('git:getStatus', (_e, worktreePath: string) => gitService.getStatus(worktreePath))
  ipcMain.handle('git:getDiff', (_e, worktreePath: string) => gitService.getDiff(worktreePath))
  ipcMain.handle('git:getFileDiff', (_e, worktreePath: string, file: string, status: string, staged: boolean) =>
    gitService.getFileDiff(worktreePath, file, status, staged)
  )
  ipcMain.handle('git:getFileTree', (_e, worktreePath: string, _subPath?: string, forceRefresh?: boolean) =>
    gitService.getFileTree(worktreePath, '', forceRefresh))
  ipcMain.handle('git:invalidateFileTree', (_e, worktreePath: string) => gitService.invalidateFileTree(worktreePath))
  ipcMain.handle('git:invalidateTrackedFiles', (_e, worktreePath: string) => gitService.invalidateTrackedFiles(worktreePath))
  ipcMain.handle('git:readFile', (_e, filePath: string) => gitService.readFile(filePath))
  ipcMain.handle('git:readFileAsBase64', (_e, filePath: string) => gitService.readFileAsBase64(filePath))
  ipcMain.handle('git:getFileSize', (_e, filePath: string) => gitService.getFileSize(filePath))
  ipcMain.handle('git:writeFile', (_e, filePath: string, content: string) => gitService.writeFile(filePath, content))
  ipcMain.handle('git:getTrackingBranch', (_e, worktreePath: string, branch: string) =>
    gitService.getTrackingBranch(worktreePath, branch)
  )
  ipcMain.handle('git:getRemoteBranches', (_e, worktreePath: string, forceRefresh?: boolean) =>
    gitService.getRemoteBranches(worktreePath, forceRefresh)
  )
  ipcMain.handle('git:getRemoteUrl', (_e, repoPath: string) =>
    gitService.getRemoteUrl(repoPath)
  )
  ipcMain.handle('git:renameBranch', (_e, worktreePath: string, oldName: string, newName: string) =>
    gitService.renameBranch(worktreePath, oldName, newName)
  )
  ipcMain.handle('git:setUpstream', (_e, worktreePath: string, branch: string, upstream: string) =>
    gitService.setUpstream(worktreePath, branch, upstream)
  )
  ipcMain.handle('git:isBranchProtected', (_e, worktreePath: string, branch: string) =>
    gitService.isBranchProtected(worktreePath, branch)
  )
  ipcMain.handle('git:cloneRepo', (_e, url: string) => gitService.cloneRepo(url, mainSettings.worktreeStoragePath || undefined))
  ipcMain.handle('git:stageFiles', (_e, worktreePath: string, files: string[]) =>
    gitService.stageFiles(worktreePath, files)
  )
  ipcMain.handle('git:unstageFiles', (_e, worktreePath: string, files: string[]) =>
    gitService.unstageFiles(worktreePath, files)
  )
  ipcMain.handle('git:discardChanges', (_e, worktreePath: string, file: string, status: string, staged?: boolean) =>
    gitService.discardChanges(worktreePath, file, status, staged)
  )
  ipcMain.handle('git:commit', (_e, worktreePath: string, message: string) =>
    gitService.commit(worktreePath, message)
  )
  ipcMain.handle('git:pull', (_e, worktreePath: string, strategy?: string) =>
    gitService.pull(worktreePath, strategy as 'rebase' | 'merge' | undefined)
  )
  ipcMain.handle('git:push', (_e, worktreePath: string) => gitService.push(worktreePath))
  ipcMain.handle('git:getTrackedFiles', (_e, worktreePath: string) => gitService.getTrackedFiles(worktreePath))
  ipcMain.handle('git:getRemotes', (_e, repoPath: string) => gitService.getRemotes(repoPath))
  ipcMain.handle('git:getGitUserConfig', (_e, repoPath: string) => gitService.getGitUserConfig(repoPath))
  ipcMain.handle('git:setGitUserConfig', (_e, repoPath: string, name: string, email: string) =>
    gitService.setGitUserConfig(repoPath, name, email)
  )
  ipcMain.handle('git:clearGitUserConfig', (_e, repoPath: string) => gitService.clearGitUserConfig(repoPath))
  ipcMain.handle('git:initRepo', (_e, dirPath: string) => gitService.initRepo(dirPath))
  ipcMain.handle('git:isRepoRoot', (_e, repoPath: string) => gitService.isRepoRoot(repoPath))
  ipcMain.handle('git:findChildRepos', (_e, parentPath: string) => gitService.findChildRepos(parentPath))

  // Agent
  ipcMain.handle('agent:startSession', (_e, sessionId: string, worktreeId: string, worktreePath: string, prompt: string, model: string, thinking: boolean, planMode: boolean, sessionName: string, images?: string[], additionalDirectories?: string[], linkedWorktreeContext?: string, connectedDeviceId?: string, mobileFramework?: string) =>
    agentService.startSession(sessionId, worktreeId, worktreePath, prompt, model, thinking, planMode, sessionName, images, additionalDirectories, linkedWorktreeContext, connectedDeviceId, mobileFramework)
  )
  ipcMain.handle('agent:sendMessage', (_e, sessionId: string, message: string, sdkSessionId: string, cwd: string, model: string, planMode: boolean, sessionName: string, images?: string[], additionalDirectories?: string[], linkedWorktreeContext?: string, connectedDeviceId?: string, mobileFramework?: string) =>
    agentService.sendMessage(sessionId, message, sdkSessionId, cwd, model, planMode, sessionName, images, additionalDirectories, linkedWorktreeContext, connectedDeviceId, mobileFramework)
  )
  ipcMain.handle('agent:updateSessionName', (_e, sessionId: string, name: string) =>
    agentService.updateSessionName(sessionId, name)
  )
  ipcMain.handle('agent:notify', (_e, sessionId: string, type: 'done' | 'error' | 'waiting_input', sessionName?: string, errorMessage?: string, reason?: 'question' | 'plan_approval') =>
    agentService.notify(sessionId, type, sessionName, errorMessage, reason)
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

  // PTY
  ipcMain.handle('pty:spawn', (_e, cwd: string) => ptyService.spawn(cwd))
  ipcMain.on('pty:write', (_e, id: string, data: string) => ptyService.write(id, data))
  ipcMain.on('pty:resize', (_e, id: string, cols: number, rows: number) => ptyService.resize(id, cols, rows))

  // Dock badge
  ipcMain.on('dock:setBadgeCount', (_e, count: number) => {
    if (process.platform === 'darwin' && app.dock) {
      const safe = Math.max(0, Math.floor(count) || 0)
      app.dock.setBadge(safe > 0 ? String(safe) : '')
    }
  })
  ipcMain.handle('pty:kill', (_e, id: string) => ptyService.kill(id))
  ipcMain.handle('pty:runScript', (_e, cwd: string, command: string) => ptyService.runScript(cwd, command))
  ipcMain.handle('pty:readTerminalOutput', (_e, worktreePath: string) => ptyService.readTerminalOutput(worktreePath))

  // GitHub
  ipcMain.handle('github:getPrStatus', (_e, worktreePath: string, forceRefresh?: boolean) =>
    githubService.getPrStatus(worktreePath, forceRefresh))
  ipcMain.handle('github:getChecks', (_e, worktreePath: string, forceRefresh?: boolean) =>
    githubService.getChecks(worktreePath, forceRefresh))
  ipcMain.handle('github:getDeployments', (_e, worktreePath: string, forceRefresh?: boolean) =>
    githubService.getDeployments(worktreePath, forceRefresh))
  ipcMain.handle('github:getOwnerAvatarUrl', (_e, cwd: string) =>
    githubService.getOwnerAvatarUrl(cwd))
  ipcMain.handle('github:getGitSyncStatus', (_e, worktreePath: string, baseBranch: string, forceRefresh?: boolean) =>
    githubService.getGitSyncStatus(worktreePath, baseBranch, forceRefresh)
  )
  ipcMain.handle('github:mergePr', (_e, worktreePath: string, strategy: string) =>
    githubService.mergePr(worktreePath, strategy as 'merge' | 'squash' | 'rebase')
  )
  ipcMain.handle('github:markPrReady', (_e, worktreePath: string) =>
    githubService.markPrReady(worktreePath)
  )
  ipcMain.handle('github:getCheckRunLog', (_e, worktreePath: string, checkUrl: string) =>
    githubService.getCheckRunLog(worktreePath, checkUrl)
  )
  ipcMain.handle('github:openCheckLog', async (_e, worktreePath: string, checkUrl: string, checkName: string) => {
    const log = await githubService.getCheckRunLog(worktreePath, checkUrl)
    const safe = checkName.replace(/[^a-zA-Z0-9-_]/g, '_')
    const tmpPath = join(tmpdir(), `ci-log-${safe}.log`)
    await writeFile(tmpPath, log || '(no log output)', 'utf8')
    return tmpPath
  })

  // GitHub Device Flow OAuth
  ipcMain.handle('github:startDeviceFlow', async () => {
    const code = await githubAuthService.requestDeviceCode()
    githubAuthService.startPolling(code.device_code, code.interval, code.expires_in)
    return { userCode: code.user_code, verificationUri: code.verification_uri, expiresIn: code.expires_in }
  })
  ipcMain.handle('github:cancelDeviceFlow', () => githubAuthService.cancel())
  ipcMain.handle('github:feedGhToken', async (_e, token: string) => ({
    success: await githubAuthService.feedTokenToGh(token),
  }))

  // Jira (optional — only available if acli is installed)
  ipcMain.handle('jira:isAvailable', () => jiraService.isAvailable())
  ipcMain.handle('jira:recheckAvailability', () => jiraService.recheckAvailability())
  ipcMain.handle('jira:getIssuesForBranch', (_e, worktreePath: string, overrideBaseUrl?: string) =>
    jiraService.getIssuesForBranch(worktreePath, overrideBaseUrl)
  )
  ipcMain.handle('jira:getIssueByKey', (_e, key: string, overrideBaseUrl?: string) =>
    jiraService.getIssueByKey(key, overrideBaseUrl)
  )

  // Sessions
  ipcMain.handle('sessions:save', (_e, data: PersistedSession) => sessionStorageService.saveSession(data))
  ipcMain.handle('sessions:loadAll', () => sessionStorageService.loadAllSessions())
  ipcMain.handle('sessions:delete', (_e, sessionId: string) => sessionStorageService.deleteSession(sessionId))
  ipcMain.handle('sessions:deleteByWorktree', (_e, worktreeId: string) => sessionStorageService.deleteSessionsByWorktree(worktreeId))
  ipcMain.handle('sessions:purgeOrphaned', (_e, activeWorktreeIds: string[]) => sessionStorageService.purgeOrphaned(new Set(activeWorktreeIds)))

  // Shell
  ipcMain.handle('shell:openExternal', (_e, url: string) => shell.openExternal(url))
  ipcMain.handle('shell:showItemInFolder', (_e, fullPath: string) => shell.showItemInFolder(fullPath))

  // Use a login shell so Homebrew, NVM, and other PATH managers are visible.
  // macOS GUI apps launch with a stripped PATH — running `which` directly would
  // miss any tool not in /usr/bin:/bin:/usr/sbin:/sbin.
  ipcMain.handle('shell:checkTool', (_e, tool: string) => {
    if (!/^[a-zA-Z0-9-]+$/.test(tool)) return false
    const userShell = process.env.SHELL || '/bin/zsh'
    return new Promise<boolean>((resolve) => {
      execFile(userShell, ['-l', '-c', `which ${tool} > /dev/null 2>&1`], { timeout: 5000 }, (err) => resolve(!err))
    })
  })

  ipcMain.handle('shell:checkGhAuth', () => {
    const userShell = process.env.SHELL || '/bin/zsh'
    return new Promise<boolean>((resolve) => {
      execFile(userShell, ['-l', '-c', 'gh auth status > /dev/null 2>&1'], { timeout: 8000 }, (err) => resolve(!err))
    })
  })

  // Runs a known install command for a given check key via the user's login shell.
  // Returns { success: boolean } — success means the command exited 0.
  // The renderer re-checks the tool immediately after regardless of the result.
  ipcMain.handle('shell:installTool', (_e, key: string) => {
    const userShell = process.env.SHELL || '/bin/zsh'

    // For brew-based tools: bail early if brew isn't present so the UI
    // surfaces the docs link instead of leaving the user stuck in a retry loop.
    const brewInstalls: Record<string, string> = { gh: 'gh', mobilecli: 'nicklama/tap/mobilecli' }
    if (key in brewInstalls) {
      const formula = brewInstalls[key]
      return new Promise<{ success: boolean }>((resolve) => {
        execFile(userShell, ['-l', '-c', `which brew > /dev/null 2>&1 && brew install ${formula}`], { timeout: 180_000 }, (err) => resolve({ success: !err }))
      })
    }

    const cmds: Record<string, string> = {
      git: 'xcode-select --install',
      // Official Claude Code installer — handles PATH setup, shell completions, etc.
      claude: 'curl -fsSL https://claude.ai/install.sh | bash',
      acli: 'npm install -g @atlassian/acli',
    }

    // gh auth is now handled via Device Flow (github:startDeviceFlow IPC)
    if (key === 'ghAuth') return { success: false }

    const cmd = cmds[key]
    if (!cmd) return { success: false }
    const timeout = 180_000
    return new Promise<{ success: boolean }>((resolve) => {
      execFile(userShell, ['-l', '-c', cmd], { timeout }, (err) => resolve({ success: !err }))
    })
  })

  // Re-authenticate with Claude Code CLI (OAuth flow — opens browser)
  ipcMain.handle('agent:reAuth', () => {
    const userShell = process.env.SHELL || '/bin/zsh'
    return new Promise<{ success: boolean }>((resolve) => {
      execFile(userShell, ['-l', '-c', 'claude auth login --web'], { timeout: 300_000 }, (err) => {
        resolve({ success: !err })
      })
    })
  })

  // App registry — keyed by bundle identifier for reliable discovery
  const APP_REGISTRY = [
    // File manager
    { id: 'finder',         name: 'Finder',          bundleId: 'com.apple.finder' },
    // Editors & IDEs
    { id: 'cursor',         name: 'Cursor',           bundleId: 'com.todesktop.230313mzl4w4u92' },
    { id: 'vscode',         name: 'VS Code',          bundleId: 'com.microsoft.VSCode' },
    { id: 'windsurf',       name: 'Windsurf',         bundleId: 'com.codeium.windsurf' },
    { id: 'zed',            name: 'Zed',              bundleId: 'dev.zed.Zed' },
    { id: 'sublime-text',   name: 'Sublime Text',     bundleId: 'com.sublimetext.4' },
    { id: 'nova',           name: 'Nova',             bundleId: 'com.panic.Nova' },
    { id: 'xcode',          name: 'Xcode',            bundleId: 'com.apple.dt.Xcode' },
    { id: 'intellij',       name: 'IntelliJ IDEA',    bundleId: 'com.jetbrains.intellij' },
    { id: 'webstorm',       name: 'WebStorm',         bundleId: 'com.jetbrains.WebStorm' },
    { id: 'android-studio', name: 'Android Studio',   bundleId: 'com.google.android.studio' },
    // Terminals
    { id: 'terminal',       name: 'Terminal',         bundleId: 'com.apple.Terminal' },
    { id: 'iterm2',         name: 'iTerm2',           bundleId: 'com.googlecode.iterm2' },
    { id: 'ghostty',        name: 'Ghostty',          bundleId: 'com.mitchellh.ghostty' },
    { id: 'warp',           name: 'Warp',             bundleId: 'dev.warp.Warp-Stable' },
    { id: 'kitty',          name: 'Kitty',            bundleId: 'net.kovidgoyal.kitty' },
    { id: 'alacritty',      name: 'Alacritty',        bundleId: 'org.alacritty' },
    { id: 'wezterm',        name: 'WezTerm',          bundleId: 'org.wezfurlong.wezterm' },
    // Git clients
    { id: 'github-desktop', name: 'GitHub Desktop',   bundleId: 'com.github.GitHubClient' },
    { id: 'tower',          name: 'Tower',            bundleId: 'com.fournova.Tower3' },
    { id: 'fork',           name: 'Fork',             bundleId: 'com.DanPristupov.Fork' },
  ]

  const bundleIdForApp: Record<string, string> = Object.fromEntries(
    APP_REGISTRY.map((a) => [a.id, a.bundleId])
  )

  // Find .app path by bundle identifier using Spotlight index
  function findAppByBundleId(bundleId: string): Promise<string | null> {
    return new Promise((resolve) => {
      execFile(
        'mdfind',
        [`kMDItemCFBundleIdentifier == '${bundleId}'`, '-onlyin', '/'],
        { timeout: 5_000 },
        (err, stdout) => {
          if (err || !stdout.trim()) return resolve(null)
          resolve(stdout.trim().split('\n')[0])
        }
      )
    })
  }

  ipcMain.handle('shell:getInstalledApps', async () => {
    const resolved = await Promise.all(
      APP_REGISTRY.map(async ({ id, name, bundleId }) => {
        const appPath = await findAppByBundleId(bundleId)
        if (!appPath) {
          logger.debug(`[Shell] App not found: ${id} (${bundleId})`)
          return null
        }
        try {
          const thumbnail = await nativeImage.createThumbnailFromPath(appPath, { width: 32, height: 32 })
          const dataUrl = thumbnail.toDataURL()
          return { id, name, icon: dataUrl }
        } catch (err) {
          logger.warn(`[Shell] Icon fetch failed for ${id} at ${appPath}:`, err)
          return { id, name, icon: null }
        }
      })
    )
    return resolved.filter(Boolean) as Array<{ id: string; name: string; icon: string | null }>
  })

  ipcMain.handle('shell:openInApp', (_e, appId: string, targetPath: string) => {
    if (appId === 'finder') return shell.showItemInFolder(targetPath)
    const bundleId = bundleIdForApp[appId]
    if (bundleId) {
      execFile('open', ['-b', bundleId, targetPath], (err) => {
        if (err) logger.error(`[Shell] Failed to open ${appId}:`, err.message)
      })
    }
  })

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

  // Scripts
  ipcMain.handle('scripts:detect', (_e, projectPath: string, forceRefresh?: boolean) => detectScripts(projectPath, forceRefresh))

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

  // Claude CLI detection — delegates to the single source of truth
  ipcMain.handle('claude:detectCliPath', (): string | null => resolveCliPath() ?? null)

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
    Object.assign(mainSettings, values)
  })
  ipcMain.handle('settings:getApiKey', () => mainSettings.apiKey)
  ipcMain.handle('settings:getTerminalShell', () => mainSettings.terminalShell)
  ipcMain.handle('settings:getWorktreeStoragePath', () => mainSettings.worktreeStoragePath)
  ipcMain.handle('settings:getSystemPromptSuffix', () => mainSettings.systemPromptSuffix)

  // Claude Config
  ipcMain.handle('claudeConfig:getPermissions', () => claudeConfigService.getPermissions())
  ipcMain.handle('claudeConfig:setPermissions', (_e, perms: ClaudePermissions) => claudeConfigService.setPermissions(perms))
  ipcMain.handle('claudeConfig:getProjectPermissions', (_e, projectPath: string) => claudeConfigService.getProjectPermissions(projectPath))
  ipcMain.handle('claudeConfig:setProjectPermissions', (_e, projectPath: string, perms: ClaudePermissions) =>
    claudeConfigService.setProjectPermissions(projectPath, perms)
  )
  ipcMain.handle('claudeConfig:getHooks', () => claudeConfigService.getHooks())
  ipcMain.handle('claudeConfig:setHooks', (_e, hooks: Record<string, ClaudeHookConfig[]>) => claudeConfigService.setHooks(hooks))
  ipcMain.handle('claudeConfig:getGlobalInstructions', () => claudeConfigService.getGlobalInstructions())
  ipcMain.handle('claudeConfig:setGlobalInstructions', (_e, content: string) => claudeConfigService.setGlobalInstructions(content))
  ipcMain.handle('claudeConfig:getProjectInstructions', (_e, projectPath: string) => claudeConfigService.getProjectInstructions(projectPath))
  ipcMain.handle('claudeConfig:setProjectInstructions', (_e, projectPath: string, content: string) =>
    claudeConfigService.setProjectInstructions(projectPath, content)
  )
  ipcMain.handle('claudeConfig:getPlugins', () => claudeConfigService.getPlugins())
  ipcMain.handle('claudeConfig:setPluginEnabled', (_e, pluginId: string, enabled: boolean) => claudeConfigService.setPluginEnabled(pluginId, enabled))
  ipcMain.handle('claudeConfig:getSkills', (_e, projectPath?: string) => claudeConfigService.getSkills(projectPath))
  ipcMain.handle('claudeConfig:getSkillDetail', (_e, skillPath: string) => claudeConfigService.getSkillDetail(skillPath))
  ipcMain.handle('claudeConfig:setSkillDetail', (_e, skillPath: string, detail: SkillDetail) => claudeConfigService.setSkillDetail(skillPath, detail))
  ipcMain.handle('claudeConfig:createSkill', (_e, scope: string, name: string, description: string, projectPath?: string) =>
    claudeConfigService.createSkill(scope as 'global' | 'project', name, description, projectPath)
  )
  ipcMain.handle('claudeConfig:deleteSkill', (_e, skillPath: string) => claudeConfigService.deleteSkill(skillPath))
  ipcMain.handle('claudeConfig:getMcpServers', () => claudeConfigService.getMcpServers())
  ipcMain.handle('claudeConfig:setMcpServers', (_e, servers: McpServerEntry[]) => claudeConfigService.setMcpServers(servers))
  ipcMain.handle('claudeConfig:getProjectMcpServers', (_e, projectPath: string) => claudeConfigService.getProjectMcpServers(projectPath))
  ipcMain.handle('claudeConfig:getPluginMcpServers', () => claudeConfigService.getPluginMcpServers())
  ipcMain.handle('claudeConfig:checkMcpHealth', async (_e, servers: Array<{ name: string; config: McpServerConfig }>) => {
    const { checkMcpServersHealth } = await import('./services/mcpHealth')
    return checkMcpServersHealth(servers)
  })
  ipcMain.handle('claudeConfig:authenticateMcpServer', async (_e, serverName: string, serverConfig: McpServerConfig) => {
    const { authenticateMcpServer } = await import('./services/mcpAuth')
    return authenticateMcpServer(
      serverName,
      serverConfig,
      {
        apiKey: mainSettings.apiKey,
        systemPromptSuffix: mainSettings.systemPromptSuffix,
        claudeCodeExecutablePath: mainSettings.claudeCodeExecutablePath,
        bypassPermissions: mainSettings.bypassPermissions,
      },
      (url) => shell.openExternal(url)
    )
  })

  // Notes
  ipcMain.handle('notes:load', (_e, worktreeId: string) => notesService.load(worktreeId))
  ipcMain.handle('notes:save', (_e, worktreeId: string, content: string) => notesService.save(worktreeId, content))
  ipcMain.handle('notes:delete', (_e, worktreeId: string) => notesService.delete(worktreeId))

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

  // ── Menu ──────────────────────────────────────────────────────────────────
  ipcMain.on('menu:closeWindow', () => {
    BrowserWindow.getFocusedWindow()?.close()
  })
}
