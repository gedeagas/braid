import type { Palette } from '@/ui/theme';
import type { ProviderRateLimits, RateLimitWindow } from '@/transport/types';

// Pure helpers for rendering Claude/Codex usage. Mirrors the desktop
// UsageStatusBar so the phone reads the same way.

/** Percentage of the window still available (0-100), clamped. */
export function percentLeft(window: RateLimitWindow): number {
  return Math.max(0, Math.min(100, Math.round(100 - window.usedPercent)));
}

/** Bar color by remaining headroom: green plenty, amber low, red nearly out. */
export function barColor(leftPct: number, c: Palette): string {
  if (leftPct > 40) return c.success;
  if (leftPct > 20) return c.warning;
  return c.danger;
}

/** Short human label for a usage window ("5h" session, "Weekly", or "Nh"). */
export function windowLabel(minutes: number): string {
  if (minutes <= 300) return 'Session (5h)';
  if (minutes <= 10080) return 'Weekly';
  return `${Math.round(minutes / 60)}h window`;
}

/** "Resets in 4h 12m" style string, or null when no reset time is known. */
export function formatResetIn(resetsAt: number | null, now: number): string | null {
  if (!resetsAt) return null;
  const ms = resetsAt - now;
  if (ms <= 0) return 'Resetting';
  const totalMins = Math.floor(ms / 60_000);
  if (totalMins < 60) return `Resets in ${totalMins}m`;
  const hours = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    const remHours = hours % 24;
    return remHours > 0 ? `Resets in ${days}d ${remHours}h` : `Resets in ${days}d`;
  }
  return mins > 0 ? `Resets in ${hours}h ${mins}m` : `Resets in ${hours}h`;
}

export type ProviderDisplay =
  | { kind: 'windows'; windows: RateLimitWindow[]; stale: boolean }
  | { kind: 'message'; tone: 'muted' | 'error'; text: string };

/**
 * Decide what to render for a provider: its usage bars, or a single status line
 * (installed-but-no-plan, error, still fetching). Keeps the component dumb.
 */
export function describeProvider(provider: ProviderRateLimits): ProviderDisplay {
  const windows = [provider.session, provider.weekly].filter(
    (window): window is RateLimitWindow => window != null,
  );
  if (windows.length > 0) {
    // Has data: show bars even on a failed refresh (cached), flag staleness.
    return { kind: 'windows', windows, stale: provider.status === 'error' };
  }
  if (provider.status === 'fetching' || provider.status === 'idle') {
    return { kind: 'message', tone: 'muted', text: 'Checking usage...' };
  }
  if (provider.status === 'unavailable') {
    return { kind: 'message', tone: 'muted', text: provider.error ?? 'No subscription plan' };
  }
  return { kind: 'message', tone: 'error', text: provider.error ?? 'Usage unavailable' };
}

/** Display name for a provider id. */
export function providerName(provider: ProviderRateLimits['provider']): string {
  return provider === 'claude' ? 'Claude' : 'Codex';
}
