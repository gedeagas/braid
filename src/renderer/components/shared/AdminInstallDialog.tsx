import { useSyncExternalStore } from 'react'
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
      title={`Install ${toolName}`}
      width="460px"
      actions={(
        <>
          <Button onClick={() => resolveAdminInstallApproval(false)}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => resolveAdminInstallApproval(true)}>
            Continue
          </Button>
        </>
      )}
    >
      <div className="admin-install-dialog">
        <p>
          Braid will install {toolName} to <code>{targetPath}</code> so every shell and external app can find it.
        </p>
        <p>
          macOS will ask for an administrator password before writing to this system location.
        </p>
      </div>
    </Dialog>
  )
}
