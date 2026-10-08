// The status bar (desktop, bottom right): plugins' ambient items, then the view and the word count of the file in the focused pane's active tab,
// published by its view (usePublish), and plugins' status items.
import { useDeferredValue, useLayoutEffect, useMemo, useRef, type MouseEvent, type ReactNode } from "react"
import { checklist, menuAbove, menuFor } from "@/components/ContextMenu"
import { Catch, Drawn } from "@/components/Guard"
import { MODES, status_, statusSubs, VIEWS } from "@/components/fileState"
import { numberText } from "@/core/data"
import type { OpenFile } from "@/core/define"
import { joinFm } from "@/core/files"
import { kindOf } from "@/core/filekinds"
import { ambientItems, statusItems, usePluginsVersion } from "@/core/plugins"
import { getPrefs, setPrefs, usePrefs } from "@/core/prefs"
import { defaultOrder, keyList, placeKey } from "../../../core/slots.ts"
import { withoutBlocks } from "../../../core/sections.ts"

/** A notebook's cells (0 while its JSON doesn't parse). */
const cells = (t: string) => { try { const c = JSON.parse(t).cells; return Array.isArray(c) ? c.length : 0 } catch { return 0 } }
const words = (t: string) => t.match(/[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu)?.length ?? 0
/** A note's text without its blocks (```block-person```: views, not words), so a dashboard doesn't count its fences. */
const prose = (t: string) => withoutBlocks(t)

/** The plugins' ambient items the bar shows (appearance `statusBar`, else the ones not hidden), and all of them. */
function ambientShown(disabled: string[], order: string[], saved: string[] | null) {
  const all = ambientItems(disabled, order)
  const keys = saved ? keyList(saved) : defaultOrder(all.map((x) => ({ key: x.key, sort: x.item.sort, hidden: x.item.hidden })))
  return { all, shown: keys.flatMap((k) => all.filter((x) => x.key === k)) }
}
/** Right-click on the bar: which ambient items it shows. */
const ambientMenu = () => {
  const { disabled, order, statusBar } = getPrefs()
  const { all, shown } = ambientShown(disabled, order, statusBar)
  const keys = shown.map((x) => x.key), item = (x: (typeof all)[number]) => ({ key: x.key, label: x.item.title })
  return checklist("status-bar", {
    on: shown.map(item), off: [all.filter((x) => !keys.includes(x.key)).map(item)],
    set: (key, on, before) => setPrefs({ statusBar: on ? placeKey(keys, key, before) : keys.filter((k) => k !== key) }),
  })
}

export function StatusBar() {
  const s = statusSubs.use(() => status_)
  const { disabled, order, enabled, statusBar } = usePrefs()
  const plugins = usePluginsVersion() // (a vault plugin's code arriving)
  const items = useMemo(() => statusItems(disabled, order), [disabled, order, enabled, plugins])
  const ambient = useMemo(() => ambientShown(disabled, order, statusBar).shown, [disabled, order, enabled, statusBar, plugins])
  // Counted after the keystroke is on screen: a long note's count takes a few milliseconds. The file comes late with
  // its text, so a file just opened is never measured (Steady) with the last one's counts.
  const late = useDeferredValue(s)
  const body = late?.body ?? "", fm = late?.fm ?? ""
  const head = late?.head, path = late?.path ?? ""
  // What plugins' items get: the file as typed (theirs are drawn after the keystroke too).
  const file = useMemo<OpenFile>(() => ({ ...(head ?? { path, fm: {}, type: null }), text: head ? joinFm(fm, body) : "" }), [head, path, fm, body])
  const text = !!late && !late.info && !late.says
  const code = !!late && /^(code|other|notebook)$/.test(kindOf(path))
  const nb = !!late && /\.ipynb$/i.test(path)
  const counts = useMemo(() => {
    if (!text) return null
    const t = code ? body : prose(body)
    return { words: code ? 0 : words(t), chars: t.replace(/^\n+|\n+$/g, "").length, lines: body.replace(/\n$/, "").split("\n").length, cells: nb ? cells(body) : 0 }
  }, [body, text, code, nb])
  // (a plugin's item that throws is left out, its error in Errors: the bar is on every desktop tab, so it'd stop the app)
  const item_ = (key: string, draw: () => ReactNode) => <Catch key={key} reset={path} fallback={() => null}><Drawn draw={draw} /></Catch>
  const bar = "fixed right-(--right-sidebar,0px) bottom-0 z-20 transition-[right] duration-200 ease-out hidden h-7 items-center gap-2 rounded-tl-[8px] border-t-[0.5px] border-l-[0.5px] border-border bg-sidebar pr-3 pl-1 text-[12px] text-muted-foreground tabular-nums md:flex"
  const own = ambient.length > 0 && (
    <span className="flex items-center gap-1" data-ambient>
      {ambient.map(({ key, item }) => item_(key, () => item.render()))}
      {s && <span aria-hidden className="ml-1 h-3.5 w-px bg-border" />}
    </span>
  )
  if (!s) return ambient.length ? <div role="status" className={bar} onContextMenu={menuFor(ambientMenu)}>{own}</div> : null
  const cur = MODES[s.mode]
  const tip = `Current view: ${VIEWS.find((v) => v.value === s.mode)!.label.toLowerCase()}`
  // Click or right-click: the file's views (three, or reading and source), the current one checked.
  const menu = (e: MouseEvent) => menuAbove(e, s.views.map((v) => ({ label: v.label, checked: v.value === s.mode, run: () => s.setMode(v.value) })))
  const n = (x: number, one: string) => `${numberText(x)} ${one}${x === 1 ? "" : "s"}`
  return (
    <div role="status" className={bar} onContextMenu={menuFor(ambientMenu)}>
      {own}
      {items.filter((x) => !x.item.after).map(({ key, item }) => item_(key, () => item.render(file)))}
      {s.views.length > 1 ? (
        <button type="button" onClick={menu} onContextMenu={menu} aria-label={`${tip}. Change view`} aria-haspopup="menu" data-tip={tip} data-tip-side="top"
          className="grid size-6 cursor-pointer place-items-center rounded-[5px] hover:bg-foreground/[0.06] hover:text-foreground">
          <cur.icon className="size-3.5" strokeWidth={2.25} />
        </button>
      ) : <span className="w-1" />}
      <Steady reset={path}>
        {late?.info ? late.info.map((x) => <span key={x}>{x}</span>)
          : late?.says ? item_("says", () => { const said = late.says!(body); return said && <span>{said}</span> })
          : counts && nb && s.mode === "read" ? <span>{n(counts.cells, "cell")}</span>
          : counts && (code ? <><span>{n(counts.lines, "line")}</span><span>{n(counts.chars, "character")}</span></>
            : <><span>{n(counts.words, "word")}</span><span>{n(counts.chars, "character")}</span></>)}
        {items.filter((x) => x.item.after).map(({ key, item }) => item_(key, () => item.render(file)))}
      </Steady>
    </div>
  )
}

/** The bar's counts, which never narrow while one file is open: as you type, what's left of them stays put. */
function Steady({ reset, children }: { reset: string; children: ReactNode }) {
  const ref = useRef<HTMLSpanElement>(null), widest = useRef({ reset, w: 0 })
  useLayoutEffect(() => {
    const el = ref.current!
    if (widest.current.reset !== reset) { widest.current = { reset, w: 0 }; el.style.minWidth = "" }
    widest.current.w = Math.max(widest.current.w, el.getBoundingClientRect().width)
    el.style.minWidth = `${widest.current.w}px`
  })
  return <span ref={ref} className="flex items-center justify-end gap-2 empty:hidden">{children}</span>
}
