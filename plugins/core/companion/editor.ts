// The companion in a note's editor: what the user writes said after a pause (and a line with @claude at Enter), the
// agents' highlights, comments' anchors and suggestions drawn in the text, Tab and Esc for a suggestion, and edits typed in.
import { closeCompletion, type Completion, type CompletionContext, completionStatus, selectedCompletion, startCompletion } from "@codemirror/autocomplete"
import { isolateHistory } from "@codemirror/commands"
import { Annotation, ChangeSet, EditorState, type Extension, Prec, RangeSetBuilder, StateEffect, StateField, type Text, Transaction } from "@codemirror/state"
import { Decoration, type DecorationSet, EditorView, keymap, showTooltip, type Tooltip, ViewPlugin, type ViewUpdate, WidgetType } from "@codemirror/view"
import { capitalize, dictation, keyHint, type MenuItem, notify, notifyError, onDictation, op, pluginSettings, share, speakingIn, type EditorCtx } from "@vaultite"
import { MessageCircle } from "lucide-react"
import { authorAt } from "@plugins/provenance/gutter"
import { cotype } from "./cotype"
import { effortName } from "./look"
import { accept, answer, asksSomething, bump, hear, canMention, type EditAsk, getState, type How, howOf, howText, hideSay, hunksIn, setFolder, shownFor, listen, liveAgents, mentionAgent, mentionIn, mentionNames, mentionsOf, midNames, nameAs, type Note, say, sayWhere, sendMoment, setStreamer, setTyper, setTyping, setUndoer, type StreamMsg, sayWhereSoon, subscribe, threadTint, tintOf, typing, viewOf, views } from "./live"
import { privateNote } from "./private"
import { decide, proposals } from "./proposed"
import { nearest } from "./text"

/** Its own changes: not the user's, so not said back as theirs. */
const own = Annotation.define<boolean>()
const refresh = StateEffect.define<null>()

// ---------- what an agent just typed, lit in its colour for a few seconds

const lit = StateEffect.define<{ from: number; to: number; tint: string } | null>()
const typed = StateField.define<DecorationSet>({
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

/** What an agent is typing: already in the note in one change (so nothing the user types can split it), shown a few
 *  letters a frame from `at`, the rest veiled. */
const spanIs = StateEffect.define<{ from: number; at: number; to: number } | null>()
const span = StateField.define<{ from: number; at: number; to: number } | null>({
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

/** Where edit `e` goes in `doc`: from..to replaced by `lead`, its words and `tail` (new lines get a line break before
 *  them, or after them at the top and at the end of a note that ends with one). */
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
/** Its words as new lines take them: without the line break they end with (lead or tail gives the one they need). */
const wordsFor = (text: string, p: { lead: string; tail: string }) => (p.lead || p.tail ? text.replace(/\n$/, "") : text)
/** The user's caret where an agent's words go in at `at` (they end at `to`): after them, so what the user types next
 *  follows its words instead of going in front of them on its line. */
const caretAfter = (v: EditorView, at: number, to: number) => {
  const s = v.state.selection
  return s.ranges.length === 1 && s.main.empty && s.main.head === at ? { selection: { anchor: to } } : {}
}

/** Its edits are their own undo steps: never joined with what the user types next to them, nor theirs with its. */
const ownEdit = [own.of(true), Transaction.userEvent.of("input.companion"), isolateHistory.of("full")]

/** When the user last typed in each editor: an agent typing in waits for them to stop. */
const userTyped = new WeakMap<EditorView, number>()
const YIELD_MS = 700
// (dictating counts as typing until the user pauses: never an agent's words in a sentence being said)
const typingNow = (view: EditorView) => Date.now() - (userTyped.get(view) ?? 0) < YIELD_MS || speakingIn(view)
/** Editors whose agent's typing the user stopped (Esc): the rest shows at once. */
const halted = new WeakSet<EditorView>()

/** Type edit `e` into `view`: find replaced (or new lines after the line with after, after line, or at the end). */
async function type(view: EditorView, e: EditAsk) {
  const p = placeIn(view.state.doc, e), { from, to } = p
  const text = p.lead + wordsFor(e.text, p) + p.tail, removed = view.state.sliceDoc(from, to)
  const animate = e.animate !== false && document.visibilityState === "visible" && !matchMedia("(prefers-reduced-motion: reduce)").matches
  halted.delete(view)
  // (a caret before a line break it adds stays on its own line)
  view.dispatch({ changes: { from, to, insert: text }, effects: spanIs.of({ from, at: animate ? from : from + text.length, to: from + text.length }), annotations: ownEdit,
    ...(!p.lead && from === to ? caretAfter(view, from, from + text.length) : {}) })
  if (animate) {
    const size = Math.ceil(text.length / Math.max(1, Math.round(Math.min(1600, text.length * 14) / 16)))
    for (let s = view.state.field(span); s && s.at < s.to && view.dom.isConnected && !halted.has(view); s = view.state.field(span)) {
      // (the user typing: it waits for them)
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
setTyper(type)

// ---------- an edit typed in as the model writes it

/** The edit streaming into an editor: from its start (its lead) to the end of its words so far (its tail after them),
 *  mapped as the note changes; what the user types just before it or just after its words stays outside it. */
const streamIs = StateEffect.define<{ rid: string; from: number; to: number } | null>()
const streamAt = StateField.define<{ rid: string; from: number; to: number } | null>({
  create: () => null,
  update(v, tr) {
    for (const e of tr.effects) if (e.is(streamIs)) return e.value
    return v && tr.docChanged ? { ...v, from: tr.changes.mapPos(v.from, 1), to: Math.max(tr.changes.mapPos(v.from, 1), tr.changes.mapPos(v.to, -1)) } : v
  },
})
type Live = { rid: string; view: EditorView; agent: string; lead: string; tail: string; removed: string; text: string; queued: string; timer: ReturnType<typeof setTimeout> | null
  /** Its edit, until its place is made (held while the user types); its last words, held likewise. */
  ask?: EditAsk; end?: string }
const live = new Map<string, Live>()

function streamMsg(view: EditorView | null, m: StreamMsg) {
  if (m.t === "stream") return openStream(view!, m.m)
  // (no server to say more: what's in stays, one undo step, and its cursor goes)
  if (m.t === "cut") { for (const L of [...live.values()]) endStream(L, null); return }
  const L = live.get(m.rid)
  if (!L) return
  if (m.t === "more") { if (m.at === L.text.length + L.queued.length) { L.queued += m.add; flushSoon(L) } }
  else endStream(L, m.text)
}
setStreamer(streamMsg)

function openStream(view: EditorView, e: EditAsk) {
  const L: Live = { rid: e.rid, view, agent: e.agent, lead: "", tail: "", removed: "", text: "", queued: e.text, timer: null, ask: e }
  live.set(e.rid, L)
  halted.delete(view)
  place(L)
}
/** Wait for the user to stop typing, then `fn`. */
function whenStill(L: Live, fn: () => void) {
  if (L.timer) clearTimeout(L.timer)
  L.timer = setTimeout(() => { L.timer = null; fn() }, Math.max(16, YIELD_MS - (Date.now() - (userTyped.get(L.view) ?? 0))))
}
/** Its place made in the note (`find` taken out), once the user isn't typing. */
function place(L: Live) {
  const view = L.view, e = L.ask!
  if (!view.dom.isConnected) { live.delete(L.rid); return say({ t: "done", rid: L.rid, ok: false }) }
  if (typingNow(view)) return whenStill(L, () => place(L))
  let p: ReturnType<typeof placeIn>
  try { p = placeIn(view.state.doc, e) } catch (err) { live.delete(L.rid); return say({ t: "done", rid: e.rid, ok: false, error: (err as Error).message }) }
  Object.assign(L, { lead: p.lead, tail: p.tail, removed: view.state.sliceDoc(p.from, p.to), ask: undefined })
  // (out of the history while it comes: all of it is one undo step once it ends)
  view.dispatch({ changes: { from: p.from, to: p.to, insert: p.lead + p.tail }, effects: streamIs.of({ rid: e.rid, from: p.from, to: p.from + p.lead.length }),
    annotations: [own.of(true), Transaction.userEvent.of("input.companion"), Transaction.addToHistory.of(false)],
    ...(!p.lead && p.from === p.to ? caretAfter(view, p.from, p.from + p.tail.length) : {}) })
  if (L.end !== undefined) endStream(L, L.end); else flush(L)
}

/** Its next words, once the user isn't typing. */
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

/** The stream ends with `text` (all its words; null: stopped, with what it has): one undo step for all of it, unless the
 *  user wrote inside it meanwhile (then only the rest goes in, after what it typed). */
function endStream(L: Live, text: string | null) {
  // (its last words wait for the user to stop typing too; Esc or a lost connection end it at once)
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
    // (a caret right after its words stays after them, all of them)
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

/** Esc in `view`: what an agent is typing there stops where it is (what's in already shown at once): who was typing. */
function haltTyping(view: EditorView): string[] {
  const names = new Set<string>()
  for (const L of [...live.values()]) if (L.view === view) { endStream(L, null); names.add(L.agent) }
  const s = view.state.field(span, false)
  if (s && s.at < s.to) { halted.add(view); if (typing?.view === view) names.add(typing.agent) }
  return [...names]
}

/** Esc where an agent types: it stops there, and so does its turn. */
function stopTyping(view: EditorView) {
  const names = haltTyping(view)
  for (const n of names) interrupt(n)
  return names.length > 0
}
/** Esc in a note an agent is thinking over or writing in: its turn stops. */
function stopThinking(path: string) {
  const busy = liveAgents().filter((a) => a.path === path && (a.state === "thinking" || a.state === "writing"))
  for (const a of busy) interrupt(a.name)
  return busy.length > 0
}
const interrupt = (name: string) => void op("companion.interrupt", name.toLowerCase() === getState().name.toLowerCase() ? {} : { as: name }).catch((e) => notifyError(e, `Couldn't stop ${name}`))

// ---------- its last edit, to undo by itself after the user has typed on

const lastIs = StateEffect.define<{ from: number; to: number; removed: string; text: string; agent: string } | null>()
const lastEdit = StateField.define<{ from: number; to: number; removed: string; text: string; agent: string } | null>({
  create: () => null,
  update(v, tr) {
    for (const e of tr.effects) if (e.is(lastIs)) return e.value
    return v && tr.docChanged ? { ...v, from: tr.changes.mapPos(v.from, 1), to: tr.changes.mapPos(v.to, -1) } : v
  },
})
/** Take back the last edit an agent typed into the note being edited (or any on screen): as it was before it, as one
 *  undo step of the user's. */
function undoLast(agent?: string): boolean {
  const mine = (v: EditorView) => { const e = v.state.field(lastEdit, false); return !!e && (!agent || e.agent === agent) }
  const vs = [...views.keys()].filter((v) => v.dom.isConnected && mine(v))
  const v = vs.find((x) => x.hasFocus) ?? vs[0]
  const e = v?.state.field(lastEdit, false)
  if (!v || !e) { notify("No edit of the companion's to undo here"); return false }
  if (v.state.sliceDoc(e.from, e.to) !== e.text) { notify(`${e.agent}'s last edit was changed since: undo it by hand`); return false }
  v.dispatch({ changes: { from: e.from, to: e.to, insert: e.removed }, effects: lastIs.of(null), userEvent: "delete.companion", annotations: isolateHistory.of("full"), scrollIntoView: true })
  return true
}
setUndoer({ undo: undoLast, can: (agent) => [...views.keys()].some((v) => { const e = v.dom.isConnected && v.state.field(lastEdit, false); return !!e && (!agent || e.agent === agent) }) })

// ---------- the agents' notes, drawn in the text

class Ghost extends WidgetType {
  readonly text: string
  readonly tint: string
  constructor(text: string, tint: string) { super(); this.text = text; this.tint = tint }
  eq(o: Ghost) { return o.text === this.text && o.tint === this.tint }
  toDOM() {
    const s = document.createElement("span")
    s.className = "cm-companion-ins"
    s.style.setProperty("--c", this.tint)
    s.textContent = this.text
    return s
  }
  ignoreEvent() { return false }
}

/** A note's place in a document: from..to (to = from for a line without find), or null when its text is gone. */
export function placeOf(doc: Text, n: { line?: number; find?: string }): { from: number; to: number } | null {
  if (n.find) {
    const i = nearest(doc.toString(), n.find, n.line)
    return i < 0 ? null : { from: i, to: i + n.find.length }
  }
  if (!n.line) return null
  const l = doc.line(Math.max(1, Math.min(n.line, doc.lines)))
  return { from: l.from, to: l.from }
}

/** A comment's text lit as in a shared doc, in its author's colour (the user's own: a highlighter's yellow). */
const litOf = (n: Pick<Note, "by" | "tint" | "agent">) => (n.by === "user" ? "var(--yellow)" : threadTint(n as Note))

function decorate(view: EditorView, path: string): DecorationSet {
  const st = getState(), draft = st.draft?.path === path ? st.draft : null
  const mine = st.notes.filter((n) => n.path === path && n.kind !== "say")
  if (!mine.length && !draft) return Decoration.none
  const marks: { from: number; to: number; deco: Decoration }[] = []
  const picked = st.picked
  const doc = view.state.doc
  // (a comment's text, else its line's words: Overlay lights the active and hovered one by data-companion-mark)
  const anchor = (id: string, p: { from: number; to: number }, tint: string) => {
    const line = doc.lineAt(p.from)
    const r = p.to > p.from ? p : { from: line.from + (line.text.length - line.text.trimStart().length), to: line.to }
    if (r.to > r.from) marks.push({ ...r, deco: Decoration.mark({ class: "cm-companion-anchor", attributes: { style: `--c: ${tint}`, "data-companion-mark": id } }) })
    else marks.push({ from: line.from, to: line.from, deco: Decoration.line({ class: "cm-companion-line", attributes: { style: `--c: ${tint}` } }) })
  }
  if (draft) { const p = placeOf(doc, draft); if (p) anchor("draft", p, litOf({ by: share ? "guest" : "user", agent: share?.guest ?? "" })) }
  for (const n of mine) {
    const p = placeOf(doc, n)
    if (!p) continue
    const style = `--c: ${tintOf(n.agent)}`
    if (n.kind === "proposal") continue
    if (n.kind === "comment") { anchor(n.id, p, litOf(n)); continue }
    // (the suggestion picked in the panel or the margin: its lines lit)
    if (n.id === picked) {
      const a = doc.lineAt(p.from), b = doc.lineAt(p.to)
      for (let l = a.number; l <= b.number; l++) marks.push({ from: doc.line(l).from, to: doc.line(l).from, deco: Decoration.line({ class: "cm-companion-picked", attributes: { style } }) })
    }
    if (p.to === p.from) {
      const line = doc.lineAt(p.from)
      marks.push({ from: line.from, to: line.from, deco: Decoration.line({ class: n.kind === "highlight" ? "cm-companion-hl-line" : "cm-companion-line", attributes: { style } }) })
      continue
    }
    if (n.kind === "highlight") marks.push({ ...p, deco: Decoration.mark({ class: "cm-companion-hl", attributes: { style } }) })
    else if (n.kind === "suggestion") {
      marks.push({ ...p, deco: Decoration.mark({ class: "cm-companion-del", attributes: { style } }) })
      if (n.replace) marks.push({ from: p.to, to: p.to, deco: Decoration.widget({ widget: new Ghost(n.replace, tintOf(n.agent)), side: 1 }) })
    }
  }
  marks.sort((a, b) => a.from - b.from || a.to - b.to)
  const b = new RangeSetBuilder<Decoration>()
  for (const m of marks) b.add(m.from, m.to, m.deco)
  return b.finish()
}

/** The suggestion the user's cursor is on (its lines). */
function suggestionAt(view: EditorView, path: string): Note | null {
  const head = view.state.doc.lineAt(view.state.selection.main.head).number
  for (const n of getState().notes) {
    if (n.kind !== "suggestion" || n.path !== path) continue
    const p = placeOf(view.state.doc, n)
    if (p && head >= view.state.doc.lineAt(p.from).number && head <= view.state.doc.lineAt(p.to).number) return n
  }
  return null
}

// ---------- its words moved: a bubble the user writes on from, what it wrote folded back into one

/** The user went on writing in `path`: the bubbles there that have shown a moment go (the unread dot keeps those they
 *  didn't get to read), and it isn't told: that's what writing on means. */
function dismissSays(path: string) {
  for (const n of getState().notes) if (n.kind === "say" && (!n.path || n.path === path) && shownFor(n.id) > 1500) hideSay(n.id)
}

/** Fold what agent `agent` wrote by its cursor (at line `line`, or the few lines below) into a bubble: its menu's, for a
 *  finger too. Null when no lines there are its. */
function foldNear(path: string, agent: string, line?: number) {
  const view = viewOf(path)
  if (!view || !line || !view.state.facet(EditorView.editable)) return null
  const doc = view.state.doc
  for (let n = Math.max(1, line - 1); n <= Math.min(doc.lines, line + 3); n++) {
    const at = authorAt(view, doc.line(n).from)
    if (at && at.by.toLowerCase() === agent.toLowerCase()) return () => foldIn(view, path, agent, at.from, at.to)
  }
  return null
}
setFolder(foldNear)

/** The menu's Fold into a bubble, on lines an agent around wrote (Provenance knows whose). */
export function foldItems(view: EditorView, path: string): MenuItem[] {
  const at = authorAt(view), a = at && liveAgents().find((x) => x.name.toLowerCase() === at.by.toLowerCase())
  return a && view.state.facet(EditorView.editable) ? [{ label: "Fold into a bubble", icon: MessageCircle, run: () => foldIn(view, path, a.name, at.from, at.to) }] : []
}

/** Take an agent's lines from..to out of the note (an edit of the user's, undone as one) and have it say them instead. */
function foldIn(view: EditorView, path: string, agent: string, from: number, to: number) {
  const doc = view.state.doc, a = doc.lineAt(from), b = doc.lineAt(to), text = doc.sliceString(a.from, b.to)
  const prev = a.number > 1 ? doc.line(a.number - 1) : null, next = b.number < doc.lines ? doc.line(b.number + 1) : null
  // (with their line break; between two blank lines, one of those too)
  let f = a.from
  const t = next ? next.from : b.to
  if (!next && prev) f = prev.to
  else if (prev && !prev.text.trim() && next && !next.text.trim()) f = prev.from
  const line = Math.max(1, f === prev?.from ? prev.number - 1 : a.number - 1)
  const gone = doc.sliceString(f, t)
  view.dispatch({ changes: { from: f, to: t }, userEvent: "delete.fold", scrollIntoView: false })
  op("companion.fold", { as: agent, path, line, text }).catch((e) => {
    view.dispatch({ changes: { from: Math.min(f, view.state.doc.length), insert: gone }, userEvent: "input.fold" })
    notifyError(e, "Couldn't fold it into a bubble")
  })
}

// ---------- what the user does, said to the agents

/** How long without typing before what they wrote is said: a question at once, a thought's end (a sentence's, another
 *  app's dictated burst) after a breath, mid-sentence the setting's pause, longer without an ask. Ours: `heard`. */
function pauseIn(state: EditorState, burst = false) {
  const ms = (Number(pluginSettings("companion").get().pause) || 2) * 1000
  const head = state.selection.main.head, line = state.doc.lineAt(head)
  const before = state.sliceDoc(line.from, head).trimEnd()
  if (/\?["'”’)\]*_`]*$/u.test(before)) return NOW_MS
  if (burst || !before || /[.!…:;]["'”’)\]*_`]*$/u.test(before)) return SOON_MS
  return mentionIn(line.text) ? ms : ms * 2.5
}
const NOW_MS = 60, SOON_MS = 600
/** Words inserted at once that make a dictated burst (another app's dictation, Wispr Flow, pastes a whole thought). */
const BURST = 24

function watcher(path: string) {
  return ViewPlugin.fromClass(class {
    decorations: DecorationSet
    baseline: Text
    pending: ChangeSet // what they typed since baseline
    asked: string[] = [] // lines whose ask went, as they read then: not sent again until they change
    touched: number[] = [] // where they typed since the last pause
    typedAt = 0 // when they last typed
    burst = false // a dictated burst since the last pause
    dirty = false
    timer: ReturnType<typeof setTimeout> | null = null
    whereTimer: ReturnType<typeof setTimeout> | null = null
    sight: ResizeObserver
    stop: () => void
    unhear: () => void
    readonly view: EditorView
    constructor(view: EditorView) {
      this.view = view
      this.decorations = decorate(view, path)
      this.baseline = view.state.doc
      // (the asks already in the note went before: Enter on one isn't asking it again)
      // (any @name: the agents aren't known yet as it opens; one pass, the regex only on lines with an @)
      for (const t of view.state.doc.iterLines()) if (t.includes("@") && /(?<![\w@./])@[\w-]/.test(t)) this.asked.push(t)
      this.pending = ChangeSet.empty(view.state.doc.length)
      views.set(view, path)
      sayWhereSoon()
      bump() // (a thread in it: the overlay places it)
      // (its tab kept hidden, or shown again: whether an edit can be typed in here changes)
      let shown = false
      this.sight = new ResizeObserver(() => { const now = view.dom.getClientRects().length > 0; if (now !== shown) { shown = now; sayWhereSoon() } })
      this.sight.observe(view.dom)
      this.stop = subscribe(() => requestAnimationFrame(() => { if (view.dom.isConnected) view.dispatch({ effects: refresh.of(null) }) }))
      this.unhear = onDictation((e, where) => { if (where.view === view) this.heard(e.type, e.type === "pause" ? e.ms : 0) })
    }
    /** Vaultite's dictation in this note: held while the user speaks, said at a pause that ends a sentence (a question at
     *  once), a longer one, or the end; the cursor comes over to listen meanwhile. */
    heard(type: string, ms: number) {
      const st = this.view.state, head = st.selection.main.head
      if (type === "start" || type === "pause") hear(path, st.doc.lineAt(head).number, privateNote(path, st.doc.sliceString(0, 4096)))
      if (type === "end") { hear(null); if (this.dirty) this.later(true); return }
      if (type === "speech" || type === "pending") { if (this.timer) { clearTimeout(this.timer); this.timer = null }; return }
      if (type !== "pause" || !this.dirty) return
      const before = st.sliceDoc(st.doc.lineAt(head).from, head).trimEnd()
      if (ms >= 2000 || /\?["'”’)\]*_`]*$/u.test(before)) this.later(true)
      else if (/[.!…]["'”’)\]*_`]*$/u.test(before)) this.later(false, true)
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.transactions.some((t) => t.effects.some((e) => e.is(refresh)))) this.decorations = decorate(u.view, path)
      if (u.docChanged || u.geometryChanged || u.viewportChanged || u.selectionSet || u.focusChanged) bump()
      const was = u.startState.doc.lineAt(u.startState.selection.main.head).number
      if (u.focusChanged || (u.selectionSet && u.state.doc.lineAt(u.state.selection.main.head).number !== was)) {
        if (this.whereTimer) clearTimeout(this.whereTimer)
        this.whereTimer = setTimeout(() => sayWhere(u.view.hasFocus), u.focusChanged ? 0 : 800)
      }
      if (!u.docChanged) return
      let typed = false, entered = false
      const asks: number[] = []
      for (const tr of u.transactions) {
        if (!tr.docChanged) continue
        this.touched = this.touched.map((p) => tr.changes.mapPos(p))
        if (!tr.annotation(own) && ["input", "delete", "move", "undo", "redo"].some((e) => tr.isUserEvent(e))) {
          typed = true
          this.typedAt = Date.now()
          userTyped.set(this.view, this.typedAt)
          this.pending = this.pending.compose(tr.changes)
          tr.changes.iterChanges((_fa, _ta, fromB, toB, inserted) => {
            this.touched = [...this.touched.slice(-100), fromB, toB]
            const n = tr.state.doc.lineAt(fromB).number, text = inserted.toString()
            if (text.replace(/\s/g, "").length >= BURST && !tr.isUserEvent("input.dictation")) this.burst = true
            // (Enter: what they wrote goes now; a pasted block isn't one)
            else if (text.includes("\n") && !tr.isUserEvent("input.paste") && !tr.isUserEvent("input.drop")) entered = true
            if (text.includes("\n") && this.ask(n, tr.state.doc)) asks.push(n)
          })
          continue
        }
        // (an agent's typing, or a change from disk: folded into where they started, so their pause stays one moment)
        const o = tr.changes.map(this.pending.invert(this.baseline))
        this.baseline = o.apply(this.baseline)
        this.pending = this.pending.map(o)
        if (this.pending.newLength !== tr.changes.newLength) this.pending = ChangeSet.of({ from: 0, to: this.baseline.length, insert: tr.state.doc }, this.baseline.length)
      }
      if (asks.length) markSent(u.view, asks)
      if (!typed) return
      dismissSays(path)
      this.dirty = true
      this.later(entered)
      this.beckon(u.state)
    }
    /** The line they're on, when it asks something not sent yet: its agent comes over, the cue that it's coming (no
     *  countdown: Enter sends it, the pause quietly). */
    beckon(state: EditorState) {
      const line = state.doc.lineAt(state.selection.main.head), ask = mentionIn(line.text)
      if (ask && getState().mode !== "off" && !privateNote(path, state.doc.sliceString(0, 4096)) && !this.asked.includes(line.text) && asksSomething(line.text, mentionsOf(line.text))) listen(ask.name, path, line.number)
    }
    /** Send line `n`'s ask, if it has one not sent as it reads now; `pause`: only one with words besides the @name. It
     *  stays in the note, as they wrote it, wherever its @name is (a private note's never goes). */
    ask(n: number, doc: Text, pause = false) {
      const line = doc.line(n), ask = mentionIn(line.text)
      if (!ask || getState().mode === "off" || this.asked.includes(line.text) || (pause && !asksSomething(line.text, mentionsOf(line.text)))) return false
      if (privateNote(path, doc.sliceString(0, 4096))) return false
      this.asked = [...this.asked.slice(-200), line.text]
      sendMoment({ kind: "ask", agent: ask.name, path, line: n, text: ask.text, waited: Date.now() - this.typedAt })
      return true
    }
    later(now = false, paused = false) {
      if (this.timer) clearTimeout(this.timer)
      // (dictating here: its pauses say when, `heard`)
      if (!now && !paused && dictation()?.target.view === this.view) { this.timer = null; return }
      this.timer = setTimeout(() => (this.view.composing ? this.later() : this.report(this.view.state.doc)), now ? NOW_MS : pauseIn(this.view.state, this.burst))
    }
    report(doc: Text) {
      if (this.timer) { clearTimeout(this.timer); this.timer = null }
      this.burst = false
      // (an ask not ended with Enter, as "how is it going @claude?": sent at the pause)
      const asks = [...new Set(this.touched.filter((p) => p <= doc.length).map((p) => doc.lineAt(p).number))].filter((n) => this.ask(n, doc, true))
      this.touched = []
      if (asks.length && this.view.dom.isConnected) markSent(this.view, asks)
      this.dirty = false
      const md = getState().mode
      if (md === "pair" && !privateNote(path, doc.sliceString(0, 4096))) {
        // (lines that only write asks reach the agents as those asks, not twice)
        // (theirs alone: what agents and other windows wrote is in the baseline already)
        const spans: [number, number, number, number][] = []
        this.pending.iterChangedRanges((fa, ta, fb, tb) => spans.push([this.baseline.lineAt(fa).number, this.baseline.lineAt(ta).number, doc.lineAt(fb).number, doc.lineAt(tb).number]))
        const hunks = hunksIn(this.baseline.toString().split("\n"), doc.toString().split("\n"), spans).filter((h) => [...h.removed, ...h.added].some((l) => l.trim() && !mentionIn(l)))
        if (hunks.length) sendMoment({ kind: "edit", path, line: hunks[0].line, hunks, waited: Date.now() - this.typedAt })
      }
      this.baseline = doc
      this.pending = ChangeSet.empty(doc.length)
    }
    destroy() {
      if (this.dirty) this.report(this.view.state.doc)
      if (this.whereTimer) clearTimeout(this.whereTimer)
      this.sight.disconnect()
      this.stop()
      this.unhear()
      // (dictating into it as it goes: its end won't reach this one)
      if (dictation()?.target.view === this.view) hear(null)
      views.delete(this.view)
      sayWhereSoon()
      bump()
    }
  }, { decorations: (v) => v.decorations })
}

// ---------- @name: a chip in its agent's colour, lit when the ask goes and while that agent thinks on it

const sent = StateEffect.define<number[]>() // lines' starts; [] when it's over
const sentAt = StateField.define<number[]>({
  create: () => [],
  update(v, tr) {
    for (const e of tr.effects) if (e.is(sent)) return e.value
    return v.length && tr.docChanged ? v.map((p) => tr.changes.mapPos(p)) : v
  },
})
/** The ask on these lines just went: their chips light up a moment (after this update: no dispatch inside one). */
function markSent(view: EditorView, lines: number[]) {
  queueMicrotask(() => {
    if (!view.dom.isConnected) return
    const doc = view.state.doc
    view.dispatch({ effects: sent.of(lines.filter((n) => n <= doc.lines).map((n) => doc.line(n).from)) })
    setTimeout(() => { if (view.dom.isConnected) view.dispatch({ effects: sent.of([]) }) }, 1600)
  })
}

function chipsOf(view: EditorView, path: string): DecorationSet {
  const st = getState()
  if (st.mode === "off" || privateNote(path, view.state.doc.sliceString(0, 4096))) return Decoration.none
  const names = mentionNames(), mid = midNames(), lit = view.state.field(sentAt, false) ?? [], b = new RangeSetBuilder<Decoration>()
  let last = -1
  for (const r of view.visibleRanges) {
    for (let pos = r.from; pos <= r.to;) {
      const line = view.state.doc.lineAt(pos)
      pos = line.to + 1
      if (line.number <= last) continue
      last = line.number
      for (const m of mentionsOf(line.text, names, mid)) {
        const a = mentionAgent(m.name)
        const asked = lit.includes(line.from) || (a?.state === "thinking" && a.path === path && a.line === line.number)
        b.add(line.from + m.from, line.from + m.to, Decoration.mark({ class: asked ? "cm-companion-mention cm-companion-asked" : "cm-companion-mention",
          attributes: { style: `--c: var(--${a?.tint ?? "orange"})`, "data-agent": a?.name ?? st.name } }))
      }
    }
  }
  return b.finish()
}

function chips(path: string) {
  return ViewPlugin.fromClass(class {
    decorations: DecorationSet
    constructor(view: EditorView) { this.decorations = chipsOf(view, path) }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged || u.transactions.some((t) => t.effects.some((e) => e.is(refresh) || e.is(sent)))) this.decorations = chipsOf(u.view, path)
    }
  }, { decorations: (v) => v.decorations })
}

const theme = EditorView.baseTheme({
  ".cm-companion-mention": { color: "var(--c)", backgroundColor: "color-mix(in srgb, var(--c) 13%, transparent)", borderRadius: "4px", padding: "1px 3px",
    fontWeight: "550", transition: "background-color .3s" },
  ".cm-companion-asked": { backgroundColor: "color-mix(in srgb, var(--c) 26%, transparent)", animation: "cm-companion-pulse 1.1s ease-in-out infinite" },
  "@keyframes cm-companion-pulse": { "0%, 100%": { boxShadow: "0 0 0 0 transparent" }, "50%": { boxShadow: "0 0 0 3px color-mix(in srgb, var(--c) 28%, transparent)" } },
  "@media (prefers-reduced-motion: reduce)": { ".cm-companion-asked": { animation: "none" } },
  ".cm-companion-hl": { backgroundColor: "color-mix(in srgb, var(--c) 32%, transparent)", borderRadius: "3px", animation: "cm-companion-in .4s ease-out" },
  ".cm-companion-hl-line": { backgroundColor: "color-mix(in srgb, var(--c) 14%, transparent)" },
  ".cm-companion-anchor": { backgroundColor: "color-mix(in srgb, var(--c) 18%, transparent)", borderRadius: "2px", transition: "background-color .2s, box-shadow .2s" },
  ".cm-companion-line": { boxShadow: "inset 2px 0 0 color-mix(in srgb, var(--c) 70%, transparent)" },
  ".cm-companion-picked": { backgroundColor: "color-mix(in srgb, var(--c) 13%, transparent)", transition: "background-color .3s" },
  ".cm-companion-del": { textDecoration: "line-through", textDecorationColor: "var(--c)", textDecorationThickness: "2px", opacity: ".6" },
  ".cm-companion-ins": { color: "var(--c)", backgroundColor: "color-mix(in srgb, var(--c) 12%, transparent)", borderRadius: "3px", padding: "0 2px", marginLeft: "2px",
    animation: "cm-companion-in .3s ease-out" },
  ".cm-companion-veiled, .cm-companion-veiled *": { color: "transparent !important" },
  // (the Start row's chooser, drawn as the suggestion list is)
  ".cm-tooltip.cm-companion-start": { background: "var(--card)", border: "0.5px solid var(--border)", borderRadius: "10px", padding: "4px", boxShadow: "0 10px 30px rgb(0 0 0 / 0.18)",
    fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--foreground)", minWidth: "260px", maxWidth: "min(420px, calc(100vw - 24px))" },
  ".cm-companion-start-row": { display: "flex", alignItems: "baseline", gap: "4px", padding: "3px 6px", borderRadius: "6px" },
  ".cm-companion-start-on": { background: "color-mix(in srgb, var(--primary) 9%, transparent)" },
  ".cm-companion-start-row > span": { flex: "none", width: "48px", fontSize: "12px", color: "var(--muted-foreground)" },
  // (five efforts wrap on a phone)
  ".cm-companion-start-row > div": { display: "flex", flexWrap: "wrap", gap: "4px", minWidth: "0" },
  ".cm-companion-start-row button": { padding: "1px 8px", borderRadius: "999px", border: "0.5px solid var(--border)", cursor: "pointer", lineHeight: "20px", whiteSpace: "nowrap" },
  ".cm-companion-start-row button[aria-pressed]": { background: "color-mix(in srgb, var(--primary) 18%, transparent)", borderColor: "color-mix(in srgb, var(--primary) 45%, transparent)", fontWeight: "600" },
  ".cm-companion-start-go": { display: "flex", width: "100%", alignItems: "center", gap: "6px", marginTop: "2px", padding: "4px 6px", borderRadius: "6px", cursor: "pointer", fontWeight: "550" },
  ".cm-companion-start-go:hover": { background: "color-mix(in srgb, var(--foreground) 6%, transparent)" },
  ".cm-companion-start-go > kbd": { marginLeft: "auto", fontFamily: "inherit", fontSize: "12px", color: "var(--muted-foreground)" },
  ".cm-companion-chip": { flex: "none", alignSelf: "center", marginLeft: "8px", padding: "0 8px", borderRadius: "999px", border: "0.5px solid var(--border)",
    fontSize: "12px", lineHeight: "20px", color: "var(--muted-foreground)", whiteSpace: "nowrap", cursor: "pointer" },
  ".cm-companion-chip:hover": { color: "var(--foreground)", background: "color-mix(in srgb, var(--foreground) 6%, transparent)" },
  // (phones: room for the chip in place of the detail, and fingers' sizes)
  "@media (max-width: 767px)": {
    "li:has(.cm-companion-chip) .cm-completionDetail": { display: "none" },
    ".cm-companion-chip": { marginLeft: "auto", padding: "0 12px", fontSize: "14px", lineHeight: "32px" },
    ".cm-tooltip.cm-companion-start": { fontSize: "15px", borderRadius: "12px" },
    ".cm-companion-start-row": { padding: "6px 8px" },
    ".cm-companion-start-row button": { padding: "0 12px", lineHeight: "32px" },
    ".cm-companion-start-go": { minHeight: "44px", padding: "0 8px" },
    ".cm-companion-start-go > kbd": { display: "none" },
  },
  ".cm-companion-typed": { backgroundColor: "color-mix(in srgb, var(--c) 24%, transparent)", borderRadius: "2px", animation: "cm-companion-fade 4s ease-in forwards" },
  "@keyframes cm-companion-in": { from: { backgroundColor: "transparent" } },
  "@keyframes cm-companion-fade": { "0%, 40%": {}, "100%": { backgroundColor: "transparent" } },
})

// ---------- @ and a name: an agent around, or Start @name at what its name picks (a profile, else the default), or
// others picked (its chip, Tab or →)

/** The Start row's name (as typed) on its option. */
const startOf = (c: Completion | null) => (c as (Completion & { startAs?: string }) | null)?.startAs

/** Start the agent called `name` ("bob": Bob), its @name put in place of from..to; asks to it wait while it starts. */
function begin(view: EditorView, path: string, name: string, from: number, to: number, how: How) {
  const insert = `${name.toLowerCase()} `
  view.dispatch({ changes: { from, to, insert }, selection: { anchor: from + insert.length }, userEvent: "input.complete" })
  void op("companion.start", { as: nameAs(name), ...(how.agent ? { agent: how.agent } : {}), ...(how.model ? { model: how.model } : {}), ...(how.effort ? { effort: how.effort } : {}),
    path, line: view.state.doc.lineAt(from).number }).catch((e) => notifyError(e, `Couldn't start ${nameAs(name)}`))
}

/** @ anywhere a mention can start: the agents around now, the companion first; once a letter is typed, the profiles'
 *  names that fit and a name none has, as Start rows last. */
const mentions = (path: string) => (ctx: CompletionContext) => {
  const m = ctx.matchBefore(/@[\w-]*$/)
  if (!m || getState().mode === "off" || privateNote(path, ctx.state.doc.sliceString(0, 4096)) || !canMention(ctx.state.sliceDoc(ctx.state.doc.lineAt(m.from).from, m.from))) return null
  const st = getState(), names = liveAgents().map((a) => a.name), typed = m.text.slice(1)
  const known = [...new Set(["companion", st.fresh.agent.split("_")[0] || "claude", st.name, ...names].map((n) => n.toLowerCase()))]
  const named = Object.keys(st.profiles).filter((p) => !known.includes(p))
  const some = (t: string) => [...known, ...named].some((n) => n.startsWith(t.toLowerCase()))
  const options: (Completion & { highlight?: string; startAs?: string; trail?: (view: EditorView) => Node })[] = (names.length ? names : [st.name]).map((n) => ({ label: n.toLowerCase(), detail: n === st.name ? "companion" : undefined,
    boost: n === st.name ? 1 : 0, apply: `${n.toLowerCase()} `, highlight: mentionAgent(n)?.tint ?? "orange" }))
  // (a split button: the row starts as is, its chip opens the chooser; one with nothing to choose names what it runs)
  const start = (name: string, how: How, boost: number) => ({ label: name, displayLabel: `Start @${name}`, boost, startAs: name,
    ...(rowsOf(how).length ? { trail: (view: EditorView) => startChip(view, name, how) } : { detail: howText(how) }),
    apply: (view: EditorView, _c: Completion, from: number, to: number) => begin(view, path, name, from, to, how) })
  if (typed) for (const p of named) options.push(start(p, st.profiles[p], -50))
  // (one word, as companion.start takes)
  const fresh = !!typed && typed.length <= 30 && !some(typed)
  if (fresh) options.push(start(typed, howOf(typed), -99))
  // (asked again at the first letter, for the profiles' rows, and once no name fits, for the Start row to name it)
  return { from: m.from + 1, options, ...(fresh ? {} : { validFor: (t: string) => /^[\w-]*$/.test(t) && (typed ? some(t) : !t) }) }
}

/** The chooser's rows for what's picked: the agents installed (when more than one), its models and its efforts. */
type Row = { key: "agent" | "model" | "effort"; label: string; list: { id: string; label: string }[]; on: string }
function rowsOf(c: How): Row[] {
  const id = c.agent.split("_")[0], hs = getState().harnesses.filter((x) => x.installed || x.id === id), h = hs.find((x) => x.id === id)
  return [
    ...(hs.length > 1 ? [{ key: "agent" as const, label: "Agent", list: hs.map((x) => ({ id: x.id, label: x.name })), on: id }] : []),
    ...(h?.models.length ? [{ key: "model" as const, label: "Model", list: h.models, on: c.model }] : []),
    ...(h?.efforts.length ? [{ key: "effort" as const, label: "Effort", list: h.efforts.map((e) => ({ id: e, label: capitalize(effortName(e)) })), on: c.effort }] : []),
  ]
}
/** What picking agent `id` makes it run: as the companion does when it's the same agent, else as @id would. */
function agentPicked(id: string): How {
  const st = getState()
  return st.fresh.agent.split("_")[0] === id ? st.fresh : st.profiles[id] ?? { agent: id, model: "", effort: "" }
}

/** The chooser under a Start row: its name and where it was typed (from: after the @), what's picked, the row on. */
type Choice = How & { name: string; from: number; row: number; tip: Tooltip }
const choose = StateEffect.define<Choice | null>()
const chooser = StateField.define<Choice | null>({
  create: () => null,
  update(v, tr) {
    for (const e of tr.effects) if (e.is(choose)) return e.value
    // (typing on, or moving off it, takes it away; a change from outside away from it, an agent's edit or the file
    // changed on disk, only moves it)
    if (v && tr.docChanged && !tr.selection && tr.annotation(Transaction.remote) && !tr.changes.touchesRange(v.from - 1, v.from + v.name.length)) {
      const from = tr.changes.mapPos(v.from)
      return from === v.from ? v : { ...v, from, tip: { ...v.tip, pos: from - 1 } }
    }
    return v && (tr.docChanged || tr.selection) ? null : v
  },
  provide: (f) => showTooltip.from(f, (v) => v?.tip ?? null),
})

/** The Start row selected in the list (or `name`'s, its chip tapped): its chooser opens, set to what it would run
 *  (none when there's nothing to choose). */
function openChooser(view: EditorView, name = completionStatus(view.state) === "active" ? startOf(selectedCompletion(view.state)) : undefined) {
  if (!name) return false
  const st = getState(), how = Object.hasOwn(st.profiles, name.toLowerCase()) ? st.profiles[name.toLowerCase()] : howOf(name)
  if (!rowsOf(how).length) return false
  const from = view.state.selection.main.head - name.length
  closeCompletion(view)
  view.dispatch({ effects: choose.of({ ...how, name, from, row: 0, tip: { pos: from - 1, above: false, create: (v) => chooserView(v) } }) })
  return true
}

/** A row's pick made: another agent brings what it runs by default. */
const picked = (c: Choice, r: Row, id: string): Choice => (r.key === "agent" ? { ...c, ...agentPicked(id) } : { ...c, [r.key]: id })

/** The chooser's keys: ← → pick, ↑ ↓ (or Tab) the row, Enter starts, Escape goes back to the list. */
function chooserKey(key: string) {
  return (view: EditorView) => {
    const c = view.state.field(chooser, false)
    if (!c) return key === "Tab" || key === "ArrowRight" ? openChooser(view) : false
    const rows = rowsOf(c), row = Math.min(c.row, rows.length - 1), r = rows[row]
    if (r && (key === "ArrowLeft" || key === "ArrowRight")) {
      const at = r.list.findIndex((x) => x.id === r.on), n = r.list.length
      const next = at < 0 ? (key === "ArrowLeft" ? n - 1 : 0) : (at + (key === "ArrowLeft" ? n - 1 : 1)) % n
      view.dispatch({ effects: choose.of({ ...picked(c, r, r.list[next].id), row }) })
    } else if (key === "ArrowUp" || key === "Shift-Tab") view.dispatch({ effects: choose.of({ ...c, row: (row + rows.length - 1) % rows.length }) })
    else if (key === "ArrowDown" || key === "Tab") view.dispatch({ effects: choose.of({ ...c, row: (row + 1) % rows.length }) })
    else if (key === "Enter") { view.dispatch({ effects: choose.of(null) }); begin(view, pathOf(view), c.name, c.from, c.from + c.name.length, c) }
    else if (key === "Escape") { view.dispatch({ effects: choose.of(null) }); startCompletion(view) }
    return true
  }
}
const pathOf = (view: EditorView) => views.get(view) ?? ""

/** The Start row's chip: what it would run, a tap or click on it opens the chooser instead of starting. */
function startChip(view: EditorView, name: string, how: How) {
  const chip = document.createElement("span")
  chip.className = "cm-companion-chip"
  chip.setAttribute("role", "button")
  chip.textContent = `${howText(how)} ›`
  // (the list applies its row on mousedown, a tap's too: this one comes first and keeps it from bubbling there)
  chip.addEventListener("mousedown", (e) => { e.preventDefault(); e.stopPropagation(); openChooser(view, name) })
  return chip
}

function chooserView(view: EditorView) {
  const dom = document.createElement("div")
  dom.className = "cm-companion-start"
  dom.setAttribute("data-companion-start", "")
  // (clicks keep the editor's focus, so its keys still work)
  dom.addEventListener("mousedown", (e) => e.preventDefault())
  const draw = (c: Choice | null) => {
    if (!c) return
    dom.replaceChildren()
    rowsOf(c).forEach((rw, i, rows) => {
      const r = dom.appendChild(document.createElement("div"))
      r.className = `cm-companion-start-row${Math.min(c.row, rows.length - 1) === i ? " cm-companion-start-on" : ""}`
      r.setAttribute("data-row", rw.key)
      r.appendChild(document.createElement("span")).textContent = rw.label
      const picks = r.appendChild(document.createElement("div"))
      for (const x of rw.list.some((y) => y.id === rw.on) || !rw.on ? rw.list : [{ id: rw.on, label: capitalize(rw.on) }, ...rw.list]) {
        const b = picks.appendChild(document.createElement("button"))
        b.type = "button"
        b.textContent = x.label
        if (x.id === rw.on) b.setAttribute("aria-pressed", "true")
        b.onclick = () => view.dispatch({ effects: choose.of({ ...picked(c, rw, x.id), row: i }) })
      }
    })
    const go = dom.appendChild(document.createElement("button"))
    go.type = "button"
    go.className = "cm-companion-start-go"
    go.textContent = `Start @${c.name}`
    go.appendChild(document.createElement("kbd")).textContent = keyHint("Enter")
    go.onclick = () => chooserKey("Enter")(view)
  }
  draw(view.state.field(chooser, false) ?? null)
  return { dom, update: (u: ViewUpdate) => { const c = u.state.field(chooser, false); if (c !== u.startState.field(chooser, false)) draw(c ?? null) } }
}

/** The extension for a note's editor (only a file's own: an embed or a field has no path). */
export function companionExtension(ctx: EditorCtx): Extension {
  if (ctx.kind !== "markdown" || !ctx.path) return []
  const path = ctx.path
  const keys = Prec.highest(keymap.of([
    ...["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Enter", "Shift-Tab"].map((key) => ({ key, run: chooserKey(key) })),
    { key: "Tab", run: (v) => { if (chooserKey("Tab")(v)) return true; const n = suggestionAt(v, path); if (!n) return decide(v, path, "accept"); void accept(n); return true } },
    { key: "Escape", run: (v) => {
      if (chooserKey("Escape")(v) || stopTyping(v)) return true
      const n = suggestionAt(v, path)
      if (n) { answer(n.id, "reject"); return true }
      return decide(v, path, "reject") || stopThinking(path)
    } },
  ]))
  return [typed, span, streamAt, lastEdit, sentAt, chooser, watcher(path), chips(path), proposals(path), keys, theme, EditorState.languageData.of(() => [{ suggest: mentions(path) }]), cotype(path)]
}
