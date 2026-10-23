# What windev.yml runs on Windows (temporary). Each step runs whatever the last did; the summary says which failed.
mkdir -p windev-out
fails=()
step() { echo "::group::$*"; "$@" 2>&1 | tee -a windev-out/log.txt; local s=${PIPESTATUS[0]}; echo "::endgroup::"; [ "$s" = 0 ] || fails+=("$*"); }
# (windows-cli: vau's own; the full list is on the windows branch)
step npx tsc -p tsconfig.server.json --noEmit
step node tools/test_setup.ts
step bash .github/windev/cli.sh
printf 'FAILED: %s\n' "${fails[@]}"
[ ${#fails[@]} = 0 ]
