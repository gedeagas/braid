import { useRef } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import type { ConnectionLogEntry, ConnectionLogLevel } from '@/transport/connection-health';
import { useTheme, useThemedStyles, type Palette } from '@/ui/theme';

/**
 * A scrolling, monospace log of recent connection phases (open / handshake /
 * drop / reconnect / auth-failure) with elapsed time and severity glyphs - an
 * in-app network debugger for the host screen and troubleshooter.
 */
export function ConnectionLog({ entries, title }: { entries: ConnectionLogEntry[]; title?: string }) {
  const { palette: c } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const scrollRef = useRef<ScrollView | null>(null);

  if (entries.length === 0) return null;
  const baseTs = entries[0].ts;

  const levelColor: Record<ConnectionLogLevel, string> = {
    info: c.muted,
    success: c.success,
    warn: c.warning,
    error: c.danger,
  };
  const levelGlyph: Record<ConnectionLogLevel, string> = { info: '•', success: '✓', warn: '!', error: '✕' };

  return (
    <View style={styles.container}>
      {title && <Text style={styles.title}>{title}</Text>}
      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        showsVerticalScrollIndicator={false}
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
      >
        {entries.map((entry) => (
          <View key={entry.id} style={styles.row}>
            <Text style={styles.timestamp}>{formatElapsed(entry.ts, baseTs)}</Text>
            <Text style={[styles.glyph, { color: levelColor[entry.level] }]}>{levelGlyph[entry.level]}</Text>
            <View style={styles.rowText}>
              <Text style={[styles.message, { color: levelColor[entry.level] }]}>{entry.message}</Text>
              {entry.detail && (
                <Text style={styles.detail} numberOfLines={2}>
                  {entry.detail}
                </Text>
              )}
            </View>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

// Why: elapsed seconds since the first entry - absolute wall-clock time isn't
// actionable when debugging "why is connecting stuck".
function formatElapsed(ts: number, baseTs: number): string {
  const elapsed = Math.max(0, ts - baseTs) / 1000;
  if (elapsed < 10) return `+${elapsed.toFixed(2)}s`;
  if (elapsed < 100) return `+${elapsed.toFixed(1)}s`;
  return `+${Math.round(elapsed)}s`;
}

function makeStyles(c: Palette) {
  return StyleSheet.create({
    container: {
      width: '100%',
      maxHeight: 220,
      backgroundColor: c.panel,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: c.border,
      paddingVertical: 8,
      paddingHorizontal: 12,
    },
    title: {
      fontSize: 11,
      fontFamily: 'Menlo',
      color: c.subtle,
      textTransform: 'uppercase',
      letterSpacing: 1,
      marginBottom: 6,
    },
    scroll: { maxHeight: 184 },
    row: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 6 },
    timestamp: { fontFamily: 'Menlo', fontSize: 11, color: c.subtle, width: 52, paddingTop: 1 },
    glyph: { fontFamily: 'Menlo', fontSize: 11, width: 12, textAlign: 'center', paddingTop: 1 },
    rowText: { flex: 1 },
    message: { fontFamily: 'Menlo', fontSize: 11, lineHeight: 16 },
    detail: { fontFamily: 'Menlo', fontSize: 10, color: c.subtle, lineHeight: 14, marginTop: 1 },
  });
}
