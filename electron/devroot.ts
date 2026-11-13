// A Vaultite Dev instance on a worktree (the shell's VAULTITE_CODE_ROOT, from electron/dev.ts): which worktree, branch
// and commit it runs (titles, the Dock, About), and the worktree's changes taken in as they're saved (devreach.ts).
import { execFile, spawn, type ChildProcess } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { gitEnv } from "../core/gitenv.ts"
import type { Instance } from "./devinstance.ts"
import type { ParseCache } from "../core/update/closure.ts"
import { reach } from "./devreach.ts"
import { fingerprint } from "./shell/print.mjs"
import { atExit } from "../core/exit.ts"

export type Worktree = { worktree: string; branch: string; commit: string; dirty: boolean }
/** What the instance needs of the app (vaultwindow.ts startWorktree). */
export type DevHost = {
  root: string; userData: string; headless: boolean; debugPort: number | null
  /** The shell's fingerprint: a worktree that no longer matches it needs a new shell (npm run app:dev builds it). */
  shellPrint: string | undefined
  /** What it runs now (About, vau version). */
  info(w: Worktree): void
  /** Main-process changes, waiting for a relaunch (offered; headless, done). */
  changed(what: string): void
  restartServers(): void
  say(text: string): void
}

/** Changes in these never reach a running app: its build outputs, data, git's own. */
const IGNORED = /^(\.git|node_modules|web\/dist|web\/dist-demo|web\/qa\/shots|dist-app|dist-test|data|\.vaultite|electron\/bin|electron\/(build|shell|cli)\.json$)(\/|$)|(~|\.swp|\.tmp|\.DS_Store)$/
const git = (root: string, ...args: string[]) => new Promise<string>((done) =>
  execFile("git", ["-C", root, ...args], { env: gitEnv(), timeout: 5000 }, (e, out) => done(e ? "" : String(out).trim())))

let state: Worktree | null = null
/** A window's title, with the worktree and branch it runs. */
export const titled = (t: string) => (state ? `${t} · ${state.worktree} (${state.branch})` : t)
/** The Dock's badge: which worktree (a few letters). */
export const badge = () => (state?.worktree ?? "dev").slice(0, 10)

async function look(root: string): Promise<Worktree> {
  const [commit, branch, status] = await Promise.all([git(root, "rev-parse", "HEAD"), git(root, "symbolic-ref", "--short", "-q", "HEAD"), git(root, "status", "--porcelain")])
  return { worktree: path.basename(root), branch: branch || "detached", commit, dirty: !!status }
}

/** Start following the worktree: its record written (dev.ts reads it), its state told, its changes watched. */
export async function startDev(h: DevHost) {
  state = await look(h.root)
  h.info(state)
  const file = path.join(h.userData, "instance.json")
  const me: Instance = { pid: process.pid, root: h.root, worktree: state.worktree, headless: h.headless, debugPort: h.debugPort, started: Date.now() }
  fs.mkdirSync(h.userData, { recursive: true })
  fs.writeFileSync(file, JSON.stringify(me, null, 2) + "\n")
  atExit(() => { try { if (JSON.parse(fs.readFileSync(file, "utf8")).pid === process.pid) fs.rmSync(file) } catch { /* gone */ } })

  const parses: ParseCache = new Map()
  let pending = new Set<string>(), timer: NodeJS.Timeout | undefined, building: ChildProcess | null = null, again = false, toldShell = false
  const log = path.join(h.userData, "logs", "dev-build.log")
  // A new web/dist (Vite only: a type error is the agent's to fix, not a reason to keep the old pages); its server tells
  // the pages, which reload (core/webbuild.ts).
  const buildWeb = () => {
    if (building) return void (again = true)
    fs.mkdirSync(path.dirname(log), { recursive: true })
    const out = fs.openSync(log, "a")
    building = spawn(process.execPath, [path.join(h.root, "node_modules", "vite", "bin", "vite.js"), "build"],
      { cwd: h.root, env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }, stdio: ["ignore", out, out] })
    fs.closeSync(out)
    building.on("exit", (code) => {
      building = null
      if (code) h.say(`The web app didn't build (${log})`)
      if (again) { again = false; buildWeb() }
    })
  }
  const settle = async () => {
    const files = [...pending]
    pending = new Set()
    const r = reach(h.root, files, parses)
    state = await look(h.root)
    h.info(state)
    if (!toldShell && h.shellPrint && (() => { try { return fingerprint(h.root) !== h.shellPrint } catch { return true } })()) {
      toldShell = true
      h.say("This branch changed the app's shell: npm run app:dev builds it, then runs it")
    }
    if (r.web) buildWeb()
    if (r.main) {
      h.changed("Your changes to the app")
      return
    }
    if (r.server) h.restartServers()
  }
  try {
    fs.watch(h.root, { recursive: true, persistent: false }, (_ev, name) => {
      const f = name ? String(name).split(path.sep).join("/") : ""
      if (!f || IGNORED.test(f)) return
      pending.add(f)
      clearTimeout(timer)
      timer = setTimeout(() => void settle(), 400)
    })
  } catch (e) { console.error("vaultite dev: can't watch the worktree:", e) }
}
