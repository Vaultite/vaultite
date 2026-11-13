import { app, type WebContents } from "electron"
import { AppWindow } from "./appwindow.ts"
import { fork, type ChildProcess } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"
import type { MenuSnapshot } from "./menu.ts"
import { serverCall, setServerSink } from "./browser/engine.ts"
import { attach, servedHere, type Call, type Link } from "./host.ts"
import type { Adopted } from "./heir.ts"
import type { Serving } from "../core/serving.ts"
import { talkCall } from "./talklog.ts"
import { codeRoot, commitAt, hold } from "./storehost.ts"
import { DESKTOP_PROTOCOL, LISTENING } from "../core/desktopapp.ts"
import { appUpdates, lookNow, mainBehind } from "./updates.ts"
import { mainLog } from "./mainlog.ts"
import { ServerWatch } from "./serverwatch.ts"
import { MAC, ROOT, WIN } from "./mainbase.ts"
import { heldPastExec, INHERITED } from "./inherited.ts"
import { type Known, nameOf, portFor, PortTaken } from "./vaultlist.ts"

export const serverLog = (p: string) => path.join(app.getPath("logs"), `server-${nameOf(p)}.log`)
const LOCAL = process.env.VAULTITE_LOCAL || (app.isPackaged ? path.join(app.getPath("userData"), "local") : path.join(ROOT, "data"))

export type Win = { vault: Known; win: AppWindow; server: ChildProcess | null; link: Link | null; port: number; ready: boolean; queue: string[]
  ending?: boolean
  watch?: ServerWatch<ChildProcess>
  web?: string
  welcome?: boolean
  menu?: MenuSnapshot }
export const wins = new Map<string, Win>()
type Kept = { server: ChildProcess | null; link: Link | null; port: number }
export const kept = new Map<string, Kept>()
export const macPermissions = () => import("./permissions.ts")

export let helper: typeof import("./helper.ts") | null = null
export const setHelper = (to: typeof import("./helper.ts") | null) => { helper = to }
export const helperOn = () => !!helper?.helperOn()
export const homeChanged = () => helper?.homeChanged()
export const popouts = new Map<WebContents, Win>()

export const booting = new Map<string, Promise<[ChildProcess, number]>>()
export const ownPids = new Set<number>()
function ownServer(pid: number | undefined, s: { once(e: "exit", fn: () => void): unknown }) {
  if (!pid) return
  ownPids.add(pid)
  s.once("exit", () => ownPids.delete(pid))
}
export const servedElsewhere = (p: string) => (booting.has(p) ? Promise.resolve(null) : servedHere(p))
export function serverFor(v: Known) {
  let b = booting.get(v.path)
  if (!b) {
    b = (async (): Promise<[ChildProcess, number]> => {
      for (let tries = 0; ; tries++) {
        const port = portFor(v, tries > 0)
        try {
          return [await startServer(v, port), port]
        } catch (e) {
          if (!(e instanceof PortTaken) || tries >= 5) throw e
        }
      }
    })()
    booting.set(v.path, b)
    b.catch(() => booting.delete(v.path))
  }
  return b
}

export const answerCall = (v: Known, m: Call) => Promise.resolve().then(() => m.name === "app:permissions" ? (MAC ? macPermissions().then((p) => p.macPermissions()) : null)
  : m.name === "app:updates" ? appUpdates()
  : m.name === "app:update-look" ? lookNow(Array.isArray(m.args) ? m.args[0] as { port?: unknown; commit?: unknown } : undefined)
  : typeof m.name === "string" && m.name.startsWith("screen:") ? (helper ? helper.screenCall(m.name, Array.isArray(m.args) ? m.args : []) : null)
  : typeof m.name === "string" && m.name.startsWith("talk:") ? talkCall(m.name, Array.isArray(m.args) ? m.args : [])
  : typeof m.name === "string" && m.name.startsWith("dictations:") ? (MAC ? import("./dictationlist.ts").then((d) => d.dictationsCall(String(m.name), Array.isArray(m.args) ? m.args : [])) : { items: [], total: 0, here: false })
  : typeof m.name === "string" && m.name.startsWith("voice:") ? (helper ? helper.voiceCall(m.name, Array.isArray(m.args) ? m.args : []) : { said: false, why: "no menu-bar helper here" })
  : serverCall(wins.get(v.path)?.win, m.name, Array.isArray(m.args) ? m.args : []))

function desktopEvent(w: Win, name: string, data: unknown) {
  const m = { type: "desktop:event", name, data }
  if (w.server?.connected) w.server.send(m); else w.link?.send(m)
}
setServerSink((win, name, data) => { for (const w of wins.values()) if (w.win === win) desktopEvent(w, name, data) })

export const rootOf = new WeakMap<ChildProcess, string>()
export const logFrom = new WeakMap<ChildProcess, number>()
export const adopted = (s: ChildProcess | null): s is ChildProcess & Adopted => typeof (s as { release?: unknown } | null)?.release === "function"
export function logSince(file: string, from: number) {
  try {
    const fd = fs.openSync(file, "r")
    try {
      const end = fs.fstatSync(fd).size, start = Math.max(from, end - 8000), buf = Buffer.alloc(Math.max(0, end - start))
      fs.readSync(fd, buf, 0, buf.length, start)
      return buf.toString("utf8").slice(-2000)
    } finally { fs.closeSync(fd) }
  } catch { return "" }
}
export let handingOver = false
export function startServer(v: Known, port: number, own = false): Promise<ChildProcess> {
  const logDir = app.getPath("logs")
  fs.mkdirSync(logDir, { recursive: true })
  const logFile = serverLog(v.path), fd = fs.openSync(logFile, "a"), from = fs.fstatSync(fd).size
  const root = own ? ROOT : codeRoot()
  const leaks = heldPastExec()
  const child = fork(path.join(root, "server.ts"), [], {
    cwd: root, stdio: ["ignore", fd, fd, "ipc"], detached: !WIN,
    execArgv: leaks ? [...process.execArgv, "--import", pathToFileURL(path.join(root, "electron", "inheritedclose.ts")).href] : process.execArgv,
    env: {
      ...process.env, ELECTRON_RUN_AS_NODE: "1", VAULTITE_DESKTOP: "1", VAULTITE_VAULT: v.path, VAULTITE_LOCAL: LOCAL,
      HOST: "127.0.0.1", PORT: String(port), [INHERITED]: leaks || undefined,
      // (Node's compile cache out of the temp folder: restarts and cleanups empty it)
      NODE_COMPILE_CACHE: process.env.NODE_COMPILE_CACHE || path.join(app.getPath("userData"), "compile-cache"),
      VAULTITE_LAUNCHED_AT: String(Math.round(Date.now() - process.uptime() * 1000)), VAULTITE_FORKED_AT: String(Date.now()),
    },
  })
  fs.closeSync(fd)
  const name = nameOf(v.path), began = Date.now()
  mainLog(`${name}: server forked (pid ${child.pid ?? "none"}, port ${port}, ${commitAt(root)?.slice(0, 7) ?? root})`)
  rootOf.set(child, root)
  logFrom.set(child, from)
  ownServer(child.pid, child)
  if (child.pid) hold(root, child.pid, "server")
  let spoke: unknown = root === ROOT ? DESKTOP_PROTOCOL : undefined
  child.on("message", (m: { type?: string; protocol?: unknown }) => { if (m?.type === "desktop:hello") spoke = m.protocol })
  child.on("message", (m: Call) => {
    if (m?.type !== "desktop:call" || typeof m.rid !== "number") return
    const reply = (r: { value?: unknown; error?: string }) => { if (child.connected) child.send({ type: "desktop:reply", rid: m.rid, ...r }) }
    answerCall(v, m).then((value) => reply({ value }), (e) => reply({ error: e instanceof Error ? e.message : String(e) }))
  })
  return new Promise((ok, fail) => {
    const said = () => logSince(logFile, from)
    const timer = setTimeout(() => {
      clearInterval(look)
      mainLog(`${name}: server pid ${child.pid} didn't listen in 120 s: stopped`)
      child.kill("SIGKILL")
      fail(new Error(`the server didn't start in time\n${said()}`))
    }, 120_000)
    let up = false
    const listening = () => {
      if (up) return
      up = true
      clearTimeout(timer)
      clearInterval(look)
      mainLog(`${name}: server pid ${child.pid} listens (${((Date.now() - began) / 1000).toFixed(1)} s)`)
      if (spoke === DESKTOP_PROTOCOL) return ok(child)
      mainLog(`${name}'s server from ${root} speaks protocol ${String(spoke ?? "?")}, this app ${DESKTOP_PROTOCOL}: its own code instead`)
      const c = commitAt(root)
      if (c) mainBehind(c)
      child.removeAllListeners("exit")
      child.once("exit", () => startServer(v, port, true).then(ok, fail))
      child.kill()
    }
    child.on("message", (m: { type?: string }) => { if (m?.type === "desktop:listening") listening() })
    const look = setInterval(() => { if (said().includes(LISTENING)) listening() }, 500)
    child.once("exit", (code, signal) => {
      clearTimeout(timer)
      clearInterval(look)
      const out = said()
      if (!up) mainLog(`${name}: server pid ${child.pid} stopped before it listened (exit ${signal ?? code})`)
      fail(/EADDRINUSE/.test(out) ? new PortTaken(`port ${port} is taken`) : new Error(`the server stopped (exit ${signal ?? code})\n${out}`))
    })
    child.on("error", (e) => {
      mainLog(`${name}: server pid ${child.pid ?? "none"}: ${e.message}`)
      const forkFailedSoNoExitComes = !child.pid
      if (!forkFailedSoNoExitComes) return
      clearTimeout(timer)
      clearInterval(look)
      fail(new Error(`the server couldn't be started: ${e.message}`))
    })
    if (v.outside?.length && child.pid) child.send({ type: "allow", paths: v.outside })
  })
}

export const heirHere = (s: Serving) => !!s.heir && s.app && s.heir.app === app.getPath("userData")
export async function adopt(v: Known, s: Serving): Promise<ChildProcess> {
  let a: Adopted | null = null
  const link = await attach(v.path, s, (m) => answerCall(v, m), () => (v.outside?.length ? [{ type: "allow", paths: v.outside }] : []), () => a?.kill())
  a = new (await import("./heir.ts")).Adopted(s.pid, link)
  const child = a as unknown as ChildProcess
  ownServer(s.pid, a)
  rootOf.set(child, s.heir!.root)
  logFrom.set(child, (() => { try { return fs.statSync(serverLog(v.path)).size } catch { return 0 } })())
  mainLog(`${nameOf(v.path)}: server pid ${s.pid} kept running through the relaunch: taken over (${commitAt(s.heir!.root)?.slice(0, 7) ?? s.heir!.root})`)
  return child
}

export function handOver() {
  handingOver = true
  const m = { type: "desktop:relaunching", app: app.getPath("userData") }
  const told = [...wins.values(), ...kept.values()].flatMap((w) => (w.server?.exitCode === null ? [w.server] : []))
  for (const s of told) s.send(m)
  mainLog(`relaunching: servers told to wait for the next launch (pids ${told.map((s) => s.pid).join(", ") || "none"})`)
}

export function keepServer(p: string, k: Kept) {
  kept.set(p, k)
  k.server?.once("exit", () => { if (kept.get(p) === k) { kept.delete(p); booting.delete(p) } })
}
