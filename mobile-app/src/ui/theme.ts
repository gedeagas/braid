import { StyleSheet } from 'react-native';

export const colors = {
  bg: '#090A0B',
  panel: '#121417',
  panelStrong: '#191D22',
  border: '#2B3138',
  text: '#F7F8FA',
  muted: '#939BA7',
  subtle: '#626B78',
  accent: '#3D8BFF',
  success: '#35C98B',
  danger: '#FF5A66',
  warning: '#E5B84B',
};

export const shared = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  shell: { flex: 1, paddingHorizontal: 18, paddingTop: 8 },
  row: { flexDirection: 'row', alignItems: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 16 },
  title: { color: colors.text, fontSize: 25, fontWeight: '800', lineHeight: 31 },
  subtitle: { color: colors.muted, fontSize: 13, lineHeight: 18, marginTop: 4 },
  section: { color: colors.subtle, fontSize: 12, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0, marginBottom: 8 },
  card: { borderRadius: 8, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.panel, padding: 14 },
  button: { minHeight: 44, borderRadius: 8, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, paddingHorizontal: 12 },
  primary: { backgroundColor: colors.accent },
  secondary: { backgroundColor: colors.panelStrong, borderWidth: 1, borderColor: colors.border },
  danger: { backgroundColor: 'rgba(255, 90, 102, 0.14)', borderWidth: 1, borderColor: 'rgba(255, 90, 102, 0.35)' },
  buttonText: { color: colors.text, fontSize: 14, fontWeight: '800' },
  input: { minHeight: 44, borderRadius: 8, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bg, color: colors.text, padding: 12 },
  code: { color: colors.text, fontFamily: 'Menlo', fontSize: 12, lineHeight: 17 },
  muted: { color: colors.muted, fontSize: 13, lineHeight: 18 },
});
