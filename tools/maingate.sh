#!/bin/sh
# What `from`..`to` must pass to reach main (pre-push, tools/land.sh): tsc, check, the launch budget and an OS-sensitive
# change's try, a few seconds; it says whether main's CI is red, never blocking. Only the try skips, VAULTITE_TRY=skip.
from=$1 to=$2
[ -d node_modules ] || exit 0
said=$(mktemp) || exit 1
node tools/mainci.ts --notice >"$said" 2>/dev/null &
# (tries nobody came back to are ended apart, never waited for here)
( node tools/try.ts --sweep >/dev/null 2>&1 & )
notice() { wait; cat "$said" >&2; rm -f "$said"; }
fail() { [ -n "$1" ] && echo "$1" >&2; notice; exit 1; }
npx tsc -b && npm run -s check >/dev/null || fail "main's gate: main must pass tsc and npm run check (see above)"
out=$(node tools/perf/startup.ts --main) || { echo "$out" | grep FAIL >&2; fail "main's gate: the desktop main process is over its launch budget (tools/perf/startup.json): import it lazily, or raise the limit in the same commit"; }
[ "$VAULTITE_TRY" = skip ] || node tools/try.ts --check "$from" "$to" || fail
notice
