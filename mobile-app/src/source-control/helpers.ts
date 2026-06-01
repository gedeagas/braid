import type { GitChange } from '@/transport/types';
import type { Palette } from '@/ui/theme';

export type ChangeGroupKey = 'staged' | 'changes' | 'untracked';

/** Stable identity for a change row (a file can appear both staged and unstaged). */
export function changeKey(change: GitChange): string {
  return `${change.file}::${change.staged ? 's' : 'u'}::${change.status}`;
}

/** Single-letter badge shown in the row. Untracked ('?') reads as 'U'. */
export function statusLetter(change: GitChange): string {
  return change.status === '?' ? 'U' : change.status;
}

/** Human label for the diff sheet / accessibility. */
export function statusLabel(change: GitChange): string {
  switch (change.status) {
    case 'A':
      return 'Added';
    case 'D':
      return 'Deleted';
    case 'R':
      return 'Renamed';
    case '?':
      return 'Untracked';
    case 'M':
    default:
      return 'Modified';
  }
}

/** Semantic color for a status letter, themed off the active palette. */
export function statusColor(change: GitChange, palette: Palette): string {
  switch (change.status) {
    case 'A':
      return palette.success;
    case 'D':
      return palette.danger;
    case 'R':
      return palette.accent;
    case '?':
      return palette.warning;
    case 'M':
    default:
      return change.staged ? palette.success : palette.warning;
  }
}

export interface ChangeGroup {
  key: ChangeGroupKey;
  title: string;
  changes: GitChange[];
}

/** Split a flat status list into the three source-control sections. */
export function groupChanges(changes: GitChange[]): ChangeGroup[] {
  const staged = changes.filter((change) => change.staged);
  const tracked = changes.filter((change) => !change.staged && change.status !== '?');
  const untracked = changes.filter((change) => !change.staged && change.status === '?');
  const groups: ChangeGroup[] = [];
  if (staged.length) groups.push({ key: 'staged', title: 'Staged Changes', changes: staged });
  if (tracked.length) groups.push({ key: 'changes', title: 'Changes', changes: tracked });
  if (untracked.length) groups.push({ key: 'untracked', title: 'Untracked Files', changes: untracked });
  return groups;
}

/** Files to pass to `git.stage` for "Stage All" (every unstaged path, deduped). */
export function unstagedFiles(changes: GitChange[]): string[] {
  return Array.from(new Set(changes.filter((change) => !change.staged).map((change) => change.file)));
}

/** Files to pass to `git.unstage` for "Unstage All" (every staged path, deduped). */
export function stagedFiles(changes: GitChange[]): string[] {
  return Array.from(new Set(changes.filter((change) => change.staged).map((change) => change.file)));
}

/**
 * One discard target per file for "Discard all". A file staged + modified is
 * collapsed to its staged entry, since `git.discard` on a staged change checks
 * the file out of HEAD (reverting both index and working tree).
 */
export function discardTargets(changes: GitChange[]): GitChange[] {
  const byFile = new Map<string, GitChange>();
  for (const change of changes) {
    const existing = byFile.get(change.file);
    if (!existing || (change.staged && !existing.staged)) byFile.set(change.file, change);
  }
  return Array.from(byFile.values());
}
