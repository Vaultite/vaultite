// Phones: one pane on screen; the last few file panes stay drawn (hidden), as a computer's do, so going back to one
// shows it at once, as it was left. A split's panes either side are drawn off the page's edges, for the swipe.
import { useEffect, useLayoutEffect, useState } from "react"
import { FileView } from "@/components/FileView"
import { useTabLabels } from "@/components/Tabs"
import { PaneContext } from "@/core/pane"
import { activeTab, here, paneTab, useWorkspace } from "@/core/workspace"
import { swipePanes } from "@/core/phoneTabs"
import { useTabShot } from "@/core/tabShots"
import { allPanes, panesOf, type Pane } from "../../../core/layout.ts"
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
  const [state, setState] = useState<{ slots: Slot[]; recent: string[]; near: string }>({ slots: [], recent: [], near: "" })
  const key = path === null ? null : `${pane}\n${path}`
  // The split's panes either side of the one shown (-1, 1), files drawn as slots too.
  const all = panesOf(activeTab()), at = all.findIndex((p) => p.id === pane)
  const beside = at < 0 ? [] : ([[all[at - 1], -1], [all[at + 1], 1]] as const).filter((b): b is [Pane, -1 | 1] => !!b[0])
  const near = new Map(beside.filter(([p]) => p.to.startsWith("file:")).map(([p, k]) => [`${p.id}\n${p.to.slice(5)}`, k]))
  let next = state
  const recent = [...(key ? [key] : []), ...state.recent.filter((k) => k !== key && open.has(k.split("\n")[0]))].slice(0, KEEP)
  const nearKey = [...near.keys()].join("\0")
  if (recent.join("\0") !== state.recent.join("\0") || nearKey !== state.near) {
    const keep = new Set([...recent, ...near.keys()])
    const slots = state.slots.filter((s) => keep.has(s.key))
    for (const [k, p] of [...(key && path !== null ? [[key, { id: pane, path }] as const] : []), ...[...near.keys()].map((k) => [k, { id: k.split("\n")[0], path: k.slice(k.indexOf("\n") + 1) }] as const)]) {
      if (!slots.some((s) => s.key === k)) slots.push({ key: k, pane: p.id, path: p.path })
    }
    next = { slots, recent, near: nearKey }
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
  return <>
    {next.slots.map((s) => {
      const shown = s.key === key, side = shown ? undefined : near.get(s.key)
      // (one shape however it's drawn: a slot moving between shown, beside and hidden isn't drawn again)
      return (
        <PaneContext.Provider key={s.key} value={contextOf(s.pane, paneTab(s.pane)?.id ?? "", shown)}>
          <div data-ui={`pane:${s.pane}`} data-kept={shown ? undefined : ""} data-beside={side} data-to={side ? `file:${s.path}` : undefined}
            aria-hidden={side ? true : undefined} style={shown || side ? undefined : { display: "none" }}>
            <div><FileView store={store} path={s.path} pane /></div>
          </div>
        </PaneContext.Provider>
      )
    })}
    {beside.filter(([p]) => !p.to.startsWith("file:")).map(([p, side]) => <StandIn key={p.id} store={store} pane={p} side={side} />)}
  </>
}

/** A pane beside that isn't a file (a view, a new tab), till it's swiped to: its last picture (the iPhone app's), else
 *  its icon and name. */
function StandIn({ store, pane, side }: { store: Store; pane: Pane; side: -1 | 1 }) {
  const shot = useTabShot(pane.id, pane.to)
  const info = useTabLabels(store)(pane), Icon = info.icon
  return (
    <div data-kept="" data-beside={side} data-to="" aria-hidden inert>
      <div>
        {shot ? <img src={shot} alt="" decoding="async" draggable={false} className="-mx-4 block w-[calc(100%+2rem)] max-w-none" />
          : <div className="flex flex-col items-center gap-3 pt-[28vh] text-center">
            <Icon className={info.tint ? "size-12" : "size-12 text-muted-foreground"} strokeWidth={1.5} style={info.tint ? { color: info.tint } : undefined} />
            <span className="max-w-full truncate text-[17px] font-semibold">{info.label}</span>
          </div>}
      </div>
    </div>
  )
}
