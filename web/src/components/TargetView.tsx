// What a tab shows (Workspace's TabContent), drawn outside the panes.
import type { Store } from "@/core/data"
import { tabPath } from "@/core/layout"
import { names, viewFor } from "@/core/plugins"
import { usePrefs } from "@/core/prefs"
import type { ReactNode } from "react"
import { Drawn } from "@/components/Guard"

let fileView: ((store: Store, path: string) => ReactNode) | null = null
/** How a file is drawn in a sheet, from App (importing FileView here would loop: it imports the plugins, which import this). */
export const setSheetFile = (fn: (store: Store, path: string) => ReactNode) => { fileView = fn }

/** A tab's target drawn outside the panes, in a sheet (a glance): a file as a sheet shows one, a plugin's view as its
 *  tab draws it, filling the sheet when it fills a pane. `setTarget`: the view changed its own arg (a page followed a link). */
export function TargetView({ store, to, close, setTarget }: { store: Store; to: string; close: () => void; setTarget: (to: string) => void }) {
  const { disabled } = usePrefs()
  const file = tabPath(to)
  if (file) return fileView?.(store, file) ?? null
  const view = to.startsWith("view:") ? viewFor(to, disabled) : null
  if (!view?.on) return <p className="mt-6 text-[15px] text-muted-foreground">{view ? `${names([view.plugin.id])} is off.` : "Nothing draws this."}</p>
  const name = to.slice(5).split("/")[0]
  const ctx = { store, arg: view.arg, focused: true, close, setArg: (arg: string) => setTarget(`view:${name}${arg ? `/${arg}` : ""}`) }
  const drawn = <Drawn draw={() => view.def.render(ctx)} />
  return view.def.full ? <div className="absolute inset-0">{drawn}</div> : drawn
}
