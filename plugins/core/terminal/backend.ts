import crypto from "node:crypto"
import fs from "node:fs"
import { type Access, accessOf, logger, outliving, runtimeDir } from "../../../core/plugins.ts"
import os from "node:os"
import path from "node:path"
import { execFile, spawn } from "node:child_process"
import type { IPty } from "node-pty"
import type { Said } from "./osc7501.ts"
import { Failure, PROTOCOL, type Capture, type CaptureFormat, type Event, type Exit as Ended } from "./termd/protocol.ts"
import { connectTo, type Msg, termdClient, Wire } from "./wire.ts"

const log = logger("terminal")

export type { Capture, CaptureFormat, Ended }

/** An agent's command and the folder it runs in (AgentStart in core/agents.ts). */
export type AgentRun = { command: string; cwd?: string | null }

/** A new terminal: `shell` (a path, or wsl:<distro>) in `cwd`, running `run` first for an agent. `env`: the server's
 *  less what's about it; `ctx`: Vaultite's variables (VAULTITE_URL..., PATH with the app's bin/ first). */
export type Spec = { shell: string; run: AgentRun | null; cwd: string; env: Record<string, string>; ctx: Record<string, string>; cols: number; rows: number
  scrollback: number
  /** `run` alone: a command whose end is the terminal's (its exit code too). */
  only?: boolean }

/** What a new terminal is, for its list: what it was started to run (`command`: "claude", "npm test", "zsh") and the
 *  app's meta to keep with it (`name`, `note`). `spare`: a shell kept ready, renamed when it's taken. */
export type Made = { spare?: boolean; command?: string; meta?: Record<string, string> }

export const limits = { scrollback: () => 10_000 }

/** How a terminal ended: its exit status (`lost`: unknown, the server holding it went away), or null when only this
 *  server's hold on it ended (it still runs: reattach). */
export type Exit = { code: number; signal: number; lost?: boolean } | null

export type Cell = { width: number; height: number }

/** One server's hold on a running terminal. */
export interface Link {
  readonly cols: number
  readonly rows: number
  write(data: Buffer): void
  /** `cell`: a cell's size in the device's pixels (the cells a picture covers: kitty graphics). */
  resize(cols: number, rows: number, cell?: Cell): void
  onData(fn: (data: string) => void): void
  onExit(fn: (exit: Exit) => void): void
  /** The screen and history for a new viewer, given in order with onData (`mirrored` makes one for a backend that has
   *  none). */
  snapshot(fn: (picture: string) => void): void
  /** Stop reading its output until resume (its program waits once the pty is full): the pages are behind. */
  pause?(): void
  resume?(): void
  /** Let go of it: the terminal keeps running. */
  close(): void
}

/** A terminal as a backend lists it. `process`: the program in front now; `attached`: holds on it, this server's
 *  included; `activity`: last input or output (ms); `command`: what it was started to run (Made). */
export type Listed = { id: string; pid?: number; process: string; created: number; activity?: number; attached: number; title?: string
  cwd?: string; command?: string; cols?: number; rows?: number
  /** The app's, from a backend that keeps it (setMeta). */
  meta?: Record<string, string>
  /** Its own word on an agent there (herdr's: working, waiting, idle). */
  state?: string
  /** Its program's OSC 7501, from a backend that reads it. */
  said?: Said
  /** Held through an older terminal server (termd/adopt.ts): its pid. */
  via?: number
  /** Only with list's `ended`. */
  exit?: Ended
  /** Not started by Vaultite (a herdr pane of the user's). */
  external?: boolean
  spare?: boolean }

export type BackendEvent = Exclude<Event, { type: "started" }> | { type: "started"; id: string; info?: Listed }

/** A backend's terminals out of reach: since when, its server's pid, and that said for the user. */
export type Trouble = { since: number; pid: number; text: string }

/** Text as typed (`paste`: as a bracketed paste, when its program asked for those), or keys by name (keys.ts: Enter,
 *  C-c, Up). */
export type Input = { text: string; paste?: boolean } | { keys: string[] }

/** What another plugin's "terminal:backend" implements (with backendKit). */
export interface Backend {
  readonly name: string
  readonly label: string
  /** Its terminals are also the user's own elsewhere (herdr): never ended for being idle or by Vaultite's sweeps. */
  readonly external?: boolean
  /** Shells kept ready are made in it: create(..., {spare}), then rename(). */
  readonly spares?: boolean
  /** New terminals start in it (as its plugin's settings say: herdr's "Start new terminals in herdr"). */
  readonly preferred?: boolean
  /** Whether it can run here now (installed, its server answering). */
  ready(): Promise<boolean>
  /** With `ended`, the ones that ended lately too (with their `exit`), for a backend that keeps them. */
  list(o?: { ended?: boolean }): Promise<Listed[]>
  create(id: string, spec: Spec, o?: Made): Promise<void>
  attach(id: string, cols: number, rows: number): Promise<Link>
  /** A hangup, as closing a terminal does, or `signal`. */
  kill(id: string, signal?: string): Promise<void>
  /** Its last `lines` (none: its screen; null: all it keeps); one that ended lately too, from a backend that keeps it
   *  (`ended` in the answer). A format it can't give throws saying so. */
  capture(id: string, o: { format: CaptureFormat; lines?: number | null }): Promise<Capture & { ended?: boolean }>
  /** The app waits between a text and the Enter after it. */
  send(id: string, input: Input): Promise<void>
  /** A spare taken: its new id, and what it's made into. */
  rename?(from: string, to: string, o?: Made): Promise<void>
  /** Keeps the app's meta with the terminal: each key set, or removed by null. Without it the app keeps them itself, on
   *  this machine. */
  setMeta?(id: string, patch: Record<string, string | null>): Promise<void>
  /** `fn` hears what changes as it happens, from the first call on. Without it the app asks list(). */
  events?(fn: (ev: BackendEvent) => void): void
  /** Why its terminals can't be reached now (its server stopped answering: they're frozen, and not listed), or null. */
  trouble?(): Trouble | null
  /** Its program ended (the app saw its shell at the prompt again): the working and blocked OSC 7501 records go. */
  dropStatus?(id: string): Promise<void>
  /** Whether its terminals draw kitty graphics a program sends as Claude Code does (by file, or PNG). Without it, none:
   *  pages can't read files or decode a PNG in time. */
  pictures?(): Promise<boolean>
}

/** Typed, an agent reads a text in the pty's ~1 KB pieces, each a paste of its own (joined with a line break, or dropped
 *  while it's busy). A short one stays keys (a "1" answering a menu). */
export const asPaste = (text: string) => Buffer.byteLength(text) > 256 || text.includes("\n")
/** A paste marker in it would end its paste early, or show as `201~` where none was asked. */
export const unmarked = (text: string) => text.replace(/\x1b\[20[01]~/g, "")

const WIN = process.platform === "win32"
/** Windows' pipes are the machine's, not a user's: another user's server would find this one's. */
const userTag = () => `${os.userInfo().username}-${crypto.createHash("sha1").update(os.homedir()).digest("hex").slice(0, 8)}`.replace(/[^\w.-]/g, "_")

/** Windows has no signals: its console closes. */
export function hangup(p: IPty) {
  try { if (WIN) p.kill(); else p.kill("SIGHUP") } catch { /* ended */ }
}

let ptyLib: typeof import("node-pty") | null = null
export async function loadPty() {
  const { fixHelper } = await import("./termd/spawnhelper.ts")
  fixHelper()
  ptyLib ??= (await import("node-pty")).default
  return ptyLib
}

export const plain = (s: string) => s.replace(/\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(\x07|\x1b\\)|\x1b[@-_]/g, "").replace(/\r(?!\n)/g, "")

export type RawLink = Omit<Link, "snapshot">

/** A pseudo-terminal this process holds (a plugin backend's attach client, like herdr's). `exit`: how it ended, as the
 *  backend tells (null: only the client ended, reattach). */
export function ptyLink(p: IPty, extra: Partial<Pick<Link, "write" | "onData">> & { exit?: (code: number, signal: number) => Promise<Exit> } = {}): RawLink {
  return {
    get cols() { return p.cols },
    get rows() { return p.rows },
    write: extra.write ?? ((b) => { try { p.write(b) } catch { /* ended */ } }),
    resize: (c, r) => { try { p.resize(c, r) } catch { /* ended */ } },
    onData: extra.onData ?? ((fn) => { p.onData(fn) }),
    onExit: (fn) => { p.onExit(async ({ exitCode, signal }) => fn(extra.exit ? await extra.exit(exitCode, signal ?? 0) : { code: exitCode, signal: signal ?? 0 })) },
    pause: () => p.pause(),
    resume: () => p.resume(),
    close: () => hangup(p),
  }
}

/** Snapshots for a link that has none (its client only sends what changed), from a terminal of its own reading its
 *  output first. */
export async function mirrored(link: RawLink, scrollback = limits.scrollback()): Promise<Link> {
  const { newVt } = await import("./vt/load.ts")
  const term = newVt({ cols: link.cols, rows: link.rows, scrollback })
  let ended = false
  const data = new Set<(d: string) => void>()
  link.onData((d) => { if (!ended) try { term.write(d) } catch { ended = true }; for (const fn of data) fn(d) })
  link.onExit(() => { ended = true; term.dispose() })
  return {
    get cols() { return link.cols },
    get rows() { return link.rows },
    write: (b) => link.write(b),
    resize: (c, r, cell) => { link.resize(c, r, cell); if (!ended) term.resize(c, r, cell?.width, cell?.height) },
    onData: (fn) => { data.add(fn) },
    onExit: (fn) => link.onExit(fn),
    snapshot: (fn) => fn(ended ? "" : term.serialize()),
    pause: link.pause && (() => link.pause!()),
    resume: link.resume && (() => link.resume!()),
    close: () => link.close(),
  }
}

export const backendName = (port: number, pid = process.pid) => (port === 8793 ? "vaultite" : `vaultite-${port || `x${pid}`}`)

const WIN_PIPE = (name: string, v: number) => `\\\\.\\pipe\\vaultite-${v === 1 ? "ptyd" : "termd"}${v}-${name}-${userTag()}`
export function serverFiles(name: string, v = PROTOCOL): ServerFiles {
  const files = path.join(runtimeDir(), `vaultite-${v === 1 ? "ptyd" : "termd"}${v}-${name}.sock`)
  return { files, socket: WIN ? WIN_PIPE(name, v) : files }
}
export type ServerFiles = { files: string; socket: string }
/** Opening a Windows pipe to look would take one of its instances. */
const markOf = (f: ServerFiles) => (WIN ? `${f.files}.pid` : f.socket)
const there = (f: string) => new Promise<boolean>((ok) => fs.stat(f, (e) => ok(!e)))
async function takeOver(w: Wire, olds: ServerFiles[], log?: (...a: unknown[]) => void) {
  for (const { socket: old } of olds) {
    const r = await w.request("adopt", { socket: old, scrollback: limits.scrollback() }, 60_000).then((a) => a.adopted, (e: Error) => e.message)
    if (typeof r === "string") log?.(`couldn't take over the terminals at ${old}: ${r}`)
    else if (r.length) log?.(`took over ${r.length} terminals from the older server at ${old}`)
  }
}

export function termdBackend(name: string, o: { daemon: string; log?: (...a: unknown[]) => void; oldServers?: ServerFiles[]; probeMs?: number }) {
  const { files, socket } = serverFiles(name)
  const mark = markOf({ files, socket })
  let ctl: Promise<Wire> | null = null

  // Detached and, under systemd, in a scope of its own: else stopping the app's server's unit ends it too.
  function startServer(plain = false) {
    let out: number | "ignore" = "ignore"
    try { out = fs.openSync(`${files}.log`, "a") } catch { /* no log */ }
    const [cmd, args] = plain ? [process.execPath, [o.daemon, socket, files]] : outliving(process.execPath, [o.daemon, socket, files], `termd-${name}`)
    const child = spawn(cmd, args, { detached: true, stdio: ["ignore", out, out], cwd: os.homedir(), env: process.env, windowsHide: true })
    // systemd-run that couldn't make the scope (no user bus) fails at once: start it as before.
    if (cmd !== process.execPath) child.once("exit", (code) => { if (code) startServer(true) })
    child.unref()
    if (typeof out === "number") fs.closeSync(out)
  }

  async function open(): Promise<Wire> {
    try { return await connectTo(socket) } catch { /* not running */ }
    startServer()
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 50))
      try { return await connectTo(socket) } catch { /* not yet */ }
    }
    throw new Error(`the terminal server didn't start (see ${files}.log)`)
  }

  function control(): Promise<Wire> {
    if (!ctl) {
      const p: Promise<Wire> = open().then(async (w) => {
        const at = Date.now()
        w.onClose = () => { answered(); if (ctl !== p) return; ctl = null; setTimeout(() => { if (!ctl) void running() }, Date.now() - at > 5000 ? 500 : 10_000).unref?.() }
        watch(w)
        client.follow(w)
        await takeOver(w, o.oldServers ?? [], o.log && ((...a) => o.log!("terminal:", ...a)))
        return w
      })
      ctl = p
      p.catch(() => { if (ctl === p) ctl = null })
    }
    return ctl
  }
  async function running(): Promise<Wire | null> {
    if (ctl) return ctl.catch(() => null)
    if (!(await there(mark)) && !(await Promise.all((o.oldServers ?? []).map((f) => there(markOf(f))))).some(Boolean)) return null
    return control().catch(() => null)
  }

  let stall: { since: number; pid: number; probe: ReturnType<typeof setInterval>; looked: boolean } | null = null
  const pidOf = () => { try { return Number(fs.readFileSync(`${files}.pid`, "utf8").trim()) || 0 } catch { return 0 } }
  const clock = (t: number) => new Date(t).toTimeString().slice(0, 8)
  const stallText = () => stall ? `the terminal server (pid ${stall.pid || "unknown"}) hasn't answered since ${clock(stall.since)}: the terminals it holds are frozen until it does` : ""
  function watch(w: Wire) {
    w.stalled = () => stallText() || "the terminal server isn't answering"
    w.probeMs = o.probeMs ?? w.probeMs; w.onStall = (op, waited) => {
      const pid = pidOf()
      const probe = setInterval(() => {
        void w.request("hello", {}, 5000).catch(() => {})
        if (stall && !stall.looked && Date.now() - stall.since > 60_000) { stall.looked = true; void lookAt(stall.pid, stall.since) }
      }, 5000)
      probe.unref?.()
      stall = { since: w.stalledSince ?? Date.now(), pid, probe, looked: false }
      o.log?.(`terminal: the terminal server (pid ${pid || "unknown"}) didn't answer ${op} in ${Math.round(waited / 1000)} s, nor a check in ${Math.round(w.probeMs / 1000)} s after it: the terminals it holds are frozen until it answers, and new ones run in this server (its log: ${files}.log)`)
    }
    w.onAnswer = (ms) => { if (!stall) return; answered(); log.info(`the terminal server answers again, after ${Math.round(ms / 1000)} s`) }
  }
  function answered() { if (stall) clearInterval(stall.probe); stall = null }
  async function lookAt(pid: number, since: number) {
    if (!pid || WIN) return
    const cpu = await new Promise<string>((ok) => execFile("ps", ["-o", "%cpu=", "-p", String(pid)], { timeout: 3000 }, (e, out) => ok(e ? "" : String(out).trim())))
    if (!stall || stall.since !== since) return
    o.log?.(cpu
      ? `terminal: the terminal server (pid ${pid}) still hasn't answered after ${Math.round((Date.now() - since) / 1000)} s, at ${cpu}% CPU${Number(cpu) > 80 ? ": stuck in a loop. Ending it (kill " + pid + ") ends its terminals, which can't go on anyway" : ""}`
      : `terminal: the terminal server (pid ${pid}) still hasn't answered, and isn't running`)
  }

  const client = termdClient({ name: "vaultite", label: "Vaultite", control, running, open })
  const b = client.backend
  return {
    ...b, socket, files,
    trouble: (): Trouble | null => (stall ? { since: stall.since, pid: stall.pid, text: stallText() } : null),
    async create(id: string, spec: Spec, c?: Made) {
      try { await b.create(id, spec, c) } catch (e) {
        if (!(e instanceof Failure && e.code === "retiring")) throw e
        o.log?.("terminal: the terminal server's files were gone, so it retired: starting a new one")
        for (let i = 0; i < 40 && fs.existsSync(mark); i++) await new Promise((r) => setTimeout(r, 50))
        ctl = null
        await b.create(id, spec, c)
      }
    },
    async access(dir: string): Promise<Access | null> {
      const w = await running()
      if (!w) return null
      try {
        const r = await w.request("access", { path: dir })
        return accessOf(r.ok ? "" : String(r.code || "EIO"))
      } catch (e) { return { ok: null, why: (e as Error).message } }
    },
    ask: client.ask,
  }
}

export function localBackend(o: { log?: (...a: unknown[]) => void; oldServers?: ServerFiles[]; adoptOld?: () => Promise<boolean> } = {}): Backend {
  let made: Promise<import("./termd/host.ts").Host> | null = null
  const hostNow = () => (made ??= import("./termd/host.ts").then(({ host }) => host({ log: o.log ?? (() => {}), pid: process.pid, file: "this server" })))
  async function open(): Promise<Wire> {
    const h = await hostNow()
    let paused = false, closed = false
    const held: Msg[] = [], toClient = new Set<(m: Msg) => void>(), closers: (() => void)[] = []
    let queued = 0
    const deliver = (m: Msg) => { for (const fn of toClient) fn(m) }
    const conn = h.connect({
      session: null, ready: false,
      send: (m) => {
        if (closed) return
        if (paused) { held.push(m); queued += "d" in m ? m.d.length : 0; return }
        queueMicrotask(() => { if (!closed) deliver(m) })
      },
      backlog: () => queued,
    })
    const w = new Wire({
      write: (m) => queueMicrotask(() => { if (!closed) conn.take(m) }),
      onMessage: (fn) => { toClient.add(fn) },
      onClose: (fn) => { closers.push(fn) },
      close: () => { if (closed) return; closed = true; conn.gone(); for (const fn of closers.splice(0)) fn() },
      pause: () => { paused = true },
      resume: () => {
        paused = false
        for (const m of held.splice(0)) deliver(m)
        queued = 0
        conn.drained()
      },
    })
    return w
  }
  const olds = o.oldServers ?? []
  const adoptNow = async () => !!olds.length && (await Promise.all(olds.map((f) => there(markOf(f))))).some(Boolean) && !!(await o.adoptOld?.().catch(() => false))
  let ctl: Promise<Wire> | null = null
  const control = () => (ctl ??= open().then(async (w) => {
    client.follow(w)
    if (await adoptNow()) await takeOver(w, olds, o.log)
    return w
  }))
  const client = termdClient({ name: "pty", label: "This server", control, running: async () => (made || (await adoptNow()) ? control() : null), open })
  return { ...client.backend, spares: false }
}
