import { execFileSync } from 'child_process'
import { hostname } from 'os'

function scutilValue(key: 'ComputerName' | 'LocalHostName'): string | null {
  if (process.platform !== 'darwin') return null
  try {
    const value = execFileSync('/usr/sbin/scutil', ['--get', key], {
      encoding: 'utf8',
      timeout: 1000,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    return value || null
  } catch {
    return null
  }
}

function readableHostName(value: string): string {
  return value
    .replace(/\.local$/i, '')
    .replace(/-\d+$/u, '')
    .replaceAll('-', ' ')
    .trim()
}

export function getMobileInstanceName(): string {
  return scutilValue('ComputerName') ?? readableHostName(scutilValue('LocalHostName') ?? hostname()) ?? 'Braid desktop'
}

export function getMobileMachineName(): string {
  return scutilValue('LocalHostName') ?? readableHostName(hostname()) ?? 'Braid'
}
