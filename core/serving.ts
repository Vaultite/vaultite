// One server per vault on a machine: the one serving it says so in a file only this user can read (runtimeDir), which
// a second refuses to start on, and where the desktop app finds it to attach its browser (electron/host.ts).
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { runtimeDir } from "./runtime.ts"

/** Who serves a vault here: `key` is what an attaching desktop app shows it may (core/desktopapp.ts). */
export type Serving = { pid: number; port: number; key: string; vault: string; app: boolean }

const real = (p: string) => { try { return fs.realpathSync(p) } catch { return path.resolve(p) } }
const fileFor = (vault: string) => path.join(runtimeDir(), `vaultite-serves-${crypto.createHash("sha1").update(real(vault)).digest("hex").slice(0, 12)}.json`)
const alive = (pid: number) => { try { process.kill(pid, 0); return true } catch (e) { return (e as NodeJS.ErrnoException).code === "EPERM" } }

/** The live server serving `vault` on this machine, if one is. */
export function servingOf(vault: string): Serving | null {
  try {
    const s = JSON.parse(fs.readFileSync(fileFor(vault), "utf8")) as Serving
    return Number.isInteger(s.pid) && Number.isInteger(s.port) && typeof s.key === "string" && alive(s.pid) ? s : null
  } catch { return null }
}

let mine: { file: string; key: string } | null = null

/** Claim `vault` for this process on `port`; the live server already serving it when another is (nothing claimed). */
export function claim(vault: string, port: number, app: boolean): Serving | null {
  const file = fileFor(vault)
  for (let tries = 0; tries < 2; tries++) {
    const other = servingOf(vault)
    if (other && other.pid !== process.pid) return other
    if (!other) try { fs.unlinkSync(file) } catch { /* none */ }
    const s: Serving = { pid: process.pid, port, key: crypto.randomBytes(24).toString("base64url"), vault: real(vault), app }
    try {
      fs.writeFileSync(file, JSON.stringify(s) + "\n", { flag: other ? "w" : "wx", mode: 0o600 })
      if (mine?.file !== file) release()
      mine = { file, key: s.key }
      return null
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e // (another started at the same moment: read it again)
    }
  }
  return servingOf(vault)
}

/** The key an attaching desktop app must show (this server's claim's), or "" when it has none. */
export const servingKey = () => mine?.key ?? ""

/** Let the vault go (exit, a switch to another): only this process's own claim. */
export function release() {
  if (!mine) return
  try { if ((JSON.parse(fs.readFileSync(mine.file, "utf8")) as Serving).pid === process.pid) fs.unlinkSync(mine.file) } catch { /* gone */ }
  mine = null
}
process.on("exit", release)
