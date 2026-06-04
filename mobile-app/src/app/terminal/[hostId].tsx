import { router, useLocalSearchParams } from 'expo-router';
import { Check, ChevronsRight, Command, GitBranch, Keyboard as KeyboardIcon, Monitor, MoreHorizontal, Pencil, Plus, RefreshCw, Send, Smartphone, TerminalSquare, Trash2, WifiOff, X } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import * as Clipboard from 'expo-clipboard';
import { SafeAreaView } from 'react-native-safe-area-context';

import { TerminalWebView, TERMINAL_THEMES, type TerminalWebViewHandle } from '@/terminal/TerminalWebView';
import {
  clearTerminalLiveInputFocusTimer,
  getTerminalLiveSpecialKeyBytes,
  isTerminalLiveInputWithinByteLimit,
  scheduleTerminalLiveInputFocus,
} from '@/terminal/terminal-live-input';
import { AGENT_CATALOG, SHELL_AGENT_ID, getAgentEntry } from '@/terminal/agentCatalog';
import { AgentIcon } from '@/terminal/AgentIcon';
import { useDetectedAgents } from '@/terminal/useDetectedAgents';
import { useHostStatus } from '@/terminal/useHostStatus';
import { isErrorVerdict } from '@/transport/connection-health';
import { desktopSupports } from '@/transport/protocol-compat';
import { MOBILE_CAPABILITY } from '@/transport/protocol-version';
import type { BraidProject, BraidTerminal, BraidWorktree } from '@/transport/types';
import { HeaderBackButton } from '@/ui/kit';
import { useShared, useTheme } from '@/ui/theme';
import { useHostClient } from '@/ui/use-host-client';

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;
// Cap the scrollback snapshot replayed on open/reconnect. The desktop keeps a
// multi-megabyte ring buffer per terminal; shipping all of it stalls first
// paint and the device only renders the tail anyway. 256 KB is plenty of
// history for a phone viewport. The desktop trims to a clean line boundary.
const SCROLLBACK_SNAPSHOT_BYTES = 256 * 1024;
// Debounce window for re-fitting the PTY after a live layout change. iPad Split
// View / Stage Manager (and rotation) fire onLayout continuously while dragging;
// the WebView already rescales its canvas on every viewport change (a cheap CSS
// transform), so we only reflow the PTY (cols/rows + resize RPC + SIGWINCH) once
// the drag settles instead of on every intermediate frame.
const REFIT_DEBOUNCE_MS = 150;
const DEFAULT_AGENT_STORAGE_KEY = 'braid.mobile.terminal.defaultAgentId';
// Gap between writing the command text and the Enter byte. TUIs (e.g. Claude
// Code) treat a CR that arrives in the same PTY chunk as the pasted text as a
// literal newline, not a submit; a brief gap makes Enter land as a discrete
// keypress so a single tap actually runs the command.
const SUBMIT_ENTER_DELAY_MS = 40;

function terminalLabel(terminal: BraidTerminal) {
  return terminal.label || terminal.title || terminal.name || terminal.terminalId || terminal.cwd?.split('/').pop() || terminal.id.slice(0, 6);
}

// Promise-wrapped native confirm. Resolves true only when the user taps the
// destructive action; Cancel (or dismissing the alert) resolves false.
function confirmAsync(title: string, message: string, confirmLabel: string, cancelLabel: string): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(
      title,
      message,
      [
        { text: cancelLabel, style: 'cancel', onPress: () => resolve(false) },
        { text: confirmLabel, style: 'destructive', onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}

export default function TerminalScreen() {
  const { t } = useTranslation();
  const { hostId, worktreePath, worktreeName, terminalId, autoAgentId } = useLocalSearchParams<{ hostId: string; worktreePath?: string; worktreeName?: string; terminalId?: string; autoAgentId?: string }>();
  const { client, state, verdict, reconnect } = useHostClient(hostId);
  const { palette: colors, scheme } = useTheme();
  const shared = useShared();
  const terminalRef = useRef<TerminalWebViewHandle>(null);
  const detectedAgents = useDetectedAgents(client);
  const hostStatus = useHostStatus(client);
  // Bare shell tabs are only offered when the paired desktop advertises the
  // capability. Older desktops would silently launch Claude for an unknown
  // agentId, so we hide the option instead of degrading to that surprise.
  const bareTerminalSupported = desktopSupports(hostStatus, MOBILE_CAPABILITY.bareTerminal);
  const [projects, setProjects] = useState<BraidProject[]>([]);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [worktree, setWorktree] = useState<BraidWorktree | null>(null);
  const [terminals, setTerminals] = useState<BraidTerminal[]>([]);
  const [active, setActive] = useState<BraidTerminal | null>(null);
  const [inputReadyTerminalId, setInputReadyTerminalId] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [selectorsExpanded, setSelectorsExpanded] = useState(true);
  const [creatingTerminal, setCreatingTerminal] = useState(false);
  const [agentPickerOpen, setAgentPickerOpen] = useState(false);
  const [terminalMoreOpen, setTerminalMoreOpen] = useState(false);
  const [selectedAgentId, setSelectedAgentId] = useState<string>(AGENT_CATALOG[0]?.id ?? 'claude');
  // Terminal being renamed (null when the rename modal is closed) + its draft.
  const [renameTarget, setRenameTarget] = useState<{ terminal: BraidTerminal; draft: string } | null>(null);
  // Terminal whose long-press action sheet is open (null when closed).
  const [actionTarget, setActionTarget] = useState<BraidTerminal | null>(null);
  // Set of terminal ids in "live" passthrough mode, so each tab remembers its
  // own input mode when you switch between them.
  const [liveInputHandles, setLiveInputHandles] = useState<Set<string>>(() => new Set());
  // Set of terminal ids showing at the desktop's native size (vs. phone-fit).
  const [desktopModeHandles, setDesktopModeHandles] = useState<Set<string>>(() => new Set());
  const activeIdRef = useRef<string | null>(null);
  // Mirror of the active terminal object, for the notification handler (deps:
  // [client]) which must not re-create on every `active` change.
  const activeTerminalRef = useRef<BraidTerminal | null>(null);
  // Mirror of the tab list so the notification handler can reconcile remote
  // rename/close events without re-subscribing on every list change.
  const terminalsRef = useRef<BraidTerminal[]>([]);
  // Last phone-fit dimensions we applied to the PTY. Used to detect when the
  // desktop (its active tab momentarily un-held) has resized the shared PTY
  // away from our phone viewport, so we can re-assert the fit instead of
  // rendering desktop-width output in our narrow grid.
  const phoneFitDimsRef = useRef<{ cols: number; rows: number } | null>(null);
  // Tracks which deep-link terminalId we've already switched to, so the
  // notification target is honored once (when it first appears in the list) and
  // doesn't yank the user back when the terminal list later changes.
  const honoredTerminalIdRef = useRef<string | null>(null);
  // Agent chosen at worktree-creation time (autoAgentId route param) to launch
  // once, automatically, when this screen first loads that worktree with no
  // existing terminals. Consumed in loadTerminals so it runs after the list
  // load instead of racing it.
  const pendingAutoAgentRef = useRef<{ worktreePath: string; agentId: string } | null>(null);
  // Stable handle to the latest createTerminal so loadTerminals can call it
  // without a forward reference (createTerminal is defined below) or a dep cycle.
  const createTerminalRef = useRef<((agentId?: string, targetWorktree?: BraidWorktree) => Promise<void>) | null>(null);
  const initializedKeyRef = useRef<string | null>(null);
  const terminalFrameHeightRef = useRef<number | undefined>(undefined);
  const refitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const subscriptionRef = useRef<{ terminalId: string; subscriptionId: string } | null>(null);
  const openSeqRef = useRef(0);
  const sendingRef = useRef(false);
  const liveInputRef = useRef<TextInput>(null);
  const liveInputFocusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Mirror of desktopModeHandles for use inside callbacks/notification handlers
  // that must not re-create on every set change.
  const desktopModeRef = useRef<Set<string>>(new Set());
  useEffect(() => { desktopModeRef.current = desktopModeHandles; }, [desktopModeHandles]);
  useEffect(() => { activeTerminalRef.current = active; }, [active]);
  useEffect(() => () => {
    if (refitTimerRef.current) clearTimeout(refitTimerRef.current);
  }, []);
  useEffect(() => { terminalsRef.current = terminals; }, [terminals]);
  // Mirror of the active worktree so the notification handler can re-fetch the
  // tab strip for the right worktree without re-subscribing on every change.
  const worktreeRef = useRef<BraidWorktree | null>(worktree);
  useEffect(() => { worktreeRef.current = worktree; }, [worktree]);
  // Tracks the previous connection state so we can detect a reconnect (the app
  // backgrounding closes the socket, which drops the server-side subscription).
  const prevStateRef = useRef(state);
  // Mirror of the loaded project list so the connect effect can tell whether the
  // initial load ever succeeded (a deep-link can mount this screen while still
  // disconnected; if that first projects.list races a failed connect, the list
  // stays empty and must be re-fetched once the socket finally connects).
  const projectsRef = useRef(projects);
  // Mirror via an effect declared ABOVE the connect effect, so it runs first in
  // any shared commit and the connect effect never reads a stale list. (Writing
  // a ref during render trips the hooks lint and isn't needed here.)
  useEffect(() => { projectsRef.current = projects; }, [projects]);

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
    phoneFitDimsRef.current = dims;
    terminalRef.current.resize(dims.cols, dims.rows);
    await client.request('terminal.resize', { ptyId: terminal.id, cols: dims.cols, rows: dims.rows });
  }, [client]);

  const openTerminal = useCallback(async (terminal: BraidTerminal) => {
    if (!client) return;
    const seq = openSeqRef.current + 1;
    openSeqRef.current = seq;
    const previousSubscription = subscriptionRef.current;
    subscriptionRef.current = null;
    setInputReadyTerminalId(null);
    activeIdRef.current = terminal.id;
    initializedKeyRef.current = terminal.id;
    setActive(terminal);
    console.log('[BraidMobile] terminal.open.start', { terminal });
    // Clear the previous tab's content immediately on switch.
    terminalRef.current?.init(DEFAULT_COLS, DEFAULT_ROWS, '');
    // The desktop returns the scrollback snapshot AND the PTY's current size in
    // the subscribe result (terminal.subscribe-snapshot.v1), ordered ahead of any
    // live output. We send our last-known phone fit as the viewport so the desktop
    // pre-sizes the PTY (and marks us the viewport actor) before serializing the
    // snapshot, and we init xterm at the size it reports back with the snapshot as
    // the initial replay - so history is laid out at the exact width it was
    // serialized at and an alt-screen TUI (Claude Code) never wraps wrong. On the
    // first open fitDims is null; fitActiveTerminal then measures + resizes
    // authoritatively after.
    const fitDims = phoneFitDimsRef.current;
    let snapshot: string | undefined;
    try {
      const subscriptionId = await client.subscribe<{ subscriptionId: string; snapshot?: string; cols?: number; rows?: number }>(
        'terminal.subscribe',
        {
          ptyId: terminal.id,
          maxBytes: SCROLLBACK_SNAPSHOT_BYTES,
          ...(fitDims ? { viewport: { cols: fitDims.cols, rows: fitDims.rows } } : {}),
        },
        (result) => {
          snapshot = result.snapshot;
          if (activeIdRef.current !== terminal.id) return;
          // Atomic init at the serialized size with history as the initial replay.
          terminalRef.current?.init(result.cols ?? DEFAULT_COLS, result.rows ?? DEFAULT_ROWS, snapshot ?? '');
        },
      );
      if (openSeqRef.current !== seq) {
        await client.unsubscribe(subscriptionId).catch(() => undefined);
        return;
      }
      console.log('[BraidMobile] terminal.subscribed', { terminalId: terminal.id, subscriptionId, snapshotLength: snapshot?.length });
      subscriptionRef.current = { terminalId: terminal.id, subscriptionId };
      if (activeIdRef.current === terminal.id) {
        setInputReadyTerminalId(terminal.id);
      }
      if (previousSubscription) {
        client.unsubscribe(previousSubscription.subscriptionId).catch(() => undefined);
      }
    } catch (err) {
      if (openSeqRef.current === seq) {
        setInputReadyTerminalId(null);
        setError(err instanceof Error ? err.message : String(err));
      }
      return;
    }

    // Fallback for desktops without the subscribe-snapshot capability (no inline
    // snapshot field): fetch the scrollback separately. This is the pre-existing
    // path and keeps the ordering race only for older servers.
    if (snapshot === undefined) {
      client.request<string>('terminal.readScrollback', { ptyId: terminal.id, maxBytes: SCROLLBACK_SNAPSHOT_BYTES })
        .then((scrollback) => {
          if (openSeqRef.current !== seq || activeIdRef.current !== terminal.id || !scrollback) return;
          console.log('[BraidMobile] terminal.scrollback', { terminalId: terminal.id, scrollbackLength: scrollback.length });
          terminalRef.current?.write(scrollback);
        })
        .catch((err) => {
          console.log('[BraidMobile] terminal.scrollback.error', { terminalId: terminal.id, error: err instanceof Error ? err.message : String(err) });
        });
    }
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
          branch: typeof worktreeName === 'string' && worktreeName ? worktreeName : worktreePath.split('/').pop() ?? t('terminal.worktreeFallback'),
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
  }, [client, isSessionScoped, t, worktreeName, worktreePath]);

  const loadTerminals = useCallback(async (targetWorktree: BraidWorktree | null, preferredId?: string) => {
    if (!client || !targetWorktree) return;
    setError(null);
    try {
      const raw = await client.request<(BraidTerminal & { ptyId?: string })[]>('terminal.list', { worktreePath: targetWorktree.path });
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
      } else {
        setInputReadyTerminalId(null);
        // Fresh worktree with no terminals: auto-launch the agent picked at
        // creation time. Done here (after the list load) so it can't race the
        // setTerminals([]) above and get wiped from the tab strip.
        const pendingAuto = pendingAutoAgentRef.current;
        if (pendingAuto && pendingAuto.worktreePath === targetWorktree.path) {
          pendingAutoAgentRef.current = null;
          await createTerminalRef.current?.(pendingAuto.agentId, targetWorktree);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [client, openTerminal]);

  // Lightweight re-sync of the tab strip when the desktop's terminal set changes
  // (a terminal was created or restored after a cold start). Unlike
  // loadTerminals this never re-opens an already-active terminal, so a live
  // session isn't interrupted: it only opens a tab when none is active, or when
  // the previously-active tab has vanished. This is what makes a terminal the
  // desktop restored show up without the user manually pulling to refresh.
  const refreshTerminalList = useCallback(async (targetWorktree: BraidWorktree | null) => {
    if (!client || !targetWorktree) return;
    try {
      const raw = await client.request<(BraidTerminal & { ptyId?: string })[]>('terminal.list', { worktreePath: targetWorktree.path });
      const list = raw.map((terminal) => ({
        ...terminal,
        id: terminal.id ?? terminal.ptyId ?? '',
        terminalId: terminal.terminalId ?? terminal.id ?? terminal.ptyId,
        worktreePath: targetWorktree.path,
      })).filter((terminal) => terminal.id);
      console.log('[BraidMobile] terminal.listChanged.refresh', { worktree: targetWorktree.path, count: list.length });
      setTerminals(list);
      const activeId = activeIdRef.current;
      // Active tab still present - leave the live session untouched.
      if (activeId && list.some((terminal) => terminal.id === activeId)) return;
      const next = list[0] ?? null;
      if (next) {
        setSelectorsExpanded(false);
        await openTerminal(next);
      } else if (activeId) {
        // The active tab was reaped elsewhere and nothing remains.
        activeIdRef.current = null;
        setActive(null);
        setInputReadyTerminalId(null);
        setSelectorsExpanded(true);
      }
    } catch (err) {
      // Best effort; the manual refresh button (⟳) remains as a fallback.
      console.log('[BraidMobile] terminal.listChanged.refresh.error', { error: err instanceof Error ? err.message : String(err) });
    }
  }, [client, openTerminal]);

  const createTerminal = useCallback(async (agentId?: string, targetWorktree?: BraidWorktree) => {
    // `targetWorktree` lets callers (e.g. auto-launch right after a worktree is
    // created) act on a specific worktree without waiting for the `worktree`
    // state to catch up.
    const wt = targetWorktree ?? worktree;
    if (!client || !wt || creatingTerminal) return;
    // A bare shell tab: no agent, no launch command. The desktop (when it
    // advertises terminal.bare.v1) spawns the PTY and writes nothing.
    const isBare = (agentId ?? selectedAgentId) === SHELL_AGENT_ID;
    const agent = isBare ? undefined : getAgentEntry(agentId ?? selectedAgentId) ?? selectedAgent ?? AGENT_CATALOG[0];
    setCreatingTerminal(true);
    setError(null);
    try {
      const created = await client.request<BraidTerminal & { ptyId?: string }>('terminal.create', {
        worktreePath: wt.path,
        worktreeId: wt.id,
        label: isBare ? t('terminal.shellLabel') : agent?.label ?? t('terminal.defaultLabel'),
        // Bare terminals omit the command so the desktop leaves a plain prompt.
        command: isBare ? '' : agent?.launchCmd ?? agent?.detectCmd ?? 'claude',
        agentId: isBare ? SHELL_AGENT_ID : agent?.id ?? 'claude',
      });
      // Don't persist 'shell' as the default agent - keep the last real agent.
      if (!isBare) {
        setSelectedAgentId(agent?.id ?? 'claude');
        void SecureStore.setItemAsync(DEFAULT_AGENT_STORAGE_KEY, agent?.id ?? 'claude').catch(() => undefined);
      }
      const terminal = {
        ...created,
        id: created.id ?? created.ptyId ?? '',
        worktreePath: wt.path,
      };
      if (!terminal.id) throw new Error(t('terminal.errorNoTerminalId'));
      setTerminals((current) => [...current.filter((item) => item.id !== terminal.id), terminal]);
      setSelectorsExpanded(false);
      await openTerminal(terminal);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreatingTerminal(false);
    }
  }, [client, creatingTerminal, openTerminal, selectedAgent, selectedAgentId, t, worktree]);

  // Keep loadTerminals' stable handle pointed at the latest createTerminal.
  useEffect(() => { createTerminalRef.current = createTerminal; });

  // Arm the one-shot agent auto-launch when arriving from "create worktree"
  // (the host screen passes the chosen agent via the autoAgentId route param).
  useEffect(() => {
    if (autoAgentId && worktreePath) pendingAutoAgentRef.current = { worktreePath, agentId: autoAgentId };
  }, [autoAgentId, worktreePath]);

  // Close a terminal tab: kill it on the desktop, drop it from the tab strip,
  // and - if it was the active tab - fall back to the next tab (or empty state).
  const closeTerminal = useCallback(async (terminal: BraidTerminal) => {
    if (!client) return;
    // Warn before killing a session that's also open elsewhere (the desktop or
    // another paired device). Best-effort: an older desktop without the
    // terminal.presence RPC just errors here and we close without the prompt.
    try {
      const presence = await client.request<{ openElsewhere?: boolean; openOnDesktop?: boolean }>(
        'terminal.presence',
        { terminalId: terminal.terminalId, ptyId: terminal.id },
      );
      if (presence?.openElsewhere) {
        const where = presence.openOnDesktop ? t('terminal.closeWhereDesktop') : t('terminal.closeWhereDevice');
        const confirmed = await confirmAsync(
          t('terminal.closeConfirmTitle'),
          t('terminal.closeConfirmMessage', { where }),
          t('terminal.closeAnyway'),
          t('common.cancel'),
        );
        if (!confirmed) return;
      }
    } catch {
      // No presence info available - proceed with the close.
    }
    const wasActive = activeIdRef.current === terminal.id;
    try {
      await client.request('terminal.close', {
        terminalId: terminal.terminalId,
        ptyId: terminal.id,
        worktreePath: terminal.worktreePath,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return;
    }
    if (subscriptionRef.current?.terminalId === terminal.id) {
      client.unsubscribe(subscriptionRef.current.subscriptionId).catch(() => undefined);
      subscriptionRef.current = null;
    }
    const remaining = terminals.filter((item) => item.id !== terminal.id);
    setTerminals(remaining);
    if (wasActive) {
      const next = remaining[0] ?? null;
      if (next) {
        await openTerminal(next);
      } else {
        activeIdRef.current = null;
        setActive(null);
        setInputReadyTerminalId(null);
        setSelectorsExpanded(true);
        // No terminals left: tear down the HTML terminal so it doesn't linger
        // with stale content, mirroring selectProject/selectWorktree.
        terminalRef.current?.clear();
      }
    }
  }, [client, openTerminal, t, terminals]);

  // Rename a terminal tab: optimistically relabel locally, then tell the
  // desktop (which fans the new label out to every other paired device and the
  // desktop tab strip). Mirrors the desktop's inline tab rename.
  const renameTerminal = useCallback(async (terminal: BraidTerminal, label: string) => {
    if (!client) return;
    const trimmed = label.trim();
    if (!trimmed || trimmed === terminalLabel(terminal)) return;
    const relabel = (t: BraidTerminal) => ({ ...t, label: trimmed, title: trimmed, name: trimmed });
    setTerminals((current) => current.map((item) => (item.id === terminal.id ? relabel(item) : item)));
    setActive((current) => (current && current.id === terminal.id ? relabel(current) : current));
    try {
      await client.request('terminal.rename', {
        terminalId: terminal.terminalId,
        ptyId: terminal.id,
        label: trimmed,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [client]);

  // Long-press a tab to open a themed action sheet (rename / close). Mirrors the
  // per-tab actions on the desktop.
  const showTerminalActions = useCallback((terminal: BraidTerminal) => {
    setActionTarget(terminal);
  }, []);

  useEffect(() => () => clearTerminalLiveInputFocusTimer(liveInputFocusTimerRef), []);

  // Load-on-mount / load-on-worktree-change data fetches. The loaders setState
  // only after awaiting the RPC, but the hooks linter still flags the call as a
  // setState-in-effect; this is the intended data-fetching pattern here.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void loadProjects(); }, [loadProjects]);
  // On first load for a worktree, prefer the tab the notification deep-linked to
  // (terminalId matches either the pty id or the Braid big-terminal id).
  // eslint-disable-next-line react-hooks/set-state-in-effect, react-hooks/exhaustive-deps
  useEffect(() => { void loadTerminals(worktree, active?.id ?? terminalId); }, [worktree]);

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
      // The desktop's live terminal set changed (a tab was created, or a session
      // was restored/reattached after a cold start). Re-sync the strip for the
      // current worktree - this is what surfaces a restored terminal without a
      // manual pull. Non-disruptive: it won't re-open the active tab.
      if (notification.method === 'terminal.listChanged') {
        const params = notification.params as { worktreePath?: string };
        const wt = worktreeRef.current;
        if (wt && (!params.worktreePath || params.worktreePath === wt.path)) {
          void refreshTerminalList(wt);
        }
        return;
      }
      // A tab was renamed elsewhere (desktop or another device): relabel locally.
      if (notification.method === 'terminal.tabRenamed') {
        const params = notification.params as { terminalId?: string; label?: string };
        const tid = params.terminalId;
        const label = params.label;
        if (!tid || !label) return;
        const matches = (t: BraidTerminal) => t.terminalId === tid || t.id === tid;
        const relabel = (t: BraidTerminal) => ({ ...t, label, title: label, name: label });
        setTerminals((current) => current.map((t) => (matches(t) ? relabel(t) : t)));
        setActive((current) => (current && matches(current) ? relabel(current) : current));
        return;
      }
      // A tab was closed elsewhere: drop it, and if it was active fall back to
      // the next tab (or the empty state). The PTY is already reaped server-side.
      if (notification.method === 'terminal.tabClosed') {
        const tid = (notification.params as { terminalId?: string }).terminalId;
        if (!tid) return;
        const closed = terminalsRef.current.find((t) => t.terminalId === tid || t.id === tid);
        if (!closed) return;
        const remaining = terminalsRef.current.filter((t) => t.id !== closed.id);
        setTerminals(remaining);
        if (activeIdRef.current === closed.id) {
          if (subscriptionRef.current?.terminalId === closed.id) {
            client.unsubscribe(subscriptionRef.current.subscriptionId).catch(() => undefined);
            subscriptionRef.current = null;
          }
          const next = remaining[0] ?? null;
          if (next) {
            void openTerminal(next);
          } else {
            activeIdRef.current = null;
            setActive(null);
            setInputReadyTerminalId(null);
            setSelectorsExpanded(true);
          }
        }
        return;
      }
      if (notification.method === 'terminal.data') {
        const params = notification.params as { ptyId?: string; data?: string };
        if (params.ptyId === activeIdRef.current && params.data) {
          terminalRef.current?.write(params.data);
        }
        return;
      }
      if (notification.method === 'terminal.resized') {
        const params = notification.params as { ptyId?: string; cols?: number; rows?: number; displayMode?: 'phone' | 'desktop'; selfDriven?: boolean };
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
        if (!params.cols || !params.rows) return;
        if (desktopModeRef.current.has(params.ptyId)) {
          // Desktop mode: the desktop drives its native dims, so match the
          // WebView's xterm; TerminalWebView CSS-scales the wide canvas to fit.
          console.log('[BraidMobile] terminal.resized', { ptyId: params.ptyId, cols: params.cols, rows: params.rows });
          terminalRef.current?.resize(params.cols, params.rows);
          return;
        }
        // Phone mode but another paired phone currently owns the PTY viewport
        // (the server marks resizes it didn't drive for us as selfDriven=false).
        // A single PTY can't satisfy two phone sizes at once, so yield: match
        // xterm to the shared dims and let TerminalWebView CSS-scale, exactly
        // like desktop mode. Re-asserting our own fit here would ping-pong the
        // PTY forever between the two devices.
        if (params.selfDriven === false) {
          terminalRef.current?.resize(params.cols, params.rows);
          return;
        }
        // Phone mode and we own the size: the desktop is meant to yield. If the
        // shared PTY was resized away from our phone viewport (e.g. the desktop's
        // active tab momentarily un-held and fit the PTY to its own pane during
        // the connect race), re-assert the phone fit so xterm and the PTY stay in
        // sync instead of wrapping desktop-width output into our narrow grid.
        // Compared against the dims we last applied so our own resize echo
        // doesn't loop; the desktop holds once it learns we're attached, so this
        // converges in a single round.
        const fit = phoneFitDimsRef.current;
        const diverged = !fit || fit.cols !== params.cols || fit.rows !== params.rows;
        const term = activeTerminalRef.current;
        if (diverged && term && term.id === params.ptyId) {
          console.log('[BraidMobile] terminal.resized.reassert', { ptyId: params.ptyId, cols: params.cols, rows: params.rows });
          void fitActiveTerminal(term);
        }
      }
    });
    return () => {
      off();
      const current = subscriptionRef.current;
      if (current) client.unsubscribe(current.subscriptionId).catch(() => undefined);
    };
  }, [client, fitActiveTerminal, openTerminal, refreshTerminalList]);

  // Catch the active terminal up after a reconnect. A reconnect - especially the
  // foreground kill-and-reset - hands us a brand-new client whose subscription
  // map is empty, so the live stream will NOT replay on its own; we re-open the
  // active terminal from scratch to re-subscribe. Keyed off the connection-state
  // transition into 'connected'.
  useEffect(() => {
    const prev = prevStateRef.current;
    prevStateRef.current = state;
    // Only on a real transition back into 'connected' (a reconnect).
    if (state !== 'connected' || prev === 'connected' || !client) return;
    // If the initial load never landed (the screen was deep-linked from a
    // notification while still disconnected, and the first projects.list raced a
    // connect that failed/timed out), the list is empty and worktreeRef is null -
    // refreshTerminalList would no-op. Re-run the full load now that the socket
    // is finally up; loadProjects -> worktree -> loadTerminals takes over from
    // here, so there's nothing more to do this pass.
    if (projectsRef.current.length === 0) {
      void loadProjects();
      return;
    }
    // listChanged notifications are dropped while the socket is closed (app
    // backgrounded), so re-sync the tab strip on reconnect to pick up terminals
    // the desktop created or restored in the meantime.
    void refreshTerminalList(worktreeRef.current);
    // Nothing more to do if no tab is active yet (handled by loadTerminals).
    if (!active) return;
    // Re-open re-subscribes on the (possibly brand-new) client and re-inits xterm
    // with a fresh snapshot, which also picks up output emitted while backgrounded.
    console.log('[BraidMobile] terminal.resume', { ptyId: active.id });
    void openTerminal(active);
  }, [state, active, client, refreshTerminalList, loadProjects, openTerminal]);

  // While this screen is foreground and the socket has dropped into
  // 'reconnecting', the manager may be parked in a backoff wait (up to
  // RECONNECT_MAX_MS, 10s) before its next attempt - so a deep-link from a push
  // (or a cold radio right
  // after resume) can leave the user staring at "Connecting…" even though the
  // desktop is reachable. Kick one immediate reconnect (what the manual refresh
  // button does via connect()), bypassing the backoff. Guarded by a ref so it
  // fires once per disconnected episode (reset on reconnect), never in a loop;
  // if it fails, the manager's normal backoff takes over.
  const kickedReconnectRef = useRef(false);
  useEffect(() => {
    if (state === 'connected') {
      kickedReconnectRef.current = false;
      return;
    }
    // Only nudge once we're in 'reconnecting' (a prior attempt already failed).
    // 'connecting' is a healthy first attempt in flight - don't interrupt it;
    // 'disconnected' is handled by the manager's reconcile; 'auth-failed' is
    // terminal and needs an explicit user action.
    if (state !== 'reconnecting' || !client || kickedReconnectRef.current) return;
    kickedReconnectRef.current = true;
    reconnect();
  }, [state, client, reconnect]);

  const activeInputReady = active != null && inputReadyTerminalId === active.id;
  const canSend = state === 'connected' && activeInputReady;
  const liveInputEnabled = !!active && liveInputHandles.has(active.id);
  const inputPlaceholder = active
    ? state === 'connected'
      ? canSend
        ? t('terminal.placeholderCommand')
        : t('terminal.placeholderLoading')
      : t('terminal.placeholderConnecting')
    : state === 'connected'
      ? t('terminal.placeholderSelect')
      : t('terminal.placeholderConnecting');

  const writeBytes = async (data: string) => {
    if (!client || !active || !data || !canSend) return;
    await client.request('terminal.write', { ptyId: active.id, data });
  };

  const writeKey = (data: string) => {
    void writeBytes(data);
  };

  // The terminal WebView emits the selected text when the user taps "Copy" in
  // the selection menu; push it to the system clipboard so it can be pasted
  // into other apps. Without this handler the extracted text goes nowhere.
  const handleSelectionCopy = useCallback((text: string) => {
    if (!text) return;
    Clipboard.setStringAsync(text).catch(() => undefined);
  }, []);

  const submit = async () => {
    // Behave like pressing Enter: send the typed text (if any), then the
    // carriage return as a SEPARATE write so the TUI registers it as a discrete
    // Enter keypress rather than folding it into the pasted text (which would
    // insert a literal newline and require a second tap to submit). With empty
    // input this sends a bare Enter, replacing the standalone key.
    // sendingRef guards against a double-tap firing the command twice; the
    // input is restored if the write fails so nothing is silently lost.
    if (!active || !canSend || sendingRef.current) return;
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

  // Live mode: forward raw bytes straight to the PTY (no buffering, no Enter).
  const sendLiveTerminalInput = (bytes: string) => {
    if (!bytes || !client || !active || !canSend) return;
    if (!isTerminalLiveInputWithinByteLimit(bytes)) {
      setError(t('terminal.errorInputTooLarge'));
      return;
    }
    client.request('terminal.write', { ptyId: active.id, data: bytes }).catch(() => undefined);
  };

  const pasteClipboardToTerminal = async () => {
    if (!canSend) return;
    const text = await Clipboard.getStringAsync().catch(() => '');
    if (!text) return;
    if (!isTerminalLiveInputWithinByteLimit(text)) {
      setError(t('terminal.errorInputTooLarge'));
      return;
    }
    await writeBytes(text);
  };

  const focusLiveInput = () => {
    if (!canSend || !liveInputEnabled) return;
    liveInputRef.current?.focus();
  };

  const toggleLiveInput = () => {
    if (!active || !canSend) return;
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
    if (!active || !canSend || !liveInputHandles.has(active.id)) {
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
    if (!active || !canSend || !liveInputHandles.has(active.id)) return;
    const bytes = getTerminalLiveSpecialKeyBytes(event.nativeEvent.key);
    if (!bytes) return;
    sendLiveTerminalInput(bytes);
    liveInputRef.current?.setNativeProps({ text: '' });
  };

  const handleLiveInputSubmit = () => {
    if (!active || !canSend || !liveInputHandles.has(active.id)) return;
    sendLiveTerminalInput('\r');
    liveInputRef.current?.setNativeProps({ text: '' });
  };

  const desktopMode = !!active && desktopModeHandles.has(active.id);
  const modeLabel = liveInputEnabled ? t('terminal.modeLive') : t('terminal.modeCommand');
  const displayModeLabel = desktopMode ? t('terminal.displayDesktop') : t('terminal.displayPhone');

  // Toggle between phone-fit (the desktop yields, PTY sized to this phone) and
  // desktop size (the desktop drives its native dims, we scale to fit).
  const toggleDisplayMode = async () => {
    if (!client || !active || !canSend) return;
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
        if (dims) {
          phoneFitDimsRef.current = dims;
          terminalRef.current?.resize(dims.cols, dims.rows);
        }
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
    setInputReadyTerminalId(null);
    setSelectorsExpanded(true);
    terminalRef.current?.clear();
  };

  const selectWorktree = (next: BraidWorktree) => {
    console.log('[BraidMobile] terminal.selectWorktree', next);
    setWorktree(next);
    setTerminals([]);
    setActive(null);
    setInputReadyTerminalId(null);
    setSelectorsExpanded(false);
    terminalRef.current?.clear();
  };

  const chromeTitle = typeof worktreeName === 'string' && worktreeName ? worktreeName : worktree?.branch ?? selectedProject?.name ?? t('terminal.sessionFallback');
  const chromeMeta = selectedProject && worktree ? `${selectedProject.name} / ${worktree.branch}` : worktree?.path ?? t('terminal.selectWorktree');

  // Themed style objects, scoped to the component so they track the active
  // palette (light/dark) instead of capturing a static color at module load.
  const chromeIconButton = {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  };

  const liveToggleButton = {
    width: 40,
    height: 38,
    marginRight: 8,
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

  const actionRow = {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 12,
    minHeight: 48,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panel,
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

  const terminalTabIconStyle = {
    width: 16,
    height: 16,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  };

  return (
    // Safe-area insets are panel-colored (not the darker app bg) so the panel
    // header and bottom key/input bars extend seamlessly into the notch and
    // home-indicator areas instead of leaving dark bands.
    <SafeAreaView style={[shared.safe, { backgroundColor: colors.panel }]}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={{ backgroundColor: colors.panel, borderBottomWidth: 1, borderBottomColor: colors.border }}>
          <View style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 4 }}>
            <HeaderBackButton onPress={() => router.back()} />
            <View style={{ flex: 1, minWidth: 0, paddingHorizontal: 4 }}>
              <Text style={chromeTitleStyle} numberOfLines={1}>{chromeTitle}</Text>
              <Text style={chromeMetaStyle} numberOfLines={1}>{chromeMeta}</Text>
            </View>
            {!isSessionScoped && worktree && (
              <Pressable style={chromeTextButton} onPress={() => setSelectorsExpanded((value) => !value)}>
                <Text style={chromeTextButtonLabel}>{selectorsExpanded ? t('terminal.hide') : t('terminal.change')}</Text>
              </Pressable>
            )}
            <Pressable
              style={[chromeIconButton, !worktree && { opacity: 0.35 }]}
              disabled={!worktree}
              onPress={() => worktree && router.push({ pathname: '/git/[hostId]', params: { hostId, worktreePath: worktree.path, worktreeName: worktree.branch } })}
              accessibilityLabel={t('terminal.openSourceControl')}
            >
              <GitBranch color={colors.text} size={18} />
            </Pressable>
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
                <Text style={[chromeMetaStyle, { paddingVertical: 10 }]}>{t('terminal.noLiveTerminals')}</Text>
              ) : terminals.map((terminal) => {
                const isActive = active?.id === terminal.id;
                return (
                  <Pressable key={terminal.id} style={[terminalTabStyle, isActive && terminalTabActiveStyle]} onPress={() => openTerminal(terminal)} onLongPress={() => showTerminalActions(terminal)}>
                    <View style={{ maxWidth: '100%', flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <View style={[terminalTabIconStyle, !isActive && { opacity: 0.65 }]}>
                        {terminal.agentId ? (
                          <AgentIcon agentId={terminal.agentId} size={14} />
                        ) : (
                          <TerminalSquare color={isActive ? colors.text : colors.muted} size={14} />
                        )}
                      </View>
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
              accessibilityLabel={t('terminal.chooseTerminalAgent')}
            >
              <Plus color={worktree && !creatingTerminal ? colors.text : colors.subtle} size={17} />
            </Pressable>
          </View>
        </View>

        {error && <Text style={{ color: colors.danger, paddingHorizontal: 12, paddingVertical: 8, fontSize: 12 }}>{error}</Text>}

        <Modal visible={renameTarget != null} transparent animationType="fade" onRequestClose={() => setRenameTarget(null)}>
          {/* Lift the bottom-anchored panel above the keyboard so the input isn't covered. */}
          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <Pressable style={pickerBackdrop} onPress={() => setRenameTarget(null)}>
            {/* Stop propagation so taps inside the panel don't dismiss it. */}
            <Pressable style={pickerPanel} onPress={() => undefined}>
              <View style={pickerHeader}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={pickerTitle}>{t('terminal.renameTitle')}</Text>
                  <Text style={pickerSubtitle} numberOfLines={1}>{renameTarget ? terminalLabel(renameTarget.terminal) : ''}</Text>
                </View>
                <Pressable style={pickerCloseButton} onPress={() => setRenameTarget(null)} accessibilityLabel={t('terminal.cancelRename')}>
                  <X color={colors.text} size={18} />
                </Pressable>
              </View>
              <View style={{ padding: 14, gap: 12 }}>
                <TextInput
                  value={renameTarget?.draft ?? ''}
                  onChangeText={(text) => setRenameTarget((current) => (current ? { ...current, draft: text } : current))}
                  placeholder={t('terminal.terminalNamePlaceholder')}
                  placeholderTextColor={colors.subtle}
                  autoFocus
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="done"
                  onSubmitEditing={() => {
                    if (renameTarget) void renameTerminal(renameTarget.terminal, renameTarget.draft);
                    setRenameTarget(null);
                  }}
                  style={[shared.input, { minHeight: 40, height: 40, paddingVertical: 0, borderRadius: 8, backgroundColor: colors.panelStrong }]}
                />
                <Pressable
                  style={{ minHeight: 42, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent, opacity: renameTarget?.draft.trim() ? 1 : 0.4 }}
                  disabled={!renameTarget?.draft.trim()}
                  onPress={() => {
                    if (renameTarget) void renameTerminal(renameTarget.terminal, renameTarget.draft);
                    setRenameTarget(null);
                  }}
                >
                  <Text style={{ color: colors.bg, fontSize: 14, fontWeight: '700' }}>{t('terminal.rename')}</Text>
                </Pressable>
              </View>
            </Pressable>
          </Pressable>
          </KeyboardAvoidingView>
        </Modal>

        <Modal visible={actionTarget != null} transparent animationType="fade" onRequestClose={() => setActionTarget(null)}>
          <Pressable style={pickerBackdrop} onPress={() => setActionTarget(null)}>
            {/* Stop propagation so taps inside the panel don't dismiss it. */}
            <Pressable style={pickerPanel} onPress={() => undefined}>
              <View style={pickerHeader}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={pickerTitle}>{t('terminal.actionsTitle')}</Text>
                  <Text style={pickerSubtitle} numberOfLines={1}>{actionTarget ? terminalLabel(actionTarget) : ''}</Text>
                </View>
                <Pressable style={pickerCloseButton} onPress={() => setActionTarget(null)} accessibilityLabel={t('common.cancel')}>
                  <X color={colors.text} size={18} />
                </Pressable>
              </View>
              <View style={{ padding: 14, gap: 8 }}>
                <Pressable
                  style={({ pressed }) => [actionRow, pressed && { backgroundColor: colors.panelStrong }]}
                  onPress={() => {
                    const target = actionTarget;
                    setActionTarget(null);
                    if (target) setRenameTarget({ terminal: target, draft: target.label || target.title || target.name || '' });
                  }}
                >
                  <Pencil color={colors.text} size={18} />
                  <Text style={{ color: colors.text, fontSize: 15, fontWeight: '600' }}>{t('terminal.rename')}</Text>
                </Pressable>
                <Pressable
                  style={({ pressed }) => [actionRow, pressed && { backgroundColor: colors.panelStrong }]}
                  onPress={() => {
                    const target = actionTarget;
                    setActionTarget(null);
                    if (target) void closeTerminal(target);
                  }}
                >
                  <Trash2 color={colors.danger} size={18} />
                  <Text style={{ color: colors.danger, fontSize: 15, fontWeight: '600' }}>{t('terminal.closeTerminal')}</Text>
                </Pressable>
              </View>
            </Pressable>
          </Pressable>
        </Modal>

        <Modal visible={agentPickerOpen} transparent animationType="fade" onRequestClose={() => setAgentPickerOpen(false)}>
          <Pressable style={pickerBackdrop} onPress={() => setAgentPickerOpen(false)}>
            <View style={pickerPanel}>
              <View style={pickerHeader}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={pickerTitle}>{t('terminal.newTerminal')}</Text>
                  <Text style={pickerSubtitle} numberOfLines={1}>
                    {selectedAgent?.label ?? t('terminal.defaultLabel')} {selectedAgent?.detectCmd ? `· ${selectedAgent.detectCmd}` : ''}
                  </Text>
                </View>
                <Pressable
                  style={pickerCloseButton}
                  onPress={() => setAgentPickerOpen(false)}
                  accessibilityLabel={t('terminal.closeAgentPicker')}
                >
                  <X color={colors.text} size={18} />
                </Pressable>
              </View>
              <ScrollView style={pickerList} contentContainerStyle={pickerListContent}>
                {bareTerminalSupported && (
                  <View style={{ gap: 8 }}>
                    <Text style={pickerSectionLabel}>{t('terminal.plainShell')}</Text>
                    <Pressable
                      style={({ pressed }) => [pickerRow, pressed && pickerRowPressed]}
                      onPress={() => {
                        setAgentPickerOpen(false);
                        void createTerminal(SHELL_AGENT_ID);
                      }}
                    >
                      <View style={pickerRowIcon}>
                        <TerminalSquare color={colors.text} size={20} />
                      </View>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={pickerRowTitle} numberOfLines={1}>
                          {t('terminal.shellLabel')}
                        </Text>
                        <Text style={pickerRowSubtitle} numberOfLines={1}>
                          {t('terminal.shellSubtitle')}
                        </Text>
                      </View>
                    </Pressable>
                  </View>
                )}
                {detectedSorted.length > 0 && (
                  <View style={{ gap: 8 }}>
                    <Text style={pickerSectionLabel}>{t('terminal.detectedOnHost')}</Text>
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
                  <Text style={pickerSectionLabel}>{detectedSorted.length > 0 ? t('terminal.otherAgents') : t('terminal.allAgents')}</Text>
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

        <Modal visible={terminalMoreOpen} transparent animationType="fade" onRequestClose={() => setTerminalMoreOpen(false)}>
          <Pressable style={pickerBackdrop} onPress={() => setTerminalMoreOpen(false)}>
            <Pressable style={pickerPanel} onPress={() => undefined}>
              <View style={pickerHeader}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={pickerTitle}>{t('terminal.moreKeys')}</Text>
                  <Text style={pickerSubtitle} numberOfLines={1}>{active ? terminalLabel(active) : t('terminal.selectWorktree')}</Text>
                </View>
                <Pressable style={pickerCloseButton} onPress={() => setTerminalMoreOpen(false)} accessibilityLabel={t('common.close')}>
                  <X color={colors.text} size={18} />
                </Pressable>
              </View>
              <View style={{ padding: 12, gap: 10 }}>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  <Key label="Ctrl+D" disabled={!canSend} onPress={() => { setTerminalMoreOpen(false); writeKey('\x04'); }} />
                  <Key label="Ctrl+Z" disabled={!canSend} onPress={() => { setTerminalMoreOpen(false); writeKey('\x1a'); }} />
                  <Key label="Ctrl+R" disabled={!canSend} onPress={() => { setTerminalMoreOpen(false); writeKey('\x12'); }} />
                  <Key label="←" disabled={!canSend} onPress={() => { setTerminalMoreOpen(false); writeKey('\x1b[D'); }} />
                  <Key label="→" disabled={!canSend} onPress={() => { setTerminalMoreOpen(false); writeKey('\x1b[C'); }} />
                </View>
                <Pressable
                  style={({ pressed }) => [actionRow, pressed && { backgroundColor: colors.panelStrong }, !canSend && { opacity: 0.35 }]}
                  disabled={!canSend}
                  onPress={() => {
                    setTerminalMoreOpen(false);
                    void toggleDisplayMode();
                  }}
                >
                  {desktopMode ? <Smartphone color={colors.text} size={18} /> : <Monitor color={colors.text} size={18} />}
                  <Text style={{ color: colors.text, fontSize: 15, fontWeight: '600' }}>
                    {desktopMode ? t('terminal.switchToPhoneSize') : t('terminal.switchToDesktopSize')}
                  </Text>
                </Pressable>
                <Pressable
                  style={({ pressed }) => [actionRow, pressed && { backgroundColor: colors.panelStrong }, !canSend && { opacity: 0.35 }]}
                  disabled={!canSend}
                  onPress={() => {
                    setTerminalMoreOpen(false);
                    void pasteClipboardToTerminal();
                  }}
                >
                  <Text style={{ color: colors.text, fontSize: 15, fontWeight: '600' }}>{t('terminal.paste')}</Text>
                </Pressable>
              </View>
            </Pressable>
          </Pressable>
        </Modal>

        <View
          style={{ flex: 1, minHeight: 0, position: 'relative', overflow: 'hidden' }}
          onLayout={(event) => {
            terminalFrameHeightRef.current = event.nativeEvent.layout.height;
            if (!active) return;
            // Coalesce continuous resizes (iPad Split View / Stage Manager drag,
            // rotation) into a single PTY reflow once the drag settles. The
            // WebView keeps the canvas visually fitted in the meantime.
            if (refitTimerRef.current) clearTimeout(refitTimerRef.current);
            refitTimerRef.current = setTimeout(() => {
              refitTimerRef.current = null;
              const term = activeTerminalRef.current;
              if (term) void fitActiveTerminal(term);
            }, REFIT_DEBOUNCE_MS);
          }}
        >
          <TerminalWebView
            ref={terminalRef}
            terminalTheme={TERMINAL_THEMES[scheme]}
            onWebReady={() => {
              if (active && initializedKeyRef.current !== active.id) void openTerminal(active);
            }}
            onTerminalInput={writeBytes}
            onSelectionCopy={handleSelectionCopy}
          />
          {/* Connection overlay: a notification deep-link can mount this screen
              while the socket is still (re)connecting after a long background.
              Without feedback the empty WebView reads as "stuck". While the
              connection is genuinely in progress we show a spinner; once the
              retry loop has given up (unreachable) or the pairing was rejected we
              swap to an actionable error with a Reconnect button so the user is
              never stranded on an endless spinner. */}
          {state !== 'connected' && (
            <View
              // Only the error state needs taps (the Reconnect button); the
              // spinner stays pass-through so it never blocks the WebView.
              pointerEvents={isErrorVerdict(verdict) ? 'auto' : 'none'}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                alignItems: 'center',
                justifyContent: 'center',
                paddingHorizontal: 32,
                gap: 14,
                backgroundColor: colors.bg,
              }}
            >
              {isErrorVerdict(verdict) ? (
                <>
                  <View
                    style={{
                      width: 56,
                      height: 56,
                      borderRadius: 28,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: colors.panelStrong,
                    }}
                  >
                    <WifiOff color={colors.danger} size={26} />
                  </View>
                  <View style={{ gap: 6, alignItems: 'center' }}>
                    <Text style={{ color: colors.text, fontSize: 16, fontWeight: '700', textAlign: 'center' }}>
                      {verdict.kind === 'auth-failed' ? t('terminal.pairingRejected') : t('terminal.cantReachDesktop')}
                    </Text>
                    <Text style={{ color: colors.muted, fontSize: 13, lineHeight: 18, textAlign: 'center' }}>
                      {verdict.kind === 'auth-failed' ? t('terminal.pairingHint') : t('terminal.connectHint')}
                    </Text>
                  </View>
                  <Pressable
                    onPress={reconnect}
                    style={({ pressed }) => ({
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 8,
                      minHeight: 44,
                      paddingHorizontal: 20,
                      borderRadius: 10,
                      backgroundColor: colors.accent,
                      opacity: pressed ? 0.85 : 1,
                    })}
                  >
                    <RefreshCw color={colors.bg} size={16} />
                    <Text style={{ color: colors.bg, fontSize: 14, fontWeight: '700' }}>{t('terminal.reconnect')}</Text>
                  </Pressable>
                </>
              ) : (
                <>
                  <ActivityIndicator color={colors.accent} />
                  <Text style={{ color: colors.muted, fontSize: 13 }}>{t('terminal.connectingOverlay')}</Text>
                </>
              )}
            </View>
          )}
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 52, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.panel }}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={{ flex: 1, minHeight: 52, maxHeight: 52 }}
            contentContainerStyle={{ minHeight: 52, alignItems: 'center', gap: 5, paddingLeft: 8, paddingRight: 6 }}
          >
            <Key label="Esc" disabled={!canSend} onPress={() => writeKey('\x1b')} />
            <Key label="Tab" disabled={!canSend} onPress={() => writeKey('\t')} />
            <Key label="Ctrl+C" emphasized disabled={!canSend} onPress={() => writeKey('\x03')} />
            <Key label="↑" disabled={!canSend} onPress={() => writeKey('\x1b[A')} />
            <Key label="↓" disabled={!canSend} onPress={() => writeKey('\x1b[B')} />
          </ScrollView>
          <Pressable
            hitSlop={{ top: 4, bottom: 4, left: 2, right: 2 }}
            style={[liveToggleButton, desktopMode && liveToggleButtonActive, !canSend && { opacity: 0.35 }]}
            disabled={!canSend}
            onPress={() => void toggleDisplayMode()}
            accessibilityLabel={desktopMode ? t('terminal.switchToPhoneSize') : t('terminal.switchToDesktopSize')}
          >
            {desktopMode ? (
              <Smartphone color={colors.bg} size={16} />
            ) : (
              <Monitor color={canSend ? colors.muted : colors.subtle} size={16} />
            )}
          </Pressable>
          <Pressable
            hitSlop={{ top: 4, bottom: 4, left: 2, right: 2 }}
            disabled={!canSend}
            style={{ width: 40, height: 38, marginRight: 6, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.panelStrong, opacity: canSend ? 1 : 0.35 }}
            onPress={() => setTerminalMoreOpen(true)}
            accessibilityLabel={t('terminal.moreKeys')}
          >
            <MoreHorizontal color={colors.muted} size={18} />
          </Pressable>
          <Pressable
            hitSlop={{ top: 4, bottom: 4, left: 2, right: 8 }}
            style={[liveToggleButton, liveInputEnabled && liveToggleButtonActive, !canSend && { opacity: 0.35 }]}
            disabled={!canSend}
            onPress={toggleLiveInput}
            accessibilityLabel={liveInputEnabled ? t('terminal.switchToBufferedInput') : t('terminal.switchToLiveInput')}
          >
            <ChevronsRight color={liveInputEnabled ? colors.bg : canSend ? colors.muted : colors.subtle} size={16} />
          </Pressable>
        </View>

        {liveInputEnabled ? (
          <Pressable
            style={{ flexDirection: 'row', alignItems: 'center', minHeight: 48, gap: 8, paddingHorizontal: 12, paddingVertical: 6, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.panel }}
            onPress={focusLiveInput}
            disabled={!canSend}
            accessibilityLabel={t('terminal.focusLiveInput')}
          >
            <View style={{ minHeight: 36, borderRadius: 8, flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 10, backgroundColor: colors.panelStrong }}>
              <KeyboardIcon color={colors.accent} size={15} />
              <Text style={{ color: colors.text, fontSize: 12, fontWeight: '800' }}>
                {modeLabel}
              </Text>
            </View>
            <Text style={{ flex: 1, color: colors.muted, fontSize: 12, fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }) }} numberOfLines={1}>
              {displayModeLabel}
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
              editable={canSend}
              importantForAutofill="no"
              textContentType="none"
            />
          </Pressable>
        ) : (
          <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 48, gap: 8, paddingHorizontal: 12, paddingVertical: 6, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.panel }}>
            <TextInput value={input} onChangeText={setInput} placeholder={inputPlaceholder} placeholderTextColor={colors.subtle} autoCapitalize="none" autoCorrect={false} style={[shared.input, { flex: 1, minHeight: 38, height: 38, paddingVertical: 0, borderRadius: 8, backgroundColor: colors.panelStrong, fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }) }]} onSubmitEditing={submit} editable={canSend} />
            <Pressable hitSlop={{ top: 4, bottom: 4, left: 2, right: 2 }} style={{ width: 42, height: 38, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.panelStrong, opacity: canSend ? 1 : 0.35 }} onPress={submit} disabled={!canSend}><Send color={colors.text} size={17} /></Pressable>
          </View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Key({ label, onPress, disabled = false, emphasized = false }: { label: string; onPress: () => void; disabled?: boolean; emphasized?: boolean }) {
  const colors = useTheme().palette;
  return (
    <Pressable
      hitSlop={{ top: 4, bottom: 4, left: 2, right: 2 }}
      disabled={disabled}
      style={({ pressed }) => ({
        minWidth: emphasized ? 68 : 40,
        height: 38,
        borderRadius: 8,
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'row',
        gap: 4,
        paddingHorizontal: 8,
        backgroundColor: emphasized ? colors.danger : pressed ? colors.panelStrong : colors.bg,
        borderWidth: emphasized ? 0 : 1,
        borderColor: colors.border,
        opacity: disabled ? 0.35 : 1,
      })}
      onPress={onPress}
    >
      {label === 'Ctrl+C' ? <Command color={emphasized ? colors.bg : colors.subtle} size={12} /> : null}
      <Text style={{ color: emphasized ? colors.bg : colors.subtle, fontSize: 12, fontWeight: '800', fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }) }}>{label}</Text>
    </Pressable>
  );
}
