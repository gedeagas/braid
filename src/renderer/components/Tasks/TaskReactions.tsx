import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { GitHubReactionContent, PrIssueComment, PrReviewComment } from './types'
import { REACTION_OPTIONS } from './constants'

interface TaskReactionsProps {
  comment: PrIssueComment | PrReviewComment
  reactingSubjectIds: ReadonlySet<string>
  onToggleReaction: (comment: PrIssueComment | PrReviewComment, content: GitHubReactionContent) => void
}

export function TaskReactions({ comment, reactingSubjectIds, onToggleReaction }: TaskReactionsProps) {
  const { t } = useTranslation('tasks')
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const visibleReactions = REACTION_OPTIONS
    .map((option) => {
      const reaction = comment.reactions.find((item) => item.content === option.content)
      return {
        ...option,
        count: reaction?.count ?? 0,
        active: reaction?.viewerHasReacted === true,
      }
    })
    .filter((option) => option.count > 0 || option.active)
  const busy = Boolean(comment.subjectId && reactingSubjectIds.has(comment.subjectId))

  useEffect(() => {
    if (!open) return
    const handlePointerDown = (event: MouseEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', handlePointerDown)
    return () => document.removeEventListener('mousedown', handlePointerDown)
  }, [open])

  useEffect(() => {
    setOpen(false)
  }, [comment.subjectId])

  return (
    <div className="task-reactions" aria-label={t('reactions.commentReactions')} ref={rootRef}>
      {visibleReactions.map((option) => (
        <ReactionPill
          key={option.content}
          option={option}
          label={t(option.labelKey)}
          comment={comment}
          busy={busy}
          onToggleReaction={onToggleReaction}
          t={t}
        />
      ))}
      {comment.subjectId && (
        <div className="task-reaction-add">
          <button
            type="button"
            className="task-reaction-add-button"
            onClick={() => setOpen((current) => !current)}
            disabled={busy}
            aria-label={t('reactions.addReaction')}
            aria-haspopup="menu"
            aria-expanded={open}
            title={t('reactions.addReaction')}
          >
            +
          </button>
          {open && (
            <div className="task-reaction-menu task-reaction-menu--open" role="menu" aria-label={t('reactions.chooseReaction')}>
              {REACTION_OPTIONS.map((option) => {
                const active = comment.reactions.find((item) => item.content === option.content)?.viewerHasReacted === true
                const label = t(option.labelKey)
                return (
                  <button
                    key={option.content}
                    type="button"
                    className={active ? 'active' : ''}
                    onClick={() => {
                      onToggleReaction(comment, option.content)
                      setOpen(false)
                    }}
                    disabled={busy}
                    aria-label={active ? t('reactions.removeReactionAria', { reaction: label }) : t('reactions.addReactionAria', { reaction: label })}
                    title={label}
                    role="menuitem"
                  >
                    <span aria-hidden="true">{option.symbol}</span>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function ReactionPill({
  option,
  label,
  comment,
  busy,
  onToggleReaction,
  t,
}: {
  option: (typeof REACTION_OPTIONS)[number] & { count: number; active: boolean }
  label: string
  comment: PrIssueComment | PrReviewComment
  busy: boolean
  onToggleReaction: (comment: PrIssueComment | PrReviewComment, content: GitHubReactionContent) => void
  t: ReturnType<typeof useTranslation>['t']
}) {
  return (
    <button
      type="button"
      className={option.active ? 'task-reaction-pill active' : 'task-reaction-pill'}
      onClick={() => onToggleReaction(comment, option.content)}
      disabled={!comment.subjectId || busy}
      aria-label={option.active ? t('reactions.removeReactionAria', { reaction: label }) : t('reactions.addReactionAria', { reaction: label })}
      title={label}
    >
      <span className="task-reaction-symbol" aria-hidden="true">{option.symbol}</span>
      <em>{option.count}</em>
    </button>
  )
}
