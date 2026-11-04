// Self-hosted Hazel instance (vercel/hazel) that proxies gedeagas/braid GitHub Releases.
const UPDATE_SERVICE_URL = 'https://hazel-phi-indol.vercel.app'
const SEMVER_PATTERN = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/

export interface UpdateFeedRelease {
  version: string
  releaseNotes: string
}

/** Hazel names Apple Silicon `darwin_arm64`; every other target uses the bare platform. */
function toHazelPlatform(platform: NodeJS.Platform, arch: string): string {
  return platform === 'darwin' && arch === 'arm64' ? 'darwin_arm64' : platform
}

export function buildUpdateFeedUrl(
  platform: NodeJS.Platform,
  arch: string,
  version: string
): string {
  const target = encodeURIComponent(toHazelPlatform(platform, arch))
  return `${UPDATE_SERVICE_URL}/update/${target}/${encodeURIComponent(version)}`
}

export function parseUpdateFeedRelease(value: unknown): UpdateFeedRelease {
  if (!value || typeof value !== 'object') throw invalidResponse()

  const { name, notes, url } = value as Record<string, unknown>
  if (typeof name !== 'string' || typeof url !== 'string') throw invalidResponse()
  // Hazel forwards GitHub's release body verbatim, which is null for releases without notes.
  if (notes != null && typeof notes !== 'string') throw invalidResponse()

  const version = name.startsWith('v') ? name.slice(1) : name
  if (!SEMVER_PATTERN.test(version) || !isSecureUrl(url)) throw invalidResponse()

  return { version, releaseNotes: notes ?? '' }
}

/**
 * True when `candidate` is a strictly newer semantic version than `current`.
 * Hazel offers its cached release whenever it differs from the client version,
 * including older ones, so callers must reject anything that is not an upgrade.
 * Invalid versions are never considered newer.
 */
export function isNewerVersion(candidate: string, current: string): boolean {
  const a = SEMVER_PATTERN.exec(candidate)
  const b = SEMVER_PATTERN.exec(current)
  if (!a || !b) return false

  for (let i = 1; i <= 3; i++) {
    const diff = Number(a[i]) - Number(b[i])
    if (diff !== 0) return diff > 0
  }
  return comparePrerelease(a[4], b[4]) > 0
}

/** Semver prerelease precedence: a release outranks any prerelease of the same core version. */
function comparePrerelease(a: string | undefined, b: string | undefined): number {
  if (a === b) return 0
  if (a === undefined) return 1
  if (b === undefined) return -1

  const left = a.split('.')
  const right = b.split('.')
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    if (left[i] === undefined) return -1
    if (right[i] === undefined) return 1
    const order = compareIdentifier(left[i], right[i])
    if (order !== 0) return order
  }
  return 0
}

function compareIdentifier(a: string, b: string): number {
  const aNumeric = /^\d+$/.test(a)
  const bNumeric = /^\d+$/.test(b)
  if (aNumeric && bNumeric) return Number(a) - Number(b)
  if (aNumeric) return -1
  if (bNumeric) return 1
  return a < b ? -1 : a > b ? 1 : 0
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
