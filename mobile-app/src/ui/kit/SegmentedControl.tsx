import { Pressable, Text, View } from 'react-native';

import { useTheme } from '@/ui/theme';

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
}

/**
 * Compact pill-style segmented control. 2-4 mutually exclusive options - the
 * mobile counterpart of the desktop app's SegmentedControl.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
}: {
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
}) {
  const { palette: c } = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        backgroundColor: c.panelStrong,
        borderRadius: 9,
        borderWidth: 1,
        borderColor: c.border,
        padding: 2,
        gap: 2,
      }}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            style={{
              flex: 1,
              minHeight: 32,
              borderRadius: 7,
              alignItems: 'center',
              justifyContent: 'center',
              paddingHorizontal: 12,
              backgroundColor: active ? c.accent : 'transparent',
            }}
          >
            <Text style={{ color: active ? '#FFFFFF' : c.muted, fontSize: 13, fontWeight: '700' }}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
