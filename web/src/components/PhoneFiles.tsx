// Phones: the last few file tabs stay drawn (hidden), as a computer's panes keep theirs (Workspace.tsx), so going back
// to one shows it at once, exactly as it was left, instead of drawing its page again.
import { useLayoutEffect, useState } from "react"
import { FileView } from "@/components/FileView"
import { PaneContext } from "@/core/pane"
import { groups, useWorkspace } from "@/core/workspace"
import type { Store } from "@/core/data"

const KEEP = 4

type Slot = { key: string; tab: string; path: string }
let reshown = false
/** The file tab just shown was kept drawn: its page is as it was left (App puts the window back by pixels). */
export const keptShown = () => reshown

const HIDDEN = { group: "", focused: false, hidden: true }
const SHOWN = { group: "", focused: true }

/** The file tabs drawn: `tab` showing `path`, or (null) none shown, the others kept hidden in the order they were drawn
 *  (one that moved would draw again what's in it: an iframe). */
export function PhoneFiles({ store, tab, path }: { store: Store; tab: string; path: string | null }) {
  useWorkspace()
  const open = new Set(groups().flatMap((g) => g.tabs.map((t) => t.id)))
  const [state, setState] = useState<{ slots: Slot[]; recent: string[] }>({ slots: [], recent: [] })
  const key = path === null ? null : `${tab}\n${path}`
  let next = state
  const recent = [...(key ? [key] : []), ...state.recent.filter((k) => k !== key && open.has(k.split("\n")[0]))].slice(0, KEEP)
  if (recent.join("\0") !== state.recent.join("\0")) {
    const keep = new Set(recent)
    const slots = state.slots.filter((s) => keep.has(s.key))
    if (key && path !== null && !slots.some((s) => s.key === key)) slots.push({ key, tab, path })
    next = { slots, recent }
    reshown = !!key && state.slots.some((s) => s.key === key)
    setState(next)
  }
  // (what was being typed in a tab now hidden lets go: the keyboard mustn't stay up for a page that isn't there)
  useLayoutEffect(() => {
    const a = document.activeElement
    if (a instanceof HTMLElement && a.closest("[data-kept]")) a.blur()
  }, [key])
  return next.slots.map((s) => {
    const shown = s.key === key
    return (
      <PaneContext.Provider key={s.key} value={shown ? SHOWN : HIDDEN}>
        <div data-kept={shown ? undefined : ""} style={shown ? undefined : { display: "none" }}>
          <FileView store={store} path={s.path} pane />
        </div>
      </PaneContext.Provider>
    )
  })
}
