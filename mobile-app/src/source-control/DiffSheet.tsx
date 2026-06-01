import { X } from 'lucide-react-native';
import { ActivityIndicator, Modal, Platform, Pressable, ScrollView, Text, View } from 'react-native';

import type { GitChange } from '@/transport/types';
import { useTheme } from '@/ui/theme';

import { statusLabel } from './helpers';

const MONO = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' });
// Cap rendered diff so very large files don't jank the JS thread.
const MAX_DIFF_CHARS = 20000;

/** Full-screen modal showing a colorized unified diff for one file. */
export function DiffSheet({
  change,
  text,
  loading,
  onClose,
}: {
  change: GitChange | null;
  text: string;
  loading: boolean;
  onClose: () => void;
}) {
  const c = useTheme().palette;
  const truncated = text.length > MAX_DIFF_CHARS;
  const body = truncated ? text.slice(0, MAX_DIFF_CHARS) : text;
  const lines = body.split('\n');

  const lineColor = (line: string): string => {
    if (line.startsWith('+') && !line.startsWith('+++')) return c.success;
    if (line.startsWith('-') && !line.startsWith('---')) return c.danger;
    if (line.startsWith('@@')) return c.accent;
    if (line.startsWith('diff ') || line.startsWith('index ') || line.startsWith('+++') || line.startsWith('---')) return c.subtle;
    return c.muted;
  };

  return (
    <Modal visible={change != null} transparent={false} animationType="slide" onRequestClose={onClose} presentationStyle="fullScreen">
      <View style={{ flex: 1, backgroundColor: c.bg }}>
        <View
          style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingTop: 54, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: c.border, backgroundColor: c.panel }}
        >
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ color: c.text, fontSize: 14, fontWeight: '800' }} numberOfLines={1} ellipsizeMode="middle">
              {change?.file ?? ''}
            </Text>
            <Text style={{ color: c.muted, fontSize: 12, marginTop: 2 }}>
              {change ? `${statusLabel(change)} · ${change.staged ? 'staged' : 'unstaged'}` : ''}
            </Text>
          </View>
          <Pressable
            style={{ width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: c.panelStrong }}
            onPress={onClose}
            accessibilityLabel="Close diff"
          >
            <X color={c.text} size={18} />
          </Pressable>
        </View>
        {loading ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <ActivityIndicator color={c.muted} />
          </View>
        ) : (
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 10 }}>
            <ScrollView horizontal contentContainerStyle={{ paddingHorizontal: 14 }}>
              <View>
                {lines.map((line, index) => (
                  <Text key={index} style={{ color: lineColor(line), fontFamily: MONO, fontSize: 12, lineHeight: 17 }}>
                    {line.length ? line : ' '}
                  </Text>
                ))}
                {truncated ? (
                  <Text style={{ color: c.subtle, fontFamily: MONO, fontSize: 12, lineHeight: 17, marginTop: 8 }}>
                    … diff truncated
                  </Text>
                ) : null}
              </View>
            </ScrollView>
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}
