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
