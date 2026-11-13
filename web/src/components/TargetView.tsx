import type { Store } from "@/core/data"
import { tabPath } from "../../../core/layout.ts"
import { offText, viewFor } from "@/core/plugins"
import { usePrefs } from "@/core/prefs"
import { Drawn } from "@/components/Guard"
import { drawFileView } from "@/components/drawFile"

/** A tab's target drawn outside the panes, in a sheet (a glance): a file as a sheet shows one, a plugin's view as its
 *  tab draws it, filling the sheet when it fills a pane. `setTarget`: the view changed its own arg (a page followed a link). */
export function TargetView({ store, to, close, setTarget }: { store: Store; to: string; close: () => void; setTarget: (to: string) => void }) {
  const { disabled } = usePrefs()
  const file = tabPath(to)
  if (file) return drawFileView(store, file)
  const view = to.startsWith("view:") ? viewFor(to, disabled) : null
  if (!view?.on) return <p className="mt-6 text-[15px] text-muted-foreground">{view ? `${offText(view.plugin, disabled)}.` : "Nothing draws this."}</p>
  const name = to.slice(5).split("/")[0]
  const ctx = { store, arg: view.arg, focused: true, close, setArg: (arg: string) => setTarget(`view:${name}${arg ? `/${arg}` : ""}`) }
  const drawn = <Drawn draw={() => view.def.render(ctx)} />
  return view.def.full ? <div className="absolute inset-0">{drawn}</div> : drawn
}
