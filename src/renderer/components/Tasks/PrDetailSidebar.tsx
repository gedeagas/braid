import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui'
import { IconCheckCircle, IconChevronDownSmall, IconClose, IconExternalLinkSmall, IconFile, IconMergeGraph, IconMessageBubble, IconPlus, IconPrBranch, IconRefresh, IconSearch, IconXCircleStatus } from '@/components/shared/icons'
import { formatRelativeTime } from '@/lib/relativeTime'
import * as ipc from '@/lib/ipc'
import type { GitHubLabel, GitHubLabelSuggestion, GitHubReviewerSuggestion } from './types'
import type { PrDetailController } from './usePrDetailController'
import { PrReviewSubmitForm } from './PrReviewSubmitForm'
import { TaskAvatar } from './TaskMarkdown'
import {
  formatState,
  formatSignedCount,
  getCheckDuration,
  getCheckState,
  getCheckStateLabel,
  reviewVariant,
  stateLabel,
  stateVariant,
} from './taskUtils'

const MERGE_STRATEGIES = [
  { action: 'merge', labelKey: 'prAction.createMergeCommit' },
  { action: 'squash', labelKey: 'prAction.squashAndMerge' },
  { action: 'rebase', labelKey: 'prAction.rebaseAndMerge' },
] as const

export function PrDetailSidebar({ detail }: { detail: PrDetailController }) {
  const { t } = useTranslation('tasks')
  const { review, prDetail, checkGroups, checks, checkSummaryLabel, actions } = detail
  if (!prDetail) return null

  return (
    <aside className="task-detail-sidebar">
      <PullRequestActionCard detail={detail} />
      <ReviewDecisionPanel detail={detail} />
      <ReviewActionCard detail={detail} />
      <section className="task-detail-panel task-summary-panel">
        <div className="task-detail-panel-header">
          <IconFile size={14} />
          <h2>{t('summary.title')}</h2>
        </div>
        <div className="task-detail-stats">
          <div className="task-detail-stat task-detail-stat--additions"><strong>{formatSignedCount(prDetail.item.additions, '+')}</strong><span>{t('summary.additions')}</span></div>
          <div className="task-detail-stat task-detail-stat--deletions"><strong>{formatSignedCount(prDetail.item.deletions, '-')}</strong><span>{t('summary.deletions')}</span></div>
          <div className="task-detail-stat task-detail-stat--files"><strong>{prDetail.item.changedFiles}</strong><span>{t('summary.files')}</span></div>
          <div className="task-detail-stat task-detail-stat--commits"><strong>{prDetail.item.commitsCount}</strong><span>{t('summary.commits')}</span></div>
        </div>
        <div className="task-detail-branch-grid">
          <div><span>{t('summary.head')}</span><strong>{prDetail.item.headBranch || t('unknown')}</strong></div>
          <div><span>{t('summary.base')}</span><strong>{prDetail.item.baseBranch || t('unknown')}</strong></div>
        </div>
        {prDetail.item.assignees.length > 0 && (
          <div className="task-detail-assignees">
            <span>{t('summary.assignees')}</span>
            <div>{prDetail.item.assignees.map((assignee) => <Badge key={assignee} variant="muted" size="sm">{assignee}</Badge>)}</div>
          </div>
        )}
        <ReviewerSection detail={detail} />
        <LabelSection detail={detail} />
      </section>

      <section className="task-detail-panel task-checks-card">
        <div className="task-detail-panel-header">
          <IconCheckCircle size={14} />
          <h2>{t('checks.title')}</h2>
          <span>{checkSummaryLabel}</span>
        </div>
        <div className="task-checks-panel">
          {prDetail.checks.length === 0 ? (
            <div className="task-checks-empty">
              <IconCheckCircle size={18} />
              <strong>{t('checks.noChecksTitle')}</strong>
              <span>{t('checks.noChecksBody')}</span>
            </div>
          ) : (
            <>
              <div className="task-check-actions">
                <button type="button" onClick={() => actions.handleRerunChecks(true)} disabled={checks.failedChecks === 0 || review.checkActionBusy !== null}>
                  {review.checkActionBusy === 'failed' ? <span className="task-reviewer-saving-dot" /> : <IconRefresh size={12} />}
                  {review.checkActionBusy === 'failed' ? t('checks.rerunning') : t('checks.rerunFailed')}
                </button>
                <button type="button" onClick={() => actions.handleRerunChecks(false)} disabled={review.checkActionBusy !== null}>
                  {review.checkActionBusy === 'all' ? <span className="task-reviewer-saving-dot" /> : <IconRefresh size={12} />}
                  {review.checkActionBusy === 'all' ? t('checks.rerunning') : t('checks.rerunAll')}
                </button>
              </div>
              <div className="task-check-summary-grid">
                <div className="task-check-summary-item task-check-summary-item--success"><strong>{checks.passedChecks}</strong><span>{t('checks.passing')}</span></div>
                <div className="task-check-summary-item task-check-summary-item--failure"><strong>{checks.failedChecks}</strong><span>{t('checks.failing')}</span></div>
                <div className="task-check-summary-item task-check-summary-item--pending"><strong>{checks.pendingChecks}</strong><span>{t('checks.pending')}</span></div>
                <div className="task-check-summary-item task-check-summary-item--skipped"><strong>{checks.skippedChecks}</strong><span>{t('checks.skipped')}</span></div>
              </div>
              {checkGroups.map(([groupName, groupChecks]) => (
                <div key={groupName} className="task-checks-group">
                  {groupChecks.length > 1 && <div className="task-checks-group-label">{groupName}</div>}
                  {groupChecks.map((check) => {
                    const state = getCheckState(check)
                    const duration = getCheckDuration(check.startedAt, check.completedAt)
                    return (
                      <button
                        key={`${check.name}:${check.url}`}
                        type="button"
                        className={`task-check-row task-check-row--${state}`}
                        onClick={() => check.url && ipc.shell.openExternal(check.url)}
                        disabled={!check.url}
                        title={check.name}
                      >
                        <span className={`task-check-dot task-check-dot--${state}`} />
                        <span className="task-check-copy">
                          <span className="task-check-name">{check.name}</span>
                          <span className="task-check-state-row">
                            <span className={`check-status-badge check-status-badge--${state}`}>{getCheckStateLabel(check, t)}</span>
                            {duration && <span className="task-check-meta">{duration}</span>}
                          </span>
                        </span>
                      </button>
                    )
                  })}
                </div>
              ))}
            </>
          )}
        </div>
      </section>
    </aside>
  )
}

function ReviewDecisionPanel({ detail }: { detail: PrDetailController }) {
  const { t } = useTranslation('tasks')
  const { prDetail, detailItem } = detail
  if (!prDetail || !detailItem || detailItem.type !== 'pr') return null

  const reviews = getLatestReviewsByAuthor(prDetail.reviews)
  const approvals = reviews.filter((review) => review.state === 'APPROVED')
  const changeRequests = reviews.filter((review) => review.state === 'CHANGES_REQUESTED')
  const comments = reviews.filter((review) => review.state === 'COMMENTED')
  const variant = changeRequests.length > 0 || detailItem.reviewDecision === 'CHANGES_REQUESTED'
    ? 'danger'
    : detailItem.reviewDecision === 'APPROVED' || approvals.length > 0
      ? 'success'
      : detailItem.reviewDecision === 'REVIEW_REQUIRED'
        ? 'warning'
        : 'muted'
  const headline = getReviewDecisionHeadline(variant, reviews.length, t)
  const body = getReviewDecisionBody(variant, approvals.length, changeRequests.length, comments.length, t)
  const orderedReviews = [...reviews].sort((a, b) => reviewStateWeight(b.state) - reviewStateWeight(a.state) || reviewDateMs(b) - reviewDateMs(a))

  return (
    <section className={`task-detail-panel task-review-decision-panel task-review-decision-panel--${variant}`}>
      <div className="task-detail-panel-header">
        {variant === 'danger' ? <IconXCircleStatus size={14} /> : variant === 'success' ? <IconCheckCircle size={14} /> : <IconMessageBubble size={14} />}
        <h2>{t('reviewDecision.title')}</h2>
        <span>
          {t('reviewDecision.approvals', { count: approvals.length })}
          {' / '}
          {t('reviewDecision.changeRequests', { count: changeRequests.length })}
        </span>
      </div>
      <div className="task-review-decision-body">
        <div className="task-review-decision-hero">
          <span className="task-review-decision-icon">
            {variant === 'danger' ? <IconXCircleStatus size={18} /> : variant === 'success' ? <IconCheckCircle size={18} /> : <IconMessageBubble size={16} />}
          </span>
          <div>
            <strong>{headline}</strong>
            <span>{body}</span>
          </div>
        </div>
        {orderedReviews.length > 0 ? (
          <div className="task-review-decision-list" aria-label={t('reviewDecision.latestReviews')}>
            {orderedReviews.map((review) => <ReviewDecisionRow key={`${review.author}:${review.id}`} review={review} />)}
          </div>
        ) : (
          <div className="task-review-decision-empty">
            <strong>{t('reviewDecision.noReviewsTitle')}</strong>
            <span>{t('reviewDecision.noReviewsBody')}</span>
          </div>
        )}
      </div>
    </section>
  )
}

function ReviewDecisionRow({ review }: { review: NonNullable<PrDetailController['prDetail']>['reviews'][number] }) {
  const { t } = useTranslation('tasks')
  const body = review.body.trim().replace(/\s+/g, ' ')
  return (
    <button
      type="button"
      className={`task-review-decision-row task-review-decision-row--${review.state.toLowerCase()}`}
      onClick={() => review.htmlUrl && ipc.shell.openExternal(review.htmlUrl)}
      disabled={!review.htmlUrl}
    >
      <TaskAvatar author={review.author} avatarUrl={review.authorAvatarUrl} />
      <span className="task-review-decision-copy">
        <span className="task-review-decision-meta">
          <strong>{review.author || t('unknown')}</strong>
          <Badge variant={reviewVariant(review.state)} size="sm">{formatState(review.state, t)}</Badge>
          {review.submittedAt && <em>{formatRelativeTime(review.submittedAt)}</em>}
        </span>
        {body && <span className="task-review-decision-note">{body}</span>}
      </span>
      {review.htmlUrl && <IconExternalLinkSmall size={9} />}
    </button>
  )
}

function getLatestReviewsByAuthor(reviews: NonNullable<PrDetailController['prDetail']>['reviews']) {
  const latest = new Map<string, NonNullable<PrDetailController['prDetail']>['reviews'][number]>()
  for (const review of reviews) {
    if (!review.author || review.state === 'PENDING') continue
    const key = review.author.toLowerCase()
    const current = latest.get(key)
    if (!current || reviewDateMs(review) >= reviewDateMs(current)) latest.set(key, review)
  }
  return Array.from(latest.values()).filter((review) => review.state !== 'DISMISSED')
}

function reviewDateMs(review: NonNullable<PrDetailController['prDetail']>['reviews'][number]): number {
  return new Date(review.submittedAt || 0).getTime()
}

function reviewStateWeight(state: string): number {
  if (state === 'CHANGES_REQUESTED') return 4
  if (state === 'APPROVED') return 3
  if (state === 'COMMENTED') return 2
  return 1
}

function getReviewDecisionHeadline(variant: 'success' | 'warning' | 'danger' | 'muted', reviewCount: number, t: TFunction<'tasks'>): string {
  if (variant === 'danger') return t('reviewDecision.changesRequestedTitle')
  if (variant === 'success') return t('reviewDecision.approvedTitle')
  if (variant === 'warning') return t('reviewDecision.reviewRequiredTitle')
  return reviewCount > 0 ? t('reviewDecision.commentedTitle') : t('reviewDecision.noReviewsTitle')
}

function getReviewDecisionBody(variant: 'success' | 'warning' | 'danger' | 'muted', approvalCount: number, changeRequestCount: number, commentCount: number, t: TFunction<'tasks'>): string {
  if (variant === 'danger') return t('reviewDecision.changesRequestedBody', { count: changeRequestCount })
  if (variant === 'success') return t('reviewDecision.approvedBody', { count: approvalCount })
  if (variant === 'warning') return t('reviewDecision.reviewRequiredBody')
  if (commentCount > 0) return t('reviewDecision.commentedBody', { count: commentCount })
  return t('reviewDecision.noReviewsBody')
}

function PullRequestActionCard({ detail }: { detail: PrDetailController }) {
  const { t } = useTranslation('tasks')
  const { detailItem, review, showReadyAction, showMergeActions, actions } = detail
  const rootRef = useRef<HTMLDivElement>(null)
  const [menuOpen, setMenuOpen] = useState(false)

  useEffect(() => {
    if (!menuOpen) return
    const handler = (event: MouseEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return
      setMenuOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [menuOpen])

  if (!detailItem || detailItem.type !== 'pr') return null

  const isOpen = detailItem.state === 'open'
  const canMarkReady = Boolean(showReadyAction)
  const isBusy = review.prActionBusy !== null
  const isMergeBusy = review.prActionBusy === 'merge' || review.prActionBusy === 'squash' || review.prActionBusy === 'rebase'
  const primaryDisabled = !showMergeActions || isBusy
  const mergeBlockReason = getMergeBlockReason(detailItem, t)
  const actionTone = getPrActionTone(detailItem, canMarkReady, showMergeActions, Boolean(review.prActionError))

  const handleMergeStrategy = (action: typeof MERGE_STRATEGIES[number]['action']) => {
    setMenuOpen(false)
    actions.handlePrAction(action)
  }

  return (
    <section className={`task-detail-panel task-pr-action-card task-pr-action-card--${actionTone}`}>
      <div className="task-pr-action-header">
        <span>
          <IconPrBranch size={14} />
          <strong>{t('prAction.title')}</strong>
        </span>
        <Badge variant={stateVariant(detailItem)} size="sm">{stateLabel(detailItem, t)}</Badge>
      </div>

      {isOpen ? (
        <div className="task-pr-action-stack">
          {canMarkReady ? (
            <button
              type="button"
              className="task-pr-action-primary"
              onClick={() => actions.handlePrAction('ready')}
              disabled={isBusy}
            >
              {review.prActionBusy === 'ready' ? <span className="task-reviewer-saving-dot" /> : <IconCheckCircle size={14} />}
              {review.prActionBusy === 'ready' ? t('prAction.markingReady') : t('prAction.readyForReview')}
            </button>
          ) : showMergeActions ? (
            <div className="task-pr-action-split" ref={rootRef}>
              <button
                type="button"
                className="task-pr-action-primary task-pr-action-primary--merge"
                onClick={() => actions.handlePrAction('merge')}
                disabled={primaryDisabled}
              >
                {isMergeBusy ? <span className="task-reviewer-saving-dot" /> : <IconMergeGraph size={14} />}
                {isMergeBusy ? t('prAction.merging') : t('prAction.merge')}
              </button>
              <button
                type="button"
                className="task-pr-action-menu-trigger"
                onClick={() => setMenuOpen((current) => !current)}
                disabled={primaryDisabled}
                aria-label={t('prAction.chooseMergeStrategy')}
                aria-expanded={menuOpen}
              >
                <IconChevronDownSmall size={11} />
              </button>
              {menuOpen && (
                <div className="task-pr-action-menu" role="menu">
                  {MERGE_STRATEGIES.map((strategy) => (
                    <button
                      key={strategy.action}
                      type="button"
                      role="menuitem"
                      onClick={() => handleMergeStrategy(strategy.action)}
                      disabled={isBusy}
                    >
                      {t(strategy.labelKey)}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="task-pr-action-blocked">
              <strong>{t('prAction.mergeUnavailable')}</strong>
              <span>{mergeBlockReason}</span>
            </div>
          )}

          <button
            type="button"
            className="task-pr-action-close"
            onClick={() => actions.handlePrAction('close')}
            disabled={isBusy}
          >
            {review.prActionBusy === 'close' ? <span className="task-reviewer-saving-dot" /> : <IconClose size={13} />}
            {review.prActionBusy === 'close' ? t('prAction.closing') : t('prAction.closePullRequest')}
          </button>
        </div>
      ) : (
        <div className="task-pr-action-state-note">{t('prAction.stateNote', { state: stateLabel(detailItem, t) })}</div>
      )}
    </section>
  )
}

function getPrActionTone(
  item: NonNullable<PrDetailController['detailItem']>,
  showReadyAction: boolean,
  showMergeActions: boolean,
  hasError: boolean,
): 'success' | 'warning' | 'danger' | 'muted' {
  if (hasError || item.state === 'closed') return 'danger'
  if (item.state === 'merged' || showMergeActions) return 'success'
  if (item.state === 'open' || showReadyAction) return 'warning'
  return 'muted'
}

function getMergeBlockReason(item: NonNullable<PrDetailController['detailItem']>, t: TFunction<'tasks'>): string {
  if (item.type !== 'pr') return t('prAction.mergeBlock.onlyPullRequests')
  if (item.isDraft) return t('prAction.mergeBlock.draft')
  if (item.reviewDecision === 'CHANGES_REQUESTED') return t('prAction.mergeBlock.changesRequested')
  if (item.reviewDecision === 'REVIEW_REQUIRED') return t('prAction.mergeBlock.reviewRequired')
  if (item.mergeStateStatus === 'UNSTABLE') return t('prAction.mergeBlock.checksFailing')
  if (item.mergeStateStatus === 'BEHIND') return t('prAction.mergeBlock.behind')
  if (item.mergeStateStatus === 'DIRTY' || item.mergeable === 'CONFLICTING') return t('prAction.mergeBlock.conflicts')
  if (item.mergeStateStatus === 'BLOCKED') return t('prAction.mergeBlock.blocked')
  if (item.mergeStateStatus === 'UNKNOWN') return t('prAction.mergeBlock.calculating')
  return t('prAction.mergeBlock.notMergeable')
}

function ReviewActionCard({ detail }: { detail: PrDetailController }) {
  const { t } = useTranslation('tasks')
  const { detailItem } = detail
  if (!detailItem || detailItem.type !== 'pr' || detailItem.state !== 'open') return null

  return (
    <section className="task-detail-panel task-review-action-card">
      <div className="task-detail-panel-header">
        <IconMessageBubble size={14} />
        <h2>{t('review.title')}</h2>
      </div>
      <PrReviewSubmitForm detail={detail} />
    </section>
  )
}

function LabelSection({ detail }: { detail: PrDetailController }) {
  const { t } = useTranslation('tasks')
  const { actions, review, selectedRow } = detail
  const prDetail = detail.prDetail!
  const dropdownId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [suggestions, setSuggestions] = useState<GitHubLabelSuggestion[]>([])
  const [suggestionError, setSuggestionError] = useState<string | null>(null)
  const [highlighted, setHighlighted] = useState(0)
  const labels = useMemo(() => getPrLabels(prDetail.item), [prDetail.item])
  const labelNames = useMemo(() => new Set(labels.map((label) => label.name.toLowerCase())), [labels])
  const draft = review.labelDraft
  const normalizedDraft = normalizeLabelName(draft)
  const normalizedDraftLower = normalizedDraft.toLowerCase()
  const visibleSuggestions = useMemo(() => suggestions.filter((suggestion) => !labelNames.has(suggestion.name.toLowerCase())), [labelNames, suggestions])
  const draftBlockedReason = normalizedDraftLower && labelNames.has(normalizedDraftLower) ? t('labels.alreadyAdded') : null
  const activeSuggestion = open ? visibleSuggestions[highlighted] : undefined
  const canAdd = (normalizedDraft.length > 0 || Boolean(activeSuggestion)) && !draftBlockedReason && review.labelBusy === null

  useEffect(() => {
    if (!open) return
    const handler = (event: MouseEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  useEffect(() => {
    if (!open || !selectedRow || selectedRow.item.type !== 'pr') {
      setSuggestions([])
      setSuggestionError(null)
      setLoading(false)
      return
    }

    let cancelled = false
    const timer = window.setTimeout(() => {
      setLoading(true)
      setSuggestionError(null)
      void ipc.github.listLabelSuggestions(selectedRow.repoPath, normalizedDraft, 20)
        .then((result: unknown) => {
          if (cancelled) return
          setSuggestions(Array.isArray(result) ? result as GitHubLabelSuggestion[] : [])
          setHighlighted(0)
        })
        .catch((error: unknown) => {
          if (cancelled) return
          setSuggestions([])
          setSuggestionError(ipc.cleanIpcError(error, t('errors.loadLabels')))
        })
        .finally(() => {
          if (!cancelled) setLoading(false)
        })
    }, 140)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [normalizedDraft, open, selectedRow, t])

  useEffect(() => {
    if (highlighted >= visibleSuggestions.length) {
      setHighlighted(Math.max(visibleSuggestions.length - 1, 0))
    }
  }, [highlighted, visibleSuggestions.length])

  const addLabel = (labelName?: string) => {
    const label = normalizeLabelName(labelName ?? draft)
    if (!label || labelNames.has(label.toLowerCase()) || review.labelBusy !== null) return
    setOpen(false)
    actions.handleAddLabel(label)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setOpen(true)
      setHighlighted((current) => Math.min(current + 1, Math.max(visibleSuggestions.length - 1, 0)))
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setHighlighted((current) => Math.max(current - 1, 0))
      return
    }
    if (event.key === 'Escape') {
      setOpen(false)
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      addLabel(activeSuggestion?.name)
    }
  }

  return (
    <div className="task-detail-label-editor">
      <div className="task-label-heading">
        <span>{t('labels.title')}</span>
        {labels.length > 0 && <strong>{labels.length}</strong>}
      </div>
      <div className="task-label-list">
        {labels.length === 0 ? (
          <em>{t('labels.none')}</em>
        ) : labels.map((label) => (
          <LabelChip
            key={label.name}
            label={label}
            removable
            busy={review.labelBusy === label.name}
            disabled={review.labelBusy !== null}
            onRemove={() => actions.handleRemoveLabel(label.name)}
          />
        ))}
      </div>
      <div className="task-label-picker" ref={rootRef}>
        <div className="task-label-input-shell">
          <IconSearch size={13} />
          <input
            value={draft}
            onChange={(event) => {
              review.setLabelDraft(event.target.value)
              setOpen(true)
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={handleKeyDown}
            placeholder={t('labels.searchPlaceholder')}
            aria-autocomplete="list"
            aria-controls={open ? dropdownId : undefined}
            aria-expanded={open}
            aria-activedescendant={activeSuggestion ? `${dropdownId}-${highlighted}` : undefined}
            disabled={review.labelBusy !== null}
            spellCheck={false}
          />
          <button
            type="button"
            className="task-label-add-button"
            onClick={() => addLabel(activeSuggestion?.name)}
            disabled={!canAdd}
            aria-label={t('labels.add')}
          >
            {review.labelBusy ? <span className="task-reviewer-saving-dot" /> : <IconPlus size={13} />}
          </button>
        </div>
        {open && (
          <div className="task-label-suggestions" id={dropdownId} role="listbox">
            {loading ? (
              <div className="task-label-suggestion-state">{t('labels.searching')}</div>
            ) : suggestionError ? (
              <div className="task-label-suggestion-state task-label-suggestion-state--error">{suggestionError}</div>
            ) : visibleSuggestions.length > 0 ? (
              visibleSuggestions.map((suggestion, index) => (
                <button
                  key={suggestion.name}
                  type="button"
                  id={`${dropdownId}-${index}`}
                  role="option"
                  aria-selected={index === highlighted}
                  className={index === highlighted ? 'is-highlighted' : undefined}
                  onMouseEnter={() => setHighlighted(index)}
                  onMouseDown={(event) => {
                    event.preventDefault()
                    addLabel(suggestion.name)
                  }}
                >
                  <span className="task-label-swatch" style={getLabelStyle(suggestion.color)} />
                  <span>
                    <strong>{suggestion.name}</strong>
                    {suggestion.description && <small>{suggestion.description}</small>}
                  </span>
                </button>
              ))
            ) : normalizedDraft && !draftBlockedReason ? (
              <button
                type="button"
                role="option"
                aria-selected
                className="is-highlighted"
                onMouseDown={(event) => {
                  event.preventDefault()
                  addLabel()
                }}
              >
                <span className="task-label-swatch task-label-swatch--fallback" />
                <span>
                  <strong>{normalizedDraft}</strong>
                  <small>{t('labels.addTyped')}</small>
                </span>
              </button>
            ) : (
              <div className="task-label-suggestion-state">{draftBlockedReason ?? t('labels.typeName')}</div>
            )}
          </div>
        )}
      </div>
      {review.labelError && <div className="task-label-error">{review.labelError}</div>}
    </div>
  )
}

function LabelChip({ label, removable = false, busy = false, disabled = false, onRemove }: {
  label: GitHubLabel
  removable?: boolean
  busy?: boolean
  disabled?: boolean
  onRemove?: () => void
}) {
  const { t } = useTranslation('tasks')
  const content = (
    <>
      <span>{label.name}</span>
      {busy ? <span className="task-reviewer-saving-dot" /> : removable ? <IconClose size={8} /> : null}
    </>
  )
  if (!removable) {
    return <span className="task-label-chip" style={getLabelStyle(label.color)}>{content}</span>
  }
  return (
    <button
      type="button"
      className="task-label-chip task-label-chip--removable"
      style={getLabelStyle(label.color)}
      onClick={onRemove}
      disabled={disabled}
      aria-label={t('labels.removeAria', { label: label.name })}
    >
      {content}
    </button>
  )
}

function ReviewerSection({ detail }: { detail: PrDetailController }) {
  const { t } = useTranslation('tasks')
  const { actions, review, selectedRow } = detail
  const prDetail = detail.prDetail!

  const dropdownId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [suggestions, setSuggestions] = useState<GitHubReviewerSuggestion[]>([])
  const [suggestionError, setSuggestionError] = useState<string | null>(null)
  const [highlighted, setHighlighted] = useState(0)
  const draft = review.reviewerDraft
  const normalizedDraft = normalizeReviewerHandle(draft)
  const normalizedDraftLower = normalizedDraft.toLowerCase()
  const authorLogin = prDetail.item.author.toLowerCase()
  const requestedLogins = useMemo(
    () => new Set(prDetail.item.reviewRequests.map((reviewer) => reviewer.toLowerCase())),
    [prDetail.item.reviewRequests]
  )
  const visibleSuggestions = useMemo(() => suggestions.filter((suggestion) => {
    const login = suggestion.login.toLowerCase()
    return login !== authorLogin && !requestedLogins.has(login)
  }), [authorLogin, requestedLogins, suggestions])
  const draftBlockedReason = requestedLogins.has(normalizedDraftLower)
    ? t('reviewers.alreadyRequested')
    : normalizedDraftLower && normalizedDraftLower === authorLogin
      ? t('reviewers.authorBlocked')
      : null
  const canAdd = normalizedDraft.length > 0 && !draftBlockedReason && review.reviewerBusy === null
  const activeSuggestion = open ? visibleSuggestions[highlighted] : undefined

  useEffect(() => {
    if (!open) return
    const handler = (event: MouseEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  useEffect(() => {
    if (!open || !selectedRow || selectedRow.item.type !== 'pr' || !normalizedDraft) {
      setSuggestions([])
      setSuggestionError(null)
      setLoading(false)
      return
    }

    let cancelled = false
    const timer = window.setTimeout(() => {
      setLoading(true)
      setSuggestionError(null)
      void ipc.github.listReviewerSuggestions(selectedRow.repoPath, normalizedDraft, 8)
        .then((result: unknown) => {
          if (cancelled) return
          setSuggestions(Array.isArray(result) ? result as GitHubReviewerSuggestion[] : [])
          setHighlighted(0)
        })
        .catch((error: unknown) => {
          if (cancelled) return
          setSuggestions([])
          setSuggestionError(ipc.cleanIpcError(error, t('errors.loadReviewers')))
        })
        .finally(() => {
          if (!cancelled) setLoading(false)
        })
    }, 180)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [normalizedDraft, open, selectedRow, t])

  useEffect(() => {
    if (highlighted >= visibleSuggestions.length) {
      setHighlighted(Math.max(visibleSuggestions.length - 1, 0))
    }
  }, [highlighted, visibleSuggestions.length])

  const requestReviewer = (login?: string) => {
    const reviewer = normalizeReviewerHandle(login ?? draft)
    const reviewerLower = reviewer.toLowerCase()
    if (!reviewer || requestedLogins.has(reviewerLower) || reviewerLower === authorLogin || review.reviewerBusy !== null) return
    setOpen(false)
    actions.handleRequestReviewer(reviewer)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setOpen(true)
      setHighlighted((current) => Math.min(current + 1, Math.max(visibleSuggestions.length - 1, 0)))
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setHighlighted((current) => Math.max(current - 1, 0))
      return
    }
    if (event.key === 'Escape') {
      setOpen(false)
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      requestReviewer(activeSuggestion?.login)
    }
  }

  return (
    <div className="task-detail-reviewers">
      <div className="task-reviewer-heading">
        <span>{t('reviewers.title')}</span>
        {prDetail.item.reviewRequests.length > 0 && <strong>{prDetail.item.reviewRequests.length}</strong>}
      </div>
      <div className="task-reviewer-list">
        {prDetail.item.reviewRequests.length === 0 ? (
          <em>{t('reviewers.none')}</em>
        ) : prDetail.item.reviewRequests.map((reviewer) => (
          <button
            key={reviewer}
            type="button"
            onClick={() => actions.handleRemoveReviewer(reviewer)}
            disabled={review.reviewerBusy !== null}
            aria-label={t('reviewers.removeAria', { reviewer })}
          >
            <ReviewerAvatar login={reviewer} />
            <span>{reviewer}</span>
            <IconClose size={8} />
          </button>
        ))}
      </div>
      <div className="task-reviewer-picker" ref={rootRef}>
        <div className="task-reviewer-input-shell">
          <IconSearch size={13} />
          <input
            value={draft}
            onChange={(event) => {
              review.setReviewerDraft(event.target.value)
              setOpen(true)
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={handleKeyDown}
            placeholder={t('reviewers.searchPlaceholder')}
            aria-autocomplete="list"
            aria-controls={open ? dropdownId : undefined}
            aria-expanded={open}
            aria-activedescendant={activeSuggestion ? `${dropdownId}-${activeSuggestion.login}` : undefined}
            disabled={review.reviewerBusy !== null}
            spellCheck={false}
          />
          <button
            type="button"
            className="task-reviewer-add-button"
            onClick={() => requestReviewer()}
            disabled={!canAdd}
            aria-label={t('reviewers.add')}
          >
            {review.reviewerBusy ? <span className="task-reviewer-saving-dot" /> : <IconPlus size={13} />}
          </button>
        </div>
        {open && (
          <div className="task-reviewer-suggestions" id={dropdownId} role="listbox">
            {loading ? (
              <div className="task-reviewer-suggestion-state">{t('reviewers.searching')}</div>
            ) : suggestionError ? (
              <div className="task-reviewer-suggestion-state task-reviewer-suggestion-state--error">{suggestionError}</div>
            ) : visibleSuggestions.length > 0 ? (
              visibleSuggestions.map((suggestion, index) => (
                <button
                  key={suggestion.login}
                  type="button"
                  id={`${dropdownId}-${suggestion.login}`}
                  role="option"
                  aria-selected={index === highlighted}
                  className={index === highlighted ? 'is-highlighted' : undefined}
                  onMouseEnter={() => setHighlighted(index)}
                  onMouseDown={(event) => {
                    event.preventDefault()
                    requestReviewer(suggestion.login)
                  }}
                >
                  <ReviewerAvatar login={suggestion.login} avatarUrl={suggestion.avatarUrl} />
                  <span>
                    <strong>{suggestion.login}</strong>
                    {suggestion.name && <small>{suggestion.name}</small>}
                  </span>
                </button>
              ))
            ) : normalizedDraft && !draftBlockedReason ? (
              <button
                type="button"
                role="option"
                aria-selected
                className="is-highlighted"
                onMouseDown={(event) => {
                  event.preventDefault()
                  requestReviewer()
                }}
              >
                <ReviewerAvatar login={normalizedDraft} />
                <span>
                  <strong>@{normalizedDraft}</strong>
                  <small>{t('reviewers.addTyped')}</small>
                </span>
              </button>
            ) : (
              <div className="task-reviewer-suggestion-state">{draftBlockedReason ?? t('reviewers.typeUsername')}</div>
            )}
          </div>
        )}
      </div>
      {review.reviewerError && <div className="task-reviewer-error">{review.reviewerError}</div>}
    </div>
  )
}

function ReviewerAvatar({ login, avatarUrl }: { login: string; avatarUrl?: string }) {
  if (avatarUrl) {
    return <img className="task-reviewer-avatar" src={avatarUrl} alt="" />
  }
  return <span className="task-reviewer-avatar task-reviewer-avatar--fallback">{login.slice(0, 1).toUpperCase()}</span>
}

function getPrLabels(item: NonNullable<PrDetailController['prDetail']>['item']): GitHubLabel[] {
  if (item.labelDetails?.length > 0) return item.labelDetails
  return (item.labels ?? []).map((name) => ({ name, color: '6e7781', description: null }))
}

function normalizeReviewerHandle(value: string): string {
  return value.trim().replace(/^@+/, '')
}

function normalizeLabelName(value: string): string {
  return value.trim()
}

function getLabelStyle(color: string): CSSProperties {
  const hex = normalizeLabelColor(color)
  const { r, g, b } = hexToRgb(hex)
  const luminance = getRelativeLuminance(r, g, b)
  return {
    '--task-label-bg': `#${hex}`,
    '--task-label-fg': luminance > 0.54 ? '#161b22' : '#ffffff',
  } as CSSProperties
}

function normalizeLabelColor(color: string): string {
  const normalized = color.trim().replace(/^#/, '')
  return /^[0-9a-fA-F]{6}$/.test(normalized) ? normalized.toLowerCase() : '6e7781'
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  return {
    r: parseInt(hex.slice(0, 2), 16),
    g: parseInt(hex.slice(2, 4), 16),
    b: parseInt(hex.slice(4, 6), 16),
  }
}

function getRelativeLuminance(r: number, g: number, b: number): number {
  const [red, green, blue] = [r, g, b].map((value) => {
    const channel = value / 255
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue
}
