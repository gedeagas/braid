import { useSyncExternalStore } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { Dialog } from '@/components/ui/Dialog'
import { Button } from '@/components/ui/Button'
import {
  getAdminInstallRequest,
  resolveAdminInstallApproval,
  subscribeAdminInstallPrompt,
} from '@/lib/adminInstallPrompt'

function displayToolName(key: string): string {
  if (key === 'acli') return 'Atlassian CLI'
  if (key === 'gh') return 'GitHub CLI'
  if (key === 'mobilecli') return 'mobilecli'
  if (key === 'claude') return 'Claude Code'
  return key
}

export function AdminInstallDialog() {
  const { t } = useTranslation('common')
  const request = useSyncExternalStore(
    subscribeAdminInstallPrompt,
    getAdminInstallRequest,
    getAdminInstallRequest,
  )

  if (!request) return null

  const toolName = displayToolName(request.key)
  const targetPath = request.result.targetPath ?? '/usr/local/bin'

  return (
    <Dialog
      isOpen
      onClose={() => resolveAdminInstallApproval(false)}
      title={t('adminInstall.title', { tool: toolName })}
      width="460px"
      actions={(
        <>
          <Button onClick={() => resolveAdminInstallApproval(false)}>
            {t('adminInstall.cancel')}
          </Button>
          <Button variant="primary" onClick={() => resolveAdminInstallApproval(true)}>
            {t('adminInstall.continue')}
          </Button>
        </>
      )}
    >
      <div className="admin-install-dialog">
        <p>
          <Trans
            i18nKey="adminInstall.body"
            ns="common"
            values={{ tool: toolName, path: targetPath }}
            components={{ code: <code /> }}
          />
        </p>
        <p>{t('adminInstall.note')}</p>
      </div>
    </Dialog>
  )
}
