import { eventsOf } from "./events.ts"
import { OpError } from "./ops.ts"
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import type { WebSocket } from "ws"
import type { Vault } from "./vault.ts"
import { type TreeWatcher, watchTree } from "./treewatch.ts"
import { keptOf } from "./kept.ts"
import { logger } from "./log.ts"
import { codeOf, isObj, isText, messageOf } from "./values.ts"

const log = logger("live")

const QUIET = 20, GAP = 100, PING = 25_000, RECENT = 500, UI_ANSWER_MS = 3000, ASK_MS = 10_000
/** Seconds each ask may wait for its window's answer. */
const ASKS = new Map([["commands", 120], ["dev", 120], ["choose", 600], ["secret", 600], ["tabs", 30], ["setting", 30]])
const isAsk = (action: string) => ASKS.has(action) || /^[a-z0-9-]+:[a-z0-9-]+$/.test(action)
type Answer = { ran?: boolean; result?: unknown; error?: unknown; notices?: unknown[] }

export function ignored(rel: string) {
  const parts = rel.split("/"), name = parts[parts.length - 1]
  return parts.includes(".git") || name === ".DS_Store" || name.endsWith(".icloud") || name.includes(".tmp-") ||
    rel === ".vaultite/artifacts" || rel.startsWith(".vaultite/artifacts/")
}

/** Linux leaves these unwatched: each folder is an inotify watch there. */
const isFolder = (abs: string) => { try { return fs.statSync(abs).isDirectory() } catch { return false } }
const unwatched = (rel: string) => ignored(rel) || rel.split("/").includes("node_modules")

export type Change = { paths: string[] | null; v: string }
/** A device with app windows open on this server: how many, and when one was last used (ms). */
export type Present = { id: string; windows: number; at: number }

export class Live {
  /** null in development. */
  static web: () => string | null = () => null
  private static open = new Set<Live>()
  static newWeb() {
    const web = Live.web()
    if (web) for (const l of Live.open) l.send({ type: "web", web })
  }
  vault: Vault
  boot = Date.now().toString(36)
  private listeners = new Set<(c: Change) => void>()
  private clients = new Set<WebSocket>()
  private active = new Map<WebSocket, number>()
  private workspaces = new Map<WebSocket, number>()
  private devices = new Map<WebSocket, { id: string; since: number }>()
  private answers = new Map<string, (a: Answer) => void>()
  private answering = new WeakSet<WebSocket>() // windows that answer (an older app doesn't)
  private asked = new Map<string, WebSocket>()
  private keyed = new Map<string, () => void>()
  private pending = new Set<string>()
  private all = false
  private timer: ReturnType<typeof setTimeout> | null = null
  private watcher: fs.FSWatcher | TreeWatcher | null = null
  private pinger: ReturnType<typeof setInterval> | null = null
  private closed = false
  private sent = ""
  private told: Set<string> | null = new Set() // null: all of them
  private recent: (string[] | null)[] = []
  private dropped = 0

  private unmove: () => void
  private unarrive: () => void
  private unwrote: () => void
  private unkept: () => void
  private keptNames = new Set<string>()
  private keptTimer: ReturnType<typeof setTimeout> | null = null

  constructor(vault: Vault) {
    this.vault = vault
    Live.open.add(this)
    this.unkept = keptOf(vault.path).onChange((names) => {
      for (const n of names) this.keptNames.add(n)
      this.keptTimer ??= setTimeout(() => this.tellKept(), QUIET)
    })
    this.unmove = vault.onMove((from, to) => this.send({ type: "moved", from, to })) // (to null: trashed)
    this.unarrive = vault.onArrive((rel) => this.add(rel)) // (iCloud gave it: the watcher may not say)
    this.unwrote = vault.onWrote((rel) => this.add(rel)) // (the server's own writes: FSEvents may tell of them seconds later)
  }

  get v() {
    return `${this.boot}:${this.vault.version}`
  }

  /** Watches the real folder: the vault path may be a symlink. */
  start() {
    if (this.closed) return this
    try {
      const root = fs.realpathSync(this.vault.path)
      this.watcher = process.platform === "linux"
        ? watchTree(root, unwatched, (rel) => this.add(rel))
        : fs.watch(root, { recursive: true }, (event, name) => {
          const rel = name === null || name === undefined ? null : String(name).split(path.sep).join("/")
          // (Windows tells of a folder's "change" when a file in it changes, that file told too: a walk for nothing)
          if (process.platform === "win32" && event === "change" && rel && isFolder(path.join(root, rel))) return
          this.add(rel)
        })
      this.watcher.on("error", (e) => this.restart(e))
      // (inotify, folder by folder, hears each change as it's made; FSEvents tells of them a while later)
      this.vault.watching(true, process.platform === "linux" ? () => this.flushing || (this.timer !== null && (this.all || !this.vault.told(this.pending))) : undefined)
    } catch (e) {
      this.restart(e)
    }
    this.pinger ??= setInterval(() => this.send({ type: "ping" }), PING)
    return this
  }

  private restart(e: unknown) {
    // Out of inotify watches (Linux): said once, how to have more, then tried again now and then, not every 5 s.
    const full = codeOf(e) === "ENOSPC"
    if (!full || !this.full) log.error(`watching the vault failed (${messageOf(e)}); trying again in ${full ? "a minute" : "5 s"}` +
      (full ? ". Linux ran out of inotify watches: raise them with `sudo sysctl fs.inotify.max_user_watches=524288` (and in /etc/sysctl.d/)" : ""))
    this.full ||= full
    if (this.watcher) { this.watcher.close(); this.vault.watching(false) }
    this.watcher = null
    if (!this.closed) setTimeout(() => this.start(), full ? 60_000 : 5000).unref()
  }
  private full = false
  private rootName = "" // the vault's real folder's name, as FSEvents names the folder itself

  /** null when the watcher couldn't say which. */
  add(rel: string | null) {
    if (rel === null) this.all = true
    else if (!ignored(rel)) this.pending.add(rel)
    else return
    this.soon()
  }

  private soon() {
    if (this.timer || this.flushing || this.closed) return
    this.timer = setTimeout(() => this.flush(), Math.max(QUIET, this.went + GAP - Date.now()))
  }
  private went = 0

  private again: ReturnType<typeof setTimeout> | null = null

  /** Without the folders FSEvents tells of beside what changed in them (iCloud touches each one above a write) and the
   *  vault's own: for `.vaultite`, every window read every live card and setting again. A folder told alone stays. */
  private narrow(paths: string[]) {
    let root = this.rootName
    if (!root) try { root = this.rootName = path.basename(fs.realpathSync(this.vault.path)) } catch { /* gone: nothing is its */ }
    return paths.filter((p) => {
      if (p === "" || (p === root && !fs.existsSync(path.join(this.vault.path, p)))) return false
      if (!paths.some((q) => q.startsWith(p + "/"))) return true
      try { return !fs.statSync(path.join(this.vault.path, p)).isDirectory() } catch { return true }
    })
  }

  private flushing = false
  private async flush() {
    this.timer = null
    this.went = Date.now()
    const paths = this.all ? null : this.narrow([...this.pending]).sort()
    this.pending.clear()
    this.all = false
    this.flushing = true
    try {
      await this.vault.hear(paths)
    } catch (e) {
      log.error("hearing the vault's changes failed", e)
    } finally {
      this.flushing = false
    }
    if (this.pending.size || this.all) this.soon()
    if (this.vault.waiting()) this.recheck()
    // FSEvents can report one write twice: Markdown files already indexed and told of, with the index unchanged since,
    // are nothing new. (Anything else can't be told apart this way, so it goes out.)
    if (paths && this.v === this.sent && paths.every((p) => this.vault.entries.has(p) && (!this.told || this.told.has(p)))) return
    this.emit(paths)
  }

  private recheck(delay = 1000) {
    if (this.again || this.closed) return
    this.again = setTimeout(async () => {
      this.again = null
      try { await this.vault.lock(() => this.vault.sync()) } catch (e) { log.error("syncing the vault failed", e) }
      if (this.v !== this.sent) this.emit(null)
      if (this.vault.waiting()) this.recheck(delay < 4000 ? delay + 1000 : Math.min(delay * 2, 60000))
    }, delay)
    this.again.unref?.()
  }

  private emit(paths: string[] | null) {
    if (this.v !== this.sent) { this.sent = this.v; this.told = new Set() }
    if (!paths) this.told = null
    else for (const p of paths) this.told?.add(p)
    const change = { paths, v: this.v }
    for (const fn of this.listeners) fn(change)
    this.recent.push(paths)
    if (this.recent.length > RECENT) { this.recent.shift(); this.dropped++ }
    this.send({ type: "change", ...change, at: this.at })
    eventsOf(this.vault).emit("file.changed", { paths })
  }

  listen(fn: (c: Change) => void) {
    this.listeners.add(fn)
    return () => { this.listeners.delete(fn) }
  }

  client(ws: WebSocket, at?: string, device?: string) {
    this.clients.add(ws)
    if (device && /^[a-z0-9]{8,32}$/.test(device)) this.devices.set(ws, { id: device, since: Date.now() })
    const drop = () => {
      this.clients.delete(ws); this.active.delete(ws); this.workspaces.delete(ws); this.devices.delete(ws)
      for (const [rid, to] of this.asked) if (to === ws) this.answers.get(rid)?.({ error: "the app window closed before answering" })
    }
    ws.on("close", drop)
    ws.on("error", drop)
    ws.on("message", (data) => {
      try {
        const m = JSON.parse(String(data))
        if (m.type === "active") {
          this.active.set(ws, Date.now())
          if (m.answers) this.answering.add(ws)
          if (Number.isInteger(m.workspace) && m.workspace >= 1 && m.workspace <= 9) this.workspaces.set(ws, m.workspace); else this.workspaces.delete(ws)
        } else if (m.type === "caps" && m.answers) this.answering.add(ws)
        else if (m.type === "ui-done" && typeof m.rid === "string") this.answers.get(m.rid)?.(m)
      } catch { /* not ours */ }
    })
    const missed = at === undefined ? undefined : this.since(at)
    ws.send(JSON.stringify({ type: "hello", v: this.v, web: Live.web() ?? undefined, ...this.mark(), ...(missed !== undefined ? { paths: missed } : {}) }))
  }

  mark() {
    return { at: this.at, ...this.keptMark() }
  }

  private keptMark() {
    const k = keptOf(this.vault.path)
    return { kept: `${k.id}:${k.seq}`, state: k.stateVersion }
  }

  private tellKept() {
    this.keptTimer = null
    const names = [...this.keptNames].sort()
    this.keptNames.clear()
    if (names.length) this.send({ type: "kept", names, ...this.keptMark() })
  }

  get at() {
    return `${this.boot}:${this.dropped + this.recent.length}`
  }

  /** null: anything may have, as when `at` is from before this server or too long ago. */
  private since(at: string): string[] | null {
    const [boot, n] = at.split(":"), from = Number(n) - this.dropped
    if (boot !== this.boot || !Number.isInteger(from) || from < 0 || from > this.recent.length) return null
    const out = new Set<string>()
    for (const paths of this.recent.slice(from)) {
      if (!paths) return null
      for (const p of paths) out.add(p)
    }
    return out.size > 500 ? null : [...out].sort()
  }

  private send(msg: object) {
    const text = JSON.stringify(msg)
    for (const ws of this.clients) if (ws.readyState === ws.OPEN) ws.send(text)
  }

  get windows() {
    return [...this.clients].filter((ws) => ws.readyState === ws.OPEN).length
  }

  present(): Present[] {
    const out = new Map<string, Present>()
    for (const [ws, d] of this.devices) {
      if (ws.readyState !== ws.OPEN) continue
      const at = Math.max(d.since, this.active.get(ws) ?? 0), had = out.get(d.id)
      out.set(d.id, { id: d.id, windows: (had?.windows ?? 0) + 1, at: Math.max(at, had?.at ?? 0) })
    }
    return [...out.values()]
  }

  tell(device: string, msg: object) {
    let n = 0
    for (const [ws, d] of this.devices) if (d.id === device && ws.readyState === ws.OPEN) { ws.send(JSON.stringify({ ...msg, type: "ui" })); n++ }
    return n
  }

  private last() {
    const open = [...this.clients].filter((ws) => ws.readyState === ws.OPEN)
    if (!open.length) return null
    const at = (ws: WebSocket) => this.active.get(ws) ?? -1
    return open.reduce((best, ws) => (at(ws) >= at(best) ? ws : best))
  }

  /** null: no window, or it has no workspaces. */
  get workspace() {
    const ws = this.last()
    return (ws && this.workspaces.get(ws)) ?? null
  }

  ui(msg: object) {
    const to = this.last()
    if (!to) return false
    to.send(JSON.stringify({ ...msg, type: "ui" }))
    return true
  }

  /** A null message is a GET: the windows open. */
  drive = async (message: Record<string, unknown> | null): Promise<unknown> => {
    if (message && isAsk(String(message.action))) return this.ask(message)
    if (message?.action === "ask-cancel") { this.keyed.get(String(message.key))?.(); return { ok: true } }
    // An older app never says whether it could run a command.
    const to = this.last()
    const rid = (message?.action === "command" || message?.action === "open") && to && this.answering.has(to) ? crypto.randomUUID() : null
    const ran = rid ? new Promise<Answer | null>((done) => { this.answers.set(rid, (a) => done(a)); setTimeout(() => done(null), UI_ANSWER_MS) }) : null
    try {
      const [out, status] = this.handle(message ? "POST" : "GET", rid ? { ...message, rid } : message)
      if (status >= 400) throw new OpError(String(out.error ?? status), status)
      const a = ran ? await ran : null
      if (a && a.ran === false && typeof a.error === "string") throw new OpError(a.error, 422)
      if (a && a.ran === false && message!.action === "command") throw new OpError(`the command ${String(message!.id)} isn't available in the user's window right now (it may need a note open there): nothing ran`, 422)
      if (!a) return out
      const notices = Array.isArray(a.notices) ? a.notices.slice(-5).flatMap((x) => (isObj(x) && isText(x.text) ? [{ text: x.text.slice(0, 300), ...(x.kind === "error" ? { kind: "error" } : {}) }] : [])) : []
      return { ...out, ran: true, ...(notices.length ? { notices } : {}) }
    } finally {
      if (rid) this.answers.delete(rid)
    }
  }

  /** `timeout` in seconds. OpError 409: no window that answers, 504: none came, 422: the window's error. */
  private async ask(message: Record<string, unknown>): Promise<unknown> {
    const to = this.last()
    if (!to) throw new OpError("no app window is open on this server", 409)
    if (!this.answering.has(to)) throw new OpError("the app window open is an older version that can't answer: reload it", 409)
    const most = ASKS.get(String(message.action)) ?? 120
    const ms = typeof message.timeout === "number" && message.timeout > 0 ? Math.min(message.timeout, most) * 1000 : ASK_MS
    const rid = crypto.randomUUID(), key = typeof message.key === "string" ? message.key : null
    let timer: ReturnType<typeof setTimeout> | undefined, got: Answer | null | undefined
    try {
      got = await new Promise<Answer | null | undefined>((done) => {
        this.answers.set(rid, done)
        this.asked.set(rid, to)
        if (key) this.keyed.set(key, () => done(undefined))
        timer = setTimeout(() => done(null), ms)
        to.send(JSON.stringify({ ...message, type: "ui", rid }))
      })
      if (got === undefined) return null
      if (!got) throw new OpError(`the app window didn't answer within ${ms / 1000} s`, 504)
      if (got.error !== undefined && got.error !== null) throw new OpError(String(got.error), 422)
      return got.result ?? null
    } finally {
      clearTimeout(timer)
      this.answers.delete(rid)
      this.asked.delete(rid)
      if (key) this.keyed.delete(key)
      if (!got && to.readyState === to.OPEN) to.send(JSON.stringify({ type: "ui", action: "ask-end", rid }))
    }
  }

  handle(method: string, body: unknown): [Record<string, unknown>, number] {
    if (method === "GET") return [{ windows: this.windows, workspace: this.workspace }, 200]
    if (method !== "POST") return [{ error: "not found" }, 404]
    const b = isObj(body) ? body : {}
    let msg: Record<string, unknown>
    if (b.action === "open" && typeof b.path === "string" && b.path.trim()) {
      if (b.split != null && b.split !== "right" && b.split !== "down") return [{ error: "split is right or down" }, 400]
      for (const k of ["container", "in"]) { const v = b[k]; if (v != null && (!isText(v) || !v.trim())) return [{ error: `${k} is a name (a string)` }, 400] }
      msg = { action: "open", path: b.path.trim(), split: b.split ?? null, newTab: !!b.newTab, ...(b.background ? { background: true } : {}),
        ...(isText(b.container) ? { container: b.container.trim() } : {}), ...(isText(b.in) ? { in: b.in.trim() } : {}), ...(typeof b.rid === "string" ? { rid: b.rid } : {}) }
    } else if (b.action === "command" && typeof b.id === "string" && b.id) msg = { action: "command", id: b.id, ...(typeof b.rid === "string" ? { rid: b.rid } : {}) }
    else if (b.action === "notify") {
      const text = typeof b.text === "string" ? b.text.trim() : ""
      if (!text) return [{ error: "notify needs a text" }, 400]
      if (b.kind != null && b.kind !== "error") return [{ error: "kind is error, or left out" }, 400]
      const btn = b.button ?? null
      if (btn !== null && (!isObj(btn) || !isText(btn.open) || !btn.open.trim())) {
        return [{ error: "button is {label, open: <vault path>}" }, 400]
      }
      msg = { action: "notify", text: text.slice(0, 500), kind: b.kind ?? null,
        button: isObj(btn) && isText(btn.open) ? { label: isText(btn.label) && btn.label.trim() ? btn.label.trim().slice(0, 40) : "Open", open: btn.open.trim() } : null }
    } else return [{ error: "action is open (with a path), command (with an id) or notify (with a text)" }, 400]
    if (!this.ui(msg)) return [{ error: "no app window is open on this server" }, 409]
    return [{ ok: true, windows: this.windows }, 200]
  }

  close() {
    this.closed = true
    Live.open.delete(this)
    this.unmove()
    this.unarrive()
    this.unwrote()
    this.unkept()
    if (this.keptTimer) clearTimeout(this.keptTimer)
    if (this.watcher) { this.watcher.close(); this.vault.watching(false) }
    if (this.timer) clearTimeout(this.timer)
    if (this.again) clearTimeout(this.again)
    if (this.pinger) clearInterval(this.pinger)
    for (const ws of this.clients) ws.close()
  }
}
