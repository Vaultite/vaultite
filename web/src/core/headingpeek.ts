let on = false
const set = (v: boolean) => {
  if (v === on) return
  on = v
  document.documentElement.toggleAttribute("data-headings-peek", v)
}
let started = false
export function watchHeadingPeek() {
  if (started || typeof window === "undefined") return
  started = true
  addEventListener("keydown", (e) => set(e.key === "Alt" && !e.metaKey && !e.ctrlKey && !e.shiftKey), true)
  addEventListener("keyup", (e) => { if (e.key === "Alt") set(false) }, true)
  addEventListener("blur", () => set(false))
  addEventListener("pointerdown", (e) => { if (!e.altKey) set(false) }, true)
}
export const headingsPeek = () => on
