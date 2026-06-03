import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Check, ChevronDown, Search } from 'lucide-react-native';

import { useTheme } from '@/ui/theme';

export interface DropdownOption<T extends string> {
  value: T;
  label: string;
  /** Optional leading icon/logo shown in the field and the option row. */
  icon?: ReactNode;
}

/**
 * Themed select. The field shows the current label and opens a bottom-sheet list
 * of options - the mobile counterpart of the desktop app's Combobox. Pass
 * `searchable` to add a filter input for long lists (e.g. branches).
 */
export function Dropdown<T extends string>({
  value,
  options,
  onChange,
  placeholder,
  disabled = false,
  searchable = false,
}: {
  value: T | null;
  options: DropdownOption<T>[];
  onChange: (value: T) => void;
  placeholder?: string;
  disabled?: boolean;
  searchable?: boolean;
}) {
  const { t } = useTranslation();
  const { palette: c } = useTheme();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const selected = options.find((option) => option.value === value);

  const show = (next: boolean) => {
    setOpen(next);
    if (!next) setQuery('');
  };

  const lower = query.trim().toLowerCase();
  const filtered = lower ? options.filter((option) => option.label.toLowerCase().includes(lower)) : options;

  return (
    <>
      <Pressable
        disabled={disabled}
        onPress={() => show(true)}
        style={{
          minHeight: 44,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          borderRadius: 8,
          borderWidth: 1,
          borderColor: c.border,
          backgroundColor: c.panelStrong,
          paddingHorizontal: 12,
          opacity: disabled ? 0.5 : 1,
        }}
      >
        {selected?.icon}
        <Text style={{ flex: 1, color: selected ? c.text : c.subtle, fontSize: 14 }} numberOfLines={1}>
          {selected?.label ?? placeholder ?? t('connection.select')}
        </Text>
        <ChevronDown color={c.muted} size={18} />
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => show(false)}>
        <Pressable
          style={{ flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.5)', justifyContent: 'flex-end', padding: 12 }}
          onPress={() => show(false)}
        >
          <Pressable
            style={{
              maxHeight: 460,
              borderRadius: 16,
              borderWidth: 1,
              borderColor: c.border,
              backgroundColor: c.panel,
              overflow: 'hidden',
            }}
            onPress={() => undefined}
          >
            {searchable && (
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 8,
                  paddingHorizontal: 12,
                  borderBottomWidth: 1,
                  borderBottomColor: c.border,
                }}
              >
                <Search color={c.muted} size={16} />
                <TextInput
                  value={query}
                  onChangeText={setQuery}
                  placeholder={t('connection.search')}
                  placeholderTextColor={c.subtle}
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={{ flex: 1, minHeight: 44, color: c.text, fontSize: 14 }}
                />
              </View>
            )}
            <ScrollView contentContainerStyle={{ padding: 8 }} keyboardShouldPersistTaps="handled">
              {filtered.length === 0 ? (
                <Text style={{ color: c.subtle, fontSize: 13, padding: 14 }}>
                  {options.length === 0 ? t('connection.noOptions') : t('connection.noMatches')}
                </Text>
              ) : (
                filtered.map((option) => {
                  const active = option.value === value;
                  return (
                    <Pressable
                      key={option.value}
                      onPress={() => {
                        onChange(option.value);
                        show(false);
                      }}
                      style={{
                        minHeight: 44,
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 10,
                        borderRadius: 8,
                        paddingHorizontal: 12,
                        backgroundColor: active ? c.panelStrong : 'transparent',
                      }}
                    >
                      {option.icon}
                      <Text style={{ flex: 1, color: c.text, fontSize: 14, fontWeight: active ? '700' : '500' }} numberOfLines={1}>
                        {option.label}
                      </Text>
                      {active && <Check color={c.accent} size={16} />}
                    </Pressable>
                  );
                })
              )}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}
