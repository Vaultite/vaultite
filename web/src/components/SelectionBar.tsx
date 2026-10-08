// Phones selecting (core/select.ts): a bar at the bottom, over the page and the drawers, saying how many are picked,
// with what they can do together (the list's menu, above it) and Done at the right, where the thumb is.
import type { MouseEvent } from "react"
import { createPortal } from "react-dom"
import { Ellipsis } from "lucide-react"
import { clearSelection, countOf, selectionMenu, useSelectionState } from "@/core/select"
import { menuAbove } from "@/components/ContextMenu"
import { cn } from "@/lib/utils"

export function SelectionBar() {
  const sel = useSelectionState()
  if (!sel?.touch) return null
  const n = sel.keys.length
  const actions = (e: MouseEvent) => menuAbove(e, selectionMenu(sel.list, sel.keys).slice(1))
  return createPortal(
    <div data-selection-bar role="toolbar" aria-label="Selection"
      className="glass-strong fixed inset-x-0 bottom-0 z-[45] px-3 pt-1.5 pb-[max(env(safe-area-inset-bottom),0.375rem)] shadow-[0_-0.5px_0_var(--border)]">
      <div className="mx-auto flex max-w-md items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-[17px] text-muted-foreground tabular-nums" aria-live="polite">{n ? countOf(sel.list, n) : "Tap to select"}</span>
        <button type="button" disabled={!n} onClick={actions} aria-label="Actions"
          className={cn("flex h-11 shrink-0 cursor-pointer items-center gap-1.5 rounded-[12px] px-3 text-[17px] text-primary active:bg-foreground/[0.06] disabled:opacity-40")}>
          <Ellipsis className="size-5" strokeWidth={2} />Actions
        </button>
        <button type="button" onClick={clearSelection}
          className="h-11 shrink-0 cursor-pointer rounded-[12px] px-3 text-[17px] font-semibold text-primary active:bg-foreground/[0.06]">Done</button>
      </div>
    </div>,
    // Over an open sheet (the phone's tab list: a modal <dialog>, above all else), inside it.
    [...document.querySelectorAll<HTMLElement>("dialog[open]")].pop() ?? document.body,
  )
}
