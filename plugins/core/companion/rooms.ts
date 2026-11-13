import * as decoding from "lib0/decoding"
import * as encoding from "lib0/encoding"
import { fromBase64, toBase64 } from "lib0/buffer"
import type { RawData, WebSocket } from "ws"
import * as Y from "yjs"
import { z } from "zod"
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate, removeAwarenessStates } from "y-protocols/awareness"
import { merge3, type Plugin, type Who } from "../../../core/plugins.ts"
import { readText } from "../../../core/vault.ts"
import { parseJson } from "../../../core/agents.ts"
import { span } from "./text.ts"
import { messageOf } from "./errors.ts"

export const Message = z.looseObject({ t: z.string() })
export type Message = z.infer<typeof Message>
export const messageFrom = (data: RawData) => Message.safeParse(parseJson(String(data))).data

export type Peer = { who: Who; name: string; tint: string; edits: boolean; see: (rel: string) => string | null
  may?: (rel: string, before: string, after: string) => string; slow?: () => boolean }
type Room = { path: string; doc: Y.Doc; text: Y.Text; aw: Awareness; peers: Map<WebSocket, Set<number>>; disk: string
  pending: { peer: Peer; timer: ReturnType<typeof setTimeout>; since: number } | null; turn: Promise<void>
  queued: Map<WebSocket, { updates: Uint8Array[]; bytes: number; timer: ReturnType<typeof setTimeout> }>
  clients: Map<number, WebSocket>
  worn: boolean }

const WRITE_MS = 400, WRITE_MAX_MS = 1500, MAX_UPDATE = 400_000, CHECK_MS = 250
// Yjs is slow to place many pieces at one spot.
const MAX_STRUCTS = 500, MAX_IDS = 2, IDS_PER_WINDOW = 32
const GUEST_LIVE_MAX = 64_000
const OPENS = 30, CARETS = 1200, REFUSALS = 30, BACKLOG = 32 << 20
const ROOM_MAX = 2 << 20
const WORN = "this note has been typed in too much to go on together: reopen it"
const send = (ws: WebSocket, m: object) => {
  if (ws.readyState !== ws.OPEN) return
  if (ws.bufferedAmount > BACKLOG) return void ws.close()
  ws.send(JSON.stringify(m))
}
const Id = z.object({ client: z.int().min(0), clock: z.int().min(0) })
const RelPos = z.object({ type: Id.nullish(), tname: z.unknown().optional(), item: Id.nullish(), assoc: z.unknown().optional() })
  .refine((x) => x.item || x.type || x.tname === "md")
  .transform((x) => ({ type: x.type ?? null, tname: x.type ? null : "md", item: x.item ?? null, assoc: x.assoc === -1 ? -1 : 0 }))
const Caret = z.object({ anchor: RelPos, head: RelPos })
const caretOf = Caret.nullable().catch(null).parse
const AwState = z.object({ cursor: z.unknown().optional() })
const Written = z.object({ text: z.string() })

export function rooms(plugin: Plugin) {
  const all = new Map<string, Room>()
  const peers = new Map<WebSocket, Peer>()
  const hits = new WeakMap<WebSocket, Map<string, { n: number; until: number }>>()
  const over = (ws: WebSocket, kind: string, n: number) => {
    const mine = hits.get(ws) ?? new Map(), t = Date.now(), h = mine.get(kind)
    hits.set(ws, mine)
    if (!h || h.until < t) { mine.set(kind, { n: 1, until: t + 60_000 }); return false }
    return ++h.n > n
  }

  const tell = (r: Room, from: WebSocket | null, m: Message) => {
    for (const ws of r.peers.keys()) {
      if (ws === from) continue
      const p = peers.get(ws)?.see(r.path)
      if (p !== null && p !== undefined) send(ws, { ...m, path: p })
    }
  }

  function become(r: Room, text: string, origin: unknown) {
    const now = r.text.toString()
    if (now === text) return
    const [a, b] = span(now, text)
    r.doc.transact(() => {
      if (now.length - a - b) r.text.delete(a, now.length - a - b)
      if (text.length - a - b) r.text.insert(a, text.slice(a, text.length - b))
    }, origin)
  }

  const inTurn = (r: Room, fn: () => Promise<void>) => (r.turn = r.turn.then(fn).catch((e) => console.error(`companion: ${r.path}:`, e)))

  function write(r: Room, peer: Peer, text: string) {
    return inTurn(r, async () => {
      for (let tries = 0; tries < 2; tries++) {
        if (text === r.disk) return
        let f: { text: string }
        try { f = Written.parse(await plugin.host.api("PUT", "file", { path: r.path, text, base: r.disk }, peer.who)) } catch (e) {
          console.error(`companion: couldn't write ${r.path}: ${messageOf(e)}`)
          const was = r.text.toString()
          rereadNow(r)
          text = r.text.toString() === was ? text : merge3(was, text, r.text.toString()) ?? r.text.toString()
          continue
        }
        const now = r.text.toString()
        r.disk = f.text
        if (f.text !== text) become(r, now === text ? f.text : merge3(text, now, f.text) ?? now, "disk")
        return
      }
      if (!peer.may) return
      become(r, merge3(text, r.text.toString(), r.disk) ?? r.disk, "disk")
      for (const [ws, p] of peers) if (p === peer && r.peers.has(ws)) refuse(r, ws, peer, "it couldn't be saved")
    })
  }
  const flush = (r: Room) => { if (!r.pending) return; clearTimeout(r.pending.timer); const p = r.pending.peer; r.pending = null; void write(r, p, r.text.toString()) }

  function rereadNow(r: Room) {
    let disk: string
    try { disk = readText(plugin.vault.abs(r.path)) } catch { return }
    if (disk === r.disk) return
    const now = r.text.toString(), merged = merge3(r.disk, now, disk)
    const here = [...r.peers.keys()].map((ws) => peers.get(ws)).filter((p) => !!p), by = r.pending?.peer ?? here.find((p) => !p.may) ?? here[0]
    const kept = merged !== null || (by && !by.may?.(r.path, disk, now))
    if (merged === null && kept) plugin.service("history:keep")?.(r.path)
    if (merged === null) tell(r, null, { t: "y-clash", kept: kept ? "typed" : "file" })
    become(r, merged ?? (kept ? now : disk), "disk")
    r.disk = disk
    if (merged === null && kept && !r.pending) r.pending = { peer: by!, timer: setTimeout(() => flush(r), WRITE_MS), since: Date.now() }
  }
  const reread = (r: Room) => inTurn(r, async () => rereadNow(r))

  const counted = (r: Room) => { for (const ws of r.peers.keys()) { const p = peers.get(ws)?.see(r.path); if (p) send(ws, { t: "y-peers", path: p, others: r.peers.size - 1 }) } }

  function roomOf(path: string): Room | null {
    let r = all.get(path)
    if (r) return r
    let text: string
    try { text = readText(plugin.vault.abs(path)) } catch { return null }
    if (text.length > ROOM_MAX) return null
    const doc = new Y.Doc({ gc: true }), aw = new Awareness(doc)
    aw.setLocalState(null)
    r = { path, doc, text: doc.getText("md"), aw, peers: new Map(), disk: text, pending: null, turn: Promise.resolve(), queued: new Map(), clients: new Map(), worn: false }
    r.text.insert(0, text)
    const room = r
    doc.on("update", (u, origin) => tell(room, [...room.peers.keys()].find((ws) => ws === origin) ?? null, { t: "y", u: toBase64(u) }))
    all.set(path, r)
    return r
  }

  function leave(ws: WebSocket, path: string) {
    const r = all.get(path), ids = r?.peers.get(ws)
    if (!r || !ids) return
    const q = r.queued.get(ws), peer = peers.get(ws)
    if (q && peer) { clearTimeout(q.timer); check(r, ws, peer) }
    r.peers.delete(ws)
    for (const [id, w] of r.clients) if (w === ws) r.clients.delete(id)
    if (ids.size) {
      removeAwarenessStates(r.aw, [...ids], ws)
      tell(r, ws, { t: "aw", u: toBase64(encodeAwarenessUpdate(r.aw, [...ids])) })
    }
    if (r.pending && (r.pending.peer === peer || r.peers.size < 2)) flush(r)
    void inTurn(r, async () => counted(r))
    if (r.peers.size) return
    flush(r)
    void r.turn.then(() => { if (!r.peers.size && all.get(path) === r) { all.delete(path); r.aw.destroy(); r.doc.destroy() } })
  }

  function refuse(r: Room, ws: WebSocket, peer: Peer, why = "") {
    if (over(ws, "refused", REFUSALS)) return
    send(ws, { t: "y-reject", path: peer.see(r.path) ?? undefined, why })
    sendState(r, ws, peer)
  }

  function sendState(r: Room, ws: WebSocket, peer: Peer, bare = false) {
    const p = peer.see(r.path)
    if (!r.peers.has(ws) || p === null) return
    const others = r.peers.size - 1, alone = !!peer.may && r.text.length > GUEST_LIVE_MAX
    if (bare) return send(ws, { t: "y-state", path: p, edits: peer.edits, alone, others })
    send(ws, { t: "y-state", path: p, u: toBase64(Y.encodeStateAsUpdate(r.doc)), aw: toBase64(encodeAwarenessUpdate(r.aw, [...r.aw.getStates().keys()])),
      edits: peer.edits, alone, others })
  }

  function ownStates(r: Room, ws: WebSocket, peer: Peer, u: Uint8Array): Uint8Array | null {
    const d = decoding.createDecoder(u), e = encoding.createEncoder(), mine = r.peers.get(ws)!
    const n = decoding.readVarUint(d)
    if (n > 2) return null
    encoding.writeVarUint(e, n)
    for (let i = 0; i < n; i++) {
      const id = decoding.readVarUint(d), clock = decoding.readVarUint(d), json = decoding.readVarString(d)
      if (json.length > 4000) return null
      if (taken(r, ws, id)) return null
      const state = json === "null" ? null : AwState.safeParse(parseJson(json)).data
      if (state === undefined) return null
      if (!mine.has(id) && mine.size >= 2 && state) return null
      if (state) mine.add(id); else mine.delete(id)
      encoding.writeVarUint(e, id)
      encoding.writeVarUint(e, clock)
      encoding.writeVarString(e, JSON.stringify(state && { cursor: caretOf(state.cursor), user: { name: peer.name, color: `var(--${peer.tint}, #${(id % 0xffffff).toString(16).padStart(6, "0")})`, colorLight: `color-mix(in srgb, var(--${peer.tint}) 25%, transparent)` } }))
    }
    return encoding.toUint8Array(e)
  }

  const taken = (r: Room, ws: WebSocket, id: number) =>
    id === r.doc.clientID || (r.clients.get(id) ?? ws) !== ws || [...r.peers].some(([other, ids]) => other !== ws && ids.has(id))
  function ownClients(r: Room, ws: WebSocket, u: Uint8Array) {
    return !Y.decodeUpdate(u).structs.some((s) => taken(r, ws, s.id.client))
  }
  const onlyText = (t: Y.Text) => {
    for (let i = t._start; i; i = i.right) if (!(i.content instanceof Y.ContentString || i.content instanceof Y.ContentDeleted)) return false
    return t.length === t.toString().length
  }

  function land(r: Room, ws: WebSocket, peer: Peer, u: Uint8Array) {
    if (r.pending && r.pending.peer !== peer) flush(r)
    const was = r.text.toString()
    Y.applyUpdate(r.doc, u, ws)
    for (const s of Y.decodeUpdate(u).structs) r.clients.set(s.id.client, ws)
    if (r.text.toString() === was) return
    const since = r.pending?.since ?? Date.now()
    if (r.pending) clearTimeout(r.pending.timer)
    r.pending = { peer, since, timer: setTimeout(() => flush(r), Date.now() - since > WRITE_MAX_MS ? 0 : WRITE_MS) }
  }

  function check(r: Room, ws: WebSocket, peer: Peer) {
    const q = r.queued.get(ws)
    r.queued.delete(ws)
    if (!q || !r.peers.has(ws)) return
    const no = (why = "") => refuse(r, ws, peer, why)
    if (r.text.length > GUEST_LIVE_MAX) return no("this note is too long to type in together")
    if (r.worn) return no(WORN)
    const copy = new Y.Doc()
    try {
      const u = Y.mergeUpdates(q.updates)
      if (u.length > MAX_UPDATE) return no()
      const { structs } = Y.decodeUpdate(u), ids = new Set(structs.map((s) => s.id.client))
      const claimed = [...r.clients.entries()].filter(([id, w]) => w === ws && !ids.has(id)).length
      if (structs.length > MAX_STRUCTS || ids.size > MAX_IDS || claimed + ids.size > IDS_PER_WINDOW || !ownClients(r, ws, u)) return no()
      Y.applyUpdate(copy, Y.encodeStateAsUpdate(r.doc))
      Y.applyUpdate(copy, u)
      if (copy.store.pendingStructs || copy.store.pendingDs || [...copy.share.keys()].some((k) => k !== "md") || !onlyText(copy.getText("md"))) return no()
      if (Y.encodeStateAsUpdate(copy).length > 4 * GUEST_LIVE_MAX + 256_000) return r.worn = true, no(WORN)
      const before = r.text.toString(), after = copy.getText("md").toString()
      const why = after === before ? "" : after.length > GUEST_LIVE_MAX ? "this note is too long to type in together" : peer.may!(r.path, before, after)
      if (why) return no(why)
      land(r, ws, peer, u)
    } catch { no() } finally { copy.destroy() }
  }

  return {
    add(ws: WebSocket, peer: Peer) {
      peers.set(ws, peer)
      ws.on("close", () => { for (const [path, r] of all) if (r.peers.has(ws)) leave(ws, path); peers.delete(ws) })
    },

    heard(ws: WebSocket, m: Message, path: string | null) {
      const peer = peers.get(ws)
      if (!peer || !m.t.startsWith("y") && m.t !== "aw") return false
      if (!path || !/\.md$/i.test(path)) return true
      const p = peer.see(path)
      if (p === null) return true
      if (m.t === "y-open") {
        if (over(ws, "open", OPENS)) return true
        const r = roomOf(path)
        if (!r) return true
        const fresh = !r.peers.has(ws)
        if (fresh) r.peers.set(ws, new Set())
        void inTurn(r, async () => {
          rereadNow(r)
          sendState(r, ws, peer, m.bare === true)
          if (fresh) counted(r)
        })
        return true
      }
      const r = all.get(path)
      if (!r?.peers.has(ws)) return true
      if (m.t === "y-close") leave(ws, path)
      else if (m.t === "aw" && typeof m.u === "string") {
        if (m.u.length > 16_000 || over(ws, "caret", CARETS)) return true
        let u: Uint8Array | null = null
        try { u = ownStates(r, ws, peer, fromBase64(m.u)) } catch {}
        if (!u) return true
        applyAwarenessUpdate(r.aw, u, ws)
        tell(r, ws, { t: "aw", u: toBase64(u) })
      } else if (m.t === "y" && typeof m.u === "string") {
        if (!peer.edits) return true
        if (m.u.length > MAX_UPDATE || peer.slow?.()) return refuse(r, ws, peer), true
        const u = fromBase64(m.u)
        if (!peer.may) {
          try { if (ownClients(r, ws, u)) land(r, ws, peer, u) } catch { send(ws, { t: "y-reject", path: p }) }
          return true
        }
        const q = r.queued.get(ws) ?? { updates: [], bytes: 0, timer: setTimeout(() => check(r, ws, peer), CHECK_MS) }
        q.updates.push(u)
        q.bytes += u.length
        r.queued.set(ws, q)
        if (q.bytes > MAX_UPDATE || q.updates.length > MAX_STRUCTS) { clearTimeout(q.timer); r.queued.delete(ws); refuse(r, ws, peer) }
      }
      return true
    },

    changed(paths: string[] | null) {
      for (const r of all.values()) if (paths === null || paths.includes(r.path)) void reread(r)
    },

    list: () => [...all.values()].map((r) => ({ path: r.path, peers: r.peers.size, text: r.text.toString() })),

    async settled() {
      for (;;) {
        const rs = [...all.values()], turns = rs.map((r) => r.turn)
        await Promise.all(turns)
        const now = [...all.values()]
        if (now.length === rs.length && now.every((r, i) => r === rs[i] && r.turn === turns[i] && !r.pending && !r.queued.size)) return
        await new Promise((ok) => setTimeout(ok, 10))
      }
    },
  }
}
