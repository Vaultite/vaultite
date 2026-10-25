// Co-editing: a Y.Doc per note open in some window, outside edits merged in; while others are in it, windows type into
// it and it's written back a person at a time (each one's lines theirs); alone, a window saves as ever. Companion's socket.
import * as decoding from "lib0/decoding"
import * as encoding from "lib0/encoding"
import { fromBase64, toBase64 } from "lib0/buffer"
import type { WebSocket } from "ws"
import * as Y from "yjs"
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate, removeAwarenessStates } from "y-protocols/awareness"
import { merge3, type Plugin, type Who } from "../../../core/plugins.ts"
import { readText } from "../../../core/vault.ts"
import { span } from "./text.ts"

/** Someone in a note: who writes as them, the name and colour others see, whether they may type, their names for the
 *  vault's paths; a guest's: why a change of theirs can't land (`may`), and whether they're typing too fast (`slow`). */
export type Peer = { who: Who; name: string; tint: string; edits: boolean; see: (rel: string) => string | null
  may?: (rel: string, before: string, after: string) => string; slow?: () => boolean }
/** `queued`: a guest's updates waiting to be checked together (a check reads the whole note: not one per keystroke). */
type Room = { path: string; doc: Y.Doc; text: Y.Text; aw: Awareness; peers: Map<WebSocket, Set<number>>; disk: string
  pending: { peer: Peer; timer: ReturnType<typeof setTimeout>; since: number } | null; turn: Promise<void>
  queued: Map<WebSocket, { updates: Uint8Array[]; timer: ReturnType<typeof setTimeout> }>
  /** Each Yjs client id's window, as first seen: no window writes under another's. */
  clients: Map<number, WebSocket> }

const WRITE_MS = 400, WRITE_MAX_MS = 1500, MAX_UPDATE = 400_000, CHECK_MS = 250
/** A guest's changes checked together hold at most this many pieces, under one or two Yjs ids (a window's own, and the
 *  next after a resync); a window claims a few ids in all. Many at one spot would take Yjs long to place. */
const MAX_STRUCTS = 500, MAX_IDS = 2, IDS_PER_WINDOW = 32
/** The longest note a guest types into with others (their changes are checked whole, a few times a second). */
const GUEST_LIVE_MAX = 64_000
/** What a window may send a minute (opens, carets), and how much may wait unsent to it before it's let go. */
const OPENS = 30, CARETS = 1200, BACKLOG = 32 << 20
/** The biggest note typed in together (its whole text goes to each window that joins). */
const ROOM_MAX = 2 << 20
const send = (ws: WebSocket, m: object) => {
  if (ws.readyState !== ws.OPEN) return
  if (ws.bufferedAmount > BACKLOG) return void ws.close() // (a window that doesn't read: not kept in memory)
  ws.send(JSON.stringify(m))
}
/** A caret as y-codemirror reads one: two relative positions, each written out whole (it reads them as they come). */
const idOf = (v: unknown) => {
  const x = v as { client?: unknown; clock?: unknown } | null
  return x && typeof x === "object" && Number.isSafeInteger(x.client) && Number.isSafeInteger(x.clock) && (x.client as number) >= 0 && (x.clock as number) >= 0
    ? { client: x.client as number, clock: x.clock as number } : null
}
const relPos = (p: unknown) => {
  const x = p as { type?: unknown; tname?: unknown; item?: unknown; assoc?: unknown } | null
  if (!x || typeof x !== "object") return null
  const item = idOf(x.item), type = idOf(x.type), assoc = x.assoc === -1 ? -1 : 0
  if ((x.item != null && !item) || (x.type != null && !type)) return null
  if (!item && !type && x.tname !== "md") return null
  return { type, tname: type ? null : "md", item, assoc }
}
const caretOf = (c: unknown) => {
  const x = c as { anchor?: unknown; head?: unknown } | null, anchor = x && relPos(x.anchor), head = x && relPos(x.head)
  return anchor && head ? { anchor, head } : null
}

/** The rooms of one plugin's vault: what its sockets say about notes open in them. */
export function rooms(plugin: Plugin) {
  const all = new Map<string, Room>()
  const peers = new Map<WebSocket, Peer>()
  const hits = new WeakMap<WebSocket, Map<string, { n: number; until: number }>>()
  /** Over `n` of `kind` this minute, from this window. */
  const over = (ws: WebSocket, kind: string, n: number) => {
    const mine = hits.get(ws) ?? new Map(), t = Date.now(), h = mine.get(kind)
    hits.set(ws, mine)
    if (!h || h.until < t) { mine.set(kind, { n: 1, until: t + 60_000 }); return false }
    return ++h.n > n
  }

  /** Tell the room's other windows, each by its own name for the note. */
  const tell = (r: Room, from: WebSocket | null, m: Record<string, unknown>) => {
    for (const ws of r.peers.keys()) {
      if (ws === from) continue
      const p = peers.get(ws)?.see(r.path)
      if (p !== null && p !== undefined) send(ws, { ...m, path: p })
    }
  }

  /** `text` as the doc's: one change from where they differ to where they agree again. */
  function become(r: Room, text: string, origin: unknown) {
    const now = r.text.toString()
    if (now === text) return
    const [a, b] = span(now, text)
    r.doc.transact(() => {
      if (now.length - a - b) r.text.delete(a, now.length - a - b)
      if (text.length - a - b) r.text.insert(a, text.slice(a, text.length - b))
    }, origin)
  }

  /** One thing at a time per room (writes, merges from disk), in order. */
  const inTurn = (r: Room, fn: () => Promise<void>) => (r.turn = r.turn.then(fn).catch((e) => console.error(`companion: ${r.path}:`, e)))

  /** Write `text` (the doc when `peer`'s turn ended) as theirs; what the server set as it saved (a date) comes back. */
  function write(r: Room, peer: Peer, text: string) {
    return inTurn(r, async () => {
      for (let tries = 0; tries < 2; tries++) {
        if (text === r.disk) return
        let f: { text: string }
        try { f = await plugin.host.api("PUT", "file", { path: r.path, text, base: r.disk }, peer.who) as { text: string } } catch (e) {
          // (changed on disk meanwhile: that merged in, the text written on it, once more)
          console.error(`companion: couldn't write ${r.path}: ${(e as Error).message}`)
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
    })
  }
  // (the text as it is now: what comes after is the next one's)
  const flush = (r: Room) => { if (!r.pending) return; clearTimeout(r.pending.timer); const p = r.pending.peer; r.pending = null; void write(r, p, r.text.toString()) }

  /** What's on disk now merged into the doc (an agent, another machine, iCloud wrote it; a window alone saved it). Where
   *  both changed the same lines, the doc's typing stays (the file's version is in its history) and the windows hear so. */
  function rereadNow(r: Room) {
    let disk: string
    try { disk = readText(plugin.vault.abs(r.path)) } catch { return }
    if (disk === r.disk) return
    const now = r.text.toString(), merged = merge3(r.disk, now, disk)
    if (merged === null) tell(r, null, { t: "y-clash" })
    become(r, merged ?? now, "disk")
    r.disk = disk
    if (merged === null && !r.pending) r.pending = { peer: [...peers.values()].find((p) => !p.may) ?? [...peers.values()][0], timer: setTimeout(() => flush(r), WRITE_MS), since: Date.now() }
  }
  const reread = (r: Room) => inTurn(r, async () => rereadNow(r))

  /** Each window hears how many others are in the note: typed in together only while there are some. */
  const counted = (r: Room) => { for (const ws of r.peers.keys()) { const p = peers.get(ws)?.see(r.path); if (p) send(ws, { t: "y-peers", path: p, others: r.peers.size - 1 }) } }

  /** The room of a vault path, made from its file the first time. */
  function roomOf(path: string): Room | null {
    let r = all.get(path)
    if (r) return r
    let text: string
    try { text = readText(plugin.vault.abs(path)) } catch { return null }
    if (text.length > ROOM_MAX) return null
    const doc = new Y.Doc({ gc: true }), aw = new Awareness(doc)
    aw.setLocalState(null) // (the server is no one)
    r = { path, doc, text: doc.getText("md"), aw, peers: new Map(), disk: text, pending: null, turn: Promise.resolve(), queued: new Map(), clients: new Map() }
    r.text.insert(0, text)
    const room = r
    doc.on("update", (u: Uint8Array, origin: unknown) => tell(room, origin === "disk" ? null : origin as WebSocket, { t: "y", u: toBase64(u) }))
    all.set(path, r)
    return r
  }

  function leave(ws: WebSocket, path: string) {
    const r = all.get(path), ids = r?.peers.get(ws)
    if (!r || !ids) return
    // (what they typed last, checked and kept as they go)
    const q = r.queued.get(ws), peer = peers.get(ws)
    if (q && peer) { clearTimeout(q.timer); check(r, ws, peer) }
    r.peers.delete(ws)
    for (const [id, w] of r.clients) if (w === ws) r.clients.delete(id)
    if (ids.size) {
      removeAwarenessStates(r.aw, [...ids], ws)
      tell(r, ws, { t: "aw", u: toBase64(encodeAwarenessUpdate(r.aw, [...ids])) })
    }
    counted(r)
    if (r.peers.size) return
    flush(r)
    void r.turn.then(() => { if (!r.peers.size && all.get(path) === r) { all.delete(path); r.aw.destroy(); r.doc.destroy() } })
  }

  /** The doc to a window, as it is; `alone`: a guest who can't type in it with others (too long) saves by themselves. */
  function sendState(r: Room, ws: WebSocket, peer: Peer) {
    const p = peer.see(r.path)
    if (!r.peers.has(ws) || p === null) return
    send(ws, { t: "y-state", path: p, u: toBase64(Y.encodeStateAsUpdate(r.doc)), aw: toBase64(encodeAwarenessUpdate(r.aw, [...r.aw.getStates().keys()])),
      edits: peer.edits, alone: !!peer.may && r.text.length > GUEST_LIVE_MAX, others: r.peers.size - 1 })
  }

  /** An awareness update from `ws` with its own states only (two at most), each named and coloured as the server knows
   *  it, its caret as y-codemirror gives one; null when it speaks for another's. */
  function ownStates(r: Room, ws: WebSocket, peer: Peer, u: Uint8Array): Uint8Array | null {
    const d = decoding.createDecoder(u), e = encoding.createEncoder(), mine = r.peers.get(ws)!
    const n = decoding.readVarUint(d)
    if (n > 2) return null
    encoding.writeVarUint(e, n)
    for (let i = 0; i < n; i++) {
      const id = decoding.readVarUint(d), clock = decoding.readVarUint(d), json = decoding.readVarString(d)
      if (json.length > 4000) return null
      for (const [other, ids] of r.peers) if (other !== ws && ids.has(id)) return null
      let state: Record<string, unknown> | null = null
      try { state = JSON.parse(json) } catch { return null }
      if (!mine.has(id) && mine.size >= 2 && state) return null
      if (state) mine.add(id); else mine.delete(id) // (a caret gone: room for its window's next)
      // (a fallback of each one's own: carets of one colour would share a label, as y-codemirror tells them apart by colour)
      if (state) state = { cursor: caretOf(state.cursor), user: { name: peer.name, color: `var(--${peer.tint}, #${(id % 0xffffff).toString(16).padStart(6, "0")})`, colorLight: `color-mix(in srgb, var(--${peer.tint}) 25%, transparent)` } }
      encoding.writeVarUint(e, id)
      encoding.writeVarUint(e, clock)
      encoding.writeVarString(e, JSON.stringify(state))
    }
    return encoding.toUint8Array(e)
  }

  /** Whether `u` writes only under `ws`'s own Yjs client ids (theirs once one of their changes lands: land). */
  function ownClients(r: Room, ws: WebSocket, u: Uint8Array) {
    const ids = new Set(Y.decodeUpdate(u).structs.map((s) => s.id.client))
    return [...ids].every((id) => id !== r.doc.clientID && (r.clients.get(id) ?? ws) === ws)
  }
  /** Whether the note's text holds only text: no embeds, formats or nested types, which no editor shows. */
  const onlyText = (t: Y.Text) => {
    for (let i = t._start; i; i = i.right) if (!(i.content instanceof Y.ContentString || i.content instanceof Y.ContentDeleted)) return false
    return t.length === t.toString().length
  }

  /** A change from `ws` into the doc as theirs (written back in their turn). */
  function land(r: Room, ws: WebSocket, peer: Peer, u: Uint8Array) {
    // (a write per person: another's turn writes what came before this)
    if (r.pending && r.pending.peer !== peer) flush(r)
    const was = r.text.toString()
    Y.applyUpdate(r.doc, u, ws)
    for (const s of Y.decodeUpdate(u).structs) r.clients.set(s.id.client, ws)
    if (r.text.toString() === was) return
    const since = r.pending?.since ?? Date.now()
    if (r.pending) clearTimeout(r.pending.timer)
    // (a pause writes it, and so does a long stretch of typing, now and then)
    r.pending = { peer, since, timer: setTimeout(() => flush(r), Date.now() - since > WRITE_MAX_MS ? 0 : WRITE_MS) }
  }

  /** A guest's waiting changes, checked together on a copy: they land only as the file would take them from them, and
   *  only as text (nothing waiting on what isn't there, nothing but the note's text). */
  function check(r: Room, ws: WebSocket, peer: Peer) {
    const q = r.queued.get(ws)
    r.queued.delete(ws)
    if (!q || !r.peers.has(ws)) return
    const p = peer.see(r.path) ?? undefined
    // (refused, the window gets the note as it is, to type on from there)
    const no = (why = "") => { send(ws, { t: "y-reject", path: p, why }); sendState(r, ws, peer) }
    const u = Y.mergeUpdates(q.updates), copy = new Y.Doc()
    try {
      const { structs } = Y.decodeUpdate(u), ids = new Set(structs.map((s) => s.id.client))
      const claimed = [...r.clients.entries()].filter(([id, w]) => w === ws && !ids.has(id)).length
      if (u.length > MAX_UPDATE || structs.length > MAX_STRUCTS || ids.size > MAX_IDS || claimed + ids.size > IDS_PER_WINDOW || !ownClients(r, ws, u)) return no()
      Y.applyUpdate(copy, Y.encodeStateAsUpdate(r.doc))
      Y.applyUpdate(copy, u)
      if (copy.store.pendingStructs || copy.store.pendingDs || [...copy.share.keys()].some((k) => k !== "md") || !onlyText(copy.getText("md"))) return no()
      if (Y.encodeStateAsUpdate(copy).length > 4 * GUEST_LIVE_MAX + 256_000) return no("this note has been typed in too much to go on together: reopen it")
      const before = r.text.toString(), after = copy.getText("md").toString()
      const why = after === before ? "" : after.length > GUEST_LIVE_MAX ? "this note is too long to type in together" : peer.may!(r.path, before, after)
      if (why) return no(why)
      land(r, ws, peer, u)
    } catch { no() } finally { copy.destroy() }
  }

  return {
    /** A window's socket joins: who it is. */
    add(ws: WebSocket, peer: Peer) {
      peers.set(ws, peer)
      ws.on("close", () => { for (const [path, r] of all) if (r.peers.has(ws)) leave(ws, path); peers.delete(ws) })
    },

    /** A message about a room (`path` already the vault's, or null when it isn't one the window may name): true when it
     *  was one. */
    heard(ws: WebSocket, m: Record<string, unknown>, path: string | null) {
      const peer = peers.get(ws)
      if (!peer || typeof m.t !== "string" || !m.t.startsWith("y") && m.t !== "aw") return false
      if (!path || !/\.md$/i.test(path)) return true
      const p = peer.see(path)
      if (p === null) return true
      if (m.t === "y-open") {
        // (again after a window saved what it had typed alone: the doc as the file has it now)
        if (over(ws, "open", OPENS)) return true
        const r = roomOf(path)
        if (!r) return true
        const fresh = !r.peers.has(ws)
        if (fresh) r.peers.set(ws, new Set())
        void inTurn(r, async () => {
          rereadNow(r)
          sendState(r, ws, peer)
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
        try { u = ownStates(r, ws, peer, fromBase64(m.u)) } catch { /* not an update */ }
        if (!u) return true
        applyAwarenessUpdate(r.aw, u, ws)
        tell(r, ws, { t: "aw", u: toBase64(u) })
      } else if (m.t === "y" && typeof m.u === "string") {
        if (!peer.edits || m.u.length > MAX_UPDATE || peer.slow?.()) return send(ws, { t: "y-reject", path: p }), sendState(r, ws, peer), true
        let u: Uint8Array
        try { u = fromBase64(m.u) } catch { return true }
        if (!peer.may) {
          try { if (ownClients(r, ws, u)) land(r, ws, peer, u) } catch { send(ws, { t: "y-reject", path: p }) }
          return true
        }
        const q = r.queued.get(ws) ?? { updates: [], timer: setTimeout(() => check(r, ws, peer), CHECK_MS) }
        q.updates.push(u)
        r.queued.set(ws, q)
      }
      return true
    },

    /** Files changed (on disk, or written): open notes take what isn't their own. */
    changed(paths: string[] | null) {
      for (const r of all.values()) if (paths === null || paths.includes(r.path)) void reread(r)
    },

    /** Notes open now and who's in each (tests, status). */
    list: () => [...all.values()].map((r) => ({ path: r.path, peers: r.peers.size, text: r.text.toString() })),
  }
}
