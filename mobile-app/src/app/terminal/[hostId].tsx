import { router, useLocalSearchParams } from 'expo-router';
import { Check, ChevronLeft, ChevronsRight, Command, GitBranch, Keyboard as KeyboardIcon, Monitor, Plus, RefreshCw, Send, Smartphone, TerminalSquare, X } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { SafeAreaView } from 'react-native-safe-area-context';

import { TerminalWebView, type TerminalWebViewHandle } from '@/terminal/TerminalWebView';
import {
  clearTerminalLiveInputFocusTimer,
  getTerminalLiveSpecialKeyBytes,
  isTerminalLiveInputWithinByteLimit,
  scheduleTerminalLiveInputFocus,
} from '@/terminal/terminal-live-input';
import { AGENT_CATALOG, getAgentEntry } from '@/terminal/agentCatalog';
import { AgentIcon } from '@/terminal/AgentIcon';
import { useDetectedAgents } from '@/terminal/useDetectedAgents';
import type { BraidProject, BraidTerminal, BraidWorktree } from '@/transport/types';
import { colors, shared } from '@/ui/theme';
import { useHostClient } from '@/ui/use-host-client';

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;
const DEFAULT_AGENT_STORAGE_KEY = 'braid.mobile.terminal.defaultAgentId';
// Gap between writing the command text and the Enter byte. TUIs (e.g. Claude
// Code) treat a CR that arrives in the same PTY chunk as the pasted text as a
// literal newline, not a submit; a brief gap makes Enter land as a discrete
// keypress so a single tap actually runs the command.
const SUBMIT_ENTER_DELAY_MS = 40;

function terminalLabel(terminal: BraidTerminal) {
  return terminal.label || terminal.title || terminal.name || terminal.terminalId || terminal.cwd?.split('/').pop() || terminal.id.slice(0, 6);
}

export default function TerminalScreen() {
  const { hostId, worktreePath, worktreeName, terminalId } = useLocalSearchParams<{ hostId: string; worktreePath?: string; worktreeName?: string; terminalId?: string }>();
  const { client, state } = useHostClient(hostId);
  const terminalRef = useRef<TerminalWebViewHandle>(null);
  const detectedAgents = useDetectedAgents(client);
  const [projects, setProjects] = useState<BraidProject[]>([]);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [worktree, setWorktree] = useState<BraidWorktree | null>(null);
  const [terminals, setTerminals] = useState<BraidTerminal[]>([]);
  const [active, setActive] = useState<BraidTerminal | null>(null);
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [selectorsExpanded, setSelectorsExpanded] = useState(true);
  const [creatingTerminal, setCreatingTerminal] = useState(false);
  const [agentPickerOpen, setAgentPickerOpen] = useState(false);
  const [selectedAgentId, setSelectedAgentId] = useState<string>(AGENT_CATALOG[0]?.id ?? 'claude');
  // Set of terminal ids in "live" passthrough mode, so each tab remembers its
  // own input mode when you switch between them.
  const [liveInputHandles, setLiveInputHandles] = useState<Set<string>>(() => new Set());
  // Set of terminal ids showing at the desktop's native size (vs. phone-fit).
  const [desktopModeHandles, setDesktopModeHandles] = useState<Set<string>>(() => new Set());
  const activeIdRef = useRef<string | null>(null);
  // Tracks which deep-link terminalId we've already switched to, so the
  // notification target is honored once (when it first appears in the list) and
  // doesn't yank the user back when the terminal list later changes.
  const honoredTerminalIdRef = useRef<string | null>(null);
  const initializedKeyRef = useRef<string | null>(null);
  const terminalFrameHeightRef = useRef<number | undefined>(undefined);
  const subscriptionRef = useRef<{ terminalId: string; subscriptionId: string } | null>(null);
  const openSeqRef = useRef(0);
  const sendingRef = useRef(false);
  const liveInputRef = useRef<TextInput>(null);
  const liveInputFocusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Mirror of desktopModeHandles for use inside callbacks/notification handlers
  // that must not re-create on every set change.
  const desktopModeRef = useRef<Set<string>>(new Set());
  useEffect(() => { desktopModeRef.current = desktopModeHandles; }, [desktopModeHandles]);
  // Tracks the previous connection state so we can detect a reconnect (the app
  // backgrounding closes the socket, which drops the server-side subscription).
  const prevStateRef = useRef(state);

  const selectedProject = projects.find((project) => project.id === projectId) ?? projects[0] ?? null;
  const isSessionScoped = typeof worktreePath === 'string' && worktreePath.length > 0;
  const selectedAgent = getAgentEntry(selectedAgentId) ?? AGENT_CATALOG[0];
  const detectedAgentIds = new Set(detectedAgents.map((agent) => agent.id));
  const detectedSorted = AGENT_CATALOG.filter((agent) => detectedAgentIds.has(agent.id));
  const undetectedSorted = AGENT_CATALOG.filter((agent) => !detectedAgentIds.has(agent.id));

  useEffect(() => {
    let active = true;
    SecureStore.getItemAsync(DEFAULT_AGENT_STORAGE_KEY)
      .then((stored) => {
        if (!active || !stored) return;
        if (getAgentEntry(stored)) {
          setSelectedAgentId(stored);
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const fitActiveTerminal = useCallback(async (terminal: BraidTerminal) => {
    if (!client || !terminalRef.current) return;
    // In desktop mode we render the desktop's native dimensions (driven by
    // terminal.resized notifications), so never shrink the PTY to phone-fit.
    if (desktopModeRef.current.has(terminal.id)) return;
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
        await client.unsubscribe(subscriptionId).catch(() => undefined);
        return;
      }
      console.log('[BraidMobile] terminal.subscribed', { terminalId: terminal.id, subscriptionId });
      subscriptionRef.current = { terminalId: terminal.id, subscriptionId };
      if (previousSubscription) {
        client.unsubscribe(previousSubscription.subscriptionId).catch(() => undefined);
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
        terminalId: terminal.terminalId ?? terminal.id ?? terminal.ptyId,
        worktreePath: targetWorktree.path,
      })).filter((terminal) => terminal.id);
      console.log('[BraidMobile] terminal.list', { worktree: targetWorktree, list });
      setTerminals(list);
      const next = list.find((terminal) => terminal.id === preferredId || terminal.terminalId === preferredId) ?? list[0] ?? null;
      setActive(next);
      if (next) {
        setSelectorsExpanded(false);
        await openTerminal(next);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [client, openTerminal]);

  const createTerminal = useCallback(async (agentId?: string) => {
    if (!client || !worktree || creatingTerminal) return;
    const agent = getAgentEntry(agentId ?? selectedAgentId) ?? selectedAgent ?? AGENT_CATALOG[0];
    setCreatingTerminal(true);
    setError(null);
    try {
      const created = await client.request<BraidTerminal & { ptyId?: string }>('terminal.create', {
        worktreePath: worktree.path,
        worktreeId: worktree.id,
        label: agent?.label ?? 'Terminal',
        command: agent?.launchCmd ?? agent?.detectCmd ?? 'claude',
        agentId: agent?.id ?? 'claude',
      });
      setSelectedAgentId(agent?.id ?? 'claude');
      void SecureStore.setItemAsync(DEFAULT_AGENT_STORAGE_KEY, agent?.id ?? 'claude').catch(() => undefined);
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
  }, [client, creatingTerminal, openTerminal, selectedAgent, selectedAgentId, worktree]);

  useEffect(() => () => clearTerminalLiveInputFocusTimer(liveInputFocusTimerRef), []);

  useEffect(() => { void loadProjects(); }, [loadProjects]);
  // On first load for a worktree, prefer the tab the notification deep-linked to
  // (terminalId matches either the pty id or the Braid big-terminal id).
  useEffect(() => { void loadTerminals(worktree, active?.id ?? terminalId); }, [worktree]); // eslint-disable-line react-hooks/exhaustive-deps

  // Honor a notification deep-link to a specific terminal. The param can change
  // while this screen is already mounted (a warm tap reuses it), and the target
  // may only appear once the list loads - so react to both. Guarded by
  // honoredTerminalIdRef so we switch once per terminalId and never override a
  // tab the user picked afterward.
  useEffect(() => {
    if (!terminalId || honoredTerminalIdRef.current === terminalId) return;
    const target = terminals.find((item) => item.id === terminalId || item.terminalId === terminalId);
    if (!target) return;
    honoredTerminalIdRef.current = terminalId;
    if (target.id !== activeIdRef.current) void openTerminal(target);
  }, [terminalId, terminals, openTerminal]);

  useEffect(() => {
    if (!client) return;
    const off = client.onNotification((notification) => {
      if (notification.method === 'terminal.data') {
        const params = notification.params as { ptyId?: string; data?: string };
        if (params.ptyId === activeIdRef.current && params.data) {
          terminalRef.current?.write(params.data);
        }
        return;
      }
      if (notification.method === 'terminal.resized') {
        const params = notification.params as { ptyId?: string; cols?: number; rows?: number; displayMode?: 'phone' | 'desktop' };
        if (params.ptyId !== activeIdRef.current) return;
        // The server is authoritative for display mode (it resets to phone on
        // disconnect), so reconcile local state - this keeps the toggle correct
        // when switching tabs or reconnecting into an existing terminal.
        if (params.displayMode && params.ptyId) {
          const id = params.ptyId;
          const wantDesktop = params.displayMode === 'desktop';
          if (wantDesktop !== desktopModeRef.current.has(id)) {
            const next = new Set(desktopModeRef.current);
            if (wantDesktop) next.add(id);
            else next.delete(id);
            desktopModeRef.current = next;
            setDesktopModeHandles(next);
          }
        }
        // The desktop changed the PTY dimensions (e.g. we entered desktop mode
        // and it fit to its own pane). Match the WebView's xterm so it renders
        // correctly; TerminalWebView CSS-scales the wide canvas to fit.
        if (params.cols && params.rows && desktopModeRef.current.has(params.ptyId)) {
          console.log('[BraidMobile] terminal.resized', { ptyId: params.ptyId, cols: params.cols, rows: params.rows });
          terminalRef.current?.resize(params.cols, params.rows);
        }
      }
    });
    return () => {
      off();
      const current = subscriptionRef.current;
      if (current) client.unsubscribe(current.subscriptionId).catch(() => undefined);
    };
  }, [client]);

  // Catch the active terminal up after a reconnect. The client auto-resends the
  // terminal.subscribe on reconnect (resendSubscriptions), so the live stream
  // resumes on its own - re-subscribing here would duplicate it. We only replay
  // scrollback (to pick up output emitted while backgrounded) and refit. Keyed
  // off the connection-state transition since the client instance is reused.
  useEffect(() => {
    const prev = prevStateRef.current;
    prevStateRef.current = state;
    // Only on a real transition back into 'connected' (a reconnect), not the
    // initial connect (handled by loadTerminals) - `active` is null until then.
    if (state !== 'connected' || prev === 'connected' || !active || !client) return;
    const terminal = active;
    console.log('[BraidMobile] terminal.resume', { ptyId: terminal.id });
    client
      .request<string>('terminal.readScrollback', { ptyId: terminal.id })
      .then((scrollback) => {
        if (activeIdRef.current !== terminal.id) return;
        terminalRef.current?.init(DEFAULT_COLS, DEFAULT_ROWS, '');
        if (scrollback) terminalRef.current?.write(scrollback);
        void fitActiveTerminal(terminal);
      })
      .catch(() => undefined);
  }, [state, active, client, fitActiveTerminal]);

  const writeBytes = async (data: string) => {
    if (!client || !active || !data) return;
    await client.request('terminal.write', { ptyId: active.id, data });
  };

  const submit = async () => {
    // Behave like pressing Enter: send the typed text (if any), then the
    // carriage return as a SEPARATE write so the TUI registers it as a discrete
    // Enter keypress rather than folding it into the pasted text (which would
    // insert a literal newline and require a second tap to submit). With empty
    // input this sends a bare Enter, replacing the standalone key.
    // sendingRef guards against a double-tap firing the command twice; the
    // input is restored if the write fails so nothing is silently lost.
    if (!active || sendingRef.current) return;
    sendingRef.current = true;
    const text = input;
    setInput('');
    try {
      if (text) {
        await writeBytes(text);
        await new Promise((resolve) => setTimeout(resolve, SUBMIT_ENTER_DELAY_MS));
      }
      await writeBytes('\r');
    } catch {
      setInput(text);
    } finally {
      sendingRef.current = false;
    }
  };

  const liveInputEnabled = !!active && liveInputHandles.has(active.id);

  // Live mode: forward raw bytes straight to the PTY (no buffering, no Enter).
  const sendLiveTerminalInput = (bytes: string) => {
    if (!bytes || !client || !active) return;
    if (!isTerminalLiveInputWithinByteLimit(bytes)) {
      setError('Input too large (max 256 KiB)');
      return;
    }
    client.request('terminal.write', { ptyId: active.id, data: bytes }).catch(() => undefined);
  };

  const focusLiveInput = () => {
    if (!active || !liveInputEnabled) return;
    liveInputRef.current?.focus();
  };

  const toggleLiveInput = () => {
    if (!active) return;
    const id = active.id;
    const nextEnabled = !liveInputHandles.has(id);
    setLiveInputHandles((prev) => {
      const next = new Set(prev);
      if (nextEnabled) next.add(id);
      else next.delete(id);
      return next;
    });
    if (nextEnabled) {
      scheduleTerminalLiveInputFocus(liveInputFocusTimerRef, () => liveInputRef.current?.focus());
    } else {
      clearTerminalLiveInputFocusTimer(liveInputFocusTimerRef);
      liveInputRef.current?.blur();
    }
  };

  const handleLiveInputChange = (text: string) => {
    if (!active || !liveInputHandles.has(active.id)) {
      liveInputRef.current?.setNativeProps({ text: '' });
      return;
    }
    if (text.length > 0) sendLiveTerminalInput(text);
    // Why: the field is only a keyboard capture surface. Clearing the native
    // value prevents subsequent keyboard events from replaying already-sent
    // characters while React state stays the empty string.
    liveInputRef.current?.setNativeProps({ text: '' });
  };

  const handleLiveInputKeyPress = (event: { nativeEvent: { key: string } }) => {
    if (!active || !liveInputHandles.has(active.id)) return;
    const bytes = getTerminalLiveSpecialKeyBytes(event.nativeEvent.key);
    if (!bytes) return;
    sendLiveTerminalInput(bytes);
    liveInputRef.current?.setNativeProps({ text: '' });
  };

  const handleLiveInputSubmit = () => {
    if (!active || !liveInputHandles.has(active.id)) return;
    sendLiveTerminalInput('\r');
    liveInputRef.current?.setNativeProps({ text: '' });
  };

  const desktopMode = !!active && desktopModeHandles.has(active.id);

  // Toggle between phone-fit (the desktop yields, PTY sized to this phone) and
  // desktop size (the desktop drives its native dims, we scale to fit).
  const toggleDisplayMode = async () => {
    if (!client || !active) return;
    const id = active.id;
    const nextDesktop = !desktopModeHandles.has(id);
    const nextSet = new Set(desktopModeRef.current);
    if (nextDesktop) nextSet.add(id);
    else nextSet.delete(id);
    desktopModeRef.current = nextSet; // sync immediately so resize notifications are honored
    setDesktopModeHandles(nextSet);
    try {
      if (nextDesktop) {
        // The desktop un-holds and fits to its own pane; the resulting PTY
        // resize streams back via terminal.resized, which sizes our xterm.
        await client.request('terminal.setDisplayMode', { ptyId: id, mode: 'desktop' });
      } else {
        const dims = await terminalRef.current?.measureFitDimensions(terminalFrameHeightRef.current);
        await client.request('terminal.setDisplayMode', {
          ptyId: id,
          mode: 'phone',
          viewport: dims ? { cols: dims.cols, rows: dims.rows } : undefined,
        });
        if (dims) terminalRef.current?.resize(dims.cols, dims.rows);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
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
              onPress={() => setAgentPickerOpen(true)}
              accessibilityLabel="Choose terminal agent"
            >
              <Plus color={worktree && !creatingTerminal ? colors.text : colors.subtle} size={17} />
            </Pressable>
          </View>
        </View>

        {error && <Text style={{ color: colors.danger, paddingHorizontal: 12, paddingVertical: 8, fontSize: 12 }}>{error}</Text>}

        <Modal visible={agentPickerOpen} transparent animationType="fade" onRequestClose={() => setAgentPickerOpen(false)}>
          <Pressable style={pickerBackdrop} onPress={() => setAgentPickerOpen(false)}>
            <View style={pickerPanel}>
              <View style={pickerHeader}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={pickerTitle}>New terminal</Text>
                  <Text style={pickerSubtitle} numberOfLines={1}>
                    {selectedAgent?.label ?? 'Terminal'} {selectedAgent?.detectCmd ? `· ${selectedAgent.detectCmd}` : ''}
                  </Text>
                </View>
                <Pressable
                  style={pickerCloseButton}
                  onPress={() => setAgentPickerOpen(false)}
                  accessibilityLabel="Close agent picker"
                >
                  <X color={colors.text} size={18} />
                </Pressable>
              </View>
              <ScrollView style={pickerList} contentContainerStyle={pickerListContent}>
                {detectedSorted.length > 0 && (
                  <View style={{ gap: 8 }}>
                    <Text style={pickerSectionLabel}>Detected on this host</Text>
                    {detectedSorted.map((agent) => {
                      const selected = agent.id === selectedAgentId;
                      return (
                        <Pressable
                          key={agent.id}
                          style={({ pressed }) => [
                            pickerRow,
                            pressed && pickerRowPressed,
                            selected && pickerRowSelected,
                          ]}
                          onPress={() => {
                            setAgentPickerOpen(false);
                            void createTerminal(agent.id);
                          }}
                        >
                          <View style={pickerRowIcon}>
                            <AgentIcon agentId={agent.id} size={20} />
                          </View>
                          <View style={{ flex: 1, minWidth: 0 }}>
                            <Text style={pickerRowTitle} numberOfLines={1}>
                              {agent.label}
                            </Text>
                            <Text style={pickerRowSubtitle} numberOfLines={1}>
                              {agent.detectCmd}
                            </Text>
                          </View>
                          {selected ? <Check color={colors.accent} size={16} /> : null}
                        </Pressable>
                      );
                    })}
                  </View>
                )}

                <View style={{ gap: 8 }}>
                  <Text style={pickerSectionLabel}>{detectedSorted.length > 0 ? 'Other agents' : 'All agents'}</Text>
                  {undetectedSorted.map((agent) => {
                    const selected = agent.id === selectedAgentId;
                    return (
                      <Pressable
                        key={agent.id}
                        style={({ pressed }) => [
                          pickerRow,
                          pressed && pickerRowPressed,
                          selected && pickerRowSelected,
                        ]}
                        onPress={() => {
                          setAgentPickerOpen(false);
                          void createTerminal(agent.id);
                        }}
                      >
                        <View style={pickerRowIcon}>
                          <AgentIcon agentId={agent.id} size={20} />
                        </View>
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text style={pickerRowTitle} numberOfLines={1}>
                            {agent.label}
                          </Text>
                          <Text style={pickerRowSubtitle} numberOfLines={1}>
                            {agent.detectCmd}
                          </Text>
                        </View>
                        {selected ? <Check color={colors.accent} size={16} /> : null}
                      </Pressable>
                    );
                  })}
                </View>
              </ScrollView>
            </View>
          </Pressable>
        </Modal>

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
              if (active && initializedKeyRef.current !== active.id) void openTerminal(active);
            }}
            onTerminalInput={writeBytes}
          />
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', height: 43, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.panel }}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={{ flex: 1, height: 43, maxHeight: 43 }}
            contentContainerStyle={{ height: 42, alignItems: 'center', gap: 6, paddingHorizontal: 10 }}
          >
            <Key label="Esc" onPress={() => void writeBytes('\x1b')} />
            <Key label="Tab" onPress={() => void writeBytes('\t')} />
            <Key label="Ctrl+C" onPress={() => void writeBytes('\x03')} />
            <Key label="Ctrl+D" onPress={() => void writeBytes('\x04')} />
            <Key label="↑" onPress={() => void writeBytes('\x1b[A')} />
            <Key label="↓" onPress={() => void writeBytes('\x1b[B')} />
            <Key label="←" onPress={() => void writeBytes('\x1b[D')} />
            <Key label="→" onPress={() => void writeBytes('\x1b[C')} />
          </ScrollView>
          <Pressable
            style={[liveToggleButton, desktopMode && liveToggleButtonActive, !active && { opacity: 0.35 }]}
            disabled={!active}
            onPress={() => void toggleDisplayMode()}
            accessibilityLabel={desktopMode ? 'Switch to phone size' : 'Switch to desktop size'}
          >
            {desktopMode ? (
              <Smartphone color={colors.bg} size={16} />
            ) : (
              <Monitor color={active ? colors.muted : colors.subtle} size={16} />
            )}
          </Pressable>
          <Pressable
            style={[liveToggleButton, liveInputEnabled && liveToggleButtonActive, !active && { opacity: 0.35 }]}
            disabled={!active}
            onPress={toggleLiveInput}
            accessibilityLabel={liveInputEnabled ? 'Switch to buffered command input' : 'Switch to live terminal input'}
          >
            <ChevronsRight color={liveInputEnabled ? colors.bg : active ? colors.muted : colors.subtle} size={16} />
          </Pressable>
        </View>

        {liveInputEnabled ? (
          <Pressable
            style={{ flexDirection: 'row', alignItems: 'center', minHeight: 46, gap: 8, paddingHorizontal: 12, paddingVertical: 6, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.panel }}
            onPress={focusLiveInput}
            disabled={!active}
            accessibilityLabel="Focus live terminal input"
          >
            <KeyboardIcon color={colors.muted} size={16} />
            <Text style={{ flex: 1, color: colors.muted, fontSize: 12, fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }) }} numberOfLines={1}>
              Keyboard input goes directly to terminal
            </Text>
            <TextInput
              ref={liveInputRef}
              style={{ position: 'absolute', opacity: 0, width: 1, height: 1, color: colors.text }}
              value=""
              onChangeText={handleLiveInputChange}
              onKeyPress={handleLiveInputKeyPress}
              onSubmitEditing={handleLiveInputSubmit}
              placeholder=""
              autoCapitalize="none"
              autoCorrect={false}
              spellCheck={false}
              keyboardType={Platform.OS === 'ios' ? 'ascii-capable' : 'visible-password'}
              returnKeyType="default"
              submitBehavior="submit"
              editable={!!active}
              importantForAutofill="no"
              textContentType="none"
            />
          </Pressable>
        ) : (
          <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 46, gap: 8, paddingHorizontal: 12, paddingVertical: 6, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.panel }}>
            <TextInput value={input} onChangeText={setInput} placeholder={active ? 'Command' : 'Select a terminal'} placeholderTextColor={colors.subtle} autoCapitalize="none" autoCorrect={false} style={[shared.input, { flex: 1, minHeight: 34, height: 34, paddingVertical: 0, borderRadius: 8, backgroundColor: colors.panelStrong, fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }) }]} onSubmitEditing={submit} editable={!!active} />
            <Pressable style={{ width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.panelStrong, opacity: active ? 1 : 0.35 }} onPress={submit} disabled={!active}><Send color={colors.text} size={17} /></Pressable>
          </View>
        )}
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

const liveToggleButton = {
  width: 36,
  height: 30,
  marginHorizontal: 6,
  borderRadius: 8,
  alignItems: 'center' as const,
  justifyContent: 'center' as const,
  backgroundColor: colors.panelStrong,
};

const liveToggleButtonActive = {
  backgroundColor: colors.accent,
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

const pickerBackdrop = {
  flex: 1,
  backgroundColor: 'rgba(5, 8, 12, 0.72)',
  justifyContent: 'flex-end' as const,
  padding: 12,
};

const pickerPanel = {
  maxHeight: 520,
  borderRadius: 16,
  borderWidth: 1,
  borderColor: colors.border,
  backgroundColor: colors.panel,
  overflow: 'hidden' as const,
};

const pickerHeader = {
  minHeight: 56,
  flexDirection: 'row' as const,
  alignItems: 'center' as const,
  gap: 12,
  paddingHorizontal: 14,
  paddingVertical: 12,
  borderBottomWidth: 1,
  borderBottomColor: colors.border,
};

const pickerTitle = {
  color: colors.text,
  fontSize: 15,
  fontWeight: '700' as const,
};

const pickerSubtitle = {
  color: colors.muted,
  fontSize: 12,
  marginTop: 2,
};

const pickerCloseButton = {
  width: 34,
  height: 34,
  borderRadius: 17,
  alignItems: 'center' as const,
  justifyContent: 'center' as const,
  backgroundColor: colors.panelStrong,
};

const pickerList = {
  maxHeight: 520,
};

const pickerListContent = {
  padding: 10,
  gap: 8,
};

const pickerSectionLabel = {
  color: colors.subtle,
  fontSize: 11,
  fontWeight: '800' as const,
  textTransform: 'uppercase' as const,
  letterSpacing: 0,
  paddingHorizontal: 2,
  paddingTop: 2,
};

const pickerRow = {
  minHeight: 52,
  flexDirection: 'row' as const,
  alignItems: 'center' as const,
  gap: 12,
  borderRadius: 12,
  borderWidth: 1,
  borderColor: colors.border,
  backgroundColor: colors.panelStrong,
  paddingHorizontal: 12,
  paddingVertical: 10,
};

const pickerRowIcon = {
  width: 24,
  height: 24,
  alignItems: 'center' as const,
  justifyContent: 'center' as const,
};

const pickerRowPressed = {
  backgroundColor: '#20262D',
};

const pickerRowSelected = {
  borderColor: colors.accent,
};

const pickerRowTitle = {
  color: colors.text,
  fontSize: 14,
  fontWeight: '700' as const,
};

const pickerRowSubtitle = {
  color: colors.muted,
  fontSize: 12,
  marginTop: 2,
  fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
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
