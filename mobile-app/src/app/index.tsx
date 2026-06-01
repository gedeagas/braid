import { CameraView, useCameraPermissions } from 'expo-camera';
import { router } from 'expo-router';
import { ChevronRight, Monitor, Plus, QrCode, RefreshCw, TerminalSquare, Wifi, X } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { SESSION_SCREENS_ENABLED } from '@/constants/features';
import { useClientManager } from '@/transport/client-manager';
import { loadHosts, removeHost, saveHosts, upsertHost } from '@/transport/host-store';
import { type BonjourHost, matchesDiscoveredHost, mergeDiscoveredEndpoint, startBonjourBrowser } from '@/transport/bonjour';
import { createHostFromOffer, parsePairingPayload } from '@/transport/rpc-client';
import type { BraidSession, BraidStatus, PairedHost } from '@/transport/types';

type ConnectionState = 'idle' | 'connecting' | 'online' | 'offline';

interface HostSnapshot {
  host: PairedHost;
  state: ConnectionState;
  error?: string;
  status?: BraidStatus;
  sessions: BraidSession[];
  sessionTotal: number;
  agentTimeMs: number;
}

const COLORS = {
  bg: '#090A0B',
  panel: '#121417',
  panelStrong: '#191D22',
  border: '#2B3138',
  text: '#F7F8FA',
  muted: '#939BA7',
  subtle: '#626B78',
  accent: '#3D8BFF',
  accentSoft: '#17345F',
  success: '#35C98B',
  danger: '#FF5A66',
  warning: '#E5B84B',
};

export default function HomeScreen() {
  const [hosts, setHosts] = useState<PairedHost[]>([]);
  const [snapshots, setSnapshots] = useState<Record<string, HostSnapshot>>({});
  const [scannerOpen, setScannerOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualPayload, setManualPayload] = useState('');
  const [discoveredHosts, setDiscoveredHosts] = useState<BonjourHost[]>([]);
  const [bonjourError, setBonjourError] = useState<string | null>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const scannedRef = useRef(false);
  const manager = useClientManager();

  const refreshHost = useCallback(async (host: PairedHost) => {
    setSnapshots((current) => ({
      ...current,
      [host.id]: {
        host,
        state: 'connecting',
        sessions: current[host.id]?.sessions ?? [],
        sessionTotal: current[host.id]?.sessionTotal ?? 0,
        agentTimeMs: current[host.id]?.agentTimeMs ?? 0,
      },
    }));

    // Shared, app-level client - the manager owns its lifecycle and keeps the
    // notification subscription alive, so never connect or close it here.
    const client = manager.acquireHost(host);
    try {
      const status = await client.request<BraidStatus>('status.get');
      const sessions = await client.request<BraidSession[]>('sessions.list');
      const agentTimeMs = sessions.reduce((sum, session) => sum + (session.totalRunDurationMs ?? 0), 0);
      const saved = await upsertHost(host);
      setHosts(saved);
      setSnapshots((current) => ({
        ...current,
        [host.id]: { host, state: 'online', status, sessions: sessions.slice(0, 6), sessionTotal: sessions.length, agentTimeMs },
      }));
    } catch (error) {
      setSnapshots((current) => ({
        ...current,
        [host.id]: {
          host,
          state: 'offline',
          error: error instanceof Error ? error.message : String(error),
          sessions: current[host.id]?.sessions ?? [],
          sessionTotal: current[host.id]?.sessionTotal ?? 0,
          agentTimeMs: current[host.id]?.agentTimeMs ?? 0,
        },
      }));
    }
  }, [manager]);

  const refreshAll = useCallback((items: PairedHost[]) => {
    for (const host of items) void refreshHost(host);
  }, [refreshHost]);

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
    () => hosts.map((host) => snapshots[host.id] ?? { host, state: 'idle' as const, sessions: [], sessionTotal: 0, agentTimeMs: 0 }),
    [hosts, snapshots],
  );

  const agentsSpawned = sortedSnapshots.reduce((sum, item) => sum + item.sessionTotal, 0);
  const agentTimeMs = sortedSnapshots.reduce((sum, item) => sum + item.agentTimeMs, 0);
  const projectCount = sortedSnapshots.reduce((sum, item) => sum + (item.status?.projects.length ?? 0), 0);

  const resume = useMemo(() => {
    const flat = sortedSnapshots.flatMap((snapshot) =>
      snapshot.sessions.map((session) => ({ hostId: snapshot.host.id, session })),
    );
    return flat.sort((a, b) => (b.session.createdAt ?? 0) - (a.session.createdAt ?? 0))[0];
  }, [sortedSnapshots]);

  const unpairedNearby = useMemo(
    () => discoveredHosts.filter((found) => !hosts.some((host) => matchesDiscoveredHost(host, found))),
    [discoveredHosts, hosts],
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <ScrollView style={styles.shell} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <View style={styles.brand}>
            <View style={styles.brandMark} />
            <Text style={styles.brandName}>Braid</Text>
          </View>
          <Pressable style={styles.iconButton} onPress={() => refreshAll(hosts)} accessibilityLabel="Refresh">
            <RefreshCw color={COLORS.muted} size={18} />
          </Pressable>
        </View>

        <Text style={styles.welcome}>Welcome back</Text>

        <View style={styles.statsRow}>
          <StatCard value={String(agentsSpawned)} label="Agents spawned" />
          <StatCard value={formatDuration(agentTimeMs)} label="Agent time" />
          <StatCard value={String(projectCount)} label="Projects" />
        </View>

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
              dotColor={stateDotColor(snapshot.state)}
              subtitle={desktopSubtitle(snapshot)}
              onPress={() => router.push(`/host/${encodeURIComponent(snapshot.host.id)}`)}
              onLongPress={() => removeDesktop(snapshot.host)}
            />
          ))
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

        {/* @deprecated SDK chat sessions are deprecated in favor of the terminal screen. */}
        {SESSION_SCREENS_ENABLED && resume && (
          <>
            <Text style={styles.sectionLabel}>Resume</Text>
            <RowCard
              icon={<TerminalSquare color={COLORS.muted} size={22} />}
              title={resume.session.customName || resume.session.name || 'Untitled session'}
              dotColor={sessionDotColor(resume.session.status)}
              subtitle={sessionSubtitle(resume.session)}
              onPress={() => router.push({ pathname: '/session/[hostId]/[sessionId]', params: { hostId: resume.hostId, sessionId: resume.session.id } })}
            />
          </>
        )}

        <Text style={styles.sectionLabel}>Quick actions</Text>
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

function StatCard({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.statCard}>
      <Text style={styles.statValue}>{value}</Text>
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

function formatDuration(ms: number): string {
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function stateDotColor(state: ConnectionState): string {
  if (state === 'online') return COLORS.success;
  if (state === 'connecting') return COLORS.warning;
  if (state === 'offline') return COLORS.danger;
  return COLORS.subtle;
}

function sessionDotColor(status?: string): string {
  const value = (status ?? '').toLowerCase();
  if (value.includes('run') || value.includes('work') || value.includes('active')) return COLORS.accent;
  if (value.includes('done') || value.includes('complete') || value.includes('idle')) return COLORS.success;
  if (value.includes('error') || value.includes('fail')) return COLORS.danger;
  return COLORS.subtle;
}

function desktopSubtitle(snapshot: HostSnapshot): string {
  if (snapshot.state === 'connecting') return 'Connecting...';
  if (snapshot.state === 'offline') return snapshot.error ?? 'Offline';
  if (snapshot.state === 'idle') return 'Tap to connect';
  const projects = snapshot.status?.projects.length ?? 0;
  return ['Connected', plural(projects, 'project'), plural(snapshot.sessionTotal, 'session')].join(' · ');
}

function sessionSubtitle(session: BraidSession): string {
  const branch = session.worktreePath ? session.worktreePath.split('/').pop() : undefined;
  return [branch, session.model, session.status].filter(Boolean).join(' · ') || 'Session';
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.bg },
  shell: { flex: 1 },
  content: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 48 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  brandMark: { width: 22, height: 22, borderRadius: 7, backgroundColor: COLORS.accent },
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
  quickRow: { flexDirection: 'row', gap: 12 },
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
