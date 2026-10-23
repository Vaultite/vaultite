// The small files that run vau (bin/vau) with a given program as Node (the desktop app's executable, which has no
// `node`): a shell script, and on Windows vau.cmd too (cmd and PowerShell run it; Git Bash and WSL run the script).

/** What runs vau: `exe` as Node (ELECTRON_RUN_AS_NODE, which plain Node ignores) on `script`, with `env` set. `mark`:
 *  a first comment saying whose file it is. */
export type Shim = { exe: string; script: string; env?: Record<string, string>; mark: string }

const sh = (s: string) => `'${s.replaceAll("'", "'\\''")}'`
/** A Windows path as Git Bash takes it in a script (C:/x: its own /c/x isn't what a Windows program reads). */
const slashed = (p: string) => p.replace(/\\/g, "/")
/** cmd's quoting: in "..." only % (and " itself, which a path can't have) mean anything. */
const cmd = (s: string) => `"${s.replace(/%/g, "%%")}"`

/** The shims by file name: `vau` always, `vau.cmd` on Windows. */
export function vauShims(s: Shim, platform: string = process.platform): Record<string, string> {
  const win = platform === "win32", p = win ? slashed : (x: string) => x
  const out: Record<string, string> = {
    vau: ["#!/bin/sh", `# ${s.mark}`, ...Object.entries(s.env ?? {}).map(([k, v]) => `export ${k}=${sh(v)}`),
      `ELECTRON_RUN_AS_NODE=1 exec ${sh(p(s.exe))} ${sh(p(s.script))} "$@"`, ""].join("\n"),
  }
  if (win) {
    out["vau.cmd"] = ["@echo off", `rem ${s.mark}`, "setlocal", ...Object.entries(s.env ?? {}).map(([k, v]) => `set "${k}=${v.replace(/%/g, "%%")}"`),
      'set "ELECTRON_RUN_AS_NODE=1"', `${cmd(s.exe)} ${cmd(s.script)} %*`, ""].join("\r\n")
  }
  return out
}

/** What crosses into Windows' vau from WSL (WSLENV): Vaultite's variables (VAULTITE_VAULT and VAULTITE_LOCAL as paths)
 *  and those that say which agent calls (core/cli.ts' Ctx). */
const CROSS = "VAULTITE_[A-Za-z0-9_]*|CODEX_[A-Za-z0-9_]*|CLAUDECODE|CLAUDE_CODE_SESSION_ID|CLAUDE_MODEL|CLAUDE_EFFORT|CLAUDE_CODE_EFFORT_LEVEL|ANTHROPIC_MODEL|OPENCODE|CURSOR_AGENT|GEMINI_CLI"

/** vau in WSL: runs Windows' vau (`exe`, `script`: Windows paths) by WSL's interop, so it reaches Windows' 127.0.0.1 in
 *  any networking mode; WSL's paths among its arguments go as Windows', VAULTITE_WSL has it print WSL's (core/cli.ts). */
export function wslShim(s: Shim): string {
  const env = Object.entries(s.env ?? {})
  return ["#!/bin/sh", `# ${s.mark}`,
    `exe=$(wslpath -u ${sh(s.exe)}) || exit 1`,
    ...env.map(([k, v]) => `export ${k}=${sh(v)}`),
    'export ELECTRON_RUN_AS_NODE=1 VAULTITE_WSL="${WSL_DISTRO_NAME:-wsl}"',
    `w=${["ELECTRON_RUN_AS_NODE", ...env.map(([k]) => k)].join(":")}`,
    `for v in $(env | sed -nE 's/^(${CROSS})=.*/\\1/p'); do`,
    '  case $v in VAULTITE_VAULT|VAULTITE_LOCAL) v="$v/p" ;; esac',
    '  case ":$w:" in *":${v%/p}:"*|*":${v%/p}/p:"*) ;; *) w="$w:$v" ;; esac',
    "done",
    'export WSLENV="${WSLENV:+$WSLENV:}$w"',
    "# (absolute paths of files that are there, as Windows reaches them: /home/a/x is \\\\wsl.localhost\\<distro>\\home\\a\\x)",
    "n=$#",
    'while [ "$n" -gt 0 ]; do',
    '  a=$1; shift; n=$((n - 1))',
    "  case $a in",
    '    /?*) [ -e "$a" ] && a=$(wslpath -w "$a") ;;',
    '    --*=/?*) p=${a#*=}; [ -e "$p" ] && a="${a%%=*}=$(wslpath -w "$p")" ;;',
    "  esac",
    '  set -- "$@" "$a"',
    "done",
    `exec "$exe" ${sh(s.script)} "$@"`, ""].join("\n")
}
