// The companion in a note's editor: what the user writes said after a pause (and at once for "@claude …"), the agents'
// highlights, comments' anchors and suggestions drawn in the text, Tab and Esc for a suggestion, and edits typed in.
import { Annotation, type EditorState, type Extension, Prec, RangeSetBuilder, StateEffect, StateField, type Text, Transaction } from "@codemirror/state"
import { Decoration, type DecorationSet, EditorView, keymap, ViewPlugin, type ViewUpdate, WidgetType } from "@codemirror/view"
import { pluginSettings, type EditorCtx } from "@vaultite"
import { accept, answer, bump, type EditAsk, getState, hunksOf, mentionIn, nearest, type Note, sayWhere, sendMoment, setTyper, setTyping, subscribe, tintOf, views } from "./live"

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

/** Where an agent types, kept through the user's own typing meanwhile. */
const at = StateEffect.define<number | null>()
const typingAt = StateField.define<number | null>({
  create: () => null,
  update(v, tr) {
    for (const e of tr.effects) if (e.is(at)) return e.value
    return v === null ? null : tr.changes.mapPos(v, 1)
  },
})

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Type edit `e` into `view`: find replaced (or new lines after line, or at the end), a few letters a frame. */
async function type(view: EditorView, e: EditAsk) {
  const doc = view.state.doc.toString()
  let from: number, to: number, text = e.text
  if (e.find !== undefined && e.find !== "") {
    from = nearest(doc, e.find, e.line)
    if (from < 0) throw new Error(`"${e.find.slice(0, 60)}" isn't in the note any more`)
    to = from + e.find.length
  } else if (e.append || e.line === undefined) {
    from = to = doc.length
    text = !doc || doc.endsWith("\n") ? text.replace(/\n?$/, "\n") : `\n${text.replace(/\n$/, "")}`
  } else if (e.line <= 0) {
    from = to = 0
    text = text.replace(/\n?$/, "\n")
  } else {
    from = to = view.state.doc.line(Math.min(e.line, view.state.doc.lines)).to
    text = `\n${text.replace(/\n$/, "")}`
  }
  const tint = tintOf(e.agent)
  const tx = (spec: object) => view.dispatch({ ...spec, annotations: [own.of(true), Transaction.userEvent.of("input.companion")] })
  tx({ changes: { from, to }, effects: at.of(from) })
  const animate = e.animate !== false && !matchMedia("(prefers-reduced-motion: reduce)").matches
  const steps = animate ? Math.max(1, Math.round(Math.min(1600, text.length * 14) / 16)) : 1
  const size = Math.ceil(text.length / steps)
  const start = view.state.field(typingAt) ?? from
  for (let i = 0; i < text.length; i += size) {
    if (!view.dom.isConnected) throw new Error("the note was closed while typing")
    const pos = view.state.field(typingAt) ?? from
    tx({ changes: { from: pos, insert: text.slice(i, i + size) } })
    setTyping({ view, pos: pos + Math.min(size, text.length - i), agent: e.agent })
    if (animate) await sleep(16)
  }
  const end = view.state.field(typingAt) ?? start + text.length
  view.dispatch({ effects: [at.of(null), lit.of({ from: Math.min(start, end), to: end, tint })] })
  setTyping(null)
  setTimeout(() => { if (view.dom.isConnected) view.dispatch({ effects: lit.of(null) }) }, 4500)
}
setTyper(type)

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

function decorate(view: EditorView, path: string): DecorationSet {
  const mine = getState().notes.filter((n) => n.path === path && n.kind !== "say")
  if (!mine.length) return Decoration.none
  const marks: { from: number; to: number; deco: Decoration }[] = []
  for (const n of mine) {
    const p = placeOf(view.state.doc, n)
    if (!p) continue
    const style = `--c: ${tintOf(n.agent)}`
    if (p.to === p.from) {
      const line = view.state.doc.lineAt(p.from)
      marks.push({ from: line.from, to: line.from, deco: Decoration.line({ class: n.kind === "highlight" ? "cm-companion-hl-line" : "cm-companion-line", attributes: { style } }) })
      continue
    }
    if (n.kind === "highlight") marks.push({ ...p, deco: Decoration.mark({ class: "cm-companion-hl", attributes: { style } }) })
    else if (n.kind === "comment") marks.push({ ...p, deco: Decoration.mark({ class: "cm-companion-anchor", attributes: { style } }) })
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

// ---------- what the user does, said to the agents

/** How long without typing before what they wrote is said: longer mid-sentence (dictation lands in bursts, with
 *  thinking between, and a burst is often half a thought). */
function pauseIn(state: EditorState) {
  const ms = (Number(pluginSettings("companion").get().pause) || 2) * 1000
  const head = state.selection.main.head, line = state.doc.lineAt(head)
  const before = state.sliceDoc(line.from, head).trimEnd()
  return before && /[\p{L}\p{N},]$/u.test(before) ? ms * 2.5 : ms
}

function watcher(path: string) {
  return ViewPlugin.fromClass(class {
    decorations: DecorationSet
    baseline: Text
    dirty = false
    timer: ReturnType<typeof setTimeout> | null = null
    whereTimer: ReturnType<typeof setTimeout> | null = null
    stop: () => void
    readonly view: EditorView
    constructor(view: EditorView) {
      this.view = view
      this.decorations = decorate(view, path)
      this.baseline = view.state.doc
      views.set(view, path)
      queueMicrotask(() => sayWhere())
      this.stop = subscribe(() => requestAnimationFrame(() => { if (view.dom.isConnected) view.dispatch({ effects: refresh.of(null) }) }))
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.transactions.some((t) => t.effects.some((e) => e.is(refresh)))) this.decorations = decorate(u.view, path)
      if (u.docChanged || u.geometryChanged || u.viewportChanged) bump()
      if (u.focusChanged || (u.selectionSet && u.state.doc.lineAt(u.state.selection.main.head).number !== u.startState.doc.lineAt(u.startState.selection.main.head).number)) {
        if (this.whereTimer) clearTimeout(this.whereTimer)
        this.whereTimer = setTimeout(() => sayWhere(u.view.hasFocus), u.focusChanged ? 0 : 800)
      }
      if (!u.docChanged) return
      if (u.transactions.some((t) => t.annotation(own))) {
        // (theirs: what the user wrote before it is said first, then theirs is the new starting point)
        if (this.dirty) this.report(u.startState.doc)
        this.baseline = u.state.doc
        return
      }
      if (!u.transactions.some((t) => t.isUserEvent("input") || t.isUserEvent("delete") || t.isUserEvent("move") || t.isUserEvent("undo") || t.isUserEvent("redo"))) {
        this.baseline = u.state.doc // (a change from disk or another device: not typed here)
        return
      }
      this.dirty = true
      this.later()
      u.changes.iterChanges((_fa, _ta, fromB, _tb, inserted) => {
        if (!inserted.toString().includes("\n")) return
        const line = u.state.doc.lineAt(fromB)
        const ask = mentionIn(line.text)
        if (ask && getState().mode !== "off") sendMoment({ kind: "ask", path, line: line.number, text: ask })
      })
    }
    later() {
      if (this.timer) clearTimeout(this.timer)
      this.timer = setTimeout(() => (this.view.composing ? this.later() : this.report(this.view.state.doc)), pauseIn(this.view.state))
    }
    report(doc: Text) {
      if (this.timer) { clearTimeout(this.timer); this.timer = null }
      this.dirty = false
      const md = getState().mode
      if (md === "notice" || md === "pair") {
        const hunks = hunksOf(this.baseline.toString().split("\n"), doc.toString().split("\n"))
        if (hunks.length) sendMoment({ kind: "edit", path, line: hunks[0].line, hunks })
      }
      this.baseline = doc
    }
    destroy() {
      if (this.dirty) this.report(this.view.state.doc)
      if (this.whereTimer) clearTimeout(this.whereTimer)
      this.stop()
      views.delete(this.view)
      queueMicrotask(() => sayWhere())
      bump()
    }
  }, { decorations: (v) => v.decorations })
}

const theme = EditorView.baseTheme({
  ".cm-companion-hl": { backgroundColor: "color-mix(in srgb, var(--c) 32%, transparent)", borderRadius: "3px", animation: "cm-companion-in .4s ease-out" },
  ".cm-companion-hl-line": { backgroundColor: "color-mix(in srgb, var(--c) 14%, transparent)" },
  ".cm-companion-anchor": { textDecoration: "underline dotted var(--c)", textDecorationThickness: "2px", textUnderlineOffset: "4px" },
  ".cm-companion-line": { boxShadow: "inset 2px 0 0 color-mix(in srgb, var(--c) 70%, transparent)" },
  ".cm-companion-del": { textDecoration: "line-through", textDecorationColor: "var(--c)", textDecorationThickness: "2px", opacity: ".6" },
  ".cm-companion-ins": { color: "var(--c)", backgroundColor: "color-mix(in srgb, var(--c) 12%, transparent)", borderRadius: "3px", padding: "0 2px", marginLeft: "2px",
    animation: "cm-companion-in .3s ease-out" },
  ".cm-companion-typed": { backgroundColor: "color-mix(in srgb, var(--c) 24%, transparent)", borderRadius: "2px", animation: "cm-companion-fade 4s ease-in forwards" },
  "@keyframes cm-companion-in": { from: { backgroundColor: "transparent" } },
  "@keyframes cm-companion-fade": { "0%, 40%": {}, "100%": { backgroundColor: "transparent" } },
})

/** The extension for a note's editor (only a file's own: an embed or a field has no path). */
export function companionExtension(ctx: EditorCtx): Extension {
  if (ctx.kind !== "markdown" || !ctx.path) return []
  const path = ctx.path
  const keys = Prec.highest(keymap.of([
    { key: "Tab", run: (v) => { const n = suggestionAt(v, path); if (!n) return false; void accept(n); return true } },
    { key: "Escape", run: (v) => { const n = suggestionAt(v, path); if (!n) return false; answer(n.id, "reject"); return true } },
  ]))
  return [typed, typingAt, watcher(path), keys, theme]
}
