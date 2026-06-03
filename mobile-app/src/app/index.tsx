import { CameraView, useCameraPermissions } from 'expo-camera';
import { router, useLocalSearchParams } from 'expo-router';
import { ChevronRight, LifeBuoy, Monitor, Plus, QrCode, RefreshCw, Settings, TerminalSquare, Trash2, Wifi, X } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
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
import Animated, {
  Easing,
  FadeInDown,
  LinearTransition,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import i18n from '@/i18n';
import { unregisterFromPushAsync } from '@/notifications/mobile-notifications';
import { getNotificationNavigationPath } from '@/notifications/notification-routing';
import { useClientManager } from '@/transport/client-manager';
import { classifyConnection, isErrorVerdict, type ConnectionVerdict } from '@/transport/connection-health';
import { loadHosts, removeHost, saveHosts, upsertHost } from '@/transport/host-store';
import { type BonjourHost, matchesDiscoveredHost, mergeDiscoveredEndpoint, startBonjourBrowser } from '@/transport/bonjour';
import { createHostFromOffer, parsePairingPayload, type BraidRpcClient } from '@/transport/rpc-client';
import type { BraidStatus, BraidTerminal, PairedHost, ProviderRateLimits, RateLimitState } from '@/transport/types';
import { AgentIcon } from '@/terminal/AgentIcon';
import { RateLimitSection } from '@/usage/RateLimitSection';
import { describeProvider, formatResetIn, percentLeft, providerName } from '@/usage/rate-limit-format';
import { IconButton } from '@/ui/kit';
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

// Fetch a host's Claude/Codex usage. `fresh` (user-initiated pull-to-refresh or
// the refresh button) asks the desktop to re-poll the providers via
// `rateLimits.refresh` so the numbers actually move; otherwise we take the cheap
// cached `rateLimits.get` (used by initial load and activity-driven refreshes, so
// a terminal event doesn't re-poll the CLIs every time). Both paths are
// best-effort: a desktop too old to expose either RPC (or a transient failure)
// returns undefined, and the caller keeps the last known value. On a forced
// refresh we fall back to `.get` so an old desktop without `.refresh` still shows
// cached usage instead of nothing - so this needs no protocol bump or capability.
async function fetchUsage(client: BraidRpcClient, fresh: boolean): Promise<RateLimitState | undefined> {
  if (fresh) {
    const refreshed = await client.request<RateLimitState>('rateLimits.refresh').catch(() => undefined);
    if (refreshed) return refreshed;
  }
  return client.request<RateLimitState>('rateLimits.get').catch(() => undefined);
}

/** An agent that needs the user: waiting for input, or just finished. */
interface AttentionItem {
  hostId: string;
  terminal: BraidTerminal;
}

interface RecentActivityItem {
  id: string;
  hostId: string;
  title: string;
  meta: string;
  tone: 'waiting' | 'running' | 'done' | 'offline';
  terminal?: BraidTerminal;
}

type RecentActivityWithRank = RecentActivityItem & { rank: number };

const USE_FRESH_HOME = true;

export default function HomeScreen() {
  return USE_FRESH_HOME ? <FreshHomeScreen /> : <LegacyHomeScreen />;
}

// Design direction: native utility, not dashboard polish. Prefer flat rows,
// quiet typography, small status summaries, and useful content over big hero
// cards or symmetrical metric blocks.
function FreshHomeScreen() {
  const { t } = useTranslation();
  const { palette: COLORS } = useTheme();
  const styles = useThemedStyles(makeFreshStyles);
  const reduceMotion = useReducedMotion();
  const [hosts, setHosts] = useState<PairedHost[]>([]);
  const [snapshots, setSnapshots] = useState<Record<string, HostSnapshot>>({});
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannerBusy, setScannerBusy] = useState(false);
  const [scannerError, setScannerError] = useState<string | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualPayload, setManualPayload] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [acknowledged, setAcknowledged] = useState<Record<string, string>>({});
  const [usageExpanded, setUsageExpanded] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const scannedRef = useRef(false);
  const manager = useClientManager();
  const { pair: pairParam } = useLocalSearchParams<{ pair?: string }>();
  const pairHandledRef = useRef(false);
  const [, bump] = useReducer((n: number) => n + 1, 0);

  useEffect(() => manager.subscribe(bump), [manager]);

  const refreshHost = useCallback(async (host: PairedHost, opts?: { freshUsage?: boolean }) => {
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

    const client = manager.acquireHost(host);
    try {
      const status = await client.request<BraidStatus>('status.get');
      const terminals = await client.request<BraidTerminal[]>('terminal.list');
      const agentTimeMs = terminals.reduce((sum, terminal) => sum + (terminal.totalRunDurationMs ?? 0), 0);
      const rateLimits = await fetchUsage(client, opts?.freshUsage === true);
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

  const refreshAll = useCallback((items: PairedHost[], opts?: { freshUsage?: boolean }) => {
    for (const host of items) void refreshHost(host, opts);
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
    return manager.subscribeActivity((hostId) => {
      const host = hosts.find((item) => item.id === hostId);
      if (host) void refreshHost(host);
    });
  }, [manager, hosts, refreshHost]);

  const onPullRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all(hosts.map((host) => refreshHost(host, { freshUsage: true })));
    } finally {
      setRefreshing(false);
    }
  }, [hosts, refreshHost]);

  const pairFromPayload = useCallback(async (payload: string) => {
    const offer = parsePairingPayload(payload);
    if (!offer.endpoint || !offer.token) throw new Error(i18n.t('home.pairingMissingFields'));
    const host = createHostFromOffer(offer);
    setScannerOpen(false);
    setScannerBusy(false);
    setScannerError(null);
    setManualOpen(false);
    setManualPayload('');
    const saved = await upsertHost(host);
    setHosts(saved);
    await refreshHost(host);
  }, [refreshHost]);

  const openScanner = async () => {
    scannedRef.current = false;
    setScannerBusy(false);
    setScannerError(null);
    if (!permission?.granted) {
      const result = await requestPermission();
      if (!result.granted) {
        setManualOpen(true);
        return;
      }
    }
    setScannerOpen(true);
  };

  const handleScannedPayload = (data: string) => {
    if (scannedRef.current || scannerBusy) return;
    scannedRef.current = true;
    setScannerBusy(true);
    setScannerError(null);
    pairFromPayload(data).catch((error) => {
      scannedRef.current = false;
      setScannerBusy(false);
      setScannerError(error instanceof Error ? error.message : String(error));
    });
  };

  useEffect(() => {
    if (pairParam === '1' && !pairHandledRef.current) {
      pairHandledRef.current = true;
      void openScanner();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pairParam]);

  const sortedSnapshots = useMemo(
    () => hosts.map((host) => snapshots[host.id] ?? { host, state: 'idle' as const, terminals: [], agentTimeMs: 0 }),
    [hosts, snapshots],
  );

  const attention = useMemo<AttentionItem[]>(() => (
    sortedSnapshots.flatMap((snapshot) =>
      snapshot.terminals
        .filter((terminal) => terminal.status === 'waiting' || terminal.status === 'done')
        .filter((terminal) => acknowledged[attentionKey(snapshot.host.id, terminal)] !== attentionSignature(terminal))
        .map((terminal) => ({ hostId: snapshot.host.id, terminal })),
    ).sort((a, b) => attentionRank(a.terminal.status) - attentionRank(b.terminal.status))
  ), [sortedSnapshots, acknowledged]);

  const recentActivity = useMemo<RecentActivityItem[]>(() => (
    sortedSnapshots
      .flatMap<RecentActivityWithRank>((snapshot) => {
        const hostName = homeHostName(snapshot);
        const terminalItems = snapshot.terminals
          .filter((terminal) => terminal.status === 'waiting' || terminal.status === 'working' || terminal.status === 'done')
          .map((terminal) => {
            const tone: RecentActivityItem['tone'] = terminal.status === 'waiting' ? 'waiting' : terminal.status === 'working' ? 'running' : 'done';
            const state = terminal.status === 'waiting'
              ? 'Needs input'
              : terminal.status === 'working'
                ? 'Running'
                : 'Finished';
            return {
              id: `${snapshot.host.id}:${terminal.terminalId ?? terminal.id}:activity`,
              hostId: snapshot.host.id,
              title: terminalLabel(terminal),
              meta: [hostName, state, formatActivityTime(terminal.lastOutputAt)].filter(Boolean).join(' · '),
              tone,
              terminal,
              rank: terminal.lastOutputAt ?? 0,
            };
          });
        if (snapshot.state === 'offline') {
          return [
            ...terminalItems,
            {
              id: `${snapshot.host.id}:offline`,
              hostId: snapshot.host.id,
              title: hostName,
              meta: snapshot.error ? `Offline · ${snapshot.error}` : 'Offline',
              tone: 'offline' as const,
              rank: 0,
            },
          ];
        }
        return terminalItems;
      })
      .sort((a, b) => {
        const toneRank: Record<RecentActivityItem['tone'], number> = { waiting: 4, running: 3, done: 2, offline: 1 };
        const rankDelta = (b.rank ?? 0) - (a.rank ?? 0);
        if (rankDelta !== 0) return rankDelta;
        return toneRank[b.tone] - toneRank[a.tone];
      })
      .slice(0, 2)
      .map(({ rank: _rank, ...item }) => item)
  ), [sortedSnapshots]);

  const counts = useMemo(() => {
    let needInput = 0;
    let working = 0;
    let total = 0;
    let offline = 0;
    for (const snapshot of sortedSnapshots) {
      if (snapshot.state === 'offline') offline += 1;
      for (const terminal of snapshot.terminals) {
        total += 1;
        if (terminal.status === 'waiting') needInput += 1;
        else if (terminal.status === 'working') working += 1;
      }
    }
    return { needInput, working, total, offline };
  }, [sortedSnapshots]);

  const usageHosts = useMemo(
    () => sortedSnapshots.filter((item) => item.rateLimits && (item.rateLimits.claude || item.rateLimits.codex)),
    [sortedSnapshots],
  );

  const knownHostIds = useMemo(() => new Set(hosts.map((host) => host.id)), [hosts]);

  const openAttention = useCallback((hostId: string, terminal: BraidTerminal) => {
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

  const clearAllAttention = useCallback(() => {
    setAcknowledged((current) => {
      const next = { ...current };
      for (const { hostId, terminal } of attention) {
        next[attentionKey(hostId, terminal)] = attentionSignature(terminal);
      }
      return next;
    });
  }, [attention]);

  const removeDesktop = useCallback((host: PairedHost) => {
    Alert.alert(i18n.t('home.removeDesktopTitle'), i18n.t('home.removeDesktopMessage', { name: host.instanceName ?? host.endpoint }), [
      { text: i18n.t('common.cancel'), style: 'cancel' },
      {
        text: i18n.t('common.remove'),
        style: 'destructive',
        onPress: async () => {
          // Tell the desktop to forget our push token (while still connected) so
          // it stops sending background notifications, then drop the live
          // connection: removing only from storage leaves the client-manager entry
          // alive, so it keeps the socket open (and keeps reconnecting + presenting
          // notifications) for a desktop the user just removed. dropHost closes the
          // socket and tears down the listener.
          await manager.unregisterPush(host.id);
          manager.dropHost(host.id);
          const next = await removeHost(host.id);
          // No desktops left: tear down push registration entirely so any desktop
          // that was offline at removal self-cleans via DeviceNotRegistered on its
          // next push, instead of waiting out the token TTL.
          if (next.length === 0) await unregisterFromPushAsync();
          setHosts(next);
          setSnapshots((current) => {
            const copy = { ...current };
            delete copy[host.id];
            return copy;
          });
        },
      },
    ]);
  }, [manager]);

  const statusLine = counts.needInput > 0
    ? t('home.statusNeedInput', { count: counts.needInput })
    : counts.working > 0
      ? t('home.statusRunning', { count: counts.working })
      : sortedSnapshots.length === 0
        ? t('home.statusNoDesktop')
        : t('home.statusQuiet');

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <OperationalMeshBackground active={counts.working > 0} attention={counts.needInput > 0} offline={counts.offline > 0} reduceMotion={reduceMotion} />
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
        <View style={styles.topBar}>
          <View style={styles.titleBlock}>
            <Text style={styles.appTitle}>Braid</Text>
            <Text style={styles.appStatus}>{statusLine}</Text>
          </View>
          <View style={styles.topActions}>
            <IconButton icon={<QrCode color={COLORS.text} size={19} />} onPress={() => void openScanner()} accessibilityLabel={t('home.pairDesktop')} variant="panel" size="sm" />
            <IconButton icon={<RefreshCw color={COLORS.text} size={19} />} onPress={() => refreshAll(hosts, { freshUsage: true })} accessibilityLabel={t('common.refresh')} variant="panel" size="sm" />
            <IconButton icon={<Settings color={COLORS.text} size={19} />} onPress={() => router.push('/settings' as Parameters<typeof router.push>[0])} accessibilityLabel={t('home.settings')} variant="panel" size="sm" />
          </View>
        </View>

        <View style={styles.commandBand}>
          <View style={styles.commandMetric}>
            <Text style={styles.commandValue}>{counts.needInput}</Text>
            <Text style={styles.commandLabel}>{t('home.metricWaiting')}</Text>
          </View>
          <View style={styles.commandMetric}>
            <Text style={styles.commandValue}>{counts.working}</Text>
            <Text style={styles.commandLabel}>{t('home.metricRunning')}</Text>
          </View>
          <View style={styles.commandMetric}>
            <Text style={styles.commandValue}>{counts.total}</Text>
            <Text style={styles.commandLabel}>{t('home.metricAgents')}</Text>
          </View>
        </View>

        {attention.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeaderRow}>
              <Text style={[styles.sectionTitle, styles.sectionTitleFlush]}>{t('home.focusQueue')}</Text>
              <Pressable onPress={clearAllAttention} hitSlop={8} accessibilityLabel={t('home.clearFocusQueue')}>
                <Text style={styles.clearAction}>{t('home.clear')}</Text>
              </Pressable>
            </View>
            {attention.slice(0, 4).map(({ hostId, terminal }) => (
              <Pressable key={`${hostId}:${terminal.terminalId ?? terminal.id}`} style={styles.focusCard} onPress={() => openAttention(hostId, terminal)}>
                <View style={[styles.focusMarker, { backgroundColor: terminal.status === 'waiting' ? COLORS.warning : COLORS.success }]} />
                <View style={styles.rowBody}>
                  <Text style={styles.focusTitle} numberOfLines={1}>{terminalLabel(terminal)}</Text>
                  <Text style={styles.focusMeta} numberOfLines={1}>{[homeHostNameById(sortedSnapshots, hostId), attentionSubtitle(terminal)].filter(Boolean).join(' · ')}</Text>
                </View>
                <ChevronRight color={COLORS.subtle} size={18} />
              </Pressable>
            ))}
          </View>
        )}

        {recentActivity.length > 0 && (
          <View style={styles.activitySection}>
            <Text style={styles.sectionTitle}>{t('home.activity')}</Text>
            <View style={styles.activityList}>
              {recentActivity.map((activity, index) => (
                <Pressable
                  key={activity.id}
                  style={[styles.activityRow, index > 0 && styles.activityRowDivider]}
                  onPress={() => {
                    if (activity.terminal) openAttention(activity.hostId, activity.terminal);
                    else router.push(`/host/${encodeURIComponent(activity.hostId)}`);
                  }}
                >
                  <View style={[styles.activityDot, { backgroundColor: activityToneColor(activity.tone, COLORS) }]} />
                  <View style={styles.rowBody}>
                    <Text style={styles.activityTitle} numberOfLines={1}>{activity.title}</Text>
                    <Text style={styles.activityMeta} numberOfLines={1}>{activity.meta}</Text>
                  </View>
                  <ChevronRight color={COLORS.subtle} size={14} />
                </Pressable>
              ))}
            </View>
          </View>
        )}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('home.desktops')}</Text>
          {sortedSnapshots.length === 0 ? (
            <View style={styles.emptyPanel}>
              <View style={styles.emptyHeader}>
                <View style={styles.emptyIcon}>
                  <Monitor color={COLORS.text} size={22} />
                </View>
                <View style={styles.rowBody}>
                  <Text style={styles.emptyTitle}>{t('home.pairADesktop')}</Text>
                  <Text style={styles.emptyText}>{t('home.pairEmptyHint')}</Text>
                </View>
              </View>
              <View style={styles.emptyActions}>
                <Pressable style={styles.emptyPrimaryAction} onPress={() => void openScanner()}>
                  <QrCode color="#FFFFFF" size={17} />
                  <Text style={styles.emptyPrimaryText}>{t('home.scanQrCode')}</Text>
                </Pressable>
                <Pressable style={styles.emptySecondaryAction} onPress={() => setManualOpen(true)}>
                  <Plus color={COLORS.text} size={17} />
                  <Text style={styles.emptySecondaryText}>{t('home.enterCodeInstead')}</Text>
                </Pressable>
              </View>
            </View>
          ) : (
            sortedSnapshots.map((snapshot) => {
              const verdict = classifyConnection({
                state: manager.getState(snapshot.host.id),
                reconnectAttempts: manager.getReconnectAttempt(snapshot.host.id),
                lastConnectedAt: manager.getLastConnectedAt(snapshot.host.id),
              });
              const verdictError = isErrorVerdict(verdict);
              return (
                <Pressable key={snapshot.host.id} style={styles.desktopRow} onPress={() => router.push(`/host/${encodeURIComponent(snapshot.host.id)}`)} onLongPress={() => removeDesktop(snapshot.host)}>
                  <View style={styles.desktopIcon}>
                    <Monitor color={COLORS.text} size={20} />
                  </View>
                  <View style={styles.rowBody}>
                    <Text style={styles.desktopTitle} numberOfLines={1}>{snapshot.status?.instanceName ?? snapshot.host.instanceName ?? t('home.braidDesktop')}</Text>
                    <View style={styles.desktopMetaRow}>
                      <View style={[styles.statusDot, { backgroundColor: verdictError ? verdictColor(verdict, COLORS) : stateDotColor(snapshot.state, COLORS) }]} />
                      <Text style={styles.desktopMeta} numberOfLines={1}>{verdictError ? verdict.label : desktopSubtitle(snapshot)}</Text>
                    </View>
                  </View>
                  <ChevronRight color={COLORS.subtle} size={18} />
                </Pressable>
              );
            })
          )}
        </View>

        {usageHosts.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t('home.usage')}</Text>
            {usageHosts.map((snapshot) => (
              <View key={snapshot.host.id} style={styles.usageBlock}>
                {usageHosts.length > 1 && (
                  <Text style={styles.usageHostLabel} numberOfLines={1}>
                    {snapshot.status?.instanceName ?? snapshot.host.instanceName ?? t('home.braidDesktop')}
                  </Text>
                )}
                <CompactUsageSummary
                  state={snapshot.rateLimits!}
                  now={Date.now()}
                  expanded={usageExpanded}
                  onToggle={() => setUsageExpanded((value) => !value)}
                />
                {usageExpanded && (
                  <View style={styles.usageDetails}>
                    <RateLimitSection state={snapshot.rateLimits!} now={Date.now()} />
                  </View>
                )}
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      <Modal visible={scannerOpen} animationType="slide" onRequestClose={() => setScannerOpen(false)}>
        <SafeAreaProvider>
          <View style={styles.scanner}>
            <CameraView
              style={StyleSheet.absoluteFill}
              facing="back"
              barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
              onBarcodeScanned={({ data }) => handleScannedPayload(data)}
            />
            <SafeAreaView style={styles.scannerOverlay}>
              <View style={styles.scannerHeader}>
                <View>
                  <Text style={styles.scannerEyebrow}>{t('home.pairDesktop')}</Text>
                  <Text style={styles.scannerTitle}>{t('home.scanQrCode')}</Text>
                </View>
                <Pressable style={styles.scannerCloseButton} onPress={() => setScannerOpen(false)} accessibilityLabel={t('home.closeScanner')}>
                  <X color="#FFFFFF" size={20} />
                </Pressable>
              </View>
              <View style={styles.scannerCenter}>
                <View style={styles.scanFrame}>
                  {scannerBusy && <Text style={styles.scannerBusyText}>{t('home.pairing')}</Text>}
                </View>
              </View>
              <View style={styles.scannerPanel}>
                <Text style={styles.scannerPanelTitle}>{t('home.desktopSettingsMobile')}</Text>
                <Text style={styles.scannerPanelText}>{t('home.keepQrInFrame')}</Text>
                {scannerError && <Text style={styles.scannerErrorText}>{scannerError}</Text>}
                <Pressable style={styles.scannerManualButton} onPress={() => { setScannerOpen(false); setManualOpen(true); }}>
                  <Text style={styles.scannerManualText}>{t('home.enterCodeInstead')}</Text>
                </Pressable>
              </View>
            </SafeAreaView>
          </View>
        </SafeAreaProvider>
      </Modal>

      <Modal visible={manualOpen} transparent animationType="fade" onRequestClose={() => setManualOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.manualPanel}>
            <View style={styles.manualHeader}>
              <Text style={styles.modalTitle}>{t('home.enterPairingPayload')}</Text>
              <Pressable onPress={() => setManualOpen(false)} accessibilityLabel={t('home.closeManualPairing')}>
                <X color={COLORS.text} size={20} />
              </Pressable>
            </View>
            <TextInput
              value={manualPayload}
              onChangeText={setManualPayload}
              placeholder={t('home.pasteQrPayload')}
              placeholderTextColor={COLORS.subtle}
              multiline
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.input}
            />
            <Pressable
              style={styles.primaryButton}
              onPress={() => pairFromPayload(manualPayload).catch((error) => {
                Alert.alert(t('home.pairingFailed'), error instanceof Error ? error.message : String(error));
              })}
            >
              <Wifi color={COLORS.text} size={18} />
              <Text style={styles.primaryButtonText}>{t('home.connect')}</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function OperationalMeshBackground({
  active,
  attention,
  offline,
  reduceMotion,
}: {
  active: boolean;
  attention: boolean;
  offline: boolean;
  reduceMotion: boolean;
}) {
  const { palette: COLORS } = useTheme();
  const styles = useThemedStyles(makeFreshStyles);
  const pulse = useSharedValue(0);
  const phaseA = useSharedValue(0.08);
  const phaseB = useSharedValue(0.52);
  const phaseC = useSharedValue(0.78);
  const driftA = useSharedValue(2);
  const driftB = useSharedValue(1.4);

  useEffect(() => {
    const rand = (min: number, max: number) => min + Math.random() * (max - min);
    phaseA.value = rand(0, 0.24);
    phaseB.value = rand(0.38, 0.72);
    phaseC.value = rand(0.66, 0.94);
    driftA.value = rand(1.2, 2.8);
    driftB.value = rand(0.8, 2.2);

    if (reduceMotion) {
      pulse.value = 0.35;
      return;
    }
    pulse.value = 0;
    pulse.value = withRepeat(
      withTiming(1, {
        duration: Math.round((attention ? 5200 : offline ? 11200 : active ? 7200 : 12800) * rand(0.86, 1.18)),
        easing: Easing.linear,
      }),
      -1,
      false,
    );
  }, [active, attention, driftA, driftB, offline, phaseA, phaseB, phaseC, pulse, reduceMotion]);

  const haloStyle = useAnimatedStyle(() => ({
    opacity: (attention ? 0.2 : offline ? 0.07 : active ? 0.13 : 0.08) + Math.sin((pulse.value + phaseC.value) * Math.PI * 2) * 0.035,
    transform: [
      { translateX: Math.sin((pulse.value + phaseB.value) * Math.PI * 2) * 18 },
      { translateY: Math.cos((pulse.value + phaseA.value) * Math.PI * 2) * 12 },
      { scale: 0.98 + Math.sin((pulse.value + phaseC.value) * Math.PI * 2) * 0.045 },
    ],
  }));

  const nodeStyle = useAnimatedStyle(() => ({
    opacity: (offline ? 0.1 : 0.16) + Math.sin((pulse.value + phaseA.value) * Math.PI * 2) * (attention ? 0.12 : active ? 0.07 : 0.035),
    transform: [
      { translateX: Math.sin((pulse.value + phaseA.value) * Math.PI * 2) * driftA.value },
      { translateY: Math.cos((pulse.value + phaseB.value) * Math.PI * 2) * driftB.value },
      { scale: 0.98 + Math.sin((pulse.value + phaseA.value) * Math.PI * 2) * 0.08 },
    ],
  }));

  const signalStyle = useAnimatedStyle(() => {
    const phase = (pulse.value + phaseA.value) % 1;
    return {
      opacity: Math.sin(phase * Math.PI) * (attention ? 0.42 : offline ? 0.08 : active ? 0.28 : 0.1),
      transform: [
        { translateX: -118 + phase * 264 },
        { scaleX: 0.55 + Math.sin(phase * Math.PI) * 0.5 },
        { rotate: '-20deg' },
      ],
    };
  });

  const signalStyleB = useAnimatedStyle(() => {
    const phase = (pulse.value + phaseB.value) % 1;
    return {
      opacity: Math.sin(phase * Math.PI) * (attention ? 0.26 : offline ? 0.06 : active ? 0.2 : 0.08),
      transform: [
        { translateX: 132 - phase * 252 },
        { scaleX: 0.5 + Math.sin(phase * Math.PI) * 0.38 },
        { rotate: '18deg' },
      ],
    };
  });

  const signalStyleC = useAnimatedStyle(() => {
    const phase = (pulse.value + phaseC.value) % 1;
    return {
      opacity: Math.sin(phase * Math.PI) * (attention ? 0.32 : offline ? 0.05 : active ? 0.22 : 0.07),
      transform: [
        { translateX: -92 + phase * 210 },
        { scaleX: 0.45 + Math.sin(phase * Math.PI) * 0.42 },
        { rotate: '-10deg' },
      ],
    };
  });

  const color = attention ? COLORS.warning : offline ? COLORS.danger : active ? COLORS.accent : COLORS.muted;

  return (
    <View pointerEvents="none" style={styles.meshLayer}>
      <Animated.View style={[styles.meshHalo, { borderColor: color }, haloStyle]} />
      <View style={[styles.meshLine, styles.meshLineA, { backgroundColor: color }]} />
      <View style={[styles.meshLine, styles.meshLineB, { backgroundColor: COLORS.muted }]} />
      <View style={[styles.meshLine, styles.meshLineC, { backgroundColor: color }]} />
      <Animated.View style={[styles.meshSignal, styles.meshSignalA, { backgroundColor: color }, signalStyle]} />
      <Animated.View style={[styles.meshSignal, styles.meshSignalB, { backgroundColor: COLORS.muted }, signalStyleB]} />
      <Animated.View style={[styles.meshSignal, styles.meshSignalC, { backgroundColor: color }, signalStyleC]} />
      <Animated.View style={[styles.meshNode, styles.meshNodeA, { borderColor: color }, nodeStyle]} />
      <Animated.View style={[styles.meshNode, styles.meshNodeB, { borderColor: COLORS.muted }, nodeStyle]} />
      <Animated.View style={[styles.meshNode, styles.meshNodeC, { borderColor: color }, nodeStyle]} />
      <View style={[styles.meshNodeStatic, styles.meshNodeD, { borderColor: COLORS.border }]} />
    </View>
  );
}

function CompactUsageSummary({
  state,
  now,
  expanded,
  onToggle,
}: {
  state: RateLimitState;
  now: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  const { palette: COLORS } = useTheme();
  const styles = useThemedStyles(makeFreshStyles);
  const providers = [state.claude, state.codex].filter(
    (provider): provider is ProviderRateLimits => provider != null,
  );
  if (providers.length === 0) return null;

  return (
    <View style={styles.compactUsage}>
      {providers.map((provider, index) => {
        const summary = compactProviderSummary(provider, now);
        return (
          <Pressable key={provider.provider} style={[styles.compactUsageRow, index > 0 && styles.compactUsageDivider]} onPress={onToggle}>
            <View style={styles.compactUsageIcon}>
              <AgentIcon agentId={provider.provider} size={17} />
            </View>
            <View style={styles.rowBody}>
              <Text style={styles.compactUsageTitle}>{providerName(provider.provider)}</Text>
              <Text style={styles.compactUsageMeta} numberOfLines={1}>{summary.meta}</Text>
            </View>
            <Text style={[styles.compactUsageValue, { color: summary.color(COLORS) }]}>{summary.value}</Text>
            <ChevronRight color={COLORS.subtle} size={16} style={{ transform: [{ rotate: expanded ? '90deg' : '0deg' }] }} />
          </Pressable>
        );
      })}
    </View>
  );
}

function LegacyHomeScreen() {
  const { t } = useTranslation();
  const { palette: COLORS } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const reduceMotion = useReducedMotion();
  const [hosts, setHosts] = useState<PairedHost[]>([]);
  const [snapshots, setSnapshots] = useState<Record<string, HostSnapshot>>({});
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannerBusy, setScannerBusy] = useState(false);
  const [scannerError, setScannerError] = useState<string | null>(null);
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

  const refreshHost = useCallback(async (host: PairedHost, opts?: { freshUsage?: boolean }) => {
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
      const rateLimits = await fetchUsage(client, opts?.freshUsage === true);
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

  const refreshAll = useCallback((items: PairedHost[], opts?: { freshUsage?: boolean }) => {
    for (const host of items) void refreshHost(host, opts);
  }, [refreshHost]);

  // Pull-to-refresh: awaits every host so the spinner stays until the slowest
  // one settles (refreshHost swallows its own errors, so this never rejects).
  const onPullRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all(hosts.map((host) => refreshHost(host, { freshUsage: true })));
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
    if (!offer.endpoint || !offer.token) throw new Error(i18n.t('home.pairingMissingFields'));
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
    setScannerBusy(false);
    setScannerError(null);
    if (!permission?.granted) {
      const result = await requestPermission();
      if (!result.granted) {
        setManualOpen(true);
        return;
      }
    }
    setScannerOpen(true);
  };

  const handleScannedPayload = (data: string) => {
    if (scannedRef.current || scannerBusy) return;
    scannedRef.current = true;
    setScannerBusy(true);
    setScannerError(null);
    pairFromPayload(data).catch((error) => {
      scannedRef.current = false;
      setScannerBusy(false);
      setScannerError(error instanceof Error ? error.message : String(error));
    });
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
    Alert.alert(i18n.t('home.removeDesktopTitle'), i18n.t('home.removeDesktopMessage', { name: host.instanceName ?? host.endpoint }), [
      { text: i18n.t('common.cancel'), style: 'cancel' },
      {
        text: i18n.t('common.remove'),
        style: 'destructive',
        onPress: async () => {
          // Tell the desktop to forget our push token (while still connected) so
          // it stops sending background notifications, then drop the live
          // connection: removing only from storage leaves the client-manager entry
          // alive, so it keeps the socket open (and keeps reconnecting + presenting
          // notifications) for a desktop the user just removed. dropHost closes the
          // socket and tears down the listener.
          await manager.unregisterPush(host.id);
          manager.dropHost(host.id);
          const next = await removeHost(host.id);
          // No desktops left: tear down push registration entirely so any desktop
          // that was offline at removal self-cleans via DeviceNotRegistered on its
          // next push, instead of waiting out the token TTL.
          if (next.length === 0) await unregisterFromPushAsync();
          setHosts(next);
          setSnapshots((current) => {
            const copy = { ...current };
            delete copy[host.id];
            return copy;
          });
        },
      },
    ]);
  }, [manager]);

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
        title: t('home.heroNeedInput', { count: counts.needInput }),
        subtitle: t('home.heroNeedInputSubtitle'),
      };
    }
    if (counts.working > 0) {
      return {
        tone: 'working' as const,
        title: t('home.heroWorking', { count: counts.working }),
        subtitle: t('home.heroWorkingSubtitle'),
      };
    }
    if (sortedSnapshots.some((snapshot) => snapshot.state === 'connecting')) {
      return {
        tone: 'connecting' as const,
        title: t('home.heroConnecting'),
        subtitle: t('home.heroConnectingSubtitle'),
      };
    }
    if (sortedSnapshots.length === 0) {
      return {
        tone: 'empty' as const,
        title: t('home.heroEmpty'),
        subtitle: t('home.heroEmptySubtitle'),
      };
    }
    return {
      tone: 'quiet' as const,
      title: t('home.heroQuiet'),
      subtitle: t('home.heroQuietSubtitle'),
    };
  }, [counts.needInput, counts.working, sortedSnapshots, t]);

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
            <Pressable style={styles.iconButton} onPress={() => router.push('/settings' as Parameters<typeof router.push>[0])} accessibilityLabel={t('home.settings')}>
              <Settings color={COLORS.muted} size={18} />
            </Pressable>
            <Pressable style={styles.iconButton} onPress={() => refreshAll(hosts, { freshUsage: true })} accessibilityLabel={t('common.refresh')}>
              <RefreshCw color={COLORS.muted} size={18} />
            </Pressable>
          </View>
        </View>

        <Animated.View
          entering={reduceMotion ? undefined : FadeInDown.duration(220).springify().damping(18).stiffness(180)}
          layout={reduceMotion ? undefined : LinearTransition.duration(180)}
          style={[styles.statusHero, homeStatus.tone === 'attention' && styles.statusHeroAttention]}
        >
          <Text style={styles.statusEyebrow}>{t('home.today')}</Text>
          <Text style={styles.statusTitle}>{homeStatus.title}</Text>
          <Text style={styles.statusSubtitle}>{homeStatus.subtitle}</Text>
        </Animated.View>

        <View style={[styles.quickRow, sortedSnapshots.length > 0 && styles.quickRowCompact]}>
          <Pressable style={({ pressed }) => [styles.quickTile, sortedSnapshots.length > 0 && styles.quickTileCompact, pressed && styles.pressed]} onPress={openScanner}>
            <QrCode color={COLORS.muted} size={20} />
            <Text style={styles.quickText}>{t('home.pairDesktop')}</Text>
          </Pressable>
          <Pressable style={({ pressed }) => [styles.quickTile, sortedSnapshots.length > 0 && styles.quickTileCompact, pressed && styles.pressed]} onPress={() => setManualOpen(true)}>
            <Plus color={COLORS.muted} size={20} />
            <Text style={styles.quickText}>{t('home.enterCode')}</Text>
          </Pressable>
        </View>

        {attention.length > 0 && (
          <Animated.View
            entering={reduceMotion ? undefined : FadeInDown.delay(60).duration(220)}
            layout={reduceMotion ? undefined : LinearTransition.duration(180)}
          >
            <View style={styles.sectionHeaderRow}>
              <Text style={[styles.sectionLabel, styles.sectionLabelFlush]}>{t('home.needsAttention')}</Text>
              <Pressable onPress={clearAllAttention} hitSlop={8} accessibilityLabel={t('home.clearAll')}>
                <Text style={styles.clearAll}>{t('home.clearAll')}</Text>
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
          <StatusPill value={String(counts.needInput)} label={t('home.pillNeedInput')} emphasis={counts.needInput > 0 ? 'alert' : undefined} />
          <StatusPill value={String(counts.working)} label={t('home.pillWorking')} />
          <StatusPill value={String(counts.total)} label={t('home.metricAgents')} />
        </Animated.View>

        <Text style={styles.sectionLabel}>{t('home.desktops')}</Text>
        {sortedSnapshots.length === 0 ? (
          <Pressable style={({ pressed }) => [styles.emptyCard, pressed && styles.pressed]} onPress={openScanner}>
            <View style={styles.iconTile}>
              <QrCode color={COLORS.muted} size={22} />
            </View>
            <View style={styles.rowBody}>
              <Text style={styles.rowTitle}>{t('home.pairABraidDesktop')}</Text>
              <Text style={styles.rowSubtitle} numberOfLines={2}>
                {t('home.pairEmptyHintLong')}
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
                title={snapshot.status?.instanceName ?? snapshot.host.instanceName ?? t('home.braidDesktop')}
                dotColor={verdictError ? verdictColor(verdict, COLORS) : stateDotColor(snapshot.state, COLORS)}
                subtitle={verdictError ? verdict.label : desktopSubtitle(snapshot)}
                onPress={() => router.push(`/host/${encodeURIComponent(snapshot.host.id)}`)}
                onLongPress={() => removeDesktop(snapshot.host)}
                trailingAction={
                  <Pressable
                    style={({ pressed }) => [styles.removeButton, pressed && styles.pressed]}
                    onPress={() => removeDesktop(snapshot.host)}
                    hitSlop={8}
                    accessibilityLabel={t('home.removeNamed', { name: snapshot.status?.instanceName ?? snapshot.host.instanceName ?? t('home.braidDesktop') })}
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
            <Text style={styles.troubleshootText}>{t('home.connectionTrouble')}</Text>
          </Pressable>
        )}

        {usageHosts.length > 0 && (
          <>
            <Text style={styles.sectionLabel}>{t('home.usage')}</Text>
            {usageHosts.map((snapshot) => (
              <View key={snapshot.host.id} style={styles.usageBlock}>
                {usageHosts.length > 1 && (
                  <Text style={styles.usageHostLabel} numberOfLines={1}>
                    {snapshot.status?.instanceName ?? snapshot.host.instanceName ?? t('home.braidDesktop')}
                  </Text>
                )}
                <RateLimitSection state={snapshot.rateLimits!} now={Date.now()} />
              </View>
            ))}
          </>
        )}

        {unpairedNearby.length > 0 && (
          <>
            <Text style={styles.sectionLabel}>{t('home.nearby')}</Text>
            {unpairedNearby.map((found) => (
              <RowCard
                key={found.id}
                icon={<Wifi color={COLORS.muted} size={22} />}
                title={found.name}
                subtitle={t('home.tapToScanPairingCode')}
                onPress={openScanner}
              />
            ))}
          </>
        )}

        {bonjourError && discoveredHosts.length === 0 && (
          <Text style={styles.footnote}>{t('home.localDiscoveryUnavailable')}</Text>
        )}
      </ScrollView>

      <Modal visible={scannerOpen} animationType="slide" onRequestClose={() => setScannerOpen(false)}>
        <SafeAreaProvider>
          <View style={styles.scanner}>
            <CameraView
              style={StyleSheet.absoluteFill}
              facing="back"
              barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
              onBarcodeScanned={({ data }) => handleScannedPayload(data)}
            />
            <SafeAreaView style={styles.scannerOverlay}>
              <View style={styles.scannerHeader}>
                <View style={styles.scannerHeaderText}>
                  <Text style={styles.scannerEyebrow}>{t('home.pairDesktop')}</Text>
                  <Text style={styles.scannerTitle}>{t('home.scanQrCode')}</Text>
                </View>
                <Pressable style={styles.scannerCloseButton} onPress={() => setScannerOpen(false)} accessibilityLabel={t('home.closeScanner')}>
                  <X color="#FFFFFF" size={20} />
                </Pressable>
              </View>
              <View style={styles.scannerCenter}>
                <View style={styles.scanFrame}>
                  <View style={[styles.scanCorner, styles.scanCornerTopLeft]} />
                  <View style={[styles.scanCorner, styles.scanCornerTopRight]} />
                  <View style={[styles.scanCorner, styles.scanCornerBottomLeft]} />
                  <View style={[styles.scanCorner, styles.scanCornerBottomRight]} />
                  {scannerBusy && (
                    <View style={styles.scannerBusy}>
                      <RefreshCw color="#FFFFFF" size={20} />
                      <Text style={styles.scannerBusyText}>{t('home.pairing')}</Text>
                    </View>
                  )}
                </View>
              </View>
              <View style={styles.scannerPanel}>
                <View style={styles.scannerPanelTop}>
                  <View style={styles.scannerPanelIcon}>
                    <QrCode color={COLORS.text} size={20} />
                  </View>
                  <View style={styles.scannerPanelBody}>
                    <Text style={styles.scannerPanelTitle}>{t('home.desktopSettingsMobile')}</Text>
                    <Text style={styles.scannerPanelText}>{t('home.keepQrInFrame')}</Text>
                  </View>
                  <Pressable
                    style={styles.scannerManualButton}
                    onPress={() => {
                      setScannerOpen(false);
                      setManualOpen(true);
                    }}
                    accessibilityLabel={t('home.enterPairingCodeManually')}
                  >
                    <Text style={styles.scannerManualText}>{t('home.enter')}</Text>
                  </Pressable>
                </View>
                {scannerError && (
                  <View style={styles.scannerError}>
                    <Text style={styles.scannerErrorText} numberOfLines={2}>{scannerError}</Text>
                    <Pressable
                      style={styles.scannerRetryButton}
                      onPress={() => {
                        scannedRef.current = false;
                        setScannerError(null);
                      }}
                    >
                      <Text style={styles.scannerRetryText}>{t('common.retry')}</Text>
                    </Pressable>
                  </View>
                )}
              </View>
            </SafeAreaView>
          </View>
        </SafeAreaProvider>
      </Modal>

      <Modal visible={manualOpen} transparent animationType="fade" onRequestClose={() => setManualOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.manualPanel}>
            <View style={styles.manualHeader}>
              <Text style={styles.modalTitle}>{t('home.enterPairingPayload')}</Text>
              <Pressable onPress={() => setManualOpen(false)} accessibilityLabel={t('home.closeManualPairing')}>
                <X color={COLORS.text} size={20} />
              </Pressable>
            </View>
            <TextInput
              value={manualPayload}
              onChangeText={setManualPayload}
              placeholder={t('home.pasteQrPayload')}
              placeholderTextColor={COLORS.subtle}
              multiline
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.input}
            />
            <Pressable
              style={styles.primaryButton}
              onPress={() => pairFromPayload(manualPayload).catch((error) => {
                Alert.alert(t('home.pairingFailed'), error instanceof Error ? error.message : String(error));
              })}
            >
              <Wifi color={COLORS.text} size={18} />
              <Text style={styles.primaryButtonText}>{t('home.connect')}</Text>
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
    i18n.t('home.agent')
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
  const state = terminal.status === 'waiting' ? i18n.t('home.subtitleNeedsInput') : i18n.t('home.subtitleFinished');
  return [branch, state].filter(Boolean).join(' · ');
}

function homeHostName(snapshot: HostSnapshot): string {
  return snapshot.status?.instanceName ?? snapshot.host.instanceName ?? i18n.t('home.braidDesktop');
}

function homeHostNameById(snapshots: HostSnapshot[], hostId: string): string | null {
  const snapshot = snapshots.find((item) => item.host.id === hostId);
  return snapshot ? homeHostName(snapshot) : null;
}

function formatActivityTime(timestamp?: number): string | null {
  if (!timestamp) return null;
  const diffMs = Date.now() - timestamp;
  if (diffMs < 0) return null;
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return i18n.t('home.justNow');
  if (minutes < 60) return i18n.t('home.minutesAgo', { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return i18n.t('home.hoursAgo', { count: hours });
  return i18n.t('home.daysAgo', { count: Math.floor(hours / 24) });
}

function activityToneColor(tone: RecentActivityItem['tone'], c: Palette): string {
  if (tone === 'waiting') return c.warning;
  if (tone === 'running') return c.accent;
  if (tone === 'done') return c.success;
  return c.danger;
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
  if (snapshot.state === 'connecting') return i18n.t('home.connecting');
  if (snapshot.state === 'offline') return snapshot.error ?? i18n.t('home.offline');
  if (snapshot.state === 'idle') return i18n.t('home.tapToConnect');
  const projects = snapshot.status?.projects.length ?? 0;
  return [
    i18n.t('home.connected'),
    i18n.t('home.projectCount', { count: projects }),
    i18n.t('home.agentCount', { count: snapshot.terminals.length }),
  ].join(' · ');
}

function compactProviderSummary(provider: ProviderRateLimits, now: number): {
  value: string;
  meta: string;
  color: (c: Palette) => string;
} {
  const display = describeProvider(provider);
  if (display.kind === 'message') {
    return {
      value: display.tone === 'error' ? 'Issue' : 'Check',
      meta: display.text,
      color: (c) => (display.tone === 'error' ? c.danger : c.muted),
    };
  }

  const windows = display.windows
    .map((window) => ({ window, left: percentLeft(window) }))
    .sort((a, b) => a.left - b.left);
  const tightest = windows[0];
  const reset = formatResetIn(tightest.window.resetsAt, now);
  const left = tightest.left;
  const meta = [
    left <= 20 ? 'Very low quota' : left <= 40 ? 'Low quota' : 'Healthy',
    reset,
    display.stale ? 'cached' : null,
  ].filter(Boolean).join(' · ');
  return {
    value: `${left}%`,
    meta,
    color: (c) => (left <= 20 ? c.danger : left <= 40 ? c.warning : c.muted),
  };
}

function makeFreshStyles(COLORS: Palette) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: COLORS.bg },
    shell: { flex: 1 },
    content: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 44 },
    meshLayer: {
      position: 'absolute',
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      overflow: 'hidden',
    },
    meshHalo: {
      position: 'absolute',
      top: 28,
      right: -82,
      width: 236,
      height: 236,
      borderRadius: 118,
      borderWidth: 1,
    },
    meshLine: {
      position: 'absolute',
      height: 1,
      opacity: 0.09,
    },
    meshLineA: {
      top: 96,
      left: 34,
      width: 260,
      transform: [{ rotate: '18deg' }],
    },
    meshLineB: {
      top: 224,
      right: -24,
      width: 280,
      transform: [{ rotate: '-22deg' }],
    },
    meshLineC: {
      top: 398,
      left: -54,
      width: 330,
      transform: [{ rotate: '-10deg' }],
    },
    meshSignal: {
      position: 'absolute',
      height: 1,
      width: 160,
      borderRadius: 1,
    },
    meshSignalA: {
      top: 158,
      right: 28,
      transform: [{ rotate: '-20deg' }],
    },
    meshSignalB: {
      top: 100,
      left: 72,
      transform: [{ rotate: '18deg' }],
    },
    meshSignalC: {
      top: 420,
      left: 24,
      width: 126,
      transform: [{ rotate: '-10deg' }],
    },
    meshNode: {
      position: 'absolute',
      width: 11,
      height: 11,
      borderRadius: 6,
      borderWidth: 1,
      backgroundColor: COLORS.bg,
    },
    meshNodeStatic: {
      position: 'absolute',
      width: 9,
      height: 9,
      borderRadius: 5,
      borderWidth: 1,
      opacity: 0.14,
      backgroundColor: COLORS.bg,
    },
    meshNodeA: { top: 84, left: 32 },
    meshNodeB: { top: 176, right: 44 },
    meshNodeC: { top: 390, left: 122 },
    meshNodeD: { top: 286, right: 86 },
    topBar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 16,
      minHeight: 48,
      marginBottom: 18,
    },
    titleBlock: { flex: 1, minWidth: 0 },
    appTitle: { color: COLORS.text, fontSize: 28, lineHeight: 32, fontWeight: '700' },
    appStatus: { color: COLORS.muted, fontSize: 13, lineHeight: 18, marginTop: 2 },
    kicker: {
      color: COLORS.subtle,
      fontSize: 11,
      fontWeight: '800',
      letterSpacing: 0.8,
      textTransform: 'uppercase',
      marginBottom: 8,
    },
    bigTitle: {
      color: COLORS.text,
      fontSize: 36,
      lineHeight: 40,
      fontWeight: '900',
    },
    topActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    squareButton: {
      width: 36,
      height: 36,
      borderRadius: 6,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: COLORS.panel,
      borderWidth: 1,
      borderColor: COLORS.border,
    },
    commandBand: {
      minHeight: 42,
      flexDirection: 'row',
      alignItems: 'stretch',
      borderBottomWidth: 1,
      borderColor: COLORS.border,
      marginTop: -4,
    },
    commandMetric: {
      flex: 1,
      justifyContent: 'center',
      paddingVertical: 6,
    },
    commandValue: { color: COLORS.text, fontSize: 15, fontWeight: '600', lineHeight: 19 },
    commandLabel: {
      color: COLORS.muted,
      fontSize: 11,
      fontWeight: '500',
      marginTop: 1,
    },
    actionRail: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginTop: 10,
    },
    actionButton: {
      flex: 1,
      minHeight: 44,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 7,
      borderRadius: 8,
      backgroundColor: COLORS.panelStrong,
      borderWidth: 1,
      borderColor: COLORS.border,
      paddingHorizontal: 10,
    },
    actionText: { color: COLORS.text, fontSize: 13, fontWeight: '600' },
    section: { marginTop: 28 },
    sectionTitle: {
      color: COLORS.subtle,
      fontSize: 12,
      fontWeight: '600',
      letterSpacing: 0.4,
      textTransform: 'uppercase',
      marginBottom: 6,
    },
    sectionHeaderRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 6,
    },
    sectionTitleFlush: { marginBottom: 0 },
    clearAction: { color: COLORS.accent, fontSize: 13, fontWeight: '600' },
    focusCard: {
      minHeight: 58,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingVertical: 10,
      borderBottomWidth: 1,
      borderBottomColor: COLORS.border,
    },
    focusMarker: { width: 4, alignSelf: 'stretch', borderRadius: 2 },
    rowBody: { flex: 1, minWidth: 0 },
    focusTitle: { color: COLORS.text, fontSize: 16, fontWeight: '600' },
    focusMeta: { color: COLORS.muted, fontSize: 13, marginTop: 4 },
    activitySection: { marginTop: 20 },
    activityList: {
      borderTopWidth: 1,
      borderBottomWidth: 1,
      borderColor: COLORS.border,
    },
    activityRow: {
      minHeight: 40,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingVertical: 6,
    },
    activityRowDivider: {
      borderTopWidth: 1,
      borderTopColor: COLORS.border,
    },
    activityDot: { width: 6, height: 6, borderRadius: 3 },
    activityTitle: { color: COLORS.text, fontSize: 13, fontWeight: '600' },
    activityMeta: { color: COLORS.muted, fontSize: 11, marginTop: 1 },
    emptyPanel: {
      minHeight: 146,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: COLORS.border,
      backgroundColor: COLORS.panel,
      padding: 14,
      gap: 14,
    },
    emptyHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    emptyIcon: {
      width: 42,
      height: 42,
      borderRadius: 8,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: COLORS.border,
      backgroundColor: COLORS.panelStrong,
    },
    emptyTitle: { color: COLORS.text, fontSize: 16, fontWeight: '600' },
    emptyText: { color: COLORS.muted, fontSize: 13, lineHeight: 18, marginTop: 3 },
    emptyActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    emptyPrimaryAction: {
      flex: 1,
      minHeight: 42,
      borderRadius: 8,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 7,
      backgroundColor: COLORS.accent,
      paddingHorizontal: 10,
    },
    emptySecondaryAction: {
      flex: 1,
      minHeight: 42,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: COLORS.border,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 7,
      backgroundColor: COLORS.panelStrong,
      paddingHorizontal: 10,
    },
    emptyPrimaryText: { color: '#FFFFFF', fontSize: 13, fontWeight: '800' },
    emptySecondaryText: { color: COLORS.text, fontSize: 13, fontWeight: '800' },
    desktopRow: {
      minHeight: 64,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingVertical: 10,
      borderBottomWidth: 1,
      borderBottomColor: COLORS.border,
    },
    desktopIcon: {
      width: 34,
      height: 34,
      borderRadius: 6,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: COLORS.bg,
      borderWidth: 1,
      borderColor: COLORS.border,
    },
    desktopTitle: { color: COLORS.text, fontSize: 16, fontWeight: '600' },
    desktopMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 5 },
    desktopMeta: { color: COLORS.muted, fontSize: 13, flexShrink: 1 },
    statusDot: { width: 8, height: 8, borderRadius: 4 },
    usageBlock: { marginTop: 8 },
    usageHostLabel: { color: COLORS.muted, fontSize: 12, fontWeight: '600', marginBottom: 6 },
    compactUsage: {
      borderTopWidth: 1,
      borderBottomWidth: 1,
      borderColor: COLORS.border,
      marginTop: 2,
    },
    compactUsageRow: {
      minHeight: 48,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingVertical: 7,
    },
    compactUsageDivider: { borderTopWidth: 1, borderTopColor: COLORS.border },
    compactUsageIcon: {
      width: 30,
      height: 30,
      borderRadius: 8,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: COLORS.panel,
      borderWidth: 1,
      borderColor: COLORS.border,
    },
    compactUsageTitle: { color: COLORS.text, fontSize: 14, fontWeight: '700' },
    compactUsageMeta: { color: COLORS.muted, fontSize: 12, marginTop: 2 },
    compactUsageValue: { minWidth: 42, textAlign: 'right', fontSize: 13, fontWeight: '800' },
    usageDetails: { marginTop: 10 },
    scanner: { flex: 1, backgroundColor: '#000000' },
    scannerOverlay: {
      flex: 1,
      justifyContent: 'space-between',
      paddingHorizontal: 18,
      paddingTop: 10,
      paddingBottom: 18,
      backgroundColor: 'rgba(0, 0, 0, 0.22)',
    },
    scannerHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 14 },
    scannerEyebrow: {
      color: 'rgba(255, 255, 255, 0.72)',
      fontSize: 11,
      fontWeight: '800',
      letterSpacing: 0.8,
      textTransform: 'uppercase',
      marginBottom: 3,
    },
    scannerTitle: { color: '#FFFFFF', fontSize: 24, fontWeight: '900' },
    scannerCloseButton: {
      width: 42,
      height: 42,
      borderRadius: 8,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      borderWidth: 1,
      borderColor: 'rgba(255, 255, 255, 0.2)',
    },
    scannerCenter: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    scanFrame: {
      width: 260,
      height: 260,
      borderRadius: 8,
      borderWidth: 2,
      borderColor: '#FFFFFF',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'rgba(0, 0, 0, 0.08)',
    },
    scannerBusyText: {
      color: '#FFFFFF',
      fontSize: 14,
      fontWeight: '900',
      backgroundColor: 'rgba(0, 0, 0, 0.6)',
      borderRadius: 8,
      paddingHorizontal: 14,
      paddingVertical: 10,
      overflow: 'hidden',
    },
    scannerPanel: {
      borderRadius: 8,
      borderWidth: 1,
      borderColor: COLORS.border,
      backgroundColor: COLORS.panel,
      padding: 14,
    },
    scannerPanelTitle: { color: COLORS.text, fontSize: 15, fontWeight: '900' },
    scannerPanelText: { color: COLORS.muted, fontSize: 13, lineHeight: 18, marginTop: 4 },
    scannerErrorText: { color: COLORS.danger, fontSize: 12, lineHeight: 17, marginTop: 10 },
    scannerManualButton: {
      alignSelf: 'flex-start',
      minHeight: 36,
      justifyContent: 'center',
      borderRadius: 8,
      marginTop: 12,
      paddingHorizontal: 12,
      backgroundColor: COLORS.panelStrong,
      borderWidth: 1,
      borderColor: COLORS.border,
    },
    scannerManualText: { color: COLORS.text, fontSize: 13, fontWeight: '900' },
    modalBackdrop: {
      flex: 1,
      justifyContent: 'center',
      backgroundColor: 'rgba(0, 0, 0, 0.68)',
      padding: 18,
    },
    manualPanel: {
      borderRadius: 8,
      borderWidth: 1,
      borderColor: COLORS.border,
      backgroundColor: COLORS.panel,
      padding: 16,
      gap: 14,
    },
    manualHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    modalTitle: { color: COLORS.text, fontSize: 18, fontWeight: '900' },
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
    primaryButtonText: { color: COLORS.text, fontSize: 15, fontWeight: '900' },
  });
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
    scanner: { flex: 1, backgroundColor: '#000000' },
    scannerOverlay: {
      flex: 1,
      justifyContent: 'space-between',
      paddingHorizontal: 18,
      paddingTop: 10,
      paddingBottom: 18,
      backgroundColor: 'rgba(0, 0, 0, 0.18)',
    },
    scannerHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 14 },
    scannerHeaderText: { flex: 1, minWidth: 0 },
    scannerEyebrow: {
      color: 'rgba(255, 255, 255, 0.72)',
      fontSize: 11,
      fontWeight: '800',
      textTransform: 'uppercase',
      letterSpacing: 0.8,
      marginBottom: 3,
    },
    scannerTitle: { color: '#FFFFFF', fontSize: 24, fontWeight: '800' },
    scannerCloseButton: {
      width: 42,
      height: 42,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'rgba(0, 0, 0, 0.46)',
      borderWidth: 1,
      borderColor: 'rgba(255, 255, 255, 0.16)',
    },
    scannerCenter: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    scanFrame: {
      width: 260,
      height: 260,
      borderRadius: 20,
      backgroundColor: 'transparent',
      alignItems: 'center',
      justifyContent: 'center',
    },
    scanCorner: {
      position: 'absolute',
      width: 58,
      height: 58,
      borderColor: '#FFFFFF',
    },
    scanCornerTopLeft: {
      top: 0,
      left: 0,
      borderTopWidth: 4,
      borderLeftWidth: 4,
      borderTopLeftRadius: 20,
    },
    scanCornerTopRight: {
      top: 0,
      right: 0,
      borderTopWidth: 4,
      borderRightWidth: 4,
      borderTopRightRadius: 20,
    },
    scanCornerBottomLeft: {
      bottom: 0,
      left: 0,
      borderBottomWidth: 4,
      borderLeftWidth: 4,
      borderBottomLeftRadius: 20,
    },
    scanCornerBottomRight: {
      right: 0,
      bottom: 0,
      borderRightWidth: 4,
      borderBottomWidth: 4,
      borderBottomRightRadius: 20,
    },
    scannerBusy: {
      minHeight: 46,
      borderRadius: 12,
      paddingHorizontal: 14,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      backgroundColor: 'rgba(0, 0, 0, 0.62)',
      borderWidth: 1,
      borderColor: 'rgba(255, 255, 255, 0.18)',
    },
    scannerBusyText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
    scannerPanel: {
      borderRadius: 16,
      borderWidth: 1,
      borderColor: COLORS.border,
      backgroundColor: COLORS.panel,
      padding: 12,
      gap: 10,
    },
    scannerPanelTop: {
      minHeight: 52,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    scannerPanelIcon: {
      width: 42,
      height: 42,
      borderRadius: 11,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: COLORS.panelStrong,
      borderWidth: 1,
      borderColor: COLORS.border,
    },
    scannerPanelBody: { flex: 1, minWidth: 0 },
    scannerPanelTitle: { color: COLORS.text, fontSize: 14, fontWeight: '800' },
    scannerPanelText: { color: COLORS.muted, fontSize: 12, marginTop: 3 },
    scannerManualButton: {
      minHeight: 36,
      borderRadius: 9,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 12,
      backgroundColor: COLORS.panelStrong,
      borderWidth: 1,
      borderColor: COLORS.border,
    },
    scannerManualText: { color: COLORS.text, fontSize: 13, fontWeight: '800' },
    scannerError: {
      borderRadius: 12,
      borderWidth: 1,
      borderColor: 'rgba(255, 90, 102, 0.35)',
      backgroundColor: 'rgba(255, 90, 102, 0.12)',
      padding: 10,
      gap: 10,
    },
    scannerErrorText: { color: COLORS.text, fontSize: 12, lineHeight: 17 },
    scannerRetryButton: {
      alignSelf: 'flex-start',
      minHeight: 32,
      borderRadius: 8,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 12,
      backgroundColor: COLORS.panelStrong,
    },
    scannerRetryText: { color: COLORS.text, fontSize: 12, fontWeight: '800' },
    scannerHint: {
      color: '#FFFFFF',
      fontSize: 15,
      textAlign: 'center',
      marginBottom: 18,
    },
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
