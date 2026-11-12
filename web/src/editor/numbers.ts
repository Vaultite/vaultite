import type { EditorState } from "@codemirror/state"
import { highlightActiveLineGutter, lineNumbers, ViewPlugin, type EditorView, type ViewUpdate } from "@codemirror/view"
import { shownStart } from "./frontmatter"

const below = new Map<string, number>()
function baselineIn(cs: CSSStyleDeclaration, lineHeight = "normal") {
  // `font` is empty when it can't be one shorthand (tabular numbers), so from its parts.
  const font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`
  const key = `${font}|${lineHeight}`
  let b = below.get(key)
  if (b === undefined) {
    const d = document.createElement("div")
    d.style.cssText = `position:absolute;top:0;left:0;visibility:hidden;font:${font};line-height:${lineHeight}`
    // A 0-high inline-block sits on the baseline.
    d.innerHTML = '<span>Hg</span><span style="display:inline-block;width:1px;height:0"></span>'
    document.body.append(d)
    const [text, mark] = d.children
    b = mark.getBoundingClientRect().bottom - (lineHeight === "normal" ? text : d).getBoundingClientRect().top
    d.remove()
    below.set(key, b)
  }
  return b
}

function rowBaseline(el: Element, range: Range): number | null {
  const text = textBaseline(el, range)
  if (text !== null || !el.classList.contains("cm-line")) return text
  const cs = getComputedStyle(el)
  return el.getBoundingClientRect().top + parseFloat(cs.borderTopWidth) + parseFloat(cs.paddingTop) + baselineIn(cs, cs.lineHeight)
}

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
      const rows = [...view.contentDOM.children].map((el) => ({ el, box: el.getBoundingClientRect() })).filter((r) => r.box.height > 0).map(({ el, box }) => ({ el, top: box.top }))
      // Under CSS zoom, boxes are in screen px but a translate is in the zoomed px: mixing them never settles.
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
        const want = height < box.height ? has + row.top + (height - box.height) / 2 - box.top : rowBaseline(row.el, range)
        moves.push([el, want === null ? 0 : Math.round((now + (want - has) / z) * 2) / 2])
      }
      return moves
    }, write: (moves) => { for (const [el, y] of moves) el.style.translate = y ? `0 ${y}px` : "" } })
  }
})

function bodyNumber(n: number, state: EditorState) {
  const start = shownStart(state)
  const above = start ? state.doc.lineAt(start).number - 1 : 0
  return n > above ? String(n - above) : ""
}

export const numberGutter = () => [lineNumbers({ formatNumber: bodyNumber }), highlightActiveLineGutter(), align]
