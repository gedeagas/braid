import {
  UNREACHABLE_ATTEMPTS,
  WARNING_ATTEMPTS,
  classifyConnection,
  isErrorVerdict,
} from '../connection-health';

// connection-health is the single source of truth for the user-facing severity
// of a connection. The escalation thresholds drive whether the phone shows a
// neutral "Reconnecting…" or an alarming "re-pair?" affordance, so the branches
// below pin that contract - especially the alignment with the manager's
// GIVE_UP_AFTER_ATTEMPTS cap (a drift there silently strands the user on
// "Reconnecting…" while the retry loop has actually parked).

const NOW = 1_000_000;

describe('classifyConnection', () => {
  it('reports connected/connecting/disconnected as normal', () => {
    expect(classifyConnection({ state: 'connected', reconnectAttempts: 0, lastConnectedAt: NOW })).toEqual({
      kind: 'normal',
      label: 'Connected',
    });
    expect(classifyConnection({ state: 'connecting', reconnectAttempts: 0, lastConnectedAt: null }).kind).toBe('normal');
    expect(classifyConnection({ state: 'disconnected', reconnectAttempts: 0, lastConnectedAt: null }).kind).toBe('normal');
  });

  it('treats auth-failed as a distinct terminal verdict', () => {
    const verdict = classifyConnection({ state: 'auth-failed', reconnectAttempts: 99, lastConnectedAt: NOW });
    expect(verdict.kind).toBe('auth-failed');
    expect(isErrorVerdict(verdict)).toBe(true);
  });

  it('stays neutral for the first couple of reconnect attempts', () => {
    const verdict = classifyConnection({ state: 'reconnecting', reconnectAttempts: WARNING_ATTEMPTS - 1, lastConnectedAt: NOW });
    expect(verdict).toEqual({ kind: 'normal', label: 'Reconnecting…' });
  });

  it('escalates to a warning once attempts cross the warning threshold', () => {
    const verdict = classifyConnection({ state: 'reconnecting', reconnectAttempts: WARNING_ATTEMPTS, lastConnectedAt: NOW });
    expect(verdict.kind).toBe('warning');
    expect(isErrorVerdict(verdict)).toBe(true);
  });

  it('escalates to unreachable/never-connected when it has never connected', () => {
    const verdict = classifyConnection({ state: 'reconnecting', reconnectAttempts: UNREACHABLE_ATTEMPTS, lastConnectedAt: null });
    expect(verdict).toEqual({ kind: 'unreachable', label: "Can't reach desktop", reason: 'never-connected' });
  });

  it('escalates to unreachable/stale when last connect is over a minute old', () => {
    const verdict = classifyConnection({
      state: 'reconnecting',
      reconnectAttempts: UNREACHABLE_ATTEMPTS,
      lastConnectedAt: NOW - 61_000,
      nowMs: NOW,
    });
    expect(verdict).toEqual({ kind: 'unreachable', label: "Can't reach desktop", reason: 'stale' });
  });

  it('stays a warning (not unreachable) if it connected recently despite many attempts', () => {
    const verdict = classifyConnection({
      state: 'reconnecting',
      reconnectAttempts: UNREACHABLE_ATTEMPTS,
      lastConnectedAt: NOW - 1_000,
      nowMs: NOW,
    });
    expect(verdict.kind).toBe('warning');
  });
});
