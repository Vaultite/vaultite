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

const QUIET = 100, MAX = 500, PING = 25_000, UI_ANSWER_MS = 3000, ASK_MS = 10_000
/** What a window answers with a result (drive's asks): its palette's commands, the dev tools (core/coreops/dev.ts), the
 *  user's pick from a list (ui.choose), a secret they type (secret.ask). Never through POST /api/ui (`handle`): only ops
 *  reach them, and the dev ones are the owner's. Seconds an ask may wait at most: a person gets longer than a window. */
const ASKS = new Map([["commands", 120], ["dev", 120], ["choose", 600], ["secret", 600]])
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

export class Live {
  /** The web app's build being served (server.ts sets it; null in development). */
  static web: () => string | null = () => null
  vault: Vault
  boot = Date.now().toString(36)
  private listeners = new Set<(c: Change) => void>()
  private clients = new Set<WebSocket>()
  private active = new Map<WebSocket, number>() // when each window last said it had the focus (this server's clock)
  private workspaces = new Map<WebSocket, number>() // the workspace each window said it's on
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
    this.watcher?.close()
    this.watcher = null
    if (!this.closed) setTimeout(() => this.start(), full ? 60_000 : 5000).unref()
  }
  private full = false

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

  private async flush() {
    this.timer = null
    const paths = this.all ? null : [...this.pending].sort()
    this.pending.clear()
    this.all = false
    try {
      await this.vault.synced()
    } catch (e) {
      console.error(e)
    }
    // A folder gone from disk is only let go of a few seconds later (Vault.sync): look again then.
    if (this.vault.waiting()) this.recheck()
    // FSEvents can report one write twice: Markdown files already indexed, with the index unchanged since the last
    // event, are nothing new. (Anything else can't be told apart this way, so it goes out.)
    if (paths && this.v === this.sent && paths.every((p) => this.vault.entries.has(p))) return
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
    this.sent = this.v
    const change = { paths, v: this.v }
    for (const fn of this.listeners) fn(change)
    this.send({ type: "change", ...change })
    eventsOf(this.vault).emit("file.changed", { paths })
  }

  /** Hear about changes (the tests do; the web app listens through a socket). */
  listen(fn: (c: Change) => void) {
    this.listeners.add(fn)
    return () => { this.listeners.delete(fn) }
  }

  /** A web app connected to /api/events. */
  client(ws: WebSocket) {
    this.clients.add(ws)
    const drop = () => {
      this.clients.delete(ws); this.active.delete(ws); this.workspaces.delete(ws)
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
    ws.send(JSON.stringify({ type: "hello", v: this.v, web: Live.web() ?? undefined }))
  }

  private send(msg: object) {
    const text = JSON.stringify(msg)
    for (const ws of this.clients) if (ws.readyState === ws.OPEN) ws.send(text)
  }

  /** How many app windows are connected. */
  get windows() {
    return [...this.clients].filter((ws) => ws.readyState === ws.OPEN).length
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
   *  window focused last acts. */
  handle(method: string, body: unknown): [unknown, number] {
    if (method === "GET") return [{ windows: this.windows, workspace: this.workspace }, 200]
    if (method !== "POST") return [{ error: "not found" }, 404]
    const b = (body ?? {}) as Record<string, unknown>
    let msg: Record<string, unknown>
    if (b.action === "open" && typeof b.path === "string" && b.path.trim()) {
      if (b.split != null && b.split !== "right" && b.split !== "down") return [{ error: "split is right or down" }, 400]
      msg = { action: "open", path: b.path.trim(), split: b.split ?? null, newTab: !!b.newTab }
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
    this.watcher?.close()
    if (this.timer) clearTimeout(this.timer)
    if (this.again) clearTimeout(this.again)
    if (this.pinger) clearInterval(this.pinger)
    for (const ws of this.clients) ws.close()
  }
}
