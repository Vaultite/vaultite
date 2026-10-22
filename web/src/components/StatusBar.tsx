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
import { INCOMING, reorder, slotAt, useSlide } from "@/core/slide"
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

/** Where an item dropped would go: before `before` in the bar's order (null: last), and the bar's or the tray's `order`
 *  that leaves, which it makes way for (core/slide.ts; none: onto the more button). */
type Gap = { before: string | null; order?: string[] }

/** What the bar leaves out to stop short of the left sidebar, least needed first: characters, ambient items (the widest
 *  first, to the tray), words, plugins' items. Each pass starts from everything, before a paint. Returns those in the tray. */
function useFit(bar: RefObject<HTMLElement | null>, fit: RefObject<HTMLElement | null>, keys: string[], pinned: boolean) {
  const [over, setOver] = useState<string[]>([])
  const run = useRef(() => {})
  run.current = () => {
    const b = bar.current
    if (!b?.offsetWidth) return
    // (the gap an item dragged in from the tray opens isn't taken yet: measured without it)
    const coming = b.querySelector<HTMLElement>(`[data-slide="${INCOMING}"]`)
    if (coming) coming.style.display = "none"
    const out = (els: Iterable<Element>, gone = true) => { for (const el of els) el.toggleAttribute("data-fit-out", gone) }
    const fits = () => b.scrollWidth <= b.clientWidth + 0.5
    const drop = (n: number) => b.querySelectorAll(`[data-drop="${n}"]`)
    out(b.querySelectorAll("[data-fit-out]"), false)
    const more = b.querySelector<HTMLElement>("[data-status-more]")
    if (more && !("pinned" in more.dataset)) out([more])
    const left: string[] = []
    if (!fits()) {
      // (the counts' held room goes first: Steady keeps none while the bar is cramped)
      b.dataset.cramped = ""
      const steady = b.querySelector<HTMLElement>("[data-steady]")
      if (steady) steady.style.minWidth = ""
      if (!fits()) out(drop(1))
      const f = fit.current, slots = f ? [...f.querySelectorAll<HTMLElement>(":scope > [data-status-key], :scope > [data-status-coming]")] : []
      if (!fits() && f && slots.length) {
        if (more) out([more], false)
        const gap = parseFloat(getComputedStyle(f).columnGap) || 0
        const room = f.offsetWidth - (b.scrollWidth - b.clientWidth)
        const sized = slots.map((el) => ({ el, w: el.getBoundingClientRect().width })).filter((x) => x.w)
        let used = sized.reduce((n, x, i) => n + x.w + (i ? gap : 0), 0)
        for (const x of sized.toSorted((p, q) => q.w - p.w)) {
          if (used <= room + 0.5) break
          used -= x.w + (used > x.w ? gap : 0)
          out([x.el])
        }
        for (const { el } of sized) if (el.dataset.statusKey && el.hasAttribute("data-fit-out")) left.push(el.dataset.statusKey)
        // (the characters back into what room the tray left)
        out(drop(1), false)
        if (!fits()) out(drop(1))
      }
      for (const n of [2, 3]) if (!fits()) out(drop(n))
    } else delete b.dataset.cramped
    if (coming) coming.style.display = ""
    setOver((was) => (was.join() === left.join() ? was : left))
  }
  const joined = keys.join()
  // (when its items change, before the paint; their sizes changing is the observer's: measuring on every render forced
  // the whole app's layout each time, seconds of it while the app loads)
  useLayoutEffect(() => run.current(), [joined, pinned])
  useEffect(() => {
    const b = bar.current
    if (!b) return
    let frame = 0
    const soon = () => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; run.current() }) }
    // (its parts come and go with the file and the plugins: each watched as it comes)
    const ro = new ResizeObserver(soon), watch = () => { ro.observe(b); for (const el of b.querySelectorAll("[data-status-key], [data-steady], [data-drop], [data-status-file]")) ro.observe(el) }
    // (an element coming or going, not a count's text: that changes a size, which the observer sees)
    const mo = new MutationObserver((rs) => { if (rs.some((r) => [...r.addedNodes, ...r.removedNodes].some((n) => n.nodeType === 1))) { watch(); soon() } })
    watch()
    mo.observe(b, { childList: true, subtree: true })
    addEventListener("resize", soon)
    return () => { ro.disconnect(); mo.disconnect(); cancelAnimationFrame(frame); removeEventListener("resize", soon) }
  }, [bar, fit])
  return over
}

const KEPT_ITEMS = "vaultite.statusbar.items", KEPT_FILE = "vaultite.statusbar.file", KEPT_SETUP = "vaultite.statusbar.setup"
/** How long at most the app's load holds the bar's room for what's still to come. */
const LOAD_HOLD = 8000
/** The ambient items' widths at the last load, in the bar's order. */
type Kept = [key: string, width: number][]
type Holds = { items: Kept; file: number }
/** Last load's room, held while the app loads so nothing moves: each ambient item's until it draws, the file's part's
 *  until the file comes. Ends for good at another file, a new `setup` (a bundle) or LOAD_HOLD. Null: nothing held. */
function useLoadHolds(bar: RefObject<HTMLElement | null>, fit: RefObject<HTMLElement | null>, path: string, setup: string): Holds | null {
  const [drawn, redraw] = useState(0)
  const st = useRef<{ kept: Kept; file: number; setup: string; first: string | null; done: boolean; drawn: Set<string> } | null>(null)
  if (!st.current) {
    let kept: Kept = [], file = 0, saved = ""
    try {
      const k = JSON.parse(localStorage.getItem(KEPT_ITEMS) ?? "[]")
      kept = Array.isArray(k) ? k : []
      file = Number(localStorage.getItem(KEPT_FILE)) || 0
      saved = localStorage.getItem(KEPT_SETUP) ?? ""
    } catch { /* none */ }
    st.current = { kept, file, setup: saved, first: null, done: false, drawn: new Set() }
  }
  const h = st.current
  if (h.first === null && path) h.first = path
  if ((h.first !== null && path !== h.first) || setup !== h.setup) h.done = true
  useEffect(() => {
    if (h.done) return
    const t = setTimeout(() => { h.done = true; redraw((n) => n + 1) }, LOAD_HOLD)
    // An item lets go of its room once it draws.
    const f = fit.current, mo = f && new MutationObserver(() => {
      const now = h.kept.filter(([k]) => !h.drawn.has(k) && f.querySelector(`:scope > [data-status-key="${CSS.escape(k)}"]:not(:empty)`))
      if (!now.length) return
      for (const [k] of now) h.drawn.add(k)
      redraw((n) => n + 1)
    })
    mo?.observe(f!, { childList: true, subtree: true, characterData: true })
    return () => { clearTimeout(t); mo?.disconnect() }
  }, [fit, h, h.done])
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
        const part = el.querySelector<HTMLElement>("[data-status-file]"), steady = el.querySelector<HTMLElement>("[data-steady]")
        const held = [...slots, ...(steady ? [steady] : [])], mins = held.map((x) => x.style.minWidth)
        for (const x of held) x.style.minWidth = ""
        const items: Kept = slots.map((x) => [x.dataset.statusKey!, x.matches(":empty") ? 0 : x.getBoundingClientRect().width])
        const file = part?.getBoundingClientRect().width ?? 0
        held.forEach((x, i) => { x.style.minWidth = mins[i] })
        try {
          localStorage.setItem(KEPT_ITEMS, JSON.stringify(items))
          localStorage.setItem(KEPT_FILE, String(file))
          localStorage.setItem(KEPT_SETUP, setup)
          localStorage.removeItem("vaultite.statusbar")
        } catch { /* full */ }
      }, 2000)
    }
    const ro = new ResizeObserver(save)
    for (const c of [el, ...el.children]) ro.observe(c)
    save()
    return () => { clearTimeout(saving); ro.disconnect() }
  }, [bar, path, setup])
  // (the same object until an item draws: the bar's items are drawn again only when it changes)
  return useMemo(() => (h.done ? null : { items: h.kept.filter(([k]) => !h.drawn.has(k)), file: h.file }), [h, h.done, drawn])
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
  const { disabled, order, enabled, statusBar, statusBarMore, density, interfaceFont, snippets } = usePrefs()
  // What the bar's width depends on but the file: a change lets go of the widths held for the setup before.
  const setup = JSON.stringify([statusBar, statusBarMore, disabled, enabled, density, interfaceFont, snippets])
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
  const inBar = useMemo(() => ambient.filter((x) => !statusBarMore.includes(x.key)), [ambient, statusBarMore])
  const rowRef = useRef<HTMLDivElement>(null)
  const holds = useLoadHolds(barRef, fitRef, path, setup)
  const [tray, setTray] = useState(false)
  const d = useDrag(), dragged = d?.item.status
  // (the more button shows while one is tucked or dragged, else only when the fit leaves one out)
  const pinned = statusBarMore.some((k) => ambient.some((x) => x.key === k)) || !!dragged
  const over = useFit(rowRef, fitRef, inBar.map((x) => x.key), pinned)
  const inTray = ambient.filter((x) => statusBarMore.includes(x.key) || over.includes(x.key))
  const { barHit, trayHit } = useAmbientDrops(barRef, fitRef, trayRef, ambient.map((x) => x.key), inTray.map((x) => x.key), statusBarMore)
  const trayOpen = tray && inTray.length > 0
  useEffect(() => {
    if (!trayOpen) return
    const down = (e: PointerEvent) => { if (!(e.target as Element).closest?.("[data-status-tray], [data-status-more]")) setTray(false) }
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setTray(false) }
    addEventListener("pointerdown", down, true); addEventListener("keydown", key, true)
    return () => { removeEventListener("pointerdown", down, true); removeEventListener("keydown", key, true) }
  }, [trayOpen])
  const slot = (key: string, item: (typeof ambient)[number]["item"], hold = 0) => (
    <span key={key} data-status-key={key} data-slide={key} onPointerDown={(e) => startDrag(e, { from: "status", status: key, label: item.title })}
      style={hold ? { minWidth: hold } : undefined}
      className={cn("flex shrink-0 items-center", !hold && "empty:hidden", dragged === key && "opacity-50")}>
      {item_(key, () => item.render())}
    </span>
  )
  const held = holds?.items ?? null
  // Drawn again only when the bar's own layout changes: none of them takes the file, so a keystroke redraws none.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const inBarSlots = useMemo(() => withComing(inBar, held, ambient.map((x) => x.key)).map((x) => "coming" in x
    ? <span key={x.key} aria-hidden data-status-coming className="shrink-0" style={{ width: x.coming }} />
    : slot(x.key, x.item, held?.find(([k]) => k === x.key)?.[1])), [inBar, held, ambient, dragged, path])
  // Dragged over, the bar's items and the tray's make way for the one dragged.
  useSlide(fitRef, barHit?.order ?? null, "x")
  useSlide(trayRef, trayHit?.order ?? null, "wrap")
  const gap = (g: Gap | null) => g?.order?.includes(INCOMING) && <span aria-hidden data-slide={INCOMING} className="h-5 shrink-0" />
  // (always there, the fit showing it: drawn again only when it changes, not on each keystroke)
  const any = ambient.length > 0, ring = !!trayHit && !trayHit.order
  const more = useMemo(() => any && (
    <button type="button" data-status-more data-pinned={pinned || undefined} onClick={() => setTray((t) => !t)} aria-label="More status items" aria-expanded={trayOpen} data-tip="More" data-tip-side="top"
      className={cn("grid size-6 shrink-0 cursor-pointer place-items-center rounded-[5px] hover:bg-foreground/[0.06] hover:text-foreground",
        trayOpen && "bg-foreground/[0.06] text-foreground", ring && "ring-1 ring-primary")}>
      <Ellipsis className="size-3.5" strokeWidth={2.25} />
    </button>
  ), [any, pinned, trayOpen, ring])
  // While the app loads, the file's part keeps last load's room until the file comes (useLoadHolds).
  const fileComing = !late && !!holds?.file
  const own = ambient.length > 0 && <>
    {more}
    <div ref={fitRef} data-ambient className="relative flex shrink-0 items-center gap-1">
      {inBarSlots}
      {gap(barHit)}
    </div>
    {(s || fileComing) && <span aria-hidden className="h-3.5 w-px shrink-0 bg-border" />}
  </>
  const trayBox = trayOpen && (
    <div ref={trayRef} data-status-tray onClickCapture={() => setTray(false)} style={{ maxWidth: MAX_WIDTH }}
      className="absolute bottom-full left-0 mb-1 flex flex-wrap items-center gap-1 rounded-[8px] border-[0.5px] border-border bg-sidebar p-1 shadow-lg">
      {inTray.map(({ key, item }) => slot(key, item))}
      {gap(trayHit)}
    </div>
  )
  const bar = "fixed right-(--right-sidebar,0px) bottom-0 z-20 transition-[right] duration-200 ease-out hidden h-7 items-center rounded-tl-[8px] border-t-[0.5px] border-l-[0.5px] border-border bg-sidebar pr-3 pl-1 text-[12px] whitespace-nowrap text-muted-foreground tabular-nums md:flex"
  // (its row holds what's in line, so what it leaves out is measured without the tray over it)
  const wrap = (children: ReactNode) => (
    <div ref={barRef} role="status" data-status-bar className={bar} style={{ maxWidth: MAX_WIDTH }} onContextMenu={menuFor(ambientMenu)}>
      <div ref={rowRef} data-status-row className="flex min-w-0 items-center gap-2">
        {own}
        {children}
      </div>
      {trayBox}
    </div>
  )
  // The plugins' items for the file, drawn again only when it changes (the keystroke's own render has the old one).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const fileItems = useMemo(() => ({
    before: items.filter((x) => !x.item.after).map(({ key, item }) => <span key={key} data-drop="3" className="contents">{item_(key, () => item.render(file))}</span>),
    after: items.filter((x) => x.item.after).map(({ key, item }) => item_(key, () => item.render(file))),
  }), [items, file, path])
  // (the file's part all at once: its view button drawn a frame before the items late brings moved when they came)
  if (!s || !late) return own || fileComing ? wrap(fileComing && <span aria-hidden data-status-coming className="shrink-0" style={{ width: holds!.file }} />) : null
  const cur = MODES[s.mode]
  const tip = `Current view: ${VIEWS.find((v) => v.value === s.mode)!.label.toLowerCase()}`
  // Click or right-click: the file's views (three, or reading and source), the current one checked.
  const menu = (e: MouseEvent) => menuAbove(e, s.views.map((v) => ({ label: v.label, checked: v.value === s.mode, run: () => s.setMode(v.value) })))
  const n = (x: number, one: string) => `${numberText(x)} ${one}${x === 1 ? "" : "s"}`
  return wrap(<span data-status-file className="flex shrink-0 items-center gap-2">
    {fileItems.before}
    {s.views.length > 1 ? (
      <button type="button" onClick={menu} onContextMenu={menu} aria-label={`${tip}. Change view`} aria-haspopup="menu" data-tip={tip} data-tip-side="top"
        className="grid size-6 shrink-0 cursor-pointer place-items-center rounded-[5px] hover:bg-foreground/[0.06] hover:text-foreground">
        <cur.icon className="size-3.5" strokeWidth={2.25} />
      </button>
    ) : <span className="w-1 shrink-0" />}
    <Steady reset={`${path}\n${setup}`}>
      {late?.info ? late.info.map((x) => <span key={x}>{x}</span>)
        : late?.says ? item_("says", () => { const said = late.says!(body); return said && <span>{said}</span> })
        : counts && nb && s.mode === "read" ? <span>{n(counts.cells, "cell")}</span>
        : counts && (code ? <><span data-drop="2">{n(counts.lines, "line")}</span><span data-drop="1">{n(counts.chars, "character")}</span></>
          : <><span data-drop="2">{n(counts.words, "word")}</span><span data-drop="1">{n(counts.chars, "character")}</span></>)}
      {fileItems.after}
    </Steady>
  </span>)
}

/** The bar and its tray (with the more button) as drop targets for ambient items: in the bar, where it lands among them;
 *  in the tray or onto the button, tucked there (onto the button: last). */
function useAmbientDrops(barRef: RefObject<HTMLElement | null>, fitRef: RefObject<HTMLElement | null>, trayRef: RefObject<HTMLElement | null>,
  keys: string[], trayKeys: string[], tucked: string[]) {
  // A drop after the tray's last item goes before what follows that one in the bar's order.
  const afterTray = (key: string) => {
    const rest = keys.filter((k) => k !== key), end = trayKeys.filter((k) => k !== key).at(-1)
    return end ? rest[rest.indexOf(end) + 1] ?? null : rest[0] ?? null
  }
  const slots = (box: HTMLElement) => [...box.querySelectorAll<HTMLElement>(":scope > [data-status-key]")].filter((el) => el.offsetWidth)
  useDropTarget<Gap>("status:bar", (item, x, y, el) => {
    const bar = barRef.current, fit = fitRef.current
    if (!item.status || !bar || !fit || el?.closest("[data-status-tray], [data-status-more]")) return null
    const b = bar.getBoundingClientRect(), f = fit.getBoundingClientRect()
    if (x < f.left - 24 || x > b.right || y < b.top - 24 || y > b.bottom) return null
    const at = slots(fit), { order, before, same } = reorder(at.map((el) => el.dataset.statusKey!), [item.status], slotAt(fit, at, x, y, "x"))
    // (where it is already: nothing to do)
    return same ? null : { before, order }
  }, (item, g) => moveAmbient(item.status!, g.before, false))
  useDropTarget<Gap>("status:more", (item, x, y, el) => {
    if (!item.status) return null
    const tray = trayRef.current
    if (tray && el && tray.contains(el)) {
      const at = slots(tray), { order, before, same } = reorder(at.map((el) => el.dataset.statusKey!), [item.status], slotAt(tray, at, x, y, "wrap"))
      // (tucked there already, in its place: nothing to do; one there because the bar is full is tucked for good)
      return same && tucked.includes(item.status) ? null : { before: before ?? afterTray(item.status), order }
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
  return <span ref={ref} data-steady className="flex shrink-0 items-center justify-end gap-2 empty:hidden">{children}</span>
}
