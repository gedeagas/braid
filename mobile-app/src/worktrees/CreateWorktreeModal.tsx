import { useEffect, useReducer, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { Check, X } from 'lucide-react-native';
import * as SecureStore from 'expo-secure-store';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AGENT_CATALOG } from '@/terminal/agentCatalog';
import { AgentIcon } from '@/terminal/AgentIcon';
import { useDetectedAgents } from '@/terminal/useDetectedAgents';
import type { BraidRpcClient } from '@/transport/rpc-client';
import type { BraidProject } from '@/transport/types';
import { useShared, useTheme, useThemedStyles, type Palette } from '@/ui/theme';
import { Button, SearchPicker, SelectField, type SearchPickerOption } from '@/ui/kit';
import { deriveBranchFromJira, extractJiraKey, type JiraIssueLite } from './jiraBranch';

// Shared with the terminal screen: a worktree's chosen agent becomes the
// default the terminal picker opens with.
const DEFAULT_AGENT_STORAGE_KEY = 'braid.mobile.terminal.defaultAgentId';

// Mirror the desktop default: prefer main, then master, then the repo's first
// branch. Tolerates remote-prefixed names (e.g. "origin/main").
function pickDefaultBranch(branches: string[]): string | null {
  const byName = (name: string) => branches.find((b) => b === name || b.endsWith(`/${name}`));
  return byName('main') ?? byName('master') ?? branches[0] ?? null;
}

// An env/secret file from the main worktree the user can copy into the new one.
interface CopyFileItem {
  path: string;
  size: number;
  checked: boolean;
}

// Shape of the desktop's worktrees.copyCandidates RPC result.
interface CopyCandidatesResult {
  sourceBranch: string | null;
  saved: { path: string; size: number }[];
  discovered: { path: string; size: number }[];
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
  // Jira lookup (only used when the desktop advertises the jira capability AND
  // the acli CLI is installed). Mirrors the desktop JiraLookupField.
  jiraAvailable: boolean;
  jiraInput: string;
  jiraLoading: boolean;
  jiraIssue: JiraIssueLite | null;
  jiraError: string | null;
  // Copy-files (only used when the desktop advertises the copy-files capability).
  // Mirrors the desktop AddWorktreeDialog's CopyFilesSection.
  copyFiles: CopyFileItem[];
  copyLoading: boolean;
}

type PickerKind = 'project' | 'branch' | 'agent';

const INITIAL: State = {
  projectId: null,
  branch: '',
  baseBranch: null,
  agentId: AGENT_CATALOG[0]?.id ?? 'claude',
  branches: [],
  branchesLoading: false,
  busy: false,
  error: null,
  jiraAvailable: false,
  jiraInput: '',
  jiraLoading: false,
  jiraIssue: null,
  jiraError: null,
  copyFiles: [],
  copyLoading: false,
};

/**
 * Create a worktree without leaving the host screen: pick the project and base
 * branch from full-screen searchable pickers, name the branch, and optionally
 * choose which agent the new worktree opens with. The picker route avoids
 * nested searchable dropdowns fighting the keyboard inside the bottom sheet.
 */
export function CreateWorktreeModal({
  visible,
  onClose,
  client,
  projects,
  jiraCapable = false,
  copyFilesCapable = false,
  onCreated,
}: {
  visible: boolean;
  onClose: () => void;
  client: BraidRpcClient | null;
  projects: BraidProject[];
  /** Desktop advertises the `jira.lookup.v1` capability. */
  jiraCapable?: boolean;
  /** Desktop advertises the `worktree.copy-files.v1` capability. */
  copyFilesCapable?: boolean;
  onCreated: (project: BraidProject, branch: string, agentId: string, worktreePath?: string) => void;
}) {
  const { t } = useTranslation();
  const { palette: c } = useTheme();
  const shared = useShared();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const detectedAgents = useDetectedAgents(client);
  const [state, patch] = useReducer((prev: State, next: Partial<State>) => ({ ...prev, ...next }), INITIAL);
  const [picker, setPicker] = useState<PickerKind | null>(null);
  // Monotonic id to discard stale Jira lookups (a fast second key supersedes a
  // slow first one).
  const jiraLookupIdRef = useRef(0);

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

  // Mirror the desktop's useJiraAvailable: once the sheet opens against a
  // jira-capable desktop, ask whether the acli CLI is actually installed. The
  // field stays hidden until this resolves true.
  useEffect(() => {
    if (!visible || !client || !jiraCapable) return;
    let active = true;
    client
      .request<boolean>('jira.isAvailable', {})
      .then((available) => {
        if (active) patch({ jiraAvailable: available });
      })
      .catch(() => {
        if (active) patch({ jiraAvailable: false });
      });
    return () => {
      active = false;
    };
  }, [visible, client, jiraCapable]);

  const lookupJira = async (raw: string) => {
    if (!client) return;
    const key = extractJiraKey(raw);
    if (!key) {
      patch({ jiraIssue: null, jiraError: raw.trim() ? t('worktree.jiraInvalidKey') : null });
      return;
    }
    const id = ++jiraLookupIdRef.current;
    patch({ jiraLoading: true, jiraError: null, jiraIssue: null });
    try {
      const issue = await client.request<JiraIssueLite | null>('jira.getIssueByKey', { key });
      if (id !== jiraLookupIdRef.current) return;
      if (!issue) {
        patch({ jiraLoading: false, jiraError: t('worktree.jiraNotFound', { key }) });
        return;
      }
      patch({ jiraLoading: false, jiraIssue: issue, branch: deriveBranchFromJira(issue.key, issue.summary) });
    } catch (err) {
      if (id !== jiraLookupIdRef.current) return;
      patch({ jiraLoading: false, jiraError: err instanceof Error ? err.message : t('worktree.jiraLookupFailed') });
    }
  };

  const onJiraChange = (value: string) => {
    // Clearing the field discards stale ticket context but keeps the branch the
    // user may have since edited.
    if (!value.trim()) patch({ jiraInput: value, jiraIssue: null, jiraError: null });
    else patch({ jiraInput: value });
  };

  const showJira = jiraCapable && state.jiraAvailable;

  // Fetch the main worktree's copy-file candidates for the selected project
  // (saved copyFiles + auto-discovered env/secret files), mirroring the desktop
  // CopyFilesSection. Saved files default checked; discovered default unchecked.
  useEffect(() => {
    if (!visible || !client || !copyFilesCapable || !selectedProject) {
      patch({ copyFiles: [], copyLoading: false });
      return;
    }
    let active = true;
    patch({ copyLoading: true });
    client
      .request<CopyCandidatesResult>('worktrees.copyCandidates', { repoPath: selectedProject.path })
      .then((result) => {
        if (!active) return;
        const copyFiles: CopyFileItem[] = [
          ...result.saved.map((f) => ({ path: f.path, size: f.size, checked: true })),
          ...result.discovered.map((f) => ({ path: f.path, size: f.size, checked: false })),
        ];
        patch({ copyFiles, copyLoading: false });
      })
      .catch(() => {
        if (active) patch({ copyFiles: [], copyLoading: false });
      });
    return () => {
      active = false;
    };
  }, [visible, client, copyFilesCapable, selectedProject]);

  const toggleCopyFile = (path: string) => {
    patch({
      copyFiles: state.copyFiles.map((f) => (f.path === path ? { ...f, checked: !f.checked } : f)),
    });
  };

  const showCopyFiles = copyFilesCapable && (state.copyLoading || state.copyFiles.length > 0);

  const close = () => {
    setPicker(null);
    patch(INITIAL);
    onClose();
  };

  const create = async () => {
    if (!client || !selectedProject || !state.branch.trim() || state.busy) return;
    patch({ busy: true, error: null });
    try {
      const filesToCopy = state.copyFiles.filter((f) => f.checked).map((f) => f.path);
      const result = await client.request<{ worktreePath?: string }>('worktrees.create', {
        repoPath: selectedProject.path,
        projectName: selectedProject.name,
        branch: state.branch.trim(),
        baseBranch: state.baseBranch ?? undefined,
        filesToCopy: filesToCopy.length > 0 ? filesToCopy : undefined,
      });
      await SecureStore.setItemAsync(DEFAULT_AGENT_STORAGE_KEY, state.agentId).catch(() => undefined);
      const branch = state.branch.trim();
      const agentId = state.agentId;
      patch(INITIAL);
      onClose();
      onCreated(selectedProject, branch, agentId, result?.worktreePath);
    } catch (err) {
      patch({ busy: false, error: err instanceof Error ? err.message : String(err) });
    }
  };

  const projectOptions: SearchPickerOption[] = projects.map((project) => ({
    value: project.id,
    label: project.name,
    detail: project.path,
  }));
  const branchOptions: SearchPickerOption[] = state.branches.map((branch) => ({ value: branch, label: branch }));
  // Surface installed agents first (reusing the terminal screen's detection),
  // each with its brand icon; remaining agents follow, marked "not installed".
  const detectedIds = new Set(detectedAgents.map((agent) => agent.id));
  const agentOptions: SearchPickerOption[] = [...AGENT_CATALOG]
    .sort((a, b) => Number(detectedIds.has(b.id)) - Number(detectedIds.has(a.id)))
    .map((agent) => ({
      value: agent.id,
      label: agent.label,
      detail: detectedIds.has(agent.id) ? t('worktree.agentInstalled') : t('worktree.agentNotInstalled'),
      icon: <AgentIcon agentId={agent.id} size={18} />,
    }));
  const canCreate = !!selectedProject && state.branch.trim().length > 0 && !state.busy;
  const panelMaxHeight = Math.max(420, Math.round(height * 0.88));
  const panelMinHeight = Math.min(560, Math.round(height * 0.68));
  const selectedAgent = agentOptions.find((agent) => agent.value === state.agentId);
  const pickerOptions =
    picker === 'project'
      ? projectOptions
      : picker === 'branch'
        ? branchOptions
        : picker === 'agent'
          ? agentOptions
          : [];
  const pickerValue =
    picker === 'project'
      ? state.projectId
      : picker === 'branch'
        ? state.baseBranch
        : picker === 'agent'
          ? state.agentId
          : null;
  const pickerTitle =
    picker === 'project'
      ? t('worktree.chooseProject')
      : picker === 'branch'
        ? t('worktree.chooseBaseBranch')
        : t('worktree.chooseAgent');
  const pickerPlaceholder =
    picker === 'project'
      ? t('worktree.searchProjects')
      : picker === 'branch'
        ? t('worktree.searchBranches')
        : t('worktree.searchAgents');
  const onPickerSelect = (value: string) => {
    if (picker === 'project') patch({ projectId: value, baseBranch: null, branches: [] });
    else if (picker === 'branch') patch({ baseBranch: value });
    else if (picker === 'agent') patch({ agentId: value });
    setPicker(null);
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={picker !== null ? () => setPicker(null) : close}
    >
      {picker !== null ? (
        <SearchPicker
          visible
          title={pickerTitle}
          placeholder={pickerPlaceholder}
          options={pickerOptions}
          value={pickerValue}
          onSelect={onPickerSelect}
          onClose={() => setPicker(null)}
        />
      ) : (
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.keyboard}
        >
          <Pressable style={styles.backdrop} onPress={close}>
            <Pressable
              style={[
                styles.panel,
                {
                  minHeight: panelMinHeight,
                  maxHeight: panelMaxHeight,
                  paddingBottom: Math.max(16, insets.bottom + 12),
                },
              ]}
              onPress={() => undefined}
            >
              <View style={styles.header}>
                <Text style={shared.title}>{t('worktree.title')}</Text>
                <Pressable style={styles.close} onPress={close} accessibilityLabel={t('common.close')}>
                  <X color={c.text} size={18} />
                </Pressable>
              </View>

              <ScrollView
                style={styles.bodyScroll}
                contentContainerStyle={styles.body}
                keyboardDismissMode="interactive"
                keyboardShouldPersistTaps="handled"
              >
                <Text style={styles.label}>{t('worktree.projectLabel')}</Text>
                <SelectField
                  label={selectedProject?.name ?? t('worktree.selectProject')}
                  detail={selectedProject?.path}
                  placeholder={!selectedProject}
                  onPress={() => setPicker('project')}
                />

                <View style={styles.agentLabelRow}>
                  <Text style={styles.label}>{t('worktree.baseBranchLabel')}</Text>
                  {state.branchesLoading && <ActivityIndicator color={c.muted} size="small" />}
                </View>
                <SelectField
                  label={
                    state.branchesLoading
                      ? t('worktree.loadingBranches')
                      : state.baseBranch ?? (state.branches.length === 0 ? t('worktree.noBranchesFound') : t('worktree.selectBaseBranch'))
                  }
                  placeholder={!state.baseBranch}
                  disabled={state.branchesLoading || state.branches.length === 0}
                  onPress={() => setPicker('branch')}
                />

                {showJira && (
                  <>
                    <View style={styles.agentLabelRow}>
                      <Text style={styles.label}>{t('worktree.jiraTicketLabel')}</Text>
                      {state.jiraLoading && <ActivityIndicator color={c.muted} size="small" />}
                    </View>
                    <TextInput
                      value={state.jiraInput}
                      onChangeText={onJiraChange}
                      onSubmitEditing={(e) => lookupJira(e.nativeEvent.text)}
                      onEndEditing={(e) => {
                        if (e.nativeEvent.text.trim()) lookupJira(e.nativeEvent.text);
                      }}
                      placeholder={t('worktree.jiraPlaceholder')}
                      placeholderTextColor={c.subtle}
                      autoCapitalize="characters"
                      autoCorrect={false}
                      returnKeyType="search"
                      style={shared.input}
                    />
                    {state.jiraError && <Text style={styles.error}>{state.jiraError}</Text>}
                    {state.jiraIssue && (
                      <View style={styles.jiraCard}>
                        <View style={styles.jiraCardHeader}>
                          <Text style={styles.jiraKey}>{state.jiraIssue.key}</Text>
                          <Text style={styles.jiraSummary} numberOfLines={2}>
                            {state.jiraIssue.summary}
                          </Text>
                        </View>
                        <View style={styles.jiraCardMeta}>
                          <Text style={styles.jiraType}>{state.jiraIssue.type}</Text>
                          <Text style={[styles.jiraStatus, { color: jiraStatusColor(c, state.jiraIssue.statusCategory) }]}>
                            {state.jiraIssue.status}
                          </Text>
                        </View>
                      </View>
                    )}
                  </>
                )}

                <Text style={styles.label}>{t('worktree.branchNameLabel')}</Text>
                <TextInput
                  value={state.branch}
                  onChangeText={(value) => patch({ branch: value })}
                  placeholder={t('worktree.branchNamePlaceholder')}
                  placeholderTextColor={c.subtle}
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={shared.input}
                />

                <Text style={styles.label}>{t('worktree.agentLabel')}</Text>
                <SelectField
                  label={selectedAgent?.label ?? state.agentId}
                  detail={selectedAgent?.detail}
                  icon={selectedAgent?.icon}
                  onPress={() => setPicker('agent')}
                />

                {showCopyFiles && (
                  <>
                    <View style={styles.agentLabelRow}>
                      <Text style={styles.label}>{t('worktree.copyFilesLabel')}</Text>
                      {state.copyLoading && <ActivityIndicator color={c.muted} size="small" />}
                    </View>
                    {state.copyFiles.length > 0 && (
                      <View style={styles.copyList}>
                        {state.copyFiles.map((file, index) => (
                          <Pressable
                            key={file.path}
                            style={[styles.copyRow, index > 0 && styles.copyRowDivider]}
                            onPress={() => toggleCopyFile(file.path)}
                          >
                            <View style={[styles.checkbox, file.checked && styles.checkboxOn]}>
                              {file.checked && <Check color="#FFFFFF" size={13} strokeWidth={3} />}
                            </View>
                            <Text style={styles.copyPath} numberOfLines={1}>
                              {file.path}
                            </Text>
                            <Text style={styles.copySize}>{formatBytes(file.size)}</Text>
                          </Pressable>
                        ))}
                      </View>
                    )}
                  </>
                )}

                {state.error && <Text style={styles.error}>{state.error}</Text>}
              </ScrollView>

              <View style={styles.footer}>
                <Button
                  label={state.busy ? t('worktree.creating') : t('worktree.createWorktree')}
                  onPress={create}
                  disabled={!canCreate}
                  icon={state.busy ? <ActivityIndicator color="#FFFFFF" size="small" /> : undefined}
                />
              </View>
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      )}
    </Modal>
  );
}

// Compact byte size for the copy-files list (e.g. "812 B", "4.2 KB", "1.1 MB").
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Tint the status text by its category, matching the desktop's status badges.
function jiraStatusColor(c: Palette, category: JiraIssueLite['statusCategory']): string {
  if (category === 'done') return c.success;
  if (category === 'indeterminate') return c.accent;
  return c.muted;
}

function makeStyles(c: Palette) {
  return {
    keyboard: { flex: 1 },
    backdrop: { flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.55)', justifyContent: 'flex-end' as const },
    panel: {
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.bg,
      paddingHorizontal: 18,
      paddingTop: 14,
    },
    header: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const, marginBottom: 8 },
    close: { width: 34, height: 34, borderRadius: 17, alignItems: 'center' as const, justifyContent: 'center' as const, backgroundColor: c.panelStrong },
    bodyScroll: { flex: 1 },
    body: { gap: 8, paddingVertical: 12 },
    label: { color: c.subtle, fontSize: 12, fontWeight: '800' as const, textTransform: 'uppercase' as const, marginTop: 8 },
    agentLabelRow: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const, marginTop: 8 },
    error: { color: c.danger, fontSize: 13, marginTop: 10 },
    footer: { paddingTop: 12 },
    jiraCard: {
      marginTop: 10,
      padding: 12,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.panel,
      gap: 8,
    },
    jiraCardHeader: { flexDirection: 'row' as const, alignItems: 'flex-start' as const, gap: 8 },
    jiraKey: { color: c.accent, fontSize: 13, fontWeight: '800' as const },
    jiraSummary: { flex: 1, color: c.text, fontSize: 13 },
    jiraCardMeta: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const },
    jiraType: { color: c.subtle, fontSize: 12, fontWeight: '700' as const, textTransform: 'uppercase' as const },
    jiraStatus: { fontSize: 12, fontWeight: '700' as const },
    copyList: {
      marginTop: 6,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.panel,
      overflow: 'hidden' as const,
    },
    copyRow: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: 10,
      paddingHorizontal: 12,
      paddingVertical: 11,
    },
    copyRowDivider: { borderTopWidth: 1, borderTopColor: c.border },
    checkbox: {
      width: 20,
      height: 20,
      borderRadius: 6,
      borderWidth: 1.5,
      borderColor: c.border,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
    },
    checkboxOn: { backgroundColor: c.accent, borderColor: c.accent },
    copyPath: { flex: 1, color: c.text, fontSize: 13 },
    copySize: { color: c.subtle, fontSize: 11, fontVariant: ['tabular-nums' as const] },
  };
}
