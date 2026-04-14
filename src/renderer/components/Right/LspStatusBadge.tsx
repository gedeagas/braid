import { Spinner } from '@/components/ui'
import { useTranslation } from 'react-i18next'
import type { LspServerHandle, LspServerStatus } from '@/types'
import { languageAbbrev, languageColor, languageFamily } from '@/lib/lspUtils'

interface Props {
  statuses: LspServerHandle[]
  languageId: string
}

export function LspStatusBadge({ statuses, languageId }: Props) {
  const { t } = useTranslation('right')

  const handle = statuses.find(s => s.languageId === languageFamily(languageId))
  if (!handle || handle.status === 'stopped') return null

  return (
    <div
      className={`lsp-badge lsp-badge--${handle.status}`}
      title={statusTitle(handle, t)}
    >
      {statusDot(handle, languageId)}
      {statusLabel(handle, languageId, t)}
    </div>
  )
}

function statusDot(handle: LspServerHandle, languageId: string) {
  const { status } = handle

  if (status === 'starting') {
    return <span className="lsp-dot lsp-dot--starting" />
  }
  if (status === 'indexing') {
    return <Spinner size="sm" />
  }
  if (status === 'error') {
    return <span className="lsp-dot lsp-dot--error" />
  }
  // ready
  return (
    <span
      className="lsp-dot"
      style={{ background: languageColor(languageId) }}
    />
  )
}

function statusLabel(
  handle: LspServerHandle,
  languageId: string,
  t: ReturnType<typeof useTranslation>['t']
): string {
  const { status } = handle
  if (status === 'starting') return t('lspStarting')
  if (status === 'indexing') return t('lspIndexing')
  if (status === 'error') return t('lspError')
  return languageAbbrev(languageId)
}

function statusTitle(
  handle: LspServerHandle,
  t: ReturnType<typeof useTranslation>['t']
): string {
  if (handle.status === 'error' && handle.error) return handle.error
  if (handle.status === 'ready') return t('lspReady', { lang: languageAbbrev(handle.languageId) })
  if (handle.status === 'indexing') return t('lspIndexing')
  if (handle.status === 'starting') return t('lspStarting')
  return ''
}
