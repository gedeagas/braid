#!/usr/bin/env node

/**
 * Package the Braid Electron app for macOS using @electron/packager.
 *
 * Pipeline:
 *   1. Prepare CastLabs Electron ZIP (packager expects a ZIP, not installed binary)
 *   2. @electron/packager -> Braid.app (no signing - VMP must come first)
 *   3. VMP signing (Widevine, before code signing)
 *   4. Code signing via @electron/osx-sign
 *   5. Notarization via @electron/notarize
 *   6. DMG creation via electron-installer-dmg
 *
 * Usage:
 *   node scripts/package.js                  # arm64 + x64, signed + notarized
 *   node scripts/package.js --arch arm64     # arm64 only
 *   node scripts/package.js --unsigned       # skip signing + notarization
 *
 * Environment variables (for signing):
 *   APPLE_ID                   - Apple ID email
 *   APPLE_APP_SPECIFIC_PASSWORD - app-specific password
 *   APPLE_TEAM_ID              - 10-char team ID
 */

const path = require('path')
const fs = require('fs')
const { execSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..')

// Load .env.local if it exists (APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID)
const envPath = path.join(ROOT, '.env.local')
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    let val = trimmed.slice(eq + 1).trim()
    // Strip surrounding quotes
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    if (!process.env[key]) process.env[key] = val
  }
}
const OUT_DIR = path.join(ROOT, 'dist')
const BUILD_DIR = path.join(ROOT, 'build')
const ELECTRON_DIST = path.join(ROOT, 'node_modules/electron/dist')

const APP_PKG = require(path.join(ROOT, 'package.json'))
const ELECTRON_PKG = require(path.join(ROOT, 'node_modules/electron/package.json'))

const APP_NAME = 'Braid'
const APP_BUNDLE_ID = process.env.APP_BUNDLE_ID || 'com.braidapp.desktop'
const APP_VERSION = APP_PKG.version
const ELECTRON_VERSION = ELECTRON_PKG.version // e.g. "39.8.0+wvcus"
const TEAM_ID = process.env.APPLE_TEAM_ID || ''
const SIGNING_IDENTITY = process.env.SIGNING_IDENTITY || (() => {
  if (!TEAM_ID) return ''
  // Find the full identity name from the keychain - codesign requires an exact match
  try {
    const ids = require('child_process')
      .execSync('security find-identity -v -p codesigning', { encoding: 'utf8' })
    const match = ids.match(new RegExp(`"(Developer ID Application[^"]*\\(${TEAM_ID}\\))"`))
    if (match) return match[1]
  } catch {}
  return `Developer ID Application (${TEAM_ID})`
})()

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const args = process.argv.slice(2)
const unsigned = args.includes('--unsigned')
const archIdx = args.indexOf('--arch')
const archFlag = archIdx !== -1 ? args[archIdx + 1] : null
const targetArchs = archFlag ? [archFlag] : ['arm64', 'x64']

// ---------------------------------------------------------------------------
// Progress spinner
// ---------------------------------------------------------------------------

const FRAMES = ['\u280B', '\u2819', '\u2839', '\u2838', '\u283C', '\u2834', '\u2826', '\u2827', '\u2807', '\u280F']

function timer(label) {
  const start = Date.now()
  let frame = 0
  const tty = process.stderr.isTTY
  const iv = setInterval(() => {
    const s = ((Date.now() - start) / 1000).toFixed(1)
    frame++
    if (tty) {
      process.stderr.write(`\r  ${FRAMES[frame % FRAMES.length]} ${label} - ${s}s`)
    } else if (frame % 30 === 0) {
      process.stderr.write(`  ${label} - ${s}s\n`)
    }
  }, 500)
  return () => {
    clearInterval(iv)
    const s = ((Date.now() - start) / 1000).toFixed(1)
    if (tty) process.stderr.write('\r\x1b[K')
    return s
  }
}

function log(msg) {
  console.log(`[package] ${msg}`)
}

function step(tag, msg) {
  console.log(`\n[${tag}] ${msg}`)
}

// ---------------------------------------------------------------------------
// 1. Prepare CastLabs Electron ZIP
// ---------------------------------------------------------------------------

function prepareElectronZip(arch) {
  const zipDir = path.join(ROOT, '.electron-zips')
  fs.mkdirSync(zipDir, { recursive: true })

  const zipName = `electron-v${ELECTRON_VERSION}-darwin-${arch}.zip`
  const zipPath = path.join(zipDir, zipName)

  if (fs.existsSync(zipPath)) {
    log(`Reusing cached Electron ZIP: ${zipName}`)
    return zipDir
  }

  step('zip', `Creating ${zipName} from node_modules/electron/dist/`)
  const stop = timer('Zipping Electron binary')

  // Zip contents of dist/ (preserving symlinks with -y)
  execSync(`cd "${ELECTRON_DIST}" && zip -r -y -q "${zipPath}" .`, { stdio: 'inherit' })

  const elapsed = stop()
  const mb = (fs.statSync(zipPath).size / 1024 / 1024).toFixed(1)
  log(`Electron ZIP created in ${elapsed}s (${mb}MB)`)
  return zipDir
}

// ---------------------------------------------------------------------------
// 2. Ignore filter (replaces electron-builder `files` exclusions)
// ---------------------------------------------------------------------------

const IGNORE_PATTERNS = [
  /^\/\.vscode(\/|$)/,
  /^\/src(\/|$)/,
  /^\/electron\.vite\.config\.(js|ts|mjs|cjs)$/,
  /^\/(\.eslintignore|\.eslintrc\.cjs|\.prettierignore|\.prettierrc\.yaml)$/,
  /^\/(dev-app-update\.yml|CHANGELOG\.md|README\.md)$/,
  /^\/(tsconfig\.json|tsconfig\.node\.json|tsconfig\.web\.json)$/,
  // monaco-editor: dev/esm/min-maps are ~83MB of dead weight
  /\/node_modules\/monaco-editor\/dev(\/|$)/,
  /\/node_modules\/monaco-editor\/esm(\/|$)/,
  /\/node_modules\/monaco-editor\/min-maps(\/|$)/,
  // @mobilenext/mobilecli: 53MB of platform binaries (user installs via brew)
  /\/node_modules\/@mobilenext\/mobilecli\/bin(\/|$)/,
  // node-pty: strip non-macOS prebuilds (~58MB win32)
  /\/node_modules\/node-pty\/prebuilds\/win32-/,
  /\/node_modules\/node-pty\/prebuilds\/linux-/,
  // node-pty: build artifacts not needed at runtime (~4MB)
  /\/node_modules\/node-pty\/src(\/|$)/,
  /\/node_modules\/node-pty\/third_party(\/|$)/,
  /\/node_modules\/node-pty\/deps(\/|$)/,
  /\/node_modules\/node-pty\/scripts(\/|$)/,
  // Claude SDK: non-darwin vendor binaries (~22MB)
  /\/node_modules\/@anthropic-ai\/claude-agent-sdk\/vendor\/ripgrep\/(x64|arm64)-(linux|win32)(\/|$)/,
  /\/node_modules\/@anthropic-ai\/claude-agent-sdk\/vendor\/audio-capture\/(x64|arm64)-(linux|win32)(\/|$)/,
  // TypeScript type declarations - not needed at runtime
  /\/node_modules\/@types(\/|$)/,
  // Source maps inside node_modules
  /\/node_modules\/.*\.js\.map$/,
  /\/node_modules\/.*\.mjs\.map$/,
  // highlight.js: individual language files already bundled by Vite via lowlight/common
  /\/node_modules\/highlight\.js\/lib\/languages(\/|$)/,
  /\/node_modules\/highlight\.js\/es(\/|$)/,
  /\/node_modules\/highlight\.js\/scss(\/|$)/,
  /\/node_modules\/highlight\.js\/styles(\/|$)/,
  // Build/tool directories
  /^\/dist(\/|$)/,
  /^\/build(\/|$)/,
  /^\/\.electron-zips(\/|$)/,
  /^\/scripts(\/|$)/,
  /^\/website(\/|$)/,
  /^\/docs(\/|$)/,
  /^\/\.claude(\/|$)/,
  /^\/\.env/,
  /^\/\.git(\/|$)/,
  /^\/\.yarn(\/|$)/,
  /^\/\.yarnrc\.yml$/,
  /^\/yarn\.lock$/,
  /^\/CLAUDE\.md$/,
  /^\/vitest\.config\./,
]

function createIgnore(arch) {
  // Keep only the darwin binary matching the target arch (~13MB instead of ~53MB)
  const keepBinary = `mobilecli-darwin-${arch === 'arm64' ? 'arm64' : 'amd64'}`
  return function shouldIgnore(filePath) {
    // Strip non-matching darwin binary (the non-darwin ones are already caught by IGNORE_PATTERNS)
    if (/\/node_modules\/@mobilenext\/mobilecli\/bin\/mobilecli-darwin-/.test(filePath)) {
      return !filePath.endsWith(keepBinary)
    }
    return IGNORE_PATTERNS.some((re) => re.test(filePath))
  }
}

// ---------------------------------------------------------------------------
// 3. VMP signing (must happen before code signing)
// ---------------------------------------------------------------------------

function vmpSign(appOutDir) {
  step('vmp', `Signing at: ${appOutDir}`)
  const stop = timer('VMP signing')
  try {
    execSync(`python3 -m castlabs_evs.vmp sign-pkg "${appOutDir}"`, { stdio: 'inherit' })
    const elapsed = stop()
    log(`VMP signing complete in ${elapsed}s`)
  } catch (err) {
    stop()
    console.error('[vmp] VMP signing failed - Widevine will not work.')
    throw err
  }
}

// ---------------------------------------------------------------------------
// 4. Fix execute permissions on unpacked native helper binaries
// ---------------------------------------------------------------------------

function fixNativePermissions(appPath) {
  const unpackedDir = path.join(appPath, 'Contents/Resources/app.asar.unpacked')
  if (!fs.existsSync(unpackedDir)) return

  step('perms', 'Restoring execute permissions on native binaries')
  // Find Mach-O executables that lost +x during ASAR unpack
  const result = execSync(
    `find "${unpackedDir}" -type f -exec file {} + | grep "Mach-O" | grep -v "\\.node:" | grep -v "\\.dylib:" | cut -d: -f1`,
    { encoding: 'utf8' }
  ).trim()

  if (!result) {
    log('No native helper binaries found')
    return
  }

  const binaries = result.split('\n').filter(Boolean)
  for (const bin of binaries) {
    fs.chmodSync(bin, 0o755)
    log(`chmod +x ${path.relative(appPath, bin)}`)
  }
  log(`Fixed permissions on ${binaries.length} native helper(s)`)
}

// ---------------------------------------------------------------------------
// 5. Strip adhoc linker signatures (CastLabs binaries ship with them)
// ---------------------------------------------------------------------------

function stripAdhocSignatures(appPath) {
  step('strip', 'Removing adhoc signatures before code signing')
  // Strip from all Mach-O binaries, dylibs, and bundles so @electron/osx-sign
  // starts from a clean slate. Without this, the existing adhoc signatures
  // reference resources that don't exist yet, causing codesign verification to fail.
  execSync(
    `find "${appPath}" -type f \\( -name "*.dylib" -o -name "*.so" -o -name "*.node" -o -perm +111 \\) -exec codesign --remove-signature {} + 2>/dev/null || true`,
    { stdio: 'pipe' }
  )
  execSync(
    `find "${appPath}" \\( -name "*.framework" -o -name "*.app" \\) -exec codesign --remove-signature {} + 2>/dev/null || true`,
    { stdio: 'pipe' }
  )
  log('Adhoc signatures stripped')
}

// ---------------------------------------------------------------------------
// 5. Code signing via @electron/osx-sign
// ---------------------------------------------------------------------------

async function codeSign(appPath) {
  const { signAsync } = require('@electron/osx-sign')

  stripAdhocSignatures(appPath)

  step('sign', `Code signing: ${path.basename(appPath)}`)
  const stop = timer('Code signing')

  await signAsync({
    app: appPath,
    identity: SIGNING_IDENTITY,
    platform: 'darwin',
  })

  const elapsed = stop()
  log(`Code signing complete in ${elapsed}s`)
}

// ---------------------------------------------------------------------------
// 5. Notarization via @electron/notarize
// ---------------------------------------------------------------------------

async function notarizeApp(appPath) {
  const { notarize } = require('@electron/notarize')

  const { APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID } = process.env
  if (!APPLE_ID || !APPLE_APP_SPECIFIC_PASSWORD || !APPLE_TEAM_ID) {
    log('Skipping notarization - APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, or APPLE_TEAM_ID not set.')
    return
  }

  step('notarize', `Submitting to Apple (team: ${APPLE_TEAM_ID})...`)
  log('This usually takes 1-5 minutes.')
  const stop = timer('Waiting for Apple notarization')

  try {
    await notarize({
      appPath,
      appleId: APPLE_ID,
      appleIdPassword: APPLE_APP_SPECIFIC_PASSWORD,
      teamId: APPLE_TEAM_ID,
    })
  } finally {
    const elapsed = stop()
    log(`Notarization complete in ${elapsed}s`)
  }
}

// ---------------------------------------------------------------------------
// 6. DMG creation via electron-installer-dmg
// ---------------------------------------------------------------------------

async function makeDmg(appPath, arch) {
  const { createDMG } = require('electron-installer-dmg')

  const dmgName = `${APP_PKG.name}-${APP_VERSION}-${arch}`
  step('dmg', `Creating ${dmgName}.dmg`)
  const stop = timer('Creating DMG')

  fs.mkdirSync(OUT_DIR, { recursive: true })

  await createDMG({
    appPath,
    name: dmgName,
    out: OUT_DIR,
    title: APP_NAME,
    icon: path.join(BUILD_DIR, 'icon.icns'),
    overwrite: true,
  })

  const elapsed = stop()
  const dmgPath = path.join(OUT_DIR, `${dmgName}.dmg`)
  const mb = (fs.statSync(dmgPath).size / 1024 / 1024).toFixed(1)
  log(`DMG created in ${elapsed}s: ${dmgPath} (${mb}MB)`)
  return dmgPath
}

// ---------------------------------------------------------------------------
// 7. ZIP for auto-update (electron-updater needs .zip, not .dmg)
// ---------------------------------------------------------------------------

function makeZip(appPath, arch) {
  const zipName = `${APP_PKG.name}-${APP_VERSION}-${arch}-mac.zip`
  const zipPath = path.join(OUT_DIR, zipName)

  step('zip', `Creating ${zipName} for auto-update`)
  const stop = timer('Creating update ZIP')

  fs.mkdirSync(OUT_DIR, { recursive: true })

  // ditto preserves code signatures, xattrs, and symlinks
  execSync(`ditto -c -k --sequesterRsrc --keepParent "${appPath}" "${zipPath}"`)

  const elapsed = stop()
  const mb = (fs.statSync(zipPath).size / 1024 / 1024).toFixed(1)
  log(`Update ZIP created in ${elapsed}s: ${zipPath} (${mb}MB)`)
  return { zipPath, zipName }
}

// ---------------------------------------------------------------------------
// 8. latest-mac.yml manifest for electron-updater
// ---------------------------------------------------------------------------

function writeUpdateManifest(artifacts) {
  const crypto = require('crypto')

  const files = artifacts.map(({ zipPath, zipName }) => {
    const buffer = fs.readFileSync(zipPath)
    const sha512 = crypto.createHash('sha512').update(buffer).digest('base64')
    return { url: zipName, sha512, size: buffer.length }
  })

  // electron-updater expects YAML with top-level path/sha512 for the primary
  // file (backwards compat) plus a files[] array for multi-arch.
  const primary = files[0]
  const lines = [
    `version: ${APP_VERSION}`,
    'files:',
  ]
  for (const f of files) {
    lines.push(`  - url: ${f.url}`)
    lines.push(`    sha512: ${f.sha512}`)
    lines.push(`    size: ${f.size}`)
  }
  // Top-level path + sha512 required by electron-updater for compat
  lines.push(`path: ${primary.url}`)
  lines.push(`sha512: ${primary.sha512}`)
  lines.push(`releaseDate: '${new Date().toISOString()}'`)

  const ymlPath = path.join(OUT_DIR, 'latest-mac.yml')
  fs.writeFileSync(ymlPath, lines.join('\n') + '\n')
  log(`Update manifest written: ${ymlPath}`)
  return ymlPath
}

// ---------------------------------------------------------------------------
// Package one architecture
// ---------------------------------------------------------------------------

async function packageArch(arch) {
  const packager = require('@electron/packager')

  step('pack', `Packaging ${APP_NAME} for darwin-${arch}`)
  const electronZipDir = prepareElectronZip(arch)

  const stop = timer(`Packaging darwin-${arch}`)

  const outputPaths = await packager({
    dir: ROOT,
    name: APP_NAME,
    platform: 'darwin',
    arch,
    electronVersion: ELECTRON_VERSION,
    electronZipDir,
    appBundleId: APP_BUNDLE_ID,
    appVersion: APP_VERSION,
    icon: path.join(BUILD_DIR, 'icon.icns'),
    out: OUT_DIR,
    overwrite: true,
    prune: true,

    // ASAR with selective unpacking for native modules, Claude SDK, and mobilecli
    asar: {
      unpack:
        '{**/*.node,**/node_modules/node-pty/**,**/node_modules/@anthropic-ai/claude-agent-sdk/**,**/node_modules/@mobilenext/mobilecli/bin/*}',
    },

    ignore: createIgnore(arch),

    // Info.plist extensions
    extendInfo: {
      CFBundleIconName: APP_NAME, // macOS 26+ Liquid Glass icon (from Assets.car)
      NSCameraUsageDescription:
        'Braid needs camera access for video calls in embedded web apps like Google Meet.',
      NSMicrophoneUsageDescription:
        'Braid needs microphone access for calls in embedded web apps like Google Meet.',
      NSCameraUseContinuityCameraDeviceType: true,
    },

    // Signing handled manually after VMP step
    osxSign: false,
  })

  const elapsed = stop()
  const outputDir = outputPaths[0] // e.g. "dist/Braid-darwin-arm64"
  log(`Packaging complete in ${elapsed}s: ${outputDir}`)

  const appPath = path.join(outputDir, `${APP_NAME}.app`)

  // Inject app-update.yml so electron-updater doesn't throw ENOENT.
  // setFeedURL() in autoUpdate.ts overrides the provider config for checking,
  // but getOrCreateDownloadHelper() still reads this file at download time to
  // get updaterCacheDirName for the disk cache directory.
  const appUpdateYml = [
    'provider: github',
    'owner: gedeagas',
    'repo: braid',
    `updaterCacheDirName: ${APP_PKG.name}-updater`,
    '',
  ].join('\n')
  const resourcesDir = path.join(appPath, 'Contents/Resources')
  fs.writeFileSync(path.join(resourcesDir, 'app-update.yml'), appUpdateYml)
  log('Injected app-update.yml into Resources/')

  // Copy Assets.car for macOS 26+ Liquid Glass icon (compiled by generate-icon.js)
  const assetsCar = path.join(BUILD_DIR, 'Assets.car')
  if (fs.existsSync(assetsCar)) {
    fs.copyFileSync(assetsCar, path.join(resourcesDir, 'Assets.car'))
    log('Copied Assets.car into Resources/ (Liquid Glass icon)')
  }

  // Fix native binary permissions (ASAR unpack strips +x from Mach-O helpers)
  fixNativePermissions(appPath)

  // VMP signing (must happen before code signing)
  vmpSign(outputDir)

  if (!unsigned) {
    await codeSign(appPath)
    await notarizeApp(appPath)
  } else {
    log('Skipping code signing and notarization (--unsigned)')
  }

  const dmgPath = await makeDmg(appPath, arch)
  const { zipPath, zipName } = makeZip(appPath, arch)
  return { arch, outputDir, appPath, dmgPath, zipPath, zipName }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main() {
  console.log('='.repeat(60))
  console.log(`  ${APP_NAME} Packager`)
  console.log(`  Version: ${APP_VERSION}`)
  console.log(`  Electron: ${ELECTRON_VERSION} (CastLabs)`)
  console.log(`  Architectures: ${targetArchs.join(', ')}`)
  console.log(`  Signing: ${unsigned ? 'disabled' : 'enabled'}`)
  console.log('='.repeat(60))

  const t0 = Date.now()
  const results = []

  for (const arch of targetArchs) {
    const result = await packageArch(arch)
    results.push(result)
  }

  // Write auto-update manifest (latest-mac.yml)
  writeUpdateManifest(
    results.map((r) => ({ zipPath: r.zipPath, zipName: r.zipName }))
  )

  const total = ((Date.now() - t0) / 1000).toFixed(1)
  console.log('\n' + '='.repeat(60))
  console.log('  Build complete!')
  console.log(`  Total time: ${total}s`)
  for (const r of results) {
    console.log(`  ${r.arch}: ${r.dmgPath}`)
    console.log(`  ${r.arch}: ${r.zipPath} (auto-update)`)
  }
  console.log(`  Manifest: dist/latest-mac.yml`)
  console.log('='.repeat(60))
}

main().catch((err) => {
  console.error('\n[package] Build failed:', err.message || err)
  process.exit(1)
})
