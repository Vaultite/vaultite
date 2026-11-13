import { ChangeSet, EditorState, type Text } from "@codemirror/state"
import { type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view"
import { dictation, onDictation, pluginSettings } from "@vaultite"
import { asksSomething, bump, hear, getState, hunksIn, listen, mentionIn, mentionsOf, sayWhere, sendMoment, sayWhereSoon, subscribe, views } from "./live"
import { privateNote } from "./private"
import { own, refresh, userTyped } from "./typing"
import { decorate, dismissSays, markSent } from "./decorate"

function pauseIn(state: EditorState, burst = false) {
  const ms = (Number(pluginSettings("companion").get().pause) || 2) * 1000
  const head = state.selection.main.head, line = state.doc.lineAt(head)
  const before = state.sliceDoc(line.from, head).trimEnd()
  if (/\?["'”’)\]*_`]*$/u.test(before)) return NOW_MS
  if (burst || !before || /[.!…:;]["'”’)\]*_`]*$/u.test(before)) return SOON_MS
  return mentionIn(line.text) ? ms : ms * 2.5
}
const NOW_MS = 60, SOON_MS = 600
const BURST = 24

export function watcher(path: string) {
  return ViewPlugin.fromClass(class {
    decorations: DecorationSet
    baseline: Text
    pending: ChangeSet
    asked: string[] = []
    touched: number[] = []
    typedAt = 0
    burst = false
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
      for (const t of view.state.doc.iterLines()) if (t.includes("@") && /(?<![\w@./])@[\w-]/.test(t)) this.asked.push(t)
      this.pending = ChangeSet.empty(view.state.doc.length)
      views.set(view, path)
      sayWhereSoon()
      bump()
      let shown = false
      this.sight = new ResizeObserver(() => { const now = view.dom.getClientRects().length > 0; if (now !== shown) { shown = now; sayWhereSoon() } })
      this.sight.observe(view.dom)
      this.stop = subscribe(() => requestAnimationFrame(() => { if (view.dom.isConnected) view.dispatch({ effects: refresh.of(null) }) }))
      this.unhear = onDictation((e, where) => { if (where.view === view) this.heard(e.type, e.type === "pause" ? e.ms : 0) })
    }
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
            else if (text.includes("\n") && !tr.isUserEvent("input.paste") && !tr.isUserEvent("input.drop")) entered = true
            if (text.includes("\n") && this.ask(n, tr.state.doc)) asks.push(n)
          })
          continue
        }
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
    beckon(state: EditorState) {
      const line = state.doc.lineAt(state.selection.main.head), ask = mentionIn(line.text)
      if (ask && getState().mode !== "off" && !privateNote(path, state.doc.sliceString(0, 4096)) && !this.asked.includes(line.text) && asksSomething(line.text, mentionsOf(line.text))) listen(ask.name, path, line.number)
    }
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
      if (!now && !paused && dictation()?.target.view === this.view) { this.timer = null; return }
      this.timer = setTimeout(() => (this.view.composing ? this.later() : this.report(this.view.state.doc)), now ? NOW_MS : pauseIn(this.view.state, this.burst))
    }
    report(doc: Text) {
      if (this.timer) { clearTimeout(this.timer); this.timer = null }
      this.burst = false
      const asks = [...new Set(this.touched.filter((p) => p <= doc.length).map((p) => doc.lineAt(p).number))].filter((n) => this.ask(n, doc, true))
      this.touched = []
      if (asks.length && this.view.dom.isConnected) markSent(this.view, asks)
      this.dirty = false
      const md = getState().mode
      if (md === "pair" && !privateNote(path, doc.sliceString(0, 4096))) {
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
      if (dictation()?.target.view === this.view) hear(null)
      views.delete(this.view)
      sayWhereSoon()
      bump()
    }
  }, { decorations: (v) => v.decorations })
}