import { FileText, Minus, Plus, Trash2 } from 'lucide-react-native';
import { ActivityIndicator, Pressable, Text } from 'react-native';

import type { GitChange } from '@/transport/types';
import { useTheme } from '@/ui/theme';

import { statusColor, statusLetter } from './helpers';

/**
 * A single changed-file row: status letter, file path, and trailing
 * stage/unstage (+/-) and discard (trash) actions. Tapping the row body opens
 * the diff. Buttons disable + show a spinner while their op is in flight.
 */
export function FileRow({
  change,
  busy,
  onOpenDiff,
  onToggleStage,
  onDiscard,
}: {
  change: GitChange;
  busy: boolean;
  onOpenDiff: (change: GitChange) => void;
  onToggleStage: (change: GitChange) => void;
  onDiscard: (change: GitChange) => void;
}) {
  const c = useTheme().palette;
  const dir = change.file.includes('/') ? change.file.slice(0, change.file.lastIndexOf('/') + 1) : '';
  const name = dir ? change.file.slice(dir.length) : change.file;

  return (
    <Pressable
      style={({ pressed }) => [
        { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 10 },
        pressed && { backgroundColor: c.panel },
      ]}
      onPress={() => onOpenDiff(change)}
      accessibilityLabel={`Open diff for ${change.file}`}
    >
      <Text style={{ width: 16, color: statusColor(change, c), fontSize: 13, fontWeight: '800', textAlign: 'center' }}>
        {statusLetter(change)}
      </Text>
      <FileText color={c.muted} size={17} />
      <Text style={{ flex: 1, color: c.text, fontSize: 14, fontWeight: '600' }} numberOfLines={1} ellipsizeMode="middle">
        {dir ? <Text style={{ color: c.subtle }}>{dir}</Text> : null}
        {name}
      </Text>
      {busy ? (
        <ActivityIndicator color={c.muted} size="small" style={{ width: 30 }} />
      ) : (
        <Pressable
          hitSlop={6}
          style={{ width: 30, height: 30, alignItems: 'center', justifyContent: 'center' }}
          onPress={() => onToggleStage(change)}
          accessibilityLabel={change.staged ? `Unstage ${change.file}` : `Stage ${change.file}`}
        >
          {change.staged ? <Minus color={c.muted} size={19} /> : <Plus color={c.muted} size={19} />}
        </Pressable>
      )}
      <Pressable
        hitSlop={6}
        disabled={busy}
        style={{ width: 30, height: 30, alignItems: 'center', justifyContent: 'center', opacity: busy ? 0.35 : 1 }}
        onPress={() => onDiscard(change)}
        accessibilityLabel={`Discard ${change.file}`}
      >
        <Trash2 color={c.danger} size={18} />
      </Pressable>
    </Pressable>
  );
}
