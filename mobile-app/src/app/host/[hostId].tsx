import { router, useLocalSearchParams } from 'expo-router';
import { Activity, Bell, ChevronLeft, Code2, GitBranch, Globe, MessageSquare, RefreshCw, Server, TerminalSquare } from 'lucide-react-native';
import * as Notifications from 'expo-notifications';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { SESSION_SCREENS_ENABLED } from '@/constants/features';
import type { BraidProject, BraidSession, BraidStatus } from '@/transport/types';
import { compatibilityVerdict } from '@/transport/protocol-version';
import { colors, shared } from '@/ui/theme';
import { useHostClient } from '@/ui/use-host-client';

export default function HostScreen() {
  const { hostId } = useLocalSearchParams<{ hostId: string }>();
  const { host, client } = useHostClient(hostId);
  const [status, setStatus] = useState<BraidStatus | null>(null);
  const [projects, setProjects] = useState<BraidProject[]>([]);
  const [sessions, setSessions] = useState<BraidSession[]>([]);
  const [terminalCounts, setTerminalCounts] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!client) return;
    setError(null);
    try {
      await client.connect();
      setStatus(await client.request<BraidStatus>('status.get'));
      const loadedProjects = await client.request<BraidProject[]>('projects.list');
      const loadedSessions = await client.request<BraidSession[]>('sessions.list');
      console.log('[BraidMobile] host.load', {
        hostId,
        projects: loadedProjects.map((project) => ({
          id: project.id,
          name: project.name,
          worktrees: project.worktrees?.map((worktree) => ({
            id: worktree.id,
            branch: worktree.branch,
            path: worktree.path,
          })),
        })),
        sessions: loadedSessions.map((session) => ({
          id: session.id,
          name: session.customName || session.name,
          worktreeId: session.worktreeId,
          worktreePath: session.worktreePath,
          status: session.status,
        })),
      });
      setProjects(loadedProjects);
      setSessions(loadedSessions.slice(0, 8));
      const counts: Record<string, number> = {};
      for (const project of loadedProjects) {
        for (const worktree of project.worktrees ?? []) {
          try {
            const terminals = await client.request<unknown[]>('terminal.list', { worktreePath: worktree.path });
            counts[worktree.path] = terminals.length;
          } catch {
            counts[worktree.path] = 0;
          }
        }
      }
      console.log('[BraidMobile] host.terminalCounts', counts);
      setTerminalCounts(counts);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  const enableNotifications = async () => {
    const result = await Notifications.requestPermissionsAsync();
    if (!result.granted) {
      Alert.alert('Notifications disabled', 'Enable notifications in system settings to receive mobile alerts.');
      return;
    }
    Alert.alert('Notifications ready', 'Braid Mobile can now show local notifications while connected.');
  };
  const compat = compatibilityVerdict(status?.protocolVersion);

  if (!host) {
    return (
      <SafeAreaView style={shared.safe}>
        <View style={shared.shell}><Text style={shared.title}>Desktop not found</Text></View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={shared.safe}>
      <View style={shared.shell}>
        <View style={shared.header}>
          <Pressable style={[shared.button, shared.secondary]} onPress={() => router.back()}><ChevronLeft color={colors.text} size={18} /></Pressable>
          <Pressable style={[shared.button, shared.secondary]} onPress={load}><RefreshCw color={colors.text} size={18} /></Pressable>
        </View>
        <Text style={shared.title}>{status?.instanceName ?? host.instanceName ?? 'Braid desktop'}</Text>
        <Text style={shared.subtitle}>{host.endpoint}</Text>
        {error && <Text style={[shared.subtitle, { color: colors.danger }]}>{error}</Text>}
        {compat !== 'ok' && status && (
          <View style={[shared.card, { marginTop: 14, borderColor: colors.warning }]}>
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

        <ScrollView contentContainerStyle={{ gap: 12, paddingVertical: 18 }}>
          <View style={[shared.card, { gap: 10 }]}>
            <Text style={shared.section}>Overview</Text>
            <Metric icon={<Server color={colors.accent} size={18} />} label="Version" value={status?.version ?? 'unknown'} />
            <Metric icon={<GitBranch color={colors.success} size={18} />} label="Projects" value={String(projects.length)} />
            <Metric icon={<Activity color={colors.warning} size={18} />} label="Sessions" value={String(sessions.length)} />
          </View>

          <View style={[shared.card, { gap: 10 }]}>
            <Text style={shared.section}>Worktrees</Text>
            {projects.length === 0 ? (
              <Text style={shared.muted}>No projects found.</Text>
            ) : projects.map((project) => (
              <View key={project.id} style={{ gap: 8 }}>
                <Text style={{ color: colors.text, fontWeight: '800', fontSize: 16 }}>{project.name}</Text>
                {(project.worktrees ?? []).length === 0 ? (
                  <Text style={shared.muted}>No worktrees found for this project.</Text>
                ) : (project.worktrees ?? []).map((worktree) => (
                  <Pressable
                    key={worktree.path}
                    style={{
                      borderRadius: 8,
                      borderWidth: 1,
                      borderColor: colors.border,
                      backgroundColor: colors.panelStrong,
                      padding: 12,
                      gap: 6,
                    }}
                    onPress={() => router.push({
                      pathname: '/terminal/[hostId]',
                      params: {
                        hostId: host.id,
                        worktreePath: worktree.path,
                        worktreeName: worktree.branch,
                      },
                    })}
                  >
                    <View style={[shared.row, { gap: 10 }]}>
                      <GitBranch color={worktree.isMain ? colors.success : colors.accent} size={17} />
                      <Text style={{ color: colors.text, fontWeight: '800', flex: 1 }}>{worktree.branch}</Text>
                      <View style={[shared.row, { gap: 5 }]}>
                        <TerminalSquare color={colors.muted} size={15} />
                        <Text style={{ color: colors.muted, fontWeight: '800' }}>{terminalCounts[worktree.path] ?? 0}</Text>
                      </View>
                    </View>
                    <Text style={shared.muted} numberOfLines={1}>{worktree.path}</Text>
                  </Pressable>
                ))}
              </View>
            ))}
          </View>

          <View style={{ flexDirection: 'row', gap: 10 }}>
            {/* @deprecated SDK chat sessions are deprecated in favor of the terminal screen. */}
            {SESSION_SCREENS_ENABLED && (
              <NavTile icon={<MessageSquare color={colors.text} size={20} />} label="Sessions" onPress={() => router.push(`/sessions/${host.id}`)} />
            )}
            <NavTile icon={<Code2 color={colors.text} size={20} />} label="Git review" onPress={() => router.push(`/git/${host.id}`)} />
          </View>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <NavTile icon={<GitBranch color={colors.text} size={20} />} label="Worktrees" onPress={() => router.push(`/worktrees/${host.id}`)} />
            <NavTile icon={<Globe color={colors.text} size={20} />} label="Browser" onPress={() => router.push(`/browser/${host.id}`)} />
          </View>
          <NavTile icon={<Bell color={colors.text} size={20} />} label="Notify" onPress={enableNotifications} />

          {/* @deprecated SDK chat sessions are deprecated in favor of the terminal screen. */}
          {SESSION_SCREENS_ENABLED && (
            <View style={[shared.card, { gap: 10 }]}>
              <Text style={shared.section}>Recent sessions</Text>
              {sessions.length === 0 ? <Text style={shared.muted}>No sessions found.</Text> : sessions.map((session) => (
                <Pressable key={session.id} onPress={() => router.push(`/session/${host.id}/${session.id}`)} style={{ paddingVertical: 8 }}>
                  <Text style={{ color: colors.text, fontWeight: '800' }}>{session.customName || session.name || 'Untitled session'}</Text>
                  <Text style={shared.muted}>{[session.status, session.model].filter(Boolean).join(' · ')}</Text>
                </Pressable>
              ))}
            </View>
          )}
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return <View style={[shared.row, { gap: 10 }]}>{icon}<Text style={{ color: colors.muted, flex: 1 }}>{label}</Text><Text style={{ color: colors.text, fontWeight: '800' }}>{value}</Text></View>;
}

function NavTile({ icon, label, onPress }: { icon: React.ReactNode; label: string; onPress: () => void }) {
  return <Pressable onPress={onPress} style={[shared.card, { flex: 1, minHeight: 92, justifyContent: 'space-between' }]}>{icon}<Text style={{ color: colors.text, fontWeight: '800', fontSize: 15 }}>{label}</Text></Pressable>;
}
