import { useScopedState } from "@vaultite"
import type { Branch } from "./tree"
import type { Group } from "./types"

const NONE: Record<string, boolean> = {}

export function useOpenGroups() {
  const [kept, keep] = useScopedState<Record<string, boolean>>("web-viewer:password-groups", NONE, "device")
  const isOpen = (g: Group) => kept[g.id] ?? g.expanded
  return { isOpen, setOpen: (g: Group, on: boolean) => { const { [g.id]: _, ...rest } = kept; keep(on === g.expanded ? rest : { ...rest, [g.id]: on }) } }
}
export function openBranches(tree: Branch[], isOpen: (g: Group) => boolean) {
  let shut = Infinity
  return tree.filter((b) => {
    if (b.depth > shut) return false
    shut = b.parent && !isOpen(b.group) ? b.depth : Infinity
    return true
  })
}
