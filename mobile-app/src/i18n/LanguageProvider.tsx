import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import * as SecureStore from 'expo-secure-store';

import i18n, { resolveLanguage, type AppLanguage, type LanguagePref } from './index';

const LANGUAGE_KEY = 'braid.mobile.language';

interface LanguageContextValue {
  /** User preference: system / en / ja / id / zh. */
  pref: LanguagePref;
  /** The language actually in effect after resolving `pref` against the device. */
  language: AppLanguage;
  /** Persisted setter for the user preference. */
  setLanguage: (pref: LanguagePref) => void;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

function isLanguagePref(value: string): value is LanguagePref {
  return value === 'system' || value === 'en' || value === 'ja' || value === 'id' || value === 'zh';
}

/**
 * Mirrors ThemeProvider: loads the persisted language preference once, applies
 * it to the global i18next instance, and exposes a persisted setter. Until the
 * stored value resolves we keep i18next's device-locale default, so first paint
 * is already in the right language with no flash.
 */
export function LanguageProvider({ children }: { children: ReactNode }) {
  const [pref, setPrefState] = useState<LanguagePref>('system');

  useEffect(() => {
    let active = true;
    SecureStore.getItemAsync(LANGUAGE_KEY)
      .then((stored) => {
        if (active && stored && isLanguagePref(stored)) {
          setPrefState(stored);
          void i18n.changeLanguage(resolveLanguage(stored));
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const value = useMemo<LanguageContextValue>(() => {
    const language = resolveLanguage(pref);
    const setLanguage = (next: LanguagePref) => {
      setPrefState(next);
      void i18n.changeLanguage(resolveLanguage(next));
      void SecureStore.setItemAsync(LANGUAGE_KEY, next).catch(() => undefined);
    };
    return { pref, language, setLanguage };
  }, [pref]);

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

/** Access the language preference + persisted setter. Use under <LanguageProvider>. */
export function useLanguage(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error('useLanguage must be used within a LanguageProvider');
  return ctx;
}
