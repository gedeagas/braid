// Agent-facing docs for the Braid browser. The installed SKILL.md is a thin
// discovery stub; the full guide comes from the running CLI
// (`braid-browser guide`) so it always matches the installed Braid version.
import { BROWSER_TOOLS } from '../../../../shared/browserTools'

export const SKILL_NAME = 'braid-browser'

export function skillStub(): string {
  return `---
name: ${SKILL_NAME}
description: Drive the Braid in-app browser for the current worktree - open local dev servers and docs, read the page as an outline with element refs, click, fill forms, press keys, take screenshots, read console and network logs, emulate mobile viewports. Use when a task needs to look at or interact with a web page and you are running inside a Braid terminal.
---

# Braid browser

Braid gives every worktree its own browser. These are the same tabs the user sees, so open what you need and leave the user's tabs alone unless asked.

1. Resolve the CLI: \`braid-browser\` is on PATH in Braid terminals; otherwise use \`~/.braid/bin/braid-browser\`. If neither exists, Braid is not installed here - do not use this skill.
2. Before first use in a session, load the full guide: \`braid-browser guide\`. It matches the installed Braid version. Do not invent commands or flags from memory.
3. Work in a loop: \`braid-browser open <url>\` -> \`braid-browser snapshot\` -> act on refs (\`braid-browser click e12\`, \`braid-browser fill e5 "text" --submit\`) -> snapshot again. Refs change after navigation.

Add \`--json\` when you need machine-readable output.
`
}

function cliName(tool: string): string {
  return tool.replace(/^browser_/, '').replace(/_/g, '-')
}

/** Full, version-matched guide printed by `braid-browser guide`. */
export function guideText(): string {
  const commands = BROWSER_TOOLS.map((t) => {
    const params = Object.entries(t.params)
      .map(([k, p]) => `${p.optional ? '[' : ''}--${k.replace(/_/g, '-')} <${p.enum ? p.enum.join('|') : p.type}>${p.optional ? ']' : ''}`)
      .join(' ')
    const details = Object.entries(t.params).map(([k, p]) => `      --${k.replace(/_/g, '-')}: ${p.description}`).join('\n')
    return `  ${cliName(t.name)} ${params}\n      ${t.description}${details ? `\n${details}` : ''}`
  }).join('\n\n')

  return `# Braid browser - agent guide

The Braid browser is per worktree: the CLI acts on the worktree that contains
your current directory. Tabs are shared with the user, who may be watching.

## Workflow

1. Open the page:        braid-browser open localhost:3000
   (reuses the tab you last used; add --new-tab for a separate tab,
   --show to switch the user's view to it)
2. Read it:              braid-browser snapshot
   Prints headings, landmarks, text and every interactive element with a ref
   like [e12]. Take a new snapshot after anything that changes the page.
3. Act on refs:          braid-browser click e12
                         braid-browser fill e5 "user@example.com" --submit
                         braid-browser press Enter
                         braid-browser select-option e7 "Large"
4. Verify:               braid-browser snapshot   (or screenshot / wait-for)

## Tips

- Prefer snapshot over screenshot: it is cheaper and gives refs to act on.
  screenshot prints the path of a PNG you can open.
- wait-for --text "Saved" after actions that load data.
- console --level error and network --failed-only explain broken pages.
- set-viewport --width 390 --height 844 --mobile for responsive checks;
  set-viewport --width 0 resets it.
- evaluate runs JavaScript in the page; return JSON-serializable values.
- --json prints the raw result object (text, imageBase64, isError).
- Exit code 1 means the command failed; the message says why.

## Commands

Positional shortcuts: open <url>, click <ref>, hover <ref>, fill <ref> <text>,
type <text>, press <key>, select-option <ref> <value>, eval <js>,
select-tab <tab-id>, close-tab <tab-id>, wait-for <text>.

${commands}
`
}
