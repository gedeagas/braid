import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AddWorktreeDialog } from '../AddWorktreeDialog'

const mocks = vi.hoisted(() => {
  const project = {
    id: 'project-1',
    name: 'Project',
    path: '/repo/project',
    createdAt: 1,
    settings: {
      branchPrefix: '',
      copyFiles: [],
    },
    worktrees: [
      {
        id: 'wt-main',
        projectId: 'project-1',
        branch: 'master',
        path: '/repo/project',
        isMain: true,
        sessions: [],
      },
    ],
  }

  return {
    addWorktree: vi.fn(),
    getRemoteBranches: vi.fn(),
    getIssueByKey: vi.fn(),
    isJiraAvailable: vi.fn(),
    getFileInfo: vi.fn(),
    getIgnored: vi.fn(),
    openSettings: vi.fn(),
    setActiveCenterView: vi.fn(),
    createBigTerminal: vi.fn(),
    setLastNewTabAction: vi.fn(),
    project,
  }
})

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })

  return { promise, resolve, reject }
}

vi.mock('@/lib/ipc', () => ({
  git: {
    getRemoteBranches: mocks.getRemoteBranches,
  },
  jira: {
    getIssueByKey: mocks.getIssueByKey,
    isAvailable: mocks.isJiraAvailable,
  },
  files: {
    getFileInfo: mocks.getFileInfo,
    getIgnored: mocks.getIgnored,
  },
  cleanIpcError: (_error: unknown, fallback: string) => fallback,
}))

vi.mock('@/store/projects', () => ({
  useProjectsStore: vi.fn((selector: (state: unknown) => unknown) => selector({
    projects: [mocks.project],
    addWorktree: mocks.addWorktree,
  })),
}))

vi.mock('@/store/ui', () => {
  const state = {
    defaultBranchPrefix: '',
    discoveryPatterns: [],
    jiraBaseUrl: '',
    openSettings: mocks.openSettings,
    setActiveCenterView: mocks.setActiveCenterView,
    createBigTerminal: mocks.createBigTerminal,
    lastNewTabAction: 'agent:claude',
    setLastNewTabAction: mocks.setLastNewTabAction,
  }
  const useUIStore = vi.fn((selector: (s: typeof state) => unknown) => selector(state))
  Object.assign(useUIStore, { getState: () => state })

  return { useUIStore }
})

vi.mock('@/lib/agentDetection', () => ({
  useDetectedAgents: () => [
    { id: 'claude', label: 'Claude Code', detectCmd: 'claude', launchCmd: 'claude' },
    { id: 'codex', label: 'Codex', detectCmd: 'codex', launchCmd: 'codex' },
  ],
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('@/components/ui', () => ({
  Badge: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  Button: ({ children, loading: _loading, variant: _variant, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean; variant?: string }) => (
    <button {...props}>{children}</button>
  ),
  Checkbox: ({ checked, onChange, label, disabled }: { checked: boolean; onChange: (checked: boolean) => void; label?: string; disabled?: boolean }) => (
    <label>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
      {label}
    </label>
  ),
  Combobox: ({ children, disabled }: { children: React.ReactNode; disabled?: boolean }) => (
    <button disabled={disabled}>{children}</button>
  ),
  Dialog: ({ isOpen, title, children, actions, className }: { isOpen: boolean; title?: string; children: React.ReactNode; actions?: React.ReactNode; className?: string }) => (
    isOpen ? (
      <section className={className}>
        <h2>{title}</h2>
        {children}
        <footer>{actions}</footer>
      </section>
    ) : null
  ),
  Spinner: () => <span data-testid="spinner" />,
}))

describe('AddWorktreeDialog', () => {
  afterEach(() => {
    cleanup()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.addWorktree.mockResolvedValue(undefined)
    mocks.getFileInfo.mockResolvedValue([])
    mocks.getIgnored.mockResolvedValue([])
    mocks.isJiraAvailable.mockResolvedValue(true)
    mocks.createBigTerminal.mockReturnValue('terminal-1')
    mocks.getIssueByKey.mockResolvedValue({
      key: 'USRN-10110',
      summary: 'Fix cart total',
      description: 'Cart total is wrong',
      acceptanceCriteria: null,
      status: 'In Progress',
      statusCategory: 'indeterminate',
      type: 'Bug',
      assignee: null,
      priority: 'High',
      labels: [],
      components: [],
      parent: null,
      epic: null,
      comments: [],
      linkedIssues: [],
      attachments: [],
      url: 'https://jira.example/browse/USRN-10110',
    })
  })

  it('keeps a Jira-derived branch when remote branches finish loading afterward', async () => {
    const remoteBranches = deferred<{ branches: string[]; defaultBranch?: string }>()
    mocks.getRemoteBranches.mockReturnValue(remoteBranches.promise)

    render(
      <AddWorktreeDialog
        projectId="project-1"
        repoPath="/repo/project"
        onClose={vi.fn()}
      />
    )

    const jiraInput = await screen.findByPlaceholderText('jiraPlaceholder')
    fireEvent.paste(jiraInput, {
      clipboardData: { getData: () => 'USRN-10110' },
    })

    const branchInput = document.querySelector('.add-worktree-branch-row input') as HTMLInputElement
    const jiraBranch = 'USRN-10110-fix-cart-total'
    await waitFor(() => expect(branchInput.value).toBe(jiraBranch))

    remoteBranches.resolve({ branches: ['origin/master'], defaultBranch: 'origin/master' })

    await waitFor(() => expect(branchInput.disabled).toBe(false))
    expect(branchInput.value).toBe(jiraBranch)
  })

  it('starts the selected terminal agent with Jira context after creating a Jira worktree', async () => {
    mocks.getRemoteBranches.mockResolvedValue({ branches: ['origin/master'], defaultBranch: 'origin/master' })
    mocks.addWorktree.mockResolvedValue({
      id: 'wt-jira',
      projectId: 'project-1',
      branch: 'USRN-10110-fix-cart-total',
      path: '/repo/project-USRN-10110',
      isMain: false,
      sessions: [],
    })
    const onClose = vi.fn()

    render(
      <AddWorktreeDialog
        projectId="project-1"
        repoPath="/repo/project"
        onClose={onClose}
      />
    )

    const jiraInput = await screen.findByPlaceholderText('jiraPlaceholder')
    fireEvent.paste(jiraInput, {
      clipboardData: { getData: () => 'USRN-10110' },
    })

    const branchInput = document.querySelector('.add-worktree-branch-row input') as HTMLInputElement
    await waitFor(() => expect(branchInput.value).toBe('USRN-10110-fix-cart-total'))
    expect(mocks.getIssueByKey).toHaveBeenCalledWith('USRN-10110', undefined, undefined, true)
    const createButtons = screen.getAllByText('create')
    fireEvent.click(createButtons[createButtons.length - 1])

    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(mocks.setLastNewTabAction).toHaveBeenCalledWith('agent:claude')
    expect(mocks.createBigTerminal).toHaveBeenCalledWith(
      'wt-jira',
      'Claude Code',
      'claude',
      'claude',
      expect.stringContaining('USRN-10110: Fix cart total'),
    )
    expect(mocks.setActiveCenterView).toHaveBeenCalledWith({ type: 'terminal', terminalId: 'terminal-1' })
  })

  it('pastes a compact link instead of full context when "Link only" is selected', async () => {
    mocks.getRemoteBranches.mockResolvedValue({ branches: ['origin/master'], defaultBranch: 'origin/master' })
    mocks.addWorktree.mockResolvedValue({
      id: 'wt-jira',
      projectId: 'project-1',
      branch: 'USRN-10110-fix-cart-total',
      path: '/repo/project-USRN-10110',
      isMain: false,
      sessions: [],
    })
    const onClose = vi.fn()

    render(
      <AddWorktreeDialog
        projectId="project-1"
        repoPath="/repo/project"
        onClose={onClose}
      />
    )

    const jiraInput = await screen.findByPlaceholderText('jiraPlaceholder')
    fireEvent.paste(jiraInput, {
      clipboardData: { getData: () => 'USRN-10110' },
    })

    const branchInput = document.querySelector('.add-worktree-branch-row input') as HTMLInputElement
    await waitFor(() => expect(branchInput.value).toBe('USRN-10110-fix-cart-total'))

    fireEvent.click(await screen.findByText('jiraContextLink'))

    const createButtons = screen.getAllByText('create')
    fireEvent.click(createButtons[createButtons.length - 1])

    await waitFor(() => expect(onClose).toHaveBeenCalled())
    const initialInput = mocks.createBigTerminal.mock.calls.at(-1)?.[4] as string
    expect(initialInput).toContain('Start work on Jira ticket USRN-10110: Fix cart total')
    expect(initialInput).not.toContain('BEGIN JIRA TICKET')
  })
})
