import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { createRequire } from "node:module"
import pty, { type IPty } from "node-pty"
import { keysBytes } from "../keys.ts"
import { REPLY, watcher, type Said } from "../osc7501.ts"
import { adopter } from "./adopt.ts"
import { KittyFeed, remoteFront } from "./kitty.ts"
import { Screen } from "./screen.ts"
import { PROTOCOL, type Answer, type Capture, type CaptureFormat, type Event, type Exit, type Info } from "./protocol.ts"

const WIN = process.platform === "win32"
const SCROLLBACK = 10000
const ENDED_WHOLE = 10 * 60_000, ENDED_WHOLE_MAX = 8
const ENDED_KEPT = 60 * 60_000, ENDED_MAX = 200
const HOLD = 1 << 20
/** node-pty gives a burst in small reads, and a message each would cost every hop more than the bytes: while output
 *  pours it goes on every BATCH ms, and at once in the TYPING ms after input (echoes). */
const BATCH = 4, TYPING = 100

const require = createRequire(import.meta.url)
export const ptyDir = path.dirname(require.resolve("node-pty/package.json"))
/** node-pty's prebuilt spawn-helper can arrive without the exec bit (npm skips install scripts): posix_spawnp fails. */
export function fixHelper() {
  if (!WIN) for (const sub of [`prebuilds/${process.platform}-${process.arch}`, "build/Release"]) {
    const helper = path.join(ptyDir, sub, "spawn-helper")
    try { if (!(fs.statSync(helper).mode & 0o111)) fs.chmodSync(helper, 0o755) } catch { /* not there */ }
  }
}
fixHelper()

export type Conn = { send: (m: Record<string, unknown>) => void; backlog: () => number; session: Session | null; ready: boolean; events?: boolean
  held?: { data: string[]; bytes: number; snapshots: number } }

export type Driver = {
  pid: number
  write(data: string | Buffer): void
  resize(cols: number, rows: number): void
  kill(signal?: string): void
  pause(): void
  resume(): void
  process(): string
  via?: number
}

function metaOf(v: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  if (!v || typeof v !== "object") return out
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) if (/^[a-z][\w-]{0,31}$/i.test(k) && typeof x === "string" && x) out[k] = x.replace(/[\r\n]+/g, " ").slice(0, 500)
  return out
}

/** 0 on Windows, where node-pty ends what runs in the console with it. */
function foreground(pid: number) {
  if (WIN) return 0
  try {
    if (process.platform !== "linux") return Math.max(0, Number(execFileSync("ps", ["-o", "tpgid=", "-p", String(pid)], { encoding: "utf8", timeout: 2000 }).trim()) || 0)
    const st = fs.readFileSync(`/proc/${pid}/stat`, "utf8"), f = st.slice(st.lastIndexOf(")") + 2).split(" ")
    const tpgid = Number(f[5])
    return tpgid > 0 ? tpgid : 0
  } catch { return 0 }
}
/** An agent busy with a request may sit on SIGHUP. Jobs sent to the background (nohup) are another group's, and left
 *  alone. */
function reap(pgid: number) {
  const alive = () => { try { process.kill(-pgid, 0); return true } catch { return false } }
  setTimeout(() => {
    if (!alive()) return
    try { process.kill(-pgid, "SIGTERM") } catch { /* gone */ }
    setTimeout(() => { if (alive()) try { process.kill(-pgid, "SIGKILL") } catch { /* gone */ } }, 5000).unref()
  }, 5000).unref()
}
/** Windows has no signals: its console closes. */
function hangup(p: IPty, signal = "SIGHUP") { try { if (WIN) p.kill(); else p.kill(signal) } catch { /* ended */ } }

/** On a Mac, usually all of them are taken (kern.tty.ptmx_max, 511). */
const noPty = (e: unknown) => /posix_openpt|openpty|forkpty/.test(String((e as Error)?.message ?? e))

const lineCount = (v: unknown, max: number) => (v === "all" || v === null ? null : Math.max(1, Math.min(max, Math.trunc(Number(v)) || 0)))

type Around = { emit(ev: Event): number; sessions: Map<string, Session>; keepEnded(s: Session, told: boolean): void; log(...a: unknown[]): void; changed?(): void
  trouble?(id: string, text: string): void }

export class Session {
  private h: Around
  id: string; driver: Driver; shell: string; cwd: string; command: string; created = Date.now(); activity = Date.now(); spare: boolean
  title = ""; meta: Record<string, string>; exit?: Exit
  term: Screen
  attached = new Set<Conn>()
  queued = ""; flushing = false; flushed = 0; typed = 0
  held = false
  cell = { width: 8, height: 16 }
  said: Said = { seen: false, status: null }
  private told?: ReturnType<typeof setTimeout>
  private ending = false
  private kitty: KittyFeed

  constructor(h: Around, x: { id: string; driver: Driver; shell: string; cwd: string; command: string; cols: number; rows: number; scrollback: number; spare: boolean
    meta?: Record<string, string>; created?: number }) {
    this.h = h
    this.id = x.id; this.driver = x.driver; this.shell = x.shell; this.cwd = x.cwd; this.command = x.command; this.spare = x.spare
    this.meta = { ...x.meta }
    if (x.created) this.created = x.created
    this.term = this.screen(x.cols, x.rows, x.scrollback > 0 ? x.scrollback : SCROLLBACK)
    this.kitty = new KittyFeed({ emit: (d) => this.take(d), log: (...a) => this.h.log(...a, this.id),
      remote: () => { try { return remoteFront(this.driver.process()) } catch { return true } } })
  }

  private screen(cols: number, rows: number, scrollback: number) {
    return new Screen({ cols, rows, scrollback,
      onTitle: (t) => { if (t === this.title) return; this.title = t; if (!this.spare) this.h.emit({ type: "title", id: this.id, title: t }) },
      onReply: (d) => { if (!this.attached.size && !this.exit) this.driver.write(d) },
      onTrouble: (text) => { this.h.log("screen", this.id, text); if (!this.spare) this.h.trouble?.(this.id, text) } })
  }

  info(): Info {
    let process = ""
    try { process = this.exit ? "" : this.driver.process() } catch { /* ended */ }
    return { id: this.id, pid: this.driver.pid, shell: this.shell, process, cwd: this.cwd, command: this.command, created: this.created, activity: this.activity,
      title: this.title, cols: this.term.cols, rows: this.term.rows, clients: this.attached.size, spare: this.spare, meta: this.meta, said: this.said,
      ...(this.exit ? { exit: this.exit } : {}), ...(this.driver.via ? { via: this.driver.via } : {}) }
  }

  output(d: string) { this.kitty.feed(d) }
  private take(d: string) {
    this.activity = Date.now()
    this.queued += d
    if (this.queued.length > HOLD) this.hold()
    if (this.flushing) return
    this.flushing = true
    const go = () => { this.flushing = false; this.flush() }, now = performance.now()
    const wait = now - this.typed < TYPING ? 0 : BATCH - (now - this.flushed)
    if (wait > 0) setTimeout(go, wait); else setImmediate(go)
  }
  flush() {
    const d = this.queued
    if (!d || this.exit) return
    this.queued = ""
    this.term.write(d)
    for (const c of this.attached) {
      if (!c.ready) continue
      if (c.held) { c.held.data.push(d); c.held.bytes += d.length } else c.send({ t: "data", d })
    }
    this.flushed = performance.now()
    this.hold()
  }

  hold() {
    const full = this.queued.length + this.term.inflight > HOLD || [...this.attached].some((c) => c.backlog() + (c.held?.bytes ?? 0) > HOLD)
    if (full === this.held) return
    this.held = full
    try { if (full) this.driver.pause(); else this.driver.resume() } catch { /* ended */ }
  }

  status(said: Said) {
    this.said = said
    this.told ??= setTimeout(() => {
      this.told = undefined
      if (this.h.sessions.get(this.id) === this && !this.spare) this.h.emit({ type: "status", id: this.id, said: this.said })
    }, 50)
  }

  ended(exit: Omit<Exit, "at">) {
    if (this.exit || this.ending) return
    this.ending = true
    this.flush()
    this.exit = { ...exit, at: Date.now() }
    clearTimeout(this.told)
    for (const c of this.attached) { c.send({ t: "exit", code: exit.code, signal: exit.signal, ...(exit.lost ? { lost: true } : {}) }); c.session = null }
    this.attached.clear()
    if (this.h.sessions.get(this.id) === this) this.h.sessions.delete(this.id)
    this.h.log("exited", this.id, JSON.stringify(exit))
    if (this.spare) this.term.dispose()
    else this.h.keepEnded(this, this.h.emit({ type: "exited", id: this.id, exit: this.exit }) > 0)
    this.h.changed?.()
  }

  capture(format: CaptureFormat, lines: number | null): Promise<Capture> {
    this.flush()
    return this.term.capture(format, lines)
  }

  snapshot(c: Conn, re: unknown) {
    this.flush()
    c.held ??= { data: [], bytes: 0, snapshots: 0 }
    c.held.snapshots++
    const done = (data: string) => {
      c.send({ re, data })
      const h = c.held
      if (h && --h.snapshots <= 0) { c.held = undefined; for (const d of h.data) c.send({ t: "data", d }) }
      this.hold()
    }
    this.term.snapshot().then(done, (e: Error) => { this.h.log("snapshot", this.id, "failed:", e.message); done("") })
  }
}

export type HostOptions = {
  log: (...a: unknown[]) => void
  pid: number; file: string
  stale?: () => boolean; retire?: () => boolean
  changed?: () => void
}

export type Host = ReturnType<typeof host>

export function host(o: HostOptions) {
  const sessions = new Map<string, Session>()
  const conns = new Set<Conn>()
  const endedOnes = new Map<string, { info: Info; session: Session | null; text: string; told: boolean; trimming?: boolean }>()
  const dropStatus = new WeakMap<Session, () => void>()
  const TRACE = !!process.env.VAULTITE_TRACE_7501

  function emit(ev: Event) {
    let n = 0
    for (const c of conns) if (c.events) { c.send({ t: "event", ...ev }); n++ }
    return n
  }

  function keepEnded(s: Session, told: boolean) {
    endedOnes.delete(s.id)
    endedOnes.set(s.id, { info: s.info(), session: s, text: "", told })
    trimEnded()
  }
  function trimEnded() {
    const now = Date.now(), whole = [...endedOnes.values()].filter((e) => e.session)
    for (const [i, e] of whole.entries()) {
      if (e.trimming || !(whole.length - i > ENDED_WHOLE_MAX || now - (e.info.exit?.at ?? 0) > ENDED_WHOLE)) continue
      e.trimming = true
      const term = e.session!.term
      const kept = (text: string) => { e.text = text; e.session = null; term.dispose() }
      term.text(200).then(kept, () => kept(""))
    }
    for (const [id, e] of endedOnes) if (endedOnes.size > ENDED_MAX || now - (e.info.exit?.at ?? 0) > ENDED_KEPT) endedOnes.delete(id); else break
  }

  function trouble(id: string, text: string) { emit({ type: "trouble", id, text }) }
  const around: Around = { emit, sessions, keepEnded, log: o.log, changed: () => o.changed?.(), trouble }

  function outOfPtys(id: string, e: unknown) {
    o.log("create", id, `failed: no pseudo-terminal left (this server holds ${sessions.size} terminals)`, e)
    return new Error(`the machine has no pseudo-terminal left (the terminal server holds ${sessions.size}): end some terminals or tmux sessions (${(e as Error).message})`)
  }

  function create(m: Record<string, unknown>) {
    const id = String(m.id ?? "")
    if (!id) throw new Error("no id")
    if (sessions.has(id)) throw new Error(`there's already a terminal '${id}'`)
    const cols = Number(m.cols) || 80, rows = Number(m.rows) || 24, cwd = String(m.cwd || os.homedir())
    const spawn = () => pty.spawn(String(m.file), (m.args as string[] | string) ?? [], { name: "xterm-256color", cols, rows, cwd, env: (m.env as Record<string, string>) ?? {} })
    let p: IPty
    try { p = spawn() } catch (e) {
      if (o.stale?.()) {
        o.log("create", id, "failed: this server's files are gone", e)
        if (o.retire?.()) throw new Error(`RETIRING: this terminal server's files are gone (${o.file}): ask the next one`)
        throw new Error(`this terminal server's files are gone (${o.file}), and it still holds terminals: ${(e as Error).message}`)
      }
      if (noPty(e)) throw outOfPtys(id, e)
      fixHelper()
      try { p = spawn() } catch (e2) { throw noPty(e2) ? outOfPtys(id, e2) : e2 }
    }
    const shell = String(m.shell || path.basename(String(m.file)))
    const driver: Driver = {
      pid: p.pid,
      write: (d) => { try { p.write(d) } catch { /* ended */ } },
      resize: (c, r) => { try { p.resize(c, r) } catch { /* ended */ } },
      kill: (signal) => { const fg = signal ? 0 : foreground(p.pid); hangup(p, signal ?? "SIGHUP"); if (fg) reap(fg) },
      pause: () => p.pause(),
      resume: () => p.resume(),
      // node-pty names it by its path on Linux (/proc), by its name on a Mac, and can't tell on Windows.
      process: () => (WIN ? shell : path.basename(p.process)),
    }
    const s = new Session(around, { id, driver, shell, cwd, command: String(m.command ?? "").slice(0, 500), cols, rows, scrollback: Number(m.scrollback) || SCROLLBACK,
      spare: !!m.spare, meta: metaOf(m.meta) })
    // Claude Code takes a primary DA answer before the probe's as "OSC 7501 isn't spoken here", and the screen or a
    // page answers DA later: the probe is answered as it's read.
    const st = watcher(() => {
      if (TRACE) o.log("7501", s.id, "probe answered")
      try { p.write(REPLY) } catch { /* ended */ }
    })
    p.onData((raw) => {
      if (TRACE && raw.includes("\x1b]7501;")) for (const x of raw.matchAll(/\x1b\]7501;([^\x07\x1b]*)/g)) o.log("7501", s.id, JSON.stringify(x[1]))
      const { out, changed } = st.feed(raw)
      if (changed) s.status(st.records.said())
      if (out) s.output(out)
    })
    dropStatus.set(s, () => { if (st.records.drop()) s.status(st.records.said()) })
    p.onExit(({ exitCode, signal }) => s.ended({ code: exitCode, signal: signal ?? 0 }))
    sessions.set(id, s)
    endedOnes.delete(id)
    o.log("create", id, s.spare ? "(spare)" : "", p.pid)
    if (!s.spare) emit({ type: "started", id, info: s.info() })
    return s
  }

  const adopt = adopter({ around, sessions, dropStatus })

  function handle(c: Conn, m: Record<string, unknown>): Record<string, unknown> | null | undefined {
    const live = (id: unknown) => {
      const s = sessions.get(String(id ?? ""))
      if (!s) throw new Error(`there's no terminal '${id}'`)
      return s
    }
    switch (m.op) {
      case "hello": return { v: PROTOCOL, pid: o.pid, file: o.file, stale: !!o.stale?.(), pictures: true } satisfies Answer<"hello">
      case "subscribe": {
        c.events = true
        for (const e of endedOnes.values()) if (!e.told && e.info.exit) { e.told = true; c.send({ t: "event", type: "exited", id: e.info.id, exit: e.info.exit }) }
        return {}
      }
      case "status-drop": { dropStatus.get(live(m.id))?.(); return {} }
      // macOS grants folder access per app that started the process, and its prompt blocks the call meanwhile.
      case "access":
        fs.promises.readdir(String(m.path)).then(() => c.send({ re: m.re, ok: true }), (e: NodeJS.ErrnoException) => c.send({ re: m.re, ok: false, code: e.code ?? "" }))
        return null
      case "create": return { info: create(m).info() } satisfies Answer<"create">
      case "rename": {
        const s = live(m.id), to = String(m.to ?? "")
        if (!to || sessions.has(to)) throw new Error(`can't rename to '${to}'`)
        const was = s.id, spare = s.spare
        sessions.delete(s.id); s.id = to; s.spare = false; sessions.set(to, s)
        s.meta = { ...s.meta, ...metaOf(m.meta) }
        if (typeof m.command === "string") s.command = m.command.slice(0, 500)
        emit(spare ? { type: "started", id: to, info: s.info() } : { type: "renamed", id: was, to })
        return { info: s.info() }
      }
      case "set": {
        const s = live(m.id), patch = (m.meta && typeof m.meta === "object" ? m.meta : {}) as Record<string, unknown>
        const next = { ...s.meta }
        for (const [k, v] of Object.entries(patch)) if (v === null || v === "") delete next[k]
        Object.assign(next, metaOf(patch))
        if (JSON.stringify(next) !== JSON.stringify(s.meta)) { s.meta = next; emit({ type: "meta", id: s.id, meta: next }) }
        return { info: s.info() }
      }
      case "kill": { live(m.id).driver.kill(typeof m.signal === "string" ? m.signal : undefined); return {} }
      case "list": trimEnded(); return {
        sessions: [...sessions.values()].map((s) => s.info()),
        ...(m.ended ? { ended: [...endedOnes.values()].map((e) => e.info) } : {}),
      } satisfies Answer<"list">
      case "get": {
        const id = String(m.id ?? ""), s = sessions.get(id), e = endedOnes.get(id)
        if (!s && !e) throw new Error(`there's no terminal '${id}'`)
        return { info: s ? s.info() : e!.info } satisfies Answer<"get">
      }
      case "capture": {
        const id = String(m.id ?? ""), format: CaptureFormat = m.format === "vt" || m.format === "html" ? m.format : "text"
        const e = endedOnes.get(id), s = sessions.get(id) ?? e?.session
        if (!s) {
          if (!e) throw new Error(`there's no terminal '${id}'`)
          if (format !== "text") throw new Error(`terminal '${id}' ended a while ago: only its last lines are kept, as text`)
          const n = lineCount(m.lines ?? e.info.rows, 200)
          return { text: n === null ? e.text : e.text.split("\n").slice(-n).join("\n"), cols: e.info.cols, rows: e.info.rows, cursor: { x: 0, y: 0 }, alternate: false, ended: true } satisfies Answer<"capture">
        }
        const n = lineCount(m.lines ?? s.term.rows, s.term.scrollback + s.term.rows)
        s.capture(format, n).then((r) => c.send({ re: m.re, ...r, ...(s.exit ? { ended: true } : {}) }), (e: Error) => c.send({ re: m.re, error: `its screen couldn't be read: ${e.message}` }))
        return null
      }
      case "forget": endedOnes.delete(String(m.id ?? "")); return {}
      case "attach": {
        const s = live(m.id)
        if (c.session) { c.session.attached.delete(c); emit({ type: "clients", id: c.session.id, clients: c.session.attached.size }) }
        c.session = s; c.ready = false
        s.attached.add(c)
        emit({ type: "clients", id: s.id, clients: s.attached.size })
        c.ready = true
        return { cols: s.term.cols, rows: s.term.rows } satisfies Answer<"attach">
      }
      case "snapshot": {
        const s = c.session
        if (!s) throw new Error("not attached")
        s.snapshot(c, m.re)
        return null
      }
      case "input": {
        const s = m.id !== undefined ? live(m.id) : c.session
        if (!s) return undefined
        s.activity = Date.now(); s.typed = performance.now()
        const text = Buffer.from(String(m.b64 ?? ""), "base64")
        s.driver.write(m.paste && s.term.mode(2004) ? `\x1b[200~${text.toString("utf8")}\x1b[201~` : text)
        return m.re !== undefined ? {} : undefined
      }
      case "keys": {
        const s = live(m.id)
        s.activity = Date.now(); s.typed = performance.now()
        s.driver.write(keysBytes(Array.isArray(m.keys) ? m.keys.map(String) : [], { appCursor: s.term.mode(1) }))
        return {}
      }
      case "resize": {
        const s = c.session
        if (!s) return undefined
        const cols = Math.max(2, Math.min(1000, Number(m.cols) || 80)), rows = Math.max(1, Math.min(500, Number(m.rows) || 24))
        const px = (v: unknown, d: number) => Math.max(1, Math.min(200, Math.round(Number(v)) || d))
        const cw = px(m.cw, s.cell.width), ch = px(m.ch, s.cell.height)
        if (cw !== s.cell.width || ch !== s.cell.height) { s.cell = { width: cw, height: ch }; s.term.resize(s.term.cols, s.term.rows, cw, ch) }
        if (cols === s.term.cols && rows === s.term.rows) return undefined
        s.driver.resize(cols, rows)
        s.term.resize(cols, rows, cw, ch)
        for (const x of s.attached) if (x !== c) x.send({ t: "size", cols, rows })
        emit({ type: "size", id: s.id, cols, rows })
        return undefined
      }
      case "adopt":
        adopt(String(m.socket ?? ""), Number(m.scrollback) || SCROLLBACK).then((ids) => c.send({ re: m.re, adopted: ids }), (e) => c.send({ re: m.re, error: (e as Error).message }))
        return null
      default: throw new Error(`unknown op '${m.op}'`)
    }
  }

  function connect(c: Conn) {
    conns.add(c)
    return {
      take(m: Record<string, unknown>) {
        try {
          const out = handle(c, m)
          if (m.re !== undefined && out) c.send({ re: m.re, ...out })
        } catch (e) {
          if (m.re !== undefined) c.send({ re: m.re, error: (e as Error).message })
        }
      },
      drained() { c.session?.hold() },
      gone() {
        if (!conns.delete(c)) return
        const s = c.session
        if (s) { s.attached.delete(c); s.hold(); emit({ type: "clients", id: s.id, clients: s.attached.size }) }
        c.session = null
      },
    }
  }

  return {
    sessions, connect, trimEnded, trouble,
    get connections() { return conns.size },
    killAll() { for (const s of sessions.values()) s.driver.kill() },
  }
}
