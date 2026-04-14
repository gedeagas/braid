// ---------------------------------------------------------------------------
// Linked worktree chips — shown above the chat input when worktrees are linked
// ---------------------------------------------------------------------------

import { useReducer, useCallback, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useSessionsStore, useLinkedWorktrees } from '@/store/sessions'
import { useProjectsStore } from '@/store/projects'
import { IconLink, IconPlus, IconClose, IconCheckmark } from '@/components/shared/icons'
import type { LinkedWorktree, Project } from '@/types'
import { SK } from '@/lib/storageKeys'

interface Props {
  sessionId: string
  worktreeId: string
}

// ─── Dialog reducer ────────────────────────────────────────────────────────

interface DialogState {
  open: boolean
  filter: string
  highlighted: number
}

type DialogAction =
  | { type: 'open' }
  | { type: 'close' }
  | { type: 'setFilter'; value: string }
  | { type: 'setHighlighted'; index: number }

function dialogReducer(state: DialogState, action: DialogAction): DialogState {
  switch (action.type) {
    case 'open': return { open: true, filter: '', highlighted: 0 }
    case 'close': return { open: false, filter: '', highlighted: 0 }
    case 'setFilter': return { ...state, filter: action.value, highlighted: 0 }
    case 'setHighlighted': return { ...state, highlighted: action.index }
  }
}

// ─── Component ─────────────────────────────────────────────────────────────

export function LinkedWorktreeChips({ sessionId, worktreeId }: Props) {
  const { t } = useTranslation('center')
  const linked = useLinkedWorktrees(sessionId)
  const linkWorktree = useSessionsStore((s) => s.linkWorktree)
  const unlinkWorktree = useSessionsStore((s) => s.unlinkWorktree)
  const projects = useProjectsStore((s) => s.projects)
  const allSessions = useSessionsStore((s) => s.sessions)

  const [dialog, dispatch] = useReducer(dialogReducer, { open: false, filter: '', highlighted: 0 })
  const filterRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // Auto-focus filter on open
  useEffect(() => {
    if (dialog.open) setTimeout(() => filterRef.current?.focus(), 0)
  }, [dialog.open])

  // Close on Escape
  useEffect(() => {
    if (!dialog.open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dispatch({ type: 'close' })
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [dialog.open])

  const handleLink = useCallback((lw: LinkedWorktree) => {
    linkWorktree(sessionId, lw)
  }, [sessionId, linkWorktree])

  const handleUnlink = useCallback((wtId: string) => {
    unlinkWorktree(sessionId, wtId)
  }, [sessionId, unlinkWorktree])

  // Build flat list of all worktree cards for keyboard nav
  const linkedIds = new Set(linked.map((lw) => lw.worktreeId))
  const groups = buildAvailableWorktrees(projects, worktreeId, dialog.filter)
  const flatItems = groups.flatMap((g) => g.worktrees.map((wt) => ({ ...wt, projectId: g.projectId, projectName: g.projectName })))

  const handleFilterKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      dispatch({ type: 'setHighlighted', index: Math.min(dialog.highlighted + 1, flatItems.length - 1) })
      scrollHighlightedIntoView()
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      dispatch({ type: 'setHighlighted', index: Math.max(dialog.highlighted - 1, 0) })
      scrollHighlightedIntoView()
    } else if (e.key === 'Enter' && flatItems[dialog.highlighted]) {
      e.preventDefault()
      const item = flatItems[dialog.highlighted]
      const isLinked = linkedIds.has(item.worktreeId)
      if (isLinked) {
        handleUnlink(item.worktreeId)
      } else {
        handleLink({ worktreeId: item.worktreeId, projectId: item.projectId, projectName: item.projectName, branch: item.branch, path: item.path })
      }
    }
  }

  const scrollHighlightedIntoView = () => {
    requestAnimationFrame(() => {
      const el = listRef.current?.querySelector('.lwt-card--highlighted')
      el?.scrollIntoView({ block: 'nearest' })
    })
  }

  // Count sessions per worktree
  const sessionCountByWorktree = (wtId: string) =>
    Object.values(allSessions).filter((s) => s.worktreeId === wtId).length

  // Track flat index for highlight
  let flatIndex = -1

  return (
    <div className="linked-worktree-chips">
      {linked.map((lw) => (
        <div key={lw.worktreeId} className="linked-worktree-chip">
          <IconLink size={11} />
          <span className="linked-worktree-chip-label">
            {lw.projectName}/{lw.branch}
          </span>
          <button
            className="linked-worktree-chip-remove"
            onClick={() => handleUnlink(lw.worktreeId)}
            title={t('unlinkWorktree')}
          >
            <IconClose size={8} />
          </button>
        </div>
      ))}

      <button
        className="link-worktree-btn"
        onClick={() => dispatch({ type: 'open' })}
      >
        <IconPlus size={12} />
        <span>{t('linkWorktree')}</span>
      </button>

      {dialog.open && (
        <div className="dialog-overlay" onClick={() => dispatch({ type: 'close' })}>
          <div className="lwt-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="lwt-dialog-header">
              <h2>{t('linkWorktreeDialogTitle')}</h2>
              <button className="lwt-dialog-close" onClick={() => dispatch({ type: 'close' })}>
                <IconClose size={10} />
              </button>
            </div>

            <input
              ref={filterRef}
              className="lwt-dialog-search"
              type="text"
              placeholder={t('linkWorktreeSearch')}
              value={dialog.filter}
              onChange={(e) => dispatch({ type: 'setFilter', value: e.target.value })}
              onKeyDown={handleFilterKeyDown}
              spellCheck={false}
            />

            <div ref={listRef} className="lwt-dialog-list">
              {groups.length === 0 ? (
                <div className="lwt-dialog-empty">{t('linkWorktreeEmpty')}</div>
              ) : (
                groups.map((group) => (
                  <div key={group.projectId} className="lwt-dialog-group">
                    <div className="lwt-dialog-group-label">{group.projectName}</div>
                    <div className="lwt-dialog-group-grid">
                    {group.worktrees.map((wt) => {
                      flatIndex++
                      const isLinked = linkedIds.has(wt.worktreeId)
                      const isHighlighted = flatIndex === dialog.highlighted
                      const count = sessionCountByWorktree(wt.worktreeId)

                      return (
                        <button
                          key={wt.worktreeId}
                          className={
                            'lwt-card' +
                            (isLinked ? ' lwt-card--linked' : '') +
                            (isHighlighted ? ' lwt-card--highlighted' : '')
                          }
                          onMouseEnter={() => dispatch({ type: 'setHighlighted', index: flatIndex })}
                          onMouseDown={(e) => {
                            e.preventDefault()
                            if (isLinked) {
                              handleUnlink(wt.worktreeId)
                            } else {
                              handleLink({
                                worktreeId: wt.worktreeId,
                                projectId: group.projectId,
                                projectName: group.projectName,
                                branch: wt.branch,
                                path: wt.path
                              })
                            }
                          }}
                        >
                          <div className="lwt-card-header">
                            <div className="lwt-card-branch">{wt.branch}</div>
                            {isLinked && (
                              <span className="lwt-card-badge">
                                <IconCheckmark size={10} />
                                {t('linkedBadge')}
                              </span>
                            )}
                          </div>
                          <div className="lwt-card-details">
                            {wt.upstream && (
                              <span className="lwt-card-upstream">&uarr; {wt.upstream}</span>
                            )}
                            <span className="lwt-card-path">{shortenPath(wt.path)}</span>
                            <span className="lwt-card-meta">
                              {count > 0
                                ? t('worktreeSessionCount', { count })
                                : t('worktreeNoSessions')}
                            </span>
                          </div>
                        </button>
                      )
                    })}
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="lwt-dialog-footer">
              {t('linkWorktreeHint')}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Helpers ───────────────────────────────────────────────────────────────

interface WorktreeOption {
  worktreeId: string
  branch: string
  path: string
  upstream?: string
}
interface ProjectGroup {
  projectId: string
  projectName: string
  worktrees: WorktreeOption[]
}

function buildAvailableWorktrees(
  projects: Project[],
  currentWorktreeId: string,
  filter: string
): ProjectGroup[] {
  const lowerFilter = filter.toLowerCase()
  const groups: ProjectGroup[] = []

  for (const project of projects) {
    const wts: WorktreeOption[] = []
    for (const wt of project.worktrees) {
      if (wt.id === currentWorktreeId) continue
      if (lowerFilter && !wt.branch.toLowerCase().includes(lowerFilter) && !project.name.toLowerCase().includes(lowerFilter)) continue
      wts.push({ worktreeId: wt.id, branch: wt.branch, path: wt.path, upstream: wt.upstream })
    }
    if (wts.length > 0) {
      groups.push({ projectId: project.id, projectName: project.name, worktrees: wts })
    }
  }

  return groups
}

function shortenPath(p: string): string {
  const home = '~'
  const homePath = typeof window !== 'undefined'
    ? (localStorage.getItem(SK.homePath) ?? '')
    : ''
  if (homePath && p.startsWith(homePath)) return home + p.slice(homePath.length)
  return p
}
