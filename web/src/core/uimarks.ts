// Marks a plugin puts on the app's own UI by its data-ui id (`tab:<id>`, `group:<id>`): a small button the element's
// owner draws at its end (the companion's eye on a row it follows). Each plugin sets all of its marks at once.
import { signal } from "@/core/signal"
import type { LucideIcon } from "lucide-react"
import type { MouseEvent } from "react"

/** `run` gets the click: a menu at the mark (`menuBelow`). */
export type UiMark = { icon: LucideIcon; label: string; run: (e: MouseEvent<HTMLElement>) => void; tint?: string }
const byOwner = new Map<string, Map<string, UiMark[]>>()
const changed = signal()
const NONE: UiMark[] = []
let flat = new Map<string, UiMark[]>()

/** `owner`'s marks now, by data-ui id (an empty map takes them all down). */
export function setUiMarks(owner: string, marks: Map<string, UiMark[]>) {
  if (marks.size) byOwner.set(owner, marks); else if (!byOwner.delete(owner)) return
  flat = new Map()
  for (const m of byOwner.values()) for (const [id, list] of m) flat.set(id, [...(flat.get(id) ?? []), ...list])
  changed.notify()
}
/** The marks on the element of data-ui `id`, live. */
export const useUiMarks = (id: string) => changed.use(() => flat.get(id) ?? NONE)
