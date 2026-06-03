import { useLocalSearchParams } from 'expo-router';
import { RefreshCw } from 'lucide-react-native';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActionSheetIOS, ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useListRefresh } from '@/hooks/use-list-refresh';
import type { BraidProject, GitBranchStatus, GitChange } from '@/transport/types';
import { IconButton, ScreenHeader } from '@/ui/kit';
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
  const { t } = useTranslation();
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
  const branch = summary?.current ?? paramBranch ?? t('sourceControl.workingTree');
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
    const isDelete = change.status === '?';
    const verb = isDelete ? t('sourceControl.delete') : t('sourceControl.discard');
    const title = isDelete ? t('sourceControl.deleteChangesTitle') : t('sourceControl.discardChangesTitle');
    Alert.alert(title, change.file, [
      { text: t('common.cancel'), style: 'cancel' },
      { text: verb, style: 'destructive', onPress: () => void mutateFile(change, 'discard') },
    ]);
  }, [mutateFile, t]);

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
          Alert.alert(t('sourceControl.divergedTitle'), t('sourceControl.divergedMessage'), [
            { text: t('common.cancel'), style: 'cancel' },
            { text: t('sourceControl.rebase'), onPress: () => pull('rebase') },
            { text: t('sourceControl.merge'), onPress: () => pull('merge') },
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
        Alert.alert(t('sourceControl.discardAllTitle'), t('sourceControl.discardAllMessage', { count: targets.length }), [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('sourceControl.discardAll'),
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
        { options: [t('sourceControl.push'), t('sourceControl.pull'), t('sourceControl.discardAllChanges'), t('common.cancel')], destructiveButtonIndex: 2, cancelButtonIndex: 3 },
        (index) => run(index),
      );
    } else {
      Alert.alert(t('sourceControl.title'), undefined, [
        { text: t('sourceControl.push'), onPress: () => run(0) },
        { text: t('sourceControl.pull'), onPress: () => run(1) },
        { text: t('sourceControl.discardAllChanges'), style: 'destructive', onPress: () => run(2) },
        { text: t('common.cancel'), style: 'cancel' },
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
        <ScreenHeader
          title={t('sourceControl.title')}
          subtitle={branch}
          back
          compact
          style={{ paddingHorizontal: 8, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: c.border, backgroundColor: c.bg }}
          trailing={
            <IconButton
              icon={<RefreshCw color={c.text} size={19} />}
              onPress={() => void refreshNow()}
              accessibilityLabel={t('common.refresh')}
              size="sm"
            />
          }
        />

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
            <Text style={{ color: c.muted, fontSize: 14, textAlign: 'center', paddingTop: 32 }}>{t('sourceControl.noChanges')}</Text>
          ) : (
            groups.map((group) => (
              <View key={group.key} style={{ marginTop: 8 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 8 }}>
                  <Text style={{ flex: 1, color: c.subtle, fontSize: 12, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5 }}>{t(`sourceControl.group.${group.key}`)}</Text>
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
            <Text style={{ flex: 1, color: c.subtle, fontSize: 13, textAlign: 'center' }}>{t('sourceControl.noStagedFiles')}</Text>
          ) : (
            <TextInput
              value={commitMsg}
              onChangeText={setCommitMsg}
              placeholder={t('sourceControl.commitPlaceholder', { count: stagedCount })}
              placeholderTextColor={c.subtle}
              autoCapitalize="sentences"
              style={{ flex: 1, minHeight: 38, borderRadius: 8, backgroundColor: c.panelStrong, color: c.text, paddingHorizontal: 12, paddingVertical: 8, fontSize: 14 }}
            />
          )}
          <Pressable
            style={{ minHeight: 38, borderRadius: 8, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18, backgroundColor: canCommit ? c.accent : c.panelStrong, opacity: canCommit ? 1 : 0.6 }}
            disabled={!canCommit}
            onPress={commit}
            accessibilityLabel={t('sourceControl.commitStagedFiles')}
          >
            {busy ? <ActivityIndicator color={canCommit ? '#FFFFFF' : c.muted} size="small" /> : <Text style={{ color: canCommit ? '#FFFFFF' : c.muted, fontSize: 14, fontWeight: '800' }}>{t('sourceControl.commit')}</Text>}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
      <DiffSheet change={diff.change} text={diff.text} loading={diff.loading} onClose={() => setDiff({ change: null, text: '', loading: false })} />
    </SafeAreaView>
  );
}
