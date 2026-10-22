// ⌘A selects the text the user is in, never the app around it: past what has its own (a field, an editor, a list's
// rows, a table), a tab's page selects what it shows; the sidebars and bars, nothing, as in a native app.
import { appShortcut, canonical, shortcutOf, typingIn } from "@/core/commands"
import { currentEditor, keysInEditor, selectAllIn } from "@/core/editors"

/** Where the user is: the element with the keyboard, or the text last clicked inside it (reading view leaves the
 *  keyboard on the page around it). */
function where(): Element | null {
  const a = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null
  const anchor = getSelection()?.anchorNode
  const at = anchor && (!a || a.contains(anchor)) ? (anchor instanceof Element ? anchor : anchor.parentElement) : a
  return at?.isConnected ? at : null
}

function selectAll() {
  const at = where(), ed = currentEditor()
  if (ed && (at ? ed.view.dom.contains(at) || (at.closest("[data-pane], dialog[open]")?.contains(ed.view.dom) ?? false) : keysInEditor(ed))) return selectAllIn(ed.view)
  const page = at?.closest("[data-pane]")
  if (page) getSelection()?.selectAllChildren(page)
}

if (typeof window !== "undefined") {
  // Bubble phase, last: what has a ⌘A of its own (a field, an editor, a table, a list's rows) takes it first.
  addEventListener("keydown", (e) => {
    if (e.defaultPrevented || e.isComposing || canonical(shortcutOf(e)).toLowerCase() !== "mod+a") return
    if (typingIn(e.target) || appShortcut(e)) return
    e.preventDefault()
    selectAll()
  })
}
