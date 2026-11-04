// dnd-kit comes with the first list that can be reordered, not with the app: until then its rows are drawn as they are.
import { lazy, Suspense, type ComponentProps } from "react"

const Sortable = lazy(() => import("@/components/Sortable").then((m) => ({ default: m.SortableList })))

/** Rows the user reorders by dragging (5px to start; a held finger on touch); `onMove(from, to)` with their ids. */
export function SortableList({ ids, onMove, className, lift, children }: ComponentProps<typeof Sortable>) {
  const rows = <div className={className}>{ids.map((id) => <div key={id} className="relative">{children(id)}</div>)}</div>
  return <Suspense fallback={rows}><Sortable ids={ids} onMove={onMove} className={className} lift={lift}>{children}</Sortable></Suspense>
}
