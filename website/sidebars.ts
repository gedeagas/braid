import type { SidebarsConfig } from '@docusaurus/plugin-content-docs'

const sidebars: SidebarsConfig = {
  docs: [
    {
      type: 'category',
      label: 'Get Started',
      collapsed: false,
      items: [
        'getting-started/installation',
        'getting-started/first-project',
        'getting-started/first-chat',
      ],
    },
    {
      type: 'category',
      label: 'Features',
      collapsed: false,
      items: [
        'features/projects-and-worktrees',
        'features/chat-with-claude',
        'features/tool-calls',
        'features/plan-mode',
        'features/mission-control',
        'features/file-editor',
        'features/diff-review',
        'features/terminal',
        'features/git-changes',
        'features/pr-checks',
        'features/notes',
      ],
    },
    {
      type: 'category',
      label: 'Integrations',
      items: [
        'integrations/mobile-development',
        'integrations/jira',
        'integrations/lsp',
        'integrations/window-capture',
        'integrations/braid-mcp',
      ],
    },
    {
      type: 'category',
      label: 'Workflows',
      items: [
        'workflows/multi-worktree-dev',
        'workflows/code-review-cycle',
        'workflows/session-management',
        'workflows/multi-agent',
      ],
    },
    {
      type: 'category',
      label: 'Settings',
      items: [
        'settings/general',
        'settings/appearance',
        'settings/ai',
        'settings/git',
        'settings/notifications',
        'settings/editor-terminal',
        'settings/project-settings',
        'settings/run-scripts',
        'settings/apps',
        {
          type: 'category',
          label: 'Claude Config',
          items: [
            'settings/claude-permissions',
            'settings/claude-hooks',
            'settings/claude-instructions',
            'settings/claude-skills',
            'settings/claude-mcp',
            'settings/claude-plugins',
          ],
        },
        'settings/analytics',
        'settings/about',
      ],
    },
    {
      type: 'category',
      label: 'Reference',
      items: [
        'reference/keyboard-shortcuts',
        'reference/supported-platforms',
      ],
    },
  ],
}

export default sidebars
