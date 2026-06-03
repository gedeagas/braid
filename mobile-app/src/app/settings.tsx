import Constants from 'expo-constants';
import { router } from 'expo-router';
import * as Updates from 'expo-updates';
import { Bell, ChevronRight, LifeBuoy } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useLanguage } from '@/i18n/LanguageProvider';
import { LANGUAGE_LABELS, SUPPORTED_LANGUAGES, type LanguagePref } from '@/i18n';
import { useShared, useTheme, useThemedStyles, type Palette, type ThemeMode } from '@/ui/theme';
import { Card, Dropdown, Screen, ScreenHeader, SegmentedControl, type DropdownOption } from '@/ui/kit';

export default function SettingsScreen() {
  const { t } = useTranslation();
  const { palette: c, mode, setMode } = useTheme();
  const { pref: langPref, setLanguage } = useLanguage();
  const shared = useShared();
  const styles = useThemedStyles(makeStyles);

  const themeOptions: { value: ThemeMode; label: string }[] = [
    { value: 'system', label: t('settings.themeSystem') },
    { value: 'light', label: t('settings.themeLight') },
    { value: 'dark', label: t('settings.themeDark') },
  ];

  const languageOptions: DropdownOption<LanguagePref>[] = [
    { value: 'system', label: t('settings.languageSystem') },
    ...SUPPORTED_LANGUAGES.map((lang) => ({ value: lang, label: LANGUAGE_LABELS[lang] })),
  ];

  // App version is the bundled native version; EAS Update info comes from the
  // running update. In dev / before any OTA the update fields are empty, so we
  // surface a friendly "Development" / "Embedded" label instead of a blank id.
  const appVersion = Constants.expoConfig?.version ?? '—';
  const updateChannel = Updates.channel ?? (Updates.isEnabled ? '—' : t('settings.updateDevelopment'));
  const updateLabel = !Updates.isEnabled
    ? t('settings.updateDevelopment')
    : Updates.isEmbeddedLaunch
      ? t('settings.updateEmbedded')
      : Updates.updateId?.slice(0, 8) ?? '—';
  const updatePublished = Updates.createdAt ? Updates.createdAt.toLocaleString() : null;

  return (
    <Screen edges={['top', 'left', 'right']}>
      <View style={shared.shell}>
        <ScreenHeader title={t('settings.title')} back style={styles.topRow} />

        <Text style={shared.section}>{t('settings.appearance')}</Text>
        <Card style={styles.card}>
          <Text style={styles.rowLabel}>{t('settings.theme')}</Text>
          <SegmentedControl options={themeOptions} value={mode} onChange={setMode} />
          <Text style={shared.muted}>{t('settings.themeHint')}</Text>

          <View style={styles.cardDivider} />

          <Text style={styles.rowLabel}>{t('settings.language')}</Text>
          <Dropdown value={langPref} options={languageOptions} onChange={setLanguage} />
          <Text style={shared.muted}>{t('settings.languageHint')}</Text>
        </Card>

        <Text style={[shared.section, styles.sectionSpacing]}>{t('settings.general')}</Text>
        <Pressable
          style={styles.navRow}
          onPress={() => router.push('/notifications' as Parameters<typeof router.push>[0])}
          accessibilityLabel={t('settings.notificationsA11y')}
        >
          <Bell color={c.muted} size={20} />
          <Text style={styles.navLabel}>{t('settings.notifications')}</Text>
          <ChevronRight color={c.subtle} size={20} />
        </Pressable>
        <Pressable
          style={[styles.navRow, styles.navRowSpacing]}
          onPress={() => router.push('/troubleshoot' as Parameters<typeof router.push>[0])}
          accessibilityLabel={t('settings.troubleshoot')}
        >
          <LifeBuoy color={c.muted} size={20} />
          <Text style={styles.navLabel}>{t('settings.troubleshoot')}</Text>
          <ChevronRight color={c.subtle} size={20} />
        </Pressable>

        <Text style={[shared.section, styles.sectionSpacing]}>{t('settings.about')}</Text>
        <Card style={styles.card}>
          <View style={styles.kvRow}>
            <Text style={styles.kvLabel}>{t('settings.version')}</Text>
            <Text style={styles.kvValue} numberOfLines={1}>{appVersion}</Text>
          </View>
          <View style={styles.cardDivider} />
          <View style={styles.kvRow}>
            <Text style={styles.kvLabel}>{t('settings.updateChannel')}</Text>
            <Text style={styles.kvValue} numberOfLines={1}>{updateChannel}</Text>
          </View>
          <View style={styles.cardDivider} />
          <View style={styles.kvRow}>
            <Text style={styles.kvLabel}>{t('settings.updateId')}</Text>
            <Text style={styles.kvValue} numberOfLines={1}>{updateLabel}</Text>
          </View>
          {updatePublished && <Text style={shared.muted}>{t('settings.updatePublished', { date: updatePublished })}</Text>}
        </Card>
      </View>
    </Screen>
  );
}

function makeStyles(c: Palette) {
  return StyleSheet.create({
    topRow: { marginBottom: 20 },
    card: { gap: 12 },
    cardDivider: { height: 1, backgroundColor: c.border, marginVertical: 4 },
    sectionSpacing: { marginTop: 24 },
    rowLabel: { color: c.text, fontSize: 16, fontWeight: '700' },
    navRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      minHeight: 52,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.panel,
      paddingHorizontal: 14,
    },
    navLabel: { flex: 1, color: c.text, fontSize: 16, fontWeight: '700' },
    navRowSpacing: { marginTop: 10 },
    kvRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      minHeight: 28,
    },
    kvLabel: { color: c.text, fontSize: 15, fontWeight: '600' },
    kvValue: { flexShrink: 1, color: c.muted, fontSize: 14, fontFamily: 'Menlo', textAlign: 'right' },
  });
}
