import { useEffect, useReducer } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { X } from 'lucide-react-native';
import * as SecureStore from 'expo-secure-store';

import { AGENT_CATALOG } from '@/terminal/agentCatalog';
import { AgentIcon } from '@/terminal/AgentIcon';
import { useDetectedAgents } from '@/terminal/useDetectedAgents';
import type { BraidRpcClient } from '@/transport/rpc-client';
import type { BraidProject } from '@/transport/types';
import { useShared, useTheme, useThemedStyles, type Palette } from '@/ui/theme';
import { Button, Dropdown, type DropdownOption } from '@/ui/kit';

// Shared with the terminal screen: a worktree's chosen agent becomes the
// default the terminal picker opens with.
const DEFAULT_AGENT_STORAGE_KEY = 'braid.mobile.terminal.defaultAgentId';

// Mirror the desktop default: prefer main, then master, then the repo's first
// branch. Tolerates remote-prefixed names (e.g. "origin/main").
function pickDefaultBranch(branches: string[]): string | null {
  const byName = (name: string) => branches.find((b) => b === name || b.endsWith(`/${name}`));
  return byName('main') ?? byName('master') ?? branches[0] ?? null;
}

interface State {
  projectId: string | null;
  branch: string;
  baseBranch: string | null;
  agentId: string;
  branches: string[];
  branchesLoading: boolean;
  busy: boolean;
  error: string | null;
}

const INITIAL: State = {
  projectId: null,
  branch: '',
  baseBranch: null,
  agentId: AGENT_CATALOG[0]?.id ?? 'claude',
  branches: [],
  branchesLoading: false,
  busy: false,
  error: null,
};

/**
 * Create a worktree without leaving the host screen: pick the project and base
 * branch from dropdowns (like the desktop AddWorktreeDialog, minus Jira), name
 * the branch, and optionally choose which agent the new worktree opens with.
 */
export function CreateWorktreeModal({
  visible,
  onClose,
  client,
  projects,
  onCreated,
}: {
  visible: boolean;
  onClose: () => void;
  client: BraidRpcClient | null;
  projects: BraidProject[];
  onCreated: (project: BraidProject, branch: string) => void;
}) {
  const { palette: c } = useTheme();
  const shared = useShared();
  const styles = useThemedStyles(makeStyles);
  const detectedAgents = useDetectedAgents(client);
  const [state, patch] = useReducer((prev: State, next: Partial<State>) => ({ ...prev, ...next }), INITIAL);

  // Default the project to the first one each time the sheet opens.
  useEffect(() => {
    if (visible && !state.projectId && projects[0]) patch({ projectId: projects[0].id });
  }, [visible, projects, state.projectId]);

  // Seed the agent from the persisted default so it matches the terminal picker.
  useEffect(() => {
    SecureStore.getItemAsync(DEFAULT_AGENT_STORAGE_KEY)
      .then((stored) => {
        if (stored && AGENT_CATALOG.some((agent) => agent.id === stored)) patch({ agentId: stored });
      })
      .catch(() => undefined);
  }, []);

  const selectedProject = projects.find((project) => project.id === state.projectId) ?? null;

  // Fetch the base-branch options for the selected project.
  useEffect(() => {
    if (!visible || !client || !selectedProject) return;
    let active = true;
    patch({ branchesLoading: true });
    client
      .request<string[]>('git.branches', { repoPath: selectedProject.path })
      .then((branches) => {
        if (!active) return;
        patch({ branches, baseBranch: pickDefaultBranch(branches), branchesLoading: false });
      })
      .catch(() => {
        if (active) patch({ branches: [], baseBranch: null, branchesLoading: false });
      });
    return () => {
      active = false;
    };
  }, [visible, client, selectedProject]);

  const close = () => {
    patch(INITIAL);
    onClose();
  };

  const create = async () => {
    if (!client || !selectedProject || !state.branch.trim() || state.busy) return;
    patch({ busy: true, error: null });
    try {
      await client.request('worktrees.create', {
        repoPath: selectedProject.path,
        projectName: selectedProject.name,
        branch: state.branch.trim(),
        baseBranch: state.baseBranch ?? undefined,
      });
      await SecureStore.setItemAsync(DEFAULT_AGENT_STORAGE_KEY, state.agentId).catch(() => undefined);
      const branch = state.branch.trim();
      patch(INITIAL);
      onClose();
      onCreated(selectedProject, branch);
    } catch (err) {
      patch({ busy: false, error: err instanceof Error ? err.message : String(err) });
    }
  };

  const projectOptions: DropdownOption<string>[] = projects.map((project) => ({ value: project.id, label: project.name }));
  const branchOptions: DropdownOption<string>[] = state.branches.map((branch) => ({ value: branch, label: branch }));
  // Surface installed agents first (reusing the terminal screen's detection),
  // each with its brand icon; remaining agents follow, marked "not installed".
  const detectedIds = new Set(detectedAgents.map((agent) => agent.id));
  const agentOptions: DropdownOption<string>[] = [...AGENT_CATALOG]
    .sort((a, b) => Number(detectedIds.has(b.id)) - Number(detectedIds.has(a.id)))
    .map((agent) => ({
      value: agent.id,
      label: detectedIds.has(agent.id) ? agent.label : `${agent.label} · not installed`,
      icon: <AgentIcon agentId={agent.id} size={18} />,
    }));
  const canCreate = !!selectedProject && state.branch.trim().length > 0 && !state.busy;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <Pressable style={styles.backdrop} onPress={close}>
        <Pressable style={styles.panel} onPress={() => undefined}>
          <View style={styles.header}>
            <Text style={shared.title}>New worktree</Text>
            <Pressable style={styles.close} onPress={close} accessibilityLabel="Close">
              <X color={c.text} size={18} />
            </Pressable>
          </View>

          <ScrollView style={styles.bodyScroll} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            <Text style={styles.label}>Project</Text>
            <Dropdown
              value={state.projectId}
              options={projectOptions}
              onChange={(value) => patch({ projectId: value })}
              placeholder="Select a project"
              searchable
            />

            <View style={styles.agentLabelRow}>
              <Text style={styles.label}>Base branch</Text>
              {state.branchesLoading && <ActivityIndicator color={c.muted} size="small" />}
            </View>
            <Dropdown
              value={state.baseBranch}
              options={branchOptions}
              onChange={(value) => patch({ baseBranch: value })}
              placeholder={
                state.branchesLoading
                  ? 'Loading branches...'
                  : state.branches.length === 0
                    ? 'No branches found'
                    : 'Select a base branch'
              }
              disabled={state.branchesLoading || state.branches.length === 0}
              searchable
            />

            <Text style={styles.label}>New branch name</Text>
            <TextInput
              value={state.branch}
              onChangeText={(value) => patch({ branch: value })}
              placeholder="feature/my-change"
              placeholderTextColor={c.subtle}
              autoCapitalize="none"
              autoCorrect={false}
              style={shared.input}
            />

            <Text style={styles.label}>Agent</Text>
            <Dropdown
              value={state.agentId}
              options={agentOptions}
              onChange={(value) => patch({ agentId: value })}
              searchable
            />

            {state.error && <Text style={styles.error}>{state.error}</Text>}
          </ScrollView>

          <View style={styles.footer}>
            <Button
              label={state.busy ? 'Creating...' : 'Create worktree'}
              onPress={create}
              disabled={!canCreate}
              icon={state.busy ? <ActivityIndicator color="#FFFFFF" size="small" /> : undefined}
            />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function makeStyles(c: Palette) {
  return {
    backdrop: { flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.55)', justifyContent: 'flex-end' as const },
    panel: {
      minHeight: '72%' as const,
      maxHeight: '92%' as const,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.bg,
      paddingHorizontal: 18,
      paddingTop: 14,
      paddingBottom: 24,
    },
    header: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const, marginBottom: 8 },
    close: { width: 34, height: 34, borderRadius: 17, alignItems: 'center' as const, justifyContent: 'center' as const, backgroundColor: c.panelStrong },
    bodyScroll: { flex: 1 },
    body: { gap: 8, paddingVertical: 12 },
    label: { color: c.subtle, fontSize: 12, fontWeight: '800' as const, textTransform: 'uppercase' as const, marginTop: 8 },
    agentLabelRow: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const, marginTop: 8 },
    error: { color: c.danger, fontSize: 13, marginTop: 10 },
    footer: { paddingTop: 12 },
  };
}
