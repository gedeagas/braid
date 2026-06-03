import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Globe,
  Shield,
  WifiOff,
  XCircle,
} from 'lucide-react-native';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { startDiagnosticFetchTimeout, type DiagnosticFetchTimeout } from '@/diagnostics/diagnostic-fetch-timeout';
import { formatLatency, runLatencyDiagnostic, type LatencyVerdict } from '@/diagnostics/connection-latency';
import { formatEndpoint, testHostReachability } from '@/diagnostics/host-reachability';
import { useClientManager } from '@/transport/client-manager';
import { loadHosts } from '@/transport/host-store';
import { Screen, ScreenHeader } from '@/ui/kit';
import { useTheme, useThemedStyles, type Palette } from '@/ui/theme';

interface CheckResult {
  label: string;
  status: 'pass' | 'fail' | 'warn';
  detail: string;
}

interface CommonIssue {
  id: string;
  icon: React.ReactNode;
  title: string;
  steps: string[];
}

interface DiagState {
  running: boolean;
  done: boolean;
  checks: CheckResult[];
}

type DiagAction =
  | { type: 'start' }
  | { type: 'set'; checks: CheckResult[] }
  | { type: 'finish'; checks: CheckResult[] };

function diagReducer(state: DiagState, action: DiagAction): DiagState {
  switch (action.type) {
    case 'start':
      return { running: true, done: false, checks: [] };
    case 'set':
      return { ...state, checks: action.checks };
    case 'finish':
      return { running: false, done: true, checks: action.checks };
  }
}

function latencyStatus(verdict: LatencyVerdict): CheckResult['status'] {
  if (verdict === 'good') return 'pass';
  if (verdict === 'fair') return 'warn';
  return 'fail';
}

export default function TroubleshootScreen() {
  const { t } = useTranslation();
  const { palette: c } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const manager = useClientManager();
  const [diag, dispatch] = useReducer(diagReducer, { running: false, done: false, checks: [] });
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // Cancellation: diagnostics can outlive the screen. A monotonically-bumped run
  // id lets a stale in-flight run detect it's no longer current and bail.
  const runIdRef = useRef(0);
  const activeFetchRef = useRef<DiagnosticFetchTimeout | null>(null);

  // Diagnostics can outlive the screen. On unmount, bump the run id so any
  // in-flight run sees it's no longer current and bails (no setState on an
  // unmounted component), and dispose the active fetch so its timeout doesn't leak.
  useEffect(() => {
    return () => {
      // Reading the latest ref values at unmount is the whole point here - these
      // are mutable "current run" containers, not rendered nodes - so the
      // exhaustive-deps stale-ref warning doesn't apply.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      runIdRef.current++;
      activeFetchRef.current?.dispose();
    };
  }, []);

  const issues: CommonIssue[] = [
    {
      id: 'wifi',
      icon: <WifiOff size={16} color={c.muted} />,
      title: t('troubleshoot.issues.wifi.title'),
      steps: t('troubleshoot.issues.wifi.steps', { returnObjects: true }) as string[],
    },
    {
      id: 'firewall',
      icon: <Shield size={16} color={c.muted} />,
      title: t('troubleshoot.issues.firewall.title'),
      steps: t('troubleshoot.issues.firewall.steps', { returnObjects: true }) as string[],
    },
    {
      id: 'server',
      icon: <Globe size={16} color={c.muted} />,
      title: t('troubleshoot.issues.server.title'),
      steps: t('troubleshoot.issues.server.steps', { returnObjects: true }) as string[],
    },
    {
      id: 'pairing',
      icon: <Clock size={16} color={c.muted} />,
      title: t('troubleshoot.issues.pairing.title'),
      steps: t('troubleshoot.issues.pairing.steps', { returnObjects: true }) as string[],
    },
  ];

  const runDiagnostics = useCallback(async () => {
    const runId = ++runIdRef.current;
    activeFetchRef.current?.dispose();
    activeFetchRef.current = null;
    dispatch({ type: 'start' });

    const results: CheckResult[] = [];
    const isCurrent = () => runIdRef.current === runId;

    try {
      const hosts = await loadHosts();
      results.push(
        hosts.length > 0
          ? { label: t('troubleshoot.checks.pairedDesktops'), status: 'pass', detail: t('troubleshoot.checks.pairedCount', { count: hosts.length }) }
          : { label: t('troubleshoot.checks.pairedDesktops'), status: 'fail', detail: t('troubleshoot.checks.pairedNone') },
      );
    } catch {
      results.push({ label: t('troubleshoot.checks.pairedDesktops'), status: 'warn', detail: t('troubleshoot.checks.pairedReadError') });
    }
    if (!isCurrent()) return;
    dispatch({ type: 'set', checks: [...results] });

    const internetCheck = startDiagnosticFetchTimeout(5000);
    activeFetchRef.current = internetCheck;
    try {
      const resp = await fetch('https://dns.google/resolve?name=example.com&type=A', { signal: internetCheck.signal });
      if (!isCurrent()) return;
      results.push(
        resp.ok
          ? { label: t('troubleshoot.checks.internet'), status: 'pass', detail: t('troubleshoot.checks.internetConnected') }
          : { label: t('troubleshoot.checks.internet'), status: 'warn', detail: t('troubleshoot.checks.internetUnexpected') },
      );
    } catch {
      if (!isCurrent()) return;
      results.push({ label: t('troubleshoot.checks.internet'), status: 'fail', detail: t('troubleshoot.checks.internetNone') });
    } finally {
      internetCheck.dispose();
      if (activeFetchRef.current === internetCheck) activeFetchRef.current = null;
    }
    if (!isCurrent()) return;
    dispatch({ type: 'set', checks: [...results] });

    try {
      const hosts = await loadHosts();
      for (const host of hosts) {
        if (!isCurrent()) return;
        const reachable = await testHostReachability(host.endpoint);
        if (!isCurrent()) return;
        results.push({
          label: host.instanceName ?? formatEndpoint(host.endpoint),
          status: reachable ? 'pass' : 'fail',
          detail: reachable
            ? t('troubleshoot.checks.reachableAt', { endpoint: formatEndpoint(host.endpoint) })
            : t('troubleshoot.checks.cannotReach', { endpoint: formatEndpoint(host.endpoint) }),
        });
        dispatch({ type: 'set', checks: [...results] });

        if (!isCurrent()) return;
        const client = manager.acquireHost(host);
        const latency = await runLatencyDiagnostic(client);
        if (!isCurrent()) return;
        const hostName = host.instanceName ?? formatEndpoint(host.endpoint);
        results.push({
          label: t('troubleshoot.checks.quality', { name: hostName }),
          status: latencyStatus(latency.verdict),
          detail: latency.error
            ? latency.error
            : t('troubleshoot.checks.qualityDetail', {
                label: t(`troubleshoot.latency.${latency.verdict}`),
                rtt: formatLatency(latency.rttMs),
              }),
        });
        results.push({
          label: t('troubleshoot.checks.handshake', { name: hostName }),
          status: latency.error ? 'fail' : 'pass',
          detail: t('troubleshoot.checks.handshakeDetail', {
            connect: formatLatency(latency.connectMs),
            auth: formatLatency(latency.authMs),
          }),
        });
        dispatch({ type: 'set', checks: [...results] });
      }
    } catch {
      results.push({ label: t('troubleshoot.checks.desktops'), status: 'warn', detail: t('troubleshoot.checks.couldNotTest') });
    }
    if (!isCurrent()) return;

    results.push({ label: t('troubleshoot.checks.platform'), status: 'pass', detail: `${Platform.OS} ${Platform.Version ?? ''}`.trim() });
    dispatch({ type: 'finish', checks: [...results] });
  }, [manager, t]);

  const statusIcon = (status: CheckResult['status']) => {
    if (status === 'pass') return <CheckCircle2 size={15} color={c.success} />;
    if (status === 'fail') return <XCircle size={15} color={c.danger} />;
    return <AlertTriangle size={15} color={c.warning} />;
  };

  return (
    <Screen edges={['top', 'left', 'right']}>
      <ScreenHeader title={t('troubleshoot.title')} back compact style={styles.topRow} />

      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Pressable
          style={({ pressed }) => [styles.runButton, pressed && styles.pressed, diag.running && styles.disabled]}
          onPress={() => void runDiagnostics()}
          disabled={diag.running}
        >
          {diag.running ? <ActivityIndicator size="small" color={c.text} /> : <Activity size={16} color={c.text} />}
          <Text style={styles.runLabel}>
            {diag.running ? t('troubleshoot.running') : diag.done ? t('troubleshoot.runAgain') : t('troubleshoot.runDiagnostics')}
          </Text>
        </Pressable>

        {diag.checks.length > 0 && (
          <View style={styles.section}>
            {diag.checks.map((check, i) => (
              <View key={`${check.label}-${i}`}>
                {i > 0 && <View style={styles.separator} />}
                <View style={styles.checkRow}>
                  {statusIcon(check.status)}
                  <View style={styles.checkText}>
                    <Text style={styles.checkLabel} numberOfLines={1} ellipsizeMode="middle">
                      {check.label}
                    </Text>
                    <Text style={[styles.checkDetail, check.status === 'fail' && { color: c.danger }]} numberOfLines={2}>
                      {check.detail}
                    </Text>
                  </View>
                </View>
              </View>
            ))}
          </View>
        )}

        <Text style={styles.sectionHeading}>{t('troubleshoot.commonIssues')}</Text>
        <View style={styles.section}>
          {issues.map((issue, i) => (
            <View key={issue.id}>
              {i > 0 && <View style={styles.separator} />}
              <Pressable
                style={({ pressed }) => [styles.accordionHeader, pressed && styles.pressed]}
                onPress={() => setExpandedId((prev) => (prev === issue.id ? null : issue.id))}
              >
                {issue.icon}
                <Text style={styles.accordionTitle}>{issue.title}</Text>
                {expandedId === issue.id ? <ChevronUp size={16} color={c.muted} /> : <ChevronDown size={16} color={c.muted} />}
              </Pressable>
              {expandedId === issue.id && (
                <View style={styles.accordionBody}>
                  {issue.steps.map((step, j) => (
                    <View key={j} style={styles.stepRow}>
                      <Text style={styles.bullet}>•</Text>
                      <Text style={styles.stepText}>{step}</Text>
                    </View>
                  ))}
                </View>
              )}
            </View>
          ))}
        </View>
      </ScrollView>
    </Screen>
  );
}

function makeStyles(c: Palette) {
  return StyleSheet.create({
    topRow: { paddingHorizontal: 16, paddingVertical: 10 },
    scroll: { flex: 1 },
    content: { paddingHorizontal: 16, paddingBottom: 40 },
    runButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      minHeight: 46,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.panelStrong,
      marginBottom: 18,
    },
    pressed: { opacity: 0.7 },
    disabled: { opacity: 0.5 },
    runLabel: { color: c.text, fontSize: 14, fontWeight: '800' },
    section: { borderRadius: 10, borderWidth: 1, borderColor: c.border, backgroundColor: c.panel, overflow: 'hidden' },
    separator: { height: 1, backgroundColor: c.border },
    checkRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 11, paddingHorizontal: 14 },
    checkText: { flex: 1, gap: 2 },
    checkLabel: { color: c.text, fontSize: 13, fontWeight: '600' },
    checkDetail: { color: c.muted, fontSize: 12, lineHeight: 16 },
    sectionHeading: {
      color: c.subtle,
      fontSize: 12,
      fontWeight: '800',
      textTransform: 'uppercase',
      letterSpacing: 0.6,
      marginTop: 24,
      marginBottom: 10,
    },
    accordionHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 13, paddingHorizontal: 14 },
    accordionTitle: { flex: 1, color: c.text, fontSize: 14, fontWeight: '600' },
    accordionBody: { paddingHorizontal: 14, paddingBottom: 12, gap: 6 },
    stepRow: { flexDirection: 'row', gap: 8, paddingRight: 8 },
    bullet: { color: c.subtle, fontSize: 13, lineHeight: 18 },
    stepText: { flex: 1, color: c.muted, fontSize: 13, lineHeight: 18 },
  });
}
