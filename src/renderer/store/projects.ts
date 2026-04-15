import { create } from 'zustand'
import type { Project, Worktree, ProjectSettings } from '@/types'
import * as ipc from '@/lib/ipc'
import { useUIStore } from './ui'
import { useSessionsStore } from './sessions'
import { cleanupSetupPanel } from '@/components/Right/SetupPanel'
import { cleanupTerminals } from '@/components/Right/TabbedTerminal'
import { SK } from '@/lib/storageKeys'

export function createDefaultProjectSettings(): ProjectSettings {
  return {
    workspacesPath: '',
    defaultBaseBranch: '',
    branchPrefix: '',
    remoteOrigin: '',
    setupScript: '',
    runScript: '',
    archiveScript: '',
    copyFiles: [],
    runFavorites: [],
    runCustomCommands: [],
    lspServers: [],
    lspDisabled: false,
  }
}

function serializeProject(p: Project) {
  return {
    id: p.id,
    name: p.name,
    path: p.path,
    createdAt: p.createdAt,
    settings: p.settings,
    avatarUrl: p.avatarUrl
  }
}

// ── Stable worktree ID registry (persisted to localStorage) ─────────────────
const WORKTREE_ID_REGISTRY_KEY = SK.worktreeIdRegistry

/** Load the path→id map from localStorage */
function loadWorktreeIdRegistry(): Record<string, string> {
  try {
    const raw = localStorage.getItem(WORKTREE_ID_REGISTRY_KEY)
    if (raw) return JSON.parse(raw) as Record<string, string>
  } catch {}
  return {}
}

/** Save the path→id map to localStorage */
function saveWorktreeIdRegistry(registry: Record<string, string>): void {
  try {
    localStorage.setItem(WORKTREE_ID_REGISTRY_KEY, JSON.stringify(registry))
  } catch {}
}

const worktreeIdRegistry = loadWorktreeIdRegistry()

/**
 * Generate a unique worktree ID.
 * Includes a timestamp so re-creating a branch with the same name
 * never collides with a previously deleted worktree's sessions.
 */
function makeWorktreeId(projectId: string, worktreePath: string): string {
  const parts = worktreePath.replace(/\/+$/, '').split('/')
  const slug = parts.slice(-2).join('/')
  return `${projectId}-wt-${slug}-${Date.now()}`
}

/**
 * Resolve worktree ID: reuse existing ID from the persistent registry
 * or from in-memory worktrees, otherwise mint a fresh one.
 */
function resolveWorktreeId(
  projectId: string,
  worktreePath: string,
  existingWorktrees: Worktree[]
): string {
  // 1. Check persistent registry (survives app restarts)
  const registryId = worktreeIdRegistry[worktreePath]
  if (registryId) return registryId
  // 2. Check in-memory worktrees (survives refreshes within a session)
  const existing = existingWorktrees.find((w) => w.path === worktreePath)
  if (existing) return existing.id
  // 3. Mint a new ID and persist it
  const id = makeWorktreeId(projectId, worktreePath)
  worktreeIdRegistry[worktreePath] = id
  saveWorktreeIdRegistry(worktreeIdRegistry)
  return id
}

/** Remove a worktree path from the registry (e.g. on deletion) */
function unregisterWorktreeId(worktreePath: string): void {
  delete worktreeIdRegistry[worktreePath]
  saveWorktreeIdRegistry(worktreeIdRegistry)
}

interface ProjectsState {
  projects: Project[]
  loading: boolean
  loadProjects: () => Promise<void>
  addProject: (path: string) => Promise<void>
  removeProject: (id: string) => void
  refreshWorktrees: (projectId: string) => Promise<void>
  addWorktree: (projectId: string, branch: string, baseBranch?: string, filesToCopy?: string[]) => Promise<void>
  removeWorktree: (projectId: string, worktreeId: string) => Promise<void>
  updateProjectSettings: (projectId: string, settings: Partial<ProjectSettings>) => Promise<void>
}

export const useProjectsStore = create<ProjectsState>((set, get) => ({
  projects: [],
  loading: false,

  loadProjects: async () => {
    set({ loading: true })
    try {
      const data = await ipc.storage.load()
      const projects: Project[] = []

      for (const p of data.projects ?? []) {
        const [worktreeInfos, platform, mobileFramework] = await Promise.all([
          ipc.git.getWorktrees(p.path).catch(() => []),
          ipc.files.detectPlatform(p.path).catch(() => 'unknown' as const),
          ipc.files.detectFramework(p.path).catch(() => null),
        ])
        const worktrees: Worktree[] = await Promise.all(
          worktreeInfos.map(
            async (w: { path: string; branch: string; isMain: boolean }) => {
              const upstream = await ipc.git.getTrackingBranch(w.path, w.branch).catch(() => null)
              return {
                id: resolveWorktreeId(p.id, w.path, []),
                projectId: p.id,
                branch: w.branch,
                path: w.path,
                isMain: w.isMain,
                upstream: upstream ?? undefined,
                sessions: []
              }
            }
          )
        )
        projects.push({ ...p, worktrees, platform, mobileFramework })
      }

      set({ projects, loading: false })

      // Prefetch remote branches for each project so the Add Worktree dialog is instant.
      // The 500ms delay avoids competing with the initial UI paint.
      // Results are cached by the main-process remoteBranchesCache (2min TTL).
      setTimeout(() => {
        for (const p of projects) {
          ipc.git.getRemoteBranches(p.path).catch(() => {})
        }
      }, 500)
    } catch {
      set({ loading: false })
    }
  },

  addProject: async (path: string) => {
    const name = path.split('/').pop() ?? path
    const id = `proj-${Date.now()}`
    const [platform, mobileFramework] = await Promise.all([
      ipc.files.detectPlatform(path).catch(() => 'unknown' as const),
      ipc.files.detectFramework(path).catch(() => null),
    ])
    const project: Project = { id, name, path, worktrees: [], createdAt: Date.now(), platform, mobileFramework }

    // Load worktrees
    const worktreeInfos = await ipc.git.getWorktrees(path).catch(() => [])
    project.worktrees = await Promise.all(
      worktreeInfos.map(
        async (w: { path: string; branch: string; isMain: boolean }) => {
          const upstream = await ipc.git.getTrackingBranch(w.path, w.branch).catch(() => null)
          return {
            id: resolveWorktreeId(id, w.path, []),
            projectId: id,
            branch: w.branch,
            path: w.path,
            isMain: w.isMain,
            upstream: upstream ?? undefined,
            sessions: []
          }
        }
      )
    )

    // Auto-detect remote origin for initial project settings
    const remoteOrigin = await ipc.git.getRemoteUrl(path).catch(() => '')
    if (remoteOrigin) {
      project.settings = { ...createDefaultProjectSettings(), remoteOrigin }
    }

    const projects = [...get().projects, project]
    set({ projects })
    await ipc.storage.save({ projects: projects.map(serializeProject) })
  },

  removeProject: async (id: string) => {
    const project = get().projects.find((p) => p.id === id)

    // Cascade-delete every session tied to this project's worktrees
    if (project) {
      for (const wt of project.worktrees) {
        useSessionsStore.getState().closeSessionsByWorktree(wt.id)
      }
    }

    const projects = get().projects.filter((p) => p.id !== id)
    set({ projects })
    await ipc.storage.save({ projects: projects.map(serializeProject) })
  },

  refreshWorktrees: async (projectId: string) => {
    const project = get().projects.find((p) => p.id === projectId)
    if (!project) return

    const worktreeInfos = await ipc.git.getWorktrees(project.path).catch(() => [])
    const worktrees: Worktree[] = await Promise.all(
      worktreeInfos.map(
        async (w: { path: string; branch: string; isMain: boolean }) => {
          const upstream = await ipc.git.getTrackingBranch(w.path, w.branch).catch(() => null)
          return {
            id: resolveWorktreeId(projectId, w.path, project.worktrees),
            projectId,
            branch: w.branch,
            path: w.path,
            isMain: w.isMain,
            upstream: upstream ?? undefined,
            sessions: []
          }
        }
      )
    )

    set({
      projects: get().projects.map((p) => (p.id === projectId ? { ...p, worktrees } : p))
    })
  },

  addWorktree: async (projectId: string, branch: string, baseBranch?: string, filesToCopy?: string[]) => {
    const project = get().projects.find((p) => p.id === projectId)
    if (!project) return

    const oldIds = new Set(project.worktrees.map((w) => w.id))
    await ipc.git.addWorktree(project.path, branch, project.name, baseBranch)
    await get().refreshWorktrees(projectId)

    // Detect the newly added worktree — prepend to order + highlight
    const updated = get().projects.find((p) => p.id === projectId)
    const newWt = updated?.worktrees.find((w) => !oldIds.has(w.id))
    if (newWt) {
      const ui = useUIStore.getState()
      ui.prependWorktreeToOrder(projectId, newWt.id)

      // Copy files before setup script (setup may need .env etc.)
      if (filesToCopy && filesToCopy.length > 0) {
        // Always copy from the main worktree — canonical source for env files
        const sourceWt = project.worktrees.find((w) => w.isMain)
        if (sourceWt) {
          const result = await ipc.files.copyToWorktree(sourceWt.path, newWt.path, filesToCopy)
          if (result.failed.length > 0) {
            console.warn('[Projects] Failed to copy files:', result.failed)
          }
        }
      }

      // Select the new worktree so SetupPanel mounts for it
      ui.selectWorktree(projectId, newWt.id)

      // Auto-run setup script in the Setup panel
      const setupScript = updated?.settings?.setupScript?.trim()
      if (setupScript) {
        const commands = setupScript.split('\n').filter((line) => line.trim())
        // Defer so SetupPanel has time to mount and subscribe
        setTimeout(() => {
          useUIStore.getState().setPendingSetupRun({ worktreePath: newWt.path, commands })
        }, 100)
      }
    }
  },

  removeWorktree: async (projectId: string, worktreeId: string) => {
    const project = get().projects.find((p) => p.id === projectId)
    if (!project) return
    const worktree = project.worktrees.find((w) => w.id === worktreeId)
    if (!worktree || worktree.isMain) return

    // Run archive script before deletion (synchronous — waits for completion)
    const archiveScript = project.settings?.archiveScript?.trim()
    if (archiveScript) {
      const commands = archiveScript.split('\n').filter((line) => line.trim())
      const combined = commands.join(' && ')
      try {
        await ipc.pty.runScript(worktree.path, combined)
      } catch (err) {
        console.error('[Projects] archive script failed:', err)
      }
    }

    // Clean up terminal instances for this worktree (PTYs + xterm instances)
    cleanupTerminals(worktree.path)
    cleanupSetupPanel(worktree.path)

    // Cascade-delete all sessions tied to this worktree (memory + disk)
    useSessionsStore.getState().closeSessionsByWorktree(worktreeId)
    // Remove stable ID from registry so a re-created branch gets a fresh ID
    unregisterWorktreeId(worktree.path)

    // Clear selection if deleting the currently selected worktree
    const ui = useUIStore.getState()
    if (ui.selectedWorktreeId === worktreeId) {
      const siblings = project.worktrees.filter((w) => w.id !== worktreeId)
      const fallback = siblings[0]
      if (fallback) {
        ui.selectWorktree(projectId, fallback.id)
      }
    }

    // Optimistically remove from UI immediately
    set({
      projects: get().projects.map((p) =>
        p.id === projectId
          ? { ...p, worktrees: p.worktrees.filter((w) => w.id !== worktreeId) }
          : p
      )
    })

    try {
      await ipc.git.removeWorktree(project.path, worktree.path)
    } catch (err) {
      console.error('[Projects] removeWorktree failed:', err)
      // Revert by refreshing actual state from disk
      await get().refreshWorktrees(projectId)
      return
    }

    // Sync with actual git state
    await get().refreshWorktrees(projectId)
  },

  updateProjectSettings: async (projectId: string, partial: Partial<ProjectSettings>) => {
    const project = get().projects.find((p) => p.id === projectId)
    if (!project) return

    const current = project.settings ?? createDefaultProjectSettings()
    const updated = { ...current, ...partial }

    const projects = get().projects.map((p) =>
      p.id === projectId ? { ...p, settings: updated } : p
    )
    set({ projects })
    await ipc.storage.save({ projects: projects.map(serializeProject) })
  }
}))
