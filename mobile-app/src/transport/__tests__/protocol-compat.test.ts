import {
  desktopSupports,
  evaluateCompat,
  evaluateCompatFromStatus,
} from '../protocol-compat';
import { MIN_COMPATIBLE_DESKTOP_VERSION, MOBILE_PROTOCOL_VERSION } from '../protocol-version';
import type { BraidStatus } from '../types';

// protocol-compat is the version-handshake gatekeeper. Its precedence rules
// decide whether a phone hard-blocks a paired desktop, so the branches below
// pin the contract documented in AGENTS.md ("Protocol compatibility"), including
// the regression where a newer desktop must NOT block on version alone.

function status(overrides: Partial<BraidStatus> = {}): BraidStatus {
  return {
    instanceName: 'desktop',
    version: '1.0.0',
    protocolVersion: MOBILE_PROTOCOL_VERSION,
    projects: [],
    uptime: 0,
    ...overrides,
  };
}

describe('evaluateCompat', () => {
  it('is ok when both sides are within range', () => {
    expect(
      evaluateCompat({
        desktopProtocolVersion: MOBILE_PROTOCOL_VERSION,
        desktopMinCompatibleMobileVersion: MOBILE_PROTOCOL_VERSION,
      }),
    ).toEqual({ kind: 'ok' });
  });

  it('never blocks on a newer desktop protocol alone (additive features are capability-gated)', () => {
    expect(
      evaluateCompat({
        desktopProtocolVersion: MOBILE_PROTOCOL_VERSION + 5,
        desktopMinCompatibleMobileVersion: MOBILE_PROTOCOL_VERSION,
      }),
    ).toEqual({ kind: 'ok' });
  });

  it('blocks as mobile-too-old when the desktop kill switch excludes this build', () => {
    expect(
      evaluateCompat({
        desktopProtocolVersion: MOBILE_PROTOCOL_VERSION,
        desktopMinCompatibleMobileVersion: MOBILE_PROTOCOL_VERSION + 1,
      }),
    ).toEqual({
      kind: 'blocked',
      reason: 'mobile-too-old',
      desktopVersion: MOBILE_PROTOCOL_VERSION,
      requiredMobileVersion: MOBILE_PROTOCOL_VERSION + 1,
    });
  });

  it('blocks as desktop-too-old below the minimum supported desktop version', () => {
    expect(
      evaluateCompat({
        desktopProtocolVersion: MIN_COMPATIBLE_DESKTOP_VERSION - 1,
        desktopMinCompatibleMobileVersion: 0,
      }),
    ).toEqual({
      kind: 'blocked',
      reason: 'desktop-too-old',
      desktopVersion: MIN_COMPATIBLE_DESKTOP_VERSION - 1,
      requiredDesktopVersion: MIN_COMPATIBLE_DESKTOP_VERSION,
    });
  });

  it('lets the kill switch win over a too-old desktop (mobile-too-old has precedence)', () => {
    // Desktop is both ancient AND refuses this mobile build: the explicit kill
    // switch is decisive, so the verdict is mobile-too-old, not desktop-too-old.
    const verdict = evaluateCompat({
      desktopProtocolVersion: MIN_COMPATIBLE_DESKTOP_VERSION - 1,
      desktopMinCompatibleMobileVersion: MOBILE_PROTOCOL_VERSION + 1,
    });
    expect(verdict).toMatchObject({ kind: 'blocked', reason: 'mobile-too-old' });
  });

  it('treats a pre-versioning desktop (absent fields) as protocol 0 -> desktop-too-old', () => {
    expect(
      evaluateCompat({ desktopProtocolVersion: undefined, desktopMinCompatibleMobileVersion: undefined }),
    ).toMatchObject({ kind: 'blocked', reason: 'desktop-too-old', desktopVersion: 0 });
  });
});

describe('evaluateCompatFromStatus', () => {
  it('maps status.get fields through to evaluateCompat', () => {
    expect(evaluateCompatFromStatus(status())).toEqual({ kind: 'ok' });
  });

  it('treats a null status as a pre-versioning desktop', () => {
    expect(evaluateCompatFromStatus(null)).toMatchObject({ kind: 'blocked', reason: 'desktop-too-old' });
  });
});

describe('desktopSupports', () => {
  it('is true when the capability is advertised', () => {
    expect(desktopSupports(status({ capabilities: ['terminal.binary-stream.v1'] }), 'terminal.binary-stream.v1')).toBe(true);
  });

  it('is false when the capability is absent or the array is missing', () => {
    expect(desktopSupports(status({ capabilities: ['other'] }), 'terminal.binary-stream.v1')).toBe(false);
    expect(desktopSupports(status(), 'terminal.binary-stream.v1')).toBe(false);
    expect(desktopSupports(null, 'terminal.binary-stream.v1')).toBe(false);
  });
});
