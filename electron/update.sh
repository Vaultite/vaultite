#!/bin/zsh
# The desktop app's updates, run by electron/main.ts in a login shell (git, node and npm on the PATH): zsh on a Mac,
# bash on Linux, so plain sh here.
#   update.sh build <clone> <repo url> <the running app's commit> [<branch> <npm script> <commit>]
#     the branch's newest (or <commit>), built in a clone of its own into <clone>/../update.noindex. Exit 3: the app runs it.
#   update.sh install <the app's pid> <new .app> <the running .app> [<its executable's name> [stay]]
#     staged and checked beside the app (says "staged" on fd 3 when there is one), then once the app quit swapped in and
#     opened again. Exit 1: not staged, the app untouched. stay: the app quit for good, so it isn't opened again
set -eu
# The login shell brings the user's aliases (an `rm -I` prompts, gets no answer and fails every build): none here.
unalias -a 2>/dev/null || true
[ "$(uname)" = Darwin ] && export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
# An app started from the Dock gets 256 open files, too few for electron-builder signing every file it copied.
ulimit -n 65536 2>/dev/null || ulimit -n 10240 2>/dev/null || true

# A whole copy of the build in <from> at <to>, checked: its build.json is the commit update.sh build wrote, its key
# files and shell are there, as many files as the build. Else why not (stdout), with rsync's own words in the log.
stage() {
  rsync -a "$1/" "$2/" || { echo "the copy into $2 failed"; return 1; }
  got=$(sed -n 's/^.*"commit": *"\([0-9a-f]*\)".*$/\1/p' "$2/$res/electron/build.json" 2>/dev/null | head -n 1)
  [ -n "$want" ] && [ "$got" = "$want" ] || { echo "the copy's build.json says ${got:-nothing}, not the build's ${want:-commit}"; return 1; }
  for f in "$bin" "$res/server.ts" "$res/package.json" "$res/electron/boot.ts" "$res/electron/main.ts"; do
    [ -e "$2/$f" ] || { echo "the copy has no $f"; return 1; }
  done
  [ -x "$2/$bin" ] || { echo "the copy's $bin can't run"; return 1; }
  # A build with a shell (electron/shell/boot.mjs, its entry) has it whole, and the same fingerprint in its shell.json.
  if [ -e "$1/$res/electron/shell/boot.mjs" ]; then
    for f in boot.mjs roots.mjs vau.mjs print.mjs inputs.json; do
      [ -e "$2/$res/electron/shell/$f" ] || { echo "the copy has no electron/shell/$f"; return 1; }
    done
    print=$(sed -n 's/^.*"fingerprint": *"\([0-9a-f]*\)".*$/\1/p' "$1/$res/electron/shell.json" 2>/dev/null | head -n 1)
    [ -n "$print" ] || { echo "the build's shell.json has no fingerprint"; return 1; }
    [ "$(sed -n 's/^.*"fingerprint": *"\([0-9a-f]*\)".*$/\1/p' "$2/$res/electron/shell.json" 2>/dev/null | head -n 1)" = "$print" ] || { echo "the copy's shell.json has another fingerprint"; return 1; }
  fi
  [ $(( $(find "$1" | wc -l) )) -eq $(( $(find "$2" | wc -l) )) ] || { echo "the copy has a different number of files than the build"; return 1; }
}
# The pids of the app's own main process, run from <its executable> (not its helpers, server, terminal keeper or agents'
# `vau mcp`, which run its binaries too: Chromium's with --type=, Node's with a script from <its own files>).
mains() {
  ps -A -ww -o pid= -o command= | awk -v exe="$1" -v own="$2/" '{
    pid = $1; sub(/^ *[0-9]+ /, "")
    if (index($0, exe) != 1) next
    rest = substr($0, length(exe) + 1)
    if (rest != "" && substr(rest, 1, 1) != " ") next
    if (index(rest, " " own) == 1 || rest ~ / --type=/) next
    print pid
  }'
}

case ${1:-} in
build)
  src=$2 repo=$3 running=$4 branch=${5:-main} script=${6:-app:build} want=${7:-}
  # The finished build goes here (the .app, then commit, written last): never one half built.
  next=$(dirname "$src")/update.noindex
  [ -d "$src/.git" ] || { rm -rf "$src"; git clone --quiet "$repo" "$src"; }
  cd "$src"
  # Where the app says it's from: a clone made before the repo moved would fetch the old one, forever "up to date".
  [ "$(git remote get-url origin)" = "$repo" ] || git remote set-url origin "$repo"
  git fetch --quiet origin "$branch"
  new=$(git rev-parse "origin/$branch")
  if [ -n "$want" ]; then new=$(git rev-parse --verify --quiet "$want^{commit}") || { echo "$want isn't fetched from $branch"; exit 1; }; fi
  [ "$new" = "$running" ] && exit 3
  # One from before cookie encryption (electron/sign.cjs's fuse) can't read this app's cookies, and drops them: never
  # back to one, even for a server that runs it. (${new}: zsh reads "$new:e…" as $new with its :e modifier.)
  git show "${new}:electron/sign.cjs" 2>/dev/null | grep -q EnableCookieEncryption || { echo "not building $new: it's from before cookie encryption, and would sign you out of every site"; exit 1; }
  # Built already (an earlier check the app hasn't restarted for): nothing to do.
  if [ "$(cat "$next/commit" 2>/dev/null)" != "$new" ]; then
    echo "@building $new"
    git checkout --quiet --force --detach "$new"
    lock=$(git hash-object package-lock.json)
    if [ "$(cat node_modules/.lock 2>/dev/null)" != "$lock" ]; then
      npm ci --no-audit --no-fund
      echo "$lock" > node_modules/.lock
    fi
    rm -rf dist-app
    # (VAULTITE_UPDATING: electron/sign.cjs fails rather than sign ad hoc)
    VAULTITE_UPDATING=1 npm run "$script"
    rm -rf "$next" && mkdir -p "$next"
    if [ "$(uname)" = Darwin ]; then mv dist-app/mac*/*.app "$next/"
    else mv dist-app/linux*-unpacked "$next/$(node -p 'require(process.argv[1]).productName' "$PWD"/dist-app/linux*-unpacked/resources/app/package.json)"; fi
    echo "$new" > "$next/commit"
  fi
  echo "$new"
  ;;
install)
  pid=$2 new=$3 app=$4 exe=${5:-} stay=${6:-}
  # (the app may be gone when this says it's staged, fd 3: a write to its closed pipe fails rather than end this)
  trap '' PIPE
  want=$(cat "$(dirname "$new")/commit" 2>/dev/null || true)
  if [ "$(uname)" = Darwin ]; then res=Contents/Resources/app bin=Contents/MacOS/${exe:-$(basename "$app" .app)}
  else res=resources/app bin=${exe:-$(basename "$app")}; fi
  # Staged beside it while the app still runs (the same volume, so the swap is a rename), and checked: the app quits only
  # once it's whole, and a copy cut off or wrong never goes in.
  rm -rf "$app.new" "$app.old"
  if ! why=$(stage "$new" "$app.new"); then
    rm -rf "$app.new" || true
    echo "not installed: $why"
    exit 1
  fi
  echo "staged $want"
  { echo staged >&3; } 2>/dev/null || true
  while kill -0 "$pid" 2>/dev/null; do sleep 0.2; done
  # Opened again meanwhile (the Dock, a link, its LaunchAgent): never swap an app out from under itself, or that copy
  # runs the old tree while the disk says new. It offers the update again.
  if [ -n "$(mains "$app/$bin" "$app/$res")" ]; then
    rm -rf "$app.new" || true
    echo "not installed: $app was opened again before the swap"
    exit 0
  fi
  # Two renames, the old app whole until the second; failed, it stays (and opens again, the old one).
  if mv "$app" "$app.old"; then
    if mv "$app.new" "$app"; then
      rm -rf "$app.old" || true
      echo "installed $want"
    else
      mv "$app.old" "$app" || true
      rm -rf "$app.new" || true
      echo "not installed: couldn't move the new app into $app"
    fi
  else
    rm -rf "$app.new" || true
    echo "not installed: couldn't move $app aside"
  fi
  [ "$stay" = stay ] && exit 0
  if [ -n "${VAULTITE_UPDATE_OPEN:-}" ]; then "$VAULTITE_UPDATE_OPEN" "$app" # (tests: never the real app)
  # An app a LaunchAgent runs (its label, not LaunchServices' application.*) starts again under it, so a crash still
  # brings it back; `open` would leave it unwatched.
  elif [ "$(uname)" = Darwin ]; then
    case ${XPC_SERVICE_NAME:-0} in
    0 | application.*) open "$app" ;;
    *) launchctl kickstart "gui/$(id -u)/$XPC_SERVICE_NAME" || open "$app" ;;
    esac
  else setsid "$app/$exe" >/dev/null 2>&1 < /dev/null & fi
  ;;
*)
  echo "usage: update.sh build <clone> <repo> <commit> [<branch> <script>] | install <pid> <new app> <app> [<exe> [stay]]" >&2
  exit 2
  ;;
esac
