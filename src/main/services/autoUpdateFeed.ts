const UPDATE_SERVICE_URL = 'https://update.electronjs.org'
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/

export interface UpdateFeedRelease {
  version: string
  releaseNotes: string
}

export function buildUpdateFeedUrl(
  owner: string,
  repo: string,
  platform: NodeJS.Platform,
  arch: string,
  version: string
): string {
  const repository = `${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`
  const target = `${encodeURIComponent(platform)}-${encodeURIComponent(arch)}`
  return `${UPDATE_SERVICE_URL}/${repository}/${target}/${encodeURIComponent(version)}`
}

export function parseUpdateFeedRelease(value: unknown): UpdateFeedRelease {
  if (!value || typeof value !== 'object') throw invalidResponse()

  const { name, notes, url } = value as Record<string, unknown>
  if (typeof name !== 'string' || typeof url !== 'string') throw invalidResponse()
  if (notes !== undefined && typeof notes !== 'string') throw invalidResponse()

  const version = name.startsWith('v') ? name.slice(1) : name
  if (!SEMVER_PATTERN.test(version) || !isSecureUrl(url)) throw invalidResponse()

  return { version, releaseNotes: notes ?? '' }
}

function isSecureUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}

function invalidResponse(): Error {
  return new Error('Invalid response from update service')
}
