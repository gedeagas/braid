import { router, useLocalSearchParams } from 'expo-router';
import { ChevronLeft, ChevronDown, GitBranch, GitMerge, GitPullRequest, GitPullRequestClosed, GitPullRequestDraft, Plus, RefreshCw, RotateCw, Search, SlidersHorizontal, X } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, SectionList, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useListRefresh } from '@/hooks/use-list-refresh';
import { usePersistedState } from '@/hooks/use-persisted-state';
import { CreateWorktreeModal } from '@/worktrees/CreateWorktreeModal';
import { useClientManager } from '@/transport/client-manager';
import { isErrorVerdict } from '@/transport/connection-health';
import { desktopSupports, evaluateCompatFromStatus } from '@/transport/protocol-compat';
import { MOBILE_CAPABILITY } from '@/transport/protocol-version';
import { removeHost } from '@/transport/host-store';
import type { BraidProject, BraidStatus, BraidWorktree, PrStatus } from '@/transport/types';
import { ConnectionLog } from '@/ui/ConnectionLog';
import { ProtocolBlockScreen } from '@/ui/ProtocolBlockScreen';
import { StatusDot } from '@/ui/StatusDot';
import { useShared, useTheme } from '@/ui/theme';
import { useHostClient } from '@/ui/use-host-client';

type HostSection = {
  key: string;
  title: string;
  project: BraidProject;
  data: BraidWorktree[];
};

// The worktree's display name is its folder (last path segment), NOT the branch -
// Braid lets the two diverge. Mirrors the desktop's worktreeName() so the row's
// primary label matches the desktop sidebar. Falls back to the branch when the
// path is somehow empty.
function worktreeName(path: string, fallback: string): string {
  return path.split('/').filter(Boolean).pop() || fallback;
}

export default function HostScreen() {
  const { hostId } = useLocalSearchParams<{ hostId: string }>();
  const { host, client, state: connState, verdict, reconnect } = useHostClient(hostId);
  const manager = useClientManager();
  const colors = useTheme().palette;
  const shared = useShared();
  const [status, setStatus] = useState<BraidStatus | null>(null);
  const [projects, setProjects] = useState<BraidProject[]>([]);
  const [terminalCounts, setTerminalCounts] = useState<Record<string, number>>({});
  // Per-worktree PR status, keyed by worktree path. undefined = not yet fetched,
  // null = no PR / gh unavailable, PrStatus = a PR exists. Populated lazily (see
  // effect below) so it never blocks the worktree list's first paint.
  const [prStatuses, setPrStatuses] = useState<Record<string, PrStatus | null>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [viewMode, setViewMode] = usePersistedState<'all' | 'active' | 'main'>(
    'braid.mobile.host.viewMode',
    'all',
    (v) => v === 'all' || v === 'active' || v === 'main',
  );
  const [groupMode, setGroupMode] = usePersistedState<'repo' | 'flat'>(
    'braid.mobile.host.groupMode',
    'repo',
    (v) => v === 'repo' || v === 'flat',
  );
  const [createOpen, setCreateOpen] = useState(false);

  const load = useCallback(async () => {
    if (!client) return;
    console.log('[BraidMobile] host.load.start', { hostId, endpoint: host?.endpoint });
    setError(null);
    setLoading(true);
    try {
      await client.connect();
      const nextStatus = await client.request<BraidStatus>('status.get');
      console.log('[BraidMobile] host.status', nextStatus);
      setStatus(nextStatus);
      const loadedProjects = await client.request<BraidProject[]>('projects.list');
      console.log('[BraidMobile] host.projects', loadedProjects.map((project) => ({
        id: project.id,
        name: project.name,
        path: project.path,
        worktreeCount: project.worktrees?.length ?? 0,
        worktrees: project.worktrees?.map((worktree) => ({
          id: worktree.id,
          branch: worktree.branch,
          path: worktree.path,
          isMain: worktree.isMain,
        })),
      })));
      setProjects(loadedProjects);

      const counts: Record<string, number> = {};
      // Fetch every worktree's terminal count concurrently. Sequential requests
      // serialized one round-trip per worktree, which scaled poorly for projects
      // with many worktrees and slowed the host screen's first paint.
      await Promise.all(
        loadedProjects.flatMap((project) =>
          (project.worktrees ?? []).map(async (worktree) => {
            try {
              const terminals = await client.request<unknown[]>('terminal.list', { worktreePath: worktree.path });
              counts[worktree.path] = terminals.length;
              console.log('[BraidMobile] host.terminalCount', { path: worktree.path, count: terminals.length });
            } catch (err) {
              console.error('[BraidMobile] host.terminalCount.error', {
                path: worktree.path,
                error: err instanceof Error ? err.message : String(err),
              });
              counts[worktree.path] = 0;
            }
          }),
        ),
      );
      setTerminalCounts(counts);
    } catch (err) {
      console.error('[BraidMobile] host.load.error', err instanceof Error ? err.message : String(err));
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [client, host?.endpoint, hostId]);

  const { scrollRef, onScroll, refreshNow } = useListRefresh<SectionList<BraidWorktree, HostSection>>(`host:${hostId ?? 'unknown'}`, load, !!client);

  // Reload the worktree list whenever the connection transitions back to
  // 'connected'. useListRefresh only refetches on focus or when its `enabled`
  // flag flips, but the manager reuses the same client across reconnects so that
  // flag never changes - without this, the Reconnect button (and any automatic
  // recovery) would repair the socket while the list stayed empty/stale.
  const prevConnRef = useRef(connState);
  useEffect(() => {
    const prev = prevConnRef.current;
    prevConnRef.current = connState;
    if (connState === 'connected' && prev !== 'connected' && client) {
      void refreshNow();
    }
  }, [connState, client, refreshNow]);

  // Lazily fetch each worktree's PR status (open/merged/closed) and let the icons
  // pop in as the gh CLI lookups resolve - deliberately NOT awaited in load() so a
  // repo with many worktrees never delays the list's first paint. Capability-gated:
  // older desktops (no gh bridge advertised) simply show no PR icons. Each lookup
  // is failure-tolerant (no PR / no gh / not a repo all collapse to null), so one
  // bad worktree never blocks the rest. Re-runs when `projects` changes (a refresh
  // produces a new array reference), keeping the badges in sync with the list.
  useEffect(() => {
    if (!client) return;
    if (!desktopSupports(status, MOBILE_CAPABILITY.githubPrStatus)) return;
    const worktrees = projects.flatMap((project) => project.worktrees ?? []);
    if (worktrees.length === 0) return;
    let cancelled = false;
    worktrees.forEach((worktree) => {
      // requestUnordered (not request): keep these slow gh-CLI lookups OFF the
      // serialized RPC queue so they never block interactive terminal RPCs.
      void client
        .requestUnordered<PrStatus | null>('github.prStatus', { worktreePath: worktree.path })
        .then((pr) => {
          if (!cancelled) setPrStatuses((prev) => ({ ...prev, [worktree.path]: pr }));
        })
        .catch(() => {
          if (!cancelled) setPrStatuses((prev) => ({ ...prev, [worktree.path]: null }));
        });
    });
    return () => {
      cancelled = true;
    };
  }, [client, projects, status]);

  const visibleProjects = useMemo(() => {
    const lower = query.trim().toLowerCase();
    const filtered = projects
      .map((project) => {
        const worktrees = (project.worktrees ?? []).filter((worktree) => {
          if (viewMode === 'active' && (terminalCounts[worktree.path] ?? 0) === 0) return false;
          if (viewMode === 'main' && !worktree.isMain) return false;
          if (!lower) return true;
          return [project.name, worktree.branch, worktree.path].some((value) => value?.toLowerCase().includes(lower));
        });
        return { ...project, worktrees };
      })
      .filter((project) => (project.worktrees ?? []).length > 0);

    return filtered.slice().sort((a, b) => a.name.localeCompare(b.name));
  }, [projects, query, terminalCounts, viewMode]);

  const sections = useMemo<HostSection[]>(() => {
    if (groupMode === 'flat') {
      const data = visibleProjects.flatMap((project) =>
        (project.worktrees ?? []).map((worktree) => ({ ...worktree, projectName: project.name }))
      ) as BraidWorktree[];
      return data.length > 0 ? [{ key: 'all', title: 'Worktrees', project: visibleProjects[0], data }] : [];
    }
    return visibleProjects.map((project) => ({
      key: project.id,
      title: project.name,
      project,
      data: project.worktrees ?? [],
    }));
  }, [groupMode, visibleProjects]);

  const totalWorktrees = projects.reduce((sum, project) => sum + (project.worktrees?.length ?? 0), 0);
  const visibleWorktrees = sections.reduce((sum, section) => sum + section.data.length, 0);

  const compat = evaluateCompatFromStatus(status);

  const activeHostId = host?.id ?? '';
  const openWorktree = (path: string, branch: string, autoAgentId?: string) => {
    if (!activeHostId) return;
    router.push({
      pathname: '/terminal/[hostId]',
      params: {
        hostId: activeHostId,
        worktreePath: path,
        worktreeName: branch,
        // When set, the terminal screen auto-launches this agent on arrival
        // (used right after creating a worktree with an agent picked).
        ...(autoAgentId ? { autoAgentId } : {}),
      },
    });
  };

  // Long-press a worktree to remove it (mirrors the desktop's per-worktree
  // delete). The main worktree is never removable.
  const confirmRemoveWorktree = (project: BraidProject, worktree: BraidWorktree) => {
    if (!client || worktree.isMain) return;
    Alert.alert('Remove worktree?', worktree.branch, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => {
          // Optimistically drop the row so it disappears instantly (mirrors the
          // desktop). The RPC now resolves only after the desktop's full teardown
          // (which may run an archive script first), so without this the row would
          // sit there with no feedback for the whole teardown. refreshNow()
          // reconciles on success; on failure we restore via refreshNow() too.
          setProjects((prev) =>
            prev.map((p) =>
              p.id === project.id
                ? { ...p, worktrees: (p.worktrees ?? []).filter((w) => w.path !== worktree.path) }
                : p
            )
          );
          void client
            .request('worktrees.remove', { repoPath: project.path, worktreePath: worktree.path })
            .then(() => refreshNow())
            .catch((err) => {
              setError(err instanceof Error ? err.message : String(err));
              void refreshNow();
            });
        },
      },
    ]);
  };

  // Re-pair: the device token was rejected, so send the user to the home
  // scanner to pair afresh (the pairing offer carries a new token).
  const goRepair = () => {
    router.replace({ pathname: '/', params: { pair: '1' } });
  };

  // Remove the host entirely: forget the rejected pairing and drop its client,
  // then return to the desktop list.
  const confirmRemoveHost = () => {
    if (!host) return;
    Alert.alert('Remove desktop', `Unpair "${host.instanceName ?? host.endpoint}"? You can re-pair later.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          manager.dropHost(host.id);
          await removeHost(host.id);
          router.replace('/');
        },
      },
    ]);
  };

  if (!host) {
    return (
      <SafeAreaView style={shared.safe}>
        <View style={shared.shell}>
          <Text style={shared.title}>Desktop not found</Text>
        </View>
      </SafeAreaView>
    );
  }

  // Incompatible desktop: hard-block the whole screen rather than letting the
  // user drive a peer that will silently misbehave.
  if (compat.kind === 'blocked' && status) {
    return <ProtocolBlockScreen verdict={compat} />;
  }

  const verdictIsError = isErrorVerdict(verdict);
  const showReconnect = verdictIsError && verdict.kind !== 'auth-failed';

  // Themed style objects, scoped to the component so they track the active
  // palette (light/dark) instead of capturing a static color at module load.
  const hostHeader = {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.panel,
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 8,
  };

  const titleRow = {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
  };

  const backButton = {
    width: 36,
    height: 36,
    borderRadius: 8,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  };

  const titleBlock = {
    flex: 1,
    minWidth: 0,
  };

  const statusTitleRow = {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
  };

  const verdictRow = {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
  };

  const verdictLabel = (error: boolean) => ({
    color: error ? colors.danger : colors.muted,
    fontSize: 11,
    fontWeight: '700' as const,
  });

  const reconnectButton = {
    height: 28,
    borderRadius: 8,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 5,
    paddingHorizontal: 10,
    backgroundColor: colors.panelStrong,
    borderWidth: 1,
    borderColor: colors.border,
  };

  const reconnectButtonText = {
    color: colors.text,
    fontSize: 12,
    fontWeight: '800' as const,
  };

  const authBanner = {
    marginHorizontal: 12,
    marginTop: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 90, 102, 0.35)',
    backgroundColor: 'rgba(255, 90, 102, 0.12)',
    padding: 12,
    gap: 10,
  };

  const authBannerText = {
    color: colors.text,
    fontSize: 13,
    lineHeight: 18,
  };

  const authActions = {
    flexDirection: 'row' as const,
    gap: 10,
  };

  const authAction = {
    minHeight: 36,
    borderRadius: 8,
    paddingHorizontal: 14,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    backgroundColor: colors.panelStrong,
    borderWidth: 1,
    borderColor: colors.border,
  };

  const authActionText = {
    fontSize: 13,
    fontWeight: '800' as const,
  };

  const connLogWrap = {
    marginHorizontal: 12,
    marginTop: 12,
  };

  const titleText = {
    color: colors.text,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '800' as const,
    flexShrink: 1,
  };

  const subtitleText = {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 16,
  };

  const refreshButton = {
    width: 36,
    height: 36,
    borderRadius: 8,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    backgroundColor: colors.panelStrong,
  };

  const controls = {
    gap: 10,
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.panel,
  };

  const searchBox = {
    minHeight: 38,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg,
    paddingHorizontal: 10,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
  };

  const actionRow = {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
  };

  const segmented = {
    flex: 1,
    minHeight: 34,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg,
    padding: 3,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
  };

  const segment = {
    flex: 1,
    minHeight: 26,
    borderRadius: 6,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  };

  const segmentActive = {
    backgroundColor: colors.panelStrong,
  };

  const segmentText = {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '800' as const,
  };

  const segmentTextActive = {
    color: colors.text,
  };

  const shortcutRow = {
    minHeight: 38,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.bg,
  };

  const resultText = {
    color: colors.subtle,
    fontSize: 12,
    fontWeight: '700' as const,
  };

  const iconButton = {
    width: 34,
    height: 34,
    borderRadius: 8,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  };

  const iconButtonActive = {
    backgroundColor: colors.panelStrong,
  };

  const searchInput = {
    flex: 1,
    minHeight: 36,
    color: colors.text,
    paddingVertical: 7,
    fontSize: 14,
  };

  const clearButton = {
    width: 26,
    height: 26,
    borderRadius: 6,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  };


  const listContent = {
    paddingTop: 8,
    paddingBottom: 24,
  };

  const emptyText = {
    color: colors.muted,
    fontSize: 13,
    paddingHorizontal: 12,
    paddingTop: 12,
  };

  const projectBlock = {
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 4,
  };

  const projectHeader = {
    minHeight: 24,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
  };

  const projectHeaderLeft = {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
  };

  const projectHeaderBullet = {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.subtle,
  };

  const projectHeaderText = {
    color: colors.subtle,
    fontSize: 11,
    fontWeight: '800' as const,
    letterSpacing: 0,
  };

  const projectHeaderCountPill = {
    minWidth: 24,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.panelStrong,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    paddingHorizontal: 7,
  };

  const projectHeaderCount = {
    color: colors.muted,
    fontSize: 11,
    fontWeight: '800' as const,
  };

  const worktreeRow = {
    minHeight: 54,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
  };

  const worktreeRowPressed = {
    backgroundColor: colors.panel,
  };

  const worktreeStatusCol = {
    width: 20,
    alignItems: 'center' as const,
  };

  const worktreeStatusDot = {
    width: 12,
    height: 12,
    borderRadius: 6,
  };

  const worktreeStatusDotActive = {
    backgroundColor: colors.success,
  };

  const worktreeStatusDotIdle = {
    backgroundColor: colors.subtle,
  };

  const worktreeTitleRow = {
    minHeight: 21,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
  };

  const worktreeTitle = {
    color: colors.text,
    fontSize: 16,
    lineHeight: 20,
    fontWeight: '800' as const,
    flexShrink: 1,
  };

  const worktreeSubtitleRow = {
    minHeight: 16,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 4,
  };

  const worktreeSubtitle = {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 16,
    flexShrink: 1,
  };

  const mainBadge = {
    height: 19,
    borderRadius: 6,
    backgroundColor: 'rgba(53, 201, 139, 0.12)',
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 4,
    paddingHorizontal: 6,
  };

  const mainBadgeText = {
    color: colors.success,
    fontSize: 10,
    fontWeight: '800' as const,
  };

  const prBadge = {
    height: 19,
    borderRadius: 6,
    borderWidth: 1,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 4,
    paddingHorizontal: 6,
  };

  const prBadgeText = {
    fontSize: 10,
    fontWeight: '800' as const,
  };

  // Maps a PR to its icon + color, mirroring the desktop sidebar's PrIcon:
  // open=green, merged=purple, closed=red, draft=muted. Merged purple has no
  // palette token (it isn't a UI surface), so it's a literal shared with desktop.
  const prVisual = (pr: PrStatus) => {
    const state = pr.state?.toLowerCase();
    if (state === 'merged') return { Icon: GitMerge, color: '#a371f7' };
    if (state === 'closed') return { Icon: GitPullRequestClosed, color: colors.danger };
    if (pr.isDraft) return { Icon: GitPullRequestDraft, color: colors.muted };
    return { Icon: GitPullRequest, color: colors.success };
  };

  const countBadge = {
    minWidth: 28,
    height: 24,
    borderRadius: 12,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    backgroundColor: colors.panelStrong,
    paddingHorizontal: 8,
  };

  const countBadgeActive = {
    backgroundColor: 'rgba(61, 139, 255, 0.16)',
  };

  const worktreeCount = {
    color: colors.subtle,
    fontSize: 12,
    fontWeight: '800' as const,
  };

  const worktreeCountActive = {
    color: colors.accent,
  };

  return (
    <SafeAreaView style={[shared.safe, { backgroundColor: colors.panel }]} edges={['top', 'left', 'right']}>
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <View style={hostHeader}>
          <View style={titleRow}>
            <Pressable style={backButton} onPress={() => router.back()} accessibilityLabel="Go back">
              <ChevronLeft color={colors.text} size={21} />
            </Pressable>
            <View style={titleBlock}>
              <View style={statusTitleRow}>
                <Text style={titleText} numberOfLines={1}>
                  {status?.instanceName ?? host.instanceName ?? 'Host'}
                </Text>
                <View style={verdictRow}>
                  <StatusDot state={connState} verdict={verdict} size={7} />
                  <Text style={verdictLabel(verdictIsError)}>{verdict.label}</Text>
                </View>
              </View>
              <Text style={subtitleText} numberOfLines={1}>
                {host.endpoint}
              </Text>
            </View>
            {showReconnect && (
              <Pressable style={reconnectButton} onPress={reconnect} accessibilityLabel="Reconnect">
                <RotateCw color={colors.text} size={13} />
                <Text style={reconnectButtonText}>Reconnect</Text>
              </Pressable>
            )}
            <Pressable style={refreshButton} onPress={() => void refreshNow()} accessibilityLabel="Refresh host">
              {loading ? <ActivityIndicator color={colors.text} size="small" /> : <RefreshCw color={colors.text} size={17} />}
            </Pressable>
          </View>
        </View>

        <View style={controls}>
          <View style={searchBox}>
            <Search color={colors.muted} size={16} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search worktrees"
              placeholderTextColor={colors.subtle}
              autoCapitalize="none"
              autoCorrect={false}
              style={searchInput}
            />
            {query.length > 0 && (
              <Pressable style={clearButton} onPress={() => setQuery('')} accessibilityLabel="Clear search">
                <X color={colors.muted} size={15} />
              </Pressable>
            )}
          </View>

          <View style={actionRow}>
            <View style={segmented}>
              {(['all', 'active', 'main'] as const).map((mode) => (
                <Pressable
                  key={mode}
                  style={[segment, viewMode === mode && segmentActive]}
                  onPress={() => setViewMode(mode)}
                >
                  <Text style={[segmentText, viewMode === mode && segmentTextActive]}>
                    {mode === 'all' ? 'All' : mode === 'active' ? 'Active' : 'Main'}
                  </Text>
                </Pressable>
              ))}
            </View>
            <Pressable
              style={[iconButton, groupMode === 'flat' && iconButtonActive]}
              onPress={() => setGroupMode(groupMode === 'repo' ? 'flat' : 'repo')}
              accessibilityLabel="Toggle grouping"
            >
              <SlidersHorizontal color={groupMode === 'flat' ? colors.text : colors.muted} size={17} />
            </Pressable>
          </View>
        </View>

        <View style={shortcutRow}>
          <Text style={resultText}>
            {visibleWorktrees} of {totalWorktrees} worktrees
          </Text>
          <View style={{ flex: 1 }} />
          <Pressable style={iconButton} onPress={() => setCreateOpen(true)} accessibilityLabel="Add worktree">
            <Plus color={colors.muted} size={18} />
          </Pressable>
        </View>

        {error && <Text style={[shared.subtitle, { color: colors.danger, paddingHorizontal: 12, paddingTop: 6 }]}>{error}</Text>}
        {connState === 'auth-failed' && (
          <View style={authBanner}>
            <Text style={authBannerText}>
              Pairing rejected. Re-pair from desktop Settings › Mobile, or remove this desktop.
            </Text>
            <View style={authActions}>
              <Pressable style={authAction} onPress={goRepair} accessibilityLabel="Re-pair">
                <Text style={[authActionText, { color: colors.text }]}>Re-pair</Text>
              </Pressable>
              <Pressable style={authAction} onPress={confirmRemoveHost} accessibilityLabel="Remove desktop">
                <Text style={[authActionText, { color: colors.danger }]}>Remove</Text>
              </Pressable>
            </View>
          </View>
        )}
        {showReconnect && (
          <View style={connLogWrap}>
            <ConnectionLog title="Connection log" entries={manager.getConnectionLog(host.id)} />
          </View>
        )}

        <SectionList
          ref={scrollRef}
          onScroll={onScroll}
          scrollEventThrottle={16}
          sections={sections}
          keyExtractor={(item) => item.path}
          contentContainerStyle={listContent}
          stickySectionHeadersEnabled={false}
          ListEmptyComponent={<Text style={emptyText}>No worktrees found.</Text>}
          renderSectionHeader={({ section }) => (
            <View style={projectBlock}>
              <View style={projectHeader}>
                <View style={projectHeaderLeft}>
                  <ChevronDown color={colors.muted} size={16} />
                  <View style={projectHeaderBullet} />
                  <Text style={projectHeaderText} numberOfLines={1}>
                    {section.title.toUpperCase()}
                  </Text>
                </View>
                <View style={projectHeaderCountPill}>
                  <Text style={projectHeaderCount}>{section.data.length}</Text>
                </View>
              </View>
            </View>
          )}
          renderItem={({ item, section }) => (
            <Pressable
              key={item.path}
              style={({ pressed }) => [worktreeRow, pressed && worktreeRowPressed]}
              onPress={() => openWorktree(item.path, item.branch)}
              onLongPress={() => confirmRemoveWorktree(section.project, item)}
            >
              <View style={worktreeStatusCol}>
                <View style={[worktreeStatusDot, item.isMain ? worktreeStatusDotActive : worktreeStatusDotIdle]} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <View style={worktreeTitleRow}>
                  <Text style={worktreeTitle} numberOfLines={1}>{worktreeName(item.path, item.branch)}</Text>
                  {item.isMain && (
                    <View style={mainBadge}>
                      <GitBranch color={colors.success} size={11} />
                      <Text style={mainBadgeText}>main</Text>
                    </View>
                  )}
                  {(() => {
                    const pr = prStatuses[item.path];
                    if (!pr) return null;
                    const { Icon, color } = prVisual(pr);
                    return (
                      <View style={[prBadge, { borderColor: color }]}>
                        <Icon color={color} size={11} />
                        <Text style={[prBadgeText, { color }]}>#{pr.number}</Text>
                      </View>
                    );
                  })()}
                </View>
                <View style={worktreeSubtitleRow}>
                  {/* Desktop's secondary line: git icon + "project / branch". The
                      title above shows the worktree folder name; this carries the
                      actual branch ref (they can differ) plus repo context. */}
                  <GitBranch color={colors.subtle} size={11} />
                  <Text style={worktreeSubtitle} numberOfLines={1}>
                    {(groupMode === 'flat'
                      ? ((item as BraidWorktree & { projectName?: string }).projectName ?? section.title)
                      : section.title)} / {item.branch}
                  </Text>
                </View>
              </View>
              <View style={[countBadge, (terminalCounts[item.path] ?? 0) > 0 && countBadgeActive]}>
                <Text style={[worktreeCount, (terminalCounts[item.path] ?? 0) > 0 && worktreeCountActive]}>
                  {terminalCounts[item.path] ?? 0}
                </Text>
              </View>
            </Pressable>
          )}
        />
      </View>

      <CreateWorktreeModal
        visible={createOpen}
        onClose={() => setCreateOpen(false)}
        client={client}
        projects={projects}
        onCreated={(_project, branch, agentId, worktreePath) => {
          void refreshNow();
          // Jump straight into the new worktree's terminal and auto-launch the
          // chosen agent. Without a path (headless desktop fallback) we just
          // refresh the list in place.
          if (worktreePath) openWorktree(worktreePath, branch, agentId);
        }}
      />
    </SafeAreaView>
  );
}

