// Typing in a note with whoever else has it open (the user's other windows, guests): a Y.Doc the server keeps (rooms.ts),
// carets named and coloured. Alone, the editor saves as ever; once someone comes, it saves, then both type into the doc.
import { Compartment, EditorState, type Extension, Transaction } from "@codemirror/state"
import { EditorView, ViewPlugin } from "@codemirror/view"
import { fromBase64, toBase64 } from "lib0/buffer"
import { yCollab, ySyncAnnotation } from "y-codemirror.next"
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate, removeAwarenessStates } from "y-protocols/awareness"
import * as Y from "yjs"
import { keepLive, merge3, notify, settleFile } from "@vaultite"
import { getState, type Person, say, setPeople, setRooms, subscribe } from "./live"
import { span } from "./text"

/** A note open here: its doc as the server has it (`ready`), the editors showing it, whether they type into it now
 *  (`bound`, while `others` are in it too) and the autosave's stand-down meanwhile (`release`). */
type Room = { path: string; doc: Y.Doc; text: Y.Text; aw: Awareness; views: Set<EditorView>; ready: boolean; bound: boolean; others: number
  release: (() => void) | null; joining: boolean
  /** Saving alone even with others (the server says: a guest in a note too long to type in together). */
  alone: boolean
  /** Saved alone, just before asking for the doc: the text then, so what's typed till it comes isn't lost. */
  settled: string | null
  /** Typed in on another machine's rooms, which writes it (its guests are there: bridge.ts): bound even alone, and the
   *  text as that machine last sent it (`synced`), what's typed here since goes back in if it goes and comes back. */
  remote: boolean; synced: string | null }
const rooms = new Map<string, Room>()
const slot = new Compartment()
/** What the others typed comes in as the server's: not this window's to save, nor to undo. */
const theirs = EditorState.transactionExtender.of((tr) => (tr.annotation(ySyncAnnotation) !== undefined ? { annotations: [Transaction.remote.of(true), Transaction.addToHistory.of(false)] } : null))

/** A fresh doc for the room (its first, or the server's again). */
function fresh(r: Room) {
  r.aw?.destroy()
  r.doc?.destroy()
  const doc = new Y.Doc(), aw = new Awareness(doc)
  Object.assign(r, { doc, text: doc.getText("md"), aw })
  doc.on("update", (u: Uint8Array, origin: unknown) => {
    if (origin === "server") { if (r.remote) r.synced = r.text.toString() } else if (r.bound) say({ t: "y", path: r.path, u: toBase64(u) })
  })
  aw.on("update", ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
    if (origin === "local" && r.bound) say({ t: "aw", path: r.path, u: toBase64(encodeAwarenessUpdate(aw, [...added, ...updated, ...removed])) })
    tellPeople(r)
  })
}

function open(path: string): Room {
  const r = { path, views: new Set(), ready: false, bound: false, others: 0, release: null, joining: false, settled: null, alone: false, remote: false, synced: null } as unknown as Room
  fresh(r)
  rooms.set(path, r)
  if (getState().connected) say({ t: "y-open", path })
  return r
}

function tellPeople(r: Room) {
  const list: Person[] = []
  if (r.bound) for (const [id, s] of r.aw.getStates()) {
    const u = (s as { user?: { name?: string; color?: string } }).user
    if (id !== r.doc.clientID && u?.name) list.push({ id, name: u.name, color: u.color ?? "var(--muted-foreground)" })
  }
  setPeople(r.path, list)
}

/** Its editors type into the doc, showing it as it is; what was typed since `settled` (saved) goes into it as theirs. */
function bind(r: Room) {
  r.bound = true
  r.release ??= keepLive(r.path)
  const text = r.text.toString(), first = [...r.views].find((v) => v.dom.isConnected)
  const typed = first && r.settled !== null && first.state.doc.toString() !== r.settled ? merge3(r.settled, first.state.doc.toString(), text) : null
  r.settled = null
  for (const v of r.views) {
    if (v.state.doc.toString() !== text) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: text }, annotations: [Transaction.remote.of(true), Transaction.addToHistory.of(false)] })
    v.dispatch({ effects: slot.reconfigure([yCollab(r.text, r.aw, { undoManager: false }), theirs]) })
  }
  if (first && typed !== null && typed !== text) {
    const [a, b] = span(text, typed)
    first.dispatch({ changes: { from: a, to: text.length - b, insert: typed.slice(a, typed.length - b) } })
  }
  r.aw.setLocalStateField("user", { name: "" }) // (the server says who: its name and colour)
}

/** Back to saving alone: at once, saving what the server may not have (the socket went); `going`: a moment later, as
 *  the editor goes with it (what the others typed last is the server's to write, not this one's autosave). */
function unbind(r: Room, how: "alone" | "going" | "again" = "alone") {
  if (!r.bound) return
  r.bound = false
  for (const v of r.views) if (v.dom.isConnected) v.dispatch({ effects: slot.reconfigure([]) })
  // (its caret goes from the others' screens)
  removeAwarenessStates(r.aw, [r.doc.clientID], "gone")
  if (getState().connected) say({ t: "aw", path: r.path, u: toBase64(encodeAwarenessUpdate(r.aw, [r.doc.clientID])) })
  tellPeople(r)
  const release = r.release
  r.release = null
  if (!release) return
  if (how === "going") setTimeout(release, 2000)
  else { release(); if (how === "alone") void settleFile(r.path) }
}

/** Off another machine's rooms: what it last sent is where typing here goes back in from, when it's back. */
function away(r: Room) {
  if (r.remote && r.bound) r.settled = r.synced ?? r.text.toString()
  r.remote = false
  r.ready = false
  r.others = 0
}

/** Someone else came: what was typed here alone is saved first, then the doc as the server has it is typed into. */
async function together(r: Room) {
  if (r.bound || r.joining) return
  r.joining = true
  try { await settleFile(r.path) } finally { r.joining = false }
  r.settled = [...r.views].find((v) => v.dom.isConnected)?.state.doc.toString() ?? null
  if (rooms.get(r.path) === r && (r.others > 0 || r.remote) && getState().connected) say({ t: "y-open", path: r.path })
}

function close(r: Room) {
  unbind(r, "going")
  rooms.delete(r.path)
  if (getState().connected) say({ t: "y-close", path: r.path })
  setPeople(r.path, [])
  r.aw.destroy()
  r.doc.destroy()
}

function heard(m: Record<string, unknown>) {
  const r = typeof m.path === "string" ? rooms.get(m.path) : undefined
  if (!r) return
  if (m.t === "y-state" && typeof m.u === "string") {
    unbind(r, "again")
    r.remote = m.remote === true
    fresh(r)
    Y.applyUpdate(r.doc, fromBase64(m.u), "server")
    if (typeof m.aw === "string") applyAwarenessUpdate(r.aw, fromBase64(m.aw), "server")
    r.ready = true
    r.others = Number(m.others) || 0
    r.alone = m.alone === true
    // (with others, or on another machine: once what was typed here alone is saved, and asked for again)
    if ((r.others > 0 || r.remote) && !r.alone) { if (r.settled !== null) bind(r); else void together(r) }
  } else if (m.t === "y-peers") {
    r.others = Number(m.others) || 0
    if (r.others === 0) { if (!r.remote) unbind(r) }
    else if (!r.bound && !r.alone) void together(r)
  } else if (m.t === "y-gone") {
    // (that machine went, or stopped sharing it: saved here again, and asked for here)
    away(r)
    unbind(r)
    if (getState().connected) say({ t: "y-open", path: r.path })
  } else if (m.t === "y" && typeof m.u === "string") Y.applyUpdate(r.doc, fromBase64(m.u), "server")
  else if (m.t === "aw" && typeof m.u === "string") applyAwarenessUpdate(r.aw, fromBase64(m.u), "server")
  else if (m.t === "y-clash") notify(m.kept === "file" ? "Someone changed the same lines on disk as you typed: theirs stayed" : "Someone changed the same lines on disk as you typed: yours stayed, theirs is in the note's history", { id: "cotype-clash" })
  else if (m.t === "y-reject") {
    // (what was typed here didn't land: the server sends the note as it is, nothing here to keep)
    if (typeof m.why === "string" && m.why) notify(`That change wasn't kept: ${m.why}`, { kind: "error", id: "cotype-reject" })
    r.settled = [...r.views].find((v) => v.dom.isConnected)?.state.doc.toString() ?? ""
  }
}

function join(path: string, v: EditorView) {
  const r = rooms.get(path) ?? open(path)
  r.views.add(v)
  if (r.bound) bind(r)
}

function leave(path: string, v: EditorView) {
  const r = rooms.get(path)
  if (!r?.views.delete(v)) return
  if (!r.views.size) close(r)
}

// (the socket went: each note on its own again, saving alone; back, they join again)
let was = getState().connected
subscribe(() => {
  const now = getState().connected
  if (now === was) return
  was = now
  for (const r of rooms.values()) {
    if (!now) { away(r); unbind(r) } else say({ t: "y-open", path: r.path })
  }
})

setRooms({
  heard,
  goTo: (path, id) => {
    const r = rooms.get(path), s = r?.aw.getStates().get(id) as { cursor?: { head?: unknown } } | undefined
    const v = r && [...r.views].find((x) => x.dom.isConnected)
    if (!r || !v || !s?.cursor?.head) return
    const at = Y.createAbsolutePositionFromRelativePosition(Y.createRelativePositionFromJSON(s.cursor.head), r.doc)
    if (at) v.dispatch({ effects: EditorView.scrollIntoView(Math.min(at.index, v.state.doc.length), { y: "center" }) })
  },
})

/** A note's editor joins its room (a markdown note with a path): typed in with the others there. */
export function cotype(path: string): Extension {
  return [slot.of([]), ViewPlugin.define((v) => {
    join(path, v)
    return { destroy: () => leave(path, v) }
  })]
}
