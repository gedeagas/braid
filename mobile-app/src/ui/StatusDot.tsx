import { View } from 'react-native';

import type { ConnectionState, ConnectionVerdict } from '@/transport/connection-health';
import { useTheme } from '@/ui/theme';

// Why: when a verdict is passed, the dot color reflects the verdict's severity
// instead of the raw transport state. This avoids the "amber dot next to a red
// 'Can't reach desktop' label" mismatch - the underlying transport is still
// 'reconnecting' (amber) but the user-visible meaning has escalated to error.
export function StatusDot({
  state,
  verdict,
  size = 8,
}: {
  state: ConnectionState;
  verdict?: ConnectionVerdict;
  size?: number;
}) {
  const { palette: c } = useTheme();
  const stateColor: Record<ConnectionState, string> = {
    connected: c.success,
    connecting: c.warning,
    reconnecting: c.warning,
    disconnected: c.subtle,
    'auth-failed': c.danger,
  };
  const color =
    verdict?.kind === 'unreachable' || verdict?.kind === 'auth-failed'
      ? c.danger
      : verdict?.kind === 'warning'
        ? c.warning
        : (stateColor[state] ?? c.subtle);
  return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }} />;
}
