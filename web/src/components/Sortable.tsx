// Drag to reorder with dnd-kit (Plugins, the phone's Pages): 5px to start so clicks still open, a 250ms hold on touch
// so scrolling works, locked to the list's box so nothing scrolls away.
import { useMemo, type ReactNode } from "react"
import { DndContext, MouseSensor, TouchSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core"
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable"
import { restrictToParentElement, restrictToVerticalAxis } from "@dnd-kit/modifiers"
import { CSS } from "@dnd-kit/utilities"
import { sortHaptics } from "@/core/haptics"
import { cn } from "@/lib/utils"

// The click that ends a drag would open the dragged item: one landing a few pixels from its press is swallowed, in
// capture on the document so it runs before the link reacts.
let down = { x: 0, y: 0 }
document.addEventListener("pointerdown", (e) => { down = { x: e.clientX, y: e.clientY } }, true)
document.addEventListener("click", (e) => {
  if (!(e.target as Element).closest?.("[data-sortable-item]")) return
  if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) { e.preventDefault(); e.stopPropagation() }
}, true)

/** How the lifted item looks: a card behind it, sized to match the item's own hover background. */
const LIFT = {
  // Links whose highlight is their own box.
  fill: "rounded-[7px] bg-card shadow-lg ring-[0.5px] ring-border",
  // List rows whose hover background reaches 8px past each side (Plugins).
  wide: "before:absolute before:inset-y-0 before:-inset-x-2 before:rounded-[8px] before:bg-card before:shadow-lg before:ring-[0.5px] before:ring-border before:content-['']",
}

function Item({ id, lift, children }: { id: string; lift: keyof typeof LIFT; children: ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
  return (
    <div ref={setNodeRef} {...attributes} {...listeners} tabIndex={-1}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      data-sortable-item="" data-own-hold=""
      className={cn("relative outline-none", isDragging && ["z-10 cursor-grabbing border-t-transparent! [&_*]:cursor-grabbing", LIFT[lift]])}>
      {children}
    </div>
  )
}

export function SortableList({ ids, onMove, className, lift = "fill", children }: {
  ids: string[]; onMove: (from: string, to: string) => void; className?: string; lift?: keyof typeof LIFT
  children: (id: string) => ReactNode
}) {
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 6 } }),
  )
  const feel = useMemo(sortHaptics, [])
  const end = ({ active, over }: DragEndEvent) => {
    feel.onDragEnd()
    if (over && active.id !== over.id) onMove(String(active.id), String(over.id))
  }
  return (
    // Its screen-reader text goes in <body>, not after the list, so the list's next sibling is whatever follows it
    // (two .hairline lists in a row get their line between them).
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={feel.onDragStart} onDragOver={feel.onDragOver} onDragEnd={end} autoScroll={false}
      accessibility={{ container: document.body }}
      modifiers={[restrictToVerticalAxis, restrictToParentElement]}>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <div className={className}>{ids.map((id) => <Item key={id} id={id} lift={lift}>{children(id)}</Item>)}</div>
      </SortableContext>
    </DndContext>
  )
}
