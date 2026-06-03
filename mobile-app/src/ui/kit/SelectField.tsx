import type { ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import { ChevronRight } from 'lucide-react-native';

import { useTheme } from '@/ui/theme';

export function SelectField({
  label,
  detail,
  icon,
  placeholder = false,
  disabled = false,
  onPress,
}: {
  label: string;
  detail?: string;
  icon?: ReactNode;
  placeholder?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  const { palette: c } = useTheme();
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={{
        minHeight: 50,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: c.border,
        backgroundColor: c.panelStrong,
        paddingHorizontal: 12,
        paddingVertical: 8,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {icon ? <View style={{ width: 24, alignItems: 'center' }}>{icon}</View> : null}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ color: placeholder ? c.subtle : c.text, fontSize: 14, fontWeight: '700' }} numberOfLines={1}>
          {label}
        </Text>
        {detail ? (
          <Text style={{ color: c.muted, fontSize: 12, marginTop: 3 }} numberOfLines={1}>
            {detail}
          </Text>
        ) : null}
      </View>
      <ChevronRight color={disabled ? c.subtle : c.muted} size={18} />
    </Pressable>
  );
}
