import { isolateHistory } from "@codemirror/commands"
import { Annotation, StateEffect, StateField, type Text, Transaction } from "@codemirror/state"
import { Decoration, type DecorationSet, EditorView } from "@codemirror/view"
import { heldByConflict, notify, notifyError, op, speakingIn } from "@vaultite"
import { type EditAsk, getState, liveAgents, say, setTyping, type StreamMsg, tintOf, typing, views } from "./live"
import { nearest } from "./text"

export const own = Annotation.define<boolean>()
export const refresh = StateEffect.define<null>()


export const lit = StateEffect.define<{ from: number; to: number; tint: string } | null>()
export const typed = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes)
    for (const e of tr.effects) {
      if (!e.is(lit)) continue
      if (!e.value) deco = Decoration.none
      else if (e.value.to > e.value.from) deco = deco.update({ add: [Decoration.mark({ class: "cm-companion-typed", attributes: { style: `--c: ${e.value.tint}` } }).range(e.value.from, e.value.to)] })
    }
    return deco
  },
  provide: (f) => EditorView.decorations.from(f),
})

const spanIs = StateEffect.define<{ from: number; at: number; to: number } | null>()
export const span = StateField.define<{ from: number; at: number; to: number } | null>({
  create: () => null,
  update(v, tr) {
    for (const e of tr.effects) if (e.is(spanIs)) return e.value
    if (!v || !tr.docChanged) return v
    const to = tr.changes.mapPos(v.to, -1)
    return { from: Math.min(to, tr.changes.mapPos(v.from, 1)), at: Math.min(to, tr.changes.mapPos(v.at, 1)), to }
  },
  provide: (f) => EditorView.decorations.from(f, (v) => (v && v.at < v.to ? Decoration.set([Decoration.mark({ class: "cm-companion-veiled" }).range(v.at, v.to)]) : Decoration.none)),
})

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function placeIn(doc: Text, e: Omit<EditAsk, "rid" | "agent" | "text">): { from: number; to: number; lead: string; tail: string } {
  const all = doc.toString()
  if (e.find !== undefined && e.find !== "") {
    const from = nearest(all, e.find, e.line)
    if (from < 0) throw new Error(`"${e.find.slice(0, 60)}" isn't in the note any more`)
    return { from, to: from + e.find.length, lead: "", tail: "" }
  }
  if (e.after) {
    const i = nearest(all, e.after, e.line)
    if (i < 0) throw new Error(`"${e.after.slice(0, 60)}" isn't in the note any more`)
    const at = doc.lineAt(i + e.after.length).to
    return { from: at, to: at, lead: "\n", tail: "" }
  }
  if (e.append || e.line === undefined) return !all || all.endsWith("\n") ? { from: all.length, to: all.length, lead: "", tail: "\n" } : { from: all.length, to: all.length, lead: "\n", tail: "" }
  if (e.line <= 0) return { from: 0, to: 0, lead: "", tail: "\n" }
  const at = doc.line(Math.min(e.line, doc.lines)).to
  return { from: at, to: at, lead: "\n", tail: "" }
}
const wordsFor = (text: string, p: { lead: string; tail: string }) => (p.lead || p.tail ? text.replace(/\n$/, "") : text)
const caretAfter = (v: EditorView, at: number, to: number) => {
  const s = v.state.selection
  return s.ranges.length === 1 && s.main.empty && s.main.head === at ? { selection: { anchor: to } } : {}
}

const ownEdit = [own.of(true), Transaction.userEvent.of("input.companion"), isolateHistory.of("full")]

export const userTyped = new WeakMap<EditorView, number>()
const YIELD_MS = 700
const typingNow = (view: EditorView) => Date.now() - (userTyped.get(view) ?? 0) < YIELD_MS || speakingIn(view)
const halted = new WeakSet<EditorView>()

const HELD = "the note has a conflict the user hasn't settled: nothing typed in it is saved until they choose what to keep, so try again after"

export async function type(view: EditorView, e: EditAsk) {
  if (e.rid && e.path && heldByConflict(e.path)) throw new Error(HELD)
  const p = placeIn(view.state.doc, e), { from, to } = p
  const text = p.lead + wordsFor(e.text, p) + p.tail, removed = view.state.sliceDoc(from, to)
  const animate = e.animate !== false && document.visibilityState === "visible" && !matchMedia("(prefers-reduced-motion: reduce)").matches
  halted.delete(view)
  view.dispatch({ changes: { from, to, insert: text }, effects: spanIs.of({ from, at: animate ? from : from + text.length, to: from + text.length }), annotations: ownEdit,
    ...(!p.lead && from === to ? caretAfter(view, from, from + text.length) : {}) })
  if (animate) {
    const size = Math.ceil(text.length / Math.max(1, Math.round(Math.min(1600, text.length * 14) / 16)))
    for (let s = view.state.field(span); s && s.at < s.to && view.dom.isConnected && !halted.has(view); s = view.state.field(span)) {
      if (typingNow(view)) { await sleep(100); continue }
      const at = Math.min(s.to, s.at + size)
      view.dispatch({ effects: spanIs.of({ ...s, at }) })
      setTyping({ view, pos: at, agent: e.agent })
      await sleep(16)
    }
  }
  const s = view.state.field(span)
  view.dispatch({ effects: [spanIs.of(null), ...(s ? [lit.of({ from: s.from, to: s.to, tint: tintOf(e.agent) }), lastIs.of({ from: s.from, to: s.to, removed, text, agent: e.agent })] : [])] })
  setTyping(null)
  setTimeout(() => { if (view.dom.isConnected) view.dispatch({ effects: lit.of(null) }) }, 4500)
}


const streamIs = StateEffect.define<{ rid: string; from: number; to: number } | null>()
export const streamAt = StateField.define<{ rid: string; from: number; to: number } | null>({
  create: () => null,
  update(v, tr) {
    for (const e of tr.effects) if (e.is(streamIs)) return e.value
    return v && tr.docChanged ? { ...v, from: tr.changes.mapPos(v.from, 1), to: Math.max(tr.changes.mapPos(v.from, 1), tr.changes.mapPos(v.to, -1)) } : v
  },
})
type Live = { rid: string; view: EditorView; agent: string; lead: string; tail: string; removed: string; text: string; queued: string; timer: ReturnType<typeof setTimeout> | null
  ask?: EditAsk; end?: string }
const live = new Map<string, Live>()

export function streamMsg(view: EditorView | null, m: StreamMsg) {
  if (m.t === "stream") return openStream(view!, m.m)
  if (m.t === "cut") { for (const L of [...live.values()]) endStream(L, null); return }
  const L = live.get(m.rid)
  if (!L) return
  if (m.t === "more") { if (m.at === L.text.length + L.queued.length) { L.queued += m.add; flushSoon(L) } }
  else endStream(L, m.text)
}

function openStream(view: EditorView, e: EditAsk) {
  const L: Live = { rid: e.rid, view, agent: e.agent, lead: "", tail: "", removed: "", text: "", queued: e.text, timer: null, ask: e }
  live.set(e.rid, L)
  halted.delete(view)
  place(L)
}
function whenStill(L: Live, fn: () => void) {
  if (L.timer) clearTimeout(L.timer)
  L.timer = setTimeout(() => { L.timer = null; fn() }, Math.max(16, YIELD_MS - (Date.now() - (userTyped.get(L.view) ?? 0))))
}
function place(L: Live) {
  const view = L.view, e = L.ask!
  if (!view.dom.isConnected) { live.delete(L.rid); return say({ t: "done", rid: L.rid, ok: false }) }
  if (typingNow(view)) return whenStill(L, () => place(L))
  if (e.path && heldByConflict(e.path)) { live.delete(L.rid); return say({ t: "done", rid: e.rid, ok: false, error: HELD }) }
  let p: ReturnType<typeof placeIn>
  try { p = placeIn(view.state.doc, e) } catch (err) { live.delete(L.rid); return say({ t: "done", rid: e.rid, ok: false, error: (err as Error).message }) }
  Object.assign(L, { lead: p.lead, tail: p.tail, removed: view.state.sliceDoc(p.from, p.to), ask: undefined })
  view.dispatch({ changes: { from: p.from, to: p.to, insert: p.lead + p.tail }, effects: streamIs.of({ rid: e.rid, from: p.from, to: p.from + p.lead.length }),
    annotations: [own.of(true), Transaction.userEvent.of("input.companion"), Transaction.addToHistory.of(false)],
    ...(!p.lead && p.from === p.to ? caretAfter(view, p.from, p.from + p.tail.length) : {}) })
  if (L.end !== undefined) endStream(L, L.end); else flush(L)
}

function flushSoon(L: Live) {
  if (L.timer) return
  const wait = typingNow(L.view) ? YIELD_MS - (Date.now() - (userTyped.get(L.view) ?? 0)) : 24
  L.timer = setTimeout(() => { L.timer = null; flush(L) }, Math.max(16, wait))
}
function flush(L: Live) {
  const f = L.view.state.field(streamAt, false)
  if (!L.queued || !f || f.rid !== L.rid || !L.view.dom.isConnected) return
  if (typingNow(L.view)) return flushSoon(L)
  const add = L.queued
  L.queued = ""
  L.text += add
  L.view.dispatch({ changes: { from: f.to, insert: add }, effects: streamIs.of({ ...f, to: f.to + add.length }),
    annotations: [own.of(true), Transaction.userEvent.of("input.companion"), Transaction.addToHistory.of(false)], ...caretAfter(L.view, f.to, f.to + add.length) })
  setTyping({ view: L.view, pos: f.to + add.length, agent: L.agent })
}

function endStream(L: Live, text: string | null) {
  if (text !== null && (L.ask || typingNow(L.view))) { L.end = text; if (!L.ask) whenStill(L, () => endStream(L, text)); return }
  live.delete(L.rid)
  if (L.timer) clearTimeout(L.timer)
  if (L.ask) return say({ t: "done", rid: L.rid, ok: true, text: "", stopped: true })
  const v = L.view, f = v.state.field(streamAt, false), stopped = text === null
  const words = text ?? L.text + L.queued
  if (!f || f.rid !== L.rid || !v.dom.isConnected) return say({ t: "done", rid: L.rid, ok: false, error: "the note closed as it was typed" })
  const start = f.from, end = f.to + L.tail.length
  const want = L.lead + wordsFor(words, L) + L.tail
  if (v.state.sliceDoc(start, end) === L.lead + L.text + L.tail) {
    const after = caretAfter(v, end, start + want.length)
    v.dispatch({ changes: { from: start, to: end, insert: L.removed }, annotations: [own.of(true), Transaction.addToHistory.of(false)] })
    v.dispatch({ changes: { from: start, to: start + L.removed.length, insert: want }, annotations: ownEdit, ...after,
      effects: [streamIs.of(null), lit.of({ from: start, to: start + want.length, tint: tintOf(L.agent) }), lastIs.of({ from: start, to: start + want.length, removed: L.removed, text: want, agent: L.agent })] })
  } else {
    const rest = words.startsWith(L.text) ? words.slice(L.text.length) : ""
    v.dispatch({ ...(rest ? { changes: { from: f.to, insert: rest }, ...caretAfter(v, f.to, f.to + rest.length) } : {}), annotations: ownEdit, effects: [streamIs.of(null), lit.of({ from: f.from, to: f.to + rest.length, tint: tintOf(L.agent) })] })
  }
  setTyping(null)
  setTimeout(() => { if (v.dom.isConnected) v.dispatch({ effects: lit.of(null) }) }, 4500)
  say({ t: "done", rid: L.rid, ok: true, text: words, ...(stopped ? { stopped: true } : {}) })
}

function haltTyping(view: EditorView): string[] {
  const names = new Set<string>()
  for (const L of [...live.values()]) if (L.view === view) { endStream(L, null); names.add(L.agent) }
  const s = view.state.field(span, false)
  if (s && s.at < s.to) { halted.add(view); if (typing?.view === view) names.add(typing.agent) }
  return [...names]
}

export function stopTyping(view: EditorView) {
  const names = haltTyping(view)
  for (const n of names) interrupt(n)
  return names.length > 0
}
export function stopThinking(path: string) {
  const busy = liveAgents().filter((a) => a.path === path && (a.state === "thinking" || a.state === "writing"))
  for (const a of busy) interrupt(a.name)
  return busy.length > 0
}
const interrupt = (name: string) => void op("companion.interrupt", name.toLowerCase() === getState().name.toLowerCase() ? {} : { as: name }).catch((e) => notifyError(e, `Couldn't stop ${name}`))


const lastIs = StateEffect.define<{ from: number; to: number; removed: string; text: string; agent: string } | null>()
export const lastEdit = StateField.define<{ from: number; to: number; removed: string; text: string; agent: string } | null>({
  create: () => null,
  update(v, tr) {
    for (const e of tr.effects) if (e.is(lastIs)) return e.value
    return v && tr.docChanged ? { ...v, from: tr.changes.mapPos(v.from, 1), to: tr.changes.mapPos(v.to, -1) } : v
  },
})
export function undoLast(agent?: string): boolean {
  const mine = (v: EditorView) => { const e = v.state.field(lastEdit, false); return !!e && (!agent || e.agent === agent) }
  const vs = [...views.keys()].filter((v) => v.dom.isConnected && mine(v))
  const v = vs.find((x) => x.hasFocus) ?? vs[0]
  const e = v?.state.field(lastEdit, false)
  if (!v || !e) { notify("No edit of the companion's to undo here"); return false }
  if (v.state.sliceDoc(e.from, e.to) !== e.text) { notify(`${e.agent}'s last edit was changed since: undo it by hand`); return false }
  v.dispatch({ changes: { from: e.from, to: e.to, insert: e.removed }, effects: lastIs.of(null), userEvent: "delete.companion", annotations: isolateHistory.of("full"), scrollIntoView: true })
  return true
}