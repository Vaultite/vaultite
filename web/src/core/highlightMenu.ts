// Highlight colours as menu rows: the editor's Format ▸ Highlight submenu and the swatch on the highlight at the cursor.
import { createElement } from "react"
import type { LucideIcon } from "lucide-react"
import type { MenuItem } from "@/components/ContextMenu"
import { colorHighlight, HIGHLIGHT_COLORS, highlightAt, highlightClass, recolor, unmark, type Highlight, type HighlightColor } from "@/core/highlights"
import { capitalize } from "@/lib/utils"
import type { ChangeSpec } from "@codemirror/state"
import type { EditorView } from "@codemirror/view"

const dots = new Map<string, LucideIcon>()
/** A colour's dot as a menu row's icon; ringed for the colour it has now (a menu row's check would take the dot's place). */
export function highlightIcon(color: HighlightColor | null, now = false) {
  const key = `${color ?? ""}:${now}`
  let I = dots.get(key)
  if (!I) {
    dots.set(key, I = (({ className }: { className?: string }) => createElement("span", { className: `${className ?? ""} grid place-items-center`, "aria-hidden": true },
      createElement("span", { className: `hl-dot ${highlightClass(color)}${now ? " is-now" : ""}` }))) as unknown as LucideIcon)
  }
  return I
}

/** The colours as menu rows (Default first), the highlight at the selection's ringed; `at`: the one there (the
 *  swatch's), with Remove highlight under them. */
export function highlightItems(view: EditorView, at?: number): MenuItem[] {
  const { main } = view.state.selection
  const h = at === undefined ? highlightAt(view.state, main.from, main.to) : highlightAt(view.state, at)
  // (the one at `at` is found again when picked: the text may have changed while the menu was open)
  const act = (fn: (now: Highlight) => ChangeSpec, userEvent: string) => () => {
    view.focus()
    const now = at === undefined ? null : highlightAt(view.state, at)
    if (now) view.dispatch({ changes: fn(now), userEvent })
  }
  const pick = (c: HighlightColor | null) => (at === undefined ? () => { view.focus(); colorHighlight(c)(view) } : act((now) => recolor(now, c), "input"))
  return [
    { label: "Default", icon: highlightIcon(null, !!h && !h.color), run: pick(null) },
    ...HIGHLIGHT_COLORS.map(({ name }) => ({ label: capitalize(name), icon: highlightIcon(name, h?.color === name), run: pick(name) })),
    ...(at !== undefined && h ? [{ label: "Remove highlight", sep: true, run: act(unmark, "delete") }] : []),
  ]
}
