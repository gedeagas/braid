import { CameraView, useCameraPermissions } from 'expo-camera';
import { router } from 'expo-router';
import { Activity, GitBranch, Monitor, Plus, QrCode, RefreshCw, Trash2, Wifi, WifiOff, X } from 'lucide-react-native';
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
import { SafeAreaView } from 'react-native-safe-area-context';

import { loadHosts, removeHost, saveHosts, upsertHost } from '@/transport/host-store';
import { type BonjourHost, matchesDiscoveredHost, mergeDiscoveredEndpoint, startBonjourBrowser } from '@/transport/bonjour';
import { BraidRpcClient, createHostFromOffer, parsePairingPayload } from '@/transport/rpc-client';
import type { BraidSession, BraidStatus, PairedHost } from '@/transport/types';

type ConnectionState = 'idle' | 'connecting' | 'online' | 'offline';

interface HostSnapshot {
  host: PairedHost;
  state: ConnectionState;
  error?: string;
  status?: BraidStatus;
  sessions: BraidSession[];
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

  const refreshHost = useCallback(async (host: PairedHost) => {
    setSnapshots((current) => ({
      ...current,
      [host.id]: { host, state: 'connecting', sessions: current[host.id]?.sessions ?? [] },
    }));

    const client = new BraidRpcClient(host);
    try {
      await client.connect();
      const status = await client.request<BraidStatus>('status.get');
      const sessions = await client.request<BraidSession[]>('sessions.list');
      const saved = await upsertHost(host);
      setHosts(saved);
      setSnapshots((current) => ({
        ...current,
        [host.id]: { host, state: 'online', status, sessions: sessions.slice(0, 6) },
      }));
    } catch (error) {
      setSnapshots((current) => ({
        ...current,
        [host.id]: {
          host,
          state: 'offline',
          error: error instanceof Error ? error.message : String(error),
          sessions: current[host.id]?.sessions ?? [],
        },
      }));
    } finally {
      client.close();
    }
  }, []);

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

  const sortedSnapshots = useMemo(() => {
    return hosts.map((host) => snapshots[host.id] ?? { host, state: 'idle' as const, sessions: [] });
  }, [hosts, snapshots]);

  const activeCount = sortedSnapshots.filter((item) => item.state === 'online').length;
  const sessionCount = sortedSnapshots.reduce((sum, item) => sum + item.sessions.length, 0);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.shell}>
        <View style={styles.header}>
          <View>
            <Text style={styles.eyebrow}>Braid Mobile</Text>
            <Text style={styles.title}>Agent control from your phone</Text>
          </View>
          <Pressable style={styles.iconButton} onPress={() => refreshAll(hosts)} accessibilityLabel="Refresh hosts">
            <RefreshCw color={COLORS.text} size={20} />
          </Pressable>
        </View>

        <View style={styles.statsRow}>
          <Stat icon={<Monitor color={COLORS.accent} size={18} />} label="Desktops" value={String(hosts.length)} />
          <Stat icon={<Wifi color={COLORS.success} size={18} />} label="Online" value={String(activeCount)} />
          <Stat icon={<Activity color={COLORS.warning} size={18} />} label="Sessions" value={String(sessionCount)} />
        </View>

        <View style={styles.actions}>
          <Pressable style={styles.primaryButton} onPress={openScanner}>
            <QrCode color={COLORS.text} size={18} />
            <Text style={styles.primaryButtonText}>Scan pairing code</Text>
          </Pressable>
          <Pressable style={styles.secondaryButton} onPress={() => setManualOpen(true)}>
            <Plus color={COLORS.text} size={18} />
            <Text style={styles.secondaryButtonText}>Enter code</Text>
          </Pressable>
        </View>

        <ScrollView style={styles.content} contentContainerStyle={styles.contentInner}>
          {(discoveredHosts.length > 0 || bonjourError) && (
            <View style={styles.discoveryPanel}>
              <Text style={styles.sectionLabel}>Local desktops</Text>
              {discoveredHosts.length === 0 ? (
                <Text style={styles.mutedText}>{bonjourError ? 'Bonjour unavailable in this build.' : 'Searching...'}</Text>
              ) : (
                discoveredHosts.map((host) => {
                  const paired = hosts.some((item) => matchesDiscoveredHost(item, host));
                  return (
                    <View key={host.id} style={styles.discoveryRow}>
                      <Wifi color={paired ? COLORS.success : COLORS.muted} size={15} />
                      <View style={styles.discoveryText}>
                        <Text style={styles.discoveryName} numberOfLines={1}>{host.name}</Text>
                        <Text style={styles.discoveryEndpoint} numberOfLines={1}>{paired ? host.endpoint : 'Scan pairing code to trust this desktop'}</Text>
                      </View>
                    </View>
                  );
                })
              )}
            </View>
          )}

          {sortedSnapshots.length === 0 ? (
            <View style={styles.empty}>
              <QrCode color={COLORS.subtle} size={36} />
              <Text style={styles.emptyTitle}>Pair a Braid desktop</Text>
              <Text style={styles.emptyText}>Open Settings &gt; Mobile in Braid desktop, start the server, then scan the QR code.</Text>
            </View>
          ) : (
            sortedSnapshots.map((snapshot) => (
              <HostCard
                key={snapshot.host.id}
                snapshot={snapshot}
                onOpen={() => router.push(`/host/${encodeURIComponent(snapshot.host.id)}`)}
                onRefresh={() => refreshHost(snapshot.host)}
                onRemove={async () => {
                  const next = await removeHost(snapshot.host.id);
                  setHosts(next);
                  setSnapshots((current) => {
                    const copy = { ...current };
                    delete copy[snapshot.host.id];
                    return copy;
                  });
                }}
              />
            ))
          )}
        </ScrollView>
      </View>

      <Modal visible={scannerOpen} animationType="slide" onRequestClose={() => setScannerOpen(false)}>
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

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <View style={styles.stat}>
      {icon}
      <View>
        <Text style={styles.statValue}>{value}</Text>
        <Text style={styles.statLabel}>{label}</Text>
      </View>
    </View>
  );
}

function HostCard({
  snapshot,
  onOpen,
  onRefresh,
  onRemove,
}: {
  snapshot: HostSnapshot;
  onOpen: () => void;
  onRefresh: () => void;
  onRemove: () => void;
}) {
  const online = snapshot.state === 'online';
  return (
    <Pressable style={styles.card} onPress={onOpen}>
      <View style={styles.cardHeader}>
        <View style={styles.hostTitleRow}>
          {online ? <Wifi color={COLORS.success} size={18} /> : <WifiOff color={COLORS.subtle} size={18} />}
          <View style={styles.hostText}>
            <Text style={styles.hostName}>{snapshot.status?.instanceName ?? snapshot.host.instanceName ?? 'Braid desktop'}</Text>
            <Text style={styles.hostEndpoint}>{snapshot.host.endpoint}</Text>
          </View>
        </View>
        <View style={styles.cardButtons}>
          <Pressable style={styles.smallIconButton} onPress={onRefresh} accessibilityLabel="Refresh desktop">
            <RefreshCw color={COLORS.text} size={16} />
          </Pressable>
          <Pressable style={styles.smallIconButton} onPress={onRemove} accessibilityLabel="Remove desktop">
            <Trash2 color={COLORS.danger} size={16} />
          </Pressable>
        </View>
      </View>

      <View style={[styles.statusPill, online ? styles.statusOnline : styles.statusOffline]}>
        <Text style={styles.statusText}>{statusLabel(snapshot)}</Text>
      </View>

      {snapshot.status && (
        <View style={styles.projectStrip}>
          <Text style={styles.sectionLabel}>Projects</Text>
          {snapshot.status.projects.slice(0, 4).map((project) => (
            <View key={project.id} style={styles.projectRow}>
              <GitBranch color={COLORS.muted} size={14} />
              <Text style={styles.projectName} numberOfLines={1}>{project.name}</Text>
            </View>
          ))}
        </View>
      )}

      <View style={styles.sessionStrip}>
        <Text style={styles.sectionLabel}>Recent sessions</Text>
        {snapshot.sessions.length === 0 ? (
          <Text style={styles.mutedText}>No sessions loaded.</Text>
        ) : (
          snapshot.sessions.map((session) => (
            <View key={session.id} style={styles.sessionRow}>
              <View style={styles.sessionDot} />
              <View style={styles.sessionText}>
                <Text style={styles.sessionName} numberOfLines={1}>{session.customName || session.name || 'Untitled session'}</Text>
                <Text style={styles.sessionMeta} numberOfLines={1}>
                  {[session.status, session.model, session.messageCount ? `${session.messageCount} messages` : null].filter(Boolean).join(' · ')}
                </Text>
              </View>
            </View>
          ))
        )}
      </View>
    </Pressable>
  );
}

function statusLabel(snapshot: HostSnapshot): string {
  if (snapshot.state === 'connecting') return 'Connecting';
  if (snapshot.state === 'online') return `Connected · Braid ${snapshot.status?.version ?? ''}`.trim();
  if (snapshot.state === 'offline') return snapshot.error ?? 'Offline';
  return 'Ready';
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.bg },
  shell: { flex: 1, paddingHorizontal: 18, paddingTop: 8 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 16 },
  eyebrow: { color: COLORS.accent, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0 },
  title: { color: COLORS.text, fontSize: 28, fontWeight: '800', lineHeight: 34, marginTop: 4, maxWidth: 280 },
  iconButton: {
    width: 42,
    height: 42,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.panelStrong,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  statsRow: { flexDirection: 'row', gap: 10, marginTop: 18 },
  stat: {
    flex: 1,
    minHeight: 74,
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.panel,
    justifyContent: 'space-between',
  },
  statValue: { color: COLORS.text, fontSize: 22, fontWeight: '800' },
  statLabel: { color: COLORS.muted, fontSize: 12, marginTop: 2 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 14 },
  primaryButton: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 8,
    paddingHorizontal: 14,
    backgroundColor: COLORS.accent,
  },
  primaryButtonText: { color: COLORS.text, fontSize: 15, fontWeight: '800' },
  secondaryButton: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 8,
    paddingHorizontal: 14,
    backgroundColor: COLORS.panelStrong,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  secondaryButtonText: { color: COLORS.text, fontSize: 15, fontWeight: '700' },
  content: { flex: 1, marginTop: 16 },
  contentInner: { gap: 12, paddingBottom: 28 },
  empty: {
    minHeight: 260,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.panel,
    padding: 24,
  },
  emptyTitle: { color: COLORS.text, fontSize: 20, fontWeight: '800', marginTop: 14 },
  emptyText: { color: COLORS.muted, fontSize: 14, lineHeight: 20, textAlign: 'center', marginTop: 8 },
  card: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.panel,
    padding: 14,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  hostTitleRow: { flex: 1, flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  hostText: { flex: 1, minWidth: 0 },
  hostName: { color: COLORS.text, fontSize: 17, fontWeight: '800' },
  hostEndpoint: { color: COLORS.muted, fontSize: 12, marginTop: 3 },
  cardButtons: { flexDirection: 'row', gap: 8 },
  smallIconButton: {
    width: 34,
    height: 34,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.panelStrong,
  },
  statusPill: { alignSelf: 'flex-start', marginTop: 14, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  statusOnline: { backgroundColor: 'rgba(53, 201, 139, 0.16)' },
  statusOffline: { backgroundColor: 'rgba(147, 155, 167, 0.14)' },
  statusText: { color: COLORS.text, fontSize: 12, fontWeight: '700' },
  projectStrip: { marginTop: 16, gap: 8 },
  sectionLabel: { color: COLORS.subtle, fontSize: 12, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0 },
  projectRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  projectName: { color: COLORS.text, fontSize: 14, flex: 1 },
  sessionStrip: { marginTop: 16, gap: 10 },
  mutedText: { color: COLORS.muted, fontSize: 13 },
  sessionRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  sessionDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: COLORS.accent },
  sessionText: { flex: 1, minWidth: 0 },
  sessionName: { color: COLORS.text, fontSize: 14, fontWeight: '700' },
  sessionMeta: { color: COLORS.muted, fontSize: 12, marginTop: 2 },
  discoveryPanel: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.panel,
    padding: 14,
    gap: 10,
  },
  discoveryRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  discoveryText: { flex: 1, minWidth: 0 },
  discoveryName: { color: COLORS.text, fontSize: 14, fontWeight: '700' },
  discoveryEndpoint: { color: COLORS.muted, fontSize: 12, marginTop: 2 },
  scanner: { flex: 1, backgroundColor: COLORS.bg },
  scannerOverlay: { flex: 1, justifyContent: 'space-between', padding: 18 },
  scannerHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  scannerTitle: { color: COLORS.text, fontSize: 20, fontWeight: '800' },
  scanFrame: {
    alignSelf: 'center',
    width: 260,
    height: 260,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: COLORS.accent,
    backgroundColor: 'transparent',
  },
  scannerHint: { color: COLORS.text, fontSize: 15, textAlign: 'center', marginBottom: 18 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.68)', justifyContent: 'center', padding: 18 },
  manualPanel: { borderRadius: 8, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.panel, padding: 16, gap: 14 },
  manualHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  modalTitle: { color: COLORS.text, fontSize: 18, fontWeight: '800' },
  input: {
    minHeight: 128,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.bg,
    color: COLORS.text,
    padding: 12,
    textAlignVertical: 'top',
  },
});
