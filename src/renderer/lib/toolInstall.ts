import { shell } from './ipc'
import { flash } from '@/store/flash'
import { requestAdminInstallApproval } from './adminInstallPrompt'
import type { ToolInstallKey, ToolInstallResult } from '@shared/tool-install'

export interface ToolInstallOutcome {
  installed: boolean
  result: ToolInstallResult | null
}

interface InstallOptions {
  notify?: boolean
}

async function verifySafely(verify: () => Promise<boolean>): Promise<boolean> {
  try {
    return await verify()
  } catch {
    return false
  }
}

function notifyFailure(key: ToolInstallKey, result: ToolInstallResult | null, error?: unknown): void {
  const fallback = `Failed to install ${key}.`
  const message = result?.message
    || (error instanceof Error ? error.message : null)
    || fallback
  flash('error', message, 7000)
}

export async function installToolAndVerify(
  key: ToolInstallKey,
  verify: () => Promise<boolean>,
  options: InstallOptions = {},
): Promise<ToolInstallOutcome> {
  const shouldNotify = options.notify ?? true

  let installResult: ToolInstallResult
  try {
    installResult = await shell.installTool(key)
  } catch (error) {
    if (shouldNotify) notifyFailure(key, null, error)
    return { installed: false, result: null }
  }

  if (installResult.reason === 'admin_required') {
    const approved = await requestAdminInstallApproval({ key, result: installResult })
    if (!approved) return { installed: false, result: installResult }

    try {
      installResult = await shell.installTool(key, { allowAdmin: true })
    } catch (error) {
      if (shouldNotify) notifyFailure(key, null, error)
      return { installed: false, result: null }
    }
  }

  const installed = installResult.installed || await verifySafely(verify)
  if (!installed && shouldNotify) notifyFailure(key, installResult)

  return { installed, result: installResult }
}
