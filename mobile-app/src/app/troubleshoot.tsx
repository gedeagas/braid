import { router } from 'expo-router';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronUp,
  Clock,
  Globe,
  Shield,
  WifiOff,
  XCircle,
} from 'lucide-react-native';
import { useCallback, useReducer, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { startDiagnosticFetchTimeout, type DiagnosticFetchTimeout } from '@/diagnostics/diagnostic-fetch-timeout';
import { formatEndpoint, testHostReachability } from '@/diagnostics/host-reachability';
import { loadHosts } from '@/transport/host-store';
import { Screen } from '@/ui/kit';
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

export default function TroubleshootScreen() {
  const { palette: c } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [diag, dispatch] = useReducer(diagReducer, { running: false, done: false, checks: [] });
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // Cancellation: diagnostics can outlive the screen. A monotonically-bumped run
  // id lets a stale in-flight run detect it's no longer current and bail.
  const runIdRef = useRef(0);
  const activeFetchRef = useRef<DiagnosticFetchTimeout | null>(null);

  const issues: CommonIssue[] = [
    {
      id: 'wifi',
      icon: <WifiOff size={16} color={c.muted} />,
      title: 'Different Wi-Fi networks',
      steps: [
        'Phone and desktop must be on the same local network.',
        'Ethernet and Wi-Fi must share the same subnet.',
        'Toggle Wi-Fi off and on, then reconnect.',
      ],
    },
    {
      id: 'firewall',
      icon: <Shield size={16} color={c.muted} />,
      title: 'Firewall or AP isolation',
      steps: [
        'A macOS firewall can block the Braid mobile server - allow incoming connections.',
        'Guest / public Wi-Fi often isolates clients so devices can’t see each other.',
        'Try a personal hotspot to rule the network out.',
      ],
    },
    {
      id: 'server',
      icon: <Globe size={16} color={c.muted} />,
      title: 'Server not running',
      steps: [
        'Open desktop Settings › Mobile and confirm the server is started.',
        'Re-scan the QR code if the desktop was restarted.',
      ],
    },
    {
      id: 'pairing',
      icon: <Clock size={16} color={c.muted} />,
      title: 'Pairing rejected',
      steps: [
        'If you see “Pairing rejected”, the device token was revoked.',
        'Remove the desktop and re-pair from desktop Settings › Mobile.',
      ],
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
          ? { label: 'Paired desktops', status: 'pass', detail: `${hosts.length} paired` }
          : { label: 'Paired desktops', status: 'fail', detail: 'None - scan a QR to pair' },
      );
    } catch {
      results.push({ label: 'Paired desktops', status: 'warn', detail: 'Could not read host data' });
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
          ? { label: 'Internet', status: 'pass', detail: 'Connected' }
          : { label: 'Internet', status: 'warn', detail: 'Unexpected response' },
      );
    } catch {
      if (!isCurrent()) return;
      results.push({ label: 'Internet', status: 'fail', detail: 'No connection' });
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
          detail: reachable ? `Reachable at ${formatEndpoint(host.endpoint)}` : `Cannot reach ${formatEndpoint(host.endpoint)}`,
        });
        dispatch({ type: 'set', checks: [...results] });
      }
    } catch {
      results.push({ label: 'Desktops', status: 'warn', detail: 'Could not test' });
    }
    if (!isCurrent()) return;

    results.push({ label: 'Platform', status: 'pass', detail: `${Platform.OS} ${Platform.Version ?? ''}`.trim() });
    dispatch({ type: 'finish', checks: [...results] });
  }, []);

  const statusIcon = (status: CheckResult['status']) => {
    if (status === 'pass') return <CheckCircle2 size={15} color={c.success} />;
    if (status === 'fail') return <XCircle size={15} color={c.danger} />;
    return <AlertTriangle size={15} color={c.warning} />;
  };

  return (
    <Screen edges={['top', 'left', 'right']}>
      <View style={styles.topRow}>
        <Pressable style={styles.back} onPress={() => router.back()} accessibilityLabel="Back">
          <ChevronLeft size={22} color={c.text} />
        </Pressable>
        <Text style={styles.heading}>Troubleshooting</Text>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Pressable
          style={({ pressed }) => [styles.runButton, pressed && styles.pressed, diag.running && styles.disabled]}
          onPress={() => void runDiagnostics()}
          disabled={diag.running}
        >
          {diag.running ? <ActivityIndicator size="small" color={c.text} /> : <Activity size={16} color={c.text} />}
          <Text style={styles.runLabel}>{diag.running ? 'Running…' : diag.done ? 'Run again' : 'Run diagnostics'}</Text>
        </Pressable>

        {diag.checks.length > 0 && (
          <View style={styles.section}>
            {diag.checks.map((check, i) => (
              <View key={`${check.label}-${i}`}>
                {i > 0 && <View style={styles.separator} />}
                <View style={styles.checkRow}>
                  {statusIcon(check.status)}
                  <Text style={styles.checkLabel} numberOfLines={1}>
                    {check.label}
                  </Text>
                  <Text style={[styles.checkDetail, check.status === 'fail' && { color: c.danger }]} numberOfLines={1}>
                    {check.detail}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        )}

        <Text style={styles.sectionHeading}>Common issues</Text>
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
    topRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, paddingVertical: 10 },
    back: { width: 36, height: 36, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
    heading: { color: c.text, fontSize: 20, fontWeight: '800' },
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
    checkRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 11, paddingHorizontal: 14 },
    checkLabel: { color: c.text, fontSize: 13, fontWeight: '600' },
    checkDetail: { flex: 1, textAlign: 'right', color: c.muted, fontSize: 12 },
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
