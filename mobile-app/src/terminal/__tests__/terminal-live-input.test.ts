import {
  TERMINAL_LIVE_INPUT_MAX_BYTES,
  clearTerminalLiveInputFocusTimer,
  getTerminalLiveSpecialKeyBytes,
  isTerminalLiveInputWithinByteLimit,
  scheduleTerminalLiveInputFocus,
  type TerminalLiveInputFocusTimerRef,
} from '../terminal-live-input';

describe('getTerminalLiveSpecialKeyBytes', () => {
  it('maps Backspace to DEL (0x7f)', () => {
    expect(getTerminalLiveSpecialKeyBytes('Backspace')).toBe('\x7f');
  });

  it('returns null for printable keys (they arrive via onChangeText)', () => {
    expect(getTerminalLiveSpecialKeyBytes('a')).toBeNull();
    expect(getTerminalLiveSpecialKeyBytes('Enter')).toBeNull();
  });
});

describe('isTerminalLiveInputWithinByteLimit', () => {
  it('accepts text within the byte budget', () => {
    expect(isTerminalLiveInputWithinByteLimit('hello')).toBe(true);
    expect(isTerminalLiveInputWithinByteLimit('a'.repeat(TERMINAL_LIVE_INPUT_MAX_BYTES))).toBe(true);
  });

  it('rejects text over the byte budget', () => {
    expect(isTerminalLiveInputWithinByteLimit('a'.repeat(TERMINAL_LIVE_INPUT_MAX_BYTES + 1))).toBe(false);
  });

  it('measures UTF-8 bytes, not character count', () => {
    // '🚀' is 4 UTF-8 bytes, so 2 of them exceed a 4-byte budget.
    expect(isTerminalLiveInputWithinByteLimit('🚀🚀', 4)).toBe(false);
    expect(isTerminalLiveInputWithinByteLimit('🚀', 4)).toBe(true);
  });
});

describe('live-input focus timer', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('schedules focus after the delay and clears the ref', () => {
    const ref: TerminalLiveInputFocusTimerRef = { current: null };
    const focus = jest.fn();
    scheduleTerminalLiveInputFocus(ref, focus, 50);
    expect(ref.current).not.toBeNull();
    expect(focus).not.toHaveBeenCalled();
    jest.advanceTimersByTime(50);
    expect(focus).toHaveBeenCalledTimes(1);
    expect(ref.current).toBeNull();
  });

  it('replaces a pending timer so only the latest focus fires', () => {
    const ref: TerminalLiveInputFocusTimerRef = { current: null };
    const first = jest.fn();
    const second = jest.fn();
    scheduleTerminalLiveInputFocus(ref, first, 50);
    scheduleTerminalLiveInputFocus(ref, second, 50);
    jest.advanceTimersByTime(50);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('clearTerminalLiveInputFocusTimer cancels a pending focus', () => {
    const ref: TerminalLiveInputFocusTimerRef = { current: null };
    const focus = jest.fn();
    scheduleTerminalLiveInputFocus(ref, focus, 50);
    clearTerminalLiveInputFocusTimer(ref);
    expect(ref.current).toBeNull();
    jest.advanceTimersByTime(50);
    expect(focus).not.toHaveBeenCalled();
  });

  it('clearing a null ref is a no-op', () => {
    const ref: TerminalLiveInputFocusTimerRef = { current: null };
    expect(() => clearTerminalLiveInputFocusTimer(ref)).not.toThrow();
  });
});
