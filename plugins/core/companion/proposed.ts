// Proposals in a note's editor: tracked changes in the agent's colour (in a table, cell by cell under it), placeholders
// while it writes, and a small bar by the change the cursor is in.
import { type EditorState, type Extension, Prec, StateEffect, StateField } from "@codemirror/state"
import { Decoration, type DecorationSet, EditorView, keymap, showTooltip, type Tooltip, ViewPlugin, WidgetType } from "@codemirror/view"
import { keyHint } from "@vaultite"
import { getState, type Note, review, subscribe, tintOf } from "./live"
import { type Change, changeAt, span } from "./text"

const redraw = StateEffect.define<null>()

/** A change where it is now: from..to its text in the note (the lines it covers: lineFrom..lineTo). In a table (its
 *  rows only): the table's end, where its cells are drawn (the table itself is drawn over its lines), and its header. */
export type Placed = { n: Note; c: Change; from: number; to: number; lineFrom: number; lineTo: number; table?: { end: number; head: string } }

const ROW = /^\s*\|/
const rowsOf = (s: string) => s.split("\n").filter((l, i, all) => l || i < all.length - 1)
/** A table row's cells (pipes escaped with \ stay in their cell). */
const cellsOf = (row: string) => row.trim().replace(/^\|/, "").replace(/(?<!\\)\|$/, "").split(/(?<!\\)\|/).map((x) => x.trim())
const separator = (row: string) => /^\s*\|?[\s:|-]+$/.test(row) && row.includes("-")

/** The table a change's rows are in: where it ends and its header row; none when it isn't only table rows. */
function tableOf(state: EditorState, c: Change, lineFrom: number, lineTo: number) {
  const rows = [...rowsOf(c.find), ...rowsOf(c.text)]
  if (!rows.length || !rows.every((r) => ROW.test(r))) return undefined
  const doc = state.doc
  let first = doc.lineAt(lineFrom).number, last = doc.lineAt(lineTo).number
  while (first > 1 && ROW.test(doc.line(first - 1).text)) first--
  while (last < doc.lines && ROW.test(doc.line(last + 1).text)) last++
  return { end: doc.line(last).to, head: doc.line(first).text }
}

/** A note's proposals' changes in the editor's text, in order; stale ones (their text gone) aren't. */
export function placedIn(state: EditorState, path: string): Placed[] {
  const text = state.doc.toString(), out: Placed[] = []
  for (const n of getState().notes) {
    if (n.kind !== "proposal" || n.path !== path) continue
    for (const c of n.changes ?? []) {
      const at = c.stale ? -1 : changeAt(text, c)
      if (at < 0 || (!c.find && c.intent)) continue
      const to = at + c.find.length, end = c.find.endsWith("\n") && to > at ? to - 1 : to
      const lineFrom = state.doc.lineAt(at).from, lineTo = state.doc.lineAt(end).to, table = c.intent ? undefined : tableOf(state, c, lineFrom, lineTo)
      out.push({ n, c, from: at, to, lineFrom, lineTo, ...(table ? { table } : {}) })
    }
  }
  return out.sort((a, b) => a.from - b.from)
}

/** The change the cursor is in (its lines), if any. */
export function changeAtCursor(state: EditorState, path: string): Placed | null {
  const head = state.selection.main.head
  // (a table's are taken from their cells' block: Tab there is the table's)
  return placedIn(state, path).find((p) => !p.c.intent && !p.table && head >= p.lineFrom && head <= p.lineTo) ?? null
}

/** Lines that come, under what goes; or a placeholder: its agent and what it's writing. */
class Coming extends WidgetType {
  readonly text: string
  readonly tint: string
  readonly intent: string
  readonly agent: string
  constructor(text: string, tint: string, intent = "", agent = "") { super(); this.text = text; this.tint = tint; this.intent = intent; this.agent = agent }
  eq(o: Coming) { return o.text === this.text && o.tint === this.tint && o.intent === this.intent && o.agent === this.agent }
  toDOM() {
    const d = document.createElement("div")
    d.style.setProperty("--c", this.tint)
    if (this.intent) {
      d.className = "cm-companion-pending"
      d.appendChild(document.createElement("b")).textContent = this.agent
      d.appendChild(document.createTextNode(` ${this.intent}`))
      const dots = d.appendChild(document.createElement("span"))
      dots.className = "companion-dots"
      for (let i = 0; i < 3; i++) dots.appendChild(document.createElement("i"))
    } else {
      d.className = "cm-companion-coming"
      d.textContent = this.text
    }
    return d
  }
  ignoreEvent() { return false }
}

class Inline extends WidgetType {
  readonly text: string
  readonly tint: string
  constructor(text: string, tint: string) { super(); this.text = text; this.tint = tint }
  eq(o: Inline) { return o.text === this.text && o.tint === this.tint }
  toDOM() {
    const s = document.createElement("span")
    s.className = "cm-companion-ins"
    s.style.setProperty("--c", this.tint)
    s.textContent = this.text
    return s
  }
  ignoreEvent() { return false }
}

/** A table's change cell by cell, under the table: each changed row's cells, the old struck and the new in the agent's
 *  colour; rows added in its colour, rows removed struck; and its own Accept and Reject. */
class Cells extends WidgetType {
  readonly p: Placed
  readonly tint: string
  constructor(p: Placed, tint: string) { super(); this.p = p; this.tint = tint }
  eq(o: Cells) { return o.tint === this.tint && o.p.c.id === this.p.c.id && o.p.c.find === this.p.c.find && o.p.c.text === this.p.c.text && o.p.table?.head === this.p.table?.head }
  toDOM() {
    const { n, c, table } = this.p, d = document.createElement("div")
    d.className = "cm-companion-cells"
    d.setAttribute("data-companion-change", c.id)
    d.style.setProperty("--c", this.tint)
    const top = d.appendChild(document.createElement("div"))
    top.className = "cm-companion-cells-top"
    top.appendChild(document.createElement("b")).textContent = n.agent
    top.appendChild(document.createTextNode(" proposes"))
    top.appendChild(document.createElement("span")).style.flex = "1"
    for (const [label, verdict] of [["Accept", "accept"], ["Reject", "reject"]] as const) {
      const b = top.appendChild(document.createElement("button"))
      b.type = "button"
      b.textContent = label
      if (verdict === "accept") b.className = "cm-companion-take"
      b.onmousedown = (e) => e.preventDefault()
      b.onclick = () => review(n.id, verdict, c.id)
    }
    // (the rows both sides share, as a row the change took along to be found by, aren't drawn)
    let gone = rowsOf(c.find).filter((r) => !separator(r)), come = rowsOf(c.text).filter((r) => !separator(r))
    while (gone.length && come.length && gone[0] === come[0]) { gone = gone.slice(1); come = come.slice(1) }
    while (gone.length && come.length && gone[gone.length - 1] === come[come.length - 1]) { gone = gone.slice(0, -1); come = come.slice(0, -1) }
    const t = d.appendChild(document.createElement("table")), head = cellsOf(table?.head ?? "")
    const hr = t.appendChild(document.createElement("thead")).appendChild(document.createElement("tr"))
    for (const h of head) hr.appendChild(document.createElement("th")).textContent = h
    const body = t.appendChild(document.createElement("tbody"))
    for (let i = 0; i < Math.max(gone.length, come.length); i++) {
      const was = gone[i] === undefined ? null : cellsOf(gone[i]!), now = come[i] === undefined ? null : cellsOf(come[i]!)
      const tr = body.appendChild(document.createElement("tr"))
      if (!now) tr.className = "cm-companion-row-gone"
      else if (!was) tr.className = "cm-companion-row-come"
      for (let k = 0; k < Math.max(head.length, was?.length ?? 0, now?.length ?? 0); k++) {
        const td = tr.appendChild(document.createElement("td")), a = was?.[k] ?? "", b = now?.[k] ?? ""
        if (!was || !now || a === b) { td.textContent = now ? b : a; continue }
        td.className = "cm-companion-cell-changed"
        if (a) td.appendChild(document.createElement("del")).textContent = a
        if (b) td.appendChild(document.createElement("ins")).textContent = b
      }
    }
    return d
  }
  ignoreEvent() { return true }
}

/** How a change reads in the text: added lines in a block (under the line above, or above the top line), one line
 *  changed in it (struck words, new ones beside), else its lines struck and what comes under them. */
function drawn(state: EditorState, path: string): DecorationSet {
  const marks: { from: number; to: number; deco: Decoration }[] = []
  const doc = state.doc, active = changeAtCursor(state, path)
  for (const p of placedIn(state, path)) {
    const { n, c } = p, tint = tintOf(n.agent), style = `--c: ${tint}`
    if (c.intent) {
      marks.push({ from: p.lineTo, to: p.lineTo, deco: Decoration.widget({ widget: new Coming("", tint, c.intent, n.agent), block: true, side: 1 }) })
      continue
    }
    if (p.table) {
      marks.push({ from: p.table.end, to: p.table.end, deco: Decoration.widget({ widget: new Cells(p, tint), block: true, side: 1 }) })
      continue
    }
    const on = active?.c.id === c.id
    for (let l = doc.lineAt(p.from).number, last = doc.lineAt(p.lineTo).number; on && l <= last; l++)
      marks.push({ from: doc.line(l).from, to: doc.line(l).from, deco: Decoration.line({ class: "cm-companion-change-on", attributes: { style } }) })
    if (c.find && c.text.startsWith(c.find)) {
      const add = c.text.slice(c.find.length)
      if (c.find.endsWith("\n")) marks.push({ from: p.to, to: p.to, deco: Decoration.widget({ widget: new Coming(add.replace(/\n$/, ""), tint), block: true, side: -1 }) })
      else marks.push({ from: p.lineTo, to: p.lineTo, deco: Decoration.widget({ widget: new Coming(add.replace(/^\n/, "").replace(/\n$/, ""), tint), block: true, side: 1 }) })
      continue
    }
    if (c.find && c.text.endsWith(c.find)) {
      marks.push({ from: p.from, to: p.from, deco: Decoration.widget({ widget: new Coming(c.text.slice(0, -c.find.length).replace(/\n$/, ""), tint), block: true, side: -1 }) })
      continue
    }
    const one = (s: string) => !s.replace(/\n$/, "").includes("\n")
    if (one(c.find) && one(c.text) && c.find.endsWith("\n") === c.text.endsWith("\n")) {
      const [head, tail] = span(c.find, c.text), from = p.from + head, to = p.to - tail
      if (to > from) marks.push({ from, to, deco: Decoration.mark({ class: "cm-companion-del", attributes: { style } }) })
      const add = c.text.slice(head, c.text.length - tail)
      if (add) marks.push({ from: to, to, deco: Decoration.widget({ widget: new Inline(add, tint), side: 1 }) })
      continue
    }
    for (let l = doc.lineAt(p.from).number, last = doc.lineAt(p.lineTo).number; l <= last; l++)
      marks.push({ from: doc.line(l).from, to: doc.line(l).from, deco: Decoration.line({ class: "cm-companion-gone", attributes: { style } }) })
    const add = c.text.replace(/\n$/, "")
    if (add || c.text) marks.push({ from: p.lineTo, to: p.lineTo, deco: Decoration.widget({ widget: new Coming(add, tint), block: true, side: 1 }) })
  }
  return Decoration.set(marks.map((m) => m.deco.range(m.from, m.to)), true)
}

/** The bar by the change the cursor is in: Accept, Reject, which of how many. */
function bar(state: EditorState, path: string): Tooltip | null {
  const p = changeAtCursor(state, path)
  if (!p) return null
  const all = placedIn(state, path).filter((x) => !x.c.intent), i = all.findIndex((x) => x.c.id === p.c.id)
  return {
    pos: p.lineFrom,
    above: true,
    strictSide: false,
    arrow: false,
    create: () => {
      const dom = document.createElement("div")
      dom.className = "cm-companion-review"
      dom.setAttribute("data-companion-review", p.c.id)
      dom.style.setProperty("--c", tintOf(p.n.agent))
      const button = (label: string, key: string, verdict: "accept" | "reject") => {
        const b = dom.appendChild(document.createElement("button"))
        b.type = "button"
        b.className = verdict === "accept" ? "cm-companion-take" : ""
        b.textContent = label
        b.appendChild(document.createElement("kbd")).textContent = keyHint(key)
        b.onmousedown = (e) => e.preventDefault()
        b.onclick = () => review(p.n.id, verdict, p.c.id)
      }
      const who = dom.appendChild(document.createElement("span"))
      who.textContent = `${p.n.agent}${all.length > 1 ? ` · ${i + 1} of ${all.length}` : ""}`
      button("Accept", "Tab", "accept")
      button("Reject", "Escape", "reject")
      return { dom }
    },
  }
}

/** Move the cursor to the next (or previous) change in the note: true when there's one. */
export function step(view: EditorView, path: string, dir: 1 | -1) {
  const all = placedIn(view.state, path).filter((x) => !x.c.intent)
  if (!all.length) return false
  const head = view.state.selection.main.head
  const next = dir > 0 ? all.find((x) => x.lineFrom > head) ?? all[0] : [...all].reverse().find((x) => x.lineTo < head) ?? all[all.length - 1]
  // (a table's: its cells' block brought into sight, the cursor left out of the drawn table)
  if (next.table) view.dispatch({ effects: EditorView.scrollIntoView(next.table.end, { y: "center" }) })
  else view.dispatch({ selection: { anchor: next.lineFrom }, effects: EditorView.scrollIntoView(next.lineFrom, { y: "center" }) })
  view.focus()
  return true
}

/** Take or leave the change the cursor is in: true when it was in one. */
export function decide(view: EditorView, path: string, verdict: "accept" | "reject") {
  const p = changeAtCursor(view.state, path)
  if (!p) return false
  review(p.n.id, verdict, p.c.id)
  return true
}

/** Proposals in note `path`'s editor: drawn, a bar by the cursor's change, ⌥] ⌥[ through them. */
export function proposals(path: string): Extension {
  const field = StateField.define<DecorationSet>({
    create: (s) => drawn(s, path),
    update: (deco, tr) => (tr.docChanged || tr.selection || tr.effects.some((e) => e.is(redraw)) ? drawn(tr.state, path) : deco),
    provide: (f) => EditorView.decorations.from(f),
  })
  const tip = StateField.define<Tooltip | null>({
    create: (s) => bar(s, path),
    update: (t, tr) => {
      const again = tr.docChanged || tr.effects.some((e) => e.is(redraw))
      if (!again && !tr.selection) return t
      // (the cursor moved within the same change: the same bar, not one drawn again)
      if (!again && t && changeAtCursor(tr.state, path)?.lineFrom === t.pos) return t
      return bar(tr.state, path)
    },
    provide: (f) => showTooltip.from(f),
  })
  const listen = ViewPlugin.define((view) => {
    const stop = subscribe(() => requestAnimationFrame(() => { if (view.dom.isConnected) view.dispatch({ effects: redraw.of(null) }) }))
    return { destroy: stop }
  })
  const keys = Prec.high(keymap.of([
    { key: "Alt-]", run: (v) => step(v, path, 1) },
    { key: "Alt-[", run: (v) => step(v, path, -1) },
  ]))
  return [field, tip, listen, keys, theme]
}

const theme = EditorView.baseTheme({
  ".cm-companion-coming": { whiteSpace: "pre-wrap", color: "var(--foreground)", backgroundColor: "color-mix(in srgb, var(--c) 9%, transparent)",
    boxShadow: "inset 2px 0 0 var(--c)", padding: "1px 0 1px 8px", margin: "1px 0", borderRadius: "0 4px 4px 0", animation: "cm-companion-in .3s ease-out" },
  ".cm-companion-gone": { textDecoration: "line-through", textDecorationColor: "color-mix(in srgb, var(--c) 70%, transparent)", textDecorationThickness: "1.5px",
    color: "color-mix(in srgb, var(--foreground) 50%, transparent)" },
  ".cm-companion-change-on": { backgroundColor: "color-mix(in srgb, var(--c) 6%, transparent)" },
  ".cm-companion-pending": { color: "var(--muted-foreground)", fontSize: ".92em", padding: "2px 0 2px 8px", margin: "2px 0", boxShadow: "inset 2px 0 0 var(--c)",
    display: "flex", alignItems: "center", gap: "6px", animation: "cm-companion-breathe 2.4s ease-in-out infinite" },
  ".cm-companion-pending > b": { color: "var(--c)", fontWeight: "600" },
  ".cm-companion-pending .companion-dots": { color: "var(--c)" },
  "@keyframes cm-companion-breathe": { "0%, 100%": { opacity: ".65" }, "50%": { opacity: "1" } },
  "@media (prefers-reduced-motion: reduce)": { ".cm-companion-pending, .cm-companion-coming": { animation: "none" } },
  ".cm-companion-cells": { margin: "4px 0 6px", padding: "6px 8px 8px", borderRadius: "8px", boxShadow: "inset 2px 0 0 var(--c)", fontSize: ".9em",
    backgroundColor: "color-mix(in srgb, var(--c) 6%, transparent)", animation: "cm-companion-in .3s ease-out" },
  ".cm-companion-cells-top": { display: "flex", alignItems: "center", gap: "4px", marginBottom: "4px", fontSize: "12px", color: "var(--muted-foreground)", fontFamily: "var(--font-sans)" },
  ".cm-companion-cells-top > b": { color: "var(--c)", fontWeight: "600" },
  ".cm-companion-cells-top button": { padding: "1px 8px", borderRadius: "6px", cursor: "pointer", fontWeight: "550", color: "var(--foreground)", lineHeight: "18px" },
  ".cm-companion-cells-top button:hover": { background: "color-mix(in srgb, var(--foreground) 7%, transparent)" },
  ".cm-companion-cells-top button.cm-companion-take": { background: "var(--c)", color: "white" },
  ".cm-companion-cells table": { borderCollapse: "collapse", width: "100%" },
  ".cm-companion-cells th": { textAlign: "left", fontWeight: "600", fontSize: "12px", color: "var(--muted-foreground)", padding: "2px 8px 2px 0", borderBottom: "0.5px solid var(--border)" },
  ".cm-companion-cells td": { padding: "3px 8px 3px 0", verticalAlign: "top", color: "color-mix(in srgb, var(--foreground) 55%, transparent)" },
  ".cm-companion-cells del": { textDecorationColor: "var(--c)", opacity: ".6", marginRight: "4px" },
  ".cm-companion-cells ins, .cm-companion-row-come td": { textDecoration: "none", color: "var(--c)", fontWeight: "550" },
  ".cm-companion-row-gone td": { textDecoration: "line-through", textDecorationColor: "var(--c)", opacity: ".6" },
  ".cm-tooltip.cm-companion-review": { display: "flex", alignItems: "center", gap: "2px", padding: "2px", borderRadius: "8px", background: "var(--card)",
    border: "0.5px solid var(--border)", boxShadow: "0 4px 14px rgb(0 0 0 / 0.12)", fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--foreground)" },
  ".cm-companion-review > span": { padding: "0 6px 0 4px", color: "var(--muted-foreground)", whiteSpace: "nowrap" },
  ".cm-companion-review button": { display: "flex", alignItems: "center", gap: "5px", padding: "2px 7px", borderRadius: "6px", cursor: "pointer", fontWeight: "550", lineHeight: "18px" },
  ".cm-companion-review button:hover": { background: "color-mix(in srgb, var(--foreground) 7%, transparent)" },
  ".cm-companion-review button.cm-companion-take": { background: "var(--c)", color: "white" },
  ".cm-companion-review kbd": { fontFamily: "inherit", fontSize: "11px", opacity: ".7" },
})
