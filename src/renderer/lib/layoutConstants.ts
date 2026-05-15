// ---------------------------------------------------------------------------
// Shared layout constants
// ---------------------------------------------------------------------------
// Centralized dimensions used by both the resize logic (layout store) and
// inline styles (App.tsx). CSS equivalents live as design tokens in tokens.css.
// Keep these in sync with the CSS variables they mirror.

/** Activity bar width in px (vertical icon rail on the far left). */
export const ACTIVITY_BAR_WIDTH = 48

/** Width of a ResizeHandle in px (horizontal drag splitter). */
export const RESIZE_HANDLE_WIDTH = 4

/** Minimum center panel width in px - the flex:1 area must never shrink below this. */
export const CENTER_MIN_WIDTH = 300

/** Minimum sidebar panel width in px when open. */
export const SIDEBAR_MIN_WIDTH = 180

/** Maximum sidebar panel width in px. */
export const SIDEBAR_MAX_WIDTH = 500

/** Minimum right panel width in px when open. */
export const RIGHT_PANEL_MIN_WIDTH = 240

/** Maximum right panel width in px. */
export const RIGHT_PANEL_MAX_WIDTH = 700

/** Toolbar / drag-region height in px (mirrors --toolbar-height CSS token). */
export const TOOLBAR_HEIGHT = 38
