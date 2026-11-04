// ── Parameterized Hook Script Generator ──────────────────────────────────────
//
// Produces a bash script that:
//   1. Reads port/token from ~/.braid/hooks/hook-server.json
//   2. Guards on Braid terminal env (no-op outside Braid big terminals)
//   3. Reads stdin JSON, extracts hook_event_name, tool_name, and the agent's
//      own session id / cwd / end reason (used to resume after a cold restore)
//   4. POSTs to /hook/<agentId> on the loopback server

/** Current hook script version. Bump to force re-install on next app launch. */
export const HOOK_SCRIPT_VERSION = 13

export interface HookScriptOptions {
  /** Agent identifier - determines the POST endpoint path */
  agentId: string
  /** Whether to echo `{}` on stdout (some agents require valid JSON response) */
  emitStdout?: boolean
}

/** Generate a bash hook script parameterized for a specific agent. */
export function generateHookScript(opts: HookScriptOptions): string {
  const { agentId, emitStdout = false } = opts
  const stdoutGuard = emitStdout ? 'echo \'{}\' && exit 0' : 'exit 0'
  const stdoutLine = emitStdout ? '\n# Agent requires valid JSON response on stdout\necho \'{}\'  \n' : ''
  const toolNameFallback = agentId === 'codex'
    ? '\n# Codex may expose function-tool names as `name` in some payloads.\n[ -z "$tool" ] && [[ "$input" =~ \\"name\\"[[:space:]]*:[[:space:]]*\\"([^\\"]+)\\" ]] && tool="${BASH_REMATCH[1]}"\n'
    : ''

  return `#!/bin/bash
# Braid agent status hook (${agentId}) - POSTs status to Braid's loopback HTTP server.
# Managed by Braid. Do not edit - changes will be overwritten on next launch.
# BRAID_HOOK_VERSION=${HOOK_SCRIPT_VERSION}

# Resolve hook server port and token.
# Prefer the config file (survives Electron restart for daemon PTY sessions)
# over env vars (which become stale after restart).
HOOK_CONFIG="$HOME/.braid/hooks/hook-server.json"
if [ -f "$HOOK_CONFIG" ]; then
  cfg=$(cat "$HOOK_CONFIG" 2>/dev/null)
  [[ "$cfg" =~ \\"port\\"[[:space:]]*:[[:space:]]*([0-9]+) ]] && BRAID_HOOK_PORT="\${BASH_REMATCH[1]}"
  [[ "$cfg" =~ \\"token\\"[[:space:]]*:[[:space:]]*\\"([^\\"]+)\\" ]] && BRAID_HOOK_TOKEN="\${BASH_REMATCH[1]}"
fi

# Guard: only run inside Braid big terminals
if [ -z "$BRAID_HOOK_PORT" ] || [ -z "$BRAID_HOOK_TOKEN" ] || [ -z "$BRAID_TERMINAL_ID" ]; then
  ${stdoutGuard}
fi

# Read stdin (agent sends hook event JSON payload)
input=$(cat)
${stdoutLine}
# Extract hook_event_name from JSON (best-effort bash regex, no jq dependency)
event=""
[[ "$input" =~ \\"hook_event_name\\"[[:space:]]*:[[:space:]]*\\"([^\\"]+)\\" ]] && event="\${BASH_REMATCH[1]}"

# Extract tool_name if present
tool=""
[[ "$input" =~ \\"tool_name\\"[[:space:]]*:[[:space:]]*\\"([^\\"]+)\\" ]] && tool="\${BASH_REMATCH[1]}"
${toolNameFallback}

# Extract is_interrupt for Stop events
is_interrupt="false"
[[ "$input" =~ \\"is_interrupt\\"[[:space:]]*:[[:space:]]*true ]] && is_interrupt="true"

# Agent session id (key differs per agent). The charset is restricted here AND
# re-validated server-side: the id is later typed into a shell on resume.
session_id=""
[[ "$input" =~ \\"(session_id|sessionId|conversation_id|conversationId)\\"[[:space:]]*:[[:space:]]*\\"([A-Za-z0-9._:-]+)\\" ]] && session_id="\${BASH_REMATCH[2]}"

# Folder the agent runs in (sessions are scoped to it)
cwd=""
[[ "$input" =~ \\"cwd\\"[[:space:]]*:[[:space:]]*\\"([^\\"]+)\\" ]] && cwd="\${BASH_REMATCH[1]}"

# SessionEnd reason (e.g. prompt_input_exit vs clear)
reason=""
[[ "$input" =~ \\"reason\\"[[:space:]]*:[[:space:]]*\\"([A-Za-z_]+)\\" ]] && reason="\${BASH_REMATCH[1]}"

# Sanitize extracted values: strip any quotes/backslashes to prevent JSON injection
event="\${event//[\\\\\\"\\']/}"
tool="\${tool//[\\\\\\"\\']/}"
cwd="\${cwd//[\\\\\\"\\']/}"
cwd="\${cwd//[[:cntrl:]]/}"

# Build JSON payload for Braid server
json="{\\"terminalId\\":\\"$BRAID_TERMINAL_ID\\",\\"event\\":\\"$event\\""
[ -n "$tool" ] && json="$json,\\"toolName\\":\\"$tool\\""
[ "$is_interrupt" = "true" ] && json="$json,\\"isInterrupt\\":true"
[ -n "$session_id" ] && json="$json,\\"sessionId\\":\\"$session_id\\""
[ -n "$cwd" ] && json="$json,\\"cwd\\":\\"$cwd\\""
[ -n "$reason" ] && json="$json,\\"reason\\":\\"$reason\\""
json="$json}"

# POST to Braid's loopback server (background, non-blocking)
curl -sS -o /dev/null \\
  -X POST "http://127.0.0.1:\${BRAID_HOOK_PORT}/hook/${agentId}" \\
  -H "Content-Type: application/json" \\
  -H "X-Braid-Token: \${BRAID_HOOK_TOKEN}" \\
  -d "$json" \\
  2>/dev/null &
`
}
