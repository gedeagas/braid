import { claudeConfigService } from '../claudeConfig'
import { createMobileDeviceServer, setActiveDevice, setActiveFramework } from '../mobileMcp'
import { createBraidServer, type BraidAction } from '../braidMcp'

/** Set up MCP server when a mobile device is connected. */
export async function prepareMobileMcp(
  connectedDeviceId: string | undefined,
  mobileFramework: string | undefined
): Promise<Record<string, unknown> | undefined> {
  if (!connectedDeviceId) return undefined
  setActiveDevice(connectedDeviceId)
  const fw = (mobileFramework === 'react-native' || mobileFramework === 'flutter') ? mobileFramework : null
  setActiveFramework(fw)
  const mobileMcp = await createMobileDeviceServer()
  return { 'mobile-device': mobileMcp }
}

/** Set up the always-on Braid MCP server for app-awareness tools. */
export async function prepareBraidMcp(
  worktreeId: string,
  worktreePath: string,
  projectName: string,
  emit: (event: BraidAction) => void
): Promise<Record<string, unknown>> {
  const braidMcp = await createBraidServer(worktreeId, worktreePath, projectName, emit)
  return { braid: braidMcp }
}

/** Merge user-configured MCP servers with the Braid + mobile-device MCPs. */
export async function prepareMcpServers(
  worktreeId: string,
  worktreePath: string,
  projectName: string,
  braidEmit: (event: BraidAction) => void,
  connectedDeviceId: string | undefined,
  mobileFramework: string | undefined
): Promise<Record<string, unknown> | undefined> {
  const userServers = claudeConfigService.getMcpServers()
    .filter((s) => s.enabled)
    .reduce<Record<string, unknown>>((acc, s) => { acc[s.name] = s.config; return acc }, {})

  const braidMcp = await prepareBraidMcp(worktreeId, worktreePath, projectName, braidEmit)
  const mobileMcp = await prepareMobileMcp(connectedDeviceId, mobileFramework)
  const merged = { ...userServers, ...braidMcp, ...mobileMcp }
  return Object.keys(merged).length > 0 ? merged : undefined
}
