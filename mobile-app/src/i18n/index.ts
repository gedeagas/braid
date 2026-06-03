import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import en from './locales/en.json';
import id from './locales/id.json';
import ja from './locales/ja.json';
import zh from './locales/zh.json';

/**
 * Languages Braid Mobile ships, mirroring the desktop app (English, Japanese,
 * Indonesian, Chinese). `system` follows the device locale; everything else
 * forces a specific language. Keep this list and the `locales/*.json` files in
 * sync - one JSON per language, same key shape, English is the fallback.
 */
export const SUPPORTED_LANGUAGES = ['en', 'ja', 'id', 'zh'] as const;
export type AppLanguage = (typeof SUPPORTED_LANGUAGES)[number];
export type LanguagePref = 'system' | AppLanguage;

export const LANGUAGE_LABELS: Record<AppLanguage, string> = {
  en: 'English',
  ja: '日本語',
  id: 'Bahasa Indonesia',
  zh: '中文',
};

function isAppLanguage(value: string): value is AppLanguage {
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(value);
}

/**
 * Best-effort device language without a native module: Hermes ships `Intl`, so
 * `resolvedOptions().locale` gives us something like "ja-JP" / "zh-Hans-CN".
 * We match on the primary subtag and fall back to English. JS-only so it needs
 * no dev-client rebuild.
 */
export function detectDeviceLanguage(): AppLanguage {
  try {
    const locale = Intl.DateTimeFormat().resolvedOptions().locale?.toLowerCase() ?? 'en';
    const primary = locale.split('-')[0];
    return isAppLanguage(primary) ? primary : 'en';
  } catch {
    return 'en';
  }
}

/** Resolve a stored preference to the language actually in effect. */
export function resolveLanguage(pref: LanguagePref): AppLanguage {
  return pref === 'system' ? detectDeviceLanguage() : pref;
}

if (!i18n.isInitialized) {
  // eslint-disable-next-line import/no-named-as-default-member -- i18next's default export exposes .use(); this is the documented init API.
  void i18n.use(initReactI18next).init({
    resources: {
      en: { translation: en },
      ja: { translation: ja },
      id: { translation: id },
      zh: { translation: zh },
    },
    lng: detectDeviceLanguage(),
    fallbackLng: 'en',
    defaultNS: 'translation',
    interpolation: { escapeValue: false },
    returnNull: false,
  });
}

export default i18n;
