import { startDiagnosticFetchTimeout } from '../diagnostic-fetch-timeout';

// The troubleshooter's internet check is bounded by this signal so a hung
// network can't leave diagnostics spinning. The two exit paths (timeout fired
// vs caller disposed) must be distinguishable, and dispose() must be idempotent.

describe('startDiagnosticFetchTimeout', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('aborts and reports timedOut once the timeout elapses', () => {
    const t = startDiagnosticFetchTimeout(5000);
    expect(t.signal.aborted).toBe(false);
    expect(t.timedOut).toBe(false);
    jest.advanceTimersByTime(5000);
    expect(t.signal.aborted).toBe(true);
    expect(t.timedOut).toBe(true);
  });

  it('aborts without the timedOut flag when disposed early', () => {
    const t = startDiagnosticFetchTimeout(5000);
    t.dispose();
    expect(t.signal.aborted).toBe(true);
    expect(t.timedOut).toBe(false);
    // The pending timer must not fire after disposal.
    jest.advanceTimersByTime(5000);
    expect(t.timedOut).toBe(false);
  });

  it('is safe to dispose more than once', () => {
    const t = startDiagnosticFetchTimeout(1000);
    t.dispose();
    expect(() => t.dispose()).not.toThrow();
  });
});
