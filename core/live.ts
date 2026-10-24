// Live updates: the vault is watched and every change, whoever made it, is synced and told to each open app over one
// WebSocket (/api/events: hello, change, moved, ping, ui). Bursts coalesce; `ui` messages go to the window focused last.
import { eventsOf } from "./events.ts"
import { OpError } from "./ops.ts"
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import type { WebSocket } from "ws"
import type { Vault } from "./vault.ts"
import { type TreeWatcher, watchTree } from "./treewatch.ts"

const QUIET = 100, MAX = 500, PING = 25_000, RECENT = 500, UI_ANSWER_MS = 3000, ASK_MS = 10_000
/** What a window answers (drive's asks: palette commands, dev tools, ui.choose, secret.ask), only through ops, never
 *  POST /api/ui: the dev ones are the owner's. Seconds an ask may wait: a person gets longer than a window. */
const ASKS = new Map([["commands", 120], ["dev", 120], ["choose", 600], ["secret", 600], ["tabs", 30], ["archived-tabs", 30]])
type Answer = { ran?: boolean; result?: unknown; error?: unknown }

/** Changes nobody needs to hear about. */
export function ignored(rel: string) {
  const parts = rel.split("/"), name = parts[parts.length - 1]
  return parts.includes(".git") || name === ".DS_Store" || name.endsWith(".icloud") || name.includes(".tmp-") ||
    rel === ".vaultite/artifacts" || rel.startsWith(".vaultite/artifacts/")
}

/** Folders Linux's watcher leaves out (each folder is an inotify watch there): changes in them are ignored anyway. */
const unwatched = (rel: string) => ignored(rel) || rel.split("/").includes("node_modules")

export type Change = { paths: string[] | null; v: string }
/** A device with app windows open on this server: how many, and when one was last used (ms). */
export type Present = { id: string; windows: number; at: number }

export class Live {
  /** The web app's build being served (server.ts sets it; null in development). */
  static web: () => string | null = () => null
  vault: Vault
  boot = Date.now().toString(36)
  private listeners = new Set<(c: Change) => void>()
  private clients = new Set<WebSocket>()
  private active = new Map<WebSocket, number>() // when each window last said it had the focus (this server's clock)
  private workspaces = new Map<WebSocket, number>() // the workspace each window said it's on
  private devices = new Map<WebSocket, { id: string; since: number }>() // the device each window is (its app's id) and since when
  private answers = new Map<string, (a: Answer) => void>() // windows answering what they were sent (a command ran, an ask's result)
  private answering = new WeakSet<WebSocket>() // windows that answer (an older app doesn't)
  private asked = new Map<string, WebSocket>() // an ask's window, so its closing ends the wait
  private keyed = new Map<string, () => void>() // asks given a key, which "ask-cancel" ends (answered on another machine)
  private pending = new Set<string>()
  private all = false
  private first = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  private watcher: fs.FSWatcher | TreeWatcher | null = null
  private pinger: ReturnType<typeof setInterval> | null = null
  private closed = false
  private sent = "" // the v of the last event
  private told: Set<string> | null = new Set() // the paths told at that v (null: all of them)
  private recent: (string[] | null)[] = [] // the last changes told, for windows coming back (since)
  private dropped = 0 // how many were told before them

  private unmove: () => void
  private unarrive: () => void

  constructor(vault: Vault) {
    this.vault = vault
    this.unmove = vault.onMove((from, to) => this.send({ type: "moved", from, to })) // (to null: trashed)
    this.unarrive = vault.onArrive((rel) => this.add(rel)) // (iCloud gave it: the watcher may not say)
  }

  get v() {
    return `${this.boot}:${this.vault.version}`
  }

  /** Watch the vault (its real folder: the vault path may be a symlink). If the watch fails (the folder went away for
   *  a moment), it's tried again; meanwhile requests still sync as before, so nothing is lost but the push. */
  start() {
    if (this.closed) return this
    try {
      const root = fs.realpathSync(this.vault.path)
      this.watcher = process.platform === "linux"
        ? watchTree(root, unwatched, (rel) => this.add(rel))
        : fs.watch(root, { recursive: true }, (_event, name) => this.add(name === null || name === undefined ? null : String(name).split(path.sep).join("/")))
      this.watcher.on("error", (e) => this.restart(e))
      // (inotify, folder by folder, hears each change as it's made; FSEvents tells of them a while later)
      this.vault.watching(true, process.platform === "linux" ? () => this.timer !== null || this.flushing : undefined)
    } catch (e) {
      this.restart(e)
    }
    this.pinger ??= setInterval(() => this.send({ type: "ping" }), PING)
    return this
  }

  private restart(e: unknown) {
    // Out of inotify watches (Linux): said once, how to have more, then tried again now and then, not every 5 s.
    const full = (e as NodeJS.ErrnoException).code === "ENOSPC"
    if (!full || !this.full) console.error(`live: watching the vault failed (${(e as Error).message ?? e}); trying again in ${full ? "a minute" : "5 s"}` +
      (full ? ". Linux ran out of inotify watches: raise them with `sudo sysctl fs.inotify.max_user_watches=524288` (and in /etc/sysctl.d/)" : ""))
    this.full ||= full
    if (this.watcher) { this.watcher.close(); this.vault.watching(false) }
    this.watcher = null
    if (!this.closed) setTimeout(() => this.start(), full ? 60_000 : 5000).unref()
  }
  private full = false
  private rootName = "" // the vault's real folder's name, as FSEvents names the folder itself

  /** A changed path (vault-relative), or null when the watcher couldn't say which. */
  add(rel: string | null) {
    if (rel === null) this.all = true
    else if (!ignored(rel)) this.pending.add(rel)
    else return
    const now = Date.now()
    if (!this.timer) this.first = now
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => this.flush(), Math.max(0, Math.min(QUIET, this.first + MAX - now)))
  }

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
    const paths = this.all ? null : this.narrow([...this.pending]).sort()
    this.pending.clear()
    this.all = false
    // (the folders iCloud touched beside a write left out here too, or each of the server's own saves walks the vault)
    this.flushing = true
    try {
      await this.vault.hear(paths) // (notes edited on disk read again on their own, else a walk)
    } catch (e) {
      console.error(e)
    } finally {
      this.flushing = false
    }
    // A folder gone from disk is only let go of a few seconds later (Vault.sync): look again then.
    if (this.vault.waiting()) this.recheck()
    // FSEvents can report one write twice: Markdown files already indexed and told of, with the index unchanged since,
    // are nothing new. (Anything else can't be told apart this way, so it goes out.)
    if (paths && this.v === this.sent && paths.every((p) => this.vault.entries.has(p) && (!this.told || this.told.has(p)))) return
    this.emit(paths)
  }

  /** While the vault's folder is missing, sync again less and less often, and tell the apps only when the index changed
   *  (telling them every second made every open app reload everything). */
  private recheck(delay = 1000) {
    if (this.again || this.closed) return
    this.again = setTimeout(async () => {
      this.again = null
      try { await this.vault.lock(() => this.vault.sync()) } catch (e) { console.error(e) }
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

  /** Hear about changes (the tests do; the web app listens through a socket). */
  listen(fn: (c: Change) => void) {
    this.listeners.add(fn)
    return () => { this.listeners.delete(fn) }
  }

  /** A web app connected to /api/events; `at`, where its changes ended when it was here before; `device`, the id its
   *  app keeps for the device it's on (web/src/core/device.ts). */
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
    ws.send(JSON.stringify({ type: "hello", v: this.v, at: this.at, web: Live.web() ?? undefined, ...(missed !== undefined ? { paths: missed } : {}) }))
  }

  /** Where the changes told so far end ("<boot>:<n>"): a window back after a while says it, and hears only what changed
   *  since instead of reading everything again. */
  get at() {
    return `${this.boot}:${this.dropped + this.recent.length}`
  }

  /** The paths changed since `at` (null: anything may have, as when it's from before this server or too long ago). */
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

  /** How many app windows are connected. */
  get windows() {
    return [...this.clients].filter((ws) => ws.readyState === ws.OPEN).length
  }

  /** The devices with a window open here: how many, and when one was last used (connected, or focused since). */
  present(): Present[] {
    const out = new Map<string, Present>()
    for (const [ws, d] of this.devices) {
      if (ws.readyState !== ws.OPEN) continue
      const at = Math.max(d.since, this.active.get(ws) ?? 0), had = out.get(d.id)
      out.set(d.id, { id: d.id, windows: (had?.windows ?? 0) + 1, at: Math.max(at, had?.at ?? 0) })
    }
    return [...out.values()]
  }

  /** Something for every window of one device (close its tabs): how many windows it went to. */
  tell(device: string, msg: object) {
    let n = 0
    for (const [ws, d] of this.devices) if (d.id === device && ws.readyState === ws.OPEN) { ws.send(JSON.stringify({ ...msg, type: "ui" })); n++ }
    return n
  }

  /** The window focused last (else the one that connected last), or null when no app is open. */
  private last() {
    const open = [...this.clients].filter((ws) => ws.readyState === ws.OPEN)
    if (!open.length) return null
    const at = (ws: WebSocket) => this.active.get(ws) ?? -1
    return open.reduce((best, ws) => (at(ws) >= at(best) ? ws : best))
  }

  /** The workspace the window focused last is on (null: no window, or it has no workspaces). */
  get workspace() {
    const ws = this.last()
    return (ws && this.workspaces.get(ws)) ?? null
  }

  /** Something for the user's screen (open a file, run a command): sent to one window, the one focused last (else the
   *  one that connected last). False when no app is open. */
  ui(msg: object) {
    const to = this.last()
    if (!to) return false
    to.send(JSON.stringify({ ...msg, type: "ui" }))
    return true
  }

  /** What operations drive the window with (App.ui, core/ops.ts): POST's answer for a message (null: GET, the windows
   *  open), or an OpError with its status. */
  drive = async (message: Record<string, unknown> | null): Promise<unknown> => {
    if (message && ASKS.has(String(message.action))) return this.ask(message)
    if (message?.action === "ask-cancel") { this.keyed.get(String(message.key))?.(); return { ok: true } }
    // A command says whether the window could run it (one that needs an open note may not); an older app never says.
    const to = this.last()
    const rid = message?.action === "command" && to && this.answering.has(to) ? crypto.randomUUID() : null
    const ran = rid ? new Promise<boolean | null>((done) => { this.answers.set(rid, (a) => done(a.ran !== false)); setTimeout(() => done(null), UI_ANSWER_MS) }) : null
    try {
      const [out, status] = this.handle(message ? "POST" : "GET", rid ? { ...message, rid } : message)
      if (status >= 400) throw new OpError(String((out as { error?: unknown }).error ?? status), status)
      if (ran && (await ran) === false) throw new OpError(`the command ${String(message!.id)} isn't available in the user's window right now (it may need a note open there): nothing ran`, 422)
      return out
    } finally {
      if (rid) this.answers.delete(rid)
    }
  }

  /** Ask the window focused last for something and wait for its answer (`timeout`: seconds): the result, or an OpError
   *  (409: no window that answers, 504: none came, 422: the window's error). */
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
      // Not answered (its time is up, or answered elsewhere): the window closes what it shows.
      if (!got && to.readyState === to.OPEN) to.send(JSON.stringify({ type: "ui", action: "ask-end", rid }))
    }
  }

  /** /api/ui: GET the open windows and the focused one's workspace; POST {action: open | command | notify}. Only the
   *  window focused last acts. An open with `background` adds a tab behind the user's, as a browser's ⌘-click does. */
  handle(method: string, body: unknown): [unknown, number] {
    if (method === "GET") return [{ windows: this.windows, workspace: this.workspace }, 200]
    if (method !== "POST") return [{ error: "not found" }, 404]
    const b = (body ?? {}) as Record<string, unknown>
    let msg: Record<string, unknown>
    if (b.action === "open" && typeof b.path === "string" && b.path.trim()) {
      if (b.split != null && b.split !== "right" && b.split !== "down") return [{ error: "split is right or down" }, 400]
      msg = { action: "open", path: b.path.trim(), split: b.split ?? null, newTab: !!b.newTab, ...(b.background ? { background: true } : {}) }
    } else if (b.action === "command" && typeof b.id === "string" && b.id) msg = { action: "command", id: b.id, ...(typeof b.rid === "string" ? { rid: b.rid } : {}) }
    else if (b.action === "notify") {
      const text = typeof b.text === "string" ? b.text.trim() : ""
      if (!text) return [{ error: "notify needs a text" }, 400]
      if (b.kind != null && b.kind !== "error") return [{ error: "kind is error, or left out" }, 400]
      const btn = (b.button ?? null) as Record<string, unknown> | null
      if (btn !== null && (typeof btn !== "object" || typeof btn.open !== "string" || !btn.open.trim())) {
        return [{ error: "button is {label, open: <vault path>}" }, 400]
      }
      msg = { action: "notify", text: text.slice(0, 500), kind: b.kind ?? null,
        button: btn && { label: typeof btn.label === "string" && btn.label.trim() ? btn.label.trim().slice(0, 40) : "Open", open: (btn.open as string).trim() } }
    } else return [{ error: "action is open (with a path), command (with an id) or notify (with a text)" }, 400]
    if (!this.ui(msg)) return [{ error: "no app window is open on this server" }, 409]
    return [{ ok: true, windows: this.windows }, 200]
  }

  close() {
    this.closed = true
    this.unmove()
    this.unarrive()
    if (this.watcher) { this.watcher.close(); this.vault.watching(false) }
    if (this.timer) clearTimeout(this.timer)
    if (this.again) clearTimeout(this.again)
    if (this.pinger) clearInterval(this.pinger)
    for (const ws of this.clients) ws.close()
  }
}
