// Sources for the terminal-agent entry points written to ~/.braid/bin.
// Plain CommonJS, no dependencies: they run with Braid's own binary in
// ELECTRON_RUN_AS_NODE mode and talk to the hook server over loopback HTTP.
import { BROWSER_TOOLS, browserToolJsonSchema } from '../../../../shared/browserTools'
import { guideText } from './skillContent'

const SHARED_CLIENT = String.raw`
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const CONFIG = path.join(os.homedir(), '.braid', 'hooks', 'hook-server.json');

function serverConfig() {
  try {
    const cfg = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
    if (cfg.port && cfg.token) return cfg;
  } catch {}
  if (process.env.BRAID_HOOK_PORT && process.env.BRAID_HOOK_TOKEN) {
    return { port: Number(process.env.BRAID_HOOK_PORT), token: process.env.BRAID_HOOK_TOKEN };
  }
  return null;
}

function callTool(name, args) {
  const cfg = serverConfig();
  if (!cfg) return Promise.resolve({ text: 'Braid is not running. Open Braid and the worktree to use its browser.', isError: true });
  const body = JSON.stringify({ name, args, cwd: process.cwd() });
  return new Promise((resolve) => {
    const req = http.request({
      host: '127.0.0.1', port: cfg.port, path: '/browser/call', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'X-Braid-Token': cfg.token },
      timeout: 120000,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch { resolve({ text: 'Bad response from Braid (HTTP ' + res.statusCode + ')', isError: true }); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('timed out')));
    req.on('error', (err) => resolve({ text: 'Could not reach Braid: ' + err.message, isError: true }));
    req.end(body);
  });
}
`

const TOOLS_JSON = () => JSON.stringify(BROWSER_TOOLS)
const MCP_TOOLS_JSON = () => JSON.stringify(BROWSER_TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: browserToolJsonSchema(t) })))

/** `braid-browser <tool> [--arg value] [--flag]` - human/agent friendly CLI. */
export function cliScript(): string {
  return `'use strict';
${SHARED_CLIENT}
const TOOLS = ${TOOLS_JSON()};
const GUIDE = ${JSON.stringify(guideText())};

function usage() {
  const lines = ['Usage: braid-browser <command> [--arg value] [--flag]', '', 'Drives the Braid browser tab of the worktree you are in.', '', 'Commands:'];
  for (const t of TOOLS) {
    const params = Object.entries(t.params).map(([k, p]) => p.optional ? '[--' + k + ']' : '--' + k + ' <' + p.type + '>').join(' ');
    lines.push('  ' + t.name.replace(/^browser_/, '').padEnd(14) + params);
    lines.push('      ' + t.description);
  }
  lines.push('', 'Positional shortcuts: open <url>, click <ref>, fill <ref> <text>, press <key>, eval <js>.', 'Add --json for the raw result. Run "braid-browser guide" for the full agent guide.');
  return lines.join('\\n');
}

const POSITIONAL = { open: ['url'], click: ['ref'], hover: ['ref'], fill: ['ref', 'text'], type: ['text'], press: ['key'], select_option: ['ref', 'value'], evaluate: ['expression'], select_tab: ['tab_id'], close_tab: ['tab_id'], wait_for: ['text'] };
const ALIASES = { navigate: 'open', goto: 'open', eval: 'evaluate', wait: 'wait_for', tab: 'select_tab' };

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0] === '-h' || argv[0] === '--help' || argv[0] === 'help') { console.log(usage()); return 0; }
  if (argv[0] === 'guide') { console.log(GUIDE); return 0; }
  const json = argv.includes('--json');
  const rest = argv.filter((a) => a !== '--json');
  const raw = rest[0].replace(/-/g, '_');
  const cmd = ALIASES[raw] || raw;
  const name = cmd.startsWith('browser_') ? cmd : 'browser_' + cmd;
  const spec = TOOLS.find((t) => t.name === name);
  if (!spec) { console.error('Unknown command: ' + rest[0] + '\\n\\n' + usage()); return 2; }
  const args = {};
  const positional = [];
  for (let i = 1; i < rest.length; i++) {
    const a = rest[i];
    if (a.startsWith('--')) {
      const key = a.slice(2).replace(/-/g, '_');
      const p = spec.params[key];
      if (p && p.type === 'boolean' && (i + 1 >= rest.length || rest[i + 1].startsWith('--'))) args[key] = true;
      else args[key] = rest[++i];
    } else positional.push(a);
  }
  const names = POSITIONAL[cmd.replace(/^browser_/, '')] || [];
  names.forEach((k, idx) => { if (positional[idx] !== undefined && args[k] === undefined) args[k] = idx === names.length - 1 ? positional.slice(idx).join(' ') : positional[idx]; });
  const result = await callTool(name, args);
  if (json) { console.log(JSON.stringify(result)); return result.isError ? 1 : 0; }
  if (result.text) (result.isError ? console.error : console.log)(result.text);
  if (result.imageBase64) {
    const file = path.join(os.tmpdir(), 'braid-browser-' + Date.now() + '.png');
    fs.writeFileSync(file, Buffer.from(result.imageBase64, 'base64'));
    console.log('Screenshot saved: ' + file);
  }
  return result.isError ? 1 : 0;
}

main().then((code) => process.exit(code), (err) => { console.error(err && err.message || String(err)); process.exit(1); });
`
}

/** Minimal stdio MCP server (newline-delimited JSON-RPC 2.0) forwarding to Braid. */
export function mcpScript(): string {
  return `'use strict';
${SHARED_CLIENT}
const TOOLS = ${MCP_TOOLS_JSON()};
const readline = require('readline');

function reply(id, result) { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\\n'); }
function fail(id, code, message) { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }) + '\\n'); }

async function handle(msg) {
  const { id, method, params } = msg;
  if (method === 'initialize') {
    return reply(id, {
      protocolVersion: (params && params.protocolVersion) || '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'braid-browser', version: '1.0.0' },
      instructions: 'Tools that drive the Braid browser tab of the current worktree (the same tabs the user sees). Use browser_open for dev servers, browser_snapshot to get element refs, then browser_click / browser_fill.',
    });
  }
  if (method === 'ping') return reply(id, {});
  if (method === 'tools/list') return reply(id, { tools: TOOLS });
  if (method === 'tools/call') {
    const name = params && params.name;
    if (!TOOLS.some((t) => t.name === name)) return fail(id, -32602, 'Unknown tool: ' + name);
    const result = await callTool(name, (params && params.arguments) || {});
    const content = [{ type: 'text', text: result.text || '' }];
    if (result.imageBase64) content.push({ type: 'image', data: result.imageBase64, mimeType: 'image/png' });
    return reply(id, { content, isError: Boolean(result.isError) });
  }
  if (id !== undefined && id !== null) fail(id, -32601, 'Method not found: ' + method);
}

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); } catch { return fail(null, -32700, 'Parse error'); }
  handle(msg).catch((err) => fail(msg.id, -32603, err && err.message || String(err)));
});
rl.on('close', () => process.exit(0));
`
}
