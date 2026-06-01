// Regenerates src/terminal/xtermVendor.ts from the installed @xterm/xterm
// package. We inline xterm's JS + CSS as strings so the terminal WebView works
// offline / on a LAN-only E2EE link instead of fetching from a CDN.
//
// Run after bumping @xterm/xterm:  node scripts/gen-xterm-vendor.mjs
import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const pkg = require('@xterm/xterm/package.json')
const jsPath = require.resolve('@xterm/xterm/lib/xterm.js')
const cssPath = require.resolve('@xterm/xterm/css/xterm.css')

const js = readFileSync(jsPath, 'utf8')
  .replace(/\/\/# sourceMappingURL=.*$/m, '')
  .trimEnd()
const css = readFileSync(cssPath, 'utf8').trimEnd()

const header =
  `// AUTO-GENERATED - DO NOT EDIT BY HAND.\n` +
  `// Vendored @xterm/xterm@${pkg.version} (lib/xterm.js + css/xterm.css) inlined as\n` +
  `// strings so the mobile terminal WebView renders fully offline / on a LAN-only\n` +
  `// E2EE link. Previously loaded from cdn.jsdelivr.net, which fails with no internet.\n` +
  `// Regenerate after bumping @xterm/xterm: node scripts/gen-xterm-vendor.mjs\n` +
  `/* eslint-disable */\n\n`

const out =
  header +
  `export const XTERM_VERSION = ${JSON.stringify(pkg.version)}\n\n` +
  `export const XTERM_CSS = ${JSON.stringify(css)}\n\n` +
  `export const XTERM_JS = ${JSON.stringify(js)}\n`

writeFileSync(new URL('../src/terminal/xtermVendor.ts', import.meta.url), out)
console.log(`wrote src/terminal/xtermVendor.ts (${(out.length / 1024).toFixed(1)}KB, xterm ${pkg.version})`)
