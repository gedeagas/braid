import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import { SK } from './storageKeys'

import enCommon from '../locales/en/common.json'
import enCenter from '../locales/en/center.json'
import enSidebar from '../locales/en/sidebar.json'
import enRight from '../locales/en/right.json'
import enSettings from '../locales/en/settings.json'
import enMissionControl from '../locales/en/missionControl.json'
import enShortcuts from '../locales/en/shortcuts.json'
import jaCommon from '../locales/ja/common.json'
import jaCenter from '../locales/ja/center.json'
import jaSidebar from '../locales/ja/sidebar.json'
import jaRight from '../locales/ja/right.json'
import jaSettings from '../locales/ja/settings.json'
import jaMissionControl from '../locales/ja/missionControl.json'
import jaShortcuts from '../locales/ja/shortcuts.json'
import idCommon from '../locales/id/common.json'
import idCenter from '../locales/id/center.json'
import idSidebar from '../locales/id/sidebar.json'
import idRight from '../locales/id/right.json'
import idSettings from '../locales/id/settings.json'
import idMissionControl from '../locales/id/missionControl.json'
import idShortcuts from '../locales/id/shortcuts.json'

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { common: enCommon, center: enCenter, sidebar: enSidebar, right: enRight, settings: enSettings, missionControl: enMissionControl, shortcuts: enShortcuts },
      ja: { common: jaCommon, center: jaCenter, sidebar: jaSidebar, right: jaRight, settings: jaSettings, missionControl: jaMissionControl, shortcuts: jaShortcuts },
      id: { common: idCommon, center: idCenter, sidebar: idSidebar, right: idRight, settings: idSettings, missionControl: idMissionControl, shortcuts: idShortcuts },
    },
    fallbackLng: 'en',
    defaultNS: 'common',
    ns: ['common', 'center', 'sidebar', 'right', 'settings', 'missionControl', 'shortcuts'],
    detection: {
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: SK.language,
      caches: ['localStorage'],
    },
    interpolation: {
      escapeValue: false, // React already escapes
    },
  })

export default i18n
