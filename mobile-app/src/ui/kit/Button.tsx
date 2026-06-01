import type { ReactNode } from 'react';
import { Pressable, Text } from 'react-native';

import { useTheme } from '@/ui/theme';

export type ButtonVariant = 'primary' | 'secondary' | 'danger';

/** Themed button. Variants map onto the active palette. */
export function Button({
  label,
  onPress,
  variant = 'primary',
  icon,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  icon?: ReactNode;
  disabled?: boolean;
}) {
  const { palette: c } = useTheme();
  const bg =
    variant === 'primary' ? c.accent : variant === 'danger' ? 'rgba(255, 90, 102, 0.14)' : c.panelStrong;
  const fg = variant === 'primary' ? '#FFFFFF' : variant === 'danger' ? c.danger : c.text;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={{
        minHeight: 44,
        borderRadius: 8,
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'row',
        gap: 8,
        paddingHorizontal: 12,
        backgroundColor: bg,
        borderWidth: variant === 'primary' ? 0 : 1,
        borderColor: variant === 'danger' ? 'rgba(255, 90, 102, 0.35)' : c.border,
        opacity: disabled ? 0.4 : 1,
      }}
    >
      {icon}
      <Text style={{ color: fg, fontSize: 14, fontWeight: '800' }}>{label}</Text>
    </Pressable>
  );
}
