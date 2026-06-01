/**
 * Legacy theme constants for the Expo starter components (ThemedText/ThemedView,
 * the explore tab, native tab bar). The color values are derived from the
 * consolidated palettes in `@/ui/theme` so there is a single source of truth -
 * new code should use `useTheme()` from `@/ui/theme` directly.
 */

import '@/global.css';

import { Platform } from 'react-native';

import { darkPalette, lightPalette } from '@/ui/theme';

export const Colors = {
  light: {
    text: lightPalette.text,
    background: lightPalette.bg,
    backgroundElement: lightPalette.panel,
    backgroundSelected: lightPalette.panelStrong,
    textSecondary: lightPalette.muted,
  },
  dark: {
    text: darkPalette.text,
    background: darkPalette.bg,
    backgroundElement: darkPalette.panel,
    backgroundSelected: darkPalette.panelStrong,
    textSecondary: darkPalette.muted,
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;
