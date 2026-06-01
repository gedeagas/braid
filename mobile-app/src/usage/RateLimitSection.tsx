import { StyleSheet, Text, View } from 'react-native';

import { AgentIcon } from '@/terminal/AgentIcon';
import type { ProviderRateLimits, RateLimitState, RateLimitWindow } from '@/transport/types';
import { colors } from '@/ui/theme';

import {
  barColor,
  describeProvider,
  formatResetIn,
  percentLeft,
  providerName,
  windowLabel,
} from './rate-limit-format';

interface Props {
  state: RateLimitState;
  /** Current time, injected so the section re-derives reset countdowns on refresh. */
  now: number;
}

/**
 * Claude / Codex usage card for the home screen. Shows the same session (5h) and
 * weekly windows the desktop status bar does, plus a clear status line when a
 * CLI is installed without a plan or its usage can't be read.
 */
export function RateLimitSection({ state, now }: Props) {
  const providers = [state.claude, state.codex].filter(
    (provider): provider is ProviderRateLimits => provider != null,
  );
  if (providers.length === 0) return null;

  return (
    <View style={styles.card}>
      {providers.map((provider, index) => (
        <View key={provider.provider}>
          {index > 0 && <View style={styles.divider} />}
          <ProviderRow provider={provider} now={now} />
        </View>
      ))}
    </View>
  );
}

function ProviderRow({ provider, now }: { provider: ProviderRateLimits; now: number }) {
  const display = describeProvider(provider);
  return (
    <View style={styles.provider}>
      <View style={styles.providerHead}>
        <View style={styles.providerIcon}>
          <AgentIcon agentId={provider.provider} size={18} />
        </View>
        <Text style={styles.providerName}>{providerName(provider.provider)}</Text>
        {display.kind === 'windows' && display.stale && (
          <Text style={styles.staleTag}>cached</Text>
        )}
      </View>

      {display.kind === 'message' ? (
        <Text style={[styles.message, display.tone === 'error' && styles.messageError]} numberOfLines={2}>
          {display.text}
        </Text>
      ) : (
        <View style={styles.windows}>
          {display.windows.map((window) => (
            <WindowBar key={window.windowMinutes} window={window} now={now} />
          ))}
        </View>
      )}
    </View>
  );
}

function WindowBar({ window, now }: { window: RateLimitWindow; now: number }) {
  const left = percentLeft(window);
  const resetIn = formatResetIn(window.resetsAt, now);
  return (
    <View style={styles.window}>
      <View style={styles.windowTop}>
        <Text style={styles.windowLabel}>{windowLabel(window.windowMinutes)}</Text>
        <Text style={styles.windowPercent}>{left}% left</Text>
      </View>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${left}%`, backgroundColor: barColor(left) }]} />
      </View>
      {resetIn && <Text style={styles.reset}>{resetIn}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panel,
    padding: 14,
  },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: 14 },
  provider: { gap: 12 },
  providerHead: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  providerIcon: {
    width: 30,
    height: 30,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.panelStrong,
    borderWidth: 1,
    borderColor: colors.border,
  },
  providerName: { color: colors.text, fontSize: 15, fontWeight: '700', flex: 1 },
  staleTag: {
    color: colors.subtle,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  message: { color: colors.muted, fontSize: 13, lineHeight: 18 },
  messageError: { color: colors.danger },
  windows: { gap: 12 },
  window: { gap: 6 },
  windowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  windowLabel: { color: colors.muted, fontSize: 12, fontWeight: '600' },
  windowPercent: { color: colors.text, fontSize: 12, fontWeight: '700' },
  track: {
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.panelStrong,
    overflow: 'hidden',
  },
  fill: { height: '100%', borderRadius: 4 },
  reset: { color: colors.subtle, fontSize: 11 },
});
