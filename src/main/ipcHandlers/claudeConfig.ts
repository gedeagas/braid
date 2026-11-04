// Claude config IPC handlers, split out of ipc.ts.

import { ipcMain, shell } from 'electron'
import { claudeConfigService, ClaudePermissions, ClaudeHookConfig, SkillDetail, McpServerEntry, McpServerConfig } from '../services/claudeConfig'
import { mainSettings } from '../ipc'

export function registerClaudeConfigIpc(): void {
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
    const { checkMcpServersHealth } = await import('../services/mcpHealth')
    return checkMcpServersHealth(servers)
  })
  ipcMain.handle('claudeConfig:authenticateMcpServer', async (_e, serverName: string, serverConfig: McpServerConfig) => {
    const { authenticateMcpServer } = await import('../services/mcpAuth')
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
}
