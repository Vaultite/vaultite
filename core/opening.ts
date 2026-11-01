// Opening a file in this machine's app for it (the desktop app's links, POST /api/file/open): what would run is shown in
// its folder instead, whoever wrote the vault.
import fs from "node:fs"
import path from "node:path"
import { RUNS_CODE } from "./filetypes.ts"

/** Whether opening `abs` would run something (a script, an app, an installer): by its name, by what it links to (a
 *  Report.pdf linking to a .terminal opens Terminal), or its exec bit. */
export function runsCode(abs: string) {
  let real = abs
  try { real = fs.realpathSync(abs) } catch { /* not there: as it's named */ }
  if (RUNS_CODE.test(abs) || RUNS_CODE.test(real)) return true
  try { const st = fs.statSync(real); return st.isFile() && (st.mode & 0o111) !== 0 } catch { return false }
}

/** Where `rel` is in the vault at `root`, or null when it would leave it (`..`, an absolute path; on Windows by `\` too).
 *  `p`: the platform's path rules (tests pass path.win32). */
export function inVault(root: string, rel: string, p: typeof path = path) {
  const r = p.resolve(root), abs = p.resolve(r, rel)
  return abs === r || abs.startsWith(r.endsWith(p.sep) ? r : r + p.sep) ? abs : null
}

/** The scheme of a link another app may be handed (zoommtg://, slack://, mailto:; the desktop app's notes and the
 *  Browser's pages alike), else "": never a file, a network share, the app's own pages or Windows' schemes that run code. */
export function otherAppScheme(url: string) {
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(url)?.[1].toLowerCase() ?? ""
  return /^(javascript|data|vbscript|blob|file|about|chrome|devtools|view-source|ms-msdt|search-ms|search|ms-officecmd|shell|hcp|ms-help|res|smb|cifs|nfs|afp|disks?)$/.test(scheme) ? "" : scheme
}
