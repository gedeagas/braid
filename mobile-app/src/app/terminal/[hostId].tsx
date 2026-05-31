import { router, useLocalSearchParams } from 'expo-router';
import { ChevronLeft, Command, GitBranch, Plus, RefreshCw, Send, TerminalSquare } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { TerminalWebView, type TerminalWebViewHandle } from '@/terminal/TerminalWebView';
import type { BraidProject, BraidTerminal, BraidWorktree } from '@/transport/types';
import { colors, shared } from '@/ui/theme';
import { useHostClient } from '@/ui/use-host-client';

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;

function terminalLabel(terminal: BraidTerminal) {
  return terminal.label || terminal.title || terminal.name || terminal.terminalId || terminal.cwd?.split('/').pop() || terminal.id.slice(0, 6);
}

export default function TerminalScreen() {
  const { hostId, worktreePath, worktreeName } = useLocalSearchParams<{ hostId: string; worktreePath?: string; worktreeName?: string }>();
  const { client } = useHostClient(hostId);
  const terminalRef = useRef<TerminalWebViewHandle>(null);
  const [projects, setProjects] = useState<BraidProject[]>([]);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [worktree, setWorktree] = useState<BraidWorktree | null>(null);
  const [terminals, setTerminals] = useState<BraidTerminal[]>([]);
  const [active, setActive] = useState<BraidTerminal | null>(null);
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [selectorsExpanded, setSelectorsExpanded] = useState(true);
  const [creatingTerminal, setCreatingTerminal] = useState(false);
  const activeIdRef = useRef<string | null>(null);
  const initializedKeyRef = useRef<string | null>(null);
  const terminalFrameHeightRef = useRef<number | undefined>(undefined);
  const subscriptionRef = useRef<{ terminalId: string; subscriptionId: string } | null>(null);
  const openSeqRef = useRef(0);

  const selectedProject = projects.find((project) => project.id === projectId) ?? projects[0] ?? null;
  const isSessionScoped = typeof worktreePath === 'string' && worktreePath.length > 0;

  const fitActiveTerminal = useCallback(async (terminal: BraidTerminal) => {
    if (!client || !terminalRef.current) return;
    await terminalRef.current.awaitReady();
    const dims = await terminalRef.current.measureFitDimensions(terminalFrameHeightRef.current);
    console.log('[BraidMobile] terminal.fit', {
      terminalId: terminal.id,
      frameHeight: terminalFrameHeightRef.current,
      dims,
    });
    if (!dims) return;
    terminalRef.current.resize(dims.cols, dims.rows);
    await client.request('terminal.resize', { ptyId: terminal.id, cols: dims.cols, rows: dims.rows });
  }, [client]);

  const openTerminal = useCallback(async (terminal: BraidTerminal) => {
    if (!client) return;
    const seq = openSeqRef.current + 1;
    openSeqRef.current = seq;
    const previousSubscription = subscriptionRef.current;
    subscriptionRef.current = null;
    activeIdRef.current = terminal.id;
    initializedKeyRef.current = terminal.id;
    setActive(terminal);
    console.log('[BraidMobile] terminal.open.start', { terminal });
    terminalRef.current?.init(DEFAULT_COLS, DEFAULT_ROWS, '');
    try {
      const subscriptionId = await client.subscribe('terminal.subscribe', { ptyId: terminal.id });
      if (openSeqRef.current !== seq) {
        await client.request('terminal.unsubscribe', { subscriptionId }).catch(() => undefined);
        return;
      }
      console.log('[BraidMobile] terminal.subscribed', { terminalId: terminal.id, subscriptionId });
      subscriptionRef.current = { terminalId: terminal.id, subscriptionId };
      if (previousSubscription) {
        client.request('terminal.unsubscribe', { subscriptionId: previousSubscription.subscriptionId }).catch(() => undefined);
      }
    } catch (err) {
      if (openSeqRef.current === seq) setError(err instanceof Error ? err.message : String(err));
      return;
    }

    client.request<string>('terminal.readScrollback', { ptyId: terminal.id })
      .then((scrollback) => {
        if (openSeqRef.current !== seq || activeIdRef.current !== terminal.id || !scrollback) return;
        console.log('[BraidMobile] terminal.scrollback', { terminalId: terminal.id, scrollbackLength: scrollback.length });
        terminalRef.current?.write(scrollback);
      })
      .catch((err) => {
        console.log('[BraidMobile] terminal.scrollback.error', { terminalId: terminal.id, error: err instanceof Error ? err.message : String(err) });
      });
    void fitActiveTerminal(terminal);
  }, [client, fitActiveTerminal]);

  const loadProjects = useCallback(async () => {
    if (!client) return;
    setError(null);
    try {
      const loaded = await client.request<BraidProject[]>('projects.list');
      console.log('[BraidMobile] terminal.projects', {
        routeWorktreePath: worktreePath,
        routeWorktreeName: worktreeName,
        projects: loaded.map((project) => ({
          id: project.id,
          name: project.name,
          worktrees: project.worktrees?.map((item) => ({
            id: item.id,
            branch: item.branch,
            path: item.path,
          })),
        })),
      });
      setProjects(loaded);
      if (isSessionScoped) {
        const foundProject = loaded.find((project) => project.worktrees?.some((item) => item.path === worktreePath));
        const foundWorktree = foundProject?.worktrees?.find((item) => item.path === worktreePath) ?? {
          path: worktreePath,
          branch: typeof worktreeName === 'string' && worktreeName ? worktreeName : worktreePath.split('/').pop() ?? 'Worktree',
        };
        console.log('[BraidMobile] terminal.sessionScope', {
          foundProject: foundProject?.name,
          foundWorktree,
        });
        setProjectId(foundProject?.id ?? null);
        setWorktree((current) => current?.path === foundWorktree.path ? current : foundWorktree);
        setSelectorsExpanded(false);
        return;
      }
      const project = loaded[0] ?? null;
      setProjectId(project?.id ?? null);
      if (project?.worktrees?.[0]) {
        setWorktree((current) => current?.path ? current : project.worktrees![0]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [client, isSessionScoped, worktreeName, worktreePath]);

  const loadTerminals = useCallback(async (targetWorktree: BraidWorktree | null, preferredId?: string) => {
    if (!client || !targetWorktree) return;
    setError(null);
    try {
      const raw = await client.request<Array<BraidTerminal & { ptyId?: string }>>('terminal.list', { worktreePath: targetWorktree.path });
      console.log('[BraidMobile] terminal.rawList', { worktree: targetWorktree, raw });
      const list = raw.map((terminal) => ({
        ...terminal,
        id: terminal.id ?? terminal.ptyId ?? '',
        worktreePath: targetWorktree.path,
      })).filter((terminal) => terminal.id);
      console.log('[BraidMobile] terminal.list', { worktree: targetWorktree, list });
      setTerminals(list);
      const next = list.find((terminal) => terminal.id === preferredId) ?? list[0] ?? null;
      setActive(next);
      if (next) {
        setSelectorsExpanded(false);
        await openTerminal(next);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [client, openTerminal]);

  const createTerminal = useCallback(async () => {
    if (!client || !worktree || creatingTerminal) return;
    setCreatingTerminal(true);
    setError(null);
    try {
      const created = await client.request<BraidTerminal & { ptyId?: string }>('terminal.create', {
        worktreePath: worktree.path,
        worktreeId: worktree.id,
        label: 'Claude Code',
        command: 'claude',
        agentId: 'claude',
      });
      const terminal = {
        ...created,
        id: created.id ?? created.ptyId ?? '',
        worktreePath: worktree.path,
      };
      if (!terminal.id) throw new Error('Desktop did not return a terminal id');
      setTerminals((current) => [...current.filter((item) => item.id !== terminal.id), terminal]);
      setSelectorsExpanded(false);
      await openTerminal(terminal);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreatingTerminal(false);
    }
  }, [client, creatingTerminal, openTerminal, worktree]);

  useEffect(() => { void loadProjects(); }, [loadProjects]);
  useEffect(() => { void loadTerminals(worktree, active?.id); }, [worktree]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!client) return;
    const off = client.onNotification((notification) => {
      if (notification.method !== 'terminal.data') return;
      const params = notification.params as { ptyId?: string; data?: string };
      if (params.ptyId === activeIdRef.current && params.data) {
        console.log('[BraidMobile] terminal.data', { ptyId: params.ptyId, length: params.data.length });
        terminalRef.current?.write(params.data);
      }
    });
    return () => {
      off();
      const current = subscriptionRef.current;
      if (current) client.request('terminal.unsubscribe', { subscriptionId: current.subscriptionId }).catch(() => undefined);
    };
  }, [client]);

  const writeBytes = async (data: string) => {
    if (!client || !active || !data) return;
    await client.request('terminal.write', { ptyId: active.id, data });
  };

  const submit = async () => {
    if (!input) return;
    await writeBytes(`${input}\n`);
    setInput('');
  };

  const selectProject = (project: BraidProject) => {
    console.log('[BraidMobile] terminal.selectProject', project);
    setProjectId(project.id);
    setWorktree(project.worktrees?.[0] ?? null);
    setTerminals([]);
    setActive(null);
    setSelectorsExpanded(true);
    terminalRef.current?.clear();
  };

  const selectWorktree = (next: BraidWorktree) => {
    console.log('[BraidMobile] terminal.selectWorktree', next);
    setWorktree(next);
    setTerminals([]);
    setActive(null);
    setSelectorsExpanded(false);
    terminalRef.current?.clear();
  };

  const chromeTitle = typeof worktreeName === 'string' && worktreeName ? worktreeName : worktree?.branch ?? selectedProject?.name ?? 'Session';
  const chromeMeta = selectedProject && worktree ? `${selectedProject.name} / ${worktree.branch}` : worktree?.path ?? 'Select a worktree';

  return (
    <SafeAreaView style={shared.safe}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={{ backgroundColor: colors.panel, borderBottomWidth: 1, borderBottomColor: colors.border }}>
          <View style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 4 }}>
            <Pressable style={chromeIconButton} onPress={() => router.back()}><ChevronLeft color={colors.text} size={21} /></Pressable>
            <View style={{ flex: 1, minWidth: 0, paddingHorizontal: 4 }}>
              <Text style={chromeTitleStyle} numberOfLines={1}>{chromeTitle}</Text>
              <Text style={chromeMetaStyle} numberOfLines={1}>{chromeMeta}</Text>
            </View>
            {!isSessionScoped && worktree && (
              <Pressable style={chromeTextButton} onPress={() => setSelectorsExpanded((value) => !value)}>
                <Text style={chromeTextButtonLabel}>{selectorsExpanded ? 'Hide' : 'Change'}</Text>
              </Pressable>
            )}
            <Pressable style={chromeIconButton} onPress={() => loadTerminals(worktree, active?.id)}><RefreshCw color={colors.text} size={17} /></Pressable>
          </View>

          {!isSessionScoped && selectorsExpanded && (
            <View style={{ borderTopWidth: 1, borderTopColor: colors.border }}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 10, paddingVertical: 8 }}>
                {projects.map((project) => (
                  <Pressable key={project.id} style={[selectorChip, selectedProject?.id === project.id && selectorChipActive]} onPress={() => selectProject(project)}>
                    <Text style={[selectorChipText, selectedProject?.id === project.id && selectorChipTextActive]}>{project.name}</Text>
                  </Pressable>
                ))}
              </ScrollView>

              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 10, paddingBottom: 8 }}>
                {(selectedProject?.worktrees ?? []).map((item) => (
                  <Pressable key={item.path} style={[selectorChip, worktree?.path === item.path && selectorChipActive]} onPress={() => selectWorktree(item)}>
                    <GitBranch color={worktree?.path === item.path ? colors.text : colors.muted} size={14} />
                    <Text style={[selectorChipText, worktree?.path === item.path && selectorChipTextActive]}>{item.branch}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          )}

          <View style={{ flexDirection: 'row', alignItems: 'center', borderTopWidth: 1, borderTopColor: colors.border }}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingLeft: 10, paddingRight: 4 }}>
              {terminals.length === 0 ? (
                <Text style={[chromeMetaStyle, { paddingVertical: 10 }]}>No live terminals</Text>
              ) : terminals.map((terminal) => {
                const isActive = active?.id === terminal.id;
                return (
                  <Pressable key={terminal.id} style={[terminalTabStyle, isActive && terminalTabActiveStyle]} onPress={() => openTerminal(terminal)}>
                    <View style={{ maxWidth: '100%', flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <TerminalSquare color={isActive ? colors.text : colors.muted} size={14} />
                      <Text style={[terminalTabTextStyle, isActive && terminalTabTextActiveStyle]} numberOfLines={1}>{terminalLabel(terminal)}</Text>
                    </View>
                  </Pressable>
                );
              })}
            </ScrollView>
            <Pressable
              style={{ width: 40, height: 36, alignItems: 'center', justifyContent: 'center', opacity: worktree && !creatingTerminal ? 1 : 0.35 }}
              disabled={!worktree || creatingTerminal}
              onPress={createTerminal}
              accessibilityLabel="New terminal"
            >
              <Plus color={worktree && !creatingTerminal ? colors.text : colors.subtle} size={17} />
            </Pressable>
          </View>
        </View>

        {error && <Text style={{ color: colors.danger, paddingHorizontal: 12, paddingVertical: 8, fontSize: 12 }}>{error}</Text>}

        <View
          style={{ flex: 1, minHeight: 0, position: 'relative', overflow: 'hidden' }}
          onLayout={(event) => {
            terminalFrameHeightRef.current = event.nativeEvent.layout.height;
            if (active) void fitActiveTerminal(active);
          }}
        >
          <TerminalWebView
            ref={terminalRef}
            onWebReady={() => {
              setReady(true);
              if (active && initializedKeyRef.current !== active.id) void openTerminal(active);
            }}
            onTerminalInput={writeBytes}
          />
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ height: 43, maxHeight: 43, flexGrow: 0, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.panel }}
          contentContainerStyle={{ height: 42, alignItems: 'center', gap: 6, paddingHorizontal: 10 }}
        >
          <Key label="Esc" onPress={() => void writeBytes('\x1b')} />
          <Key label="Tab" onPress={() => void writeBytes('\t')} />
          <Key label="Enter" onPress={() => void writeBytes('\r')} />
          <Key label="Ctrl+C" onPress={() => void writeBytes('\x03')} />
          <Key label="Ctrl+D" onPress={() => void writeBytes('\x04')} />
          <Key label="↑" onPress={() => void writeBytes('\x1b[A')} />
          <Key label="↓" onPress={() => void writeBytes('\x1b[B')} />
          <Key label="←" onPress={() => void writeBytes('\x1b[D')} />
          <Key label="→" onPress={() => void writeBytes('\x1b[C')} />
        </ScrollView>

        <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 46, gap: 8, paddingHorizontal: 12, paddingVertical: 6, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.panel }}>
          <TextInput value={input} onChangeText={setInput} placeholder={active ? 'Command' : 'Select a terminal'} placeholderTextColor={colors.subtle} autoCapitalize="none" autoCorrect={false} style={[shared.input, { flex: 1, minHeight: 34, height: 34, paddingVertical: 0, borderRadius: 8, backgroundColor: colors.panelStrong, fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }) }]} onSubmitEditing={submit} editable={!!active} />
          <Pressable style={{ width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.panelStrong, opacity: active ? 1 : 0.35 }} onPress={submit} disabled={!active}><Send color={colors.text} size={17} /></Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Key({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable style={{ minWidth: 36, height: 30, borderRadius: 8, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 5, paddingHorizontal: 10, backgroundColor: colors.panelStrong }} onPress={onPress}>
      {label === 'Ctrl+C' ? <Command color={colors.muted} size={12} /> : null}
      <Text style={{ color: colors.muted, fontSize: 12, fontWeight: '700', fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }) }}>{label}</Text>
    </Pressable>
  );
}

const chromeIconButton = {
  width: 36,
  height: 36,
  borderRadius: 18,
  alignItems: 'center' as const,
  justifyContent: 'center' as const,
};

const chromeTextButton = {
  minHeight: 30,
  borderRadius: 8,
  alignItems: 'center' as const,
  justifyContent: 'center' as const,
  paddingHorizontal: 10,
  marginRight: 4,
  backgroundColor: colors.panelStrong,
};

const chromeTextButtonLabel = {
  color: colors.text,
  fontSize: 12,
  fontWeight: '700' as const,
};

const chromeTitleStyle = {
  color: colors.text,
  fontSize: 14,
  fontWeight: '700' as const,
};

const chromeMetaStyle = {
  color: colors.muted,
  fontSize: 12,
  lineHeight: 16,
};

const selectorChip = {
  minHeight: 32,
  borderRadius: 8,
  borderWidth: 1,
  borderColor: colors.border,
  backgroundColor: colors.panelStrong,
  alignItems: 'center' as const,
  justifyContent: 'center' as const,
  flexDirection: 'row' as const,
  gap: 6,
  paddingHorizontal: 10,
};

const selectorChipActive = {
  backgroundColor: colors.accent,
  borderColor: colors.accent,
};

const selectorChipText = {
  color: colors.muted,
  fontSize: 13,
  fontWeight: '700' as const,
};

const selectorChipTextActive = {
  color: colors.text,
};

const terminalTabStyle = {
  width: 128,
  maxWidth: 128,
  minHeight: 36,
  alignItems: 'center' as const,
  justifyContent: 'center' as const,
  paddingHorizontal: 10,
  borderBottomWidth: 2,
  borderBottomColor: 'transparent',
};

const terminalTabActiveStyle = {
  borderBottomColor: colors.accent,
};

const terminalTabTextStyle = {
  flexShrink: 1,
  color: colors.muted,
  fontSize: 13,
};

const terminalTabTextActiveStyle = {
  color: colors.text,
};
