import { StyleSheet } from 'react-native';

import type { Palette } from './palette';

/**
 * The app-wide reusable style primitives, built from a palette. Keep these in
 * sync with the kit components - screens compose `shared.*` for one-off layouts
 * and reach for kit components (Button, Card, ...) for repeated patterns.
 */
export function makeShared(c: Palette) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: c.bg },
    shell: { flex: 1, paddingHorizontal: 18, paddingTop: 8 },
    row: { flexDirection: 'row', alignItems: 'center' },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 16 },
    title: { color: c.text, fontSize: 25, fontWeight: '800', lineHeight: 31 },
    subtitle: { color: c.muted, fontSize: 13, lineHeight: 18, marginTop: 4 },
    section: { color: c.subtle, fontSize: 12, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0, marginBottom: 8 },
    card: { borderRadius: 8, borderWidth: 1, borderColor: c.border, backgroundColor: c.panel, padding: 14 },
    button: { minHeight: 44, borderRadius: 8, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, paddingHorizontal: 12 },
    primary: { backgroundColor: c.accent },
    secondary: { backgroundColor: c.panelStrong, borderWidth: 1, borderColor: c.border },
    danger: { backgroundColor: 'rgba(255, 90, 102, 0.14)', borderWidth: 1, borderColor: 'rgba(255, 90, 102, 0.35)' },
    buttonText: { color: c.text, fontSize: 14, fontWeight: '800' },
    input: { minHeight: 44, borderRadius: 8, borderWidth: 1, borderColor: c.border, backgroundColor: c.bg, color: c.text, padding: 12 },
    code: { color: c.text, fontFamily: 'Menlo', fontSize: 12, lineHeight: 17 },
    muted: { color: c.muted, fontSize: 13, lineHeight: 18 },
  });
}

export type SharedStyles = ReturnType<typeof makeShared>;
