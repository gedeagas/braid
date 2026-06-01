import type { ToolInstallKey, ToolInstallResult } from '@shared/tool-install'

export interface AdminInstallRequest {
  key: ToolInstallKey
  result: ToolInstallResult
}

type Listener = () => void

let currentRequest: AdminInstallRequest | null = null
let resolver: ((approved: boolean) => void) | null = null
const listeners = new Set<Listener>()

function emit(): void {
  for (const listener of listeners) listener()
}

export function subscribeAdminInstallPrompt(listener: Listener): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function getAdminInstallRequest(): AdminInstallRequest | null {
  return currentRequest
}

export function requestAdminInstallApproval(request: AdminInstallRequest): Promise<boolean> {
  // Cancel any in-flight request first. Capture and clear the resolver before
  // settling it so the rejected request can't observe the new resolver.
  if (resolver) {
    const prevResolver = resolver
    resolver = null
    prevResolver(false)
  }

  currentRequest = request
  emit()

  return new Promise<boolean>((resolve) => {
    resolver = resolve
  })
}

export function resolveAdminInstallApproval(approved: boolean): void {
  const resolve = resolver
  currentRequest = null
  resolver = null
  emit()
  resolve?.(approved)
}
