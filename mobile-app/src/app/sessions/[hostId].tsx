import { router, useLocalSearchParams } from 'expo-router';
import { ChevronLeft, MessageSquare, RefreshCw } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { BraidSession } from '@/transport/types';
import { colors, shared } from '@/ui/theme';
import { useHostClient } from '@/ui/use-host-client';

export default function SessionsScreen() {
  const { hostId } = useLocalSearchParams<{ hostId: string }>();
  const { client, host } = useHostClient(hostId);
  const [sessions, setSessions] = useState<BraidSession[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!client) return;
    setError(null);
    try {
      setSessions(await client.request<BraidSession[]>('sessions.list'));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [client]);

  useEffect(() => { void load(); }, [load]);

  return (
    <SafeAreaView style={shared.safe}>
      <View style={shared.shell}>
        <View style={shared.header}>
          <Pressable style={[shared.button, shared.secondary]} onPress={() => router.back()}><ChevronLeft color={colors.text} size={18} /></Pressable>
          <Pressable style={[shared.button, shared.secondary]} onPress={load}><RefreshCw color={colors.text} size={18} /></Pressable>
        </View>
        <Text style={shared.title}>Sessions</Text>
        <Text style={shared.subtitle}>{host?.instanceName ?? host?.endpoint ?? 'Braid desktop'}</Text>
        {error && <Text style={[shared.subtitle, { color: colors.danger }]}>{error}</Text>}
        <ScrollView contentContainerStyle={{ gap: 10, paddingVertical: 18 }}>
          {sessions.map((session) => (
            <Pressable key={session.id} style={[shared.card, { gap: 6 }]} onPress={() => router.push(`/session/${hostId}/${session.id}`)}>
              <View style={[shared.row, { gap: 10 }]}>
                <MessageSquare color={colors.accent} size={18} />
                <Text style={{ color: colors.text, fontSize: 16, fontWeight: '800', flex: 1 }}>{session.customName || session.name || 'Untitled session'}</Text>
              </View>
              <Text style={shared.muted}>{[session.status, session.model, session.messageCount ? `${session.messageCount} messages` : null].filter(Boolean).join(' · ')}</Text>
              <Text style={shared.muted} numberOfLines={1}>{session.worktreePath}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}
