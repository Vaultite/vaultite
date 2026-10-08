// Line numbers on their line's first row, baseline to baseline, whatever the line is (a heading, a list item, a code
// block, a widget's first text): each number is moved by the difference, measured after every layout.
import type { EditorState } from "@codemirror/state"
import { highlightActiveLineGutter, lineNumbers, ViewPlugin, type EditorView, type ViewUpdate } from "@codemirror/view"
import { frontmatter } from "./frontmatter"

/** Where a font's baseline is below the top of its text's box (a 0-high inline box sits on it), or with `lineHeight`
 *  below the top of an empty line's. */
const below = new Map<string, number>()
function baselineIn(cs: CSSStyleDeclaration, lineHeight = "normal") {
  // `font` is empty when it can't be one shorthand (tabular numbers), so from its parts.
  const font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`
  const key = `${font}|${lineHeight}`
  let b = below.get(key)
  if (b === undefined) {
    const d = document.createElement("div")
    d.style.cssText = `position:absolute;top:0;left:0;visibility:hidden;font:${font};line-height:${lineHeight}`
    d.innerHTML = '<span>Hg</span><span style="display:inline-block;width:1px;height:0"></span>'
    document.body.append(d)
    const [text, mark] = d.children
    b = mark.getBoundingClientRect().bottom - (lineHeight === "normal" ? text : d).getBoundingClientRect().top
    d.remove()
    below.set(key, b)
  }
  return b
}

/** The baseline of `el`'s first drawn character (hidden marks skipped), or of an empty line of its text there. */
function rowBaseline(el: Element, range: Range): number | null {
  const text = textBaseline(el, range)
  if (text !== null || !el.classList.contains("cm-line")) return text
  const cs = getComputedStyle(el)
  return el.getBoundingClientRect().top + parseFloat(cs.borderTopWidth) + parseFloat(cs.paddingTop) + baselineIn(cs, cs.lineHeight)
}

/** The baseline of `el`'s first drawn character (hidden marks skipped), or null if it draws no text. */
function textBaseline(el: Element, range: Range): number | null {
  const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    const at = n.textContent!.search(/\S/)
    if (at < 0) continue
    range.setStart(n, at); range.setEnd(n, at + 1)
    const box = range.getBoundingClientRect()
    if (box.width && box.height) return box.top + baselineIn(getComputedStyle(n.parentElement!))
  }
  return null
}

/** The CSS zoom `el` is drawn at (a note's text size, FileView.tsx). */
function zoomOf(el: HTMLElement) {
  const z = (el as HTMLElement & { currentCSSZoom?: number }).currentCSSZoom
  return z || el.getBoundingClientRect().height / el.offsetHeight || 1
}

const align = ViewPlugin.fromClass(class {
  view: EditorView
  constructor(view: EditorView) {
    this.view = view
    this.measure()
    document.fonts?.ready.then(() => this.measure())
  }
  update(u: ViewUpdate) { if (u.geometryChanged || u.viewportChanged || u.docChanged) this.measure() }
  measure() {
    this.view.requestMeasure({ key: this, read: (view) => {
      const range = document.createRange()
      // (rows of no height, a hidden frontmatter's, never hold a number)
      const rows = [...view.contentDOM.children].map((el) => ({ el, box: el.getBoundingClientRect() })).filter((r) => r.box.height > 0).map(({ el, box }) => ({ el, top: box.top }))
      // Boxes are in screen px, a translate in the note's own: under a text size (CSS zoom) mixing them never settles.
      const z = zoomOf(view.contentDOM)
      const moves: [HTMLElement, number][] = []
      for (const el of view.dom.querySelectorAll<HTMLElement>(".cm-lineNumbers .cm-gutterElement")) {
        if (!el.textContent) continue
        const now = parseFloat(el.style.translate.split(" ")[1] ?? "") || 0
        const top = el.getBoundingClientRect().top - now * z
        const row = rows.find((r) => Math.abs(r.top - top) < 1.5)
        const has = textBaseline(el, range), box = range.getBoundingClientRect()
        if (!row || has === null) { moves.push([el, 0]); continue }
        const { height } = row.el.getBoundingClientRect()
        // A row shorter than the number (a code block's hidden fence): the number in its middle.
        const want = height < box.height ? has + row.top + (height - box.height) / 2 - box.top : rowBaseline(row.el, range)
        moves.push([el, want === null ? 0 : Math.round((now + (want - has) / z) * 2) / 2])
      }
      return moves
    }, write: (moves) => { for (const [el, y] of moves) el.style.translate = y ? `0 ${y}px` : "" } })
  }
})

/** The body's line numbers: a hidden frontmatter's lines have none and aren't counted. */
function bodyNumber(n: number, state: EditorState) {
  const start = state.field(frontmatter, false)
  const above = start ? state.doc.lineAt(start).number - 1 : 0
  return n > above ? String(n - above) : ""
}

/** Line numbers, with the cursor's line's brighter, each beside its line's first row. */
export const numberGutter = () => [lineNumbers({ formatNumber: bodyNumber }), highlightActiveLineGutter(), align]
