export const APP_DISPLAY_NAME = 'Braid'

/**
 * Version codename — each major version gets a star/constellation name.
 * 26 → Polaris
 */
export const VERSION_CODENAME = 'Polaris'

/**
 * Internal codename — used for localStorage key prefixes, custom DOM events,
 * drag-drop MIME types, and Monaco theme name.
 */
export const APP_CODENAME = 'braid'

/** Must be unique within the Monaco instance — used by all in-app editors. */
export const MONACO_THEME_NAME = APP_CODENAME

export const DOM_EVENT_FILES_CHANGED = `${APP_CODENAME}:files-changed`
export const MIME_PROJECT  = `${APP_CODENAME}/project`
export const MIME_WORKTREE = `${APP_CODENAME}/worktree`

/**
 * Data directory name on disk (~/Braid/).
 *
 * Mirrors DATA_DIR_NAME in src/main/appBrand.ts. Keep them in sync.
 */
export const DATA_DIR_NAME = 'Braid'
