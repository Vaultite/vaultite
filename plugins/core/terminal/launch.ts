import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { shellQuote } from "../../../core/agents.ts"
import { runtimeDir, toWsl } from "../../../core/plugins.ts"
import type { AgentRun, Spec } from "./backend.ts"
import { distroOf, kindOf, progName, type ShellKind } from "./shells.ts"

// A login shell's files (macOS' path_helper, Homebrew's shellenv) put their PATH before what the shell was given, so
// these files put VAULTITE_BIN (and QA's VAULTITE_AGENT_BIN) first again after them.
export const SHELL_DIR = path.join(runtimeDir(), "vaultite-terminal", "shell")
/** zsh reads each file from ZDOTDIR, which the user's .zshenv may move: each runs the user's own with ZDOTDIR theirs
 *  meanwhile, and the last one zsh reads (.zlogin, or .zshrc when not a login shell) gives it back. */
const zshDone = [
  "if [[ -z $VAULTITE_USER_ZDOTDIR && $ZDOTDIR == $HOME ]]; then unset ZDOTDIR; fi",
  "for _vau_d in $VAULTITE_AGENT_BIN $VAULTITE_BIN; do path=($_vau_d ${path:#${(b)_vau_d}}); done",
  "unset _vau_ours _vau_zdot _vau_d",
]
const zshFile = (name: string, last: string[] = []) => [
  "# Vaultite's terminals start zsh here (ZDOTDIR): the user's own startup files, then Vaultite's vau first on PATH.",
  ...(name === ".zshenv" ? ["_vau_ours=$ZDOTDIR _vau_zdot=${VAULTITE_USER_ZDOTDIR:-$HOME}"] : []),
  "ZDOTDIR=$_vau_zdot",
  `if [[ -r $ZDOTDIR/${name} ]]; then source $ZDOTDIR/${name}; fi`,
  ...(name === ".zlogin" ? zshDone : ["_vau_zdot=$ZDOTDIR ZDOTDIR=$_vau_ours", ...last]),
  "",
].join("\n")
const SHELL_FILES: Record<string, string> = {
  ".zshenv": zshFile(".zshenv"),
  ".zprofile": zshFile(".zprofile"),
  ".zshrc": zshFile(".zshrc", ["if [[ ! -o login ]]; then", "  ZDOTDIR=$_vau_zdot", ...zshDone.map((l) => `  ${l}`), "fi"]),
  ".zlogin": zshFile(".zlogin"),
  bashrc: [
    "# Vaultite's terminals start bash with this (--rcfile): a login shell's files, then Vaultite's vau first on PATH.",
    "if [ -r /etc/profile ]; then . /etc/profile; fi",
    "for _vau_f in ~/.bash_profile ~/.bash_login ~/.profile; do if [ -r \"$_vau_f\" ]; then . \"$_vau_f\"; break; fi; done",
    "unset _vau_f",
    // Git Bash is given Windows paths, C:\x, which its PATH has as /c/x.
    "for _vau_d in \"$VAULTITE_AGENT_BIN\" \"$VAULTITE_BIN\"; do case $_vau_d in [A-Za-z]:*) _vau_d=$(cygpath -u \"$_vau_d\" 2>/dev/null) ;; esac; if [ -n \"$_vau_d\" ]; then PATH=\"$_vau_d:$PATH\"; fi; done",
    "unset _vau_d",
    "",
  ].join("\n"),
  // WSL's -e runs no shell of the user's, so this starts their login shell through these same files.
  "wsl.sh": [
    "# Vaultite's terminals start a WSL distro's shell with this: the user's login shell, then Vaultite's vau first on PATH.",
    "u=$(getent passwd \"$(id -un)\" 2>/dev/null | cut -d: -f7); [ -x \"$u\" ] || u=/bin/sh",
    "d=$(cd \"$(dirname \"$0\")\" && pwd); export SHELL=\"$u\"",
    "if [ \"$2\" = only ]; then exec \"$u\" -l -i -c \"$1\"; fi",
    "case ${u##*/} in",
    "  bash) set -- \"$u\" --rcfile \"$d/bashrc\" -i ${1:+-c \"$1; exec '$u' --rcfile '$d/bashrc' -i\"} ;;",
    "  zsh) [ -n \"$ZDOTDIR\" ] && export VAULTITE_USER_ZDOTDIR=\"$ZDOTDIR\"; export ZDOTDIR=\"$d\" VAULTITE_ZDOTDIR=\"$d\"",
    "    set -- \"$u\" -l ${1:+-i -c \"$1; export ZDOTDIR='$d'; exec '$u' -l\"} ;;",
    // An agent's line is sh's, which fish can't parse.
    "  fish) export VAULTITE_RUN=\"$1\"; set -- \"$u\" -l -C 'for _vau_d in $VAULTITE_AGENT_BIN $VAULTITE_BIN; set -gx PATH $_vau_d $PATH; end; set -e _vau_d' ${1:+-c \"sh -c \\\"\\$VAULTITE_RUN\\\"; exec '$u' -l\"} ;;",
    "  *) set -- \"$u\" -l ${1:+-i -c \"$1; exec '$u' -l\"} ;;",
    "esac",
    "exec \"$@\"",
    "",
  ].join("\n"),
}
export function shellFiles() {
  fs.mkdirSync(SHELL_DIR, { recursive: true })
  for (const [name, text] of Object.entries(SHELL_FILES)) {
    const file = path.join(SHELL_DIR, name)
    let now = ""
    try { now = fs.readFileSync(file, "utf8") } catch { /* not yet */ }
    if (now !== text) fs.writeFileSync(file, text)
  }
}

export function loginArgs(shell: string): string[] {
  const name = progName(shell)
  if (name === "bash") return ["--rcfile", slashed(path.join(SHELL_DIR, "bashrc")), "-i"]
  if (name === "fish") return ["-l", "-C", "for _vau_d in $VAULTITE_AGENT_BIN $VAULTITE_BIN; set -gx PATH $_vau_d $PATH; end; set -e _vau_d"]
  return ["-l"]
}

/** Interactive, so it has the user's PATH, running the agent's command first, then a plain login shell in its place. */
export function shellArgs(shell: string, run: AgentRun | null, only = false) {
  const login = loginArgs(shell)
  if (!run) return login
  if (only) return [...login.filter((a) => a !== "-i"), "-i", "-c", run.command]
  const zdot = progName(shell) === "zsh" ? `if [ -n "$VAULTITE_ZDOTDIR" ]; then export ZDOTDIR="$VAULTITE_ZDOTDIR"; fi; ` : ""
  return [...login.filter((a) => a !== "-i"), "-i", "-c", `${run.command}; ${zdot}exec ${[shell, ...login].map(shellQuote).join(" ")}`]
}
/** Git Bash's sh reads a Windows path best as C:/x. */
const slashed = (p: string) => (process.platform === "win32" ? p.replace(/\\/g, "/") : p)
/** WSL can't follow 8.3 names like RUNNER~1: the long form. */
export function wslPath(p: string) {
  let long = p
  try { long = fs.realpathSync.native(p) } catch { /* not there yet */ }
  return toWsl(long) ?? toWsl(p) ?? p
}
export const psQuote = (s: string) => `'${s.replaceAll("'", "''")}'`

/** The script a ready shell runs to become an agent's, typed into it as one short line. */
export function runScript(file: string, id: string, run: AgentRun, kind: ShellKind = "posix", shell = "") {
  if (kind === "pwsh") {
    // Read and run, not dot-sourced: an execution policy may refuse a script file, never a command.
    const ps1 = `${file}.ps1`
    fs.writeFileSync(ps1, [`Remove-Item -LiteralPath ${psQuote(ps1)}`, "Clear-Host", `$env:VAULTITE_TERMINAL = ${psQuote(id)}`,
      ...(run.cwd ? [`Set-Location -LiteralPath ${psQuote(run.cwd)}`] : []), run.command, ""].join("\r\n"), { mode: 0o600 })
    return ` Invoke-Expression ([IO.File]::ReadAllText(${psQuote(ps1)}))`
  }
  const there = kind === "wsl" ? wslPath : slashed
  fs.writeFileSync(file, "")
  const at = there(file)
  // The empty title: a prompt's, like Ubuntu's "user@host: dir", would name the agent's tab until it sets its own.
  fs.writeFileSync(file, `rm -f ${shellQuote(at)}\nclear\nprintf '\\033]0;\\007'\nexport VAULTITE_TERMINAL=${shellQuote(id)}\n${run.cwd ? `cd ${shellQuote(there(run.cwd))} && ` : ""}${run.command}\n`, { mode: 0o600 })
  // sh and dash have no `source`; fish has only `source`.
  return ` ${progName(shell) === "fish" ? "source" : "."} ${shellQuote(at)}`
}

// PowerShell's console reads a program's output in the old OEM code page ("naïve" as "na├»ve") unless set to UTF-8.
const UTF8 = "[Console]::InputEncoding = [Console]::OutputEncoding = $OutputEncoding = [Text.UTF8Encoding]::new($false)"
// PowerShell makes a command's exit code 0 or 1, and a cmdlet that failed sets only $?, which the next statement resets.
const PS_EXIT = "$vauOk = $?; if ($LASTEXITCODE) { exit $LASTEXITCODE } elseif (-not $vauOk) { exit 1 } else { exit 0 }"

/** `args` as a string is Windows' whole command line, for cmd's own quoting. */
export type Launch = { file: string; args: string[] | string; cwd: string; env: Record<string, string> }
export function launch(spec: Spec): Launch {
  const run = spec.run, cwd = run?.cwd || spec.cwd, env = { ...spec.env, ...spec.ctx }
  switch (kindOf(spec.shell)) {
    case "pwsh":
      return { file: spec.shell, args: ["-NoLogo", ...(run && spec.only ? [] : ["-NoExit"]), "-EncodedCommand",
        Buffer.from(run ? `${UTF8}\n${run.command}${spec.only ? `\n${PS_EXIT}` : ""}` : UTF8, "utf16le").toString("base64")], cwd, env }
    case "cmd":
      // /s: cmd takes what's between the outer quotes as it is.
      return { file: spec.shell, args: run ? `/s /${spec.only ? "c" : "k"} "${run.command}"` : [], cwd, env }
    case "wsl": {
      const wsl = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "wsl.exe")
      return { file: wsl, args: ["-d", distroOf(spec.shell), "--cd", wslPath(cwd), "-e", "sh", wslPath(path.join(SHELL_DIR, "wsl.sh")), ...(run ? [run.command, ...(spec.only ? ["only"] : [])] : [])],
        cwd: os.homedir(), env }
    }
    default:
      return { file: spec.shell, args: shellArgs(spec.shell, run, spec.only), cwd, env }
  }
}

/** Windows' node-pty can't tell what runs in a shell: its kind's name stands in. */
export const shellName = (shell: string) => (kindOf(shell) === "wsl" ? "wsl" : progName(shell))
