// Pages' shared state: a JSON map per page, the same in every view of it (each key the last write the server took), kept
// beside its localStorage, and who has it open. Plain JSON, ordered here: a guest's write is checked as JSON, not a CRDT.
import fs from "node:fs"
import path from "node:path"
import type { WebSocket } from "ws"
import { readText, type Vault, writeAtomic } from "../../../core/vault.ts"

/** Someone with a page open, as everyone sees them (the server names them, never the page). */
export type Person = { id: string; name: string; device?: string }
/** A view of a page: who it is, and the page's path as they name it (a guest's is inside their folder). */
export type Viewer = { person: Person; shown: string }
type Room = { rel: string; state: Map<string, unknown>; sizes: Map<string, number>; bytes: number; views: Map<WebSocket, Viewer & { tint: string }>; timer: ReturnType<typeof setTimeout> | null }

export const sharedPath = (rel: string) => `.vaultite/artifacts/${rel}.shared.json`

const KEY_MAX = 200, KEYS_MAX = 256, VALUE_MAX = 64 << 10, STATE_MAX = 1 << 20, SETS = 1200, SAVE_MS = 250
/** The app's colours (artifacts' --vau-<name>), one per person in a page. */
const TINTS = ["blue", "orange", "green", "purple", "pink", "teal", "red", "indigo", "yellow"]

const send = (ws: WebSocket, m: object) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(m)) }

/** `vaultOf`: the vault, once the plugin is loaded. */
export function sharedPages(vaultOf: () => Vault) {
  const rooms = new Map<string, Room>()
  const hits = new WeakMap<WebSocket, { n: number; until: number }>()

  function roomOf(rel: string): Room {
    let r = rooms.get(rel)
    if (r) return r
    r = { rel, state: new Map(), sizes: new Map(), bytes: 0, views: new Map(), timer: null }
    try {
      const kept = JSON.parse(readText(vaultOf().abs(sharedPath(rel))))
      if (kept && typeof kept === "object" && !Array.isArray(kept)) for (const [k, v] of Object.entries(kept)) put(r, k, v)
    } catch { /* nothing kept yet */ }
    rooms.set(rel, r)
    return r
  }

  function put(r: Room, k: string, v: unknown) {
    r.bytes -= r.sizes.get(k) ?? 0
    if (v === null || v === undefined) { r.state.delete(k); r.sizes.delete(k); return }
    const n = k.length + JSON.stringify(v).length
    r.state.set(k, v); r.sizes.set(k, n); r.bytes += n
  }

  function save(r: Room) {
    if (r.timer) clearTimeout(r.timer)
    r.timer = null
    const file = vaultOf().abs(sharedPath(r.rel))
    fs.mkdirSync(path.dirname(file), { recursive: true })
    writeAtomic(file, JSON.stringify(Object.fromEntries(r.state), null, 1) + "\n")
  }
  const later = (r: Room) => { r.timer ??= setTimeout(() => save(r), SAVE_MS) }

  /** Who's here: one entry a person (their windows are one), in the order they came. */
  function people(r: Room, to?: WebSocket) {
    const out = new Map<string, Person & { tint: string; me: boolean }>()
    const me = to && r.views.get(to)?.person.id
    for (const v of r.views.values()) if (!out.has(v.person.id)) out.set(v.person.id, { ...v.person, tint: v.tint, me: v.person.id === me })
    return [...out.values()]
  }
  const tellPeople = (r: Room) => { for (const ws of r.views.keys()) send(ws, { t: "people", people: people(r, ws) }) }

  /** Why `values` can't be set, or "". Checked whole: a set lands all or nothing. */
  function refusal(r: Room, values: unknown) {
    if (!values || typeof values !== "object" || Array.isArray(values)) return "values is an object of keys"
    const keys = Object.keys(values)
    if (!keys.length || keys.length > KEYS_MAX) return `1 to ${KEYS_MAX} keys a set`
    let bytes = r.bytes
    for (const k of keys) {
      if (!k || k.length > KEY_MAX) return `a key is 1 to ${KEY_MAX} characters`
      const v = (values as Record<string, unknown>)[k], n = v === null ? 0 : k.length + JSON.stringify(v).length
      if (n > VALUE_MAX) return `${k} is over 64 KiB`
      bytes += n - (r.sizes.get(k) ?? 0)
    }
    return bytes > STATE_MAX ? "the page's shared state is over 1 MiB" : ""
  }

  /** Set keys (null deletes) as `by`: told to every view but `from`'s, which already shows them. */
  function apply(r: Room, values: Record<string, unknown>, by: string, from: WebSocket | null) {
    for (const [k, v] of Object.entries(values)) put(r, k, v)
    for (const ws of r.views.keys()) if (ws !== from) send(ws, { t: "set", values, by })
    later(r)
  }

  function leave(ws: WebSocket, r: Room) {
    if (!r.views.delete(ws)) return
    tellPeople(r)
    if (r.views.size) return
    if (r.timer) save(r)
    if (rooms.get(r.rel) === r) rooms.delete(r.rel)
  }

  return {
    /** A view opens the page `rel` (an artifact in the vault): it's sent the state and who's here, and says its sets. */
    join(ws: WebSocket, rel: string, viewer: Viewer) {
      const r = roomOf(rel), taken = new Set([...r.views.values()].map((v) => v.tint))
      const same = [...r.views.values()].find((v) => v.person.id === viewer.person.id)
      r.views.set(ws, { ...viewer, tint: same?.tint ?? TINTS.find((t) => !taken.has(t)) ?? TINTS[r.views.size % TINTS.length] })
      send(ws, { t: "hello", state: Object.fromEntries(r.state), me: people(r, ws).find((p) => p.me), people: people(r, ws) })
      for (const other of r.views.keys()) if (other !== ws) send(other, { t: "people", people: people(r, other) })
      ws.on("close", () => leave(ws, r))
      ws.on("message", (data) => {
        let m: { t?: unknown; n?: unknown; values?: unknown }
        try { m = JSON.parse(String(data)) } catch { return }
        if (m.t !== "set" || rooms.get(rel) !== r || !r.views.has(ws)) return
        const t = Date.now(), h = hits.get(ws)
        if (!h || h.until < t) hits.set(ws, { n: 1, until: t + 60_000 })
        const why = h && h.until >= t && ++h.n > SETS ? "too many changes a minute" : refusal(r, m.values)
        // (refused: the view is sent what those keys hold, to show again)
        if (why) {
          const keys = m.values && typeof m.values === "object" ? Object.keys(m.values).slice(0, KEYS_MAX) : []
          return send(ws, { t: "no", n: m.n, why, values: Object.fromEntries(keys.map((k) => [k, r.state.get(k) ?? null])) })
        }
        apply(r, m.values as Record<string, unknown>, viewer.person.id, ws)
        send(ws, { t: "ok", n: m.n })
      })
    },

    /** A page's state and who has it open now (an agent's look). */
    read(rel: string) {
      const r = rooms.get(rel) ?? roomOf(rel), out = { state: Object.fromEntries(r.state), people: people(r).map(({ me: _, ...p }) => p) }
      if (!r.views.size) rooms.delete(rel)
      return out
    },

    /** Set keys from outside the page (an agent): every view shows them at once. */
    set(rel: string, values: Record<string, unknown>, by: string) {
      const r = roomOf(rel), why = refusal(r, values)
      if (why) { if (!r.views.size) rooms.delete(rel); throw new Error(why) }
      apply(r, values, by, null)
      if (!r.views.size) { save(r); rooms.delete(rel) }
      return Object.fromEntries(r.state)
    },

    /** The page moved (or was trashed: `to` null): its views close (they open it again by its new name), its state follows. */
    moved(from: string, to: string | null) {
      const r = rooms.get(from)
      if (r) {
        if (r.timer) save(r)
        rooms.delete(from)
        const views = [...r.views.keys()]
        r.views.clear()
        for (const ws of views) ws.close(4001, "moved")
      }
      const src = vaultOf().abs(sharedPath(from))
      if (!to || !fs.existsSync(src)) return
      const dst = vaultOf().abs(sharedPath(to))
      fs.mkdirSync(path.dirname(dst), { recursive: true })
      fs.renameSync(src, dst)
    },

    /** What's waiting is written now (the server stops). */
    flush() { for (const r of rooms.values()) if (r.timer) save(r) },

    /** Pages open now and how many views each (tests). */
    list: () => [...rooms.values()].map((r) => ({ path: r.rel, views: r.views.size })),
  }
}
