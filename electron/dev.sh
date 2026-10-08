#!/bin/zsh
# npm run app:dev: this checkout's branch as Vaultite Dev, built, swapped into /Applications and opened behind the app
# in front (its windows show once you switch to it).
set -eu
cd "$0:A:h/.."
npm run app:build:dev
app="/Applications/Vaultite Dev.app"
running() { osascript -e 'tell application "System Events" to (bundle identifier of processes) contains "app.vaultite.dev"' | grep -q true }
running && osascript -e 'tell application id "app.vaultite.dev" to quit'
while running; do sleep 0.3; done
mkdir -p "$app"
rsync -a --delete "dist-app/mac-arm64/Vaultite Dev.app/" "$app/"
open -g --env VAULTITE_BEHIND=1 "$app"
