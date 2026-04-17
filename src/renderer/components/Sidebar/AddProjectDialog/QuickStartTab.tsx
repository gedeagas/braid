import { useEffect, useMemo, useRef, useState } from 'react'
import * as ipc from '@/lib/ipc'
import type { CreateTemplateFailureReason } from '@/lib/ipc'
import { useTranslation } from 'react-i18next'
import { Button, Spinner } from '@/components/ui'
import { IconFile, IconBolt, IconCheckmark } from '@/components/shared/icons'
import { validateProjectName } from '@shared/projectName'
import type { ProjectNameIssue } from '@shared/projectName'
import type { State, Action } from './types'

interface Props {
  state: State
  dispatch: React.Dispatch<Action>
  existingPaths: Set<string>
  addProject: (path: string) => Promise<void>
  onClose: () => void
  onActionRef: React.MutableRefObject<(() => void) | null>
}

/** Cap to bound memory + DOM size; 200 lines is plenty of context. */
const MAX_LOG_LINES = 200

/** Debounce for the async path-exists check, ms. */
const PATH_CHECK_DEBOUNCE_MS = 300

/** Map a typed failure reason from the main process to an i18n key. */
function errorKeyFor(reason: CreateTemplateFailureReason): string | null {
  switch (reason) {
    case 'cancelled':
      return null // user-initiated; no error surface
    case 'invalid-name':
      return 'quickStartNameInvalid'
    case 'missing-parent':
      return 'quickStartLocationEmpty'
    case 'parent-not-directory':
      return 'quickStartParentNotDirectory'
    case 'tool-missing':
      return 'quickStartNextjsToolMissing'
    case 'timeout':
      return 'quickStartNextjsTimeout'
    case 'failed':
    default:
      return 'quickStartNextjsFailed'
  }
}

/** Async path-existence status. */
type PathStatus = 'idle' | 'checking' | 'exists' | 'available'

/** Join a parent dir and a child name into a normalized POSIX path preview. */
function joinPath(parentDir: string, name: string): string {
  return `${parentDir.replace(/\/+$/, '')}/${name}`
}

export function QuickStartTab({ state, dispatch, existingPaths, addProject, onClose, onActionRef }: Props) {
  const { t } = useTranslation('sidebar')

  // Rolling buffer of the most recent scaffold log lines. Cleared when not creating.
  const [logLines, setLogLines] = useState<string[]>([])
  const logContainerRef = useRef<HTMLDivElement>(null)

  // Async path-exists result; synchronous name validation is derived via useMemo.
  const [pathStatus, setPathStatus] = useState<PathStatus>('idle')

  // Trimmed inputs drive all validation so trailing spaces don't desync the UI.
  const trimmedName = state.projectName.trim()
  const trimmedLocation = state.projectLocation.trim()

  // Synchronous validation: pure, so it's cheap to run on every render.
  const nameIssue = useMemo<ProjectNameIssue | null>(
    () => (trimmedName === '' ? null : validateProjectName(trimmedName)),
    [trimmedName],
  )

  const fullPath = useMemo(
    () => (trimmedLocation && trimmedName ? joinPath(trimmedLocation, trimmedName) : ''),
    [trimmedLocation, trimmedName],
  )

  // Monotonic sequence to discard stale async pathExists results when the
  // user types faster than the debounce or the filesystem replies.
  const checkSeqRef = useRef(0)

  // Debounced async pathExists check. Runs only when the name is otherwise
  // valid and a location is set; otherwise the UI shows the sync error.
  useEffect(() => {
    const hasLocation = trimmedLocation !== ''
    const nameOk = trimmedName !== '' && nameIssue === null
    if (!hasLocation || !nameOk) {
      checkSeqRef.current++ // invalidate any in-flight check
      setPathStatus('idle')
      return
    }
    // Collision with an already-added project is synchronous; surface it first.
    if (existingPaths.has(fullPath)) {
      checkSeqRef.current++
      setPathStatus('exists')
      return
    }
    setPathStatus('checking')
    const seq = ++checkSeqRef.current
    const timer = setTimeout(async () => {
      let exists = false
      try {
        exists = await ipc.files.pathExists(fullPath)
      } catch {
        // On IPC error, degrade to 'available' — the submit-time check is
        // authoritative. We don't want a transient failure to block the user.
        exists = false
      }
      if (seq !== checkSeqRef.current) return // stale
      setPathStatus(exists ? 'exists' : 'available')
    }, PATH_CHECK_DEBOUNCE_MS)
    return () => {
      clearTimeout(timer)
    }
  }, [fullPath, trimmedLocation, trimmedName, nameIssue, existingPaths])

  // Subscribe to scaffold log lines only while a Next.js scaffold is running.
  useEffect(() => {
    if (!state.creating || state.selectedTemplate !== 'nextjs') {
      setLogLines([])
      return
    }
    const unsub = ipc.templates.onLog((entry) => {
      if (!entry.line.trim()) return
      setLogLines((prev) => {
        const next = prev.length >= MAX_LOG_LINES
          ? prev.slice(prev.length - MAX_LOG_LINES + 1).concat(entry.line)
          : prev.concat(entry.line)
        return next
      })
    })
    return () => {
      unsub()
      setLogLines([])
    }
  }, [state.creating, state.selectedTemplate])

  // Auto-scroll to the bottom whenever new lines arrive.
  useEffect(() => {
    const el = logContainerRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [logLines])

  const handleBrowseLocation = async () => {
    const selected = await ipc.dialog.openDirectory()
    if (selected) dispatch({ type: 'setProjectLocation', value: selected })
  }

  const handleCancel = async () => {
    try {
      await ipc.templates.cancel()
    } catch {
      // best-effort
    }
  }

  const handleCreate = async () => {
    // Final submit-time guard. The live feedback already prevents this path
    // for the common cases, but we re-check defensively (user may submit via
    // Enter before live state catches up, and path could appear between
    // debounce and click).
    if (nameIssue !== null) {
      dispatch({ type: 'setError', error: issueMessage(nameIssue) })
      return
    }
    if (trimmedLocation === '') {
      dispatch({ type: 'setError', error: t('quickStartLocationEmpty') })
      return
    }
    const exists = await ipc.files.pathExists(fullPath)
    if (exists || existingPaths.has(fullPath)) {
      dispatch({ type: 'setError', error: t('quickStartPathExists') })
      return
    }

    dispatch({ type: 'startCreating' })
    try {
      if (state.selectedTemplate === 'nextjs') {
        const res = await ipc.templates.create('nextjs', {
          parentDir: trimmedLocation.replace(/\/+$/, ''),
          projectName: trimmedName,
        })
        if (!res.success) {
          if (res.stderr) {
            // eslint-disable-next-line no-console
            console.warn('[QuickStart] create-next-app stderr:', res.stderr)
          }
          const key = errorKeyFor(res.reason)
          if (key) dispatch({ type: 'setError', error: t(key) })
          dispatch({ type: 'doneCreating' })
          return
        }
      } else {
        await ipc.git.initRepo(fullPath)
      }
      await addProject(fullPath)
      onClose()
    } catch {
      dispatch({ type: 'setError', error: t('quickStartCreateFailed') })
      dispatch({ type: 'doneCreating' })
    }
  }

  /** Translate a synchronous name-issue into a localized string. */
  function issueMessage(issue: ProjectNameIssue): string {
    switch (issue.reason) {
      case 'empty':
        return t('quickStartNameEmpty')
      case 'too-long':
        return t('quickStartNameTooLong')
      case 'starts-with-dot':
        return t('quickStartNameStartsWithDot')
      case 'starts-with-underscore':
        return t('quickStartNameStartsWithUnderscore')
      case 'starts-with-hyphen':
        return t('quickStartNameStartsWithHyphen')
      case 'uppercase':
        return t('quickStartNameUppercase')
      case 'has-space':
        return t('quickStartNameHasSpace')
      case 'invalid-chars':
        return issue.detail
          ? t('quickStartNameInvalidChar', { char: issue.detail })
          : t('quickStartNameInvalidCharsGeneric')
      case 'reserved':
        return t('quickStartNameReserved', { name: issue.detail ?? '' })
      default:
        return t('quickStartNameInvalid')
    }
  }

  useEffect(() => {
    onActionRef.current = handleCreate
    return () => { onActionRef.current = null }
  })

  const isCreatingNextjs = state.creating && state.selectedTemplate === 'nextjs'

  // What to render under the name input. Order: sync error > path collision
  // > async check in flight > success. Empty input shows nothing.
  type Feedback =
    | { kind: 'none' }
    | { kind: 'error'; text: string }
    | { kind: 'checking'; text: string }
    | { kind: 'ok'; text: string }

  const feedback: Feedback = (() => {
    if (trimmedName === '') return { kind: 'none' }
    if (nameIssue !== null) return { kind: 'error', text: issueMessage(nameIssue) }
    if (pathStatus === 'exists') return { kind: 'error', text: t('quickStartPathExists') }
    if (pathStatus === 'checking') return { kind: 'checking', text: t('quickStartNameChecking') }
    if (pathStatus === 'available') return { kind: 'ok', text: t('quickStartNameAvailable') }
    return { kind: 'none' }
  })()

  const nameFieldId = 'quick-start-name'
  const nameFeedbackId = 'quick-start-name-feedback'
  const showPreview = nameIssue === null && trimmedName !== '' && trimmedLocation !== ''

  return (
    <>
      <div className="dialog-field">
        <label htmlFor={nameFieldId}>{t('quickStartNameLabel')}</label>
        <input
          id={nameFieldId}
          value={state.projectName}
          onChange={(e) => dispatch({ type: 'setProjectName', value: e.target.value })}
          onKeyDown={(e) => { if (e.key === 'Enter' && !state.creating) handleCreate() }}
          placeholder={t('quickStartNamePlaceholder')}
          disabled={state.creating}
          autoFocus
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          aria-invalid={feedback.kind === 'error'}
          aria-describedby={feedback.kind !== 'none' ? nameFeedbackId : undefined}
        />
        {/*
          Live validation feedback. role="status" + aria-live="polite" means
          screen readers announce changes without interrupting, and only after
          the user has typed something (we render nothing for empty input).
        */}
        <div
          id={nameFeedbackId}
          className={`quick-start-feedback quick-start-feedback--${feedback.kind}`}
          role="status"
          aria-live="polite"
        >
          {feedback.kind === 'checking' && (
            <span className="quick-start-feedback__pulse" aria-hidden="true" />
          )}
          {feedback.kind === 'ok' && (
            <span className="quick-start-feedback__icon" aria-hidden="true">
              <IconCheckmark size={12} />
            </span>
          )}
          {feedback.kind !== 'none' && <span>{feedback.text}</span>}
        </div>
      </div>

      <div className="dialog-field">
        <label>{t('quickStartLocationLabel')}</label>
        <div className="dialog-input-row">
          <input
            value={state.projectLocation}
            onChange={(e) => dispatch({ type: 'setProjectLocation', value: e.target.value })}
            placeholder={t('quickStartLocationPlaceholder')}
            disabled={state.creating}
          />
          <Button onClick={handleBrowseLocation} disabled={state.creating}>
            {t('browse', { ns: 'common' })}
          </Button>
        </div>
        {showPreview && (
          <div className="quick-start-path-preview">
            <span className="quick-start-path-preview__label">{t('quickStartPathPreviewLabel')}</span>
            <code className="quick-start-path-preview__value" title={fullPath}>{fullPath}</code>
          </div>
        )}
      </div>

      <div className="dialog-field">
        <label>{t('quickStartTemplateLabel')}</label>
        <div className="template-grid">
          <button
            type="button"
            aria-pressed={state.selectedTemplate === 'empty'}
            className={`template-card${state.selectedTemplate === 'empty' ? ' template-card--selected' : ''}`}
            onClick={() => dispatch({ type: 'setTemplate', value: 'empty' })}
            disabled={state.creating}
          >
            <span className="template-card__header">
              <span className="template-card__icon" aria-hidden="true">
                <IconFile size={20} />
              </span>
              <span className="template-card__name">{t('quickStartTemplateEmpty')}</span>
            </span>
            <span className="template-card__desc">{t('quickStartTemplateEmptyDesc')}</span>
          </button>
          <button
            type="button"
            aria-pressed={state.selectedTemplate === 'nextjs'}
            className={`template-card${state.selectedTemplate === 'nextjs' ? ' template-card--selected' : ''}`}
            onClick={() => dispatch({ type: 'setTemplate', value: 'nextjs' })}
            disabled={state.creating}
          >
            <span className="template-card__header">
              <span className="template-card__icon" aria-hidden="true">
                <IconBolt size={20} />
              </span>
              <span className="template-card__name">{t('quickStartTemplateNextjs')}</span>
            </span>
            <span className="template-card__desc">{t('quickStartTemplateNextjsDesc')}</span>
            <span className="template-card__chips" aria-hidden="true">
              <span className="template-card__chip">{t('quickStartStackTypeScript')}</span>
              <span className="template-card__chip">{t('quickStartStackAppRouter')}</span>
              <span className="template-card__chip">{t('quickStartStackTailwind')}</span>
              <span className="template-card__chip">{t('quickStartStackESLint')}</span>
              <span className="template-card__chip">{t('quickStartStackSrcDir')}</span>
            </span>
          </button>
        </div>
      </div>

      {state.creating && (
        <>
          <div className="dialog-clone-progress">
            <Spinner size="sm" />
            <span>
              {state.selectedTemplate === 'nextjs' ? t('quickStartCreatingNextjs') : t('quickStartCreating')}
            </span>
            {isCreatingNextjs && (
              <Button onClick={handleCancel}>
                {t('cancel', { ns: 'common' })}
              </Button>
            )}
          </div>
          {isCreatingNextjs && logLines.length > 0 && (
            <div
              ref={logContainerRef}
              className="dialog-scaffold-log"
              aria-hidden="true"
            >
              {logLines.map((line, i) => (
                <div
                  key={`${i}-${line.slice(0, 16)}`}
                  className="dialog-scaffold-log__line"
                  title={line}
                >
                  {line}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </>
  )
}
