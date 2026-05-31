import { router, useLocalSearchParams } from 'expo-router';
import { ChevronLeft, Send, Square, TerminalSquare, Wifi } from 'lucide-react-native';
import * as Notifications from 'expo-notifications';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { BraidMessage, BraidSession, RpcNotification } from '@/transport/types';
import { colors, shared } from '@/ui/theme';
import { useHostClient } from '@/ui/use-host-client';

export default function SessionDetailScreen() {
  const { hostId, sessionId } = useLocalSearchParams<{ hostId: string; sessionId: string }>();
  const { client } = useHostClient(hostId);
  const [session, setSession] = useState<BraidSession | null>(null);
  const [events, setEvents] = useState<string[]>([]);
  const [draft, setDraft] = useState('');
  const scrollRef = useRef<ScrollView>(null);

  const load = useCallback(async () => {
    if (!client || !sessionId) return;
    const next = await client.request<BraidSession | null>('sessions.get', { sessionId });
    console.log('[BraidMobile] session.load', {
      hostId,
      sessionId,
      session: next ? {
        id: next.id,
        name: next.customName || next.name,
        worktreeId: next.worktreeId,
        worktreePath: next.worktreePath,
        status: next.status,
        messageCount: next.messages?.length ?? next.messageCount,
      } : null,
    });
    setSession(next);
  }, [client, sessionId]);

  useEffect(() => {
    if (!client || !sessionId) return;
    let active = true;
    let unsubscribeLocal: (() => void) | undefined;
    void (async () => {
      await load();
      await Notifications.requestPermissionsAsync();
      unsubscribeLocal = client.onNotification((notification) => {
        if (notification.method !== 'agent.event') return;
        const params = notification.params as { sessionId?: string; event?: unknown };
        if (params.sessionId !== sessionId) return;
        const label = eventLabel(params.event);
        setEvents((current) => [label, ...current].slice(0, 40));
        if (active && /waiting|done|error/i.test(label)) {
          void Notifications.scheduleNotificationAsync({ content: { title: 'Braid session update', body: label }, trigger: null });
        }
        void load();
      });
      await client.subscribe('agent.subscribe', { sessionId });
    })().catch((err) => setEvents((current) => [`Subscription failed: ${err instanceof Error ? err.message : String(err)}`, ...current]));
    return () => {
      active = false;
      unsubscribeLocal?.();
      client?.close();
    };
  }, [client, load, sessionId]);

  const send = async () => {
    if (!client || !session || !draft.trim()) return;
    const message = draft.trim();
    setDraft('');
    try {
      await client.request('sessions.sendMessage', {
        sessionId: session.id,
        message,
        sdkSessionId: session.sdkSessionId ?? '',
        cwd: session.worktreePath ?? '',
        model: session.model ?? 'claude-sonnet-4-6',
        extendedContext: session.extendedContext ?? false,
        effortLevel: session.effortLevel ?? 'default',
        planMode: session.planModeEnabled ?? false,
        sessionName: session.name ?? 'New Chat',
      });
      await load();
    } catch (err) {
      Alert.alert('Send failed', err instanceof Error ? err.message : String(err));
    }
  };

  const stop = async () => {
    if (!client || !sessionId) return;
    await client.request('sessions.stop', { sessionId });
    await load();
  };

  const messages = session?.messages ?? [];

  return (
    <SafeAreaView style={shared.safe}>
      <View style={shared.shell}>
        <View style={shared.header}>
          <Pressable style={[shared.button, shared.secondary]} onPress={() => router.back()}><ChevronLeft color={colors.text} size={18} /></Pressable>
          <Pressable style={[shared.button, shared.danger]} onPress={stop}><Square color={colors.danger} size={16} /><Text style={[shared.buttonText, { color: colors.danger }]}>Stop</Text></Pressable>
        </View>
        <Text style={shared.title}>{session?.customName || session?.name || 'Session'}</Text>
        <Text style={shared.subtitle}>{[session?.status, session?.model].filter(Boolean).join(' · ')}</Text>
        {session?.worktreePath && (
          <Pressable
            style={[shared.button, shared.secondary, { marginTop: 12, alignSelf: 'flex-start' }]}
            onPress={() => router.push({
              pathname: '/terminal/[hostId]',
              params: {
                hostId,
                worktreePath: session.worktreePath,
                worktreeName: session.customName || session.name || 'Session terminal',
              },
            })}
          >
            <TerminalSquare color={colors.text} size={17} />
            <Text style={shared.buttonText}>Open terminal tabs</Text>
          </Pressable>
        )}

        <ScrollView ref={scrollRef} style={{ flex: 1 }} contentContainerStyle={{ gap: 12, paddingVertical: 16 }} onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}>
          {messages.map((message) => <MessageBubble key={message.id} message={message} />)}
          {events.length > 0 && (
            <View style={[shared.card, { gap: 6 }]}>
              <View style={[shared.row, { gap: 8 }]}><Wifi color={colors.success} size={16} /><Text style={shared.section}>Live events</Text></View>
              {events.slice(0, 5).map((event, index) => <Text key={`${event}-${index}`} style={shared.muted}>{event}</Text>)}
            </View>
          )}
        </ScrollView>

        <View style={{ flexDirection: 'row', gap: 8, paddingBottom: 8 }}>
          <TextInput value={draft} onChangeText={setDraft} placeholder="Send a message..." placeholderTextColor={colors.subtle} style={[shared.input, { flex: 1 }]} />
          <Pressable style={[shared.button, shared.primary]} onPress={send}><Send color={colors.text} size={18} /></Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}

function MessageBubble({ message }: { message: BraidMessage }) {
  const isUser = message.role === 'user';
  return (
    <View style={[shared.card, { backgroundColor: isUser ? '#172033' : colors.panel, gap: 8 }]}>
      <Text style={{ color: isUser ? colors.accent : colors.success, fontWeight: '800', textTransform: 'uppercase', fontSize: 11 }}>{message.role}</Text>
      <Text style={{ color: colors.text, fontSize: 14, lineHeight: 20 }}>{message.content || (message.toolCalls?.length ? 'Tool activity' : '')}</Text>
      {message.toolCalls?.map((tool) => <Text key={tool.id} style={shared.muted}>{tool.name}: {tool.error || tool.result || tool.input || 'running'}</Text>)}
    </View>
  );
}

function eventLabel(event: unknown): string {
  if (!event || typeof event !== 'object') return String(event ?? 'event');
  const data = event as Record<string, unknown>;
  return String(data.type ?? data.status ?? data.activity ?? JSON.stringify(data).slice(0, 120));
}
