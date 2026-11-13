import fs from "node:fs"
import path from "node:path"
import { vauShims } from "./vaushims.ts"

const ROOT = path.dirname(import.meta.dirname)

/** The `vau` CLI's entry (a script run by Node, or by the app's executable as Node). */
export const vauEntry = (env: Record<string, string | undefined> = process.env) => env.VAULTITE_VAU_ENTRY || path.join(ROOT, "bin", "vau")

/** A folder with a `vau` that runs (and vau.cmd on Windows), for a PATH: bin/ itself when plain Node runs this code's;
 *  else shims in `local`/bin running the entry with this process's runtime as Node (the app's has no `node`). */
export function vauDir(local: string): string {
  const entry = vauEntry()
  if (!process.versions.electron && process.platform !== "win32" && entry === path.join(ROOT, "bin", "vau")) return path.dirname(entry)
  const dir = path.join(local, "bin")
  for (const [name, text] of Object.entries(vauShims({ exe: process.execPath, script: entry, mark: "vau for this server's terminals and plugins (core/appentry.ts), remade as needed." }))) {
    const file = path.join(dir, name)
    try {
      if (fs.readFileSync(file, "utf8") !== text) throw new Error("old")
    } catch {
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(file, text, { mode: 0o755 })
    }
  }
  return dir
}
