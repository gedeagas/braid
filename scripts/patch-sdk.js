#!/usr/bin/env node
/**
 * Patches @anthropic-ai/claude-agent-sdk/cli.js to fix a bug where
 * cache_control is applied to text content blocks that have empty text,
 * which causes the Anthropic API to reject with:
 *   "messages: text content blocks must be non-empty"
 *
 * The functions WVY (user messages) and ZVY (assistant messages) in the
 * minified CLI unconditionally spread cache_control onto the last content
 * block of recent messages, even when that block is a text block with text:"".
 * The fix adds a guard: skip cache_control when the block is type "text"
 * with an empty/falsy text value.
 */

const fs = require('fs')
const path = require('path')

const cliPath = path.join(__dirname, '../node_modules/@anthropic-ai/claude-agent-sdk/cli.js')

if (!fs.existsSync(cliPath)) {
  console.log('patch-sdk: cli.js not found, skipping')
  process.exit(0)
}

let src = fs.readFileSync(cliPath, 'utf8')

// WVY — user message cache_control (no existing guard on empty text)
const buggy_WVY = 'content.map((Y,$)=>({...Y,...$===q.message.content.length-1?_?{cache_control:XU({querySource:z})}:{}:{}}))'
const fixed_WVY = 'content.map((Y,$)=>({...Y,...$===q.message.content.length-1&&(Y.type!=="text"||Y.text)?_?{cache_control:XU({querySource:z})}:{}:{}}))'

// ZVY — assistant message cache_control (also missing empty-text guard)
const buggy_ZVY = 'content.map((Y,$)=>({...Y,...$===q.message.content.length-1&&Y.type!=="thinking"&&Y.type!=="redacted_thinking"?_?{cache_control:XU({querySource:z})}:{}:{}}))'
const fixed_ZVY = 'content.map((Y,$)=>({...Y,...$===q.message.content.length-1&&Y.type!=="thinking"&&Y.type!=="redacted_thinking"&&(Y.type!=="text"||Y.text)?_?{cache_control:XU({querySource:z})}:{}:{}}))'

let patched = src
let changeCount = 0

if (patched.includes(buggy_WVY)) {
  patched = patched.replace(buggy_WVY, fixed_WVY)
  changeCount++
  console.log('patch-sdk: patched WVY (user message empty text guard)')
} else if (!patched.includes(fixed_WVY)) {
  console.log('patch-sdk: WVY pattern not found — SDK may have changed, skipping')
}

if (patched.includes(buggy_ZVY)) {
  patched = patched.replace(buggy_ZVY, fixed_ZVY)
  changeCount++
  console.log('patch-sdk: patched ZVY (assistant message empty text guard)')
} else if (!patched.includes(fixed_ZVY)) {
  console.log('patch-sdk: ZVY pattern not found — SDK may have changed, skipping')
}

if (changeCount > 0) {
  fs.writeFileSync(cliPath, patched)
  console.log(`patch-sdk: wrote ${changeCount} fix(es) to cli.js`)
} else {
  console.log('patch-sdk: already patched or patterns changed, no writes needed')
}
