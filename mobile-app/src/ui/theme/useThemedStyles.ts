import { useMemo } from 'react';

import { useTheme } from './context';
import { makeShared, type SharedStyles } from './shared';
import type { Palette } from './palette';

/**
 * Build a StyleSheet (or any style object) from the active palette, memoized so
 * it is only recomputed when the theme actually changes.
 *
 *   const styles = useThemedStyles((c) => StyleSheet.create({ box: { backgroundColor: c.panel } }))
 *
 * `factory` must be a stable module-level function (not an inline closure that
 * captures changing values) so the memo key stays the palette alone.
 */
export function useThemedStyles<T>(factory: (palette: Palette) => T): T {
  const { palette } = useTheme();
  return useMemo(() => factory(palette), [factory, palette]);
}

/** The themed `shared` style primitives for the active palette. */
export function useShared(): SharedStyles {
  return useThemedStyles(makeShared);
}
