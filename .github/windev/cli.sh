# Windows proofs for vau (temporary, run by windev.sh in Git Bash): the shells, Set up's PATH, the service, WSL.
out=windev-out
mkdir -p $out
fails=()
ok() { echo "ok   $1"; }
bad() { echo "FAIL $1"; fails+=("$1"); }
# expect <name> <grep -E pattern> <command...>: the command's output (both streams) has the pattern.
expect() { local name=$1 pat=$2; shift 2; local got; got=$("$@" 2>&1); if grep -qE -- "$pat" <<<"$got"; then ok "$name"; else bad "$name"; fi; echo "$got" | sed 's/^/    | /' | head -40; }
up() { for _ in $(seq "${2:-60}"); do curl -s -o /dev/null "http://127.0.0.1:$1/api/ui" && return 0; sleep 1; done; return 1; }
down() { for _ in $(seq "${2:-30}"); do curl -s -o /dev/null "http://127.0.0.1:$1/api/ui" || return 0; sleep 1; done; return 1; }
win() { cygpath -w "$1"; }

T="$(cygpath -u "$RUNNER_TEMP")/vaultite cli"
mkdir -p "$T"
REPO=$(win "$PWD")
V="$T/vault one"
node bin/vau sandbox "$V" >/dev/null
VAULTITE_VAULT="$(win "$V")" VAULTITE_LOCAL="$(win "$T")\\local" PORT=8811 node server.ts > $out/server.log 2>&1 &
SERVER=$!
up 8811 90 && ok "a throwaway server answers" || { bad "a throwaway server answers"; cat $out/server.log; }
export VAULTITE_URL=http://127.0.0.1:8811
printf 'hello from windows\n' > "$T/in put.txt"
IN=$(win "$T/in put.txt")
node bin/vau write "CI/a&b ^x.md" --from "$IN" >/dev/null

# ---------- the shells, through a folder of vau shims ($1: bin/vau.cmd's or Set up's) ----------
shells() {
  local bin=$1 tag=$2
  cat > "$T/t.ps1" <<PS
\$env:Path = "$bin;" + \$env:Path
"which: " + (Get-Command vau).Source
vau write "CI/$tag pwsh.md" --from "$IN"
vau read "CI/$tag pwsh.md"
"special: " + (vau read "CI/a&b ^x.md")
"exit: \$LASTEXITCODE"
PS
  expect "$tag: PowerShell 7 runs vau.cmd, writes and reads" "which: .*vau\.cmd.*hello from windows.*special: hello from windows.*exit: 0" bash -c "pwsh -NoProfile -ExecutionPolicy Bypass -File '$(win "$T/t.ps1")' | tr '\r\n' '  '"
  expect "$tag: Windows PowerShell 5.1 too" "which: .*vau\.cmd.*hello from windows.*exit: 0" bash -c "powershell.exe -NoProfile -ExecutionPolicy Bypass -File '$(win "$T/t.ps1")' | tr '\n' ' '"
  # (one line at cmd's prompt each, as typed there)
  printf 'vau write "CI/%s cmd.md" --from "%s"' "$tag" "$IN" > "$T/l1"; printf 'vau read "CI/%s cmd.md"' "$tag" > "$T/l2"; printf 'vau read "CI/a&b ^x.md"' > "$T/l3"
  expect "$tag: cmd runs vau.cmd, writes and reads" "hello from windows.*hello from windows.*special ok" bash -c "for l in l1 l2 l3; do node .github/windev/cmd.ts '$bin' \"\$(cat '$T'/\$l)\" || exit 1; done | tr '\n' ' '; echo special ok"
  expect "$tag: Git Bash runs vau" "hello from windows" bash -c "PATH='$(cygpath -u "$bin")':\$PATH; command -v vau; vau write 'CI/$tag bash.md' --from '$IN' && vau read 'CI/$tag bash.md'"
}
shells "$REPO\\bin" checkout

H="$T/home"
SETUPBIN=$(node .github/windev/setupbin.ts "$(win "$H")" | tail -1)
echo "Set up's folder: $SETUPBIN"; ls -la "$(cygpath -u "$SETUPBIN")"
shells "$SETUPBIN" setup

# ---------- Set up's PATH, on the real registry once (then put back as it was) ----------
expect "setup: the user's PATH in the registry gets the folder, kept as it was, then put back" "added kept (Expand)?String.*again adds nothing: true.*restored" bash -c "node .github/windev/registry.ts | tr '\n' ' '"
echo "user PATH now:"; reg query 'HKCU\Environment' //v Path

# ---------- /api/file/open: Explorer ----------
node bin/vau write "CI/open me.md" --from "$IN" >/dev/null
expect "file open: a vault file in its app" '"ok":true' curl -s -X POST -H "Origin: http://127.0.0.1:8811" -H "Content-Type: application/json" -d '{"path":"CI/open me.md"}' http://127.0.0.1:8811/api/file/open
expect "file open: revealed in Explorer" '"ok":true' curl -s -X POST -H "Origin: http://127.0.0.1:8811" -H "Content-Type: application/json" -d '{"path":"CI/open me.md","reveal":true}' http://127.0.0.1:8811/api/file/open
sleep 2; powershell.exe -NoProfile -Command "Get-Process | ? MainWindowTitle | select ProcessName, MainWindowTitle | Format-Table -AutoSize | Out-String -Width 200"

# ---------- vau service ----------
V2="$T/vault two"
node bin/vau sandbox "$V2" >/dev/null
expect "service: install" "started it: http://127.0.0.1:8812" node bin/vau service install --vault "$V2" --port 8812
cat "$LOCALAPPDATA/Vaultite/service.js" | head -20
schtasks //Query //TN "Vaultite server" //V //FO LIST | head -30
if up 8812 90; then ok "service: its server answers"; else bad "service: its server answers"; cat "$LOCALAPPDATA/Vaultite/Logs/vaultite.log"; fi
expect "service: status" "Running: yes.*Answering at http://127.0.0.1:8812: yes" bash -c "node bin/vau service status | tr '\n' ' '"
expect "service: logs to its file" "." cat "$LOCALAPPDATA/Vaultite/Logs/vaultite.log"
powershell.exe -NoProfile -Command "Get-CimInstance Win32_Process | ? { \$_.Name -in 'wscript.exe','cmd.exe','node.exe','conhost.exe' } | select ProcessId, ParentProcessId, Name, CommandLine | Format-Table -AutoSize | Out-String -Width 400"
expect "service: no window of its own" "^none" powershell.exe -NoProfile -Command "\$w = Get-Process wscript, node -ErrorAction SilentlyContinue | ? { \$_.MainWindowHandle -ne 0 }; if (\$w) { \$w | select ProcessName, MainWindowTitle } else { 'none' }"
PID12=$(powershell.exe -NoProfile -Command "(Get-NetTCPConnection -LocalPort 8812 -State Listen).OwningProcess" | tr -d '\r')
taskkill //PID "$PID12" //F
down 8812 10 && up 8812 30 && ok "service: started again after it was killed" || bad "service: started again after it was killed"
expect "service: uninstall" "Removed" node bin/vau service uninstall
down 8812 20 && ok "service: uninstall stops its server" || bad "service: uninstall stops its server"
expect "service: the task is gone" "not installed|ERROR|cannot find" bash -c "schtasks //Query //TN 'Vaultite server' 2>&1; node bin/vau service status"

# ---------- WSL ----------
D=$(wsl.exe --list --quiet 2>/dev/null | tr -d '\0\r' | grep -v '^docker' | head -1)
if [ -z "$D" ]; then echo "SKIP wsl: no distro here"; else
  wsl.exe --list --verbose | tr -d '\0'
  expect "wsl: vau wsl install links it" "$D: linked" node bin/vau wsl install --distro "$D"
  W='f=$(command -v vau || echo ~/.local/bin/vau); echo "using $f"; printf "from wsl\n" > /tmp/in.md; "$f" write "CI/wsl.md" --from /tmp/in.md && "$f" read "CI/wsl.md"; "$f" --json version | head -5; "$f" context | head -8'
  expect "wsl: vau in the distro reaches Windows' server, a WSL file passed as Windows reaches it" "from wsl" wsl.exe -d "$D" -e env VAULTITE_URL=http://127.0.0.1:8811 sh -lc "$W"
  expect "wsl: Windows' paths printed as WSL's" '"vault": "/mnt/[a-z]/' wsl.exe -d "$D" -e env VAULTITE_URL=http://127.0.0.1:8811 sh -lc 'f=$(command -v vau || echo ~/.local/bin/vau); "$f" --json context | grep vault; "$f" context | head -5'
fi

kill $SERVER 2>/dev/null
printf 'FAILED: %s\n' "${fails[@]}"
[ ${#fails[@]} = 0 ]
