import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Worktree } from '@/types'
import { WorktreeRow } from '../WorktreeRow'

const mocks = vi.hoisted(() => ({
  removeWorktree: vi.fn(),
  selectWorktree: vi.fn(),
  setMissionControlActive: vi.fn(),
  togglePinWorktree: vi.fn(),
  setSkipDeleteWorktreeConfirm: vi.fn(),
  setNewlyAddedWorktreeId: vi.fn(),
  flash: vi.fn(),
  skipDeleteWorktreeConfirm: false,
}))

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })

  return { promise, resolve, reject }
}

vi.mock('@/store/projects', () => ({
  useProjectsStore: vi.fn((selector: (state: { removeWorktree: typeof mocks.removeWorktree }) => unknown) =>
    selector({ removeWorktree: mocks.removeWorktree })
  ),
}))

vi.mock('@/store/ui', () => {
  const state = {
    selectedWorktreeId: null,
    selectWorktree: mocks.selectWorktree,
    setMissionControlActive: mocks.setMissionControlActive,
    pinnedWorktrees: new Set<string>(),
    togglePinWorktree: mocks.togglePinWorktree,
    get skipDeleteWorktreeConfirm() { return mocks.skipDeleteWorktreeConfirm },
    setSkipDeleteWorktreeConfirm: mocks.setSkipDeleteWorktreeConfirm,
    bigTerminalsByWorktree: {},
    bigTerminalStatusById: {},
    setNewlyAddedWorktreeId: mocks.setNewlyAddedWorktreeId,
  }

  return {
    useUIStore: vi.fn((selector: (value: typeof state) => unknown) => selector(state)),
  }
})

vi.mock('@/store/sessions', () => ({
  useSessionsForWorktree: () => [],
}))

vi.mock('@/store/flash', () => ({ flash: mocks.flash }))

vi.mock('@/lib/ipc', () => ({
  cleanIpcError: (_error: unknown, fallback: string) => fallback,
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('../StatusDot', () => ({ StatusDot: () => <span /> }))
vi.mock('../PrIcon', () => ({ PrIcon: () => <span /> }))
vi.mock('@/components/shared/Tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

const worktree: Worktree = {
  id: 'wt-feature',
  projectId: 'project-1',
  branch: 'feature/loading',
  path: '/repo/feature-loading',
  isMain: false,
  sessions: [],
}

function renderRow() {
  return render(
    <WorktreeRow
      worktree={worktree}
      dragOverId={null}
      draggingId={null}
      isFocused
    />
  )
}

function openDeleteDialog() {
  const row = screen.getByRole('option')
  fireEvent.keyDown(row, { key: 'Delete' })
  return screen.getByRole('dialog')
}

describe('WorktreeRow deletion', () => {
  afterEach(() => {
    cleanup()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.skipDeleteWorktreeConfirm = false
    mocks.removeWorktree.mockResolvedValue(undefined)
  })

  it('keeps the confirmation open and shows loading state while deleting', async () => {
    const removal = deferred<void>()
    mocks.removeWorktree.mockReturnValue(removal.promise)
    renderRow()

    const dialog = openDeleteDialog()
    const cancelButton = within(dialog).getByRole('button', { name: 'cancel' }) as HTMLButtonElement
    const deleteButton = within(dialog).getByRole('button', { name: 'deleteWorktreeConfirm' }) as HTMLButtonElement
    const checkbox = within(dialog).getByRole('checkbox') as HTMLInputElement

    fireEvent.click(checkbox)
    fireEvent.click(deleteButton)

    await waitFor(() => expect(mocks.removeWorktree).toHaveBeenCalledWith('project-1', 'wt-feature'))
    expect(mocks.setSkipDeleteWorktreeConfirm).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBe(dialog)
    expect(cancelButton.disabled).toBe(true)
    expect(deleteButton.disabled).toBe(true)
    expect(checkbox.disabled).toBe(true)
    expect(within(deleteButton).getByRole('status')).toBeTruthy()

    await act(async () => removal.resolve())

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(mocks.setSkipDeleteWorktreeConfirm).toHaveBeenCalledWith(true)
  })

  it('does not persist the confirmation opt-out when deletion fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.removeWorktree.mockRejectedValue(new Error('deletion failed'))
    renderRow()

    const dialog = openDeleteDialog()
    const checkbox = within(dialog).getByRole('checkbox') as HTMLInputElement
    const deleteButton = within(dialog).getByRole('button', { name: 'deleteWorktreeConfirm' })

    fireEvent.click(checkbox)
    fireEvent.click(deleteButton)

    await waitFor(() => expect(mocks.flash).toHaveBeenCalled())
    expect(screen.getByRole('dialog')).toBe(dialog)
    expect(checkbox.disabled).toBe(false)
    expect(mocks.setSkipDeleteWorktreeConfirm).not.toHaveBeenCalled()

    consoleError.mockRestore()
  })

  it('shows a row-level spinner when confirmation is skipped', async () => {
    const removal = deferred<void>()
    mocks.removeWorktree.mockReturnValue(removal.promise)
    mocks.skipDeleteWorktreeConfirm = true
    renderRow()

    const row = screen.getByRole('option')
    fireEvent.keyDown(row, { key: 'Delete' })

    await waitFor(() => expect(row.getAttribute('aria-busy')).toBe('true'))
    expect(within(row).getByRole('status')).toBeTruthy()
    expect(row.getAttribute('draggable')).toBe('false')

    await act(async () => removal.resolve())

    await waitFor(() => expect(row.getAttribute('aria-busy')).toBe('false'))
  })
})
