// Tables in live preview, edited a cell at a time (Obsidian's way); arrows and Tab move, right-click reshapes.
// Each keystroke rewrites only what changed (tableText.ts), so undo, merges and other views see plain Markdown.
import { redo, undo } from "@codemirror/commands"
import { EditorSelection } from "@codemirror/state"
import type { EditorView } from "@codemirror/view"
import { BetweenHorizontalEnd, BetweenHorizontalStart, BetweenVerticalEnd, BetweenVerticalStart, Code, TextAlignCenter, TextAlignEnd,
  TextAlignStart, Trash2 } from "lucide-react"
import { menuShowing, openMenu, type MenuItem } from "@/components/ContextMenu"
import { isMac } from "@/core/platform"
import { markdownDrawn } from "@/core/richmd"

import { parseTable, unescape, escape, writeTable, type Align, type Table } from "./tableText"

/** What a drawn table needs from the editor around it. */
export type TableEnv = {
  render: (md: string) => string
  /** Its cells can be edited now (editing, and the file can be changed). */
  canEdit: () => boolean
  /** Its first line in the text (0-based), null once it's gone. */
  line: () => number | null
  /** Its Markdown shown, the cursor in it. */
  source: () => void
}

/** Entering a drawn table from the line above or below (↓ and ↑ in the editor). */
const entries = new WeakMap<HTMLElement, (from: "top" | "bottom") => boolean>()
export const enterTable = (body: HTMLElement, from: "top" | "bottom") => entries.get(body)?.(from) ?? false

export function drawTable(el: HTMLElement, text: string, view: EditorView, env: TableEnv) {
  // What the file has (as last drawn or written), its rows, and the cell being edited.
  let shown = text
  let table = parseTable(text)
  let grid: HTMLTableCellElement[][] | null = null
  let editing: { r: number; c: number; input: HTMLTextAreaElement } | null = null
  // Its columns' widths while a cell in it is edited: moving between cells moves nothing, they settle once it's left.
  let frozen: { table: number; cols: number[] } | null = null

  const paint = () => {
    el.innerHTML = env.render(shown)
    markdownDrawn(el)
    const t = el.querySelector("table")
    grid = null
    if (!t || !table) return
    const rows = [...t.rows]
    if (rows.length !== table.rows.length || rows.some((r) => r.cells.length !== table!.align.length)) return
    grid = rows.map((r) => [...r.cells] as HTMLTableCellElement[])
    pin()
    // (a click in it edits a cell, not the table's Markdown; a held finger is its menu)
    t.dataset.noEdit = ""
    t.dataset.holdMenu = ""
  }

  const pin = () => {
    const t = el.querySelector("table")
    if (!t || !grid || !frozen || frozen.cols.length !== grid[0].length) return
    t.style.tableLayout = "fixed"
    t.style.width = `${frozen.table}px`
    grid[0].forEach((cell, i) => { cell.style.width = `${frozen!.cols[i]}px` })
  }

  /** Where it is in the file now, if that's still what was drawn. */
  const range = () => {
    const l = env.line()
    if (l === null) return null
    const from = view.state.doc.line(l + 1).from, to = from + shown.length
    return view.state.sliceDoc(from, to) === shown ? { from, to } : null
  }

  /** The rows written into the file: only the part that changed. */
  const write = (userEvent = "input.type") => {
    if (!table) return
    const next = writeTable(table), at = range()
    if (!at || next === shown) return
    let a = 0, b = 0
    while (a < shown.length && a < next.length && shown[a] === next[a]) a++
    while (b < shown.length - a && b < next.length - a && shown[shown.length - 1 - b] === next[next.length - 1 - b]) b++
    const insert = next.slice(a, next.length - b)
    shown = next
    view.dispatch({ changes: { from: at.from + a, to: at.to - b, insert }, userEvent })
  }

  const fit = (input: HTMLTextAreaElement) => { input.style.height = "auto"; input.style.height = `${input.scrollHeight}px` }

  function open(r: number, c: number, caret: number | "end" = "end") {
    if (!table || !grid || !env.canEdit()) return false
    if (!grid[r]?.[c]) return false
    if (!frozen) {
      const t = el.querySelector("table")!
      frozen = { table: t.getBoundingClientRect().width, cols: grid[0].map((cell) => cell.getBoundingClientRect().width) }
      pin()
    }
    if (editing) close(true)
    const cell = grid?.[r]?.[c]
    if (!cell) return false
    const input = document.createElement("textarea")
    input.className = "cm-cell-input"
    input.rows = 1
    input.value = unescape(table.rows[r].cells[c]).replace(/<br\s*\/?>/gi, "\n")
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
    })
    input.addEventListener("keydown", (e) => keys(e, r, c, input))
    input.addEventListener("blur", () => setTimeout(() => {
      if (editing?.input === input && document.activeElement !== input && !menuShowing()) close()
    }))
    return true
  }

  /** `staying`: another of its cells opens next, so its columns stay as they are. */
  function close(staying = false) {
    if (!editing) return
    editing = null
    if (!staying) frozen = null
    paint()
  }

  /** The cursor back in the editor's text, on the line above or below the table. */
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

  /** Changed its shape (a row or a column): written, drawn again, the cursor in cell r, c. */
  function reshape(change: (t: Table) => void, r: number, c: number) {
    if (!table) return
    change(table)
    write("input.table")
    editing = null
    frozen = null
    paint()
    open(Math.max(0, Math.min(r, table.rows.length - 1)), Math.max(0, Math.min(c, table.align.length - 1)))
  }
  const blank = () => table!.align.map(() => "")
  const addRow = (at: number) => reshape((t) => t.rows.splice(at, 0, { cells: blank() }), at, editing?.c ?? 0)
  const addCol = (at: number, r: number) => reshape((t) => { t.align.splice(at, 0, ""); t.rows.forEach((x) => x.cells.splice(at, 0, "")) }, r, at)

  function keys(e: KeyboardEvent, r: number, c: number, input: HTMLTextAreaElement) {
    if (e.isComposing || !table) return
    const mod = isMac ? e.metaKey : e.ctrlKey
    const rows = table.rows.length, cols = table.align.length
    const go = (nr: number, nc: number, caret: number | "end" = "end") => { e.preventDefault(); open(nr, nc, caret) }
    const { selectionStart: s, selectionEnd: f, value } = input
    const oneLine = input.scrollHeight <= parseFloat(getComputedStyle(input).lineHeight) * 1.5
    if (mod && (e.key === "z" || e.key === "Z" || (!isMac && e.key === "y"))) {
      e.preventDefault()
      const again = e.key === "y" || e.shiftKey
      ;(again ? redo : undo)(view)
      return
    }
    switch (e.key) {
      case "Tab":
        if (e.shiftKey) { if (c > 0) go(r, c - 1); else if (r > 0) go(r - 1, cols - 1); else e.preventDefault(); return }
        if (c < cols - 1) go(r, c + 1); else if (r < rows - 1) go(r + 1, 0); else { e.preventDefault(); reshape((t) => t.rows.push({ cells: blank() }), rows, 0) }
        return
      case "Enter":
        if (e.shiftKey) return // (a line break in the cell: written as <br>)
        e.preventDefault()
        if (mod) { addRow(r + 1); return }
        if (r < rows - 1) open(r + 1, c); else addRow(rows)
        return
      case "Escape": e.preventDefault(); leave(true); return
      case "ArrowUp":
        if (s !== f || !(oneLine || s === 0)) return
        if (r > 0) go(r - 1, c); else { e.preventDefault(); leave(false) }
        return
      case "ArrowDown":
        if (s !== f || !(oneLine || s === value.length)) return
        if (r < rows - 1) go(r + 1, c); else { e.preventDefault(); leave(true) }
        return
      case "ArrowLeft":
        if (s === 0 && f === 0 && !e.shiftKey && (c > 0 || r > 0)) go(c > 0 ? r : r - 1, c > 0 ? c - 1 : cols - 1)
        return
      case "ArrowRight":
        if (s === value.length && f === s && !e.shiftKey && (c < cols - 1 || r < rows - 1)) go(c < cols - 1 ? r : r + 1, c < cols - 1 ? c + 1 : 0, 0)
        return
    }
  }

  /** Where in its cell's Markdown a click landed, when the cell shows its Markdown as it is (plain text). */
  function caretAt(cell: HTMLElement, e: MouseEvent, raw: string): number | "end" {
    if (cell.textContent !== raw) return "end"
    const doc = document as Document & { caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null }
    const p = doc.caretPositionFromPoint?.(e.clientX, e.clientY)
    const node = p?.offsetNode ?? document.caretRangeFromPoint?.(e.clientX, e.clientY)?.startContainer
    const off = p ? p.offset : document.caretRangeFromPoint?.(e.clientX, e.clientY)?.startOffset
    if (!node || off === undefined || !cell.contains(node)) return "end"
    let n = 0
    const walk = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT)
    for (let t = walk.nextNode(); t; t = walk.nextNode()) { if (t === node) return n + off; n += t.textContent!.length }
    return "end"
  }

  const cellOf = (target: EventTarget | null) => {
    const cell = (target as Element | null)?.closest?.("th, td")
    if (!cell || !grid) return null
    for (const [r, row] of grid.entries()) { const c = row.indexOf(cell as HTMLTableCellElement); if (c >= 0) return { r, c, cell: cell as HTMLElement } }
    return null
  }

  el.addEventListener("mousedown", (e) => {
    if (e.button !== 0 || e.ctrlKey && isMac) return
    const at = cellOf(e.target)
    // (a link in a cell is followed, as anywhere else in the text)
    if (!at || !env.canEdit() || (e.target as Element).closest("a, [data-wiki], [data-tag], .cm-cell-input")) return
    e.preventDefault()
    open(at.r, at.c, caretAt(at.cell, e, unescape(table!.rows[at.r].cells[at.c])))
  })

  el.addEventListener("contextmenu", (e) => {
    const at = cellOf(e.target)
    if (!at || !env.canEdit() || !table) return
    e.preventDefault(); e.stopPropagation()
    const { r, c } = at, cols = table.align.length
    const align = (a: Align) => reshape((t) => { t.align[c] = a }, r, c)
    const items: MenuItem[] = [
      { label: "Add row above", icon: BetweenHorizontalStart, disabled: r === 0, run: () => addRow(r) },
      { label: "Add row below", icon: BetweenHorizontalEnd, run: () => addRow(r + 1) },
      { label: "Add column left", icon: BetweenVerticalStart, sep: true, run: () => addCol(c, r) },
      { label: "Add column right", icon: BetweenVerticalEnd, run: () => addCol(c + 1, r) },
      { label: "Align column", icon: TextAlignStart, sep: true, run: () => {}, items: [
        { label: "Left", icon: TextAlignStart, checked: table.align[c] === "" || table.align[c] === "left", run: () => align("") },
        { label: "Center", icon: TextAlignCenter, checked: table.align[c] === "center", run: () => align("center") },
        { label: "Right", icon: TextAlignEnd, checked: table.align[c] === "right", run: () => align("right") },
      ] },
      { label: "Delete row", icon: Trash2, danger: true, sep: true, disabled: r === 0, run: () => reshape((t) => { t.rows.splice(r, 1) }, r, c) },
      { label: "Delete column", icon: Trash2, danger: true, disabled: cols < 2,
        run: () => reshape((t) => { t.align.splice(c, 1); t.rows.forEach((x) => x.cells.splice(c, 1)) }, r, c) },
      { label: "Edit source", icon: Code, sep: true, run: () => { close(); env.source() } },
    ]
    openMenu({ x: e.clientX, y: e.clientY }, items)
  })

  entries.set(el, (from) => (from === "top" ? open(0, 0, 0) : open(table ? table.rows.length - 1 : 0, 0, 0)))
  paint()
  return {
    update: (t: string) => {
      if (t === shown) return
      // Changed elsewhere (undo, a merge, its Markdown edited): drawn again, the same cell still open.
      shown = t
      table = parseTable(t)
      const was = editing && { r: editing.r, c: editing.c, at: editing.input.selectionStart, focused: document.activeElement === editing.input }
      editing = null
      if (!was?.focused) frozen = null
      paint()
      // (the nearest cell when its row or column went: an added row undone)
      if (was?.focused && table) open(Math.min(was.r, table.rows.length - 1), Math.min(was.c, table.align.length - 1), was.at)
    },
    destroy: () => { editing = null },
  }
}
