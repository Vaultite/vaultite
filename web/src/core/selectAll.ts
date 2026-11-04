// ⌘A selects the text the user is in, never the app around it: past what has its own (a field, an editor, a list's
// rows, a table), a tab's page selects what it shows; the sidebars and bars, nothing, as in a native app.
import { appShortcut, canonical, shortcutOf, typingIn } from "@/core/commands"
import { currentEditor, keysInEditor, selectAllIn } from "@/core/editors"

/** What the last press was on: one in the app's chrome can put the caret in a page far from it (Chrome moves it to the
 *  nearest text that selects), which isn't where the user is. */
let pressed: Element | null = null
const areaOf = (n: Node) => (n instanceof Element ? n : n.parentElement)?.closest("[data-pane], dialog[open]") ?? null

/** Where the user is: the element with the keyboard, or the text last clicked inside it (reading view leaves the
 *  keyboard on the page around it). */
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
  // Bubble phase, last: what has a ⌘A of its own (a field, an editor, a table, a list's rows) takes it first.
  addEventListener("keydown", (e) => {
    if (e.defaultPrevented || e.isComposing || canonical(shortcutOf(e)).toLowerCase() !== "mod+a") return
    if (typingIn(e.target) || appShortcut(e)) return
    e.preventDefault()
    selectAll()
  })
}
