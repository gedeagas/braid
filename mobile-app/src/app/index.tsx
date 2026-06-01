import { CameraView, useCameraPermissions } from 'expo-camera';
import { router } from 'expo-router';
import { ChevronRight, Monitor, Plus, QrCode, RefreshCw, Settings, TerminalSquare, Wifi, X } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { getNotificationNavigationPath } from '@/notifications/notification-routing';
import { useClientManager } from '@/transport/client-manager';
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
  const [hosts, setHosts] = useState<PairedHost[]>([]);
  const [snapshots, setSnapshots] = useState<Record<string, HostSnapshot>>({});
  const [scannerOpen, setScannerOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualPayload, setManualPayload] = useState('');
  const [discoveredHosts, setDiscoveredHosts] = useState<BonjourHost[]>([]);
  const [bonjourError, setBonjourError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const scannedRef = useRef(false);
  const manager = useClientManager();

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
        .map((terminal) => ({ hostId: snapshot.host.id, terminal })),
    );
    return items.sort((a, b) => attentionRank(a.terminal.status) - attentionRank(b.terminal.status));
  }, [sortedSnapshots]);

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

  const knownHostIds = useMemo(() => new Set(hosts.map((host) => host.id)), [hosts]);

  // Deep-link to the exact terminal, reusing the same path builder the
  // notification tap uses so both entry points behave identically.
  const openAttention = useCallback((hostId: string, terminal: BraidTerminal) => {
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

        <View style={styles.quickRow}>
          <Pressable style={styles.quickTile} onPress={openScanner}>
            <QrCode color={COLORS.muted} size={20} />
            <Text style={styles.quickText}>Pair Desktop</Text>
          </Pressable>
          <Pressable style={styles.quickTile} onPress={() => setManualOpen(true)}>
            <Plus color={COLORS.muted} size={20} />
            <Text style={styles.quickText}>Enter Code</Text>
          </Pressable>
        </View>

        <Text style={styles.welcome}>Welcome back</Text>

        <View style={styles.statsRow}>
          <StatCard value={String(counts.needInput)} label="Need input" emphasis={counts.needInput > 0 ? 'alert' : undefined} />
          <StatCard value={String(counts.working)} label="Working" />
          <StatCard value={String(counts.total)} label="Agents" />
        </View>

        {attention.length > 0 && (
          <>
            <Text style={styles.sectionLabel}>Needs attention</Text>
            {attention.map(({ hostId, terminal }) => (
              <RowCard
                key={`${hostId}:${terminal.terminalId ?? terminal.id}`}
                icon={<TerminalSquare color={COLORS.muted} size={22} />}
                title={terminalLabel(terminal)}
                dotColor={terminal.status === 'waiting' ? COLORS.warning : COLORS.success}
                subtitle={attentionSubtitle(terminal)}
                onPress={() => openAttention(hostId, terminal)}
              />
            ))}
          </>
        )}

        <Text style={styles.sectionLabel}>Desktops</Text>
        {sortedSnapshots.length === 0 ? (
          <Pressable style={styles.emptyCard} onPress={openScanner}>
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
          sortedSnapshots.map((snapshot) => (
            <RowCard
              key={snapshot.host.id}
              icon={<Monitor color={COLORS.muted} size={22} />}
              title={snapshot.status?.instanceName ?? snapshot.host.instanceName ?? 'Braid desktop'}
              dotColor={stateDotColor(snapshot.state, COLORS)}
              subtitle={desktopSubtitle(snapshot)}
              onPress={() => router.push(`/host/${encodeURIComponent(snapshot.host.id)}`)}
              onLongPress={() => removeDesktop(snapshot.host)}
            />
          ))
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

function StatCard({ value, label, emphasis }: { value: string; label: string; emphasis?: 'alert' }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.statCard}>
      <Text style={[styles.statValue, emphasis === 'alert' && styles.statValueAlert]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
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
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  dotColor?: string;
  onPress: () => void;
  onLongPress?: () => void;
}) {
  const { palette: COLORS } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <Pressable style={styles.rowCard} onPress={onPress} onLongPress={onLongPress}>
      <View style={styles.iconTile}>{icon}</View>
      <View style={styles.rowBody}>
        <Text style={styles.rowTitle} numberOfLines={1}>{title}</Text>
        <View style={styles.rowSubtitleWrap}>
          {dotColor && <View style={[styles.statusDot, { backgroundColor: dotColor }]} />}
          <Text style={styles.rowSubtitle} numberOfLines={1}>{subtitle}</Text>
        </View>
      </View>
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
    welcome: { color: COLORS.text, fontSize: 30, fontWeight: '800', marginTop: 22 },
    statsRow: { flexDirection: 'row', gap: 10, marginTop: 18 },
    statCard: {
      flex: 1,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: COLORS.border,
      backgroundColor: COLORS.panel,
      paddingVertical: 14,
      paddingHorizontal: 13,
    },
    statValue: { color: COLORS.text, fontSize: 22, fontWeight: '800' },
    statValueAlert: { color: COLORS.warning },
    statLabel: { color: COLORS.muted, fontSize: 12, marginTop: 5 },
    sectionLabel: {
      color: COLORS.subtle,
      fontSize: 12,
      fontWeight: '700',
      textTransform: 'uppercase',
      letterSpacing: 0.6,
      marginTop: 28,
      marginBottom: 11,
    },
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
    usageBlock: { marginBottom: 10 },
    usageHostLabel: { color: COLORS.muted, fontSize: 12, fontWeight: '700', marginBottom: 6 },
    quickRow: { flexDirection: 'row', gap: 12, marginTop: 18 },
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
    quickText: { color: COLORS.text, fontSize: 14, fontWeight: '700' },
    footnote: { color: COLORS.subtle, fontSize: 12, marginTop: 18, textAlign: 'center' },
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
