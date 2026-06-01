import { GitBranch, Minus, MoreHorizontal, Plus } from 'lucide-react-native';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';

import { useTheme } from '@/ui/theme';

/**
 * The summary card at the top of the source-control screen: current branch,
 * changed/staged counts, and the bulk Stage All / Unstage All / overflow
 * (push, pull, discard all) actions.
 */
export function BranchCard({
  branch,
  ahead,
  behind,
  changedCount,
  stagedCount,
  busy,
  onStageAll,
  onUnstageAll,
  onMore,
}: {
  branch: string;
  ahead: number;
  behind: number;
  changedCount: number;
  stagedCount: number;
  busy: boolean;
  onStageAll: () => void;
  onUnstageAll: () => void;
  onMore: () => void;
}) {
  const c = useTheme().palette;
  const canStageAll = changedCount > 0 && !busy;
  const canUnstageAll = stagedCount > 0 && !busy;

  const action = {
    flex: 1,
    minHeight: 40,
    borderRadius: 8,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 6,
    backgroundColor: c.panelStrong,
    borderWidth: 1,
    borderColor: c.border,
  };

  return (
    <View
      style={{ margin: 12, borderRadius: 12, borderWidth: 1, borderColor: c.border, backgroundColor: c.panel, padding: 14, gap: 12 }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <GitBranch color={c.text} size={17} />
        <Text style={{ flex: 1, color: c.text, fontSize: 16, fontWeight: '800' }} numberOfLines={1}>
          {branch}
        </Text>
        {busy ? (
          <ActivityIndicator color={c.muted} size="small" />
        ) : (
          <Text style={{ color: c.muted, fontSize: 12, fontWeight: '600' }}>
            {ahead} ahead, {behind} behind
          </Text>
        )}
      </View>
      <Text style={{ color: c.muted, fontSize: 12, fontWeight: '700' }}>
        {changedCount} changed   {stagedCount} staged
      </Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Pressable style={[action, !canStageAll && { opacity: 0.4 }]} disabled={!canStageAll} onPress={onStageAll}>
          <Plus color={c.text} size={16} />
          <Text style={{ color: c.text, fontSize: 13, fontWeight: '800' }}>Stage All</Text>
        </Pressable>
        <Pressable style={[action, !canUnstageAll && { opacity: 0.4 }]} disabled={!canUnstageAll} onPress={onUnstageAll}>
          <Minus color={c.text} size={16} />
          <Text style={{ color: c.text, fontSize: 13, fontWeight: '800' }}>Unstage All</Text>
        </Pressable>
        <Pressable
          style={{ width: 44, minHeight: 40, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: c.panelStrong, borderWidth: 1, borderColor: c.border, opacity: busy ? 0.4 : 1 }}
          disabled={busy}
          onPress={onMore}
          accessibilityLabel="More source control actions"
        >
          <MoreHorizontal color={c.text} size={18} />
        </Pressable>
      </View>
    </View>
  );
}
