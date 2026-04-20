import { useEffect, useRef, useState, useCallback } from 'react'
import * as ipc from '@/lib/ipc'
import { extractLinearKey, deriveBranchFromLinear, validateBranchName } from '@/lib/branchValidation'
import { useTranslation } from 'react-i18next'
import { Spinner } from '@/components/ui'
import type { LinearIssue } from '@/types'

interface Props {
  disabled: boolean
  branchPrefix: string
  linearApiKey: string
  /** Called when a Linear issue resolves with the derived branch name */
  onResolved: (issue: LinearIssue, branch: string, validationError: string | null) => void
  /** Called when lookup fails */
  onError: (error: string) => void
}

export function LinearLookupField({ disabled, branchPrefix, linearApiKey, onResolved, onError }: Props) {
  const { t } = useTranslation('sidebar')

  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [issue, setIssue] = useState<LinearIssue | null>(null)
  const [error, setError] = useState('')

  // Monotonic counter to discard stale responses
  const lookupIdRef = useRef(0)
  // Tracks inflight state as a ref (not state) so onBlur reads fresh value
  const inflightRef = useRef(false)
  // Last resolved key for same-key dedup
  const resolvedKeyRef = useRef<string | null>(null)

  const handleLookup = useCallback(async (raw: string) => {
    const key = extractLinearKey(raw)
    if (!key) {
      if (raw.trim()) { setError(t('linearInvalidInput')); onError(t('linearInvalidInput')) }
      return
    }
    if (resolvedKeyRef.current === key) return

    const id = ++lookupIdRef.current
    inflightRef.current = true
    setLoading(true)
    setError('')
    setIssue(null)

    try {
      const result = await ipc.linear.getIssueByKey(key, linearApiKey)
      if (id !== lookupIdRef.current) return
      inflightRef.current = false
      setLoading(false)

      if (!result) {
        setError(t('linearFetchFailed'))
        onError(t('linearFetchFailed'))
        return
      }

      resolvedKeyRef.current = result.key
      setIssue(result)
      const derived = deriveBranchFromLinear(result.key, result.summary)
      const withPrefix = branchPrefix ? `${branchPrefix}${derived}` : derived
      const validationErr = validateBranchName(withPrefix)
      onResolved(result, withPrefix, validationErr)
    } catch {
      if (id !== lookupIdRef.current) return
      inflightRef.current = false
      setLoading(false)
      setError(t('linearFetchFailed'))
      onError(t('linearFetchFailed'))
    }
  }, [linearApiKey, branchPrefix, t, onResolved, onError])

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
      <label>{t('linearTicketLabel')} <span style={{ color: 'var(--text-tertiary)', fontWeight: 400 }}>{t('linearTicketHint')}</span></label>
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
        placeholder={t('linearPlaceholder')}
        spellCheck={false}
      />
      {loading && (
        <div className="linear-lookup-status">
          <Spinner size="sm" />
          <span>{t('linearFetching')}</span>
        </div>
      )}
      {error && <div className="linear-lookup-error">{error}</div>}
      {issue && (
        <div className="linear-lookup-card">
          <div className="linear-lookup-card-header">
            <span className="linear-issue-key">{issue.key}</span>
            <span className="linear-lookup-card-summary">{issue.summary}</span>
          </div>
          <div className="linear-lookup-card-meta">
            <span>{issue.type}</span>
            <span className={`linear-status-badge linear-status-badge--${issue.statusCategory}`}>
              {issue.status}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

/** Hook that checks Linear availability (has API key) on mount and when key changes */
export function useLinearAvailable(linearApiKey: string): boolean | null {
  const [available, setAvailable] = useState<boolean | null>(null)
  useEffect(() => {
    if (!linearApiKey) { setAvailable(false); return }
    ipc.linear.isAvailable(linearApiKey).then(setAvailable).catch(() => setAvailable(false))
  }, [linearApiKey])
  return available
}
