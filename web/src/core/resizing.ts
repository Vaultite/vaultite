// A drag resizing part of the layout (a sidebar's edge, a split, a floating pane): <body data-resizing> stops size
// animations and holds the cursor (index.css). What's costly to redraw at each size (a terminal) waits for its end.
const ends = new Set<() => void>()

/** A resize drag begins, with the cursor it holds ("col", "row", "move"...). */
export function startResizing(cursor: string) { document.body.dataset.resizing = cursor }

/** It ended: what waited for it lays out at the size it was left. */
export function stopResizing() {
  if (!resizing()) return
  delete document.body.dataset.resizing
  for (const f of [...ends]) f()
}

export const resizing = () => "resizing" in document.body.dataset

/** Run `f` each time a resize drag ends; returns its undo. */
export function onResized(f: () => void) { ends.add(f); return () => { ends.delete(f) } }
