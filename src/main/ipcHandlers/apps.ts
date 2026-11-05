// App registry IPC handlers, split out of ipc.ts.

import { logger } from '../lib/logger'
import { ipcMain, shell, app, nativeImage } from 'electron'
import { execFile } from 'child_process'

export function registerAppsIpc(): void {
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
    if (process.platform !== 'darwin') return []

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
    if (process.platform !== 'darwin') {
      shell.showItemInFolder(targetPath)
      return
    }
    if (appId === 'finder') return shell.showItemInFolder(targetPath)
    const bundleId = bundleIdForApp[appId]
    if (bundleId) {
      execFile('open', ['-b', bundleId, targetPath], (err) => {
        if (err) logger.error(`[Shell] Failed to open ${appId}:`, err.message)
      })
    }
  })
}
