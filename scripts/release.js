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
  if (name === 'latest-mac.yml') return true
  // Only include artifacts for the current version
  if (!name.includes(VERSION)) return false
  return name.endsWith('.dmg') || name.endsWith('-mac.zip')
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

// Extract release notes: prefer CHANGELOG.md section for this version, fall back to auto-generation
let notesFlag = ' --generate-notes'
const changelogPath = path.join(ROOT, 'CHANGELOG.md')

if (fs.existsSync(changelogPath)) {
  const changelog = fs.readFileSync(changelogPath, 'utf-8')
  // Match the section for this version (from "## [VERSION]" to next "## [" or EOF)
  const versionEscaped = VERSION.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // Extract everything after the "## [VERSION]" header up to the next section or end of file
  const headerRe = new RegExp(`^## \\[${versionEscaped}\\][^\\n]*\\n`, 'm')
  const headerMatch = changelog.match(headerRe)
  let sectionBody = ''
  if (headerMatch) {
    const start = headerMatch.index + headerMatch[0].length
    // Find the next section boundary: "---" line or "## [" header
    const rest = changelog.slice(start)
    const nextSection = rest.search(/\n---\n|\n## \[/)
    sectionBody = nextSection === -1 ? rest : rest.slice(0, nextSection)
  }
  const match = sectionBody.trim() ? [null, sectionBody] : null

  if (match && match[1].trim()) {
    const tmpNotes = path.join(DIST, '.release-notes.md')
    fs.writeFileSync(tmpNotes, match[1].trim())
    notesFlag = ` --notes-file "${tmpNotes}"`
    console.log('\n[release] Using release notes from CHANGELOG.md')
  } else {
    console.log(`[release] No section for v${VERSION} in CHANGELOG.md, trying auto-generation`)
  }
}

// Fall back to auto-generated changelog from merged PRs
if (notesFlag === ' --generate-notes') {
  try {
    const notes = execSync('node scripts/changelog.js', { cwd: ROOT, encoding: 'utf-8' }).trim()
    if (notes) {
      const tmpNotes = path.join(DIST, '.release-notes.md')
      fs.writeFileSync(tmpNotes, notes)
      notesFlag = ` --notes-file "${tmpNotes}"`
      console.log('\n[release] Using auto-generated changelog')
    }
  } catch (err) {
    console.log('[release] Changelog generation failed, falling back to --generate-notes')
  }
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
