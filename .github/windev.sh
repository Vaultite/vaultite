# What windev.yml runs on Windows (temporary). Each step runs whatever the last did; the summary says which failed.
mkdir -p windev-out
fails=()
step() { echo "::group::$*"; "$@" 2>&1 | tee -a windev-out/log.txt; local s=${PIPESTATUS[0]}; echo "::endgroup::"; [ "$s" = 0 ] || fails+=("$*"); }
# Who holds a file the server can't replace (EPERM): Sysinternals' handle, polled while test_web runs
curl -sL -o /tmp/handle.zip https://download.sysinternals.com/files/Handle.zip && unzip -oq /tmp/handle.zip -d /tmp/handle
( for i in $(seq 1 400); do /tmp/handle/handle64.exe -accepteula -nobanner "Alice Park.md" 2>&1 | grep -v "No matching handles" ; sleep 0.1; done ) > windev-out/handles.txt 2>&1 &
step node tools/test_web.ts
wait
echo "::group::handles"; sort windev-out/handles.txt | uniq -c | sort -rn | head -40; echo "::endgroup::"
step npm run check
step npm run build
step node tools/test_vault.ts
step node tools/test_sandbox.ts
step node tools/test_stall.ts
step node tools/test_desktophost.ts
step npx playwright-core install chromium
step npm run smoke
printf 'FAILED: %s\n' "${fails[@]}"
[ ${#fails[@]} = 0 ]
