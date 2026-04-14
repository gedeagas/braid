import { useTranslation } from 'react-i18next'
import type { editor } from 'monaco-editor'

interface Props {
  markers: editor.IMarker[]
  onJump: (line: number, col: number) => void
}

// Monaco MarkerSeverity values
const SEVERITY_ERROR = 8
const SEVERITY_WARNING = 4
const SEVERITY_INFO = 2

export function DiagnosticsPanel({ markers, onJump }: Props) {
  const { t } = useTranslation('right')

  if (markers.length === 0) {
    return (
      <div className="diagnostics-panel">
        <div className="diagnostics-header">
          <span>{t('diagnosticsTitle')}</span>
          <span className="diagnostics-location">{t('diagnosticsEmpty')}</span>
        </div>
      </div>
    )
  }

  const errors = markers.filter(m => m.severity === SEVERITY_ERROR)
  const warnings = markers.filter(m => m.severity === SEVERITY_WARNING)

  // Sort: errors first, then warnings, then rest; within each group by line
  const sorted = [...markers].sort((a, b) => {
    if (a.severity !== b.severity) return b.severity - a.severity
    return a.startLineNumber - b.startLineNumber
  })

  return (
    <div className="diagnostics-panel">
      <div className="diagnostics-header">
        <span>{t('diagnosticsTitle')}</span>
        {errors.length > 0 && (
          <span className="diagnostics-count-error">
            {t('diagnosticsErrors', { count: errors.length })}
          </span>
        )}
        {warnings.length > 0 && (
          <span className="diagnostics-count-warn">
            {t('diagnosticsWarnings', { count: warnings.length })}
          </span>
        )}
      </div>
      {sorted.map((marker, i) => (
        <div
          key={i}
          className="diagnostics-row"
          onClick={() => onJump(marker.startLineNumber, marker.startColumn)}
          role="button"
          tabIndex={0}
          onKeyDown={e => e.key === 'Enter' && onJump(marker.startLineNumber, marker.startColumn)}
        >
          <span className={`diagnostics-severity diagnostics-severity--${severityClass(marker.severity)}`}>
            {severityIcon(marker.severity)}
          </span>
          <span className="diagnostics-message">
            {marker.source ? `[${marker.source}] ` : ''}{marker.message}
          </span>
          <span className="diagnostics-location">
            {marker.startLineNumber}:{marker.startColumn}
          </span>
        </div>
      ))}
    </div>
  )
}

function severityClass(severity: number): string {
  if (severity === SEVERITY_ERROR) return 'error'
  if (severity === SEVERITY_WARNING) return 'warning'
  if (severity === SEVERITY_INFO) return 'info'
  return 'hint'
}

function severityIcon(severity: number): string {
  if (severity === SEVERITY_ERROR) return '✕'
  if (severity === SEVERITY_WARNING) return '⚠'
  if (severity === SEVERITY_INFO) return 'ℹ'
  return '◈'
}
