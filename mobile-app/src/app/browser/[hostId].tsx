import { router, useLocalSearchParams } from 'expo-router';
import { ChevronLeft, RefreshCw } from 'lucide-react-native';
import { useRef, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import WebView from 'react-native-webview';

import { CornerInset } from '@/ui/kit';
import { colors, shared } from '@/ui/theme';
import { useHostClient } from '@/ui/use-host-client';

export default function BrowserScreen() {
  const { hostId } = useLocalSearchParams<{ hostId: string }>();
  const { host } = useHostClient(hostId);
  const desktopHost = host?.endpoint.replace(/^ws:\/\//, '').replace(/:\d+$/, '') ?? '127.0.0.1';
  const [url, setUrl] = useState(`http://${desktopHost}:5173`);
  const [currentUrl, setCurrentUrl] = useState(url);
  const webRef = useRef<WebView>(null);

  return (
    <SafeAreaView style={shared.safe}>
      <View style={shared.shell}>
        <View style={shared.header}>
          <CornerInset />
          <Pressable style={[shared.button, shared.secondary]} onPress={() => router.back()}><ChevronLeft color={colors.text} size={18} /></Pressable>
          <Pressable style={[shared.button, shared.secondary]} onPress={() => webRef.current?.reload()}><RefreshCw color={colors.text} size={18} /></Pressable>
        </View>
        <Text style={shared.title}>Browser preview</Text>
        <Text style={shared.subtitle}>Use this for local web previews or design-mode inspection from the phone.</Text>
        <View style={{ flexDirection: 'row', gap: 8, paddingVertical: 12 }}>
          <TextInput value={url} onChangeText={setUrl} autoCapitalize="none" autoCorrect={false} style={[shared.input, { flex: 1 }]} />
          <Pressable style={[shared.button, shared.primary]} onPress={() => setCurrentUrl(url)}><Text style={shared.buttonText}>Open</Text></Pressable>
        </View>
        <View style={{ flex: 1, borderRadius: 8, overflow: 'hidden', borderWidth: 1, borderColor: colors.border }}>
          <WebView
            ref={webRef}
            source={{ uri: currentUrl }}
            javaScriptEnabled
            domStorageEnabled
            allowsBackForwardNavigationGestures
            style={{ backgroundColor: colors.bg }}
          />
        </View>
      </View>
    </SafeAreaView>
  );
}
