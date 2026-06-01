import type { ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { View } from 'react-native';

import { useTheme } from '@/ui/theme';

/** Themed panel surface with border and padding. */
export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const { palette: c } = useTheme();
  return (
    <View
      style={[
        { borderRadius: 12, borderWidth: 1, borderColor: c.border, backgroundColor: c.panel, padding: 14 },
        style,
      ]}
    >
      {children}
    </View>
  );
}
