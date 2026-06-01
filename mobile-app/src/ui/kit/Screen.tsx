import type { ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';

import { useTheme } from '@/ui/theme';
import type { Palette } from '@/ui/theme';

/**
 * Themed safe-area screen container. The safe-area insets are filled with the
 * chosen surface color so the notch / home-indicator blend with the adjacent
 * content instead of leaving bands. Use `surface="panel"` when the screen's
 * top/bottom bars are panel-colored (e.g. the terminal screen).
 */
export function Screen({
  children,
  edges,
  surface = 'bg',
  style,
}: {
  children: ReactNode;
  edges?: Edge[];
  surface?: keyof Pick<Palette, 'bg' | 'panel'>;
  style?: StyleProp<ViewStyle>;
}) {
  const { palette } = useTheme();
  return (
    <SafeAreaView style={[{ flex: 1, backgroundColor: palette[surface] }, style]} edges={edges}>
      {children}
    </SafeAreaView>
  );
}
