import { router } from 'expo-router';
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
  });
}
