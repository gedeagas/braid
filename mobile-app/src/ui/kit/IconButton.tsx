import type { ReactNode } from 'react';
import { Pressable, type StyleProp, type ViewStyle } from 'react-native';

import { useTheme } from '@/ui/theme';

export type IconButtonVariant = 'plain' | 'panel' | 'danger';
export type IconButtonSize = 'sm' | 'md';

export function IconButton({
  icon,
  onPress,
  accessibilityLabel,
  variant = 'plain',
  size = 'md',
  disabled = false,
  style,
}: {
  icon: ReactNode;
  onPress: () => void;
  accessibilityLabel: string;
  variant?: IconButtonVariant;
  size?: IconButtonSize;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const { palette: c } = useTheme();
  const side = size === 'sm' ? 36 : 40;
  const bg = variant === 'plain' ? 'transparent' : variant === 'danger' ? 'rgba(255, 90, 102, 0.14)' : c.panelStrong;
  const borderColor = variant === 'danger' ? 'rgba(255, 90, 102, 0.35)' : c.border;

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityLabel={accessibilityLabel}
      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      style={[
        {
          width: side,
          height: side,
          borderRadius: 10,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: bg,
          borderWidth: variant === 'plain' ? 0 : 1,
          borderColor,
          opacity: disabled ? 0.4 : 1,
        },
        style,
      ]}
    >
      {icon}
    </Pressable>
  );
}
