export const DEFAULT_PR_PROMPT = `Create a pull request for the current branch.

Steps:
1. Check if the current branch has an upstream remote. If not, push it with \`git push -u origin HEAD\`.
2. If there are unpushed commits, push them.
3. Look for a PR template file in any of these locations:
   - \`.github/pull_request_template.md\`
   - \`.github/PULL_REQUEST_TEMPLATE.md\`
   - \`docs/pull_request_template.md\`
   - \`.github/PULL_REQUEST_TEMPLATE/\` directory
4. If a template exists, follow its structure and guidelines when writing the PR description. Fill in each section thoughtfully based on the actual changes.
5. Review only the commits and changes introduced by this branch. Use the merge-base to avoid including unrelated changes from the base branch:
   - \`git log $(git merge-base HEAD <base-branch>)..HEAD --oneline\` to see commits on this branch only
   - \`git diff $(git merge-base HEAD <base-branch>)..HEAD\` to see the combined diff of this branch's changes
   This ensures the comparison is accurate even if the base branch (e.g. main) has newer commits that are not yet in this branch.
6. Create the PR using \`gh pr create\`, with a clear title and a well-written description that follows the template (if found) or otherwise summarizes the changes clearly.

Do not ask me for confirmation — just go ahead and create it.`
