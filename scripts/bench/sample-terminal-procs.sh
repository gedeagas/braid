#!/usr/bin/env bash
# Samples CPU and memory of Braid's renderer and PTY daemon processes once a
# second while a terminal benchmark runs (see the PR / __braidPerf in the
# renderer for typing latency and dropped frames).
#
#   scripts/bench/sample-terminal-procs.sh 30 > before.txt
set -euo pipefail
SECONDS_TO_RUN="${1:-30}"

pid_of() { pgrep -f "$1" | head -1 || true; }
RENDERER=$(pid_of 'Braid Helper \(Renderer\)')
DAEMON=$(pid_of 'daemonMain.js')
[ -n "$RENDERER" ] || { echo "renderer process not found" >&2; exit 1; }
[ -n "$DAEMON" ] || { echo "daemon process not found" >&2; exit 1; }
echo "renderer=$RENDERER daemon=$DAEMON"

for _ in $(seq "$SECONDS_TO_RUN"); do
  ps -o pid=,%cpu=,rss= -p "$RENDERER,$DAEMON"
  sleep 1
done | awk -v r="$RENDERER" -v d="$DAEMON" '
  { cpu[$1] = cpu[$1] " " $2; if ($3 > rss[$1]) rss[$1] = $3 }
  function median(s,   n, a, i, j, t) { n = split(s, a, " "); for (i = 1; i <= n; i++) for (j = i + 1; j <= n; j++) if (a[j] + 0 < a[i] + 0) { t = a[i]; a[i] = a[j]; a[j] = t }; return a[int((n + 1) / 2)] }
  END {
    printf "renderer: median CPU %s%%, peak RSS %.0f MB\n", median(cpu[r]), rss[r] / 1024
    printf "daemon:   median CPU %s%%, peak RSS %.0f MB\n", median(cpu[d]), rss[d] / 1024
  }'
