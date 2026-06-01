/**
 * The consolidated UI kit theme. New screens should be theme-aware:
 *
 *   const { palette: c } = useTheme()      // active colors (re-renders on switch)
 *   const shared = useShared()             // themed shared style primitives
 *   const styles = useThemedStyles(make)   // memoized themed StyleSheet
 *
 * `colors` and `shared` below are the STATIC dark palette, kept only for
 * legacy/deprecated screens that have not been migrated. Do not use them in new
 * code - they never react to the light/dark switch.
 */
import { darkPalette } from './palette';
import { makeShared } from './shared';

export { ThemeProvider, useTheme, type ThemeMode } from './context';
export { useThemedStyles, useShared } from './useThemedStyles';
export { makeShared, type SharedStyles } from './shared';
export {
  darkPalette,
  lightPalette,
  palettes,
  type Palette,
  type ColorScheme,
} from './palette';

/** @deprecated Static dark palette. Use `useTheme().palette` for themed color. */
export const colors = darkPalette;
/** @deprecated Static dark shared styles. Use `useShared()` for themed styles. */
export const shared = makeShared(darkPalette);
