import { CameraView, useCameraPermissions } from 'expo-camera';
import { router, useLocalSearchParams } from 'expo-router';
import { ChevronRight, LifeBuoy, Monitor, Plus, QrCode, RefreshCw, Settings, TerminalSquare, Trash2, Wifi, X } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  Alert,
  Image,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Animated, { FadeInDown, LinearTransition, useReducedMotion } from 'react-native-reanimated';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { getNotificationNavigationPath } from '@/notifications/notification-routing';
import { useClientManager } from '@/transport/client-manager';
import { classifyConnection, isErrorVerdict, type ConnectionVerdict } from '@/transport/connection-health';
import { loadHosts, removeHost, saveHosts, upsertHost } from '@/transport/host-store';
import { type BonjourHost, matchesDiscoveredHost, mergeDiscoveredEndpoint, startBonjourBrowser } from '@/transport/bonjour';
import { createHostFromOffer, parsePairingPayload } from '@/transport/rpc-client';
import type { BraidStatus, BraidTerminal, PairedHost, RateLimitState } from '@/transport/types';
import { RateLimitSection } from '@/usage/RateLimitSection';
import { useTheme, useThemedStyles, type Palette } from '@/ui/theme';

type ConnectionState = 'idle' | 'connecting' | 'online' | 'offline';

interface HostSnapshot {
  host: PairedHost;
  state: ConnectionState;
  error?: string;
  status?: BraidStatus;
  /** Live big-terminal list with per-terminal agent status (working/waiting/done). */
  terminals: BraidTerminal[];
  agentTimeMs: number;
  rateLimits?: RateLimitState | null;
}

/** An agent that needs the user: waiting for input, or just finished. */
interface AttentionItem {
  hostId: string;
  terminal: BraidTerminal;
}

export default function HomeScreen() {
  const { palette: COLORS } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const reduceMotion = useReducedMotion();
  const [hosts, setHosts] = useState<PairedHost[]>([]);
  const [snapshots, setSnapshots] = useState<Record<string, HostSnapshot>>({});
  const [scannerOpen, setScannerOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualPayload, setManualPayload] = useState('');
  const [discoveredHosts, setDiscoveredHosts] = useState<BonjourHost[]>([]);
  const [bonjourError, setBonjourError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // Terminals the user has already opened from "Needs attention", keyed by
  // terminal with the exact signature (status + run time) they acknowledged.
  // The card reappears only when a genuinely newer event changes the signature.
  const [acknowledged, setAcknowledged] = useState<Record<string, string>>({});
  const [permission, requestPermission] = useCameraPermissions();
  const scannedRef = useRef(false);
  const manager = useClientManager();
  const { pair: pairParam } = useLocalSearchParams<{ pair?: string }>();
  const pairHandledRef = useRef(false);
  const [, bump] = useReducer((n: number) => n + 1, 0);
  // Re-render on manager connection-state changes so each desktop's verdict
  // (reconnecting / unreachable / pairing-rejected) stays live without a manual
  // pull-to-refresh.
  useEffect(() => manager.subscribe(bump), [manager]);

  const refreshHost = useCallback(async (host: PairedHost) => {
    setSnapshots((current) => ({
      ...current,
      [host.id]: {
        host,
        state: 'connecting',
        terminals: current[host.id]?.terminals ?? [],
        agentTimeMs: current[host.id]?.agentTimeMs ?? 0,
        rateLimits: current[host.id]?.rateLimits ?? null,
      },
    }));

    // Shared, app-level client - the manager owns its lifecycle and keeps the
    // notification subscription alive, so never connect or close it here.
    const client = manager.acquireHost(host);
    try {
      const status = await client.request<BraidStatus>('status.get');
      // Agent time reflects terminal-driven agents (the only supported path).
      const terminals = await client.request<BraidTerminal[]>('terminal.list');
      const agentTimeMs = terminals.reduce((sum, terminal) => sum + (terminal.totalRunDurationMs ?? 0), 0);
      // Best-effort: older desktops won't expose rateLimits.get, so a failure
      // here must not knock the host offline - fall back to the last value.
      const rateLimits = await client.request<RateLimitState>('rateLimits.get').catch(() => undefined);
      const saved = await upsertHost(host);
      setHosts(saved);
      setSnapshots((current) => ({
        ...current,
        [host.id]: {
          host,
          state: 'online',
          status,
          terminals,
          agentTimeMs,
          rateLimits: rateLimits ?? current[host.id]?.rateLimits ?? null,
        },
      }));
    } catch (error) {
      setSnapshots((current) => ({
        ...current,
        [host.id]: {
          host,
          state: 'offline',
          error: error instanceof Error ? error.message : String(error),
          terminals: current[host.id]?.terminals ?? [],
          agentTimeMs: current[host.id]?.agentTimeMs ?? 0,
          rateLimits: current[host.id]?.rateLimits ?? null,
        },
      }));
    }
  }, [manager]);

  const refreshAll = useCallback((items: PairedHost[]) => {
    for (const host of items) void refreshHost(host);
  }, [refreshHost]);

  // Pull-to-refresh: awaits every host so the spinner stays until the slowest
  // one settles (refreshHost swallows its own errors, so this never rejects).
  const onPullRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all(hosts.map((host) => refreshHost(host)));
    } finally {
      setRefreshing(false);
    }
  }, [hosts, refreshHost]);

  useEffect(() => {
    let active = true;
    loadHosts().then((items) => {
      if (!active) return;
      setHosts(items);
      refreshAll(items);
    });
    return () => {
      active = false;
    };
  }, [refreshAll]);

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    let disposed = false;
    startBonjourBrowser((found) => {
      if (disposed) return;
      setBonjourError(null);
      setDiscoveredHosts((current) => {
        const rest = current.filter((item) => item.id !== found.id);
        return [found, ...rest].slice(0, 8);
      });
      setHosts((current) => {
        let changed = false;
        const next = current.map((host) => {
          const updated = mergeDiscoveredEndpoint(host, found);
          if (updated !== host) {
            changed = true;
            void refreshHost(updated);
          }
          return updated;
        });
        if (changed) void saveHosts(next);
        return changed ? next : current;
      });
    }, (message) => {
      if (!disposed) setBonjourError(message);
    }).then((fn) => {
      if (disposed) fn();
      else cleanup = fn;
    });
    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [refreshHost]);

  // Live-refresh a host's terminal states (and thus "Needs attention") the
  // moment a desktop notification event arrives, instead of waiting for a manual
  // pull-to-refresh.
  useEffect(() => {
    return manager.subscribeActivity((hostId) => {
      const host = hosts.find((item) => item.id === hostId);
      if (host) void refreshHost(host);
    });
  }, [manager, hosts, refreshHost]);

  const pairFromPayload = useCallback(async (payload: string) => {
    const offer = parsePairingPayload(payload);
    if (!offer.endpoint || !offer.token) throw new Error('Pairing QR is missing endpoint or token');
    const host = createHostFromOffer(offer);
    setScannerOpen(false);
    setManualOpen(false);
    setManualPayload('');
    const saved = await upsertHost(host);
    setHosts(saved);
    await refreshHost(host);
  }, [refreshHost]);

  const openScanner = async () => {
    scannedRef.current = false;
    if (!permission?.granted) {
      const result = await requestPermission();
      if (!result.granted) {
        setManualOpen(true);
        return;
      }
    }
    setScannerOpen(true);
  };

  // Re-pair deep link: the host screen's "Re-pair" button routes here with
  // ?pair=1 so the scanner opens straight away. Guarded so it fires once.
  useEffect(() => {
    if (pairParam === '1' && !pairHandledRef.current) {
      pairHandledRef.current = true;
      void openScanner();
    }
    // openScanner is intentionally omitted: this is a one-shot deep-link handler
    // guarded by pairHandledRef, not something that should re-fire when the
    // (unmemoized) opener identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pairParam]);

  const removeDesktop = useCallback((host: PairedHost) => {
    Alert.alert('Remove desktop', `Unpair "${host.instanceName ?? host.endpoint}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          const next = await removeHost(host.id);
          setHosts(next);
          setSnapshots((current) => {
            const copy = { ...current };
            delete copy[host.id];
            return copy;
          });
        },
      },
    ]);
  }, []);

  const sortedSnapshots = useMemo(
    () => hosts.map((host) => snapshots[host.id] ?? { host, state: 'idle' as const, terminals: [], agentTimeMs: 0 }),
    [hosts, snapshots],
  );

  // Agents that need the user, across every host: waiting for input first, then
  // freshly finished. This is the home screen's primary triage queue.
  const attention = useMemo<AttentionItem[]>(() => {
    const items = sortedSnapshots.flatMap((snapshot) =>
      snapshot.terminals
        .filter((terminal) => terminal.status === 'waiting' || terminal.status === 'done')
        // Drop terminals the user already opened, unless a newer event (new
        // status or more run time) has fired since they acknowledged it.
        .filter((terminal) => acknowledged[attentionKey(snapshot.host.id, terminal)] !== attentionSignature(terminal))
        .map((terminal) => ({ hostId: snapshot.host.id, terminal })),
    );
    return items.sort((a, b) => attentionRank(a.terminal.status) - attentionRank(b.terminal.status));
  }, [sortedSnapshots, acknowledged]);

  // Live, actionable counts that replace the old vanity totals.
  const counts = useMemo(() => {
    let needInput = 0;
    let working = 0;
    let total = 0;
    for (const snapshot of sortedSnapshots) {
      for (const terminal of snapshot.terminals) {
        total += 1;
        if (terminal.status === 'waiting') needInput += 1;
        else if (terminal.status === 'working') working += 1;
      }
    }
    return { needInput, working, total };
  }, [sortedSnapshots]);

  const homeStatus = useMemo(() => {
    if (counts.needInput > 0) {
      return {
        tone: 'attention' as const,
        title: counts.needInput === 1 ? '1 agent needs input' : `${counts.needInput} agents need input`,
        subtitle: 'Open the newest request and keep the work moving.',
      };
    }
    if (counts.working > 0) {
      return {
        tone: 'working' as const,
        title: plural(counts.working, 'agent') + ' working',
        subtitle: 'Everything active is running in the background.',
      };
    }
    if (sortedSnapshots.some((snapshot) => snapshot.state === 'connecting')) {
      return {
        tone: 'connecting' as const,
        title: 'Connecting to desktop',
        subtitle: 'Checking paired desktops and agent state.',
      };
    }
    if (sortedSnapshots.length === 0) {
      return {
        tone: 'empty' as const,
        title: 'Pair your first desktop',
        subtitle: 'Scan the pairing code from desktop Settings > Mobile.',
      };
    }
    return {
      tone: 'quiet' as const,
      title: 'All agents quiet',
      subtitle: 'No agents need input right now.',
    };
  }, [counts.needInput, counts.working, sortedSnapshots]);

  const knownHostIds = useMemo(() => new Set(hosts.map((host) => host.id)), [hosts]);

  // Deep-link to the exact terminal, reusing the same path builder the
  // notification tap uses so both entry points behave identically.
  const openAttention = useCallback((hostId: string, terminal: BraidTerminal) => {
    // Acknowledge this exact state so the card clears immediately on tap and
    // doesn't linger (a 'done' terminal otherwise stays 'done' forever).
    setAcknowledged((current) => ({
      ...current,
      [attentionKey(hostId, terminal)]: attentionSignature(terminal),
    }));
    const branch = terminal.cwd ? terminal.cwd.split('/').pop() : undefined;
    const path = getNotificationNavigationPath(
      {
        hostId,
        worktreePath: terminal.cwd,
        terminalId: terminal.terminalId ?? terminal.id,
        worktreeName: branch,
      },
      { knownHostIds },
    );
    if (path) router.navigate(path as Parameters<typeof router.navigate>[0]);
  }, [knownHostIds]);

  // Acknowledge every currently-shown attention item at once. Each is stamped
  // with its exact signature, so the section clears now but any item re-surfaces
  // the moment a genuinely newer event changes its signature.
  const clearAllAttention = useCallback(() => {
    setAcknowledged((current) => {
      const next = { ...current };
      for (const { hostId, terminal } of attention) {
        next[attentionKey(hostId, terminal)] = attentionSignature(terminal);
      }
      return next;
    });
  }, [attention]);

  const unpairedNearby = useMemo(
    () => discoveredHosts.filter((found) => !hosts.some((host) => matchesDiscoveredHost(host, found))),
    [discoveredHosts, hosts],
  );

  // Desktops reporting at least one Claude/Codex window, so the Usage section
  // only renders when there's something to show.
  const usageHosts = useMemo(
    () => sortedSnapshots.filter((item) => item.rateLimits && (item.rateLimits.claude || item.rateLimits.codex)),
    [sortedSnapshots],
  );

  // Surface the troubleshooter entry only when at least one desktop is in a
  // problem state, so the link stays out of the happy path. Recomputed each
  // render (the manager.subscribe bump above drives re-renders on state change).
  const hasConnectionTrouble = sortedSnapshots.some((snapshot) =>
    isErrorVerdict(
      classifyConnection({
        state: manager.getState(snapshot.host.id),
        reconnectAttempts: manager.getReconnectAttempt(snapshot.host.id),
        lastConnectedAt: manager.getLastConnectedAt(snapshot.host.id),
      }),
    ),
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <ScrollView
        style={styles.shell}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onPullRefresh}
            tintColor={COLORS.muted}
            colors={[COLORS.accent]}
            progressBackgroundColor={COLORS.panel}
          />
        }
      >
        <View style={styles.header}>
          <View style={styles.brand}>
            <Image source={require('@/assets/images/icon.png')} style={styles.brandMark} />
            <Text style={styles.brandName}>Braid</Text>
          </View>
          <View style={styles.headerActions}>
            <Pressable style={styles.iconButton} onPress={() => router.push('/settings' as Parameters<typeof router.push>[0])} accessibilityLabel="Settings">
              <Settings color={COLORS.muted} size={18} />
            </Pressable>
            <Pressable style={styles.iconButton} onPress={() => refreshAll(hosts)} accessibilityLabel="Refresh">
              <RefreshCw color={COLORS.muted} size={18} />
            </Pressable>
          </View>
        </View>

        <Animated.View
          entering={reduceMotion ? undefined : FadeInDown.duration(220).springify().damping(18).stiffness(180)}
          layout={reduceMotion ? undefined : LinearTransition.duration(180)}
          style={[styles.statusHero, homeStatus.tone === 'attention' && styles.statusHeroAttention]}
        >
          <Text style={styles.statusEyebrow}>Today</Text>
          <Text style={styles.statusTitle}>{homeStatus.title}</Text>
          <Text style={styles.statusSubtitle}>{homeStatus.subtitle}</Text>
        </Animated.View>

        <View style={[styles.quickRow, sortedSnapshots.length > 0 && styles.quickRowCompact]}>
          <Pressable style={({ pressed }) => [styles.quickTile, sortedSnapshots.length > 0 && styles.quickTileCompact, pressed && styles.pressed]} onPress={openScanner}>
            <QrCode color={COLORS.muted} size={20} />
            <Text style={styles.quickText}>Pair Desktop</Text>
          </Pressable>
          <Pressable style={({ pressed }) => [styles.quickTile, sortedSnapshots.length > 0 && styles.quickTileCompact, pressed && styles.pressed]} onPress={() => setManualOpen(true)}>
            <Plus color={COLORS.muted} size={20} />
            <Text style={styles.quickText}>Enter Code</Text>
          </Pressable>
        </View>

        {attention.length > 0 && (
          <Animated.View
            entering={reduceMotion ? undefined : FadeInDown.delay(60).duration(220)}
            layout={reduceMotion ? undefined : LinearTransition.duration(180)}
          >
            <View style={styles.sectionHeaderRow}>
              <Text style={[styles.sectionLabel, styles.sectionLabelFlush]}>Needs attention</Text>
              <Pressable onPress={clearAllAttention} hitSlop={8} accessibilityLabel="Clear all">
                <Text style={styles.clearAll}>Clear all</Text>
              </Pressable>
            </View>
            {attention.map(({ hostId, terminal }) => (
              <RowCard
                key={`${hostId}:${terminal.terminalId ?? terminal.id}`}
                icon={<TerminalSquare color={COLORS.muted} size={22} />}
                title={terminalLabel(terminal)}
                dotColor={terminal.status === 'waiting' ? COLORS.warning : COLORS.success}
                subtitle={attentionSubtitle(terminal)}
                onPress={() => openAttention(hostId, terminal)}
                highlight={terminal.status === 'waiting'}
              />
            ))}
          </Animated.View>
        )}

        <Animated.View
          entering={reduceMotion ? undefined : FadeInDown.delay(attention.length > 0 ? 120 : 60).duration(220)}
          layout={reduceMotion ? undefined : LinearTransition.duration(180)}
          style={styles.statusStrip}
        >
          <StatusPill value={String(counts.needInput)} label="Need input" emphasis={counts.needInput > 0 ? 'alert' : undefined} />
          <StatusPill value={String(counts.working)} label="Working" />
          <StatusPill value={String(counts.total)} label="Agents" />
        </Animated.View>

        <Text style={styles.sectionLabel}>Desktops</Text>
        {sortedSnapshots.length === 0 ? (
          <Pressable style={({ pressed }) => [styles.emptyCard, pressed && styles.pressed]} onPress={openScanner}>
            <View style={styles.iconTile}>
              <QrCode color={COLORS.muted} size={22} />
            </View>
            <View style={styles.rowBody}>
              <Text style={styles.rowTitle}>Pair a Braid desktop</Text>
              <Text style={styles.rowSubtitle} numberOfLines={2}>
                Open Settings &gt; Mobile on desktop, start the server, then scan the QR code.
              </Text>
            </View>
          </Pressable>
        ) : (
          sortedSnapshots.map((snapshot) => {
            // The manager verdict (reconnect streak / revoked pairing) escalates
            // beyond what the snapshot's online/offline can express, so it wins
            // for the dot + label whenever it signals a problem.
            const verdict = classifyConnection({
              state: manager.getState(snapshot.host.id),
              reconnectAttempts: manager.getReconnectAttempt(snapshot.host.id),
              lastConnectedAt: manager.getLastConnectedAt(snapshot.host.id),
            });
            const verdictError = isErrorVerdict(verdict);
            return (
              <RowCard
                key={snapshot.host.id}
                icon={<Monitor color={COLORS.muted} size={22} />}
                title={snapshot.status?.instanceName ?? snapshot.host.instanceName ?? 'Braid desktop'}
                dotColor={verdictError ? verdictColor(verdict, COLORS) : stateDotColor(snapshot.state, COLORS)}
                subtitle={verdictError ? verdict.label : desktopSubtitle(snapshot)}
                onPress={() => router.push(`/host/${encodeURIComponent(snapshot.host.id)}`)}
                onLongPress={() => removeDesktop(snapshot.host)}
                trailingAction={
                  <Pressable
                    style={({ pressed }) => [styles.removeButton, pressed && styles.pressed]}
                    onPress={() => removeDesktop(snapshot.host)}
                    hitSlop={8}
                    accessibilityLabel={`Remove ${snapshot.status?.instanceName ?? snapshot.host.instanceName ?? 'Braid desktop'}`}
                  >
                    <Trash2 color={COLORS.subtle} size={18} />
                  </Pressable>
                }
              />
            );
          })
        )}

        {hasConnectionTrouble && (
          <Pressable style={styles.troubleshootLink} onPress={() => router.push('/troubleshoot' as Parameters<typeof router.push>[0])}>
            <LifeBuoy color={COLORS.muted} size={16} />
            <Text style={styles.troubleshootText}>Connection trouble? Troubleshoot</Text>
          </Pressable>
        )}

        {usageHosts.length > 0 && (
          <>
            <Text style={styles.sectionLabel}>Usage</Text>
            {usageHosts.map((snapshot) => (
              <View key={snapshot.host.id} style={styles.usageBlock}>
                {usageHosts.length > 1 && (
                  <Text style={styles.usageHostLabel} numberOfLines={1}>
                    {snapshot.status?.instanceName ?? snapshot.host.instanceName ?? 'Braid desktop'}
                  </Text>
                )}
                <RateLimitSection state={snapshot.rateLimits!} now={Date.now()} />
              </View>
            ))}
          </>
        )}

        {unpairedNearby.length > 0 && (
          <>
            <Text style={styles.sectionLabel}>Nearby</Text>
            {unpairedNearby.map((found) => (
              <RowCard
                key={found.id}
                icon={<Wifi color={COLORS.muted} size={22} />}
                title={found.name}
                subtitle="Tap to scan pairing code"
                onPress={openScanner}
              />
            ))}
          </>
        )}

        {bonjourError && discoveredHosts.length === 0 && (
          <Text style={styles.footnote}>Local discovery unavailable in this build.</Text>
        )}
      </ScrollView>

      <Modal visible={scannerOpen} animationType="slide" onRequestClose={() => setScannerOpen(false)}>
        <SafeAreaProvider>
          <View style={styles.scanner}>
            <CameraView
              style={StyleSheet.absoluteFill}
              facing="back"
              barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
              onBarcodeScanned={({ data }) => {
                if (scannedRef.current) return;
                scannedRef.current = true;
                pairFromPayload(data).catch((error) => {
                  scannedRef.current = false;
                  Alert.alert('Pairing failed', error instanceof Error ? error.message : String(error));
                });
              }}
            />
            <SafeAreaView style={styles.scannerOverlay}>
              <View style={styles.scannerHeader}>
                <Text style={styles.scannerTitle}>Scan Braid pairing code</Text>
                <Pressable style={styles.iconButton} onPress={() => setScannerOpen(false)} accessibilityLabel="Close scanner">
                  <X color={COLORS.text} size={20} />
                </Pressable>
              </View>
              <View style={styles.scanFrame} />
              <Text style={styles.scannerHint}>Point the camera at the QR code in desktop Settings &gt; Mobile.</Text>
            </SafeAreaView>
          </View>
        </SafeAreaProvider>
      </Modal>

      <Modal visible={manualOpen} transparent animationType="fade" onRequestClose={() => setManualOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.manualPanel}>
            <View style={styles.manualHeader}>
              <Text style={styles.modalTitle}>Enter pairing payload</Text>
              <Pressable onPress={() => setManualOpen(false)} accessibilityLabel="Close manual pairing">
                <X color={COLORS.text} size={20} />
              </Pressable>
            </View>
            <TextInput
              value={manualPayload}
              onChangeText={setManualPayload}
              placeholder="Paste QR payload"
              placeholderTextColor={COLORS.subtle}
              multiline
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.input}
            />
            <Pressable
              style={styles.primaryButton}
              onPress={() => pairFromPayload(manualPayload).catch((error) => {
                Alert.alert('Pairing failed', error instanceof Error ? error.message : String(error));
              })}
            >
              <Wifi color={COLORS.text} size={18} />
              <Text style={styles.primaryButtonText}>Connect</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function StatusPill({ value, label, emphasis }: { value: string; label: string; emphasis?: 'alert' }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.statusPill}>
      <Text style={[styles.statusPillValue, emphasis === 'alert' && styles.statusPillValueAlert]}>{value}</Text>
      <Text style={styles.statusPillLabel}>{label}</Text>
    </View>
  );
}

function RowCard({
  icon,
  title,
  subtitle,
  dotColor,
  onPress,
  onLongPress,
  trailingAction,
  highlight,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  dotColor?: string;
  onPress: () => void;
  onLongPress?: () => void;
  trailingAction?: React.ReactNode;
  highlight?: boolean;
}) {
  const { palette: COLORS } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <Pressable style={({ pressed }) => [styles.rowCard, highlight && styles.rowCardHighlight, pressed && styles.pressed]} onPress={onPress} onLongPress={onLongPress}>
      <View style={styles.iconTile}>{icon}</View>
      <View style={styles.rowBody}>
        <Text style={styles.rowTitle} numberOfLines={1}>{title}</Text>
        <View style={styles.rowSubtitleWrap}>
          {dotColor && <View style={[styles.statusDot, { backgroundColor: dotColor }]} />}
          <Text style={styles.rowSubtitle} numberOfLines={1}>{subtitle}</Text>
        </View>
      </View>
      {trailingAction}
      <ChevronRight color={COLORS.subtle} size={20} />
    </Pressable>
  );
}

function terminalLabel(terminal: BraidTerminal): string {
  return (
    terminal.label ||
    terminal.title ||
    terminal.name ||
    terminal.agentId ||
    terminal.cwd?.split('/').pop() ||
    terminal.terminalId ||
    terminal.id ||
    'Agent'
  );
}

/** Stable identity for a terminal within a host, for acknowledgement tracking. */
function attentionKey(hostId: string, terminal: BraidTerminal): string {
  return `${hostId}:${terminal.terminalId ?? terminal.id}`;
}

/**
 * A fingerprint of the terminal's attention-worthy state. Combines status with
 * accumulated run time so that a finished agent that later runs again produces a
 * new signature and re-surfaces in "Needs attention".
 */
function attentionSignature(terminal: BraidTerminal): string {
  return `${terminal.status ?? ''}:${terminal.totalRunDurationMs ?? 0}`;
}

/** Sort key: waiting (needs input) ranks above done (finished). */
function attentionRank(status?: string): number {
  return status === 'waiting' ? 0 : 1;
}

function attentionSubtitle(terminal: BraidTerminal): string {
  const branch = terminal.cwd ? terminal.cwd.split('/').pop() : undefined;
  const state = terminal.status === 'waiting' ? 'Needs input' : 'Finished';
  return [branch, state].filter(Boolean).join(' · ');
}

function stateDotColor(state: ConnectionState, c: Palette): string {
  if (state === 'online') return c.success;
  if (state === 'connecting') return c.warning;
  if (state === 'offline') return c.danger;
  return c.subtle;
}

/** Dot color for an escalated connection verdict (warning -> amber, the rest -> red). */
function verdictColor(verdict: ConnectionVerdict, c: Palette): string {
  return verdict.kind === 'warning' ? c.warning : c.danger;
}

function desktopSubtitle(snapshot: HostSnapshot): string {
  if (snapshot.state === 'connecting') return 'Connecting...';
  if (snapshot.state === 'offline') return snapshot.error ?? 'Offline';
  if (snapshot.state === 'idle') return 'Tap to connect';
  const projects = snapshot.status?.projects.length ?? 0;
  return ['Connected', plural(projects, 'project'), plural(snapshot.terminals.length, 'agent')].join(' · ');
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

function makeStyles(COLORS: Palette) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: COLORS.bg },
    shell: { flex: 1 },
    content: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 48 },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    headerActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    brand: { flexDirection: 'row', alignItems: 'center', gap: 9 },
    brandMark: { width: 24, height: 24, borderRadius: 7, overflow: 'hidden' },
    brandName: { color: COLORS.text, fontSize: 19, fontWeight: '800', letterSpacing: 0.2 },
    iconButton: {
      width: 38,
      height: 38,
      borderRadius: 10,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: COLORS.panelStrong,
      borderWidth: 1,
      borderColor: COLORS.border,
    },
    pressed: { opacity: 0.72, transform: [{ scale: 0.985 }] },
    statusHero: {
      marginTop: 24,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: COLORS.border,
      backgroundColor: COLORS.panel,
      paddingVertical: 18,
      paddingHorizontal: 18,
    },
    statusHeroAttention: {
      borderColor: COLORS.warning,
      backgroundColor: COLORS.panelStrong,
    },
    statusEyebrow: {
      color: COLORS.subtle,
      fontSize: 11,
      fontWeight: '800',
      textTransform: 'uppercase',
      letterSpacing: 0.7,
      marginBottom: 8,
    },
    statusTitle: { color: COLORS.text, fontSize: 29, lineHeight: 34, fontWeight: '800' },
    statusSubtitle: { color: COLORS.muted, fontSize: 14, lineHeight: 20, marginTop: 8 },
    statusStrip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginTop: 18,
      paddingVertical: 8,
      paddingHorizontal: 8,
      borderRadius: 14,
      backgroundColor: COLORS.panel,
      borderWidth: 1,
      borderColor: COLORS.border,
    },
    statusPill: {
      flex: 1,
      minHeight: 38,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      borderRadius: 10,
      backgroundColor: COLORS.panelStrong,
      paddingHorizontal: 8,
    },
    statusPillValue: { color: COLORS.text, fontSize: 15, fontWeight: '800' },
    statusPillValueAlert: { color: COLORS.warning },
    statusPillLabel: { color: COLORS.muted, fontSize: 11, fontWeight: '700' },
    sectionLabel: {
      color: COLORS.subtle,
      fontSize: 12,
      fontWeight: '700',
      textTransform: 'uppercase',
      letterSpacing: 0.6,
      marginTop: 28,
      marginBottom: 11,
    },
    sectionHeaderRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: 28,
      marginBottom: 11,
    },
    sectionLabelFlush: { marginTop: 0, marginBottom: 0 },
    clearAll: { color: COLORS.accent, fontSize: 13, fontWeight: '700' },
    rowCard: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 14,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: COLORS.border,
      backgroundColor: COLORS.panel,
      padding: 14,
      marginBottom: 10,
    },
    rowCardHighlight: {
      borderColor: COLORS.warning,
      backgroundColor: COLORS.panelStrong,
    },
    emptyCard: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 14,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: COLORS.border,
      backgroundColor: COLORS.panel,
      padding: 14,
    },
    iconTile: {
      width: 48,
      height: 48,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: COLORS.panelStrong,
      borderWidth: 1,
      borderColor: COLORS.border,
    },
    rowBody: { flex: 1, minWidth: 0 },
    rowTitle: { color: COLORS.text, fontSize: 16, fontWeight: '700' },
    rowSubtitleWrap: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 4 },
    rowSubtitle: { color: COLORS.muted, fontSize: 13, flexShrink: 1 },
    statusDot: { width: 8, height: 8, borderRadius: 4 },
    removeButton: {
      width: 36,
      height: 36,
      borderRadius: 10,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: COLORS.panelStrong,
      borderWidth: 1,
      borderColor: COLORS.border,
    },
    usageBlock: { marginBottom: 10 },
    usageHostLabel: { color: COLORS.muted, fontSize: 12, fontWeight: '700', marginBottom: 6 },
    quickRow: { flexDirection: 'row', gap: 12, marginTop: 18 },
    quickRowCompact: { marginTop: 12 },
    quickTile: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: COLORS.border,
      backgroundColor: COLORS.panel,
      paddingVertical: 16,
      paddingHorizontal: 16,
    },
    quickTileCompact: {
      paddingVertical: 12,
      paddingHorizontal: 14,
    },
    quickText: { color: COLORS.text, fontSize: 14, fontWeight: '700' },
    footnote: { color: COLORS.subtle, fontSize: 12, marginTop: 18, textAlign: 'center' },
    troubleshootLink: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      marginTop: 4,
      paddingVertical: 12,
    },
    troubleshootText: { color: COLORS.muted, fontSize: 13, fontWeight: '700' },
    scanner: { flex: 1, backgroundColor: COLORS.bg },
    scannerOverlay: { flex: 1, justifyContent: 'space-between', padding: 18 },
    scannerHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    scannerTitle: { color: COLORS.text, fontSize: 20, fontWeight: '800' },
    scanFrame: {
      alignSelf: 'center',
      width: 260,
      height: 260,
      borderRadius: 16,
      borderWidth: 2,
      borderColor: COLORS.accent,
      backgroundColor: 'transparent',
    },
    scannerHint: { color: COLORS.text, fontSize: 15, textAlign: 'center', marginBottom: 18 },
    modalBackdrop: { flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.68)', justifyContent: 'center', padding: 18 },
    manualPanel: { borderRadius: 16, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.panel, padding: 16, gap: 14 },
    manualHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    modalTitle: { color: COLORS.text, fontSize: 18, fontWeight: '800' },
    input: {
      minHeight: 128,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: COLORS.border,
      backgroundColor: COLORS.bg,
      color: COLORS.text,
      padding: 12,
      textAlignVertical: 'top',
    },
    primaryButton: {
      minHeight: 48,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      borderRadius: 12,
      paddingHorizontal: 14,
      backgroundColor: COLORS.accent,
    },
    primaryButtonText: { color: COLORS.text, fontSize: 15, fontWeight: '800' },
  });
}
