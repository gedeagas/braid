import { router, useLocalSearchParams } from 'expo-router';
import { ChevronLeft, GitBranch, Plus, RefreshCw, Trash2 } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { BraidProject, BraidWorktree } from '@/transport/types';
import { colors, shared } from '@/ui/theme';
import { useHostClient } from '@/ui/use-host-client';

export default function WorktreesScreen() {
  const { hostId } = useLocalSearchParams<{ hostId: string }>();
  const { client } = useHostClient(hostId);
  const [projects, setProjects] = useState<BraidProject[]>([]);
  const [branch, setBranch] = useState('');
  const [baseBranch, setBaseBranch] = useState('');

  const load = useCallback(async () => {
    if (!client) return;
    setProjects(await client.request<BraidProject[]>('projects.list'));
  }, [client]);

  useEffect(() => { void load(); }, [load]);

  const create = async (project: BraidProject) => {
    if (!client || !branch.trim()) return;
    await client.request('worktrees.create', {
      repoPath: project.path,
      projectName: project.name,
      branch: branch.trim(),
      baseBranch: baseBranch.trim() || undefined,
    });
    setBranch('');
    setBaseBranch('');
    await load();
  };

  const remove = async (project: BraidProject, worktree: BraidWorktree) => {
    if (!client) return;
    Alert.alert('Remove worktree?', worktree.branch, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => void client.request('worktrees.remove', { repoPath: project.path, worktreePath: worktree.path }).then(load) },
    ]);
  };

  return (
    <SafeAreaView style={shared.safe}>
      <View style={shared.shell}>
        <View style={shared.header}>
          <Pressable style={[shared.button, shared.secondary]} onPress={() => router.back()}><ChevronLeft color={colors.text} size={18} /></Pressable>
          <Pressable style={[shared.button, shared.secondary]} onPress={load}><RefreshCw color={colors.text} size={18} /></Pressable>
        </View>
        <Text style={shared.title}>Worktrees</Text>
        <ScrollView contentContainerStyle={{ gap: 14, paddingVertical: 18 }}>
          <View style={[shared.card, { gap: 10 }]}>
            <Text style={shared.section}>Create worktree</Text>
            <TextInput value={branch} onChangeText={setBranch} placeholder="new-branch" placeholderTextColor={colors.subtle} autoCapitalize="none" autoCorrect={false} style={shared.input} />
            <TextInput value={baseBranch} onChangeText={setBaseBranch} placeholder="base branch (optional)" placeholderTextColor={colors.subtle} autoCapitalize="none" autoCorrect={false} style={shared.input} />
            {projects[0] && <Pressable style={[shared.button, shared.primary]} onPress={() => create(projects[0])}><Plus color={colors.text} size={18} /><Text style={shared.buttonText}>Create in {projects[0].name}</Text></Pressable>}
          </View>
          {projects.map((project) => (
            <View key={project.id} style={[shared.card, { gap: 10 }]}>
              <Text style={shared.section}>{project.name}</Text>
              {(project.worktrees ?? []).map((worktree) => (
                <View key={worktree.path} style={[shared.row, { gap: 10 }]}>
                  <GitBranch color={worktree.isMain ? colors.success : colors.accent} size={16} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.text, fontWeight: '800' }}>{worktree.branch}</Text>
                    <Text style={shared.muted} numberOfLines={1}>{worktree.path}</Text>
                  </View>
                  {!worktree.isMain && <Pressable style={[shared.button, shared.danger]} onPress={() => remove(project, worktree)}><Trash2 color={colors.danger} size={16} /></Pressable>}
                </View>
              ))}
            </View>
          ))}
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}
