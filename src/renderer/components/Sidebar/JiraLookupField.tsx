import { useEffect, useRef, useState, useCallback } from 'react'
import * as ipc from '@/lib/ipc'
import { extractJiraKey, deriveBranchFromJira, validateBranchName } from '@/lib/branchValidation'
import { useTranslation } from 'react-i18next'
import { Spinner } from '@/components/ui'
import type { JiraIssue } from '@/types'

interface Props {
  disabled: boolean
  branchPrefix: string
  jiraBaseUrl: string
  /** Called when a Jira issue resolves with the derived branch name */
  onResolved: (issue: JiraIssue, branch: string, validationError: string | null) => void
  /** Called when lookup fails */
  onError: (error: string) => void
}

export function JiraLookupField({ disabled, branchPrefix, jiraBaseUrl, onResolved, onError }: Props) {
  const { t } = useTranslation('sidebar')

  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [issue, setIssue] = useState<JiraIssue | null>(null)
  const [error, setError] = useState('')

  // Monotonic counter to discard stale responses
  const lookupIdRef = useRef(0)
  // Tracks inflight state as a ref (not state) so onBlur reads fresh value
  const inflightRef = useRef(false)
  // Last resolved key for same-key dedup
  const resolvedKeyRef = useRef<string | null>(null)

  const handleLookup = useCallback(async (raw: string) => {
    const key = extractJiraKey(raw)
    if (!key) {
      if (raw.trim()) { setError(t('jiraInvalidInput')); onError(t('jiraInvalidInput')) }
      return
    }
    if (resolvedKeyRef.current === key) return

    const id = ++lookupIdRef.current
    inflightRef.current = true
    setLoading(true)
    setError('')
    setIssue(null)

    try {
      const result = await ipc.jira.getIssueByKey(key, jiraBaseUrl || undefined)
      if (id !== lookupIdRef.current) return
      inflightRef.current = false
      setLoading(false)

      if (!result) {
        setError(t('jiraFetchFailed'))
        onError(t('jiraFetchFailed'))
        return
      }

      resolvedKeyRef.current = result.key
      setIssue(result)
      const derived = deriveBranchFromJira(result.key, result.summary)
      const withPrefix = branchPrefix ? `${branchPrefix}${derived}` : derived
      const validationErr = validateBranchName(withPrefix)
      onResolved(result, withPrefix, validationErr)
    } catch {
      if (id !== lookupIdRef.current) return
      inflightRef.current = false
      setLoading(false)
      setError(t('jiraFetchFailed'))
      onError(t('jiraFetchFailed'))
    }
  }, [jiraBaseUrl, branchPrefix, t, onResolved, onError])

  const handleChange = (val: string) => {
    setInput(val)
    if (!val.trim()) {
      setIssue(null)
      setError('')
      resolvedKeyRef.current = null
    }
  }

  return (
    <div className="dialog-field">
      <label>{t('jiraTicketLabel')} <span style={{ color: 'var(--text-tertiary)', fontWeight: 400 }}>{t('jiraTicketHint')}</span></label>
      <input
        value={input}
        onChange={(e) => handleChange(e.target.value)}
        onBlur={() => { if (input.trim() && !resolvedKeyRef.current && !inflightRef.current) handleLookup(input) }}
        onPaste={(e) => {
          const pasted = e.clipboardData.getData('text')
          if (pasted) { e.preventDefault(); setInput(pasted); handleLookup(pasted) }
        }}
        onKeyDown={(e) => { if (e.key === 'Enter' && input.trim()) { e.preventDefault(); handleLookup(input) } }}
        disabled={disabled}
        placeholder={t('jiraPlaceholder')}
        spellCheck={false}
      />
      {loading && (
        <div className="jira-lookup-status">
          <Spinner size="sm" />
          <span>{t('jiraFetching')}</span>
        </div>
      )}
      {error && <div className="jira-lookup-error">{error}</div>}
      {issue && (
        <div className="jira-lookup-card">
          <div className="jira-lookup-card-header">
            <span className="jira-issue-key">{issue.key}</span>
            <span className="jira-lookup-card-summary">{issue.summary}</span>
          </div>
          <div className="jira-lookup-card-meta">
            <span>{issue.type}</span>
            <span className={`jira-status-badge jira-status-badge--${issue.statusCategory}`}>
              {issue.status}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

/** Hook that checks Jira CLI availability once on mount */
export function useJiraAvailable(): boolean | null {
  const [available, setAvailable] = useState<boolean | null>(null)
  useEffect(() => { ipc.jira.isAvailable().then(setAvailable).catch(() => setAvailable(false)) }, [])
  return available
}
