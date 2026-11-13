import type { IncomingMessage, ServerResponse } from "node:http"
import { defineOp, type Op } from "./ops.ts"
import type { Vault } from "./vault.ts"
import { logger } from "./log.ts"

const log = logger("events")

export type VaultEvent = { type: string; seq: number; t: number; cursor: string; [k: string]: unknown }
export type EventFilter = { types?: string[]; path?: string }

export const EVENT_TYPES: Record<string, string> = {
  "file.changed": "files changed on disk, whoever changed them: {paths} (null: anything may have)",
  "file.moved": "a file or folder moved through the API, or restored from .trash: {from, to}",
  "file.trashed": "a file deleted through the API (moved to .trash): {path}",
  "op.done": "a write operation ran: {id, plugin, kind, who, params (a short summary), ok, error, ms}",
}

const KEEP = 500
const ID = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/

function pathsOf(ev: Record<string, unknown>): string[] {
  const out: string[] = []
  if (Array.isArray(ev.paths)) for (const p of ev.paths) if (typeof p === "string") out.push(p)
  for (const k of ["path", "from", "to"]) if (typeof ev[k] === "string") out.push(ev[k] as string)
  return out
}

export function typeMatches(type: string, wanted: string[] | undefined) {
  if (!wanted?.length) return true
  return wanted.some((w) => w === type || w === "*" || (w.endsWith(".*") ? type.startsWith(w.slice(0, -1)) : type.startsWith(`${w}.`)))
}

export function matching(ev: VaultEvent, f: EventFilter): VaultEvent | null {
  if (!typeMatches(ev.type, f.types)) return null
  const pre = f.path?.trim().replace(/^\/+/, "")
  if (!pre) return ev
  if (ev.type === "file.changed" && ev.paths === null) return ev
  const hit = pathsOf(ev).filter((p) => p.startsWith(pre))
  if (!hit.length) return null
  return Array.isArray(ev.paths) ? { ...ev, paths: (ev.paths as string[]).filter((p) => p.startsWith(pre)) } : ev
}

function filterOf(types: unknown, path: unknown): EventFilter {
  const t = Array.isArray(types) ? types.map(String) : typeof types === "string" ? types.split(",") : []
  return { types: t.map((x) => x.trim()).filter(Boolean), ...(typeof path === "string" && path.trim() ? { path: path.trim() } : {}) }
}

type Listener = { filter: EventFilter; fn: (ev: VaultEvent) => void }

export class Events {
  readonly boot = Date.now().toString(36)
  private seq = 0
  private recent: VaultEvent[] = []
  private listeners = new Set<Listener>()

  emit(type: string, data: Record<string, unknown> = {}): VaultEvent {
    if (!ID.test(type)) throw new Error(`an event type is area.name, lowercase (file.changed), not '${type}'`)
    const seq = ++this.seq
    const ev: VaultEvent = { ...data, type, seq, t: Date.now(), cursor: `${this.boot}:${seq}` }
    this.recent.push(ev)
    if (this.recent.length > KEEP) this.recent.splice(0, this.recent.length - KEEP)
    for (const l of [...this.listeners]) {
      const seen = matching(ev, l.filter)
      if (!seen) continue
      try { l.fn(seen) } catch (e) { log.error(`a listener of ${type} failed`, e) }
    }
    return ev
  }

  on(filter: EventFilter, fn: (ev: VaultEvent) => void) {
    const l = { filter, fn }
    this.listeners.add(l)
    return () => { this.listeners.delete(l) }
  }

  get cursor() {
    return `${this.boot}:${this.seq}`
  }

  /** A cursor from another boot gets none. `missed`: events after the cursor were already let go of. */
  since(after: string | null | undefined, filter: EventFilter, limit = 100): { events: VaultEvent[]; missed: boolean } {
    const [boot, n] = String(after ?? "").split(":")
    if (boot !== this.boot || !/^\d+$/.test(n ?? "")) return { events: [], missed: false }
    const from = Number(n)
    const missed = this.recent.length > 0 && this.recent[0].seq > from + 1
    const events = this.recent.filter((e) => e.seq > from).flatMap((e) => matching(e, filter) ?? []).slice(0, limit)
    return { events, missed }
  }

  last(filter: EventFilter, limit = 50): VaultEvent[] {
    return this.recent.flatMap((e) => matching(e, filter) ?? []).slice(-limit)
  }

  async wait(filter: EventFilter, after: string | null | undefined, ms: number, abort?: AbortSignal): Promise<{ events: VaultEvent[]; missed: boolean; cursor: string }> {
    const start = after && after.startsWith(`${this.boot}:`) ? after : this.cursor
    const now = this.since(start, filter)
    if (now.events.length) return { ...now, cursor: now.events.at(-1)!.cursor }
    const ev = await new Promise<VaultEvent | null>((resolve) => {
      let stop = () => {}
      const timer = setTimeout(() => { stop(); resolve(null) }, Math.max(0, ms))
      const end = (x: VaultEvent | null) => { clearTimeout(timer); stop(); abort?.removeEventListener("abort", gone); resolve(x) }
      const gone = () => end(null)
      abort?.addEventListener("abort", gone)
      stop = this.on(filter, (e) => end(e))
    })
    return ev ? { events: [ev], missed: now.missed, cursor: ev.cursor } : { events: [], missed: now.missed, cursor: start }
  }
}

const buses = new WeakMap<Vault, Events>()

export function eventsOf(vault: Vault): Events {
  let b = buses.get(vault)
  if (!b) buses.set(vault, b = new Events())
  return b
}

/** A comment every 25 s so proxies keep the stream open; Last-Event-ID is the browser's on a reconnect. */
export function stream(bus: Events, req: IncomingMessage, res: ServerResponse, query: Record<string, string>) {
  const filter = filterOf(query.types ?? query.type, query.path)
  res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache", Connection: "keep-alive", "X-Accel-Buffering": "no" })
  const send = (ev: VaultEvent) => res.write(`id: ${ev.cursor}\nevent: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`)
  res.write(`: vaultite events ${bus.cursor}\n\n`)
  const after = query.after ?? (typeof req.headers["last-event-id"] === "string" ? req.headers["last-event-id"] : null)
  for (const ev of bus.since(after, filter, 500).events) send(ev)
  const off = bus.on(filter, send)
  const ping = setInterval(() => res.write(": ping\n\n"), 25_000)
  const end = () => { off(); clearInterval(ping) }
  req.on("close", end)
  res.on("close", end)
}

export function summary(params: Record<string, unknown>): Record<string, unknown> {
  const short = (v: unknown, depth = 0): unknown => {
    if (typeof v === "string") return v.length > 120 ? `${v.slice(0, 117)}...` : v
    if (Array.isArray(v)) return v.length > 5 ? [...v.slice(0, 5).map((x) => short(x, depth + 1)), `(${v.length - 5} more)`] : v.map((x) => short(x, depth + 1))
    if (v && typeof v === "object") return depth > 1 ? `{${Object.keys(v).slice(0, 6).join(", ")}}` : Object.fromEntries(Object.entries(v).slice(0, 12).map(([k, x]) => [k, short(x, depth + 1)]))
    return v
  }
  return short(params) as Record<string, unknown>
}

const MAX_WAIT = 300

export function eventOps(): Op[] {
  const filterParams = {
    types: { type: "array" as const, items: { type: "string" as const }, description: "event types or areas (file.changed, op.done, file); all when left out" },
    path: { type: "string" as const, description: "only events about paths starting with this (Notes/, People/Alice Park.md)" },
  }
  const text = (r: { events: VaultEvent[]; cursor?: string; missed?: boolean }) =>
    (r.events.length ? r.events.map((e) => JSON.stringify(e)).join("\n") : "No events.") +
    (r.missed ? "\n(Some events after the cursor were already let go of.)" : "") + (r.cursor ? `\nCursor: ${r.cursor}` : "")
  return [defineOp({
    id: "events.wait",
    mcp: true,
    summary: "Wait for the next events in the vault (files changed or moved, operations done), at most a timeout.",
    help: `Answers the matching events that happened after \`after\` (a cursor from an earlier answer), or, when there are
none yet, waits for the next one, at most \`timeout\` seconds (then none). Pass the answer's cursor as \`after\` next
time and nothing in between is missed (the server keeps the last 500 events in memory). Types: ${Object.keys(EVENT_TYPES).join(", ")},
and plugins' own (<plugin id>.<name>); \`vau docs events\` describes each.

  vau events.wait --types file.changed --path Notes/ --timeout 60
  vau events --once --type op.done`,
    kind: "read",
    params: {
      ...filterParams,
      after: { type: "string", description: "the cursor of the last event seen (from an earlier answer): its later events first" },
      timeout: { type: "number", minimum: 0, maximum: MAX_WAIT, default: 30, description: `seconds to wait for one (at most ${MAX_WAIT})` },
    },
    run: ({ types, path, after, timeout }, ctx) => eventsOf(ctx.vault).wait(filterOf(types, path), after ?? null, Number(timeout) * 1000),
    text,
  }), defineOp({
    id: "events.list",
    summary: "The recent events in the vault (kept in memory: since the server started, the last 500).",
    kind: "read",
    params: { ...filterParams, limit: { type: "integer", minimum: 1, maximum: 500, default: 50, description: "how many, the newest" } },
    run: ({ types, path, limit }, ctx) => {
      const bus = eventsOf(ctx.vault)
      return { events: bus.last(filterOf(types, path), Number(limit)), cursor: bus.cursor }
    },
    text,
  })]
}
