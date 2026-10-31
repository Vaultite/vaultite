// The status bar (desktop): ambient items and the focused file's (usePublish) in two corners, as in Vim: left the user's
// (Vim's mode, the companion), right the file's. Hidden by right-click or the palette, dragged between them (core/statusbar.ts).
import { memo, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode, type RefObject } from "react"
import { Ellipsis, PanelBottom } from "lucide-react"
import { checklist, menuAbove, menuFor } from "@/components/ContextMenu"
import { Catch, Drawn } from "@/components/Guard"
import { MODES, status_, statusSubs, viewItems, VIEWS, type Mode } from "@/components/fileState"
import { useCommands } from "@/core/commands"
import { countText, type Counts } from "@/core/counts"
import { numberText } from "@/core/data"
import type { FileHead, OpenFile, StatusItem } from "@/core/define"
import { startDrag, useDrag, useDropHit, useDropTarget } from "@/core/drag"
import { joinFm } from "@/core/files"
import { kindOf } from "@/core/filekinds"
import { usePluginsVersion, vaultPluginsIn } from "@/core/plugins"
import { useFileTab } from "@/core/workspace"
import { getPrefs, usePrefs } from "@/core/prefs"
import { barShown, barShows, type BarItem, type BarPlace, moveBarItem, showAllBarItems, showBarItem } from "@/core/statusbar"
import { INCOMING, reorder, slotAt, useSlide } from "@/core/slide"
import { cn } from "@/lib/utils"

/** Past this, a file's counts and plugins' items wait for typing to pause: a long note's (100 KB) words and tokens took
 *  ~20 ms a keystroke. */
const LONG = 32 * 1024
/** Past this, the counts are made in a worker: a 16 MB note's take seconds. */
const BIG = 1 << 20
/** The right corner and its tray stop short of the left corner (`--status-left`, its width) and the left sidebar; the
 *  left corner takes at most half the room. */
const MAX_WIDTH = "calc(100vw - var(--left-sidebar, 0px) - var(--right-sidebar, 0px) - var(--status-left, 0px) - 12px)"
const LEFT_MAX_WIDTH = "calc((100vw - var(--left-sidebar, 0px) - var(--right-sidebar, 0px)) / 2 - 6px)"

/** Right-click on the bar: which items it shows (a hidden one ticked again goes back to its default place). */
const barMenu = () => {
  const { disabled, statusBar } = getPrefs()
  const { all, shown } = barShown(disabled, statusBar)
  const item = (x: BarItem) => ({ key: x.key, label: x.title }), off = all.filter((x) => !shown.includes(x))
  return [
    ...checklist("status-bar", { on: shown.map(item), off: [off.filter((x) => x.ambient).map(item), off.filter((x) => !x.ambient).map(item)],
      set: (key, on, before) => showBarItem(key, on, before ?? undefined) }),
    ...(off.length ? [{ label: "Show all", sep: true, run: showAllBarItems }] : []),
  ]
}

/** Where an item dropped would go: before `before` in the bar's order (null: last), and the bar's or the tray's `order`
 *  that leaves, which it makes way for (core/slide.ts; none: onto the more button). */
type Gap = { before: string | null; order?: string[] }

/** What the bar leaves out to the tray to stop short of the left sidebar, least needed (`data-fit`) and widest first, then
 *  back what fits again. Each pass starts from everything, before a paint. Returns those in the tray. */
function useFit(bar: RefObject<HTMLElement | null>, keys: string[], pinned: boolean) {
  const [over, setOver] = useState<string[]>([])
  const run = useRef(() => {})
  run.current = () => {
    const b = bar.current
    if (!b?.offsetWidth) return
    // (the gap an item dragged in from the tray opens isn't taken yet: measured without it)
    const coming = b.querySelector<HTMLElement>(`[data-slide="${INCOMING}"]`)
    if (coming) coming.style.display = "none"
    const out = (els: Iterable<Element>, gone = true) => { for (const el of els) el.toggleAttribute("data-fit-out", gone) }
    // (by its parts' laid-out widths: items making way for a drag are moved, and moved ones overflow it)
    const gap = parseFloat(getComputedStyle(b).columnGap) || 0
    const fits = () => {
      const parts = [...b.children].filter((el) => (el as HTMLElement).offsetWidth) as HTMLElement[]
      return parts.reduce((w, el) => w + el.offsetWidth, 0) + gap * Math.max(0, parts.length - 1) <= b.clientWidth + 0.5
    }
    out(b.querySelectorAll("[data-fit-out]"), false)
    const more = b.querySelector<HTMLElement>("[data-status-more]")
    if (more && !("pinned" in more.dataset)) out([more])
    if (!fits()) {
      // (the counts' held room goes first: none is kept while the bar is cramped)
      b.dataset.cramped = ""
      for (const el of b.querySelectorAll<HTMLElement>("[data-steady]")) el.style.minWidth = ""
      const slots = [...b.querySelectorAll<HTMLElement>("[data-status-key], [data-status-coming]")]
        .map((el) => ({ el, rank: Number(el.dataset.fit) || 5, w: el.getBoundingClientRect().width })).filter((x) => x.w)
        .sort((p, q) => p.rank - q.rank || q.w - p.w)
      if (more) out([more], false)
      const gone: HTMLElement[] = []
      for (const { el } of slots) { if (fits()) break; out([el]); gone.push(el) }
      for (const el of gone.toReversed()) { out([el], false); if (!fits()) out([el]) }
      if (more && !("pinned" in more.dataset) && !gone.some((el) => el.dataset.statusKey && el.hasAttribute("data-fit-out"))) out([more])
    } else delete b.dataset.cramped
    if (coming) coming.style.display = ""
    const left = [...b.querySelectorAll<HTMLElement>("[data-status-key][data-fit-out]")].map((el) => el.dataset.statusKey!)
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
    const ro = new ResizeObserver(soon), watch = () => { ro.observe(b); for (const el of b.querySelectorAll("[data-status-key], [data-status-items]")) ro.observe(el) }
    // (an element coming or going, not a count's text: that changes a size, which the observer sees)
    const mo = new MutationObserver((rs) => { if (rs.some((r) => [...r.addedNodes, ...r.removedNodes].some((n) => n.nodeType === 1))) { watch(); soon() } })
    watch()
    mo.observe(b, { childList: true, subtree: true })
    addEventListener("resize", soon)
    return () => { ro.disconnect(); mo.disconnect(); cancelAnimationFrame(frame); removeEventListener("resize", soon) }
  }, [bar])
  return over
}

const KEPT_ITEMS = "vaultite.statusbar.items", KEPT_SETUP = "vaultite.statusbar.setup"
/** The more button's entry among the kept widths (a file's, as what fills its tray is): shown last load, it shows
 *  while the file's items come. */
const MORE = "core:more"
/** How long at most the app's load holds the bar's room for what's still to come. */
const LOAD_HOLD = 8000
/** The items' widths at the last load, in the bar's order; a file's own marked (older loads': unknown, so held). */
type Kept = [key: string, width: number, file?: 1][]
/** Last load's room, held while the app loads so nothing moves: each item's until it draws (a file's until the file
 *  comes). Ends for good at another file, a new `setup` (a bundle) or LOAD_HOLD. Null: nothing held. */
function useLoadHolds(bars: RefObject<HTMLElement | null>[], rows: RefObject<HTMLElement | null>[], path: string, setup: string): Kept | null {
  const [drawn, redraw] = useState(0)
  const st = useRef<{ kept: Kept; setup: string; first: string | null; done: boolean; drawn: Set<string> } | null>(null)
  if (!st.current) {
    let kept: Kept = [], saved = ""
    try {
      const k = JSON.parse(localStorage.getItem(KEPT_ITEMS) ?? "[]")
      kept = Array.isArray(k) ? k : []
      saved = localStorage.getItem(KEPT_SETUP) ?? ""
    } catch { /* none */ }
    st.current = { kept, setup: saved, first: null, done: false, drawn: new Set() }
  }
  const h = st.current
  if (h.first === null && path) h.first = path
  if ((h.first !== null && path !== h.first) || setup !== h.setup) h.done = true
  useEffect(() => {
    if (h.done) return
    const t = setTimeout(() => { h.done = true; redraw((n) => n + 1) }, LOAD_HOLD)
    // An item lets go of its room once it draws.
    const rs = rows.flatMap((r) => (r.current ? [r.current] : [])), mo = new MutationObserver(() => {
      const now = h.kept.filter(([k]) => !h.drawn.has(k) && rs.some((r) => r.querySelector(`[data-status-key="${CSS.escape(k)}"]:not(:empty)`)))
      if (!now.length) return
      for (const [k] of now) h.drawn.add(k)
      redraw((n) => n + 1)
    })
    for (const r of rs) mo.observe(r, { childList: true, subtree: true, characterData: true })
    return () => { clearTimeout(t); mo.disconnect() }
  }, [h, h.done]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const els = bars.flatMap((b) => (b.current ? [b.current] : [])), rs = rows.flatMap((r) => (r.current ? [r.current] : []))
    if (!els.length || !rs.length) return
    let saving: ReturnType<typeof setTimeout> | undefined
    const save = () => {
      clearTimeout(saving)
      saving = setTimeout(() => {
        // (not before the vault's plugins came: their items aren't drawn yet)
        if (!vaultPluginsIn()) return save()
        // (as drawn without what's held: an item drawing nothing is kept as 0, holding no room)
        const slots = rs.flatMap((r) => [...r.querySelectorAll<HTMLElement>("[data-status-key]")]), mins = slots.map((x) => x.style.minWidth)
        for (const x of slots) x.style.minWidth = ""
        const items: Kept = slots.map((x) => {
          const w = x.matches(":empty") ? 0 : x.getBoundingClientRect().width
          return x.hasAttribute("data-ambient") ? [x.dataset.statusKey!, w] : [x.dataset.statusKey!, w, 1]
        })
        slots.forEach((x, i) => { x.style.minWidth = mins[i] })
        const more = els.map((b) => b.querySelector<HTMLElement>("[data-status-more]")).find((m) => m?.offsetWidth)
        if (more) items.push([MORE, more.getBoundingClientRect().width, 1])
        try {
          localStorage.setItem(KEPT_ITEMS, JSON.stringify(items))
          localStorage.setItem(KEPT_SETUP, setup)
          localStorage.removeItem("vaultite.statusbar.file")
        } catch { /* full */ }
      }, 2000)
    }
    const ro = new ResizeObserver(save)
    for (const c of [...els, ...rs]) ro.observe(c)
    save()
    return () => { clearTimeout(saving); ro.disconnect() }
  }, [path, setup]) // eslint-disable-line react-hooks/exhaustive-deps
  // (the same list until an item draws: the bar's items are drawn again only when it changes)
  return useMemo(() => (h.done ? null : h.kept.filter(([k]) => !h.drawn.has(k))), [h, h.done, drawn])
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

/** Which items the bar leaves out first when it's cramped (useFit), low first. */
const fitRank = (x: BarItem) => (x.key === "core:characters" ? 1 : x.ambient ? 2 : x.key === "core:words" ? 3 : x.status && !x.status.after ? 4 : 5)
/** Whose room never narrows while one file is open (useSteady): the counts, and plugins' items after them. */
const steady = (x: BarItem) => x.key === "core:words" || x.key === "core:characters" || !!x.status?.after

export function StatusBar() {
  const s = statusSubs.use(() => status_)
  const { disabled, enabled, statusBar, statusBarMore, statusBarLeft, density, interfaceFont, snippets } = usePrefs()
  // What the bar's width depends on but the file: a change lets go of the widths held for the setup before.
  const setup = JSON.stringify([statusBar, statusBarMore, statusBarLeft, disabled, enabled, density, interfaceFont, snippets])
  const plugins = usePluginsVersion() // (a vault plugin's code arriving)
  const bar = useMemo(() => barShown(disabled, statusBar, statusBarLeft), [disabled, enabled, statusBar, statusBarLeft, plugins])
  const leftKeys = useMemo(() => new Set(bar.left), [bar])
  useBarCommands(bar.all)
  // Counted after the keystroke is on screen: a long note's count takes a few milliseconds. The file comes late with
  // its text, so a file just opened is never measured (useSteady) with the last one's counts.
  const late = useSettled(s)
  const body = late?.body ?? "", fm = late?.fm ?? ""
  const head = late?.head, path = late?.path ?? ""
  // What plugins' items get: the file as typed (theirs are drawn after the keystroke too).
  const fileHead = useMemo(() => head ?? { path, fm: {}, type: null }, [head, path])
  const fileText = useMemo(() => (head ? joinFm(fm, body) : ""), [head, fm, body])
  const reads = useRef(new Map<string, { text: boolean }>())
  const text = !!late && !late.info && !late.says
  const code = !!late && /^(code|other|notebook)$/.test(kindOf(path))
  const nb = !!late && /\.ipynb$/i.test(path)
  const counts = useCounts(path, body, text, code, nb)
  // (a plugin's item that throws is left out, its error in Errors: the bar is on every desktop tab, so it'd stop the app)
  const item_ = (key: string, draw: () => ReactNode) => <Catch key={key} reset={path} fallback={() => null}><Drawn draw={draw} /></Catch>
  const open = !!s && !!late

  // The items: the tucked ones in the tray, the rest in the bar, but those that don't fit, which the tray shows too.
  // A file's are there only while one is focused.
  const barRef = useRef<HTMLDivElement>(null), rowRef = useRef<HTMLDivElement>(null), itemsRef = useRef<HTMLDivElement>(null), trayRef = useRef<HTMLDivElement>(null)
  const leftRef = useRef<HTMLDivElement>(null), leftRowRef = useRef<HTMLDivElement>(null), leftItemsRef = useRef<HTMLDivElement>(null)
  // (a file's items are held only on a file's tab: on a view or a new tab no file comes, and their room stayed empty)
  const loading = useLoadHolds([barRef, leftRef], [rowRef, leftRowRef], path, setup), fileTab = useFileTab()
  const held = useMemo(() => (fileTab ? loading : loading?.filter(([, , file]) => !file) ?? null), [loading, fileTab])
  const drawable = useMemo(() => bar.shown.filter((x) => x.ambient || open || held?.some(([k, w]) => k === x.key && w > 0)), [bar, open, held])
  const inBar = useMemo(() => drawable.filter((x) => !statusBarMore.includes(x.key)), [drawable, statusBarMore])
  const inLeft = useMemo(() => inBar.filter((x) => leftKeys.has(x.key)), [inBar, leftKeys])
  const inRight = useMemo(() => inBar.filter((x) => !leftKeys.has(x.key)), [inBar, leftKeys])
  const [tray, setTray] = useState(false)
  const dragged = useDrag((d) => d?.item.status)
  // (what the left corner leaves out goes in the right one's tray; its more button shows while one is tucked, dragged or
  // left out of either corner)
  const overLeft = useFit(leftRowRef, inLeft.map((x) => x.key), false)
  // (shown last load, it holds its place until the file's items come and the fit says)
  const moreHeld = !open && !!held?.some(([k]) => k === MORE)
  const pinned = statusBarMore.some((k) => drawable.some((x) => x.key === k)) || !!dragged || overLeft.length > 0 || moreHeld
  const overRight = useFit(rowRef, inRight.map((x) => x.key), pinned)
  const inTray = drawable.filter((x) => statusBarMore.includes(x.key) || overLeft.includes(x.key) || overRight.includes(x.key))
  const { barHit, leftHit, trayHit } = useBarDrops({ barRef, itemsRef, leftRef, leftItemsRef, trayRef }, bar.keys, inTray.map((x) => x.key), statusBarMore)
  useLeftWidth(leftRef, barRef)
  const trayOpen = tray && inTray.length > 0
  useEffect(() => {
    if (!trayOpen) return
    const down = (e: PointerEvent) => { if (!(e.target as Element).closest?.("[data-status-tray], [data-status-more]")) setTray(false) }
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setTray(false) }
    addEventListener("pointerdown", down, true); addEventListener("keydown", key, true)
    return () => { removeEventListener("pointerdown", down, true); removeEventListener("keydown", key, true) }
  }, [trayOpen])
  useSteady(rowRef, `${path}\n${setup}`)

  // What a file's own items draw: the plugins', its view, its counts (all as of the settled file: late).
  const fileDraw = (x: BarItem): ReactNode => {
    if (!s || !late) return null
    const { mode, views, setMode } = late
    if (x.status) {
      const box = reads.current.get(x.key) ?? { text: false }
      reads.current.set(x.key, box)
      return <FileItem key={x.key} item={x.status} head={fileHead} text={fileText} reads={box} />
    }
    const n = (v: number, one: string) => <span>{numberText(v)} {one}{v === 1 ? "" : "s"}</span>
    if (x.key === "core:view") return views.length < 2 ? null : <ViewButton mode={mode} views={views} setMode={setMode} />
    if (x.key === "core:words") {
      return late.info ? late.info.map((v) => <span key={v}>{v}</span>)
        : late.says ? item_("says", () => { const said = late.says!(body); return said && <span>{said}</span> })
        : counts && nb && mode === "read" ? n(counts.cells, "cell")
        : counts && (code ? n(counts.lines, "line") : n(counts.words, "word"))
    }
    return text && counts && !(nb && mode === "read") ? n(counts.chars, "character") : null
  }
  const slot = (x: BarItem, content: ReactNode, place: "bar" | "tray", hold = 0) => (
    <span key={x.key} data-status-key={x.key} data-ambient={x.ambient ? "" : undefined} data-slide={x.key} data-fit={place === "bar" ? fitRank(x) : undefined} data-steady={place === "bar" && steady(x) && !hold ? "" : undefined}
      data-hold={hold ? "" : undefined} onPointerDown={(e) => startDrag(e, { from: "status", status: x.key, label: x.title })}
      style={hold ? { minWidth: hold } : undefined}
      className={cn("flex shrink-0 items-center gap-2", place === "bar" && !x.ambient && "pl-1", !hold && "empty:hidden", steady(x) && "justify-end", dragged === x.key && "opacity-50")}>
      {content}
    </span>
  )
  const holdOf = (k: string) => held?.find(([key]) => key === k)?.[1] ?? 0
  // The ambient items, drawn again only when the bar's own layout changes: none takes the file, so a keystroke redraws
  // none; a file's, with each change to it (a keystroke's own render has the old one).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const ambientSlots = useMemo(() => new Map(inBar.filter((x) => x.ambient).map((x) => [x.key, slot(x, item_(x.key, () => x.ambient!.render()), "bar", holdOf(x.key))])), [inBar, held, dragged, path])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const fileSlots = useMemo(() => new Map(inBar.filter((x) => !x.ambient).map((x) => [x.key, open ? slot(x, fileDraw(x), "bar", holdOf(x.key))
    : <span key={x.key} aria-hidden data-status-coming data-fit={fitRank(x)} className="shrink-0" style={{ width: holdOf(x.key) }} />])), [inBar, held, dragged, open, late, counts, fileHead, fileText])
  // In each corner's row, a line where the ambient items meet the file's (shown only between two that show something:
  // index.css). Those still to come go where they were, in their corner.
  const known = [...bar.all.map((a) => a.key), MORE]
  const row = (items: BarItem[], kept: Kept | null) => {
    const els: ReactNode[] = [], seps: string[] = []
    let kind = ""
    for (const x of withComing(items, kept, known)) {
      const k = "coming" in x || x.ambient ? "ambient" : "file"
      if (kind && k !== kind) {
        seps.push(`sep:${els.length}`)
        els.push(<span key={`sep-${els.length}`} aria-hidden data-status-sep data-slide={`sep:${els.length}`} className="shrink-0 pl-1"><span className="block h-3.5 w-px bg-border" /></span>)
      }
      kind = k
      els.push("coming" in x ? <span key={x.key} aria-hidden data-status-coming className="shrink-0" style={{ width: x.coming }} /> : (k === "ambient" ? ambientSlots : fileSlots).get(x.key))
    }
    return { els, seps }
  }
  const right = row(inRight, held && held.filter(([k]) => !leftKeys.has(k))), left = row(inLeft, held && held.filter(([k]) => leftKeys.has(k)))
  // Dragged over, a corner's items and the tray's make way for the one dragged; its lines go where the kinds meet then
  // (left out, one would give up its room and the items past it would shift).
  const ambient = (key: string) => !!bar.all.find((x) => x.key === (key === INCOMING ? dragged : key))?.ambient
  const withSeps = (hit: Gap | null, seps: string[]) => hit?.order?.flatMap((key, i, all) => (i && ambient(key) !== ambient(all[i - 1]) ? [seps.shift() ?? "", key] : [key])).filter(Boolean) ?? null
  useSlide(itemsRef, withSeps(barHit, [...right.seps]), "x")
  useSlide(leftItemsRef, withSeps(leftHit, [...left.seps]), "x")
  useSlide(trayRef, trayHit?.order ?? null, "wrap")
  const gap = (g: Gap | null) => g?.order?.includes(INCOMING) && <span aria-hidden data-slide={INCOMING} className="h-5 shrink-0" />
  // (always there, the fit showing it: drawn again only when it changes, not on each keystroke)
  const any = drawable.length > 0, ring = !!trayHit && !trayHit.order
  const more = useMemo(() => any && (
    <button type="button" data-status-more data-pinned={pinned || undefined} onClick={() => setTray((t) => !t)} aria-label="More status items" aria-expanded={trayOpen} data-tip="More" data-tip-side="top"
      className={cn("grid size-6 shrink-0 cursor-pointer place-items-center rounded-[5px] hover:bg-foreground/[0.06] hover:text-foreground",
        trayOpen && "bg-foreground/[0.06] text-foreground", ring && "ring-1 ring-primary")}>
      <Ellipsis className="size-3.5" strokeWidth={2.25} />
    </button>
  ), [any, pinned, trayOpen, ring])
  const trayBox = trayOpen && (
    <div ref={trayRef} data-status-tray onClickCapture={() => setTray(false)} style={{ maxWidth: MAX_WIDTH }}
      className="absolute bottom-full left-0 mb-1 flex flex-wrap items-center gap-1 rounded-[8px] border-[0.5px] border-border bg-sidebar p-1 shadow-lg">
      {inTray.map((x) => slot(x, x.ambient ? item_(x.key, () => x.ambient!.render()) : fileDraw(x), "tray"))}
      {gap(trayHit)}
    </div>
  )
  // (a row holds what's in line, so what it leaves out is measured without the tray over it; with nothing to show, the
  // right corner is a faint one to right-click, the left one gone but as a place to drop: index.css)
  return (
    <>
      <div ref={leftRef} role="status" aria-label="Status bar, left" data-status-bar data-status-left data-dragging={dragged ? "" : undefined} data-drop={leftHit ? "" : undefined}
        style={{ maxWidth: LEFT_MAX_WIDTH }} onContextMenu={menuFor(barMenu)}
        className="fixed left-(--left-sidebar,0px) bottom-0 z-20 transition-[left] duration-200 ease-out hidden h-7 items-center rounded-tr-[8px] border-t-[0.5px] border-r-[0.5px] border-border bg-sidebar pr-2 pl-1 text-[12px] whitespace-nowrap text-muted-foreground tabular-nums md:flex">
        <div ref={leftRowRef} data-status-row className="flex min-w-0 items-center gap-2">
          <div ref={leftItemsRef} data-status-items className="relative flex h-6 shrink-0 items-center gap-1">
            {left.els}
            {gap(leftHit)}
          </div>
        </div>
      </div>
      <div ref={barRef} role="status" aria-label="Status bar" data-status-bar style={{ maxWidth: MAX_WIDTH }} onContextMenu={menuFor(barMenu)}
        className="fixed right-(--right-sidebar,0px) bottom-0 z-20 transition-[right] duration-200 ease-out hidden h-7 items-center rounded-tl-[8px] border-t-[0.5px] border-l-[0.5px] border-border bg-sidebar pr-3 pl-1 text-[12px] whitespace-nowrap text-muted-foreground tabular-nums md:flex">
        <div ref={rowRef} data-status-row className="flex min-w-0 items-center gap-2">
          {more}
          <div ref={itemsRef} data-status-items className="relative flex h-6 shrink-0 items-center gap-1">
            {right.els}
            {gap(barHit)}
          </div>
        </div>
        {trayBox}
      </div>
    </>
  )
}

/** The left corner's width on the right one (`--status-left`), which stops short of it: set as the page lays itself out,
 *  never drawn again for it. */
function useLeftWidth(left: RefObject<HTMLElement | null>, right: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const l = left.current, r = right.current
    if (!l || !r) return
    const set = (w: number) => r.style.setProperty("--status-left", `${Math.ceil(w)}px`)
    set(l.getBoundingClientRect().width)
    const ro = new ResizeObserver(([e]) => set(e.borderBoxSize[0]?.inlineSize ?? 0))
    ro.observe(l)
    return () => ro.disconnect()
  }, [left, right])
}

/** Each item's palette commands: show or hide it, and show them all. */
function useBarCommands(all: BarItem[]) {
  useCommands(() => [
    ...all.map((x) => ({
      id: `status-bar:${x.key}`, name: `Show in status bar: ${x.title}`, nameWhenOn: `Hide from status bar: ${x.title}`, desktop: true,
      run: () => showBarItem(x.key, !barShows(x.key)), icon: PanelBottom, on: () => barShows(x.key),
    })),
    { id: "status-bar:show-all", name: "Show all status bar items", desktop: true, run: showAllBarItems, icon: PanelBottom,
      when: () => { const { disabled, statusBar } = getPrefs(), b = barShown(disabled, statusBar); return b.shown.length < b.all.length } },
  ], [all.map((x) => `${x.key}\t${x.title}`).join("\n")])
}

type Refs = Record<"barRef" | "itemsRef" | "leftRef" | "leftItemsRef" | "trayRef", RefObject<HTMLElement | null>>

/** The bar's corners and its tray (with the more button) as drop targets for its items: in a corner, where it lands
 *  among them; in the tray or onto the button, tucked there (onto the button: last). */
function useBarDrops({ barRef, itemsRef, leftRef, leftItemsRef, trayRef }: Refs, keys: string[], trayKeys: string[], tucked: string[]) {
  // A drop after the tray's last item goes before what follows that one in the bar's order.
  const afterTray = (key: string) => {
    const rest = keys.filter((k) => k !== key), end = trayKeys.filter((k) => k !== key).at(-1)
    return end ? rest[rest.indexOf(end) + 1] ?? null : rest[0] ?? null
  }
  const slots = (box: HTMLElement) => [...box.querySelectorAll<HTMLElement>(":scope > [data-status-key]")].filter((el) => el.offsetWidth)
  // A corner: over it, or just past its open end (it grows that way for the one dragged in).
  const corner = (side: "left" | "right") => (item: { status?: string }, x: number, y: number, el: Element | null): Gap | null => {
    const bar = (side === "left" ? leftRef : barRef).current, box = (side === "left" ? leftItemsRef : itemsRef).current
    if (!item.status || !bar || !box || el?.closest("[data-status-tray], [data-status-more]")) return null
    const b = bar.getBoundingClientRect(), f = box.getBoundingClientRect()
    if (side === "right" ? x < f.left - 24 || x > b.right : x < b.left || x > Math.max(b.right, f.right + 24)) return null
    if (y < b.top - 24 || y > b.bottom) return null
    // (measured without the gap one from elsewhere opens: the corner grows for it, so its items would move under a still
    // pointer and the slot be the next one)
    const coming = box.querySelector<HTMLElement>(`:scope > [data-slide="${INCOMING}"]`)
    if (coming) coming.style.display = "none"
    const at = slots(box), { order, before, same } = reorder(at.map((el) => el.dataset.statusKey!), [item.status], slotAt(box, at, x, y, "x"))
    if (coming) coming.style.display = ""
    // (where it is already: nothing to do; `before` is in the corner's order, so its end is just after its last)
    return same ? null : { before: before ?? afterLast(at.map((el) => el.dataset.statusKey!), item.status), order }
  }
  // The end of a corner: before what follows its last item in the bar's order (the other corner's items don't matter).
  const afterLast = (corner: string[], key: string) => {
    const rest = keys.filter((k) => k !== key), end = corner.filter((k) => k !== key).at(-1)
    return end ? rest[rest.indexOf(end) + 1] ?? null : null
  }
  const drop = (place: BarPlace) => (item: { status?: string }, g: Gap) => moveBarItem(item.status!, g.before, place)
  useDropTarget<Gap>("status:bar", corner("right"), drop("right"))
  useDropTarget<Gap>("status:left", corner("left"), drop("left"))
  useDropTarget<Gap>("status:more", (item, x, y, el) => {
    if (!item.status) return null
    const tray = trayRef.current
    if (tray && el && tray.contains(el)) {
      const at = slots(tray), { order, before, same } = reorder(at.map((el) => el.dataset.statusKey!), [item.status], slotAt(tray, at, x, y, "wrap"))
      // (tucked there already, in its place: nothing to do; one there because the bar is full is tucked for good)
      return same && tucked.includes(item.status) ? null : { before: before ?? afterTray(item.status), order }
    }
    return el?.closest("[data-status-more]") ? { before: afterTray(item.status) } : null
  }, drop("tray"))
  return { barHit: useDropHit<Gap>("status:bar"), leftHit: useDropHit<Gap>("status:left"), trayHit: useDropHit<Gap>("status:more") }
}

/** The file's view; clicked, its views (three, or reading and source), the current one checked. */
const ViewButton = memo(function ViewButton({ mode, views, setMode }: { mode: Mode; views: typeof VIEWS; setMode: (m: Mode) => void }) {
  const cur = MODES[mode], tip = `Current view: ${VIEWS.find((v) => v.value === mode)!.label.toLowerCase()}`
  const menu = (e: MouseEvent) => menuAbove(e, viewItems(views, mode, setMode))
  return (
    <button type="button" onClick={menu} aria-label={`${tip}. Change view`} aria-haspopup="menu" data-tip={tip} data-tip-side="top"
      className="grid size-6 shrink-0 cursor-pointer place-items-center rounded-[5px] hover:bg-foreground/[0.06] hover:text-foreground">
      <cur.icon className="size-3.5" strokeWidth={2.25} />
    </button>
  )
})

/** A plugin's item for the file, drawn again as the text changes only once it has read it (`file.text`): most read only
 *  the file's head (its properties, where it came from). */
const FileItem = memo(function FileItem({ item, head, text, reads }: { item: StatusItem; head: FileHead; text: string; reads: { text: boolean } }) {
  const file = useMemo(() => Object.defineProperty({ ...head }, "text", { enumerable: true, get: () => { reads.text = true; return text } }) as OpenFile, [head, text, reads])
  return <Catch reset={head.path} fallback={() => null}><Drawn draw={() => item.render(file)} /></Catch>
}, (a, b) => a.item === b.item && a.head === b.head && a.reads === b.reads && (a.text === b.text || !b.reads.text))

/** The file as it is, a moment after each keystroke; a long one's once typing pauses (another file's at once). */
function useSettled(s: typeof status_) {
  const deferred = useDeferredValue(s)
  const long = (s?.body.length ?? 0) > LONG
  const [settled, setSettled] = useState(s)
  useEffect(() => { if (!long) return; const t = setTimeout(() => setSettled(s), 500); return () => clearTimeout(t) }, [s, long])
  return long && settled?.path === s?.path ? settled : deferred
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

/** The steady items' room (`data-steady`), which never narrows while one file is open: as you type, what's left of
 *  them stays put. None kept while the bar is cramped (useFit). */
function useSteady(row: RefObject<HTMLElement | null>, reset: string) {
  const widest = useRef(new Map<string, number>())
  const watched = useRef(new Set<HTMLElement>())
  // (measured as the page lays itself out, not by asking: a keystroke's redraw forces no layout)
  const [ro] = useState(() => new ResizeObserver((entries) => {
    if (row.current?.hasAttribute("data-cramped")) return
    for (const e of entries) {
      const el = e.target as HTMLElement, k = el.dataset.statusKey!, w = e.borderBoxSize[0]?.inlineSize ?? 0
      if (w > (widest.current.get(k) ?? 0)) { widest.current.set(k, w); el.style.minWidth = `${w}px` }
    }
  }))
  useEffect(() => () => ro.disconnect(), [ro])
  const was = useRef("")
  useLayoutEffect(() => {
    const r = row.current
    if (!r) return
    // Another file or setup, or cramped (or no longer): the room let go of, measured again.
    const now = `${reset}\n${r.hasAttribute("data-cramped")}`, fresh = now !== was.current
    was.current = now
    if (fresh) widest.current.clear()
    const els = new Set(r.querySelectorAll<HTMLElement>("[data-steady]"))
    for (const el of watched.current) if (!els.has(el)) { ro.unobserve(el); watched.current.delete(el) }
    for (const el of els) {
      if (fresh) { el.style.minWidth = ""; ro.unobserve(el) }
      ro.observe(el)
      watched.current.add(el)
    }
  })
}
