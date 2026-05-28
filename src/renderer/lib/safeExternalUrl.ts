const SAFE_EXTERNAL_PROTOCOLS = new Set(['http:', 'https:'])

export function resolveSafeExternalUrl(href: string | null | undefined, baseUrl?: string): string | null {
  const raw = href?.trim()
  if (!raw) return null

  try {
    const url = baseUrl ? new URL(raw, baseUrl) : new URL(raw)
    return SAFE_EXTERNAL_PROTOCOLS.has(url.protocol) ? url.toString() : null
  } catch {
    return null
  }
}
