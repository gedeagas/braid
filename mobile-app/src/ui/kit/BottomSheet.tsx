import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Modal, Platform, Pressable, Text, View } from 'react-native';
import { X } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '@/ui/theme';
import { IconButton } from './IconButton';

export function BottomSheet({
  visible,
  title,
  children,
  footer,
  onClose,
}: {
  visible: boolean;
  title?: string;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { palette: c } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <Pressable
          style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0, 0, 0, 0.56)' }}
          onPress={onClose}
        >
          <Pressable
            style={{
              maxHeight: '88%',
              borderTopLeftRadius: 18,
              borderTopRightRadius: 18,
              borderWidth: 1,
              borderColor: c.border,
              backgroundColor: c.bg,
              paddingHorizontal: 18,
              paddingTop: 14,
              paddingBottom: Math.max(16, insets.bottom + 12),
            }}
            onPress={() => undefined}
          >
            {title ? (
              <View style={{ minHeight: 40, flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 8 }}>
                <Text style={{ flex: 1, color: c.text, fontSize: 20, fontWeight: '800' }} numberOfLines={1}>
                  {title}
                </Text>
                <IconButton
                  icon={<X color={c.text} size={18} />}
                  onPress={onClose}
                  accessibilityLabel={t('common.close')}
                  size="sm"
                  variant="panel"
                />
              </View>
            ) : null}
            {children}
            {footer ? <View style={{ paddingTop: 12 }}>{footer}</View> : null}
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}
