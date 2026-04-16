#!/usr/bin/env node

/**
 * Generate a changelog entry from merged PRs since the last git tag.
 *
 * Usage:
 *   node scripts/changelog.js              # print to stdout
 *   node scripts/changelog.js --write      # prepend to CHANGELOG.md
 *
 * Groups PRs by conventional commit prefix (feat, fix, chore, etc.).
 * Skips PRs with non-app prefixes: ci, docs, website, assets, chore.
 *
 * Prerequisites:
 *   - gh CLI installed and authenticated
 */

const { execSync } = require('child_process')
const path = require('path')
const fs = require('fs')

const ROOT = path.resolve(__dirname, '..')
const PKG = require(path.join(ROOT, 'package.json'))
const VERSION = PKG.version
const CHANGELOG_PATH = path.join(ROOT, 'CHANGELOG.md')

const args = process.argv.slice(2)
const shouldWrite = args.includes('--write')

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function exec(cmd) {
  return execSync(cmd, { cwd: ROOT, encoding: 'utf-8' }).trim()
}

function getLastTag() {
  try {
    return exec('git describe --tags --abbrev=0')
  } catch {
    // No tags yet - use first commit
    return exec('git rev-list --max-parents=0 HEAD')
  }
}

function getMergedPRs(since) {
  // Get the date of the tag commit for filtering
  let tagDate
  try {
    const sinceDate = exec(`git log -1 --format=%aI ${since}`)
    tagDate = new Date(sinceDate)
  } catch {
    tagDate = null
  }

  // Fetch recent merged PRs (gh pr list always returns most recent first)
  const cmd = 'gh pr list --repo gedeagas/braid --state merged --limit 100 --json number,title,mergedAt'
  const raw = exec(cmd)
  const prs = JSON.parse(raw)

  // Keep only PRs merged after the tag
  if (tagDate) {
    return prs.filter((pr) => new Date(pr.mergedAt) > tagDate)
  }
  return prs
}

// ---------------------------------------------------------------------------
// Categorize PRs by conventional commit prefix
// ---------------------------------------------------------------------------

// Prefixes to skip (not app features)
const SKIP_PREFIXES = ['ci', 'docs', 'website', 'assets', 'chore', 'build']

const CATEGORY_MAP = {
  feat: { heading: 'Added', order: 0 },
  fix: { heading: 'Fixed', order: 1 },
  perf: { heading: 'Performance', order: 2 },
  refactor: { heading: 'Changed', order: 3 },
  style: { heading: 'Style', order: 4 },
}

function parsePR(pr) {
  // Match "type(scope): description" or "type: description"
  const match = pr.title.match(/^(\w+)(?:\([^)]*\))?:\s*(.+)$/)
  if (!match) {
    return { type: 'other', description: pr.title, number: pr.number }
  }
  return { type: match[1].toLowerCase(), description: match[2], number: pr.number }
}

function categorizePRs(prs) {
  const categories = {}

  for (const pr of prs) {
    const parsed = parsePR(pr)

    // Skip non-app PRs
    if (SKIP_PREFIXES.includes(parsed.type)) continue

    const category = CATEGORY_MAP[parsed.type] || { heading: 'Other', order: 99 }
    if (!categories[category.heading]) {
      categories[category.heading] = { order: category.order, items: [] }
    }
    categories[category.heading].items.push(parsed)
  }

  return categories
}

// ---------------------------------------------------------------------------
// Format
// ---------------------------------------------------------------------------

function formatChangelog(categories) {
  const today = new Date().toISOString().split('T')[0]
  const lines = [`## [${VERSION}] - ${today}`, '']

  const sorted = Object.entries(categories).sort(([, a], [, b]) => a.order - b.order)

  if (sorted.length === 0) {
    lines.push('No notable app changes.', '')
    return lines.join('\n')
  }

  for (const [heading, { items }] of sorted) {
    lines.push(`### ${heading}`, '')
    for (const item of items) {
      lines.push(`- ${item.description} (#${item.number})`)
    }
    lines.push('')
  }

  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const lastTag = getLastTag()
console.error(`[changelog] Last tag: ${lastTag}`)

const prs = getMergedPRs(lastTag)
console.error(`[changelog] Found ${prs.length} merged PRs since ${lastTag}`)

const categories = categorizePRs(prs)
const entry = formatChangelog(categories)

if (shouldWrite) {
  if (!fs.existsSync(CHANGELOG_PATH)) {
    console.error('[changelog] No CHANGELOG.md found, creating one.')
    fs.writeFileSync(CHANGELOG_PATH, `# Changelog\n\n${entry}`)
  } else {
    const existing = fs.readFileSync(CHANGELOG_PATH, 'utf-8')
    // Insert after the header block (title + preamble)
    const headerEnd = existing.indexOf('\n## ')
    if (headerEnd !== -1) {
      const header = existing.slice(0, headerEnd)
      const rest = existing.slice(headerEnd)
      fs.writeFileSync(CHANGELOG_PATH, `${header}\n${entry}\n---\n${rest}`)
    } else {
      // No existing entries, just append
      fs.writeFileSync(CHANGELOG_PATH, `${existing}\n${entry}`)
    }
  }
  console.error(`[changelog] Written to ${CHANGELOG_PATH}`)
} else {
  process.stdout.write(entry)
}
