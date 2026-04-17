import { type StateCreator } from 'zustand'
import type { ModelId, EffortLevel, SettingsSection, ToastSize, ToastPosition, ToastDuration, TabDisplayMode } from '@/types'
import type { UIState } from './types'
import { SK } from '@/lib/storageKeys'
import { DEFAULT_EFFORT, EFFORT_LEVELS } from '@/lib/constants'
import { loadStr, loadBool, loadInt, loadFloat } from './helpers'

const VALID_MODEL_IDS: readonly string[] = ['claude-opus-4-7', 'claude-sonnet-4-6', 'claude-opus-4-6', 'claude-haiku-4-5-20251001']
const VALID_EFFORT_LEVELS = new Set<string>(EFFORT_LEVELS.map((l) => l.id))
const DEFAULT_MODEL: ModelId = 'claude-sonnet-4-6'

const DEFAULT_DISCOVERY_PATTERNS = [
  '.env*', '.envrc', '.secret', '.secrets',
  '.npmrc', '.yarnrc.yml', '.ruby-version', '.node-version', '.tool-versions',
  'credentials.json', 'serviceAccount*.json',
  'google-services.json', 'GoogleService-Info.plist',
  '.sentryclirc', 'local.properties', '.claude*',
]

function loadDefaultModel(): ModelId {
  try {
    const raw = localStorage.getItem(SK.defaultModel)
    if (raw !== null && VALID_MODEL_IDS.includes(raw)) return raw as ModelId
  } catch {}
  return DEFAULT_MODEL
}

function loadDiscoveryPatterns(): string[] {
  try {
    const raw = localStorage.getItem(SK.discoveryPatterns)
    if (raw) return JSON.parse(raw) as string[]
  } catch {}
  return DEFAULT_DISCOVERY_PATTERNS
}

export interface SettingsSlice {
  // Overlay state
  settingsOpen: boolean
  settingsSection: SettingsSection
  shortcutsOpen: boolean
  quickOpenOpen: boolean

  // AI
  defaultModel: ModelId
  defaultThinking: boolean
  defaultExtendedContext: boolean
  defaultEffortLevel: EffortLevel
  apiKey: string | null
  systemPromptSuffix: string
  claudeCodeExecutablePath: string
  bypassPermissions: boolean

  // Git
  defaultBranchPrefix: string
  worktreeStoragePath: string
  discoveryPatterns: string[]
  pullStrategy: 'rebase' | 'merge' | null
  prPrompt: string
  mergeConflictPrompt: string
  jiraBaseUrl: string

  // Notifications
  notifyOnDone: boolean
  notifyOnError: boolean
  notifyOnWaitingInput: boolean
  notificationSound: boolean
  notificationVolume: number
  inAppNotifications: boolean
  toastSize: ToastSize
  toastPosition: ToastPosition
  toastDuration: ToastDuration

  // UI preferences
  streamingAnimation: boolean
  tabDisplayMode: TabDisplayMode
  chatCompactMode: boolean

  // Experimental
  experimentalCapture: boolean
  bottomTerminalEnabled: boolean
  experimentalNoVirtualization: boolean
  magicTrackpad: boolean

  // Onboarding
  onboardingComplete: boolean
  featureTourComplete: boolean
  simulatorTourComplete: boolean
  setOnboardingComplete: (v: boolean) => void
  setFeatureTourComplete: (v: boolean) => void
  setSimulatorTourComplete: (v: boolean) => void

  openSettings: (section?: SettingsSection) => void
  closeSettings: () => void
  setSettingsSection: (section: SettingsSection) => void
  openShortcuts: () => void
  closeShortcuts: () => void
  openQuickOpen: () => void
  closeQuickOpen: () => void
  setDefaultModel: (model: ModelId) => void
  setDefaultThinking: (v: boolean) => void
  setDefaultExtendedContext: (v: boolean) => void
  setDefaultEffortLevel: (level: EffortLevel) => void
  setApiKey: (key: string | null) => void
  setSystemPromptSuffix: (suffix: string) => void
  setClaudeCodeExecutablePath: (path: string) => void
  setBypassPermissions: (v: boolean) => void
  setDefaultBranchPrefix: (prefix: string) => void
  setPullStrategy: (strategy: 'rebase' | 'merge' | null) => void
  setWorktreeStoragePath: (path: string) => void
  setDiscoveryPatterns: (patterns: string[]) => void
  setPrPrompt: (prompt: string) => void
  setMergeConflictPrompt: (prompt: string) => void
  setJiraBaseUrl: (url: string) => void
  setNotifyOnDone: (v: boolean) => void
  setNotifyOnError: (v: boolean) => void
  setNotifyOnWaitingInput: (v: boolean) => void
  setNotificationSound: (v: boolean) => void
  setNotificationVolume: (v: number) => void
  setInAppNotifications: (v: boolean) => void
  setToastSize: (size: ToastSize) => void
  setToastPosition: (position: ToastPosition) => void
  setToastDuration: (duration: ToastDuration) => void
  setStreamingAnimation: (v: boolean) => void
  setTabDisplayMode: (mode: TabDisplayMode) => void
  setChatCompactMode: (v: boolean) => void
  setExperimentalCapture: (v: boolean) => void
  setBottomTerminalEnabled: (v: boolean) => void
  setExperimentalNoVirtualization: (v: boolean) => void
  setMagicTrackpad: (v: boolean) => void
}

export const createSettingsSlice: StateCreator<UIState, [], [], SettingsSlice> = (set) => ({
  settingsOpen: false,
  settingsSection: 'general',
  shortcutsOpen: false,
  quickOpenOpen: false,

  defaultModel: loadDefaultModel(),
  defaultThinking: loadBool(SK.defaultThinking, false),
  defaultExtendedContext: loadBool(SK.defaultExtendedContext, false),
  defaultEffortLevel: (() => {
    const v = loadStr(SK.defaultEffortLevel, DEFAULT_EFFORT)
    return VALID_EFFORT_LEVELS.has(v) ? v as EffortLevel : DEFAULT_EFFORT
  })(),
  apiKey: loadStr(SK.apiKey, '') || null,
  systemPromptSuffix: loadStr(SK.systemPromptSuffix, ''),
  claudeCodeExecutablePath: loadStr(SK.claudeCodeExecutablePath, ''),
  bypassPermissions: loadBool(SK.bypassPermissions, true),

  defaultBranchPrefix: loadStr(SK.defaultBranchPrefix, ''),
  pullStrategy: (() => {
    const v = localStorage.getItem(SK.pullStrategy)
    return v === 'rebase' || v === 'merge' ? v : null
  })(),
  worktreeStoragePath: loadStr(SK.worktreeStoragePath, ''),
  discoveryPatterns: loadDiscoveryPatterns(),
  prPrompt: loadStr(SK.prPrompt, ''),
  mergeConflictPrompt: loadStr(SK.mergeConflictPrompt, ''),
  jiraBaseUrl: loadStr(SK.jiraBaseUrl, ''),

  notifyOnDone: loadBool(SK.notifyOnDone, true),
  notifyOnError: loadBool(SK.notifyOnError, true),
  notifyOnWaitingInput: loadBool(SK.notifyOnWaitingInput, true),
  notificationSound: loadBool(SK.notificationSound, true),
  notificationVolume: (() => {
    const v = loadFloat(SK.notificationVolume, 0.75)
    return Math.max(0, Math.min(1, v))
  })(),
  inAppNotifications: loadBool(SK.inAppNotifications, true),
  toastSize: (() => {
    const v = loadStr(SK.toastSize, 'large')
    return (v === 'small' || v === 'medium' || v === 'large') ? v as ToastSize : 'large'
  })(),
  toastPosition: (() => {
    const v = loadStr(SK.toastPosition, 'top-center')
    return (v === 'bottom-right' || v === 'bottom-left' || v === 'top-center') ? v as ToastPosition : 'top-center'
  })(),
  toastDuration: (() => {
    const v = loadInt(SK.toastDuration, 10)
    return (v === 5 || v === 10 || v === 15) ? v as ToastDuration : 10
  })(),

  streamingAnimation: loadBool(SK.streamingAnimation, true),

  tabDisplayMode: (() => {
    const v = loadStr(SK.tabDisplayMode, 'icons')
    return (v === 'icons' || v === 'labels' || v === 'both') ? v as TabDisplayMode : 'icons'
  })(),

  chatCompactMode: loadBool(SK.chatCompactMode, false),

  experimentalCapture: loadBool(SK.experimentalCapture, false),
  bottomTerminalEnabled: loadBool(SK.bottomTerminalEnabled, false),
  experimentalNoVirtualization: loadBool(SK.noVirtualization, true),
  magicTrackpad: loadBool(SK.magicTrackpad, false),

  onboardingComplete: loadBool(SK.onboardingComplete, false),
  featureTourComplete: loadBool(SK.featureTourComplete, false),
  simulatorTourComplete: loadBool(SK.simulatorTourComplete, false),

  openSettings: (section = 'general') => set({ settingsOpen: true, settingsSection: section }),
  closeSettings: () => set({ settingsOpen: false }),
  setSettingsSection: (section) => set({ settingsSection: section }),
  openShortcuts: () => set({ shortcutsOpen: true }),
  closeShortcuts: () => set({ shortcutsOpen: false }),
  openQuickOpen: () => set({ quickOpenOpen: true }),
  closeQuickOpen: () => set({ quickOpenOpen: false }),

  setDefaultModel: (model) => {
    localStorage.setItem(SK.defaultModel, model)
    set({ defaultModel: model })
  },
  setDefaultThinking: (v) => {
    localStorage.setItem(SK.defaultThinking, String(v))
    set({ defaultThinking: v })
  },
  setDefaultExtendedContext: (v) => {
    localStorage.setItem(SK.defaultExtendedContext, String(v))
    set({ defaultExtendedContext: v })
  },
  setDefaultEffortLevel: (level) => {
    localStorage.setItem(SK.defaultEffortLevel, level)
    set({ defaultEffortLevel: level })
  },
  setApiKey: (key) => {
    if (key) localStorage.setItem(SK.apiKey, key)
    else localStorage.removeItem(SK.apiKey)
    set({ apiKey: key || null })
  },
  setSystemPromptSuffix: (suffix) => {
    localStorage.setItem(SK.systemPromptSuffix, suffix)
    set({ systemPromptSuffix: suffix })
  },
  setClaudeCodeExecutablePath: (p) => {
    localStorage.setItem(SK.claudeCodeExecutablePath, p)
    set({ claudeCodeExecutablePath: p })
  },
  setBypassPermissions: (v) => {
    localStorage.setItem(SK.bypassPermissions, String(v))
    set({ bypassPermissions: v })
  },

  setDefaultBranchPrefix: (prefix) => {
    localStorage.setItem(SK.defaultBranchPrefix, prefix)
    set({ defaultBranchPrefix: prefix })
  },
  setPullStrategy: (strategy) => {
    if (strategy === null) localStorage.removeItem(SK.pullStrategy)
    else localStorage.setItem(SK.pullStrategy, strategy)
    set({ pullStrategy: strategy })
  },
  setWorktreeStoragePath: (path) => {
    localStorage.setItem(SK.worktreeStoragePath, path)
    set({ worktreeStoragePath: path })
  },
  setDiscoveryPatterns: (patterns) => {
    localStorage.setItem(SK.discoveryPatterns, JSON.stringify(patterns))
    set({ discoveryPatterns: patterns })
  },
  setPrPrompt: (prompt) => {
    localStorage.setItem(SK.prPrompt, prompt)
    set({ prPrompt: prompt })
  },
  setMergeConflictPrompt: (prompt) => {
    localStorage.setItem(SK.mergeConflictPrompt, prompt)
    set({ mergeConflictPrompt: prompt })
  },
  setJiraBaseUrl: (url) => {
    localStorage.setItem(SK.jiraBaseUrl, url)
    set({ jiraBaseUrl: url })
  },

  setNotifyOnDone: (v) => { localStorage.setItem(SK.notifyOnDone, String(v)); set({ notifyOnDone: v }) },
  setNotifyOnError: (v) => { localStorage.setItem(SK.notifyOnError, String(v)); set({ notifyOnError: v }) },
  setNotifyOnWaitingInput: (v) => { localStorage.setItem(SK.notifyOnWaitingInput, String(v)); set({ notifyOnWaitingInput: v }) },
  setNotificationSound: (v) => { localStorage.setItem(SK.notificationSound, String(v)); set({ notificationSound: v }) },
  setNotificationVolume: (v) => {
    const clamped = Math.max(0, Math.min(1, v))
    localStorage.setItem(SK.notificationVolume, String(clamped))
    set({ notificationVolume: clamped })
  },
  setInAppNotifications: (v) => { localStorage.setItem(SK.inAppNotifications, String(v)); set({ inAppNotifications: v }) },
  setToastSize: (size) => { localStorage.setItem(SK.toastSize, size); set({ toastSize: size }) },
  setToastPosition: (position) => { localStorage.setItem(SK.toastPosition, position); set({ toastPosition: position }) },
  setToastDuration: (duration) => { localStorage.setItem(SK.toastDuration, String(duration)); set({ toastDuration: duration }) },
  setStreamingAnimation: (v) => { localStorage.setItem(SK.streamingAnimation, String(v)); set({ streamingAnimation: v }) },
  setTabDisplayMode: (mode) => { localStorage.setItem(SK.tabDisplayMode, mode); set({ tabDisplayMode: mode }) },
  setChatCompactMode: (v) => { localStorage.setItem(SK.chatCompactMode, String(v)); set({ chatCompactMode: v }) },
  setExperimentalCapture: (v) => { localStorage.setItem(SK.experimentalCapture, String(v)); set({ experimentalCapture: v }) },
  setBottomTerminalEnabled: (v) => { localStorage.setItem(SK.bottomTerminalEnabled, String(v)); set({ bottomTerminalEnabled: v }) },
  setExperimentalNoVirtualization: (v) => { localStorage.setItem(SK.noVirtualization, String(v)); set({ experimentalNoVirtualization: v }) },
  setMagicTrackpad: (v) => { localStorage.setItem(SK.magicTrackpad, String(v)); set({ magicTrackpad: v }) },
  setOnboardingComplete: (v) => { localStorage.setItem(SK.onboardingComplete, String(v)); set({ onboardingComplete: v }) },
  setFeatureTourComplete: (v) => { localStorage.setItem(SK.featureTourComplete, String(v)); set({ featureTourComplete: v }) },
  setSimulatorTourComplete: (v) => { localStorage.setItem(SK.simulatorTourComplete, String(v)); set({ simulatorTourComplete: v }) },
})
