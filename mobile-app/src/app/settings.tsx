import { router } from 'expo-router';
import { Bell, ChevronLeft, ChevronRight } from 'lucide-react-native';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useShared, useTheme, useThemedStyles, type Palette, type ThemeMode } from '@/ui/theme';
import { Card, Screen, SegmentedControl } from '@/ui/kit';

const THEME_OPTIONS: { value: ThemeMode; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

export default function SettingsScreen() {
  const { palette: c, mode, setMode } = useTheme();
  const shared = useShared();
  const styles = useThemedStyles(makeStyles);

  return (
    <Screen edges={['top', 'left', 'right']}>
      <View style={shared.shell}>
        <View style={styles.topRow}>
          <Pressable style={styles.back} onPress={() => router.back()} accessibilityLabel="Back">
            <ChevronLeft color={c.text} size={22} />
          </Pressable>
          <Text style={shared.title}>Settings</Text>
        </View>

        <Text style={shared.section}>Appearance</Text>
        <Card style={styles.card}>
          <Text style={styles.rowLabel}>Theme</Text>
          <SegmentedControl options={THEME_OPTIONS} value={mode} onChange={setMode} />
          <Text style={shared.muted}>Follow the system setting, or force light or dark.</Text>
        </Card>

        <Text style={[shared.section, styles.sectionSpacing]}>General</Text>
        <Pressable
          style={styles.navRow}
          onPress={() => router.push('/notifications' as Parameters<typeof router.push>[0])}
          accessibilityLabel="Notification settings"
        >
          <Bell color={c.muted} size={20} />
          <Text style={styles.navLabel}>Notifications</Text>
          <ChevronRight color={c.subtle} size={20} />
        </Pressable>
      </View>
    </Screen>
  );
}

function makeStyles(c: Palette) {
  return StyleSheet.create({
    topRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 20 },
    back: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
    card: { gap: 12 },
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
  });
}
