// Phones: one pane on screen, the shown tab's focused one; the last few file panes stay drawn (hidden), as a computer's
// do (Workspace.tsx), so going back to one (another tab, a split's other pane) shows it at once, as it was left.
import { useEffect, useLayoutEffect, useState } from "react"
import { FileView } from "@/components/FileView"
import { PaneContext } from "@/core/pane"
import { here, paneTab, useWorkspace } from "@/core/workspace"
import { swipePanes } from "@/core/phoneTabs"
import { allPanes } from "../../../core/layout.ts"
import type { Store } from "@/core/data"

const KEEP = 4

type Slot = { key: string; pane: string; path: string }
let reshown = false
/** The file pane just shown was kept drawn: its page is as it was left (App puts the window back by pixels). */
export const keptShown = () => reshown

/** Each pane's context, one object per value (a new one each draw would draw every view in it again). */
const contexts = new Map<string, { pane: string; tab: string; focused: boolean; hidden?: boolean }>()
function contextOf(pane: string, tab: string, shown: boolean) {
  const k = `${pane}\n${tab}\n${shown}`
  let c = contexts.get(k)
  if (!c) {
    if (contexts.size > 64) contexts.clear()
    c = shown ? { pane, tab, focused: true } : { pane, tab, focused: false, hidden: true }
    contexts.set(k, c)
  }
  return c
}

/** The file panes drawn: `pane` showing `path`, or (null) none shown, the others kept hidden in the order they were
 *  drawn (one that moved would draw again what's in it: an iframe). */
export function PhoneFiles({ store, pane, path }: { store: Store; pane: string; path: string | null }) {
  useWorkspace()
  const open = new Set(allPanes(here()).map((p) => p.id))
  const [state, setState] = useState<{ slots: Slot[]; recent: string[] }>({ slots: [], recent: [] })
  const key = path === null ? null : `${pane}\n${path}`
  let next = state
  const recent = [...(key ? [key] : []), ...state.recent.filter((k) => k !== key && open.has(k.split("\n")[0]))].slice(0, KEEP)
  if (recent.join("\0") !== state.recent.join("\0")) {
    const keep = new Set(recent)
    const slots = state.slots.filter((s) => keep.has(s.key))
    if (key && path !== null && !slots.some((s) => s.key === key)) slots.push({ key, pane, path })
    next = { slots, recent }
    reshown = !!key && state.slots.some((s) => s.key === key)
    setState(next)
  }
  // (what was being typed in a pane now hidden lets go: the keyboard mustn't stay up for a page that isn't there)
  useLayoutEffect(() => {
    const a = document.activeElement
    if (a instanceof HTMLElement && a.closest("[data-kept]")) a.blur()
  }, [key])
  // A split tab's panes, one at a time: swiped between sideways.
  useEffect(swipePanes, [])
  return next.slots.map((s) => {
    const shown = s.key === key
    return (
      <PaneContext.Provider key={s.key} value={contextOf(s.pane, paneTab(s.pane)?.id ?? "", shown)}>
        <div data-ui={`pane:${s.pane}`} data-kept={shown ? undefined : ""} style={shown ? undefined : { display: "none" }}>
          <FileView store={store} path={s.path} pane />
        </div>
      </PaneContext.Provider>
    )
  })
}
