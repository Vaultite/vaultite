// The panes sliding to a sidebar's new edge (Workspace's left/right transition): cheap for pages, but a terminal resized
// each frame has its shell redraw each frame, so it waits for html[data-panes-sliding] to go (plugins/core/terminal).

/** Mark the page while `box`'s own left or right transitions; returns the cleanup. */
export function watchSliding(box: HTMLElement) {
  const root = document.documentElement, on = new Set<string>()
  const mark = () => root.toggleAttribute("data-panes-sliding", on.size > 0)
  const run = (e: TransitionEvent) => { if (e.target === box && (e.propertyName === "left" || e.propertyName === "right")) { on.add(e.propertyName); mark() } }
  const stop = (e: TransitionEvent) => { if (e.target === box) { on.delete(e.propertyName); mark() } }
  box.addEventListener("transitionrun", run)
  box.addEventListener("transitionend", stop)
  box.addEventListener("transitioncancel", stop)
  return () => {
    box.removeEventListener("transitionrun", run); box.removeEventListener("transitionend", stop); box.removeEventListener("transitioncancel", stop)
    root.removeAttribute("data-panes-sliding")
  }
}
