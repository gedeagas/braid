import { router, useLocalSearchParams } from 'expo-router';
import { ChevronLeft, FileDiff, RefreshCw } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { BraidProject, BraidWorktree, GitChange } from '@/transport/types';
import { colors, shared } from '@/ui/theme';
import { useHostClient } from '@/ui/use-host-client';

export default function GitScreen() {
  const { hostId } = useLocalSearchParams<{ hostId: string }>();
  const { client } = useHostClient(hostId);
  const [worktrees, setWorktrees] = useState<BraidWorktree[]>([]);
  const [active, setActive] = useState<BraidWorktree | null>(null);
  const [changes, setChanges] = useState<GitChange[]>([]);
  const [diff, setDiff] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!client) return;
    setError(null);
    try {
      const projects = await client.request<BraidProject[]>('projects.list');
      const all = projects.flatMap((project) => (project.worktrees ?? []).map((worktree) => ({ ...worktree, path: worktree.path })));
      setWorktrees(all);
      const next = active ?? all[0] ?? null;
      setActive(next);
      if (next) setChanges(await client.request<GitChange[]>('git.status', { worktreePath: next.path }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [active, client]);

  useEffect(() => { void load(); }, [load]);

  const openDiff = async (change: GitChange) => {
    if (!client || !active) return;
    setDiff(await client.request<string>('git.fileDiff', { worktreePath: active.path, file: change.file, status: change.status, staged: change.staged }));
  };

  return (
    <SafeAreaView style={shared.safe}>
      <View style={shared.shell}>
        <View style={shared.header}>
          <Pressable style={[shared.button, shared.secondary]} onPress={() => router.back()}><ChevronLeft color={colors.text} size={18} /></Pressable>
          <Pressable style={[shared.button, shared.secondary]} onPress={load}><RefreshCw color={colors.text} size={18} /></Pressable>
        </View>
        <Text style={shared.title}>Git review</Text>
        {error && <Text style={[shared.subtitle, { color: colors.danger }]}>{error}</Text>}
        <ScrollView horizontal contentContainerStyle={{ gap: 8, paddingVertical: 12 }}>
          {worktrees.map((worktree) => (
            <Pressable key={worktree.path} style={[shared.button, active?.path === worktree.path ? shared.primary : shared.secondary]} onPress={() => { setActive(worktree); setDiff(''); }}>
              <Text style={shared.buttonText}>{worktree.branch}</Text>
            </Pressable>
          ))}
        </ScrollView>
        <ScrollView contentContainerStyle={{ gap: 10, paddingBottom: 18 }}>
          {changes.map((change) => (
            <Pressable key={`${change.file}-${change.staged}`} style={[shared.card, { gap: 6 }]} onPress={() => openDiff(change)}>
              <View style={[shared.row, { gap: 10 }]}>
                <FileDiff color={colors.accent} size={17} />
                <Text style={{ color: colors.text, fontWeight: '800', flex: 1 }} numberOfLines={1}>{change.file}</Text>
                <Text style={{ color: change.staged ? colors.success : colors.warning, fontWeight: '800' }}>{change.status}</Text>
              </View>
              <Text style={shared.muted}>{change.staged ? 'staged' : 'unstaged'} · +{change.additions ?? 0} -{change.deletions ?? 0}</Text>
            </Pressable>
          ))}
          {diff ? <View style={shared.card}><Text style={shared.section}>Diff</Text><Text style={shared.code}>{diff.slice(0, 12000)}</Text></View> : null}
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}
