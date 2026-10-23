# What windev.yml runs on Windows (temporary). Each step runs whatever the last did; the summary says which failed.
mkdir -p windev-out
fails=()
step() { echo "::group::$*"; "$@" 2>&1 | tee -a windev-out/log.txt; local s=${PIPESTATUS[0]}; echo "::endgroup::"; [ "$s" = 0 ] || fails+=("$*"); }
step npm run check
step npm run build
step node tools/test_web.ts
step node tools/test_vault.ts
step node tools/test_sandbox.ts
step node tools/test_setup.ts
step node tools/test_selfupdate.ts
step node tools/test_stall.ts
step node tools/test_desktophost.ts
step node tools/test_machines.ts
step npx playwright-core install chromium
step npm run smoke
printf 'FAILED: %s\n' "${fails[@]}"
[ ${#fails[@]} = 0 ]
