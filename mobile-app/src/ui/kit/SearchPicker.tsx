import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Check, Search, X } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useState } from 'react';

import { useTheme } from '@/ui/theme';
import { IconButton } from './IconButton';

export interface SearchPickerOption {
  value: string;
  label: string;
  detail?: string;
  icon?: ReactNode;
  disabled?: boolean;
}

export function SearchPicker({
  visible,
  title,
  placeholder,
  options,
  value,
  onSelect,
  onClose,
}: {
  visible: boolean;
  title: string;
  placeholder: string;
  options: SearchPickerOption[];
  value: string | null;
  onSelect: (value: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { palette: c } = useTheme();
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const needle = query.trim().toLowerCase();
  const filtered = needle
    ? options.filter((option) => `${option.label} ${option.detail ?? ''}`.toLowerCase().includes(needle))
    : options;

  const close = () => {
    setQuery('');
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <View style={{ flex: 1, backgroundColor: c.bg, paddingTop: insets.top, paddingBottom: insets.bottom }}>
        <View
          style={{
            minHeight: 52,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            paddingHorizontal: 18,
            borderBottomWidth: 1,
            borderBottomColor: c.border,
          }}
        >
          <Text style={{ flex: 1, color: c.text, fontSize: 19, fontWeight: '800' }} numberOfLines={1}>
            {title}
          </Text>
          <IconButton icon={<X color={c.text} size={18} />} onPress={close} accessibilityLabel={t('common.close')} size="sm" />
        </View>
        <View
          style={{
            minHeight: 46,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            marginHorizontal: 18,
            marginTop: 12,
            marginBottom: 8,
            borderRadius: 10,
            borderWidth: 1,
            borderColor: c.border,
            backgroundColor: c.panelStrong,
            paddingHorizontal: 12,
          }}
        >
          <Search color={c.muted} size={16} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={placeholder}
            placeholderTextColor={c.subtle}
            autoCapitalize="none"
            autoCorrect={false}
            autoFocus
            returnKeyType="search"
            style={{ flex: 1, minHeight: 44, color: c.text, fontSize: 14 }}
          />
        </View>
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingHorizontal: 10, paddingBottom: 20 }}
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
        >
          {filtered.length === 0 ? (
            <Text style={{ color: c.subtle, fontSize: 14, padding: 18 }}>
              {options.length === 0 ? t('connection.noOptions') : t('connection.noMatches')}
            </Text>
          ) : (
            filtered.map((option) => {
              const active = option.value === value;
              return (
                <Pressable
                  key={option.value}
                  disabled={option.disabled}
                  onPress={() => {
                    onSelect(option.value);
                    setQuery('');
                  }}
                  style={{
                    minHeight: 54,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 12,
                    borderRadius: 10,
                    paddingHorizontal: 10,
                    paddingVertical: 8,
                    backgroundColor: active ? c.panelStrong : 'transparent',
                    opacity: option.disabled ? 0.45 : 1,
                  }}
                >
                  {option.icon ? <View style={{ width: 24, alignItems: 'center' }}>{option.icon}</View> : null}
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={{ color: c.text, fontSize: 15, fontWeight: '700' }} numberOfLines={1}>
                      {option.label}
                    </Text>
                    {option.detail ? (
                      <Text style={{ color: c.muted, fontSize: 12, marginTop: 3 }} numberOfLines={1}>
                        {option.detail}
                      </Text>
                    ) : null}
                  </View>
                  {active ? <Check color={c.accent} size={18} /> : null}
                </Pressable>
              );
            })
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}
