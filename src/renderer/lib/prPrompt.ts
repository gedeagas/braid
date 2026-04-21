export const DEFAULT_PR_PROMPT = `Create a pull request for the current branch.

Steps:
1. Check if the current branch has an upstream remote. If not, push it with \`git push -u origin HEAD\`.
2. If there are unpushed commits, push them.
3. Compute the merge-base ONCE and store it, then use it for all subsequent git commands. This avoids races if the base branch advances mid-flow:
   \`\`\`
   BASE=$(git merge-base HEAD <base-branch>)
   git log $BASE..HEAD --oneline
   git diff $BASE..HEAD --stat
   git diff $BASE..HEAD
   \`\`\`
   IMPORTANT: Cross-check the diff output against the commit list. If the diff contains files or features not mentioned in any commit message, re-run with a fresh merge-base - the base branch may have changed.
4. Read the PR template file. Check these locations in order and read the first one found:
   - \`.github/pull_request_template.md\`
   - \`.github/PULL_REQUEST_TEMPLATE.md\`
   - \`docs/pull_request_template.md\`
   - \`.github/PULL_REQUEST_TEMPLATE/\` directory
   You MUST actually read the file contents before writing the PR body. If a template exists, use its exact section structure.
5. Write the PR title and body based ONLY on the commits and diff from step 3. Do not describe changes that are not in the diff. If the diff is large, focus on the commit messages and diffstat to avoid hallucinating details from truncated output.
6. Create the PR using \`gh pr create\`, filling in the template sections (if found) or summarizing the changes clearly.

Do not ask me for confirmation — just go ahead and create it.`
