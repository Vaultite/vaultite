// The status bar (desktop, bottom right): plugins' ambient items (dragged along it or into its tray), then the view and
// the word count of the file in the focused pane's active tab (published by its view: usePublish), and plugins' status items.
import { useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode, type RefObject } from "react"
import { Ellipsis } from "lucide-react"
import { checklist, menuAbove, menuFor } from "@/components/ContextMenu"
import { Catch, Drawn } from "@/components/Guard"
import { MODES, status_, statusSubs, VIEWS } from "@/components/fileState"
import { countText, type Counts } from "@/core/counts"
import { numberText } from "@/core/data"
import type { OpenFile } from "@/core/define"
import { startDrag, useDrag, useDropHit, useDropTarget } from "@/core/drag"
import { joinFm } from "@/core/files"
import { kindOf } from "@/core/filekinds"
import { ambientItems, statusItems, usePluginsVersion, vaultPluginsIn } from "@/core/plugins"
import { getPrefs, setPrefs, usePrefs } from "@/core/prefs"
import { cn } from "@/lib/utils"
import { defaultOrder, keyList, placeKey } from "../../../core/slots.ts"

/** Past this, a file's counts and plugins' items wait for typing to pause, and the counts are made in a worker: a 16 MB
 *  note's take seconds. */
const BIG = 1 << 20
/** The bar and its tray stop short of the left sidebar (and the right one, which the bar sits against). */
const MAX_WIDTH = "calc(100vw - var(--left-sidebar, 0px) - var(--right-sidebar, 0px) - 12px)"

/** The plugins' ambient items the bar shows (appearance `statusBar`, else the ones not hidden), and all of them. */
function ambientShown(disabled: string[], order: string[], saved: string[] | null) {
  const all = ambientItems(disabled, order)
  const keys = saved ? keyList(saved) : defaultOrder(all.map((x) => ({ key: x.key, sort: x.item.sort, hidden: x.item.hidden })))
  return { all, shown: keys.flatMap((k) => all.filter((x) => x.key === k)) }
}
/** Right-click on the bar: which ambient items it shows. */
const ambientMenu = () => {
  const { disabled, order, statusBar, statusBarMore } = getPrefs()
  const { all, shown } = ambientShown(disabled, order, statusBar)
  const keys = shown.map((x) => x.key), item = (x: (typeof all)[number]) => ({ key: x.key, label: x.item.title })
  return checklist("status-bar", {
    on: shown.map(item), off: [all.filter((x) => !keys.includes(x.key)).map(item)],
    set: (key, on, before) => setPrefs(on ? { statusBar: placeKey(keys, key, before) }
      : { statusBar: keys.filter((k) => k !== key), statusBarMore: statusBarMore.filter((k) => k !== key) }),
  })
}
/** An ambient item put before `before` in the bar's order (null: last), in the tray (`tuck`) or out of it. */
function moveAmbient(key: string, before: string | null, tuck: boolean) {
  const { disabled, order, statusBar, statusBarMore } = getPrefs()
  const keys = ambientShown(disabled, order, statusBar).shown.map((x) => x.key)
  const more = statusBarMore.filter((k) => k !== key)
  setPrefs({ statusBar: placeKey(keys, key, before), statusBarMore: tuck ? [...more, key] : more })
}

/** Where an item dropped would go, and its line's place in the bar or the tray (none: onto the more button). */
type Gap = { before: string | null; x?: number; y?: number }
/** The gap among `slots` (left to right, maybe on several lines) nearest (x, y), or null where the item already is.
 *  `last`: what a drop after the last one goes before. */
function gapAt(box: HTMLElement, slots: HTMLElement[], key: string, x: number, y: number, last: string | null, here: boolean): Gap {
  const r = box.getBoundingClientRect()
  if (!slots.length) return { before: last, x: r.width / 2, y: r.height / 2 }
  const boxes = slots.map((el) => el.getBoundingClientRect())
  const mid = (b: DOMRect) => (b.top + b.bottom) / 2
  const gaps = boxes.map((b, i) => ({ x: i && boxes[i - 1].top === b.top ? (boxes[i - 1].right + b.left) / 2 : b.left - 2, y: mid(b) }))
  const end = boxes[boxes.length - 1]
  gaps.push({ x: end.right + 2, y: mid(end) })
  const i = gaps.reduce((best, g, j) => (Math.hypot(x - g.x, y - g.y) < Math.hypot(x - gaps[best].x, y - gaps[best].y) ? j : best), 0)
  const mine = slots.findIndex((el) => el.dataset.statusKey === key)
  if (here && mine >= 0 && (i === mine || i === mine + 1)) return { before: key }
  return { before: slots[i]?.dataset.statusKey ?? last, x: gaps[i].x - r.left, y: gaps[i].y - r.top }
}

/** The bar's items left out so it stops short of the left sidebar: from the right, each that still fits (by its width
 *  when last shown) in the room the rest of the bar leaves stays. Redone as anything in it changes size. */
function useOverflow(bar: RefObject<HTMLElement | null>, fit: RefObject<HTMLElement | null>, keys: string[]) {
  const [over, setOver] = useState<string[]>([])
  const widths = useRef(new Map<string, number>())
  const layout = useRef(() => {})
  layout.current = () => {
    const b = bar.current, f = fit.current
    if (!b || !f || !b.offsetWidth) return
    for (const el of f.querySelectorAll<HTMLElement>(":scope > [data-status-key]"))
      if (!over.includes(el.dataset.statusKey!)) widths.current.set(el.dataset.statusKey!, el.getBoundingClientRect().width)
    const side = document.querySelector("aside[data-side=left]")?.getBoundingClientRect().right ?? 0
    const room = b.getBoundingClientRect().right - side - 12 - (b.offsetWidth - f.offsetWidth)
    let used = 0
    const next: string[] = []
    for (const k of keys.toReversed()) {
      // (an item drawing nothing isn't left out)
      const w = widths.current.get(k) ?? 0, add = w + (used ? 4 : 0)
      if (w && used + add > room + 0.5) next.unshift(k)
      else if (w) used += add
    }
    if (next.join() !== over.join()) setOver(next)
  }
  const joined = keys.join()
  // (only when its items change, before the paint; their sizes changing is the observer's: measuring on every render
  // forced the whole app's layout each time, seconds of it while the app loads)
  useLayoutEffect(() => layout.current(), [joined])
  useEffect(() => {
    const b = bar.current, f = fit.current
    if (!b || !f) return
    const ro = new ResizeObserver(() => layout.current())
    for (const el of [b, f, ...f.children, document.querySelector("aside[data-side=left]")]) if (el) ro.observe(el)
    const resize = () => layout.current()
    addEventListener("resize", resize)
    return () => { ro.disconnect(); removeEventListener("resize", resize) }
  }, [bar, fit, joined])
  return over
}

/** Too narrow for the bar (a narrow window): its least needed parts go first, `data-drop` 1 (characters), 2 (words), 3
 *  (plugins' labels), and come back, last gone first, once there's room. Sizes come from an observer, not each render. */
function useDrops(bar: RefObject<HTMLElement | null>, shown: boolean) {
  useEffect(() => {
    const b = bar.current
    if (!b) return
    const widths = new WeakMap<HTMLElement, number>()
    const fit = () => {
      const els = [...b.querySelectorAll<HTMLElement>("[data-drop]")].sort((x, y) => Number(x.dataset.drop) - Number(y.dataset.drop))
      for (const el of els) if (el.style.display !== "none" && el.offsetWidth) widths.set(el, el.offsetWidth)
      const gone = els.filter((el) => el.style.display === "none")
      if (b.scrollWidth > b.clientWidth + 1) {
        const next = els.find((el) => el.style.display !== "none")
        if (next) { b.dataset.cramped = ""; next.style.display = "none" }
      } else if (gone.length) {
        const back = gone[gone.length - 1], room = parseFloat(getComputedStyle(b).maxWidth) - b.offsetWidth
        if (room > (widths.get(back) ?? Infinity) + 12) { back.style.display = ""; if (gone.length === 1) delete b.dataset.cramped }
      }
    }
    let frame = 0
    const soon = () => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; fit() }) }
    const ro = new ResizeObserver(soon), watch = () => { ro.observe(b); for (const el of b.querySelectorAll("[data-steady], [data-drop]")) ro.observe(el) }
    // (its parts come and go with the file: each watched as it comes)
    const mo = new MutationObserver(() => { watch(); soon() })
    watch()
    mo.observe(b, { childList: true, subtree: true })
    addEventListener("resize", soon)
    return () => { ro.disconnect(); mo.disconnect(); cancelAnimationFrame(frame); removeEventListener("resize", soon) }
  }, [bar, shown])
}

const KEPT_WIDTH = "vaultite.statusbar", KEPT_ITEMS = "vaultite.statusbar.items"
/** The ambient items' widths at the last load, in the bar's order. */
type Kept = [key: string, width: number][]
/** The bar as wide as last load's, and its ambient items as wide as theirs, while they come in (each, arriving, pushed
 *  the rest), until another file opens: like Steady. Returns the items' widths to hold, while held. */
function useKeptWidth(bar: RefObject<HTMLElement | null>, path: string): Kept | null {
  const first = useRef<string | null>(null)
  if (first.current === null && path) first.current = path
  const held = first.current === null || first.current === path
  const kept = useRef<number | null>(null)
  if (kept.current === null) try { kept.current = Number(localStorage.getItem(KEPT_WIDTH)) || 0 } catch { kept.current = 0 }
  const items = useRef<Kept | null>(null)
  if (items.current === null) {
    try { const k = JSON.parse(localStorage.getItem(KEPT_ITEMS) ?? "[]"); items.current = Array.isArray(k) ? k : [] } catch { items.current = [] }
  }
  // (before the paint: held from the bar's first frame)
  useLayoutEffect(() => {
    if (bar.current) bar.current.style.minWidth = held && kept.current ? `${kept.current}px` : ""
  })
  useEffect(() => {
    const el = bar.current
    if (!el) return
    let saving: ReturnType<typeof setTimeout> | undefined
    const save = () => {
      clearTimeout(saving)
      saving = setTimeout(() => {
        // (not before the vault's plugins came: their items aren't drawn yet)
        if (!vaultPluginsIn()) return save()
        // (as drawn without what's held: an item drawing nothing is kept as 0, holding no room)
        const slots = [...el.querySelectorAll<HTMLElement>("[data-ambient] > [data-status-key]")]
        const mins = [el, ...slots].map((x) => x.style.minWidth)
        for (const x of [el, ...slots]) x.style.minWidth = ""
        const w = Math.round(el.getBoundingClientRect().width)
        const widths: Kept = slots.map((x) => [x.dataset.statusKey!, x.matches(":empty") ? 0 : Math.ceil(x.getBoundingClientRect().width)])
        ;[el, ...slots].forEach((x, i) => { x.style.minWidth = mins[i] })
        try {
          if (w) localStorage.setItem(KEPT_WIDTH, String(w))
          localStorage.setItem(KEPT_ITEMS, JSON.stringify(widths))
        } catch { /* full */ }
      }, 2000)
    }
    const ro = new ResizeObserver(save)
    for (const c of [el, ...el.children]) ro.observe(c)
    save()
    return () => { clearTimeout(saving); ro.disconnect() }
  }, [bar, path])
  return held ? items.current : null
}

/** The bar's ambient items with the room of those still to come (a vault plugin's, before the vault's plugins came)
 *  where they were last time. */
function withComing<T extends { key: string }>(shown: T[], kept: Kept | null, known: string[]): (T | { key: string; coming: number })[] {
  if (!kept?.length || vaultPluginsIn()) return shown
  const rank = new Map(kept.map(([k], i) => [k, i]))
  const coming = kept.filter(([k, w]) => w > 0 && !known.includes(k))
  const out: (T | { key: string; coming: number })[] = []
  let next = 0
  for (const x of shown) {
    const r = rank.get(x.key)
    if (r !== undefined) while (next < coming.length && rank.get(coming[next][0])! < r) { const [key, w] = coming[next++]; out.push({ key, coming: w }) }
    out.push(x)
  }
  for (const [key, w] of coming.slice(next)) out.push({ key, coming: w })
  return out
}

export function StatusBar() {
  const s = statusSubs.use(() => status_)
  const { disabled, order, enabled, statusBar, statusBarMore } = usePrefs()
  const plugins = usePluginsVersion() // (a vault plugin's code arriving)
  const items = useMemo(() => statusItems(disabled, order), [disabled, order, enabled, plugins])
  const ambient = useMemo(() => ambientShown(disabled, order, statusBar).shown, [disabled, order, enabled, statusBar, plugins])
  // Counted after the keystroke is on screen: a long note's count takes a few milliseconds. The file comes late with
  // its text, so a file just opened is never measured (Steady) with the last one's counts.
  const late = useSettled(s)
  const body = late?.body ?? "", fm = late?.fm ?? ""
  const head = late?.head, path = late?.path ?? ""
  // What plugins' items get: the file as typed (theirs are drawn after the keystroke too).
  const file = useMemo<OpenFile>(() => ({ ...(head ?? { path, fm: {}, type: null }), text: head ? joinFm(fm, body) : "" }), [head, path, fm, body])
  const text = !!late && !late.info && !late.says
  const code = !!late && /^(code|other|notebook)$/.test(kindOf(path))
  const nb = !!late && /\.ipynb$/i.test(path)
  const counts = useCounts(path, body, text, code, nb)
  // (a plugin's item that throws is left out, its error in Errors: the bar is on every desktop tab, so it'd stop the app)
  const item_ = (key: string, draw: () => ReactNode) => <Catch key={key} reset={path} fallback={() => null}><Drawn draw={draw} /></Catch>

  // The ambient items: the tucked ones in the tray, the rest in the bar, but those that don't fit (from the left), which
  // the tray shows too.
  const barRef = useRef<HTMLDivElement>(null), fitRef = useRef<HTMLDivElement>(null), trayRef = useRef<HTMLDivElement>(null)
  const inBar = ambient.filter((x) => !statusBarMore.includes(x.key))
  const over = useOverflow(barRef, fitRef, inBar.map((x) => x.key))
  const keptItems = useKeptWidth(barRef, path)
  useDrops(barRef, !!(s && late))
  const inTray = ambient.filter((x) => statusBarMore.includes(x.key) || over.includes(x.key))
  const [tray, setTray] = useState(false)
  const d = useDrag(), dragged = d?.item.status
  const { barHit, trayHit } = useAmbientDrops(barRef, fitRef, trayRef, ambient.map((x) => x.key), inTray.map((x) => x.key), statusBarMore)
  const trayOpen = tray && inTray.length > 0
  useEffect(() => {
    if (!trayOpen) return
    const down = (e: PointerEvent) => { if (!(e.target as Element).closest?.("[data-status-tray], [data-status-more]")) setTray(false) }
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setTray(false) }
    addEventListener("pointerdown", down, true); addEventListener("keydown", key, true)
    return () => { removeEventListener("pointerdown", down, true); removeEventListener("keydown", key, true) }
  }, [trayOpen])
  const slot = (key: string, item: (typeof ambient)[number]["item"], hidden = false, hold = 0) => (
    <span key={key} data-status-key={key} onPointerDown={(e) => startDrag(e, { from: "status", status: key, label: item.title })}
      style={hold ? { minWidth: hold } : undefined}
      className={cn("flex shrink-0 items-center", !hold && "empty:hidden", hidden && "hidden", dragged === key && "opacity-50")}>
      {item_(key, () => item.render())}
    </span>
  )
  const line = (g: Gap | null) => g?.x !== undefined && <div aria-hidden className="pointer-events-none absolute h-4 w-0.5 rounded-full bg-primary" style={{ left: g.x - 1, top: g.y! - 8 }} />
  const more = (inTray.length > 0 || !!dragged) && (
    <button type="button" data-status-more onClick={() => setTray((t) => !t)} aria-label="More status items" aria-expanded={trayOpen} data-tip="More" data-tip-side="top"
      className={cn("grid size-6 shrink-0 cursor-pointer place-items-center rounded-[5px] hover:bg-foreground/[0.06] hover:text-foreground",
        trayOpen && "bg-foreground/[0.06] text-foreground", trayHit?.x === undefined && !!trayHit && "ring-1 ring-primary")}>
      <Ellipsis className="size-3.5" strokeWidth={2.25} />
    </button>
  )
  const own = (more || inBar.length > 0) && <>
    {more}
    <div ref={fitRef} data-ambient className="flex min-w-0 items-center gap-1 overflow-hidden">
      {withComing(inBar, keptItems, ambient.map((x) => x.key)).map((x) => "coming" in x
        ? <span key={x.key} aria-hidden data-status-coming className="shrink-0" style={{ width: x.coming }} />
        : slot(x.key, x.item, over.includes(x.key), keptItems?.find(([k]) => k === x.key)?.[1]))}
    </div>
    {s && <span aria-hidden className="h-3.5 w-px shrink-0 bg-border" />}
  </>
  const trayBox = trayOpen && (
    <div ref={trayRef} data-status-tray onClickCapture={() => setTray(false)} style={{ maxWidth: MAX_WIDTH }}
      className="absolute bottom-full left-0 mb-1 flex flex-wrap items-center gap-1 rounded-[8px] border-[0.5px] border-border bg-sidebar p-1 shadow-lg">
      {inTray.map(({ key, item }) => slot(key, item))}
      {line(trayHit)}
    </div>
  )
  const bar = "fixed right-(--right-sidebar,0px) bottom-0 z-20 transition-[right] duration-200 ease-out hidden h-7 items-center gap-2 rounded-tl-[8px] border-t-[0.5px] border-l-[0.5px] border-border bg-sidebar pr-3 pl-1 text-[12px] text-muted-foreground tabular-nums md:flex"
  const wrap = (children: ReactNode) => (
    <div ref={barRef} role="status" data-status-bar className={bar} style={{ maxWidth: MAX_WIDTH }} onContextMenu={menuFor(ambientMenu)}>
      {own}
      {children}
      {line(barHit)}
      {trayBox}
    </div>
  )
  // (the file's part all at once: its view button drawn a frame before the items late brings moved when they came)
  if (!s || !late) return own ? wrap(null) : null
  const cur = MODES[s.mode]
  const tip = `Current view: ${VIEWS.find((v) => v.value === s.mode)!.label.toLowerCase()}`
  // Click or right-click: the file's views (three, or reading and source), the current one checked.
  const menu = (e: MouseEvent) => menuAbove(e, s.views.map((v) => ({ label: v.label, checked: v.value === s.mode, run: () => s.setMode(v.value) })))
  const n = (x: number, one: string) => `${numberText(x)} ${one}${x === 1 ? "" : "s"}`
  return wrap(<>
    {items.filter((x) => !x.item.after).map(({ key, item }) => <span key={key} data-drop="3" className="contents">{item_(key, () => item.render(file))}</span>)}
    {s.views.length > 1 ? (
      <button type="button" onClick={menu} onContextMenu={menu} aria-label={`${tip}. Change view`} aria-haspopup="menu" data-tip={tip} data-tip-side="top"
        className="grid size-6 shrink-0 cursor-pointer place-items-center rounded-[5px] hover:bg-foreground/[0.06] hover:text-foreground">
        <cur.icon className="size-3.5" strokeWidth={2.25} />
      </button>
    ) : <span className="w-1 shrink-0" />}
    <Steady reset={path}>
      {late?.info ? late.info.map((x) => <span key={x}>{x}</span>)
        : late?.says ? item_("says", () => { const said = late.says!(body); return said && <span>{said}</span> })
        : counts && nb && s.mode === "read" ? <span>{n(counts.cells, "cell")}</span>
        : counts && (code ? <><span data-drop="2">{n(counts.lines, "line")}</span><span data-drop="1">{n(counts.chars, "character")}</span></>
          : <><span data-drop="2">{n(counts.words, "word")}</span><span data-drop="1">{n(counts.chars, "character")}</span></>)}
      {items.filter((x) => x.item.after).map(({ key, item }) => item_(key, () => item.render(file)))}
    </Steady>
  </>)
}

/** The bar and its tray (with the more button) as drop targets for ambient items: in the bar, before the item after the
 *  line; in the tray or onto the button, tucked there (onto the button: last). */
function useAmbientDrops(barRef: RefObject<HTMLElement | null>, fitRef: RefObject<HTMLElement | null>, trayRef: RefObject<HTMLElement | null>,
  keys: string[], trayKeys: string[], tucked: string[]) {
  // A drop after the tray's last item goes before what follows that one in the bar's order.
  const afterTray = (key: string) => {
    const rest = keys.filter((k) => k !== key), end = trayKeys.filter((k) => k !== key).at(-1)
    return end ? rest[rest.indexOf(end) + 1] ?? null : rest[0] ?? null
  }
  const stays = (item: { status?: string }, h: Gap) => h.before === item.status
  useDropTarget<Gap>("status:bar", (item, x, y, el) => {
    const bar = barRef.current, fit = fitRef.current
    if (!item.status || !bar || !fit || el?.closest("[data-status-tray], [data-status-more]")) return null
    const b = bar.getBoundingClientRect(), f = fit.getBoundingClientRect()
    if (x < f.left - 24 || x > b.right || y < b.top - 24 || y > b.bottom) return null
    const slots = [...fit.querySelectorAll<HTMLElement>(":scope > [data-status-key]")].filter((el) => el.offsetWidth)
    const g = gapAt(fit, slots, item.status, x, y, null, !tucked.includes(item.status))
    if (stays(item, g)) return null
    // (the line in the bar's px: the bar holds it)
    return { ...g, x: g.x! + f.left - b.left, y: g.y! + f.top - b.top }
  }, (item, g) => moveAmbient(item.status!, g.before, false))
  useDropTarget<Gap>("status:more", (item, x, y, el) => {
    if (!item.status) return null
    const tray = trayRef.current
    if (tray && el && tray.contains(el)) {
      const slots = [...tray.querySelectorAll<HTMLElement>(":scope > [data-status-key]")]
      const g = gapAt(tray, slots, item.status, x, y, afterTray(item.status), tucked.includes(item.status))
      return stays(item, g) ? null : g
    }
    return el?.closest("[data-status-more]") ? { before: afterTray(item.status) } : null
  }, (item, g) => moveAmbient(item.status!, g.before, true))
  return { barHit: useDropHit<Gap>("status:bar"), trayHit: useDropHit<Gap>("status:more") }
}

/** The file as it is, a moment after each keystroke; a big one's once typing pauses (another file's at once). */
function useSettled(s: typeof status_) {
  const deferred = useDeferredValue(s)
  const big = (s?.body.length ?? 0) > BIG
  const [settled, setSettled] = useState(s)
  useEffect(() => { if (!big) return; const t = setTimeout(() => setSettled(s), 700); return () => clearTimeout(t) }, [s, big])
  return big && settled?.path === s?.path ? settled : deferred
}

let worker: Worker | null = null, asked = 0
/** The counts of the file's text: a big file's from the worker, none until it answers. */
function useCounts(path: string, body: string, text: boolean, code: boolean, nb: boolean): Counts | null {
  const big = body.length > BIG
  const now = useMemo(() => (text && !big ? countText(body, code, nb) : null), [body, text, big, code, nb])
  const [late, setLate] = useState<{ path: string; counts: Counts } | null>(null)
  useEffect(() => {
    if (!text || !big) return
    const w = worker ??= new Worker(new URL("../core/counts.worker.ts", import.meta.url), { type: "module" })
    const id = ++asked
    const on = (e: MessageEvent<{ id: number; counts: Counts }>) => { if (e.data.id === id) setLate({ path, counts: e.data.counts }) }
    w.addEventListener("message", on)
    w.postMessage({ id, body, code, nb })
    return () => w.removeEventListener("message", on)
  }, [path, body, text, big, code, nb])
  return !text ? null : big ? (late?.path === path ? late.counts : null) : now
}

/** The bar's counts, which never narrow while one file is open: as you type, what's left of them stays put. */
function Steady({ reset, children }: { reset: string; children: ReactNode }) {
  const ref = useRef<HTMLSpanElement>(null), widest = useRef({ reset, w: 0 })
  useLayoutEffect(() => {
    const el = ref.current!
    // (a bar too narrow drops parts of it: no keeping their room then)
    if (el.closest("[data-cramped]")) { widest.current.w = 0; el.style.minWidth = ""; return }
    if (widest.current.reset !== reset) { widest.current = { reset, w: 0 }; el.style.minWidth = "" }
    widest.current.w = Math.max(widest.current.w, el.getBoundingClientRect().width)
    el.style.minWidth = `${widest.current.w}px`
  })
  return <span ref={ref} data-steady className="flex items-center justify-end gap-2 empty:hidden">{children}</span>
}
