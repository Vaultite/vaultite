import { RangeSetBuilder, StateEffect, StateField, type Text } from "@codemirror/state"
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, WidgetType } from "@codemirror/view"
import { type MenuItem, notifyError, op, share } from "@vaultite"
import { MessageCircle } from "lucide-react"
import { authorAt } from "@plugins/provenance/gutter"
import { getState, hideSay, shownFor, liveAgents, mentionAgent, mentionNames, mentionsOf, midNames, type Note, threadTint, tintOf, viewOf } from "./live"
import { privateNote } from "./private"
import { nearest } from "./text"
import { refresh } from "./typing"

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

export function placeOf(doc: Text, n: { line?: number; find?: string }): { from: number; to: number } | null {
  if (n.find) {
    const i = nearest(doc.toString(), n.find, n.line)
    return i < 0 ? null : { from: i, to: i + n.find.length }
  }
  if (!n.line) return null
  const l = doc.line(Math.max(1, Math.min(n.line, doc.lines)))
  return { from: l.from, to: l.from }
}

const litOf = (n: Pick<Note, "by" | "tint" | "agent">) => (n.by === "user" ? "var(--yellow)" : threadTint(n as Note))

export function decorate(view: EditorView, path: string): DecorationSet {
  const st = getState(), draft = st.draft?.path === path ? st.draft : null
  const mine = st.notes.filter((n) => n.path === path && n.kind !== "say")
  if (!mine.length && !draft) return Decoration.none
  const marks: { from: number; to: number; deco: Decoration }[] = []
  const picked = st.picked
  const doc = view.state.doc
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

export function suggestionAt(view: EditorView, path: string): Note | null {
  const head = view.state.doc.lineAt(view.state.selection.main.head).number
  for (const n of getState().notes) {
    if (n.kind !== "suggestion" || n.path !== path) continue
    const p = placeOf(view.state.doc, n)
    if (p && head >= view.state.doc.lineAt(p.from).number && head <= view.state.doc.lineAt(p.to).number) return n
  }
  return null
}


export function dismissSays(path: string) {
  for (const n of getState().notes) if (n.kind === "say" && (!n.path || n.path === path) && shownFor(n.id) > 1500) hideSay(n.id)
}

export function foldNear(path: string, agent: string, line?: number) {
  const view = viewOf(path)
  if (!view || !line || !view.state.facet(EditorView.editable)) return null
  const doc = view.state.doc
  for (let n = Math.max(1, line - 1); n <= Math.min(doc.lines, line + 3); n++) {
    const at = authorAt(view, doc.line(n).from)
    if (at && at.by.toLowerCase() === agent.toLowerCase()) return () => foldIn(view, path, agent, at.from, at.to)
  }
  return null
}

export function foldItems(view: EditorView, path: string): MenuItem[] {
  const at = authorAt(view), a = at && liveAgents().find((x) => x.name.toLowerCase() === at.by.toLowerCase())
  return a && view.state.facet(EditorView.editable) ? [{ label: "Fold into a bubble", icon: MessageCircle, run: () => foldIn(view, path, a.name, at.from, at.to) }] : []
}

function foldIn(view: EditorView, path: string, agent: string, from: number, to: number) {
  const doc = view.state.doc, a = doc.lineAt(from), b = doc.lineAt(to), text = doc.sliceString(a.from, b.to)
  const prev = a.number > 1 ? doc.line(a.number - 1) : null, next = b.number < doc.lines ? doc.line(b.number + 1) : null
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


const sent = StateEffect.define<number[]>()
export const sentAt = StateField.define<number[]>({
  create: () => [],
  update(v, tr) {
    for (const e of tr.effects) if (e.is(sent)) return e.value
    return v.length && tr.docChanged ? v.map((p) => tr.changes.mapPos(p)) : v
  },
})
export function markSent(view: EditorView, lines: number[]) {
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

export function chips(path: string) {
  return ViewPlugin.fromClass(class {
    decorations: DecorationSet
    constructor(view: EditorView) { this.decorations = chipsOf(view, path) }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged || u.transactions.some((t) => t.effects.some((e) => e.is(refresh) || e.is(sent)))) this.decorations = chipsOf(u.view, path)
    }
  }, { decorations: (v) => v.decorations })
}