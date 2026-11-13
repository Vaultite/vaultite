import { EditorSelection } from "@codemirror/state"
import { EditorView, ViewPlugin } from "@codemirror/view"
import { lineInSight, sightOf, wholly } from "@/core/sight"
import { scrollingBox } from "@/lib/utils"
import { offBlocks } from "./livePreview"
import { textStart } from "./scan"

// CodeMirror sees only its scroller, not the bars drawn over the text.
export const sightMargins = EditorView.scrollMargins.of((view) => {
  const box = scrollingBox(view.dom), s = sightOf(view.dom)
  const r = box ? box.getBoundingClientRect() : document.documentElement.scrollHeight > innerHeight
    ? { top: 0, bottom: visualViewport?.height ?? innerHeight } : view.scrollDOM.getBoundingClientRect()
  return { top: Math.max(0, s.top - r.top), bottom: Math.max(0, r.bottom - s.bottom) }
})

export const followReader = ViewPlugin.define((view) => {
  if (!matchMedia("(pointer: coarse)").matches) return {}
  let timer = 0
  const follow = () => {
    const sel = view.state.selection.main
    if (view.hasFocus || !sel.empty || !view.dom.getClientRects().length || wholly(view, sel.head)) return
    const s = sightOf(view.dom)
    if (s.top >= view.documentTop + view.contentHeight || s.bottom <= view.documentTop) return
    const at = offBlocks(view.state, lineInSight(view))
    const pos = at !== null && at === view.state.doc.lineAt(at).from ? textStart(view.state, at) : at
    if (pos !== null && pos !== sel.head) view.dispatch({ selection: EditorSelection.cursor(pos), userEvent: "select.follow" })
  }
  const settle = () => { clearTimeout(timer); timer = window.setTimeout(follow, 150) }
  addEventListener("scroll", settle, { capture: true, passive: true })
  settle()
  return { destroy: () => { clearTimeout(timer); removeEventListener("scroll", settle, { capture: true }) } }
})
