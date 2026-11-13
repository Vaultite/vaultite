import crypto from "node:crypto"
import fs from "node:fs"
import net from "node:net"
import path from "node:path"
import { runtimeDir } from "./runtime.ts"
import { atExit } from "./exit.ts"
import { codeOf } from "./values.ts"

/** `key`: what an attaching desktop app shows it may. */
export type Serving = { pid: number; port: number; key: string; vault: string; app: boolean
  /** An app's server left running through that app's relaunch: the app's data folder (its next launch takes it over),
   *  and the code root it runs. */
  heir?: { app: string; root: string } }

const real = (p: string) => { try { return fs.realpathSync(p) } catch { return path.resolve(p) } }
const fileFor = (vault: string) => path.join(runtimeDir(), `vaultite-serves-${crypto.createHash("sha1").update(real(vault)).digest("hex").slice(0, 12)}.json`)
const alive = (pid: number) => { try { process.kill(pid, 0); return true } catch (e) { return codeOf(e) === "EPERM" } }

export function servingOf(vault: string): Serving | null {
  try {
    const s = JSON.parse(fs.readFileSync(fileFor(vault), "utf8")) as Serving
    return Number.isInteger(s.pid) && Number.isInteger(s.port) && typeof s.key === "string" && alive(s.pid) ? s : null
  } catch { return null }
}

let mine: { file: string; key: string } | null = null

/** The live server already serving it when another is (nothing claimed), else null. */
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
      if (codeOf(e) !== "EEXIST") throw e
    }
  }
  return servingOf(vault)
}

/** Whether a server answers on `port` here: a claim whose process ended at once (Windows ends one so, and soon gives its
 *  pid to another) answers nothing. */
export const answers = (port: number) => new Promise<boolean>((done) => {
  const s = net.connect(port, "127.0.0.1", () => { s.destroy(); done(true) })
  s.setTimeout(1000, () => { s.destroy(); done(false) })
  s.once("error", () => done(false))
})

export function reclaim(vault: string, port: number, app: boolean) {
  try { fs.unlinkSync(fileFor(vault)) } catch { /* gone */ }
  return claim(vault, port, app)
}

export function bequeath(heir: Serving["heir"] | null) {
  if (!mine) return
  try {
    const s = JSON.parse(fs.readFileSync(mine.file, "utf8")) as Serving
    if (s.pid !== process.pid) return
    if (heir) s.heir = heir; else delete s.heir
    fs.writeFileSync(`${mine.file}.tmp`, JSON.stringify(s) + "\n", { mode: 0o600 })
    fs.renameSync(`${mine.file}.tmp`, mine.file)
  } catch { /* gone */ }
}

export const servingKey = () => mine?.key ?? ""

function release() {
  if (!mine) return
  try { if ((JSON.parse(fs.readFileSync(mine.file, "utf8")) as Serving).pid === process.pid) fs.unlinkSync(mine.file) } catch { /* gone */ }
  mine = null
}
atExit(release)
