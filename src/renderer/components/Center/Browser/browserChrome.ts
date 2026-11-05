/**
 * Optical icon sizes for the browser chrome.
 *
 * The icon set mixes viewBoxes (24, 16, 14, 10) and each glyph fills a
 * different share of its box, so one `size` renders visibly different
 * glyphs. These values target a ~9-10px rendered glyph in toolbar buttons
 * and ~8.5px in compact controls (find bar, downloads shelf).
 */
export const BROWSER_ICON = {
  /** IconArrowLeft/Right: 24 viewBox, glyph spans ~58% */
  nav: 16,
  /** IconRefresh (16 viewBox, ~75%), IconClose as Stop (10 viewBox, ~70%) */
  reload: 13,
  /** External link, devtools, viewport, design mode: 24 viewBox, ~75-83% */
  tool: 13,
  /** Leading site indicator inside the address bar */
  omnibox: 12,
  /** IconArrowUp: 16 viewBox, glyph spans ~62% */
  findPrev: 14,
  /** IconArrowDown (14 viewBox, ~71%) and IconClose in compact rows */
  compact: 12,
} as const
