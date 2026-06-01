import { router, useLocalSearchParams } from 'expo-router';
import { ChevronLeft, ChevronDown, GitBranch, Plus, RefreshCw, Search, SlidersHorizontal, X } from 'lucide-react-native';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, SectionList, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useListRefresh } from '@/hooks/use-list-refresh';
import { usePersistedState } from '@/hooks/use-persisted-state';
import { CreateWorktreeModal } from '@/worktrees/CreateWorktreeModal';
import { compatibilityVerdict } from '@/transport/protocol-version';
import type { BraidProject, BraidStatus, BraidWorktree } from '@/transport/types';
import { useShared, useTheme } from '@/ui/theme';
import { useHostClient } from '@/ui/use-host-client';

type HostSection = {
  key: string;
  title: string;
  project: BraidProject;
  data: BraidWorktree[];
};

export default function HostScreen() {
  const { hostId } = useLocalSearchParams<{ hostId: string }>();
  const { host, client } = useHostClient(hostId);
  const colors = useTheme().palette;
  const shared = useShared();
  const [status, setStatus] = useState<BraidStatus | null>(null);
  const [projects, setProjects] = useState<BraidProject[]>([]);
  const [terminalCounts, setTerminalCounts] = useState<Record<string, number>>({});
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
      for (const project of loadedProjects) {
        for (const worktree of project.worktrees ?? []) {
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
        }
      }
      setTerminalCounts(counts);
    } catch (err) {
      console.error('[BraidMobile] host.load.error', err instanceof Error ? err.message : String(err));
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [client, host?.endpoint, hostId]);

  const { scrollRef, onScroll, refreshNow } = useListRefresh<SectionList<BraidWorktree, HostSection>>(`host:${hostId ?? 'unknown'}`, load, !!client);

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

  const compat = compatibilityVerdict(status?.protocolVersion);

  const activeHostId = host?.id ?? '';
  const openWorktree = (path: string, branch: string) => {
    if (!activeHostId) return;
    router.push({
      pathname: '/terminal/[hostId]',
      params: {
        hostId: activeHostId,
        worktreePath: path,
        worktreeName: branch,
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
          void client
            .request('worktrees.remove', { repoPath: project.path, worktreePath: worktree.path })
            .then(() => refreshNow())
            .catch((err) => setError(err instanceof Error ? err.message : String(err)));
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

  const statusPill = {
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(53, 201, 139, 0.12)',
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 5,
    paddingHorizontal: 7,
  };

  const statusDot = {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.success,
  };

  const statusText = {
    color: colors.success,
    fontSize: 10,
    fontWeight: '800' as const,
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

  const compatBanner = {
    marginHorizontal: 12,
    marginTop: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.warning,
    backgroundColor: colors.panelStrong,
    padding: 12,
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

  const worktreeSubtitle = {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 16,
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
                <View style={statusPill}>
                  <View style={statusDot} />
                  <Text style={statusText}>online</Text>
                </View>
              </View>
              <Text style={subtitleText} numberOfLines={1}>
                {host.endpoint}
              </Text>
            </View>
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
        {compat !== 'ok' && status && (
          <View style={compatBanner}>
            <Text style={{ color: colors.warning, fontWeight: '800' }}>Protocol compatibility</Text>
            <Text style={shared.muted}>
              {compat === 'mobile-too-old'
                ? 'This desktop speaks a newer mobile protocol. Update Braid Mobile before using live controls.'
                : compat === 'desktop-too-old'
                  ? 'This desktop is too old for this mobile app. Update Braid desktop.'
                  : 'Protocol version could not be verified.'}
            </Text>
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
                  <Text style={worktreeTitle} numberOfLines={1}>{item.branch}</Text>
                  {item.isMain && (
                    <View style={mainBadge}>
                      <GitBranch color={colors.success} size={11} />
                      <Text style={mainBadgeText}>main</Text>
                    </View>
                  )}
                </View>
                <Text style={worktreeSubtitle} numberOfLines={1}>
                  {groupMode === 'flat' ? ((item as BraidWorktree & { projectName?: string }).projectName ?? section.title).toLowerCase() : section.title.toLowerCase()} / {item.path}
                </Text>
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
        onCreated={() => void refreshNow()}
      />
    </SafeAreaView>
  );
}

