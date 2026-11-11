// Vaultite Dev's instances (electron/dev.ts): a worktree's own (<Dev's data>/instances/<slug>/app, kept between runs) and
// headless ones for agents (…/headless-<pid>, removed once stopped), and its shells by fingerprint. No Electron.
import { execFileSync } from "node:child_process"
import crypto from "node:crypto"
import fs from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"
import { readShell, userDataOf } from "./shell/roots.mjs"

/** What a running instance says of itself (<its userData>/instance.json, electron/devroot.ts). */
export type Instance = { pid: number; root: string; worktree: string; headless: boolean; debugPort: number | null; started: number }

const real = (p: string) => { try { return fs.realpathSync(p) } catch { return path.resolve(p) } }
/** A worktree's folder name for its instances: its name, and a hash of where it is (two may share a name). */
export const slugOf = (worktree: string) => `${path.basename(real(worktree)).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "root"}-${crypto.createHash("sha1").update(real(worktree)).digest("hex").slice(0, 6)}`
/** A worktree's instances' folders. */
export const instancesOf = (data: string, worktree: string) => path.join(data, "instances", slugOf(worktree))
/** Its kept instance's userData. */
export const appData = (data: string, worktree: string) => path.join(instancesOf(data, worktree), "app")
/** Where a shell built for fingerprint `print` is kept (a branch that changes the shell gets its own). */
export const shellDir = (data: string, print: string) => path.join(data, "shells", print.slice(0, 16))

/** Vaultite Dev as `root`'s electron/dev.cjs names it (VAULTITE_DEV_CONFIG: a test's): its name, its data, where it's
 *  installed, and its shell for a fingerprint (the installed one, else the one kept for it). */
export function devApp(root: string) {
  const config = process.env.VAULTITE_DEV_CONFIG ? path.resolve(process.env.VAULTITE_DEV_CONFIG) : path.join(root, "electron", "dev.cjs")
  const name: string = createRequire(import.meta.url)(config).productName
  const data = userDataOf(name, { ...process.env, VAULTITE_USER_DATA: undefined })
  const installed = path.join("/Applications", `${name}.app`)
  const printOf = (app: string) => readShell(path.join(app, "Contents", "Resources", "app")).fingerprint
  const shellFor = (print: string) => [installed, path.join(shellDir(data, print), `${name}.app`)].find((app) => fs.existsSync(app) && printOf(app) === print) ?? null
  return { config, name, data, installed, printOf, shellFor, exe: (app: string) => path.join(app, "Contents", "MacOS", name) }
}

/** An instance's own record, null when there's none (never started, or quit). */
export function instanceAt(userData: string): Instance | null {
  try {
    const i = JSON.parse(fs.readFileSync(path.join(userData, "instance.json"), "utf8"))
    return typeof i?.pid === "number" && typeof i.root === "string" ? i as Instance : null
  } catch { return null }
}

const list = (dir: string) => { try { return fs.readdirSync(dir) } catch { return [] } }
/** Every instance's userData under Dev's `data` (every worktree's, or `worktree`'s), with its record. */
export function instances(data: string, worktree?: string): { userData: string; headless: boolean; info: Instance | null }[] {
  const dirs = worktree ? [instancesOf(data, worktree)] : list(path.join(data, "instances")).map((d) => path.join(data, "instances", d))
  return dirs.flatMap((dir) => list(dir).filter((n) => n === "app" || /^headless-\d+$/.test(n))
    .map((n) => ({ userData: path.join(dir, n), headless: n !== "app", info: instanceAt(path.join(dir, n)) })))
}

/** The processes `ps -A -ww -E -o pid= -o command=` lists with this userData in their environment: an instance's main
 *  process and everything it started that inherited it (servers, terminal and chat keepers), whose own lines they are. */
export function ownedBy(ps: string, userData: string): number[] {
  const mark = `VAULTITE_USER_DATA=${userData}`
  return ps.split("\n").flatMap((l) => {
    const m = /^\s*(\d+)\s(.*)$/.exec(l)
    const at = m ? m[2].indexOf(mark) : -1
    return m && at >= 0 && [" ", undefined].includes(m[2][at + mark.length]) ? [Number(m[1])] : []
  })
}

/** The processes running with this userData in their environment now: from ps on a Mac (its -E), /proc on Linux, where
 *  ps has no -E. */
export function ownedNow(userData: string): number[] {
  if (process.platform !== "linux") return ownedBy(execFileSync("ps", ["-A", "-ww", "-E", "-o", "pid=", "-o", "command="], { encoding: "utf8", maxBuffer: 64 << 20 }), userData)
  const mark = `VAULTITE_USER_DATA=${userData}`
  const pids = fs.readdirSync("/proc").filter((n) => /^\d+$/.test(n)).filter((n) => {
    try { return fs.readFileSync(`/proc/${n}/environ`, "utf8").split("\0").includes(mark) } catch { return false } // (gone, or not ours)
  }).map(Number)
  // (and its main process by Chromium's lock, "<host>-<pid>": a relaunched one's environment reads blank there, Chromium's
  // process title written over it)
  let main = 0
  try { main = Number(/-(\d+)$/.exec(fs.readlinkSync(path.join(userData, "SingletonLock")))?.[1]) || 0 } catch { /* none */ }
  return main && !pids.includes(main) && fs.existsSync(`/proc/${main}`) ? [...pids, main] : pids
}
