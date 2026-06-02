import { router, useLocalSearchParams } from 'expo-router';
import { ChevronLeft, RefreshCw } from 'lucide-react-native';
import { useCallback, useMemo, useState } from 'react';
import { ActionSheetIOS, ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useListRefresh } from '@/hooks/use-list-refresh';
import type { BraidProject, GitBranchStatus, GitChange } from '@/transport/types';
import { CornerInset } from '@/ui/kit';
import { useTheme } from '@/ui/theme';
import { useHostClient } from '@/ui/use-host-client';

import { BranchCard } from './BranchCard';
import { DiffSheet } from './DiffSheet';
import { FileRow } from './FileRow';
import { changeKey, discardTargets, groupChanges, stagedFiles, unstagedFiles } from './helpers';

interface DiffState {
  change: GitChange | null;
  text: string;
  loading: boolean;
}

export default function SourceControlScreen() {
  const { hostId, worktreePath, worktreeName } = useLocalSearchParams<{ hostId: string; worktreePath?: string; worktreeName?: string }>();
  const { client } = useHostClient(hostId);
  const c = useTheme().palette;

  const [path, setPath] = useState<string | null>(typeof worktreePath === 'string' && worktreePath ? worktreePath : null);
  const [paramBranch] = useState<string | null>(typeof worktreeName === 'string' && worktreeName ? worktreeName : null);
  const [changes, setChanges] = useState<GitChange[]>([]);
  const [summary, setSummary] = useState<GitBranchStatus | null>(null);
  const [commitMsg, setCommitMsg] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Set<string>>(() => new Set());
  const [diff, setDiff] = useState<DiffState>({ change: null, text: '', loading: false });
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!client) return;
    setError(null);
    try {
      let target = path;
      if (!target) {
        const projects = await client.request<BraidProject[]>('projects.list');
        const first = projects.flatMap((project) => project.worktrees ?? [])[0] ?? null;
        if (first) {
          target = first.path;
          setPath(first.path);
        }
      }
      if (!target) {
        setChanges([]);
        setSummary(null);
        return;
      }
      const [nextChanges, nextSummary] = await Promise.all([
        client.request<GitChange[]>('git.status', { worktreePath: target }),
        client.request<GitBranchStatus>('git.branchStatus', { worktreePath: target }).catch(() => null),
      ]);
      setChanges(nextChanges);
      setSummary(nextSummary);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [client, path]);

  const { scrollRef, onScroll, refreshNow } = useListRefresh<ScrollView>(`sc:${hostId ?? 'unknown'}:${path ?? ''}`, load, !!client);

  const onPullRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refreshNow();
    } finally {
      setRefreshing(false);
    }
  }, [refreshNow]);

  const groups = useMemo(() => groupChanges(changes), [changes]);
  const stagedCount = useMemo(() => changes.filter((change) => change.staged).length, [changes]);
  const changedCount = useMemo(() => changes.filter((change) => !change.staged).length, [changes]);
  const branch = summary?.current ?? paramBranch ?? 'Working tree';
  const canCommit = stagedCount > 0 && commitMsg.trim().length > 0 && !busy;

  // Wrap a global op (commit / bulk action / push / pull) so the card shows a
  // spinner and re-pulls status on completion.
  const runGlobal = useCallback(async (fn: () => Promise<void>) => {
    if (!client || !path || busy) return;
    setBusy(true);
    setError(null);
    try {
      await fn();
      await refreshNow();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [busy, client, path, refreshNow]);

  // Per-file stage / unstage / discard, tracking an in-flight key so the row's
  // buttons disable individually without blocking the whole screen.
  const mutateFile = useCallback(async (change: GitChange, op: 'stage' | 'unstage' | 'discard') => {
    if (!client || !path) return;
    const key = changeKey(change);
    setPending((prev) => new Set(prev).add(key));
    setError(null);
    try {
      if (op === 'stage') await client.request('git.stage', { worktreePath: path, files: [change.file] });
      else if (op === 'unstage') await client.request('git.unstage', { worktreePath: path, files: [change.file] });
      else await client.request('git.discard', { worktreePath: path, file: change.file, status: change.status, staged: change.staged });
      await refreshNow();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  }, [client, path, refreshNow]);

  const confirmDiscard = useCallback((change: GitChange) => {
    const verb = change.status === '?' ? 'Delete' : 'Discard';
    Alert.alert(`${verb} changes?`, change.file, [
      { text: 'Cancel', style: 'cancel' },
      { text: verb, style: 'destructive', onPress: () => void mutateFile(change, 'discard') },
    ]);
  }, [mutateFile]);

  const openDiff = useCallback(async (change: GitChange) => {
    if (!client || !path) return;
    setDiff({ change, text: '', loading: true });
    try {
      const text = await client.request<string>('git.fileDiff', { worktreePath: path, file: change.file, status: change.status, staged: change.staged });
      setDiff({ change, text, loading: false });
    } catch (err) {
      setDiff({ change, text: err instanceof Error ? err.message : String(err), loading: false });
    }
  }, [client, path]);

  // Function declaration (not useCallback) so the divergent-branch retry can
  // call itself with an explicit strategy without a use-before-declaration.
  function pull(strategy?: 'rebase' | 'merge') {
    void runGlobal(async () => {
      if (!client || !path) return;
      try {
        await client.request('git.pull', { worktreePath: path, ...(strategy ? { strategy } : {}) });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg === 'DIVERGENT_BRANCHES') {
          Alert.alert('Branches have diverged', 'Choose how to reconcile your local and remote commits.', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Rebase', onPress: () => pull('rebase') },
            { text: 'Merge', onPress: () => pull('merge') },
          ]);
          return;
        }
        throw err;
      }
    });
  }

  function openMore() {
    const run = (index: number) => {
      if (index === 0) void runGlobal(() => client!.request('git.push', { worktreePath: path }));
      else if (index === 1) pull();
      else if (index === 2) {
        const targets = discardTargets(changes);
        if (targets.length === 0) return;
        Alert.alert('Discard all changes?', `This reverts ${targets.length} file(s) and cannot be undone.`, [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Discard all',
            style: 'destructive',
            onPress: () => void runGlobal(async () => {
              for (const change of targets) {
                await client!.request('git.discard', { worktreePath: path, file: change.file, status: change.status, staged: change.staged });
              }
            }),
          },
        ]);
      }
    };
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { options: ['Push', 'Pull', 'Discard all changes', 'Cancel'], destructiveButtonIndex: 2, cancelButtonIndex: 3 },
        (index) => run(index),
      );
    } else {
      Alert.alert('Source control', undefined, [
        { text: 'Push', onPress: () => run(0) },
        { text: 'Pull', onPress: () => run(1) },
        { text: 'Discard all changes', style: 'destructive', onPress: () => run(2) },
        { text: 'Cancel', style: 'cancel' },
      ]);
    }
  }

  const commit = useCallback(() => {
    const message = commitMsg.trim();
    if (!message || stagedCount === 0) return;
    void runGlobal(async () => {
      await client!.request('git.commit', { worktreePath: path, message });
      setCommitMsg('');
    });
  }, [client, commitMsg, path, runGlobal, stagedCount]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['top', 'left', 'right', 'bottom']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: c.border, backgroundColor: c.bg }}>
          <CornerInset />
          <Pressable style={{ width: 36, height: 36, borderRadius: 8, alignItems: 'center', justifyContent: 'center' }} onPress={() => router.back()} accessibilityLabel="Go back">
            <ChevronLeft color={c.text} size={22} />
          </Pressable>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ color: c.text, fontSize: 20, fontWeight: '800' }} numberOfLines={1}>Source Control</Text>
            <Text style={{ color: c.muted, fontSize: 13 }} numberOfLines={1}>{branch}</Text>
          </View>
          <Pressable style={{ width: 36, height: 36, borderRadius: 8, alignItems: 'center', justifyContent: 'center' }} onPress={() => void refreshNow()} accessibilityLabel="Refresh">
            <RefreshCw color={c.text} size={19} />
          </Pressable>
        </View>

        {error ? <Text style={{ color: c.danger, fontSize: 12, paddingHorizontal: 16, paddingTop: 8 }}>{error}</Text> : null}

        <ScrollView
          ref={scrollRef}
          onScroll={onScroll}
          scrollEventThrottle={16}
          contentContainerStyle={{ paddingBottom: 16 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onPullRefresh} tintColor={c.muted} colors={[c.accent]} />}
        >
          <BranchCard
            branch={branch}
            ahead={summary?.ahead ?? 0}
            behind={summary?.behind ?? 0}
            changedCount={changedCount}
            stagedCount={stagedCount}
            busy={busy}
            onStageAll={() => void runGlobal(() => client!.request('git.stage', { worktreePath: path, files: unstagedFiles(changes) }))}
            onUnstageAll={() => void runGlobal(() => client!.request('git.unstage', { worktreePath: path, files: stagedFiles(changes) }))}
            onMore={openMore}
          />

          {groups.length === 0 ? (
            <Text style={{ color: c.muted, fontSize: 14, textAlign: 'center', paddingTop: 32 }}>No changes</Text>
          ) : (
            groups.map((group) => (
              <View key={group.key} style={{ marginTop: 8 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 8 }}>
                  <Text style={{ flex: 1, color: c.subtle, fontSize: 12, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5 }}>{group.title}</Text>
                  <Text style={{ color: c.subtle, fontSize: 12, fontWeight: '800' }}>{group.changes.length}</Text>
                </View>
                {group.changes.map((change, index) => (
                  <View key={changeKey(change)}>
                    {index > 0 ? <View style={{ height: 1, marginLeft: 16, backgroundColor: c.border }} /> : null}
                    <FileRow
                      change={change}
                      busy={pending.has(changeKey(change))}
                      onOpenDiff={openDiff}
                      onToggleStage={(item) => void mutateFile(item, item.staged ? 'unstage' : 'stage')}
                      onDiscard={confirmDiscard}
                    />
                  </View>
                ))}
              </View>
            ))
          )}
        </ScrollView>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 10, borderTopWidth: 1, borderTopColor: c.border, backgroundColor: c.panel }}>
          {stagedCount === 0 ? (
            <Text style={{ flex: 1, color: c.subtle, fontSize: 13, textAlign: 'center' }}>No staged files</Text>
          ) : (
            <TextInput
              value={commitMsg}
              onChangeText={setCommitMsg}
              placeholder={`Message (commit ${stagedCount} file${stagedCount === 1 ? '' : 's'})`}
              placeholderTextColor={c.subtle}
              autoCapitalize="sentences"
              style={{ flex: 1, minHeight: 38, borderRadius: 8, backgroundColor: c.panelStrong, color: c.text, paddingHorizontal: 12, paddingVertical: 8, fontSize: 14 }}
            />
          )}
          <Pressable
            style={{ minHeight: 38, borderRadius: 8, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18, backgroundColor: canCommit ? c.accent : c.panelStrong, opacity: canCommit ? 1 : 0.6 }}
            disabled={!canCommit}
            onPress={commit}
            accessibilityLabel="Commit staged files"
          >
            {busy ? <ActivityIndicator color={canCommit ? '#FFFFFF' : c.muted} size="small" /> : <Text style={{ color: canCommit ? '#FFFFFF' : c.muted, fontSize: 14, fontWeight: '800' }}>Commit</Text>}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
      <DiffSheet change={diff.change} text={diff.text} loading={diff.loading} onClose={() => setDiff({ change: null, text: '', loading: false })} />
    </SafeAreaView>
  );
}
