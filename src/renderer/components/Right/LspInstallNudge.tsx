import { Spinner } from '@/components/ui'
import { useReducer } from 'react'
import { useTranslation } from 'react-i18next'
import type { LspDetectedServer } from '@/types'
import * as ipc from '@/lib/ipc'
import { languageAbbrev, languageColor } from '@/lib/lspUtils'

interface Props {
  server: LspDetectedServer
  projectRoot: string
  onInstalled: () => void
}

type State =
  | { phase: 'idle' }
  | { phase: 'installing' }
  | { phase: 'error'; message: string }

type Action =
  | { type: 'start' }
  | { type: 'done' }
  | { type: 'fail'; message: string }

function reducer(_state: State, action: Action): State {
  switch (action.type) {
    case 'start': return { phase: 'installing' }
    case 'done':  return { phase: 'idle' }
    case 'fail':  return { phase: 'error', message: action.message }
    default:      return _state
  }
}

export function LspInstallNudge({ server, projectRoot: _projectRoot, onInstalled }: Props) {
  const { t } = useTranslation('right')
  const [state, dispatch] = useReducer(reducer, { phase: 'idle' })
  const { config, installVia } = server
  const abbrev = languageAbbrev(config.languageId)
  const color  = languageColor(config.languageId)

  const handleInstall = async () => {
    dispatch({ type: 'start' })
    try {
      await ipc.lsp.installServer(config.id, [])
      dispatch({ type: 'done' })
      onInstalled()
    } catch (err) {
      dispatch({ type: 'fail', message: (err as Error).message })
    }
  }

  // ── No suitable installer available ─────────────────────────────────────────
  if (!installVia) {
    return (
      <div
        className="lsp-nudge lsp-nudge--unavailable"
        title={config.installHint ?? t('lspNoInstaller', { lang: abbrev })}
      >
        <span className="lsp-nudge-dot" style={{ background: color, opacity: 0.3 }} />
        <span className="lsp-nudge-label">{abbrev} LSP</span>
        <span className="lsp-nudge-unavail-icon">⊘</span>
      </div>
    )
  }

  // ── Installing ───────────────────────────────────────────────────────────────
  if (state.phase === 'installing') {
    return (
      <div className="lsp-nudge lsp-nudge--installing">
        <Spinner size="sm" />
        <span className="lsp-nudge-label">{t('lspInstalling', { lang: abbrev, via: installVia })}</span>
      </div>
    )
  }

  // ── Install failed ───────────────────────────────────────────────────────────
  if (state.phase === 'error') {
    return (
      <div className="lsp-nudge lsp-nudge--error" title={state.message}>
        <span className="lsp-nudge-icon">⚠</span>
        <span className="lsp-nudge-label">{t('lspInstallFailed', { lang: abbrev })}</span>
        {config.installHint && (
          <code className="lsp-nudge-hint">{config.installHint}</code>
        )}
        <button className="lsp-nudge-btn" onClick={handleInstall}>
          {t('lspRetry')}
        </button>
      </div>
    )
  }

  // ── Ready to install ─────────────────────────────────────────────────────────
  return (
    <div className="lsp-nudge">
      <span className="lsp-nudge-dot" style={{ background: color, opacity: 0.5 }} />
      <span className="lsp-nudge-label">{t('lspNotInstalled', { lang: abbrev })}</span>
      <button className="lsp-nudge-btn" onClick={handleInstall}>
        {t('lspInstallVia', { via: installVia })}
      </button>
    </div>
  )
}
