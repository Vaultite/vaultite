#!/bin/zsh
# The desktop app's updates (electron/main.ts runs this in a login shell, so git, node and npm are on the PATH): zsh on a
# Mac, bash on Linux, so plain sh here.
#
#   update.sh build <clone> <repo url> <the running app's commit> [<branch> <npm script>]
#     Builds the newest main of the repo as a Vaultite.app (Vaultite Dev: its branch, with app:build:dev), in a clone of
#     its own (never a checkout someone works in): fetches, checks it out, installs packages when package-lock.json
#     changed, `npm run app:build`, and moves the app (Linux: its unpacked folder, as Vaultite)
#     to <clone>/../update. Prints `@building <commit>` before a build (the app's toast), and last the commit built. Exit 3: the app already runs it; anything else but 0: it failed (the
#     output says why).
#   update.sh install <the app's pid> <new Vaultite.app> <the running Vaultite.app> [<its executable's name>]
#     Once the app has quit, puts the new build in its place and opens it again (Linux: the folders, and the executable).
set -eu
[ "$(uname)" = Darwin ] && export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
# An app started from the Dock gets 256 open files, too few for electron-builder signing every file it copied.
ulimit -n 65536 2>/dev/null || ulimit -n 10240 2>/dev/null || true

case ${1:-} in
build)
  src=$2 repo=$3 running=$4 branch=${5:-main} script=${6:-app:build}
  # The finished build goes here (Vaultite.app, then commit, written last): never one half built.
  next=$(dirname "$src")/update
  [ -d "$src/.git" ] || { rm -rf "$src"; git clone --quiet "$repo" "$src"; }
  cd "$src"
  # Where the app says it's from: a clone made before the repo moved would fetch the old one, forever "up to date".
  [ "$(git remote get-url origin)" = "$repo" ] || git remote set-url origin "$repo"
  git fetch --quiet origin "$branch"
  new=$(git rev-parse "origin/$branch")
  [ "$new" = "$running" ] && exit 3
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
    npm run "$script"
    rm -rf "$next" && mkdir -p "$next"
    if [ "$(uname)" = Darwin ]; then mv dist-app/mac*/*.app "$next/"
    else mv dist-app/linux*-unpacked "$next/$(node -p 'require("./package.json").build.productName')"; fi
    echo "$new" > "$next/commit"
  fi
  echo "$new"
  ;;
install)
  pid=$2 new=$3 app=$4 exe=${5:-}
  while kill -0 "$pid" 2>/dev/null; do sleep 0.2; done
  # Copied beside it, then swapped in: a copy cut off midway (a full disk) leaves the old app whole. Failed or not, the
  # app opens again (the old one, if anything failed).
  rm -rf "$app.new" "$app.old"
  if rsync -a "$new/" "$app.new/" && mv "$app" "$app.old"; then
    if mv "$app.new" "$app"; then rm -rf "$app.old" || true
    else mv "$app.old" "$app" || true; echo "couldn't replace $app"; fi
  else rm -rf "$app.new" || true; echo "couldn't replace $app"; fi
  if [ "$(uname)" = Darwin ]; then open "$app"
  else setsid "$app/$exe" >/dev/null 2>&1 < /dev/null & fi
  ;;
*)
  echo "usage: update.sh build <clone> <repo> <commit> [<branch> <script>] | install <pid> <new app> <app>" >&2
  exit 2
  ;;
esac
