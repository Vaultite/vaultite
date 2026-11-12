import { appShortcut, canonical, shortcutOf, typingIn } from "@/core/commands"
import { currentEditor, keysInEditor, selectAllIn } from "@/core/editors"

// A press in the app's chrome can put the caret far off in a page: Chrome moves it to the nearest text that selects.
let pressed: Element | null = null
const areaOf = (n: Node) => (n instanceof Element ? n : n.parentElement)?.closest("[data-pane], dialog[open]") ?? null

function where(): Element | null {
  const a = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null
  const anchor = getSelection()?.anchorNode
  const ours = anchor && (!a || a.contains(anchor)) && (!pressed?.isConnected || areaOf(pressed) === areaOf(anchor))
  const at = ours ? (anchor instanceof Element ? anchor : anchor.parentElement) : a
  return at?.isConnected ? at : null
}

function selectAll() {
  const at = where(), ed = currentEditor()
  if (ed && (at ? ed.view.dom.contains(at) || (at.closest("[data-pane], dialog[open]")?.contains(ed.view.dom) ?? false) : keysInEditor(ed))) return selectAllIn(ed.view)
  const page = at?.closest("[data-pane]")
  if (page) getSelection()?.selectAllChildren(page)
}

if (typeof window !== "undefined") {
  addEventListener("pointerdown", (e) => { pressed = e.target instanceof Element ? e.target : null }, true)
  addEventListener("keydown", (e) => {
    if (e.defaultPrevented || e.isComposing || canonical(shortcutOf(e)).toLowerCase() !== "mod+a") return
    if (typingIn(e.target) || appShortcut(e)) return
    e.preventDefault()
    selectAll()
  })
}
