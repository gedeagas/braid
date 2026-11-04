/**
 * Locate a Python interpreter that has castlabs-evs installed.
 *
 * `python3` on PATH is often a Homebrew Python that gets bumped to a new minor
 * version (e.g. 3.15), which drops every pip-installed package. castlabs-evs
 * usually lives in whichever interpreter it was first installed into, so probe
 * the likely candidates instead of trusting PATH.
 *
 * Override with BRAID_EVS_PYTHON=/path/to/python3.
 */

const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

function hasEvs(python) {
  try {
    execFileSync(python, ['-c', 'import castlabs_evs'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

function candidates() {
  const list = []
  if (process.env.BRAID_EVS_PYTHON) list.push(process.env.BRAID_EVS_PYTHON)
  list.push('python3', '/usr/bin/python3')

  // Homebrew keeps every installed python@3.x side by side
  for (const dir of ['/opt/homebrew/bin', '/usr/local/bin']) {
    try {
      for (const name of fs.readdirSync(dir)) {
        if (/^python3\.\d+$/.test(name)) list.push(path.join(dir, name))
      }
    } catch {}
  }
  return [...new Set(list)]
}

/** Returns the interpreter path, or null if castlabs-evs is not installed anywhere. */
function findEvsPython() {
  return candidates().find(hasEvs) || null
}

module.exports = { findEvsPython }
