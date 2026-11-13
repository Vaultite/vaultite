import { isolateHistory, redo, undo } from "@codemirror/commands"
import { EditorSelection } from "@codemirror/state"
import { EditorView } from "@codemirror/view"
import { ArrowDown, ArrowDownAZ, ArrowDownZA, ArrowLeft, ArrowRight, ArrowUp, BetweenHorizontalEnd, BetweenHorizontalStart,
  BetweenVerticalEnd, BetweenVerticalStart, Code, Columns3, CopyPlus, Eraser, FoldHorizontal, Rows3, TextAlignCenter, TextAlignEnd, TextAlignStart, Trash2 } from "lucide-react"
import { menuShowing, openMenu, type MenuItem } from "@/components/ContextMenu"
import { addDropTarget, edgeScroller, startDrag } from "@/core/drag"
import { isMac } from "@/core/platform"
import { blockLines, markdownDrawn } from "@/core/richmd"
import { elementOf } from "@/core/dom"

import { clipCells, htmlText, markdownTable, pastedTable, tsvText } from "./tablePaste"
import { pastesRaw } from "./paste"
import { clearCells, columnShares, deleteColumn, deleteRow, duplicateRow, edgeFrom, escape, fillCells, fillDown, insertColumn, insertRow, moveColumn, moveRow,
  NARROWEST, parseTable, setWidths, sharedMinWidth, shownText, sortRows, unescape, widen, writeTable, type Align, type Cell, type Table } from "./tableText"

export type TableEnv = {
  render: (md: string) => string
  canEdit: () => boolean
  line: () => number | null
  source: () => void
}

const entries = new WeakMap<HTMLElement, (to: "top" | "bottom" | Cell) => boolean>()
export const enterTable = (body: HTMLElement, to: "top" | "bottom" | Cell) => entries.get(body)?.(to) ?? false

const svg = (paths: string) => `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`
const dots = (xs: number[], ys: number[]) => svg(xs.flatMap((x) => ys.map((y) => `<circle cx="${x}" cy="${y}" r="1"/>`)).join(""))
const PLUS = svg('<path d="M5 12h14"/><path d="M12 5v14"/>')
const STEPS: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }
type Then = { open?: Cell; pick?: [Cell, Cell] }
let made = 0
function shareColumns(box: HTMLElement, t: HTMLTableElement, shares: number[]) {
  box.classList.add("is-shared")
  t.classList.add("has-widths")
  t.style.minWidth = `${sharedMinWidth(shares).toFixed(2)}em`
  let g = t.querySelector(":scope > colgroup")
  if (!g) { g = document.createElement("colgroup"); t.prepend(g) }
  g.replaceChildren(...shares.map((f) => { const col = document.createElement("col"); col.style.width = `${(f * 100).toFixed(3)}%`; return col }))
}

export function drawTable(el: HTMLElement, text: string, view: EditorView, env: TableEnv) {
  let shown = text
  let table = parseTable(text)
  let grid: HTMLTableCellElement[][] | null = null
  let editing: { r: number; c: number; input: HTMLTextAreaElement } | null = null
  let frozen: { table: number; cols: number[] } | null = null
  let sel: { a: Cell; h: Cell } | null = null
  let over: Cell | null = null
  let dragging: { row: boolean; from: number; shown?: boolean } | null = null
  let marked = false
  const id = `table:${++made}`

  const drawn = document.createElement("div")
  drawn.className = "cm-table-view"
  drawn.addEventListener("scroll", () => place(), { passive: true })
  const tools = document.createElement("div")
  tools.className = "cm-table-tools"
  tools.setAttribute("aria-hidden", "true")
  tools.dataset.holdMenu = ""
  const tool = (cls: string, html: string, tip?: string) => {
    const b = document.createElement("button")
    b.type = "button"; b.tabIndex = -1; b.className = `cm-table-tool ${cls}`; b.innerHTML = html
    if (tip) b.dataset.tip = tip
    tools.append(b)
    return b
  }
  const colGrip = tool("cm-table-grip is-col", dots([5, 12, 19], [9, 15]))
  const rowGrip = tool("cm-table-grip is-row", dots([9, 15], [5, 12, 19]))
  const addCol = tool("cm-table-add is-col", PLUS, "Add column")
  const addRow = tool("cm-table-add is-row", PLUS, "Add row")
  const edges: HTMLButtonElement[] = []
  const line = document.createElement("div")
  line.className = "cm-table-drop"
  line.hidden = true
  tools.append(line)
  // The keyboard while cells are selected is a field, so copy, cut and paste reach it; inputmode none keeps a phone's
  // keyboard down.
  const keeper = document.createElement("textarea")
  keeper.className = "cm-table-keys"
  keeper.tabIndex = -1
  keeper.setAttribute("inputmode", "none")
  keeper.setAttribute("aria-label", "Selected cells")
  el.append(drawn, tools, keeper)

  const paint = () => {
    drawn.classList.remove("is-shared")
    drawn.innerHTML = env.render(shown)
    const box = drawn.firstElementChild
    if (box?.classList.contains("md-table-view")) box.replaceWith(...box.childNodes)
    marked = false
    markdownDrawn(drawn, blockLines(env.line, () => shown, () => view.state.doc.toString()))
    const t = drawn.querySelector("table")
    grid = null
    const shares = table && columnShares(table)
    if (t && shares) shareColumns(drawn, t, shares)
    if (t && table) {
      const rows = [...t.rows]
      if (rows.length === table.rows.length && rows.every((r) => r.cells.length === table!.align.length)) {
        grid = rows.map((r) => [...r.cells])
        pin()
        t.dataset.noEdit = ""
        t.dataset.holdMenu = ""
        t.addEventListener("scroll", place, { passive: true })
      }
    }
    mark()
    place()
  }

  const pin = () => {
    const t = drawn.querySelector("table")
    if (!t || !grid || !frozen || frozen.cols.length !== grid[0].length) return
    t.style.tableLayout = "fixed"
    t.style.width = `${frozen.table}px`
    grid[0].forEach((cell, i) => { cell.style.width = `${frozen!.cols[i]}px` })
  }
  const freeze = () => {
    const t = drawn.querySelector("table")
    if (frozen || !t || !grid) return
    frozen = { table: t.getBoundingClientRect().width, cols: grid[0].map((cell) => cell.getBoundingClientRect().width) }
    pin()
  }

  const range = () => {
    const l = env.line()
    if (l === null) return null
    const from = view.state.doc.line(l + 1).from, to = from + shown.length
    return view.state.sliceDoc(from, to) === shown ? { from, to } : null
  }

  const write = (userEvent = "input.type", own = false) => {
    if (!table) return
    const next = writeTable(table), at = range()
    if (!at || next === shown) return
    let a = 0, b = 0
    while (a < shown.length && a < next.length && shown[a] === next[a]) a++
    while (b < shown.length - a && b < next.length - a && shown[shown.length - 1 - b] === next[next.length - 1 - b]) b++
    const insert = next.slice(a, next.length - b)
    shown = next
    view.dispatch({ changes: { from: at.from + a, to: at.to - b, insert }, userEvent, ...(own ? { annotations: isolateHistory.of("full") } : {}) })
  }

  const fit = (input: HTMLTextAreaElement) => { input.style.height = "auto"; input.style.height = `${input.scrollHeight}px` }
  const clamp = (x: Cell): Cell => ({ r: Math.max(0, Math.min(x.r, table!.rows.length - 1)), c: Math.max(0, Math.min(x.c, table!.align.length - 1)) })
  const bounds = () => sel && { r0: Math.min(sel.a.r, sel.h.r), r1: Math.max(sel.a.r, sel.h.r), c0: Math.min(sel.a.c, sel.h.c), c1: Math.max(sel.a.c, sel.h.c) }
  const inSel = (r: number, c: number) => { const b = bounds(); return !!b && r >= b.r0 && r <= b.r1 && c >= b.c0 && c <= b.c1 }
  const mark = () => { if (!sel && !marked) return; marked = !!sel; grid?.forEach((row, r) => row.forEach((cell, c) => cell.classList.toggle("is-selected", inSel(r, c)))) }
  const picked = () => { const b = bounds()!; return table!.rows.slice(b.r0, b.r1 + 1).map((row) => row.cells.slice(b.c0, b.c1 + 1).map(shownText)) }

  function open(r: number, c: number, caret: number | "end" = "end") {
    if (!table || !grid || !env.canEdit()) return false
    if (!grid[r]?.[c]) return false
    freeze()
    if (sel) { sel = null; mark() }
    if (editing) close(true)
    const cell = grid?.[r]?.[c]
    if (!cell) return false
    const input = document.createElement("textarea")
    input.className = "cm-cell-input"
    input.rows = 1
    input.value = shownText(table.rows[r].cells[c])
    input.setAttribute("aria-label", r === 0 ? "Header cell" : "Cell")
    cell.classList.add("is-editing")
    cell.replaceChildren(input)
    editing = { r, c, input }
    fit(input)
    input.focus({ preventScroll: true })
    const at = caret === "end" ? input.value.length : Math.min(caret, input.value.length)
    input.setSelectionRange(at, at)
    input.addEventListener("input", () => {
      if (!table) return
      table.rows[r].cells[c] = escape(input.value)
      fit(input)
      write()
      place()
    })
    input.addEventListener("keydown", (e) => cellKeys(e, r, c, input))
    input.addEventListener("paste", (e) => { if (pasteCells(e.clipboardData, { r, c })) { e.preventDefault(); e.stopPropagation() } })
    input.addEventListener("blur", () => setTimeout(() => {
      if (editing?.input === input && document.activeElement !== input && !menuShowing()) close()
    }))
    place()
    return true
  }

  function close(staying = false) {
    if (!editing) return
    const { r, c } = editing
    editing = null
    if (!staying) frozen = null
    if (!staying || !redraw(r, c)) paint()
  }
  function redraw(r: number, c: number) {
    const cell = grid?.[r]?.[c], src = table?.rows[r]?.cells[c]
    if (!cell || src === undefined) return false
    const box = document.createElement("div")
    box.innerHTML = env.render(`| ${src} |\n| --- |\n`)
    const th = box.querySelector("th")
    if (!th) return false
    cell.classList.remove("is-editing")
    cell.replaceChildren(...th.childNodes)
    markdownDrawn(cell, blockLines(env.line, () => shown, () => view.state.doc.toString()))
    return true
  }

  function select(a: Cell, h: Cell) {
    if (!table || !grid || !env.canEdit()) return
    freeze()
    if (editing) close(true)
    sel = { a: clamp(a), h: clamp(h) }
    mark()
    keeper.value = tsvText(picked())
    if (document.activeElement !== keeper) keeper.focus({ preventScroll: true })
    keeper.select()
    place()
  }
  const unselect = () => { if (!sel) return; sel = null; if (!editing) { frozen = null; paint() } else mark() }

  function leave(down: boolean) {
    const at = range()
    close()
    if (!at) return
    const doc = view.state.doc
    if (down) {
      const end = doc.lineAt(at.to)
      if (end.number < doc.lines) view.dispatch({ selection: EditorSelection.cursor(doc.line(end.number + 1).from), scrollIntoView: true, userEvent: "select" })
      else view.dispatch({ changes: { from: end.to, insert: "\n" }, selection: EditorSelection.cursor(end.to + 1), scrollIntoView: true, userEvent: "input" })
    } else {
      const start = doc.lineAt(at.from)
      if (start.number > 1) view.dispatch({ selection: EditorSelection.cursor(doc.line(start.number - 1).to), scrollIntoView: true, userEvent: "select" })
      else view.dispatch({ changes: { from: 0, insert: "\n" }, selection: EditorSelection.cursor(0), scrollIntoView: true, userEvent: "input" })
    }
    view.focus()
  }

  function change(fn: (t: Table) => void, userEvent: string, then: Then | (() => Then) = {}) {
    if (!table) return
    widen(table)
    fn(table)
    write(userEvent, true)
    editing = null
    sel = null
    frozen = null
    paint()
    const next = typeof then === "function" ? then() : then
    if (next.pick) select(next.pick[0], next.pick[1])
    else if (next.open) { const o = clamp(next.open); open(o.r, o.c) }
  }
  const cols = () => table!.align.length, rows = () => table!.rows.length
  const wholeRow = (r: number): [Cell, Cell] => [{ r, c: 0 }, { r, c: cols() - 1 }]
  const wholeCol = (c: number): [Cell, Cell] => [{ r: 0, c }, { r: rows() - 1, c }]

  function pasteCells(d: DataTransfer | null, at: Cell) {
    if (!d || !table) return false
    const cells = clipCells(d.getData("text/plain"), d.getData("text/html"))
    if (cells) {
      const end = { r: at.r + cells.length - 1, c: at.c + Math.max(...cells.map((r) => r.length)) - 1 }
      change((t) => fillCells(t, at, cells), "input.paste", { pick: [at, end] })
      return true
    }
    const b = bounds(), one = d.getData("text/plain")
    if (!b || !one) return false
    change((t) => fillCells(t, { r: b.r0, c: b.c0 }, Array.from({ length: b.r1 - b.r0 + 1 }, () => Array<string>(b.c1 - b.c0 + 1).fill(one))), "input.paste", { pick: [sel!.a, sel!.h] })
    return true
  }

  function deleteTable() {
    const at = range()
    if (!at) return
    editing = null; sel = null
    const doc = view.state.doc, start = doc.lineAt(at.from), end = doc.lineAt(at.to)
    const next = end.number < doc.lines ? doc.line(end.number + 1) : null
    let from = at.from, to = next ? next.from : at.to
    if (next && !next.text.trim() && start.number > 1 && !doc.line(start.number - 1).text.trim()) to = next.number < doc.lines ? next.to + 1 : next.to
    else if (!next && start.number > 1) from = at.from - 1
    view.dispatch({ changes: { from, to }, selection: EditorSelection.cursor(from), userEvent: "delete", annotations: isolateHistory.of("full"), scrollIntoView: true })
    view.focus()
  }

  function rowItems(r: number, c: number, pick: boolean) {
    const then = (to: number): Then => (pick ? { pick: wholeRow(to) } : { open: { r: to, c } })
    const b = bounds(), many = b && b.r1 > b.r0 && r >= b.r0 && r <= b.r1 && b.r0 > 0 ? b : null
    return {
      above: { label: "Add row above", icon: BetweenHorizontalStart, disabled: r === 0, run: () => change((t) => insertRow(t, r), "input.table", { open: { r, c } }) },
      below: { label: "Add row below", icon: BetweenHorizontalEnd, run: () => change((t) => insertRow(t, r + 1), "input.table", { open: { r: r + 1, c } }) },
      up: { label: "Move row up", icon: ArrowUp, disabled: r < 2, run: () => change((t) => moveRow(t, r, r - 1), "input.table", then(r - 1)) },
      down: { label: "Move row down", icon: ArrowDown, disabled: r === 0 || r === rows() - 1, run: () => change((t) => moveRow(t, r, r + 1), "input.table", then(r + 1)) },
      clear: { label: "Clear row", icon: Eraser, run: () => change((t) => clearCells(t, ...wholeRow(r)), "delete", pick ? { pick: wholeRow(r) } : { open: { r, c } }) },
      dup: { label: "Duplicate row", icon: CopyPlus, disabled: r === 0, run: () => change((t) => duplicateRow(t, r), "input.table", then(r + 1)) },
      remove: many
        ? { label: `Delete ${many.r1 - many.r0 + 1} rows`, icon: Trash2, danger: true, run: () => change((t) => { for (let i = many.r1; i >= many.r0; i--) deleteRow(t, i) }, "delete", { open: { r: Math.min(many.r0, rows() - many.r1 + many.r0 - 2), c } }) }
        : { label: "Delete row", icon: Trash2, danger: true, disabled: r === 0, run: () => change((t) => deleteRow(t, r), "delete", { open: { r, c } }) },
    } satisfies Record<string, MenuItem>
  }
  function colItems(c: number, r: number, pick: boolean) {
    const then = (to: number): Then => (pick ? { pick: wholeCol(to) } : { open: { r, c: to } })
    const align = (a: Align) => change((t) => { t.align[c] = a }, "input.table", then(c))
    const sort = (desc: boolean) => change((t) => sortRows(t, c, desc), "input.table", then(c))
    const b = bounds(), many = b && b.c1 > b.c0 && c >= b.c0 && c <= b.c1 && b.c1 - b.c0 + 1 < cols() ? b : null
    return {
      left: { label: "Add column left", icon: BetweenVerticalStart, run: () => change((t) => insertColumn(t, c), "input.table", { open: { r, c } }) },
      right: { label: "Add column right", icon: BetweenVerticalEnd, run: () => change((t) => insertColumn(t, c + 1), "input.table", { open: { r, c: c + 1 } }) },
      toLeft: { label: "Move column left", icon: ArrowLeft, disabled: c === 0, run: () => change((t) => moveColumn(t, c, c - 1), "input.table", then(c - 1)) },
      toRight: { label: "Move column right", icon: ArrowRight, disabled: c === cols() - 1, run: () => change((t) => moveColumn(t, c, c + 1), "input.table", then(c + 1)) },
      asc: { label: "Sort ascending", icon: ArrowDownAZ, disabled: rows() < 3, run: () => sort(false) },
      desc: { label: "Sort descending", icon: ArrowDownZA, disabled: rows() < 3, run: () => sort(true) },
      align: { label: "Align column", icon: TextAlignStart, run: () => {}, items: [
        { label: "Left", icon: TextAlignStart, checked: table!.align[c] === "" || table!.align[c] === "left", run: () => align("") },
        { label: "Center", icon: TextAlignCenter, checked: table!.align[c] === "center", run: () => align("center") },
        { label: "Right", icon: TextAlignEnd, checked: table!.align[c] === "right", run: () => align("right") },
      ] },
      fit: { label: "Fit columns to text", icon: FoldHorizontal, run: () => change((t) => setWidths(t, null), "input.table", then(c)) },
      clear: { label: "Clear column", icon: Eraser, disabled: rows() < 2,
        run: () => change((t) => clearCells(t, { r: 1, c }, { r: rows() - 1, c }), "delete", pick ? { pick: wholeCol(c) } : { open: { r, c } }) },
      remove: many
        ? { label: `Delete ${many.c1 - many.c0 + 1} columns`, icon: Trash2, danger: true, run: () => change((t) => { for (let i = many.c1; i >= many.c0; i--) deleteColumn(t, i) }, "delete", { open: { r, c: Math.min(many.c0, cols() - many.c1 + many.c0 - 2) } }) }
        : { label: "Delete column", icon: Trash2, danger: true, disabled: cols() < 2, run: () => change((t) => deleteColumn(t, c), "delete", { open: { r, c } }) },
    } satisfies Record<string, MenuItem>
  }
  const sep = (i: MenuItem): MenuItem => ({ ...i, sep: true })
  const widthItems = (fit: MenuItem) => (table?.widths ? [fit] : [])
  const rowMenu = (r: number) => { const x = rowItems(r, 0, true); return [x.above, x.below, x.dup, sep(x.up), x.down, sep(x.clear), sep(x.remove)] }
  const colMenu = (c: number) => {
    const x = colItems(c, 0, true)
    return [x.left, x.right, sep(x.toLeft), x.toRight, sep(x.asc), x.desc, sep(x.align), ...widthItems(x.fit), sep(x.clear), sep(x.remove)]
  }
  function cellMenu(r: number, c: number): MenuItem[] {
    const x = rowItems(r, c, false), y = colItems(c, r, false), b = bounds()
    const several = b && inSel(r, c) && (b.r0 !== b.r1 || b.c0 !== b.c1)
    return [
      ...(several ? [{ label: "Clear cells", icon: Eraser, run: () => change((t) => clearCells(t, sel!.a, sel!.h), "delete", { pick: [sel!.a, sel!.h] }) }] : []),
      { ...x.above, sep: !!several }, x.below, sep(y.left), y.right,
      { label: "Row", icon: Rows3, sep: true, run: () => {}, items: [x.dup, sep(x.up), x.down, sep(x.clear)] },
      { label: "Column", icon: Columns3, run: () => {}, items: [y.toLeft, y.toRight, sep(y.asc), y.desc, ...widthItems(sep(y.fit)), sep(y.clear)] },
      y.align,
      sep(x.remove), y.remove,
      { label: "Delete table", icon: Trash2, danger: true, run: deleteTable },
      { label: "Edit source", icon: Code, sep: true, run: () => { close(); env.source() } },
    ]
  }

  const undoKeys = (e: KeyboardEvent, mod: boolean) => {
    if (!mod || !(e.key === "z" || e.key === "Z" || (!isMac && e.key === "y"))) return false
    e.preventDefault()
    ;(e.key === "y" || e.shiftKey ? redo : undo)(view)
    return true
  }

  function cellKeys(e: KeyboardEvent, r: number, c: number, input: HTMLTextAreaElement) {
    if (e.isComposing || !table) return
    const mod = isMac ? e.metaKey : e.ctrlKey
    const rs = rows(), cs = cols()
    const go = (nr: number, nc: number, caret: number | "end" = "end") => { e.preventDefault(); open(nr, nc, caret) }
    const { selectionStart: s, selectionEnd: f, value } = input
    const oneLine = input.scrollHeight <= parseFloat(getComputedStyle(input).lineHeight) * 1.5
    if (undoKeys(e, mod)) return
    const all = s === 0 && f === value.length
    if (e.shiftKey && !mod && STEPS[e.key]) {
      const edge = e.key === "ArrowLeft" ? s === 0 && (f === 0 || all) : e.key === "ArrowRight" ? f === value.length && (s === f || all)
        : oneLine || all || (s === f && (e.key === "ArrowUp" ? s === 0 : f === value.length))
      const [dr, dc] = STEPS[e.key], to = clamp({ r: r + dr, c: c + dc })
      if (edge && (to.r !== r || to.c !== c)) { e.preventDefault(); select({ r, c }, to) }
      return
    }
    if (mod && !e.altKey && STEPS[e.key]) {
      const edge = e.key === "ArrowLeft" ? s === 0 && f === 0 : e.key === "ArrowRight" ? s === f && f === value.length
        : s === f && (oneLine || (e.key === "ArrowUp" ? s === 0 : f === value.length))
      const to = edgeFrom(table, { r, c }, ...STEPS[e.key])
      if (edge && (to.r !== r || to.c !== c)) { if (e.shiftKey) { e.preventDefault(); select({ r, c }, to) } else go(to.r, to.c) }
      return
    }
    if (mod && e.key === "a" && all && value) { e.preventDefault(); select({ r: 0, c: 0 }, { r: rs - 1, c: cs - 1 }); return }
    switch (e.key) {
      case "Tab":
        if (e.shiftKey) { if (c > 0) go(r, c - 1); else if (r > 0) go(r - 1, cs - 1); else e.preventDefault(); return }
        if (c < cs - 1) go(r, c + 1); else if (r < rs - 1) go(r + 1, 0); else { e.preventDefault(); change((t) => insertRow(t, rs), "input.table", { open: { r: rs, c: 0 } }) }
        return
      case "Enter":
        if (e.shiftKey) return
        e.preventDefault()
        if (mod || r === rs - 1) change((t) => insertRow(t, r + 1), "input.table", { open: { r: r + 1, c } })
        else open(r + 1, c)
        return
      case "Escape": e.preventDefault(); leave(true); return
      case "ArrowUp":
        if (s !== f || !(oneLine || s === 0)) return
        if (r > 0) go(r - 1, c); else { e.preventDefault(); leave(false) }
        return
      case "ArrowDown":
        if (s !== f || !(oneLine || s === value.length)) return
        if (r < rs - 1) go(r + 1, c); else { e.preventDefault(); leave(true) }
        return
      case "ArrowLeft":
        if (s === 0 && f === 0 && (c > 0 || r > 0)) go(c > 0 ? r : r - 1, c > 0 ? c - 1 : cs - 1)
        return
      case "ArrowRight":
        if (s === value.length && f === s && (c < cs - 1 || r < rs - 1)) go(c < cs - 1 ? r : r + 1, c < cs - 1 ? c + 1 : 0, 0)
        return
    }
  }

  keeper.addEventListener("keydown", (e) => {
    if (!sel || !table || e.isComposing) return
    const mod = isMac ? e.metaKey : e.ctrlKey
    if (undoKeys(e, mod)) return
    const step = STEPS[e.key]
    const to = step ? (mod ? edgeFrom(table, sel.h, step[0], step[1]) : clamp({ r: sel.h.r + step[0], c: sel.h.c + step[1] }))
      : e.key === "Home" ? { r: mod ? 0 : sel.h.r, c: 0 } : e.key === "End" ? { r: mod ? rows() - 1 : sel.h.r, c: cols() - 1 } : null
    if (to && !e.altKey) {
      e.preventDefault()
      if (e.shiftKey) select(sel.a, to); else open(to.r, to.c)
    } else if (mod && e.key === "a") { e.preventDefault(); select({ r: 0, c: 0 }, { r: rows() - 1, c: cols() - 1 }) }
    else if (mod && !e.shiftKey && e.key.toLowerCase() === "d") { e.preventDefault(); const { a, h } = sel; change((t) => { fillDown(t, a, h) }, "input.paste", { pick: [a, h] }) }
    else if (!mod && (e.key === "Backspace" || e.key === "Delete")) { e.preventDefault(); const { a, h } = sel; change((t) => clearCells(t, a, h), "delete", { pick: [a, h] }) }
    else if (!mod && (e.key === "Escape" || e.key === "Enter" || e.key === "Tab" || e.key === "F2")) { e.preventDefault(); open(sel.h.r, sel.h.c) }
  })
  keeper.addEventListener("beforeinput", (e) => {
    e.preventDefault()
    if (!sel || !table || e.inputType !== "insertText" || !e.data) return
    const { r, c } = sel.h
    table.rows[r].cells[c] = escape(e.data)
    write()
    open(r, c)
  })
  const copy = (e: ClipboardEvent) => {
    const b = bounds()
    if (!b || !grid || !e.clipboardData) return false
    e.preventDefault()
    e.clipboardData.setData("text/plain", tsvText(picked()))
    e.clipboardData.setData("text/html", htmlText(grid.slice(b.r0, b.r1 + 1).map((row) => row.slice(b.c0, b.c1 + 1).map((cell) => cell.innerHTML))))
    return true
  }
  keeper.addEventListener("copy", copy)
  keeper.addEventListener("cut", (e) => { if (sel && copy(e)) { const { a, h } = sel; change((t) => clearCells(t, a, h), "delete.cut", { pick: [a, h] }) } })
  keeper.addEventListener("paste", (e) => { const b = bounds(); e.preventDefault(); if (b) pasteCells(e.clipboardData, { r: b.r0, c: b.c0 }) })
  keeper.addEventListener("blur", () => setTimeout(() => { if (document.activeElement !== keeper && !menuShowing()) unselect() }))

  function caretAt(cell: HTMLElement, e: MouseEvent, raw: string): number | "end" {
    if (cell.textContent !== raw) return "end"
    const p = "caretPositionFromPoint" in document ? document.caretPositionFromPoint(e.clientX, e.clientY) : null
    const node = p?.offsetNode ?? document.caretRangeFromPoint?.(e.clientX, e.clientY)?.startContainer
    const off = p ? p.offset : document.caretRangeFromPoint?.(e.clientX, e.clientY)?.startOffset
    if (!node || off === undefined || !cell.contains(node)) return "end"
    let n = 0
    const walk = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT)
    for (let t = walk.nextNode(); t; t = walk.nextNode()) { if (t === node) return n + off; n += t.textContent!.length }
    return "end"
  }

  const cellOf = (target: EventTarget | null) => {
    const cell = elementOf(target)?.closest<HTMLTableCellElement>("th, td")
    if (!cell || !grid) return null
    for (const [r, row] of grid.entries()) { const c = row.indexOf(cell); if (c >= 0) return { r, c, cell } }
    return null
  }

  el.addEventListener("mousedown", (e) => {
    if (e.button !== 0 || e.ctrlKey && isMac) return
    const at = cellOf(e.target)
    const inField = !!elementOf(e.target)?.closest(".cm-cell-input")
    if (!at || !env.canEdit() || (!inField && elementOf(e.target)?.closest("a, [data-wiki], [data-tag]"))) return
    const from = e.shiftKey && (sel || editing) ? sel?.a ?? { r: editing!.r, c: editing!.c } : { r: at.r, c: at.c }
    if (!inField) {
      e.preventDefault()
      if (e.shiftKey && (sel || editing)) select(from, at)
      else open(at.r, at.c, caretAt(at.cell, e, unescape(table!.rows[at.r].cells[at.c])))
    }
    const move = (ev: MouseEvent) => {
      const to = cellOf(document.elementFromPoint(ev.clientX, ev.clientY))
      if (!to || (!sel && to.r === from.r && to.c === from.c) || (sel && sel.h.r === to.r && sel.h.c === to.c)) return
      select(from, to)
    }
    const up = () => { removeEventListener("mousemove", move, true); removeEventListener("mouseup", up, true) }
    addEventListener("mousemove", move, true)
    addEventListener("mouseup", up, true)
  })

  el.addEventListener("contextmenu", (e) => {
    const at = cellOf(e.target)
    if (!at || !env.canEdit() || !table) return
    e.preventDefault(); e.stopPropagation()
    openMenu({ x: e.clientX, y: e.clientY }, cellMenu(at.r, at.c))
  })

  el.addEventListener("pointermove", (e) => {
    if (e.pointerType !== "mouse" || dragging) return
    const at = cellOf(e.target)
    if (!at || (over?.r === at.r && over.c === at.c)) return
    over = { r: at.r, c: at.c }
    place()
  })
  el.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse" && !dragging) { over = null; place() } })

  function place() {
    const t = drawn.querySelector("table")
    const on = !!t && !!grid && !!table && env.canEdit()
    tools.hidden = !on
    if (!on) return
    tools.toggleAttribute("data-active", !!editing || !!sel)
    const box = el.getBoundingClientRect(), whole = t!.getBoundingClientRect(), seen = drawn.getBoundingClientRect()
    const tb = { top: whole.top, bottom: whole.bottom, height: whole.height, left: Math.max(whole.left, seen.left), right: Math.min(whole.right, seen.right), width: 0 }
    tb.width = tb.right - tb.left
    const px = (n: number) => `${Math.round(n)}px`
    Object.assign(addCol.style, { left: px(tb.right - box.left), top: px(tb.top - box.top), height: px(tb.height) })
    Object.assign(addRow.style, { left: px(tb.left - box.left), top: px(tb.bottom - box.top), width: px(tb.width) })
    const heads = grid![0]
    while (edges.length < heads.length - 1) edges.push(edgeHandle(edges.length))
    edges.forEach((h, i) => {
      const b = i < heads.length - 1 ? heads[i].getBoundingClientRect() : null
      h.hidden = !b || b.right < tb.left + 4 || b.right > tb.right - 4
      if (b) Object.assign(h.style, { left: px(b.right - box.left), top: px(b.top - box.top), height: px(h.classList.contains("is-active") ? tb.bottom - b.top : b.height) })
    })
    const at = over ?? (editing && { r: editing.r, c: editing.c }) ?? sel?.h ?? null
    const cell = at && grid![at.r]?.[at.c]
    colGrip.hidden = rowGrip.hidden = !cell
    if (!at || !cell) return
    const head = grid![0][at.c].getBoundingClientRect(), row = cell.getBoundingClientRect()
    colGrip.hidden = head.right < tb.left + 12 || head.left > tb.right - 12
    Object.assign(colGrip.style, { left: px((head.left + head.right) / 2 - box.left), top: px(tb.top - box.top) })
    Object.assign(rowGrip.style, { left: px(tb.left - box.left), top: px((row.top + row.bottom) / 2 - box.top) })
    colGrip.dataset.c = String(at.c)
    rowGrip.dataset.r = String(at.r)
  }

  const gripMenu = (row: boolean, g: HTMLElement) => {
    if (!table || !env.canEdit()) return
    const i = Number(row ? g.dataset.r : g.dataset.c)
    const [a, h] = row ? wholeRow(i) : wholeCol(i)
    select(a, h)
    const b = g.getBoundingClientRect()
    openMenu({ x: b.left, y: b.bottom + 4, flip: b.top - 4 }, row ? rowMenu(i) : colMenu(i))
  }
  for (const [g, row] of [[rowGrip, true], [colGrip, false]] as const) {
    g.addEventListener("mousedown", (e) => e.preventDefault())
    g.addEventListener("click", (e) => { e.stopPropagation(); gripMenu(row, g) })
    g.addEventListener("contextmenu", (e) => { e.preventDefault(); e.stopPropagation(); gripMenu(row, g) })
    g.addEventListener("pointerdown", (e) => {
      const i = Number(row ? g.dataset.r : g.dataset.c)
      if (!table || !env.canEdit() || (row && i === 0)) return
      dragging = { row, from: i }
      startDrag(e, { from: "table", table: id, label: row ? "Row" : "Column", drawn: true }, { touch: true })
    })
  }
  for (const [b, row] of [[addRow, true], [addCol, false]] as const) {
    b.addEventListener("mousedown", (e) => e.preventDefault())
    b.addEventListener("click", (e) => {
      e.stopPropagation()
      if (!table || !env.canEdit()) return
      widen(table)
      const n = row ? rows() : cols()
      change((t) => (row ? insertRow(t, n) : insertColumn(t, n)), "input.table", { open: row ? { r: n, c: 0 } : { r: 0, c: n } })
    })
  }

  function edgeHandle(i: number) {
    const h = tool("cm-table-edge", "")
    h.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || !table || !env.canEdit()) return
      e.preventDefault(); e.stopPropagation()
      const x0 = e.clientX, id = e.pointerId
      let shares: number[] | null = null, tw = 0, a0 = 0, b0 = 0, from = 0, narrowest = 0
      h.setPointerCapture(id)
      const move = (ev: PointerEvent) => {
        if (ev.pointerId !== id) return
        if (!shares) {
          if (Math.abs(ev.clientX - x0) < 3 || !grid) return
          close(); unselect()
          const t = drawn.querySelector("table")
          if (!t || !grid) return
          const ws = grid[0].map((c) => c.getBoundingClientRect().width), sum = ws.reduce((a, b) => a + b, 0)
          shares = ws.map((w) => w / sum)
          shareColumns(drawn, t, shares)
          tw = t.getBoundingClientRect().width
          narrowest = NARROWEST * parseFloat(getComputedStyle(t).fontSize)
          a0 = shares[i]; b0 = shares[i + 1]
          from = grid[0][i].getBoundingClientRect().right
          h.classList.add("is-active")
        }
        const min = Math.min(narrowest / tw, (a0 + b0) / 2)
        const a = Math.max(min, Math.min(a0 + b0 - min, a0 + (ev.clientX - from) / tw))
        shares[i] = a; shares[i + 1] = a0 + b0 - a
        shareColumns(drawn, drawn.querySelector("table")!, shares)
        place()
      }
      const end = () => {
        h.removeEventListener("pointermove", move); h.removeEventListener("pointerup", up); h.removeEventListener("pointercancel", up)
        removeEventListener("keydown", key, true)
        h.classList.remove("is-active")
      }
      const up = (ev: PointerEvent) => {
        if (ev.pointerId !== id) return
        end()
        if (shares) { const s = shares; change((t) => setWidths(t, s), "input.table") }
      }
      const key = (ev: KeyboardEvent) => {
        if (ev.key !== "Escape") return
        ev.preventDefault(); ev.stopPropagation()
        end()
        if (h.hasPointerCapture(id)) h.releasePointerCapture(id)
        if (shares) paint()
      }
      h.addEventListener("pointermove", move)
      h.addEventListener("pointerup", up)
      h.addEventListener("pointercancel", up)
      addEventListener("keydown", key, true)
    })
    h.addEventListener("dblclick", (e) => {
      e.preventDefault(); e.stopPropagation()
      if (table?.widths && env.canEdit()) change((t) => setWidths(t, null), "input.table")
    })
    h.addEventListener("click", (e) => e.stopPropagation())
    return h
  }

  const sideways = edgeScroller("x"), down = edgeScroller()
  const untarget = addDropTarget(id, {
    at: (item, x, y) => {
      const t = drawn.querySelector("table")
      if (item.table !== id || !dragging || !grid || !table || !t) return null
      const { row, from } = dragging
      if (row) down.over(t, x, y)
      else sideways.over(drawn.classList.contains("is-shared") ? drawn : t, x, y)
      if (!dragging.shown) { dragging.shown = true; const [a, h] = row ? wholeRow(from) : wholeCol(from); select(a, h) }
      const tb = t.getBoundingClientRect(), box = el.getBoundingClientRect()
      if (x < tb.left - 48 || x > tb.right + 48 || y < tb.top - 48 || y > tb.bottom + 48) { line.hidden = true; return null }
      const edges = row ? grid.slice(1).map((r) => r[0].getBoundingClientRect()) : grid[0].map((c) => c.getBoundingClientRect())
      let gap = edges.findIndex((b) => (row ? y < (b.top + b.bottom) / 2 : x < (b.left + b.right) / 2))
      if (gap < 0) gap = edges.length
      const to = (row ? gap + 1 : gap) > from ? (row ? gap : gap - 1) : row ? gap + 1 : gap
      line.hidden = to === from
      if (to === from) return null
      const at = gap < edges.length ? (row ? edges[gap].top : edges[gap].left) : (row ? edges[gap - 1].bottom : edges[gap - 1].right)
      const edge = row ? at : Math.min(Math.max(at, tb.left), tb.right)
      line.className = `cm-table-drop ${row ? "is-row" : "is-col"}`
      Object.assign(line.style, row
        ? { left: `${tb.left - box.left}px`, top: `${edge - box.top}px`, width: `${tb.width}px`, height: "" }
        : { left: `${edge - box.left}px`, top: `${tb.top - box.top}px`, height: `${tb.height}px`, width: "" })
      return { data: { row, from, to } }
    },
    drop: (_item, data) => {
      const { row, from, to } = data
      change((t) => (row ? moveRow(t, from, to) : moveColumn(t, from, to)), "input.table", { pick: row ? wholeRow(to) : wholeCol(to) })
    },
    end: () => { dragging = null; line.hidden = true; sideways.stop(); down.stop() },
  })

  const resized = new ResizeObserver(() => place())
  resized.observe(drawn)

  entries.set(el, (to) => (to === "top" ? open(0, 0, 0) : to === "bottom" ? open(table ? table.rows.length - 1 : 0, 0, 0) : open(to.r, to.c, 0)))
  paint()
  return {
    update: (t: string) => {
      if (t === shown) return
      shown = t
      table = parseTable(t)
      const was = editing && { r: editing.r, c: editing.c, at: editing.input.selectionStart, focused: document.activeElement === editing.input }
      const kept = document.activeElement === keeper ? sel : null
      editing = null
      sel = null
      if (!was?.focused && !kept) frozen = null
      paint()
      if (was?.focused && table) open(Math.min(was.r, table.rows.length - 1), Math.min(was.c, table.align.length - 1), was.at)
      else if (kept && table) select(kept.a, kept.h)
    },
    destroy: () => { editing = null; untarget(); resized.disconnect() },
  }
}

export function pasteTable(e: ClipboardEvent, view: EditorView) {
  const d = e.clipboardData
  if (!d || !view.state.facet(EditorView.editable)) return false
  const rows = pastedTable(d.getData("text/plain"), d.getData("text/html"))
  if (!rows) return false
  const { state } = view, r = state.selection.main
  if (pastesRaw(state, r.from)) return false
  e.preventDefault()
  const doc = state.doc, line = doc.lineAt(r.from), end = doc.lineAt(r.to)
  const before = state.sliceDoc(line.from, r.from), after = state.sliceDoc(r.to, end.to)
  const next = end.number < doc.lines ? doc.line(end.number + 1).text : null
    // GFM reads a line of text right after a table as one of its rows.
  const lead = before.trim() ? "\n\n" : line.number > 1 && doc.line(line.number - 1).text.trim() ? "\n" : ""
  const tail = !after.trim() && next !== null && !next.trim() ? "\n" : "\n\n"
  const md = markdownTable(rows)
  view.dispatch({ changes: { from: r.from, to: r.to, insert: lead + md + tail }, selection: EditorSelection.cursor(r.from + lead.length + md.length + 2),
    scrollIntoView: true, userEvent: "input.paste" })
  return true
}
