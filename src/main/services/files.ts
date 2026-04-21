import { logger } from '../lib/logger'
import { getGit } from './git/core'
import { existsSync, statSync, copyFileSync, mkdirSync, readdirSync, readFileSync } from 'fs'
import { join, dirname, relative } from 'path'
import { ServiceCache } from '../lib/serviceCache'

interface FileInfo {
  path: string
  exists: boolean
  size: number
}

interface IgnoredFile {
  path: string
  size: number
}

/**
 * Default discovery patterns for gitignored config/secret files.
 * Uses simple glob syntax: `*` matches any characters, everything else is literal.
 * Matched against the file's basename (last path segment).
 */
const DEFAULT_PATTERNS = [
  '.env*',               // .env, .env.local, .env.development.local …
  '.envrc',              // direnv
  '.secret',             // secret files
  '.secrets',
  '.npmrc',              // scoped registry tokens
  '.yarnrc.yml',         // yarn berry config
  '.ruby-version',       // Ruby version manager
  '.node-version',       // Node version manager
  '.tool-versions',      // asdf version manager
  'credentials.json',    // GCP / Firebase
  'serviceAccount*.json', // Firebase service accounts
  'google-services.json', // Android Firebase
  'GoogleService-Info.plist', // iOS Firebase
  '.sentryclirc',        // Sentry auth token
  'local.properties',    // Android SDK path
  '.claude*',            // Claude config files
]

/** Directories whose contents should never surface, even if basename matches. */
const NOISE_DIRS = [
  'node_modules', '.next', 'dist', 'build', '.cache', '.turbo',
  '__pycache__', '.git', '.yarn', 'vendor', 'coverage', '.output',
  '.nuxt', '.svelte-kit', '.parcel-cache', 'tmp', '.tmp',
]

/** Convert a simple glob pattern (only `*` wildcard) to a RegExp. */
function globToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')
  return new RegExp(`^${escaped}$`, 'i')
}

function isInNoiseDir(relativePath: string): boolean {
  const parts = relativePath.split('/')
  return parts.slice(0, -1).some((seg) => NOISE_DIRS.includes(seg))
}

function matchesPatterns(relativePath: string, regexes: RegExp[]): boolean {
  if (isInNoiseDir(relativePath)) return false
  const basename = relativePath.split('/').pop() ?? ''
  return regexes.some((re) => re.test(basename))
}

const MAX_DISCOVERED = 30

export type ProjectPlatform = 'mobile' | 'web' | 'unknown'
export type MobileFramework = 'react-native' | 'flutter' | null

/** React Native marker files at repo root. */
const RN_MARKERS = [
  'react-native.config.js',
  'react-native.config.ts',
  'metro.config.js',
  'metro.config.ts',
]

/** Check if package.json has react-native in dependencies or devDependencies. */
function hasRnDependency(repoPath: string): boolean {
  try {
    const raw = readFileSync(join(repoPath, 'package.json'), 'utf-8')
    const pkg = JSON.parse(raw)
    return !!(pkg.dependencies?.['react-native'] || pkg.devDependencies?.['react-native'])
  } catch { return false }
}

/** Check if pubspec.yaml contains flutter SDK dependency. */
function hasFlutterSdk(repoPath: string): boolean {
  try {
    const raw = readFileSync(join(repoPath, 'pubspec.yaml'), 'utf-8')
    return /flutter:\s*\n\s*sdk:\s*flutter/m.test(raw) || /sdk:\s*flutter/m.test(raw)
  } catch { return false }
}

/** Files whose presence indicates a mobile project. */
const MOBILE_MARKERS = [
  // React Native
  'react-native.config.js',
  'react-native.config.ts',
  'metro.config.js',
  'metro.config.ts',
  'app.json',            // RN & Expo
  // iOS native
  'Podfile',
  // Android native
  'gradlew',
  // Flutter
  'pubspec.yaml',
  // Cordova / Capacitor
  'config.xml',
  'capacitor.config.ts',
  'capacitor.config.json',
]

const ignoredFilesCache = new ServiceCache<IgnoredFile[]>(120_000) // 2 min

class FilesService {
  /**
   * Discover gitignored files in a worktree.
   * Uses `git ls-files --others --ignored --exclude-standard` for native .gitignore parsing.
   * Cached for 2 minutes — ignored files change very rarely during a session.
   */
  async getIgnoredFiles(worktreePath: string, patterns?: string[]): Promise<IgnoredFile[]> {
    if (!existsSync(worktreePath)) return []
    // Include patterns in cache key so different pattern sets don't collide
    const key = `${worktreePath}::${(patterns ?? []).sort().join(',')}`
    return ignoredFilesCache.get(key, () => this._fetchIgnoredFiles(worktreePath, patterns))
  }

  private async _fetchIgnoredFiles(worktreePath: string, patterns?: string[]): Promise<IgnoredFile[]> {
    try {
      const globs = (patterns && patterns.length > 0 ? patterns : DEFAULT_PATTERNS).map(globToRegex)
      const git = getGit(worktreePath)
      const raw = await git.raw(['ls-files', '--others', '--ignored', '--exclude-standard'])
      const files = raw
        .split('\n')
        .map((f) => f.trim())
        .filter((f) => f && matchesPatterns(f, globs))

      // Sort by depth (shallow first), then alphabetically
      files.sort((a, b) => {
        const da = a.split('/').length
        const db = b.split('/').length
        return da !== db ? da - db : a.localeCompare(b)
      })

      const results: IgnoredFile[] = []
      for (const file of files.slice(0, MAX_DISCOVERED)) {
        const abs = join(worktreePath, file)
        try {
          const stat = statSync(abs)
          if (stat.isFile()) results.push({ path: file, size: stat.size })
        } catch {
          // File may have been deleted between listing and stat
        }
      }
      return results
    } catch {
      return []
    }
  }

  /** Check existence and size for a list of relative file paths. */
  async getFileInfo(worktreePath: string, paths: string[]): Promise<FileInfo[]> {
    return paths.map((p) => {
      const abs = join(worktreePath, p)
      try {
        if (existsSync(abs)) {
          return { path: p, exists: true, size: statSync(abs).size }
        }
      } catch {
        // fall through
      }
      return { path: p, exists: false, size: 0 }
    })
  }

  /** Copy files from source to destination, preserving relative directory structure. */
  async copyFiles(
    sourcePath: string,
    destPath: string,
    relativePaths: string[]
  ): Promise<{ copied: string[]; failed: string[] }> {
    const copied: string[] = []
    const failed: string[] = []

    for (const rel of relativePaths) {
      const src = join(sourcePath, rel)
      const dest = join(destPath, rel)
      try {
        mkdirSync(dirname(dest), { recursive: true })
        copyFileSync(src, dest)
        copied.push(rel)
      } catch (err) {
        logger.error(`[Files] Failed to copy ${rel}:`, (err as Error).message)
        failed.push(rel)
      }
    }
    return { copied, failed }
  }

  /**
   * Detect whether a project is a mobile app by checking for well-known marker files.
   * Checks both root-level markers and presence of ios/android directories.
   */
  detectPlatform(repoPath: string): ProjectPlatform {
    if (!existsSync(repoPath)) return 'unknown'
    // Check marker files at repo root
    for (const marker of MOBILE_MARKERS) {
      if (existsSync(join(repoPath, marker))) return 'mobile'
    }
    // Check for ios/ or android/ subdirectories (common in RN, Flutter, native)
    if (existsSync(join(repoPath, 'ios')) || existsSync(join(repoPath, 'android'))) {
      return 'mobile'
    }
    // Check for .xcodeproj / .xcworkspace in root children
    try {
      const entries = readdirSync(repoPath, { encoding: 'utf-8' })
      if (entries.some((e) => e.endsWith('.xcodeproj') || e.endsWith('.xcworkspace'))) {
        return 'mobile'
      }
    } catch { /* ignore */ }
    return 'unknown'
  }

  /**
   * Detect the mobile framework used by a project.
   * Checks for React Native markers/deps first, then Flutter.
   */
  detectMobileFramework(repoPath: string): MobileFramework {
    if (!existsSync(repoPath)) return null
    // React Native: marker files or package.json dependency
    for (const marker of RN_MARKERS) {
      if (existsSync(join(repoPath, marker))) return 'react-native'
    }
    if (hasRnDependency(repoPath)) return 'react-native'
    // Flutter: pubspec.yaml with flutter SDK
    if (existsSync(join(repoPath, 'pubspec.yaml')) && hasFlutterSdk(repoPath)) return 'flutter'
    return null
  }

  /** Check whether a path exists on disk. */
  pathExists(dirPath: string): boolean {
    return existsSync(dirPath)
  }

  /** Convert absolute file paths to paths relative to a base directory. */
  toRelativePaths(basePath: string, absolutePaths: string[]): string[] {
    return absolutePaths
      .filter((p) => p.startsWith(basePath))
      .map((p) => relative(basePath, p))
      .filter(Boolean)
  }
}

export const filesService = new FilesService()
