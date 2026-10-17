// The companion in a note's editor: what the user writes said after a pause (and a line with @claude at Enter), the
// agents' highlights, comments' anchors and suggestions drawn in the text, Tab and Esc for a suggestion, and edits typed in.
import type { CompletionContext } from "@codemirror/autocomplete"
import { Annotation, ChangeSet, EditorState, type Extension, Prec, RangeSetBuilder, StateEffect, StateField, type Text, Transaction } from "@codemirror/state"
import { Decoration, type DecorationSet, EditorView, keymap, ViewPlugin, type ViewUpdate, WidgetType } from "@codemirror/view"
import { pluginSettings, type EditorCtx } from "@vaultite"
import { accept, answer, asksSomething, bump, canMention, type EditAsk, getState, hunksOf, listen, liveAgents, mentionAgent, mentionIn, mentionNames, mentionsOf, midNames, nearest, type Note, sayWhere, sendMoment, setTyper, setTyping, subscribe, tintOf, views } from "./live"

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

/** Type edit `e` into `view`: find replaced (or new lines after the line with after, after line, or at the end). */
async function type(view: EditorView, e: EditAsk) {
  const doc = view.state.doc.toString()
  let from: number, to: number, text = e.text
  if (e.find !== undefined && e.find !== "") {
    from = nearest(doc, e.find, e.line)
    if (from < 0) throw new Error(`"${e.find.slice(0, 60)}" isn't in the note any more`)
    to = from + e.find.length
  } else if (e.after) {
    const i = nearest(doc, e.after, e.line)
    if (i < 0) throw new Error(`"${e.after.slice(0, 60)}" isn't in the note any more`)
    from = to = view.state.doc.lineAt(i + e.after.length).to
    text = `\n${text.replace(/\n$/, "")}`
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
  const animate = e.animate !== false && document.visibilityState === "visible" && !matchMedia("(prefers-reduced-motion: reduce)").matches
  view.dispatch({ changes: { from, to, insert: text }, effects: spanIs.of({ from, at: animate ? from : from + text.length, to: from + text.length }),
    annotations: [own.of(true), Transaction.userEvent.of("input.companion")] })
  if (animate) {
    const size = Math.ceil(text.length / Math.max(1, Math.round(Math.min(1600, text.length * 14) / 16)))
    for (let s = view.state.field(span); s && s.at < s.to && view.dom.isConnected; s = view.state.field(span)) {
      const at = Math.min(s.to, s.at + size)
      view.dispatch({ effects: spanIs.of({ ...s, at }) })
      setTyping({ view, pos: at, agent: e.agent })
      await sleep(16)
    }
  }
  const s = view.state.field(span)
  view.dispatch({ effects: [spanIs.of(null), ...(s ? [lit.of({ from: s.from, to: s.to, tint: tintOf(e.agent) })] : [])] })
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

/** How long without typing before what they wrote is said: longer mid-sentence, anything but a sentence's end
 *  (dictation lands in bursts, with thinking between, and a burst is often half a thought); not for an ask, which,
 *  written on, comes again. */
function pauseIn(state: EditorState) {
  const ms = (Number(pluginSettings("companion").get().pause) || 2) * 1000
  const head = state.selection.main.head, line = state.doc.lineAt(head)
  const before = state.sliceDoc(line.from, head).trimEnd()
  return before && !/[.?!…:;]["'”’)\]*_`]*$/u.test(before) && !mentionIn(line.text) ? ms * 2.5 : ms
}

/** The ask a pause will send, per editor: its line's start, the pause (ms), and a count that restarts its chip's fill. */
const waiting = new WeakMap<EditorView, { from: number; ms: number; k: number }>()

function watcher(path: string) {
  return ViewPlugin.fromClass(class {
    decorations: DecorationSet
    baseline: Text
    pending: ChangeSet // what they typed since baseline
    asked: string[] = [] // lines whose ask went, as they read then: not sent again until they change
    touched: number[] = [] // where they typed since the last pause
    typedAt = 0 // when they last typed
    dirty = false
    timer: ReturnType<typeof setTimeout> | null = null
    whereTimer: ReturnType<typeof setTimeout> | null = null
    stop: () => void
    readonly view: EditorView
    constructor(view: EditorView) {
      this.view = view
      this.decorations = decorate(view, path)
      this.baseline = view.state.doc
      this.pending = ChangeSet.empty(view.state.doc.length)
      views.set(view, path)
      queueMicrotask(() => sayWhere())
      this.stop = subscribe(() => requestAnimationFrame(() => { if (view.dom.isConnected) view.dispatch({ effects: refresh.of(null) }) }))
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.transactions.some((t) => t.effects.some((e) => e.is(refresh)))) this.decorations = decorate(u.view, path)
      if (u.docChanged || u.geometryChanged || u.viewportChanged || u.selectionSet || u.focusChanged) bump()
      if (u.focusChanged || (u.selectionSet && u.state.doc.lineAt(u.state.selection.main.head).number !== u.startState.doc.lineAt(u.startState.selection.main.head).number)) {
        if (this.whereTimer) clearTimeout(this.whereTimer)
        this.whereTimer = setTimeout(() => sayWhere(u.view.hasFocus), u.focusChanged ? 0 : 800)
      }
      if (!u.docChanged) return
      let typed = false
      const asks: number[] = []
      for (const tr of u.transactions) {
        if (!tr.docChanged) continue
        this.touched = this.touched.map((p) => tr.changes.mapPos(p))
        if (!tr.annotation(own) && ["input", "delete", "move", "undo", "redo"].some((e) => tr.isUserEvent(e))) {
          typed = true
          this.pending = this.pending.compose(tr.changes)
          tr.changes.iterChanges((_fa, _ta, fromB, toB, inserted) => {
            this.touched = [...this.touched.slice(-100), fromB, toB]
            const n = tr.state.doc.lineAt(fromB).number
            if (inserted.toString().includes("\n") && this.ask(n, tr.state.doc)) asks.push(n)
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
      this.typedAt = Date.now()
      this.dirty = true
      this.later()
      this.wait(u.state)
    }
    /** The line they're on, when it asks something not sent yet: its chip fills over the pause, its agent comes over. */
    wait(state: EditorState) {
      const line = state.doc.lineAt(state.selection.main.head), ask = mentionIn(line.text)
      if (!ask || getState().mode === "off" || this.asked.includes(line.text) || !asksSomething(line.text, mentionsOf(line.text))) return void waiting.delete(this.view)
      waiting.set(this.view, { from: line.from, ms: pauseIn(state), k: (waiting.get(this.view)?.k ?? 0) + 1 })
      listen(ask.name, path, line.number)
    }
    /** Send line `n`'s ask, if it has one not sent as it reads now; `pause`: only one with words besides the @name. */
    ask(n: number, doc: Text, pause = false) {
      const line = doc.line(n), ask = mentionIn(line.text)
      if (!ask || getState().mode === "off" || this.asked.includes(line.text) || (pause && !asksSomething(line.text, mentionsOf(line.text)))) return false
      this.asked = [...this.asked.slice(-50), line.text]
      sendMoment({ kind: "ask", agent: ask.name, path, line: n, text: ask.text, waited: Date.now() - this.typedAt })
      return true
    }
    later() {
      if (this.timer) clearTimeout(this.timer)
      this.timer = setTimeout(() => (this.view.composing ? this.later() : this.report(this.view.state.doc)), pauseIn(this.view.state))
    }
    report(doc: Text) {
      if (this.timer) { clearTimeout(this.timer); this.timer = null }
      // (an ask not ended with Enter, as "how is it going @claude?": sent at the pause)
      const asks = [...new Set(this.touched.filter((p) => p <= doc.length).map((p) => doc.lineAt(p).number))].filter((n) => this.ask(n, doc, true))
      this.touched = []
      if (waiting.delete(this.view) && !asks.length) queueMicrotask(() => { if (this.view.dom.isConnected) this.view.dispatch({ effects: refresh.of(null) }) })
      if (asks.length && this.view.dom.isConnected) markSent(this.view, asks)
      this.dirty = false
      const md = getState().mode
      if (md === "notice" || md === "pair") {
        // (lines that only write asks reach the agents as those asks, not twice)
        const hunks = hunksOf(this.baseline.toString().split("\n"), doc.toString().split("\n")).filter((h) => [...h.removed, ...h.added].some((l) => l.trim() && !mentionIn(l)))
        if (hunks.length) sendMoment({ kind: "edit", path, line: hunks[0].line, hunks, waited: Date.now() - this.typedAt })
      }
      this.baseline = doc
      this.pending = ChangeSet.empty(doc.length)
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
  if (st.mode === "off") return Decoration.none
  const names = mentionNames(), mid = midNames(), lit = view.state.field(sentAt, false) ?? [], w = waiting.get(view), b = new RangeSetBuilder<Decoration>()
  let last = -1
  for (const r of view.visibleRanges) {
    for (let pos = r.from; pos <= r.to;) {
      const line = view.state.doc.lineAt(pos)
      pos = line.to + 1
      if (line.number <= last) continue
      last = line.number
      for (const m of mentionsOf(line.text, names, mid)) {
        const a = mentionAgent(m.name)
        const asked = lit.includes(line.from) || (a?.state === "thinking" && a.path === path && a.line === line.number), soon = !asked && w?.from === line.from
        b.add(line.from + m.from, line.from + m.to, Decoration.mark({ class: asked ? "cm-companion-mention cm-companion-asked" : soon ? "cm-companion-mention cm-companion-soon" : "cm-companion-mention",
          attributes: { style: `--c: var(--${a?.tint ?? "orange"})${soon ? `; --d: ${w.ms}ms` : ""}`, "data-agent": a?.name ?? st.name, ...(soon ? { "data-k": String(w.k) } : {}) } }))
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
  // (an ask the pause will send: a line fills under its @name until it goes)
  ".cm-companion-soon": { backgroundImage: "linear-gradient(var(--c), var(--c))", backgroundRepeat: "no-repeat", backgroundPosition: "0 100%", backgroundSize: "0% 2px",
    animation: "cm-companion-fill var(--d) linear forwards" },
  "@keyframes cm-companion-fill": { to: { backgroundSize: "100% 2px" } },
  "@media (prefers-reduced-motion: reduce)": { ".cm-companion-asked, .cm-companion-soon": { animation: "none" } },
  ".cm-companion-hl": { backgroundColor: "color-mix(in srgb, var(--c) 32%, transparent)", borderRadius: "3px", animation: "cm-companion-in .4s ease-out" },
  ".cm-companion-hl-line": { backgroundColor: "color-mix(in srgb, var(--c) 14%, transparent)" },
  ".cm-companion-anchor": { textDecoration: "underline dotted var(--c)", textDecorationThickness: "2px", textUnderlineOffset: "4px" },
  ".cm-companion-line": { boxShadow: "inset 2px 0 0 color-mix(in srgb, var(--c) 70%, transparent)" },
  ".cm-companion-del": { textDecoration: "line-through", textDecorationColor: "var(--c)", textDecorationThickness: "2px", opacity: ".6" },
  ".cm-companion-ins": { color: "var(--c)", backgroundColor: "color-mix(in srgb, var(--c) 12%, transparent)", borderRadius: "3px", padding: "0 2px", marginLeft: "2px",
    animation: "cm-companion-in .3s ease-out" },
  ".cm-companion-veiled, .cm-companion-veiled *": { color: "transparent !important" },
  ".cm-companion-typed": { backgroundColor: "color-mix(in srgb, var(--c) 24%, transparent)", borderRadius: "2px", animation: "cm-companion-fade 4s ease-in forwards" },
  "@keyframes cm-companion-in": { from: { backgroundColor: "transparent" } },
  "@keyframes cm-companion-fade": { "0%, 40%": {}, "100%": { backgroundColor: "transparent" } },
})

/** @ anywhere a mention can start: the agents around now, the companion first. */
function mentions(ctx: CompletionContext) {
  const m = ctx.matchBefore(/@[\w-]*$/)
  if (!m || getState().mode === "off" || !canMention(ctx.state.sliceDoc(ctx.state.doc.lineAt(m.from).from, m.from))) return null
  const names = liveAgents().map((a) => a.name)
  return { from: m.from + 1, validFor: /^[\w-]*$/,
    options: (names.length ? names : [getState().name]).map((n) => ({ label: n.toLowerCase(), detail: n === getState().name ? "companion" : undefined,
      boost: n === getState().name ? 1 : 0, apply: `${n.toLowerCase()} `, highlight: mentionAgent(n)?.tint ?? "orange" })) }
}

/** The extension for a note's editor (only a file's own: an embed or a field has no path). */
export function companionExtension(ctx: EditorCtx): Extension {
  if (ctx.kind !== "markdown" || !ctx.path) return []
  const path = ctx.path
  const keys = Prec.highest(keymap.of([
    { key: "Tab", run: (v) => { const n = suggestionAt(v, path); if (!n) return false; void accept(n); return true } },
    { key: "Escape", run: (v) => { const n = suggestionAt(v, path); if (!n) return false; answer(n.id, "reject"); return true } },
  ]))
  return [typed, span, sentAt, watcher(path), chips(path), keys, theme, EditorState.languageData.of(() => [{ suggest: mentions }])]
}
