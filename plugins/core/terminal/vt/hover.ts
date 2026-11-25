import type { Term } from "./term.ts"

export type Pointer = Pick<MouseEvent, "clientX" | "clientY" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey">

export const reporting = (t: Term, e: Pointer) => t.s.mouseTracking && !e.shiftKey

/** The link a click at `e` opens. A program that has the mouse keeps a click on text that only looks like a link (an
 *  editor's cursor goes there) unless ⌘ (Ctrl elsewhere) is held or it follows the pointer's every move (1003). */
export function linkUnder(t: Term, e: Pointer) {
  const c = t.cellAt(e.clientX, e.clientY)
  const at = c.inside ? t.linkAt(c.x, c.y) : null
  if (!at || !reporting(t, e) || at.link.declared || t.s.mode(1003)) return at
  return (t.o.mac ? e.metaKey : e.ctrlKey) ? at : null
}

const sameLink = (a: Term["hovered"], b: Term["hovered"]) => a === b || (!!a && !!b && a.link.text === b.link.text
  && a.cells.length === b.cells.length && a.cells.every((c, i) => c.y === b.cells[i].y && c.x1 === b.cells[i].x1 && c.x2 === b.cells[i].x2))

/** The link under the mouse, marked: again as the screen changes under it and as ⌘ or Ctrl goes down or up. */
export function wireHover(t: Term, held: () => boolean) {
  let last: Pointer | null = null
  const mark = (at: Term["hovered"]) => {
    if (sameLink(at, t.hovered)) return
    t.hovered = at
    t.element.toggleAttribute("data-term-link", !!at)
    t.requestRender(true)
  }
  const move = (e: Pointer) => {
    last = e
    mark(linkUnder(t, e))
    t.element.style.cursor = t.hovered ? "pointer" : reporting(t, e) ? "default" : "text"
  }
  const again = () => { if (last && !held()) move(last) }
  const onKey = (e: KeyboardEvent) => {
    if (!last || (e.key !== "Meta" && e.key !== "Control" && e.key !== "Shift")) return
    const { clientX, clientY } = last
    last = { clientX, clientY, metaKey: e.metaKey, ctrlKey: e.ctrlKey, shiftKey: e.shiftKey, altKey: e.altKey }
    again()
  }
  const rendered = t.onRender(again)
  addEventListener("keydown", onKey, true)
  addEventListener("keyup", onKey, true)
  return {
    move,
    leave: () => { last = null; mark(null) },
    dispose: () => { rendered.dispose(); removeEventListener("keydown", onKey, true); removeEventListener("keyup", onKey, true) },
  }
}
