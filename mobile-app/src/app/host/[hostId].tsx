import { router, useLocalSearchParams } from 'expo-router';
import { Activity, ChevronDown, GitBranch, GitMerge, GitPullRequest, GitPullRequestClosed, GitPullRequestDraft, MoreVertical, Plus, RefreshCw, RotateCw, Search, SlidersHorizontal, X } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, SectionList, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { useListRefresh } from '@/hooks/use-list-refresh';
import { usePersistedState } from '@/hooks/use-persisted-state';
import { formatLatency, runLatencyDiagnostic, type LatencyDiagnostic } from '@/diagnostics/connection-latency';
import { CreateWorktreeModal } from '@/worktrees/CreateWorktreeModal';
import { useClientManager } from '@/transport/client-manager';
import { isErrorVerdict } from '@/transport/connection-health';
import { desktopSupports, evaluateCompatFromStatus } from '@/transport/protocol-compat';
import { MOBILE_CAPABILITY } from '@/transport/protocol-version';
import { unregisterFromPushAsync } from '@/notifications/mobile-notifications';
import { removeHost } from '@/transport/host-store';
import type { BraidProject, BraidStatus, BraidTerminal, BraidWorktree, PrStatus } from '@/transport/types';
import { ConnectionLog } from '@/ui/ConnectionLog';
import { HeaderBackButton } from '@/ui/kit';
import { ProtocolBlockScreen } from '@/ui/ProtocolBlockScreen';
import { AgentStatusDot, agentStatusColor, worktreeAgentStatus, type AgentDotStatus } from '@/ui/AgentStatusDot';
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

function WorktreeListSkeleton() {
  const colors = useTheme().palette;
  const rows = [0, 1, 2, 3, 4, 5];
  return (
    <View style={{ paddingTop: 8 }}>
      <View style={{ paddingHorizontal: 12, paddingTop: 8, paddingBottom: 4 }}>
        <View style={{ width: 96, height: 11, borderRadius: 6, backgroundColor: colors.panelStrong }} />
      </View>
      {rows.map((row) => (
        <View
          key={row}
          style={{
            minHeight: 54,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            paddingVertical: 8,
            paddingHorizontal: 12,
          }}
        >
          <View style={{ width: 20, alignItems: 'center' }}>
            <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: colors.panelStrong }} />
          </View>
          <View style={{ flex: 1, gap: 7 }}>
            <View
              style={{
                width: row % 2 === 0 ? '58%' : '44%',
                height: 14,
                borderRadius: 7,
                backgroundColor: colors.panelStrong,
              }}
            />
            <View
              style={{
                width: row % 3 === 0 ? '72%' : '52%',
                height: 10,
                borderRadius: 5,
                backgroundColor: colors.panel,
              }}
            />
          </View>
          <View style={{ width: 28, height: 24, borderRadius: 12, backgroundColor: colors.panelStrong }} />
        </View>
      ))}
    </View>
  );
}

export default function HostScreen() {
  const { t } = useTranslation();
  const { hostId } = useLocalSearchParams<{ hostId: string }>();
  const { host, client, state: connState, verdict, reconnect } = useHostClient(hostId);
  const manager = useClientManager();
  const colors = useTheme().palette;
  const shared = useShared();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const [status, setStatus] = useState<BraidStatus | null>(null);
  const [projects, setProjects] = useState<BraidProject[]>([]);
  const [terminalCounts, setTerminalCounts] = useState<Record<string, number>>({});
  const [terminalActivityByPath, setTerminalActivityByPath] = useState<Record<string, number>>({});
  const [terminalPriorityByPath, setTerminalPriorityByPath] = useState<Record<string, number>>({});
  // Per-worktree agent status that drives the pulsing color dot (and count tint),
  // mirroring the desktop sidebar. Derived from each worktree's terminal statuses.
  const [worktreeStatusByPath, setWorktreeStatusByPath] = useState<Record<string, AgentDotStatus>>({});
  // Per-worktree PR status, keyed by worktree path. undefined = not yet fetched,
  // null = no PR / gh unavailable, PrStatus = a PR exists. Populated lazily (see
  // effect below) so it never blocks the worktree list's first paint.
  const [prStatuses, setPrStatuses] = useState<Record<string, PrStatus | null>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [latency, setLatency] = useState<LatencyDiagnostic | null>(null);
  const [latencyLoading, setLatencyLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [viewMode, setViewMode] = usePersistedState<'all' | 'active' | 'main' | 'pr'>(
    'braid.mobile.host.viewMode',
    'all',
    (v) => v === 'all' || v === 'active' || v === 'main' || v === 'pr',
  );
  const [groupMode, setGroupMode] = usePersistedState<'repo' | 'flat'>(
    'braid.mobile.host.groupMode',
    'repo',
    (v) => v === 'repo' || v === 'flat',
  );
  const [sortMode, setSortMode] = usePersistedState<'smart' | 'name' | 'recent' | 'repo'>(
    'braid.mobile.host.sortMode',
    'smart',
    (v) => v === 'smart' || v === 'name' || v === 'recent' || v === 'repo',
  );
  const [createOpen, setCreateOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);

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
      const activity: Record<string, number> = {};
      const priority: Record<string, number> = {};
      const statuses: Record<string, AgentDotStatus> = {};
      // Fetch every worktree's terminal count concurrently. Sequential requests
      // serialized one round-trip per worktree, which scaled poorly for projects
      // with many worktrees and slowed the host screen's first paint.
      await Promise.all(
        loadedProjects.flatMap((project) =>
          (project.worktrees ?? []).map(async (worktree) => {
            try {
              const terminals = await client.request<BraidTerminal[]>('terminal.list', { worktreePath: worktree.path });
              counts[worktree.path] = terminals.length;
              activity[worktree.path] = terminals.reduce((max, terminal) => Math.max(max, terminal.lastOutputAt ?? 0), 0);
              priority[worktree.path] = terminals.reduce((max, terminal) => {
                const score = terminal.status === 'waiting' ? 4 : terminal.status === 'done' ? 3 : terminal.status === 'working' ? 2 : 1;
                return Math.max(max, score);
              }, 0);
              statuses[worktree.path] = worktreeAgentStatus(terminals);
              console.log('[BraidMobile] host.terminalCount', { path: worktree.path, count: terminals.length });
            } catch (err) {
              console.error('[BraidMobile] host.terminalCount.error', {
                path: worktree.path,
                error: err instanceof Error ? err.message : String(err),
              });
              counts[worktree.path] = 0;
              activity[worktree.path] = 0;
              priority[worktree.path] = 0;
              statuses[worktree.path] = 'idle';
            }
          }),
        ),
      );
      setTerminalCounts(counts);
      setTerminalActivityByPath(activity);
      setTerminalPriorityByPath(priority);
      setWorktreeStatusByPath(statuses);
    } catch (err) {
      console.error('[BraidMobile] host.load.error', err instanceof Error ? err.message : String(err));
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [client, host?.endpoint, hostId]);

  const { scrollRef, onScroll, refreshNow } = useListRefresh<SectionList<BraidWorktree, HostSection>>(`host:${hostId ?? 'unknown'}`, load, !!client);

  const refreshLatency = useCallback(async () => {
    if (!client || connState !== 'connected') return;
    setLatencyLoading(true);
    const result = await runLatencyDiagnostic(client);
    setLatency(result);
    setLatencyLoading(false);
  }, [client, connState]);

  useEffect(() => {
    let cancelled = false;
    if (!client || connState !== 'connected') return;
    void Promise.resolve().then(async () => {
      if (cancelled) return;
      setLatencyLoading(true);
      const result = await runLatencyDiagnostic(client);
      if (cancelled) return;
      setLatency(result);
      setLatencyLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [client, connState]);

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
    const sortWorktrees = (worktrees: BraidWorktree[]): BraidWorktree[] => {
      return worktrees.slice().sort((a, b) => {
        if (sortMode === 'smart') {
          const priorityDelta = (terminalPriorityByPath[b.path] ?? 0) - (terminalPriorityByPath[a.path] ?? 0);
          if (priorityDelta !== 0) return priorityDelta;
          const activeDelta = (terminalCounts[b.path] ?? 0) - (terminalCounts[a.path] ?? 0);
          if (activeDelta !== 0) return activeDelta;
          const prDelta = Number(Boolean(prStatuses[b.path])) - Number(Boolean(prStatuses[a.path]));
          if (prDelta !== 0) return prDelta;
          return worktreeName(a.path, a.branch).localeCompare(worktreeName(b.path, b.branch));
        }
        if (sortMode === 'recent') {
          const recentDelta = (terminalActivityByPath[b.path] ?? 0) - (terminalActivityByPath[a.path] ?? 0);
          if (recentDelta !== 0) return recentDelta;
          return worktreeName(a.path, a.branch).localeCompare(worktreeName(b.path, b.branch));
        }
        return worktreeName(a.path, a.branch).localeCompare(worktreeName(b.path, b.branch));
      });
    };
    const filtered = projects
      .map((project) => {
        const worktrees = (project.worktrees ?? []).filter((worktree) => {
          if (viewMode === 'active' && (terminalCounts[worktree.path] ?? 0) === 0) return false;
          if (viewMode === 'main' && !worktree.isMain) return false;
          if (viewMode === 'pr' && !prStatuses[worktree.path]) return false;
          if (!lower) return true;
          return [project.name, worktree.branch, worktree.path].some((value) => value?.toLowerCase().includes(lower));
        });
        return { ...project, worktrees: sortWorktrees(worktrees) };
      })
      .filter((project) => (project.worktrees ?? []).length > 0);

    return filtered.slice().sort((a, b) => {
      if (sortMode === 'smart') {
        const aPriority = (a.worktrees ?? []).reduce((max, worktree) => Math.max(max, terminalPriorityByPath[worktree.path] ?? 0), 0);
        const bPriority = (b.worktrees ?? []).reduce((max, worktree) => Math.max(max, terminalPriorityByPath[worktree.path] ?? 0), 0);
        if (bPriority !== aPriority) return bPriority - aPriority;
        const aActive = (a.worktrees ?? []).reduce((sum, worktree) => sum + (terminalCounts[worktree.path] ?? 0), 0);
        const bActive = (b.worktrees ?? []).reduce((sum, worktree) => sum + (terminalCounts[worktree.path] ?? 0), 0);
        if (bActive !== aActive) return bActive - aActive;
      }
      return a.name.localeCompare(b.name);
    });
  }, [prStatuses, projects, query, sortMode, terminalActivityByPath, terminalCounts, terminalPriorityByPath, viewMode]);

  const sections = useMemo<HostSection[]>(() => {
    if (groupMode === 'flat') {
      const data = visibleProjects.flatMap((project) =>
        (project.worktrees ?? []).map((worktree) => ({ ...worktree, projectName: project.name }))
      ) as BraidWorktree[];
      return data.length > 0 ? [{ key: 'all', title: t('host.allWorktreesSection'), project: visibleProjects[0], data }] : [];
    }
    return visibleProjects.map((project) => ({
      key: project.id,
      title: project.name,
      project,
      data: project.worktrees ?? [],
    }));
  }, [groupMode, visibleProjects, t]);

  const totalWorktrees = projects.reduce((sum, project) => sum + (project.worktrees?.length ?? 0), 0);
  const visibleWorktrees = sections.reduce((sum, section) => sum + section.data.length, 0);
  const showInitialSkeleton = loading && projects.length === 0 && sections.length === 0 && !error;
  const filterSummary = [
    viewMode === 'all' ? t('host.summaryAllWorktrees') : viewMode === 'active' ? t('host.summaryHasTerminals') : viewMode === 'main' ? t('host.summaryMainOnly') : t('host.summaryHasPr'),
    groupMode === 'repo' ? t('host.summaryGrouped') : t('host.summaryFlat'),
    sortMode === 'smart' ? t('host.summarySmart') : sortMode === 'name' ? t('host.summaryName') : sortMode === 'recent' ? t('host.summaryRecent') : t('host.summaryRepo'),
  ].join(' · ');

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
    Alert.alert(t('host.removeWorktreeTitle'), worktree.branch, [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.remove'),
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

  const showWorktreeActions = (project: BraidProject, worktree: BraidWorktree) => {
    const name = worktreeName(worktree.path, worktree.branch);
    if (worktree.isMain) {
      Alert.alert(name, t('host.mainCannotBeRemoved'), [
        { text: t('host.openTerminal'), onPress: () => openWorktree(worktree.path, worktree.branch) },
        { text: t('common.cancel'), style: 'cancel' },
      ]);
      return;
    }
    Alert.alert(name, worktree.branch, [
      { text: t('host.openTerminal'), onPress: () => openWorktree(worktree.path, worktree.branch) },
      { text: t('host.removeWorktreeAction'), style: 'destructive', onPress: () => confirmRemoveWorktree(project, worktree) },
      { text: t('common.cancel'), style: 'cancel' },
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
    Alert.alert(t('host.removeDesktopTitle'), t('host.removeDesktopMessage', { name: host.instanceName ?? host.endpoint }), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.remove'),
        style: 'destructive',
        onPress: async () => {
          // Tear down push + connection in the background so the UI transitions
          // instantly: unregisterPush can wait up to 4s for a socket when the
          // desktop is offline, and we don't want "Remove" to feel frozen.
          void (async () => {
            await manager.unregisterPush(host.id);
            manager.dropHost(host.id);
          })();
          const remaining = await removeHost(host.id);
          // No desktops left: kill push registration entirely so a desktop that
          // was offline at removal self-cleans via DeviceNotRegistered on its next
          // push, rather than waiting out the token TTL.
          if (remaining.length === 0) void unregisterFromPushAsync();
          router.replace('/');
        },
      },
    ]);
  };

  if (!host) {
    return (
      <SafeAreaView style={shared.safe}>
        <View style={shared.shell}>
          <Text style={shared.title}>{t('host.desktopNotFound')}</Text>
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

  const latencyColor = latency?.verdict === 'good'
    ? colors.success
    : latency?.verdict === 'fair'
      ? colors.warning
      : latency?.verdict === 'poor'
        ? colors.danger
        : colors.muted;

  const qualityRow = {
    marginTop: 8,
    minHeight: 34,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg,
    paddingHorizontal: 10,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
  };

  const qualityLabel = {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '700' as const,
  };

  const qualityValue = {
    color: latencyColor,
    fontSize: 12,
    fontWeight: '800' as const,
  };

  const qualityMeta = {
    color: colors.subtle,
    fontSize: 11,
    fontWeight: '700' as const,
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

  const filterButton = {
    minHeight: 38,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg,
    paddingHorizontal: 12,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
  };

  const filterButtonText = {
    color: colors.text,
    fontSize: 13,
    fontWeight: '800' as const,
  };

  const filterButtonMeta = {
    color: colors.muted,
    fontSize: 12,
    flex: 1,
  };

  const filterTopRow = {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
  };

  const segmented = {
    flex: 1,
    minHeight: 38,
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
    minHeight: 30,
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

  const filterIconButton = {
    width: 42,
    height: 38,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
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

  const sheetBackdrop = {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.48)',
    justifyContent: 'flex-end' as const,
  };

  const sheet = {
    maxHeight: Math.max(360, Math.round(windowHeight * 0.78)),
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panel,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: Math.max(16, insets.bottom + 10),
    gap: 14,
  };

  const sheetScrollContent = {
    gap: 14,
    paddingBottom: 6,
  };

  const sheetHandle = {
    alignSelf: 'center' as const,
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
  };

  const sheetHeader = {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
  };

  const sheetTitle = {
    color: colors.text,
    fontSize: 18,
    fontWeight: '800' as const,
  };

  const filterSection = {
    gap: 8,
  };

  const filterGroupTitle = {
    color: colors.subtle,
    fontSize: 11,
    fontWeight: '800' as const,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.6,
    marginBottom: 8,
  };

  const filterOption = (active: boolean) => ({
    minHeight: 58,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: active ? colors.accent : colors.border,
    backgroundColor: active ? colors.accentSoft : colors.panelStrong,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 9,
  });

  const filterOptionBody = {
    flex: 1,
    minWidth: 0,
  };

  const filterOptionTitle = (active: boolean) => ({
    color: active ? colors.accent : colors.text,
    fontSize: 14,
    fontWeight: '800' as const,
  });

  const filterOptionSubtitle = {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 16,
    marginTop: 2,
  };

  const filterOptionRadio = (active: boolean) => ({
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: active ? 5 : 1,
    borderColor: active ? colors.accent : colors.border,
    backgroundColor: active ? colors.panel : 'transparent',
  });


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
    borderWidth: 1,
    borderColor: 'transparent',
    paddingHorizontal: 8,
  };

  const worktreeCount = {
    color: colors.subtle,
    fontSize: 12,
    fontWeight: '800' as const,
  };

  const worktreeMoreButton = {
    width: 34,
    height: 34,
    borderRadius: 8,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  };

  return (
    <SafeAreaView style={[shared.safe, { backgroundColor: colors.panel }]} edges={['top', 'left', 'right']}>
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <View style={hostHeader}>
          <View style={titleRow}>
            <HeaderBackButton onPress={() => router.back()} accessibilityLabel={t('common.back')} />
            <View style={titleBlock}>
              <View style={statusTitleRow}>
                <Text style={titleText} numberOfLines={1}>
                  {status?.instanceName ?? host.instanceName ?? t('host.hostFallback')}
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
              <Pressable style={reconnectButton} onPress={reconnect} accessibilityLabel={t('host.reconnect')}>
                <RotateCw color={colors.text} size={13} />
                <Text style={reconnectButtonText}>{t('host.reconnect')}</Text>
              </Pressable>
            )}
            <Pressable style={refreshButton} onPress={() => void refreshNow()} accessibilityLabel={t('host.refreshHost')}>
              {loading ? <ActivityIndicator color={colors.text} size="small" /> : <RefreshCw color={colors.text} size={17} />}
            </Pressable>
          </View>
          {connState === 'connected' && (
            <Pressable
              style={qualityRow}
              onPress={() => router.push('/troubleshoot')}
              onLongPress={() => void refreshLatency()}
              accessibilityLabel={t('host.openDiagnostics')}
            >
              <Activity color={latencyColor} size={14} />
              <Text style={qualityLabel}>{t('host.connectionQuality')}</Text>
              <View style={{ flex: 1 }} />
              {latencyLoading && !latency ? (
                <ActivityIndicator color={colors.muted} size="small" />
              ) : (
                <>
                  <Text style={qualityValue}>{latency?.label ?? t('host.testing')}</Text>
                  <Text style={qualityMeta}>{formatLatency(latency?.rttMs ?? null)}</Text>
                </>
              )}
            </Pressable>
          )}
        </View>

        <View style={controls}>
          <View style={searchBox}>
            <Search color={colors.muted} size={16} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder={t('host.searchPlaceholder')}
              placeholderTextColor={colors.subtle}
              autoCapitalize="none"
              autoCorrect={false}
              style={searchInput}
            />
            {query.length > 0 && (
              <Pressable style={clearButton} onPress={() => setQuery('')} accessibilityLabel={t('host.clearSearch')}>
                <X color={colors.muted} size={15} />
              </Pressable>
            )}
          </View>

          <View style={filterTopRow}>
            <View style={segmented}>
              {([
                ['all', t('host.segAll')],
                ['active', t('host.segActive')],
              ] as const).map(([mode, label]) => (
                <Pressable
                  key={mode}
                  style={[segment, viewMode === mode && segmentActive]}
                  onPress={() => setViewMode(mode)}
                >
                  <Text style={[segmentText, viewMode === mode && segmentTextActive]}>{label}</Text>
                </Pressable>
              ))}
            </View>
            <Pressable style={filterIconButton} onPress={() => setFilterOpen(true)} accessibilityLabel={t('host.openAdvancedFilters')}>
            <SlidersHorizontal color={viewMode === 'pr' || viewMode === 'main' || groupMode !== 'repo' || sortMode !== 'smart' ? colors.accent : colors.text} size={17} />
            </Pressable>
          </View>
          <Text style={filterButtonMeta} numberOfLines={1}>{filterSummary}</Text>
        </View>

        <View style={shortcutRow}>
          <Text style={resultText}>
            {t('host.worktreeCount', { visible: visibleWorktrees, total: totalWorktrees })}
          </Text>
          <View style={{ flex: 1 }} />
          <Pressable style={iconButton} onPress={() => setCreateOpen(true)} accessibilityLabel={t('host.addWorktree')}>
            <Plus color={colors.muted} size={18} />
          </Pressable>
        </View>

        {error && <Text style={[shared.subtitle, { color: colors.danger, paddingHorizontal: 12, paddingTop: 6 }]}>{error}</Text>}
        {connState === 'auth-failed' && (
          <View style={authBanner}>
            <Text style={authBannerText}>
              {t('host.pairingRejected')}
            </Text>
            <View style={authActions}>
              <Pressable style={authAction} onPress={goRepair} accessibilityLabel={t('host.rePair')}>
                <Text style={[authActionText, { color: colors.text }]}>{t('host.rePair')}</Text>
              </Pressable>
              <Pressable style={authAction} onPress={confirmRemoveHost} accessibilityLabel={t('host.removeDesktopTitle')}>
                <Text style={[authActionText, { color: colors.danger }]}>{t('common.remove')}</Text>
              </Pressable>
            </View>
          </View>
        )}
        {showReconnect && (
          <View style={connLogWrap}>
            <ConnectionLog title={t('host.connectionLog')} entries={manager.getConnectionLog(host.id)} />
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
          ListEmptyComponent={showInitialSkeleton ? <WorktreeListSkeleton /> : <Text style={emptyText}>{t('host.noWorktrees')}</Text>}
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
          renderItem={({ item, section }) => {
            const wtStatus = worktreeStatusByPath[item.path] ?? 'idle';
            const count = terminalCounts[item.path] ?? 0;
            const tint = agentStatusColor(wtStatus, colors);
            return (
            <Pressable
              key={item.path}
              style={({ pressed }) => [worktreeRow, pressed && worktreeRowPressed]}
              onPress={() => openWorktree(item.path, item.branch)}
              onLongPress={() => confirmRemoveWorktree(section.project, item)}
            >
              <View style={worktreeStatusCol}>
                <AgentStatusDot status={wtStatus} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <View style={worktreeTitleRow}>
                  <Text style={worktreeTitle} numberOfLines={1}>{worktreeName(item.path, item.branch)}</Text>
                  {item.isMain && (
                    <View style={mainBadge}>
                      <GitBranch color={colors.success} size={11} />
                      <Text style={mainBadgeText}>{t('host.mainBadge')}</Text>
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
              <View style={[countBadge, count > 0 && { borderColor: tint }]}>
                <Text style={[worktreeCount, count > 0 && { color: tint }]}>
                  {count}
                </Text>
              </View>
              <Pressable
                style={({ pressed }) => [worktreeMoreButton, pressed && iconButtonActive]}
                onPress={(event) => {
                  event.stopPropagation();
                  showWorktreeActions(section.project, item);
                }}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={t('host.showActionsFor', { name: worktreeName(item.path, item.branch) })}
              >
                <MoreVertical color={colors.muted} size={18} />
              </Pressable>
            </Pressable>
            );
          }}
        />
      </View>

      <CreateWorktreeModal
        visible={createOpen}
        onClose={() => setCreateOpen(false)}
        client={client}
        projects={projects}
        jiraCapable={desktopSupports(status, MOBILE_CAPABILITY.jira)}
        copyFilesCapable={desktopSupports(status, MOBILE_CAPABILITY.copyFiles)}
        onCreated={(_project, branch, agentId, worktreePath) => {
          void refreshNow();
          // Jump straight into the new worktree's terminal and auto-launch the
          // chosen agent. Without a path (headless desktop fallback) we just
          // refresh the list in place.
          if (worktreePath) openWorktree(worktreePath, branch, agentId);
        }}
      />

      <Modal visible={filterOpen} transparent animationType="slide" onRequestClose={() => setFilterOpen(false)}>
        <Pressable style={sheetBackdrop} onPress={() => setFilterOpen(false)}>
          <Pressable style={sheet} onPress={() => undefined}>
            <View style={sheetHandle} />
            <View style={sheetHeader}>
              <Text style={sheetTitle}>{t('host.filtersTitle')}</Text>
              <Pressable style={iconButton} onPress={() => setFilterOpen(false)} accessibilityLabel={t('host.closeFilters')}>
                <X color={colors.text} size={18} />
              </Pressable>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={sheetScrollContent}>
              <View style={filterSection}>
                <Text style={filterGroupTitle}>{t('host.groupShow')}</Text>
                {([
                  ['all', t('host.showAllTitle'), t('host.showAllSubtitle')],
                  ['active', t('host.showActiveTitle'), t('host.showActiveSubtitle')],
                  ['pr', t('host.showPrTitle'), t('host.showPrSubtitle')],
                  ['main', t('host.showMainTitle'), t('host.showMainSubtitle')],
                ] as const).map(([value, title, subtitle]) => (
                  <Pressable key={value} style={filterOption(viewMode === value)} onPress={() => setViewMode(value)}>
                    <View style={filterOptionBody}>
                      <Text style={filterOptionTitle(viewMode === value)}>{title}</Text>
                      <Text style={filterOptionSubtitle}>{subtitle}</Text>
                    </View>
                    <View style={filterOptionRadio(viewMode === value)} />
                  </Pressable>
                ))}
              </View>

              <View style={filterSection}>
                <Text style={filterGroupTitle}>{t('host.groupSortBy')}</Text>
                {([
                  ['smart', t('host.sortSmartTitle'), t('host.sortSmartSubtitle')],
                  ['name', t('host.sortNameTitle'), t('host.sortNameSubtitle')],
                  ['recent', t('host.sortRecentTitle'), t('host.sortRecentSubtitle')],
                  ['repo', t('host.sortRepoTitle'), t('host.sortRepoSubtitle')],
                ] as const).map(([value, title, subtitle]) => (
                  <Pressable key={value} style={filterOption(sortMode === value)} onPress={() => setSortMode(value)}>
                    <View style={filterOptionBody}>
                      <Text style={filterOptionTitle(sortMode === value)}>{title}</Text>
                      <Text style={filterOptionSubtitle}>{subtitle}</Text>
                    </View>
                    <View style={filterOptionRadio(sortMode === value)} />
                  </Pressable>
                ))}
              </View>

              <View style={filterSection}>
                <Text style={filterGroupTitle}>{t('host.groupGroup')}</Text>
                {([
                  ['repo', t('host.groupByRepoTitle'), t('host.groupByRepoSubtitle')],
                  ['flat', t('host.groupFlatTitle'), t('host.groupFlatSubtitle')],
                ] as const).map(([value, title, subtitle]) => (
                  <Pressable key={value} style={filterOption(groupMode === value)} onPress={() => setGroupMode(value)}>
                    <View style={filterOptionBody}>
                      <Text style={filterOptionTitle(groupMode === value)}>{title}</Text>
                      <Text style={filterOptionSubtitle}>{subtitle}</Text>
                    </View>
                    <View style={filterOptionRadio(groupMode === value)} />
                  </Pressable>
                ))}
              </View>

              <Pressable
                style={filterButton}
                onPress={() => {
                  setViewMode('all');
                  setGroupMode('repo');
                  setSortMode('smart');
                }}
                accessibilityLabel={t('host.resetFilters')}
              >
                <RefreshCw color={colors.muted} size={16} />
                <Text style={filterButtonText}>{t('host.resetFilters')}</Text>
              </Pressable>
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}
