#!/usr/bin/env node

/**
 * Upload build artifacts to a GitHub Release.
 *
 * Usage:
 *   node scripts/release.js              # creates release for current version
 *   node scripts/release.js --draft      # creates a draft release
 *
 * Prerequisites:
 *   - gh CLI installed and authenticated
 *   - `yarn package` completed (dist/ contains DMGs, ZIPs, latest-mac.yml)
 */

const path = require('path')
const fs = require('fs')
const { execSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const DIST = path.join(ROOT, 'dist')
const PKG = require(path.join(ROOT, 'package.json'))
const VERSION = PKG.version
const TAG = `v${VERSION}`

const args = process.argv.slice(2)
const draft = args.includes('--draft')

// ---------------------------------------------------------------------------
// Collect artifacts
// ---------------------------------------------------------------------------

const REQUIRED_PATTERNS = [
  // At least one DMG and one ZIP
  /\.dmg$/,
  /-mac\.zip$/,
]

const allFiles = fs.existsSync(DIST)
  ? fs.readdirSync(DIST).map((f) => path.join(DIST, f))
  : []

const artifacts = allFiles.filter((f) => {
  const name = path.basename(f)
  return (
    name.endsWith('.dmg') ||
    name.endsWith('-mac.zip') ||
    name === 'latest-mac.yml'
  )
})

// Validate
const manifestPath = path.join(DIST, 'latest-mac.yml')
if (!fs.existsSync(manifestPath)) {
  console.error('[release] Missing dist/latest-mac.yml - run `yarn package` first.')
  process.exit(1)
}

for (const pattern of REQUIRED_PATTERNS) {
  if (!artifacts.some((f) => pattern.test(path.basename(f)))) {
    console.error(`[release] No file matching ${pattern} found in dist/. Run \`yarn package\` first.`)
    process.exit(1)
  }
}

// ---------------------------------------------------------------------------
// Create release
// ---------------------------------------------------------------------------

console.log(`\n[release] Creating GitHub Release ${TAG}`)
console.log(`  Artifacts: ${artifacts.length} files`)
for (const f of artifacts) {
  const mb = (fs.statSync(f).size / 1024 / 1024).toFixed(1)
  console.log(`    ${path.basename(f)} (${mb}MB)`)
}

const fileArgs = artifacts.map((f) => `"${f}"`).join(' ')
const draftFlag = draft ? ' --draft' : ''

// Generate changelog from merged PRs since last tag
let notesFlag = ' --generate-notes'
try {
  const notes = execSync('node scripts/changelog.js', { cwd: ROOT, encoding: 'utf-8' }).trim()
  if (notes) {
    // Write to temp file to avoid shell escaping issues
    const tmpNotes = path.join(DIST, '.release-notes.md')
    fs.writeFileSync(tmpNotes, notes)
    notesFlag = ` --notes-file "${tmpNotes}"`
    console.log('\n[release] Using auto-generated changelog')
  }
} catch (err) {
  console.log('[release] Changelog generation failed, falling back to --generate-notes')
}

const cmd = `gh release create "${TAG}" ${fileArgs} --title "${TAG}"${notesFlag}${draftFlag}`

try {
  console.log(`\n[release] Running: gh release create ${TAG} ...`)
  execSync(cmd, { cwd: ROOT, stdio: 'inherit' })
  console.log(`\n[release] Done! Release ${TAG} created.`)
} catch (err) {
  console.error('\n[release] Failed to create release:', err.message)
  process.exit(1)
}
