// Errors: a small error tracker of the app's and server's errors, grouped by kind, kept on this machine (a crash loop would
// churn iCloud) and never sent anywhere. The first time a kind happens, the user is told.
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { bullets, HTTPError, localDate, localTime, OpError, Plugin, section, type ServerError } from "../../../core/plugins.ts"
import type { ErrorDetail, ErrorEvent, ErrorGroup, ErrorList, Source } from "./model.ts"

export const plugin = new Plugin(import.meta.url)

const MINUTE = 60_000, HOUR = 3_600_000, DAY = 86_400_000
const BURST = 10_000 // the same error again within this long is counted on the next line written, not a line of its own
const RECENT = 30 // times kept in memory per kind (the rest are in the files)
const NOTIFY_GAP = 30_000 // at most one toast this often

// ---------- where it's kept

/** This vault's folder here: <LOCAL>/errors/<vault key>/. */
const dir = () => plugin.localDir()

const FILE = /^errors-(\d{4}-\d\d-\d\d)\.jsonl$/

function settings() {
  const s = plugin.loaded ? plugin.settings() : {}
  return { keep: Math.max(1, Number(s.keep_days) || 30), notify: s.notify !== false }
}

/** Written at once (synchronously): an error that ends the server has to be on disk before it does. */
function append(e: ErrorEvent) {
  try { fs.appendFileSync(path.join(dir(), `errors-${localDate(e.t)}.jsonl`), JSON.stringify(e) + "\n") } catch { /* its folder gone: nothing to keep */ }
}

function readFile(f: string): ErrorEvent[] {
  let text: string
  try { text = fs.readFileSync(path.join(dir(), f), "utf8") } catch { return [] }
  const out: ErrorEvent[] = []
  for (const line of text.split("\n")) { if (line) try { const e = JSON.parse(line); if (e && e.id && e.t) out.push(e) } catch { /* a torn line */ } }
  return out
}

/** Files older than keep_days go (at most once an hour). */
let pruned = 0
function prune() {
  if (Date.now() - pruned < HOUR) return
  pruned = Date.now()
  const oldest = localDate(Date.now() - settings().keep * DAY)
  try { for (const f of fs.readdirSync(dir())) { const m = FILE.exec(f); if (m && m[1] < oldest) fs.rmSync(path.join(dir(), f)) } } catch { /* gone */ }
}

// ---------- kinds

/** What varies between two times of the same error: line and column numbers, a build's hashed file names, ids, numbers,
 *  addresses. */
const steady = (s: string) => s
  .replace(/\?[^\s)]*/g, "") // a URL's query (?v=<hash>)
  .replace(/-[A-Za-z0-9_-]{8}\.(js|css)/g, ".$1") // Vite's hashed chunk names
  .replace(/:\d+:\d+/g, "").replace(/:\d+\)/g, ")") // line and column
  .replace(/https?:\/\/[^/\s]+/g, "") // the host the app was opened at
  .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<id>")
  .replace(/\b\d+(\.\d+)?\b/g, "<n>")
/** The first frame of a stack that's the code's (Chrome's "    at f (x.js:1:2)", Safari's "f@x.js:1:2"). */
const frame = (stack?: string) => stack?.split("\n").map((l) => l.trim()).find((l) => /^at |@/.test(l)) ?? ""
function kindOf(source: Source, message: string, stack?: string) {
  return crypto.createHash("sha1").update(`${source}\0${steady(message)}\0${steady(frame(stack))}`).digest("hex").slice(0, 10)
}

let groups: Map<string, ErrorGroup> | null = null
const recent = new Map<string, ErrorEvent[]>() // per kind, newest last

function add(e: ErrorEvent, live: boolean): ErrorGroup | null {
  const all = groups!
  let g = all.get(e.id)
  const isNew = !g
  if (!g) { g = { id: e.id, source: e.source, kind: e.kind, message: e.message, first: e.t, last: e.t, count: 0, fatal: 0, devices: [], latest: e }; all.set(e.id, g) }
  g.count += e.n ?? 1
  if (e.fatal) g.fatal++
  if (e.t >= g.last) { g.last = e.t; g.latest = e; g.kind = e.kind; g.message = e.message }
  g.first = Math.min(g.first, e.t)
  if (e.device && !g.devices.includes(e.device)) g.devices = [...g.devices, e.device]
  const r = recent.get(e.id) ?? []
  r.push(e)
  if (r.length > RECENT) r.shift()
  recent.set(e.id, r)
  return live && isNew ? g : null
}

/** Every kind kept, read from the files the first time it's asked (errors are few: all keep_days of them). */
function loaded() {
  if (groups) return groups
  groups = new Map()
  recent.clear()
  let files: string[] = []
  try { files = fs.readdirSync(dir()).filter((f) => FILE.test(f)).sort() } catch { /* none yet */ }
  const rows = files.flatMap(readFile).sort((a, b) => a.t - b.t)
  for (const e of rows) add(e, false)
  return groups
}

// ---------- recording

/** The same error within BURST of the last line written for it: counted here and written with the next line. */
const held = new Map<string, { at: number; n: number; last: ErrorEvent }>()
let lastToast = 0

function record(e: Omit<ErrorEvent, "id">) {
  const event: ErrorEvent = { id: kindOf(e.source, e.message, e.stack), ...e }
  loaded()
  prune()
  const h = held.get(event.id)
  if (h && event.t - h.at < BURST && !event.fatal) {
    h.n++
    h.last = event
    // Counted now (the list says so), written with the next line or when the burst ends.
    const g = groups!.get(event.id)
    if (g) { g.count++; g.last = event.t; g.latest = event }
    return
  }
  if (h && h.n) flushHeld(event.id)
  held.set(event.id, { at: event.t, n: 0, last: event })
  append(event)
  const isNew = add(event, true)
  if (isNew) tell(isNew)
}

/** A burst's count, written as one line (its last time, `n` times). */
function flushHeld(id: string) {
  const h = held.get(id)
  if (!h || !h.n) return
  append({ ...h.last, n: h.n })
  h.n = 0
}
const flusher = setInterval(() => {
  const now = Date.now()
  for (const [id, h] of held) { if (now - h.at >= BURST) { flushHeld(id); held.delete(id) } }
}, BURST)
flusher.unref()
plugin.onUnload(() => { clearInterval(flusher); for (const id of held.keys()) flushHeld(id); held.clear() })

/** A new kind of error: tell the user (a toast, kept in the inbox), not for an older build's file (the app reloaded:
 *  nothing to do) or one that ended the server (nobody left to tell it). */
function tell(g: ErrorGroup) {
  if (!settings().notify || g.kind === "stale" || g.latest.fatal && g.source === "server") return
  if (Date.now() - lastToast < NOTIFY_GAP) return
  lastToast = Date.now()
  const where = g.source === "app" ? (g.kind === "stopped" ? "The app stopped" : "Error in the app") : "Error in the server"
  // After this turn: the error may have come from inside a write that holds the vault.
  setImmediate(() => {
    try {
      void plugin.runOp("ui.notify", { text: `${where}: ${g.message.slice(0, 160)}`, error: true, actionOpen: "view:errors", actionLabel: "Show" }).catch(() => { /* no window, no inbox */ })
    } catch { /* unloaded meanwhile */ }
  })
}

plugin.onServerError((e: ServerError) => {
  if (!plugin.loaded) return
  record({ t: e.t, source: "server", kind: e.fatal ? "fatal" : "error", message: e.message, ...(e.stack ? { stack: e.stack } : {}),
    ...(e.where ? { where: e.where } : {}), ...(e.fatal ? { fatal: true } : {}) })
})

// ---------- the app's

const KINDS = new Set(["uncaught", "rejection", "boundary", "stopped", "boot", "stale"])
const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "")

plugin.route("POST", "errors", (req) => {
  const b = (req.body ?? {}) as Record<string, unknown>
  const list = Array.isArray(b.errors) ? b.errors.slice(0, 50) : []
  const client = typeof req.http?.headers["x-vaultite-client"] === "string" ? (req.http.headers["x-vaultite-client"] as string).replace(/^app\//, "") : ""
  const device = str(b.device, 40) || client || "web"
  let n = 0
  for (const x of list as Record<string, unknown>[]) {
    const message = str(x.message, 500)
    if (!message) continue
    const t = typeof x.t === "number" && Math.abs(x.t - Date.now()) < 7 * DAY ? x.t : Date.now()
    const trail = Array.isArray(x.trail) ? x.trail.filter((s): s is string => typeof s === "string").slice(-10).map((s) => s.slice(0, 200)) : []
    record({ t, source: "app", kind: KINDS.has(x.kind as string) ? x.kind as string : "uncaught", message, device,
      ...(str(x.stack, 8000) ? { stack: str(x.stack, 8000) } : {}), ...(str(x.component, 3000) ? { component: str(x.component, 3000) } : {}),
      ...(x.fatal === true ? { fatal: true } : {}), ...(str(x.url, 500) ? { url: str(x.url, 500) } : {}),
      ...(str(x.build, 100) ? { build: str(x.build, 100) } : {}), ...(trail.length ? { trail } : {}) })
    n++
  }
  return { ok: true, recorded: n }
})

// ---------- reading

function list(q: { source?: string; limit?: number; since?: number }): ErrorList {
  const all = [...loaded().values()]
  const since = q.since ?? 0
  const shown = all.filter((g) => (!q.source || g.source === q.source) && g.last >= since).sort((a, b) => b.last - a.last)
  const oldest = all.reduce((m, g) => Math.min(m, g.first), Date.now())
  return { groups: shown.slice(0, Math.min(500, Math.max(1, q.limit ?? 50))), total: shown.length,
    events: shown.reduce((n, g) => n + g.count, 0), since: oldest }
}

function detail(id: string): ErrorDetail {
  const g = loaded().get(id) ?? [...loaded().values()].find((x) => x.id.startsWith(id) && id.length >= 4)
  if (!g) throw new HTTPError(404, `no error '${id}'`)
  return { group: g, events: [...(recent.get(g.id) ?? [])].reverse() }
}

/** Forget one kind (its lines in every file) or everything. */
function forget(id?: string) {
  const d = dir()
  let files: string[] = []
  try { files = fs.readdirSync(d).filter((f) => FILE.test(f)) } catch { /* none */ }
  if (!id) {
    for (const f of files) try { fs.rmSync(path.join(d, f)) } catch { /* gone */ }
    groups = new Map(); recent.clear(); held.clear()
    return { ok: true, forgot: "all" }
  }
  const g = detail(id).group
  for (const f of files) {
    const rows = readFile(f)
    const kept = rows.filter((e) => e.id !== g.id)
    if (kept.length === rows.length) continue
    try { if (kept.length) fs.writeFileSync(path.join(d, f), kept.map((e) => JSON.stringify(e)).join("\n") + "\n"); else fs.rmSync(path.join(d, f)) } catch { /* gone */ }
  }
  groups!.delete(g.id); recent.delete(g.id); held.delete(g.id)
  return { ok: true, forgot: g.id }
}

const num = (v: unknown) => (v === undefined || v === "" ? undefined : Number(v) || undefined)
plugin.route("GET", "errors", (req) => list({ source: req.query.source || undefined, limit: num(req.query.limit), since: num(req.query.since) }))
plugin.route("GET", "errors/*", (req) => detail(req.arg(0)))
plugin.route("DELETE", "errors", () => forget())
plugin.route("DELETE", "errors/*", (req) => forget(req.arg(0)))

// ---------- operations (core/ops.ts): `vau errors`, `vau errors show <id>`, `vau errors clear`

const ago = (t: number) => {
  const s = Math.round((Date.now() - t) / 1000)
  return s < 60 ? "just now" : s < 3600 ? `${Math.round(s / 60)} min ago` : s < DAY / 1000 ? `${Math.round(s / 3600)} h ago` : `${localDate(t)} ${localTime(t)}`
}
const sourceLabel = (g: ErrorGroup) => (g.source === "app" ? `app${g.devices.length ? ` (${g.devices.join(", ")})` : ""}` : "server")
const groupLine = (g: ErrorGroup) =>
  `${g.id}  ${ago(g.last)}  ${sourceLabel(g)}, ${g.kind}${g.count > 1 ? `, ×${g.count}` : ""}: ${g.message}`

plugin.op({
  id: "errors.list",
  cli: "errors",
  summary: "The errors the app and the server hit, the latest first: each kind once, with how many times and where.",
  help: `One line per kind of error: its id, when it last happened, where (the app on which device, or the server) and
how (stopped: it unmounted the app; boundary: a block or view failed; error: the server logged it; fatal: it ended the
server), how many times, its message. \`vau errors show <id>\` has its stack and each time it happened. Kept on the
server's machine for keep_days (default 30).

  vau errors                    the latest 20 kinds
  vau errors --source app       only the app's
  vau errors --minutes 30       only what happened in the last 30 minutes`,
  kind: "read",
  params: {
    limit: { type: "integer", minimum: 1, maximum: 500, default: 20, description: "at most this many kinds" },
    source: { type: "string", enum: ["app", "server"], description: "only the app's errors, or only the server's" },
    minutes: { type: "integer", minimum: 1, description: "only kinds that happened in the last this many minutes" },
  },
  run: ({ limit, source, minutes }) => list({ limit, source, since: minutes ? Date.now() - minutes * MINUTE : undefined }),
  text: (r: ErrorList) => r.groups.length
    ? [`${r.total} kinds of error, ${r.events} times${r.total > r.groups.length ? ` (the latest ${r.groups.length})` : ""}:`, "", ...r.groups.map(groupLine)].join("\n")
    : "No errors recorded.",
})

/** One time an error happened, in full. */
function eventText(e: ErrorEvent) {
  const d = new Date(e.t)
  return [
    `${d.toDateString()} ${d.toTimeString().slice(0, 8)}${(e.n ?? 1) > 1 ? ` (×${e.n})` : ""}: ${e.kind}${e.fatal ? " (fatal)" : ""}`,
    e.device ? `  device: ${e.device}` : "", e.where ? `  request: ${e.where}` : "", e.url ? `  at: ${e.url}` : "", e.build ? `  build: ${e.build}` : "",
    e.trail?.length ? `  before it: ${e.trail.join(" → ")}` : "",
  ].filter(Boolean).join("\n")
}

plugin.op({
  id: "errors.show",
  cli: "errors show",
  summary: "One kind of error: its message, stack and component stack, and each time it happened (device, address, build, what the user did before).",
  help: `The id is from \`vau errors\` (its first characters are enough).

  vau errors show 3f9a2c1b7e`,
  kind: "read",
  params: {
    id: { type: "string", required: true, description: "the error's id (from vau errors)" },
    times: { type: "integer", minimum: 1, maximum: 30, default: 5, description: "how many of the times it happened to list" },
  },
  args: ["id"],
  run: ({ id, times }) => { const d = detail(id); return { ...d, events: d.events.slice(0, times) } },
  text: (d: ErrorDetail) => {
    const g = d.group, e = g.latest
    return [
      `${g.message}`, "",
      `${sourceLabel(g)}, ${g.kind}: ${g.count} time${g.count === 1 ? "" : "s"}${g.fatal ? ` (${g.fatal} fatal)` : ""}, first ${ago(g.first)}, last ${ago(g.last)}`,
      e.stack ? `\nStack:\n${e.stack}` : "", e.component ? `\nComponents:${e.component}` : "",
      `\nTimes (newest first):`, ...d.events.map(eventText),
    ].filter(Boolean).join("\n")
  },
})

plugin.op({
  id: "errors.clear",
  cli: "errors clear",
  summary: "Forget the errors kept: one kind (its id), or all of them.",
  help: `  vau errors clear 3f9a2c1b7e     forget one kind (fixed)
  vau errors clear --all          forget everything kept`,
  kind: "destructive",
  params: {
    id: { type: "string", description: "the error's id (from vau errors)" },
    all: { type: "boolean", description: "forget every error" },
  },
  args: ["id"],
  run: ({ id, all }) => {
    if (!id && !all) throw new OpError("say which error (its id), or --all")
    return forget(all ? undefined : id)
  },
  text: (r: { forgot: string }) => (r.forgot === "all" ? "Forgot every error." : `Forgot ${r.forgot}.`),
})

// ---------- the block as text (GET /api/render)

plugin.block("errors", (ctx) => {
  const o = ctx.options
  const r = list({ limit: Number(o.limit) || 20, source: o.source === "app" || o.source === "server" ? o.source : undefined })
  const title = typeof o.title === "string" && o.title ? o.title : "Errors"
  if (!r.groups.length) return section(title, "_No errors recorded._")
  return section(title, `${r.total} kinds, ${r.events} times.`, bullets(r.groups.map((g) =>
    `${ago(g.last)} · ${sourceLabel(g)}, ${g.kind}${g.count > 1 ? ` (×${g.count})` : ""} · ${g.message} · \`${g.id}\``)))
})
