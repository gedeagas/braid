import type { ReactNode } from 'react';
import { Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { router } from 'expo-router';

import { useTheme } from '@/ui/theme';
import { HeaderBackButton } from './HeaderBackButton';

export function ScreenHeader({
  title,
  subtitle,
  back = false,
  onBack,
  trailing,
  compact = false,
  style,
}: {
  title: string;
  subtitle?: string;
  back?: boolean;
  onBack?: () => void;
  trailing?: ReactNode;
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const { palette: c } = useTheme();
  return (
    <View
      style={[
        {
          minHeight: compact ? 44 : 48,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 4,
        },
        style,
      ]}
    >
      {back && <HeaderBackButton onPress={onBack ?? (() => router.back())} />}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text
          style={{
            color: c.text,
            fontSize: compact ? 20 : 25,
            lineHeight: compact ? 25 : 31,
            fontWeight: '800',
          }}
          numberOfLines={1}
        >
          {title}
        </Text>
        {subtitle ? (
          <Text style={{ color: c.muted, fontSize: 13, lineHeight: 18, marginTop: 1 }} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {trailing}
    </View>
  );
}
