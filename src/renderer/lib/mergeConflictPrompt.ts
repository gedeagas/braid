export const DEFAULT_MERGE_CONFLICT_PROMPT = `Please resolve the merge conflicts:
1. \`git fetch origin\`
2. \`git rebase origin/{{baseBranch}}\`
3. Resolve conflicts in each file
4. \`git rebase --continue\`
5. \`git push --force-with-lease\`

Do not ask for confirmation - just go ahead and fix the conflicts.`
