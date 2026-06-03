import { decideReconcile, type ReconcileInput } from '../connection-reconcile';

// decideReconcile is the heart of the manager's resume/liveness handling. The
// matrix below pins the contract that fixed the "terminal stuck after a long
// background" bug: on resume we trust the live socket (socketOpen), not the
// cached state, so a half-open socket the OS killed silently is reconnected.

const base: ReconcileInput = {
  desiredConnected: true,
  state: 'connected',
  socketOpen: true,
  connectInFlight: false,
  reconnectScheduled: false,
};

describe('decideReconcile', () => {
  describe('when backgrounded (desiredConnected=false)', () => {
    it('closes a live connection', () => {
      expect(decideReconcile({ ...base, desiredConnected: false })).toBe('close');
    });

    it('closes a connecting/reconnecting entry', () => {
      expect(decideReconcile({ ...base, desiredConnected: false, state: 'connecting', socketOpen: false })).toBe('close');
      expect(decideReconcile({ ...base, desiredConnected: false, state: 'reconnecting', socketOpen: false })).toBe('close');
    });

    it('leaves an already-idle entry alone', () => {
      expect(decideReconcile({ ...base, desiredConnected: false, state: 'disconnected', socketOpen: false })).toBe('none');
    });

    it('still closes a stale socket that reads disconnected but is somehow open', () => {
      expect(decideReconcile({ ...base, desiredConnected: false, state: 'disconnected', socketOpen: true })).toBe('close');
    });
  });

  describe('when foregrounded (desiredConnected=true)', () => {
    it('does nothing for a healthy connected socket', () => {
      expect(decideReconcile(base)).toBe('none');
    });

    it('RECONNECTS a half-open socket: state connected but socket not open', () => {
      // This is the long-background regression: the cached state lies, the
      // socket is dead, and the fix is to reconnect rather than trust the state.
      expect(decideReconcile({ ...base, socketOpen: false })).toBe('reconnect');
    });

    it('connects a fresh/idle entry', () => {
      expect(decideReconcile({ ...base, state: 'disconnected', socketOpen: false })).toBe('connect');
    });

    it('connects a stalled connecting entry with nothing in flight', () => {
      expect(decideReconcile({ ...base, state: 'connecting', socketOpen: false })).toBe('connect');
      expect(decideReconcile({ ...base, state: 'reconnecting', socketOpen: false })).toBe('connect');
    });

    it('does not pile on when a connect is already in flight', () => {
      expect(decideReconcile({ ...base, state: 'connecting', socketOpen: false, connectInFlight: true })).toBe('none');
    });

    it('does not pile on when a reconnect timer is armed', () => {
      expect(decideReconcile({ ...base, state: 'reconnecting', socketOpen: false, reconnectScheduled: true })).toBe('none');
    });

    it('never reconnects a rejected pairing (auth-failed is terminal)', () => {
      expect(decideReconcile({ ...base, state: 'auth-failed', socketOpen: false })).toBe('none');
    });
  });
});
