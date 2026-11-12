const ends = new Set<() => void>()

export function startResizing(cursor: string) { document.body.dataset.resizing = cursor }

export function stopResizing() {
  if (!resizing()) return
  delete document.body.dataset.resizing
  for (const f of [...ends]) f()
}

export const resizing = () => "resizing" in document.body.dataset

/** Run `f` each time a resize drag ends; returns its undo. */
export function onResized(f: () => void) { ends.add(f); return () => { ends.delete(f) } }
