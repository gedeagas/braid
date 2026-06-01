import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';
import * as SecureStore from 'expo-secure-store';

import { palettes, type ColorScheme, type Palette } from './palette';

/** How the active scheme is chosen: follow the OS, or force one. */
export type ThemeMode = 'system' | 'light' | 'dark';

const THEME_MODE_KEY = 'braid.mobile.themeMode';
// When the OS scheme is unknown, fall back to dark - the app's original look.
const FALLBACK_SCHEME: ColorScheme = 'dark';

interface ThemeContextValue {
  /** User preference: system / light / dark. */
  mode: ThemeMode;
  /** The scheme actually in effect after resolving `mode` against the OS. */
  scheme: ColorScheme;
  /** Colors for the active scheme. */
  palette: Palette;
  /** Persisted setter for the user preference. */
  setMode: (mode: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function isThemeMode(value: string): value is ThemeMode {
  return value === 'system' || value === 'light' || value === 'dark';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const systemScheme = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode>('system');

  // Load the persisted preference once; default 'system' until it resolves.
  useEffect(() => {
    let active = true;
    SecureStore.getItemAsync(THEME_MODE_KEY)
      .then((stored) => {
        if (active && stored && isThemeMode(stored)) setModeState(stored);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const value = useMemo<ThemeContextValue>(() => {
    const resolvedSystem: ColorScheme = systemScheme === 'light' || systemScheme === 'dark' ? systemScheme : FALLBACK_SCHEME;
    const scheme: ColorScheme = mode === 'system' ? resolvedSystem : mode;
    const setMode = (next: ThemeMode) => {
      setModeState(next);
      void SecureStore.setItemAsync(THEME_MODE_KEY, next).catch(() => undefined);
    };
    return { mode, scheme, palette: palettes[scheme], setMode };
  }, [mode, systemScheme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/**
 * Access the active theme. Returns the palette plus the mode controls. Must be
 * called under a <ThemeProvider> (the root layout mounts one).
 */
export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within a ThemeProvider');
  return ctx;
}
