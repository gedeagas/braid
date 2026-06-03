import { useEffect } from 'react';
import { View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import type { BraidTerminal } from '@/transport/types';
import { useTheme, type Palette } from '@/ui/theme';

/**
 * Per-worktree agent activity, mirroring the desktop sidebar's status dot. The
 * desktop ranks permission > working > done > active > inactive; we mirror that
 * (waiting is mobile's name for the desktop "permission/needs-input" state, and
 * the desktop normalizes "blocked" -> "waiting" before it reaches mobile).
 */
export type AgentDotStatus = 'waiting' | 'working' | 'done' | 'active' | 'idle';

// Higher wins when a worktree has terminals in several states at once. NOTE this
// is the COLOR priority (working outranks done, matching the desktop dot), which
// deliberately differs from the host screen's SORT priority (done outranks
// working, so finished work floats up for review).
const PRIORITY: Record<AgentDotStatus, number> = {
  waiting: 5,
  working: 4,
  done: 3,
  active: 2,
  idle: 1,
};

/** Collapse a worktree's terminals into a single status for its dot. */
export function worktreeAgentStatus(terminals: BraidTerminal[]): AgentDotStatus {
  // Terminals present but unclassified == "active" (a shell/agent is open but not
  // reporting work), distinct from "idle" (no terminals at all).
  let best: AgentDotStatus = terminals.length > 0 ? 'active' : 'idle';
  for (const t of terminals) {
    const s: AgentDotStatus | null =
      t.status === 'waiting' ? 'waiting' : t.status === 'working' ? 'working' : t.status === 'done' ? 'done' : null;
    if (s && PRIORITY[s] > PRIORITY[best]) best = s;
  }
  return best;
}

/** Solid color for a status, shared by the dot and the count badge tint. */
export function agentStatusColor(status: AgentDotStatus, c: Palette): string {
  switch (status) {
    case 'waiting':
      return c.accent; // blue - needs your input
    case 'working':
      return c.warning; // amber - agent running
    case 'done':
      return c.success; // green - finished
    case 'active':
      return c.muted; // dim - open but idle
    default:
      return c.subtle; // faint - nothing here
  }
}

/**
 * The animated status dot. `working` and `waiting` breathe (opacity + scale) with
 * an expanding halo, like the desktop's pulsing glow; `done`/`active`/`idle` are
 * solid. Honors the OS "reduce motion" setting by falling back to a solid dot.
 */
export function AgentStatusDot({ status, size = 12 }: { status: AgentDotStatus; size?: number }) {
  const { palette: c } = useTheme();
  const reduceMotion = useReducedMotion();
  const color = agentStatusColor(status, c);
  const pulse = !reduceMotion && (status === 'working' || status === 'waiting');
  // "waiting" (needs you) pulses faster/more insistently than "working".
  const duration = status === 'waiting' ? 850 : 1300;

  const p = useSharedValue(0);
  useEffect(() => {
    if (pulse) {
      p.value = withRepeat(withTiming(1, { duration, easing: Easing.inOut(Easing.ease) }), -1, true);
    } else {
      cancelAnimation(p);
      p.value = 0;
    }
    return () => cancelAnimation(p);
  }, [pulse, duration, p]);

  const coreStyle = useAnimatedStyle(() => ({
    opacity: pulse ? 0.5 + p.value * 0.5 : 1,
    transform: [{ scale: pulse ? 0.82 + p.value * 0.18 : 1 }],
  }));
  const haloStyle = useAnimatedStyle(() => ({
    opacity: pulse ? 0.35 * (1 - p.value) : 0,
    transform: [{ scale: pulse ? 1 + p.value * 0.7 : 1 }],
  }));

  const dot = { width: size, height: size, borderRadius: size / 2, backgroundColor: color };
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View pointerEvents="none" style={[{ position: 'absolute' }, dot, haloStyle]} />
      <Animated.View style={[dot, coreStyle]} />
    </View>
  );
}
