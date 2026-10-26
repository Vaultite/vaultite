// Opening a file in this machine's app for it (the desktop app's links, POST /api/file/open): what would run is shown in
// its folder instead, whoever wrote the vault.
import fs from "node:fs"
import { RUNS_CODE } from "./filetypes.ts"

/** Whether opening `abs` would run something (a script, an app, an installer): by its name, by what it links to (a
 *  Report.pdf linking to a .terminal opens Terminal), or its exec bit. */
export function runsCode(abs: string) {
  let real = abs
  try { real = fs.realpathSync(abs) } catch { /* not there: as it's named */ }
  if (RUNS_CODE.test(abs) || RUNS_CODE.test(real)) return true
  try { const st = fs.statSync(real); return st.isFile() && (st.mode & 0o111) !== 0 } catch { return false }
}
