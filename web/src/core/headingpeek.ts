// ⌥ held alone shows every quiet or hidden panel heading at once (as macOS menus show more while it's held): the page's
// `data-headings-peek` while it's down. A modifier held, not a shortcut: no command.
let on = false
const set = (v: boolean) => {
  if (v === on) return
  on = v
  document.documentElement.toggleAttribute("data-headings-peek", v)
}
let started = false
/** Start listening (once, when the sidebars first draw). */
export function watchHeadingPeek() {
  if (started || typeof window === "undefined") return
  started = true
  // (⌥ with another key is a shortcut or a character: the names go again)
  addEventListener("keydown", (e) => set(e.key === "Alt" && !e.metaKey && !e.ctrlKey && !e.shiftKey), true)
  addEventListener("keyup", (e) => { if (e.key === "Alt") set(false) }, true)
  addEventListener("blur", () => set(false))
  addEventListener("pointerdown", (e) => { if (!e.altKey) set(false) }, true)
}
/** ⌥ is held: the headings show. */
export const headingsPeek = () => on
