import { APP_CODENAME } from './appBrand'

const prefix = APP_CODENAME

/**
 * All localStorage / sessionStorage keys used by the app.
 *
 * Every key is derived from APP_CODENAME so the full set is auditable here.
 *
 * NOTE: These keys are permanent after shipping — changing them silently
 * loses all existing user preferences. Any key rename requires a migration
 * (read old key → write new key → delete old key).
 */
export const SK = {
  // ── Theme & appearance ─────────────────────────────────────────────────
  activeThemeId:              `${prefix}:activeThemeId`,
  customThemes:               `${prefix}:customThemes`,
  uiZoom:                     `${prefix}:uiZoom`,

  // ── Layout ─────────────────────────────────────────────────────────────
  expandedProjects:           `${prefix}:expandedProjects`,
  pinnedWorktrees:            `${prefix}:pinnedWorktrees`,
  projectOrder:               `${prefix}:projectOrder`,
  worktreeOrders:             `${prefix}:worktreeOrders`,
  sidebarVisible:             `${prefix}:sidebarVisible`,
  sidebarPanelOpen:           `${prefix}:sidebarPanelOpen`,
  sidebarWidth:               `${prefix}:sidebarWidth`,
  rightPanelVisible:          `${prefix}:rightPanelVisible`,
  rightPanelWidth:            `${prefix}:rightPanelWidth`,
  missionControlActive:       `${prefix}:missionControlActive`,
  terminalHeight:             `${prefix}:terminalHeight`,
  terminalCollapsed:          `${prefix}:terminalCollapsed`,
  // Center panel bottom terminal strip (independent from right panel terminal)
  centerTerminalHeight:       `${prefix}:centerTerminalHeight`,
  centerTerminalCollapsed:    `${prefix}:centerTerminalCollapsed`,

  // ── Selection ──────────────────────────────────────────────────────────
  selectedProjectId:          `${prefix}:selectedProjectId`,
  selectedWorktreeId:         `${prefix}:selectedWorktreeId`,
  /** Prefix — append worktree path to get the full key, e.g. SK.openFilePathsPrefix + worktreePath */
  openFilePathsPrefix:        `${prefix}:openFilePaths:`,
  /** Prefix — unified tab order (sessions + files interleaved), keyed by worktree ID */
  tabOrderPrefix:             `${prefix}:tabOrder:`,

  // ── Settings — AI ──────────────────────────────────────────────────────
  defaultModel:               `${prefix}:defaultModel`,
  defaultThinking:            `${prefix}:defaultThinking`,
  defaultExtendedContext:     `${prefix}:defaultExtendedContext`,
  defaultEffortLevel:         `${prefix}:defaultEffortLevel`,
  apiKey:                     `${prefix}:apiKey`,
  systemPromptSuffix:         `${prefix}:systemPromptSuffix`,
  claudeCodeExecutablePath:   `${prefix}:claudeCodeExecutablePath`,
  bypassPermissions:          `${prefix}:bypassPermissions`,

  // ── Settings — Git ─────────────────────────────────────────────────────
  defaultBranchPrefix:        `${prefix}:defaultBranchPrefix`,
  pullStrategy:               `${prefix}:pullStrategy`,
  worktreeStoragePath:        `${prefix}:worktreeStoragePath`,
  discoveryPatterns:          `${prefix}:discoveryPatterns`,
  prPrompt:                   `${prefix}:prPrompt`,
  mergeConflictPrompt:        `${prefix}:mergeConflictPrompt`,

  // ── Settings — Notifications ───────────────────────────────────────────
  notifyOnDone:               `${prefix}:notifyOnDone`,
  notifyOnError:              `${prefix}:notifyOnError`,
  notifyOnWaitingInput:       `${prefix}:notifyOnWaitingInput`,
  notificationSound:          `${prefix}:notificationSound`,
  notificationVolume:         `${prefix}:notificationVolume`,
  inAppNotifications:         `${prefix}:inAppNotifications`,
  toastSize:                  `${prefix}:toastSize`,
  toastPosition:              `${prefix}:toastPosition`,
  toastDuration:              `${prefix}:toastDuration`,

  // ── Settings — Terminal ────────────────────────────────────────────────
  terminalFontSize:           `${prefix}:terminalFontSize`,
  terminalShell:              `${prefix}:terminalShell`,
  terminalScrollback:         `${prefix}:terminalScrollback`,

  // ── Settings — UI ──────────────────────────────────────────────────────
  toolMessageStyle:           `${prefix}:toolMessageStyle`,
  activityIndicatorStyle:     `${prefix}:activityIndicatorStyle`,
  streamingAnimation:         `${prefix}:streamingAnimation`,
  skipDeleteWorktreeConfirm:  `${prefix}:skipDeleteWorktreeConfirm`,
  tabDisplayMode:             `${prefix}:tabDisplayMode`,
  chatCompactMode:            `${prefix}:chatCompactMode`,
  projectAvatarVisible:       `${prefix}:projectAvatarVisible`,

  // ── i18n ───────────────────────────────────────────────────────────────
  language:                   `${prefix}:language`,

  // ── Projects store ─────────────────────────────────────────────────────
  worktreeIdRegistry:         `${prefix}:worktreeIdRegistry`,

  // ── Sessions store ─────────────────────────────────────────────────────
  lastActivePerWorktree:      `${prefix}:lastActivePerWorktree`,
  sessionOrderPerWorktree:    `${prefix}:sessionOrderPerWorktree`,

  // ── Components ─────────────────────────────────────────────────────────
  lastOpenInApp:              `${prefix}:lastOpenInApp`,
  onboardingComplete:         `${prefix}:onboardingComplete`,
  featureTourComplete:        `${prefix}:featureTourComplete`,
  simulatorTourComplete:      `${prefix}:simulatorTourComplete`,
  overviewBannerDismissed:    `${prefix}:overviewBannerDismissed`,
  homePath:                   `${prefix}:homePath`,

  // ── Settings — Integrations ────────────────────────────────────────────
  jiraBaseUrl:                `${prefix}:jiraBaseUrl`,

  // ── Experimental / Web apps ────────────────────────────────────────────
  experimentalCapture:        `${prefix}:experimentalCapture`,
  bottomTerminalEnabled:      `${prefix}:bottomTerminalEnabled`,
  noVirtualization:           `${prefix}:noVirtualization`,
  magicTrackpad:              `${prefix}:magicTrackpad`,
  rollbackHistory:            `${prefix}:rollbackHistory`,
  webAppsEnabled:             `${prefix}:webAppsEnabled`,
  embeddedApps:               `${prefix}:embeddedApps`,
  webAppLastUrls:             `${prefix}:webAppLastUrls`,
} as const

export type StorageKey = (typeof SK)[keyof typeof SK]
