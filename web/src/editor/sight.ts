// What the editor scrolls into view stays in sight (core/sight.ts), and on a phone the caret follows the reader.
import { EditorSelection } from "@codemirror/state"
import { EditorView, ViewPlugin } from "@codemirror/view"
import { lineInSight, sightOf, wholly } from "@/core/sight"
import { scrollingBox } from "@/lib/utils"
import { offBlocks } from "./livePreview"

/** The cursor as you type, a found word, a jump: clear of the bars drawn over the text (CodeMirror sees only its scroller). */
export const sightMargins = EditorView.scrollMargins.of((view) => {
  const box = scrollingBox(view.dom), s = sightOf(view.dom)
  const r = box ? box.getBoundingClientRect() : { top: 0, bottom: visualViewport?.height ?? innerHeight }
  return { top: Math.max(0, s.top - r.top), bottom: Math.max(0, r.bottom - s.bottom) }
})

/** Phones show no caret while reading, so once a scroll settles with it out of sight it goes to the first line in sight:
 *  what acts at the caret (Ask, a menu's command, the keyboard coming up) acts where the reader is, not where it was. */
export const followReader = ViewPlugin.define((view) => {
  if (!matchMedia("(pointer: coarse)").matches) return {}
  let timer = 0
  const follow = () => {
    const sel = view.state.selection.main
    if (view.hasFocus || !sel.empty || !view.dom.getClientRects().length || wholly(view, sel.head)) return
    const s = sightOf(view.dom)
    if (s.top >= view.documentTop + view.contentHeight || s.bottom <= view.documentTop) return
    const pos = offBlocks(view.state, lineInSight(view))
    if (pos !== null && pos !== sel.head) view.dispatch({ selection: EditorSelection.cursor(pos), userEvent: "select.follow" })
  }
  const settle = () => { clearTimeout(timer); timer = window.setTimeout(follow, 150) }
  addEventListener("scroll", settle, { capture: true, passive: true })
  settle()
  return { destroy: () => { clearTimeout(timer); removeEventListener("scroll", settle, { capture: true }) } }
})
