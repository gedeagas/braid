import { router } from 'expo-router';
import { AlertTriangle } from 'lucide-react-native';
import { StyleSheet, Text, View } from 'react-native';

import type { CompatVerdict } from '@/transport/protocol-compat';
import { Button, Screen } from '@/ui/kit';
import { useTheme, useThemedStyles, type Palette } from '@/ui/theme';

/**
 * Full-screen hard block shown when the paired desktop's protocol is
 * incompatible with this build (the desktop's kill switch fired, or the desktop
 * is too old for a feature this app now requires). Replaces a dismissible banner
 * because operating against an incompatible peer silently misbehaves.
 */
export function ProtocolBlockScreen({ verdict }: { verdict: Extract<CompatVerdict, { kind: 'blocked' }> }) {
  const { palette: c } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const mobileTooOld = verdict.reason === 'mobile-too-old';

  return (
    <Screen edges={['top', 'left', 'right']}>
      <View style={styles.body}>
        <View style={styles.iconCircle}>
          <AlertTriangle color={c.warning} size={28} />
        </View>
        <Text style={styles.title}>{mobileTooOld ? 'Update Braid Mobile' : 'Update Braid desktop'}</Text>
        <Text style={styles.message}>
          {mobileTooOld
            ? 'This desktop requires a newer version of Braid Mobile. Update the app from the App Store, then reconnect.'
            : 'This desktop is too old for this version of Braid Mobile. Update Braid on your desktop, then reconnect.'}
        </Text>
        <Text style={styles.detail}>
          Desktop protocol v{verdict.desktopVersion}
          {mobileTooOld
            ? ` · requires mobile v${verdict.requiredMobileVersion ?? '?'}`
            : ` · needs v${verdict.requiredDesktopVersion ?? '?'}`}
        </Text>
        <View style={styles.actions}>
          <Button label="Back to desktops" variant="secondary" onPress={() => router.back()} />
        </View>
      </View>
    </Screen>
  );
}

function makeStyles(c: Palette) {
  return StyleSheet.create({
    body: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28, gap: 14 },
    iconCircle: {
      width: 64,
      height: 64,
      borderRadius: 32,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: c.panelStrong,
      borderWidth: 1,
      borderColor: c.border,
    },
    title: { color: c.text, fontSize: 22, fontWeight: '800', textAlign: 'center' },
    message: { color: c.muted, fontSize: 14, lineHeight: 20, textAlign: 'center' },
    detail: { color: c.subtle, fontSize: 12, fontFamily: 'Menlo', textAlign: 'center', marginTop: 2 },
    actions: { marginTop: 12, alignSelf: 'stretch' },
  });
}
