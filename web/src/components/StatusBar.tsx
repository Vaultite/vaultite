import { memo, startTransition, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode, type RefObject } from "react"
import { Ellipsis, PanelBottom } from "lucide-react"
import { checklist, menuAbove, menuFor } from "@/components/ContextMenu"
import { Catch, Drawn } from "@/components/Guard"
import { MODES, paneStatus, paneStatusSubs, status_, statusSubs, viewItems, VIEWS, type Mode } from "@/components/fileState"
import { columnLeft, columnRight, columnWidth, useColumns, type Column } from "@/components/statusColumns"
import { useCommands } from "@/core/commands"
import { countText, type Counts } from "@/core/counts"
import { numberText } from "@/core/data"
import type { FileHead, OpenFile, StatusItem } from "@/core/define"
import { startDrag, useDrag, useDropHit, useDropTarget } from "@/core/drag"
import { joinFm } from "@/core/files"
import { kindOf } from "@/core/filekinds"
import { usePluginsVersion, vaultPluginsIn } from "@/core/plugins"
import { setFocusedPane, useFileTab } from "@/core/workspace"
import { getPrefs, usePrefs } from "@/core/prefs"
import { trackSoon } from "@/core/unsaved"
import { barShown, barShows, type BarItem, type BarPlace, moveBarItem, showAllBarItems, showBarItem } from "@/core/statusbar"
import { INCOMING, reorder, slotAt, useSlide } from "@/core/slide"
import { cn } from "@/lib/utils"

const WAIT_FOR_PAUSE_PAST = 32 * 1024
const WORKER_PAST = 1 << 20
const MAX_WIDTH = "calc(100vw - var(--left-sidebar, 0px) - var(--right-sidebar, 0px) - var(--status-left, 0px) - 12px - var(--pane-gap, 0px) * 4)"
const LEFT_MAX_WIDTH = "calc((100vw - var(--left-sidebar, 0px) - var(--right-sidebar, 0px)) / 2 - 6px - var(--pane-gap, 0px) * 2)"

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

type Gap = { before: string | null; order?: string[] }

function useFit(bar: RefObject<HTMLElement | null>, keys: string[], pinned: boolean) {
  const [over, setOver] = useState<string[]>([])
  const run = useRef(() => {})
  run.current = () => {
    const b = bar.current
    if (!b?.offsetWidth) return setOver((was) => (was.length ? [] : was))
    const coming = b.querySelector<HTMLElement>(`[data-slide="${INCOMING}"]`)
    if (coming) coming.style.display = "none"
    const out = (els: Iterable<Element>, gone = true) => { for (const el of els) el.toggleAttribute("data-fit-out", gone) }
    const gap = parseFloat(getComputedStyle(b).columnGap) || 0
    const fits = () => {
      const parts = [...b.children].filter((el) => (el as HTMLElement).offsetWidth) as HTMLElement[]
      return parts.reduce((w, el) => w + el.offsetWidth, 0) + gap * Math.max(0, parts.length - 1) <= b.clientWidth + 0.5
    }
    out(b.querySelectorAll("[data-fit-out]"), false)
    const more = b.querySelector<HTMLElement>("[data-status-more]")
    if (more && !("pinned" in more.dataset)) out([more])
    if (!fits()) {
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
  useLayoutEffect(() => run.current(), [joined, pinned])
  useEffect(() => {
    const b = bar.current
    if (!b) return
    let frame = 0
    const soon = () => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; run.current() }) }
    const ro = new ResizeObserver(soon), watch = () => { ro.observe(b); for (const el of b.querySelectorAll("[data-status-key], [data-status-items]")) ro.observe(el) }
    const mo = new MutationObserver((rs) => { if (rs.some((r) => [...r.addedNodes, ...r.removedNodes].some((n) => n.nodeType === 1))) { watch(); soon() } })
    watch()
    mo.observe(b, { childList: true, subtree: true })
    addEventListener("resize", soon)
    return () => { ro.disconnect(); mo.disconnect(); cancelAnimationFrame(frame); removeEventListener("resize", soon) }
  }, [bar])
  return over
}

const KEPT_ITEMS = "vaultite.statusbar.items", KEPT_SETUP = "vaultite.statusbar.setup"
const MORE = "core:more"
const LOAD_HOLD = 8000
type Kept = [key: string, width: number, file?: 1][]
function useLoadHolds(bars: RefObject<HTMLElement | null>[], rows: RefObject<HTMLElement | null>[], path: string, setup: string): Kept | null {
  const [drawn, redraw] = useState(0)
  const st = useRef<{ kept: Kept; setup: string; first: string | null; done: boolean; drawn: Set<string> } | null>(null)
  if (!st.current) {
    let kept: Kept = [], saved = ""
    try {
      const k = JSON.parse(localStorage.getItem(KEPT_ITEMS) ?? "[]")
      kept = Array.isArray(k) ? k : []
      saved = localStorage.getItem(KEPT_SETUP) ?? ""
    } catch {}
    st.current = { kept, setup: saved, first: null, done: false, drawn: new Set() }
  }
  const h = st.current
  if (h.first === null && path) h.first = path
  if ((h.first !== null && path !== h.first) || setup !== h.setup) h.done = true
  useEffect(() => {
    if (h.done) return
    const t = setTimeout(() => { h.done = true; redraw((n) => n + 1) }, LOAD_HOLD)
    const rs = rows.flatMap((r) => (r.current ? [r.current] : [])), mo = new MutationObserver(() => {
      const now = h.kept.filter(([k]) => !h.drawn.has(k) && rs.some((r) => r.querySelector(`[data-status-key="${CSS.escape(k)}"]:not(:empty)`)))
      if (!now.length) return
      for (const [k] of now) h.drawn.add(k)
      redraw((n) => n + 1)
    })
    for (const r of rs) mo.observe(r, { childList: true, subtree: true, characterData: true })
    return () => { clearTimeout(t); mo.disconnect() }
  }, [h, h.done]) // eslint-disable-line react-hooks/exhaustive-deps -- rows are refs
  useEffect(() => {
    const els = bars.flatMap((b) => (b.current ? [b.current] : [])), rs = rows.flatMap((r) => (r.current ? [r.current] : []))
    if (!els.length || !rs.length) return
    let saving: ReturnType<typeof setTimeout> | undefined
    const save = () => {
      clearTimeout(saving)
      saving = setTimeout(() => {
        saving = undefined
        if (!vaultPluginsIn()) return save()
        if (els.some((b) => b.hasAttribute("data-off"))) return
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
        } catch {}
      }, 2000)
    }
    const ro = new ResizeObserver(save)
    for (const c of [...els, ...rs]) ro.observe(c)
    save()
    const off = trackSoon("status bar", () => saving !== undefined, true)
    return () => { off(); clearTimeout(saving); ro.disconnect() }
  }, [path, setup]) // eslint-disable-line react-hooks/exhaustive-deps -- bars and rows are refs
  return useMemo(() => (h.done ? null : h.kept.filter(([k]) => !h.drawn.has(k))), [h, h.done, drawn])
}

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

const fitRank = (x: BarItem) => (x.key === "core:characters" ? 1 : x.ambient ? 2 : x.status && !x.status.after ? 3 : x.key === "core:words" ? 5 : 4)
const steady = (x: BarItem) => x.key === "core:words" || x.key === "core:characters" || !!x.status?.after

export const StatusBar = memo(function StatusBar() {
  const { disabled, enabled, statusBar, statusBarMore, statusBarLeft, density, interfaceFont, snippets } = usePrefs()
  const setup = JSON.stringify([statusBar, statusBarMore, statusBarLeft, disabled, enabled, density, interfaceFont, snippets])
  const plugins = usePluginsVersion()
  const bar = useMemo(() => barShown(disabled, statusBar, statusBarLeft), [disabled, enabled, statusBar, statusBarLeft, plugins])
  const leftKeys = useMemo(() => new Set(bar.left), [bar])
  useBarCommands(bar.all)
  const { cols: footCols, focus: focusCol, focused } = useColumns()
  const cols = footCols.length ? footCols : WHOLE, room = cols.filter((c) => !c.full), off = !room.length
  const settled = useSettled()
  const late = settled && (!settled.pane || settled.pane === focused) && !cols.find((c) => c.pane === focusCol)?.full ? settled : null
  const body = late?.body ?? "", fm = late?.fm ?? ""
  const head = late?.head, path = late?.path ?? ""
  const fileHead = useMemo(() => head ?? { path, fm: {}, type: null }, [head, path])
  const fileText = useMemo(() => (head ? joinFm(fm, body) : ""), [head, fm, body])
  const reads = useRef(new Map<string, { text: boolean }>())
  const text = !!late && !late.info && !late.says
  const code = !!late && /^(code|other|notebook)$/.test(kindOf(path))
  const nb = !!late && /\.ipynb$/i.test(path)
  const counts = useCounts(path, body, text, code, nb)
  const item_ = (key: string, draw: () => ReactNode) => <Catch key={key} reset={path} fallback={() => null}><Drawn draw={draw} /></Catch>
  const open = !!late

  const barRef = useRef<HTMLDivElement>(null), rowRef = useRef<HTMLDivElement>(null), itemsRef = useRef<HTMLDivElement>(null), trayRef = useRef<HTMLDivElement>(null)
  const leftRef = useRef<HTMLDivElement>(null), leftRowRef = useRef<HTMLDivElement>(null), leftItemsRef = useRef<HTMLDivElement>(null)
  const paneRef = useRef<HTMLDivElement>(null), paneRowRef = useRef<HTMLDivElement>(null), paneItemsRef = useRef<HTMLDivElement>(null)
  const first = room[0] ?? cols[0], last = room.at(-1) ?? cols.at(-1)!, fc = room.find((c) => c.pane === focusCol) ?? null
  const apart = !!fc && fc !== last
  const loading = useLoadHolds([barRef, leftRef, paneRef], [rowRef, leftRowRef, paneRowRef], path, setup), fileTab = useFileTab()
  const held = useMemo(() => (fileTab ? loading : loading?.filter(([, , file]) => !file) ?? null), [loading, fileTab])
  const drawable = useMemo(() => bar.shown.filter((x) => x.ambient || open || held?.some(([k, w]) => k === x.key && w > 0)), [bar, open, held])
  const inBar = useMemo(() => drawable.filter((x) => !statusBarMore.includes(x.key)), [drawable, statusBarMore])
  const inLeft = useMemo(() => inBar.filter((x) => leftKeys.has(x.key)), [inBar, leftKeys])
  const inRight = useMemo(() => inBar.filter((x) => !leftKeys.has(x.key) && !(apart && !x.ambient)), [inBar, leftKeys, apart])
  const inPane = useMemo(() => (apart ? inBar.filter((x) => !leftKeys.has(x.key) && !x.ambient) : []), [inBar, leftKeys, apart])
  const [tray, setTray] = useState(false)
  const dragged = useDrag((d) => d?.item.status)
  const overLeft = useFit(leftRowRef, inLeft.map((x) => x.key), false)
  const moreHeld = !open && !!held?.some(([k]) => k === MORE)
  const pinned = statusBarMore.some((k) => drawable.some((x) => x.key === k)) || !!dragged || overLeft.length > 0 || moreHeld
  const moreApart = apart && open
  const overRight = useFit(rowRef, inRight.map((x) => x.key), !moreApart && pinned)
  const overPane = useFit(paneRowRef, inPane.map((x) => x.key), moreApart && (pinned || overRight.length > 0))
  const inTray = drawable.filter((x) => statusBarMore.includes(x.key) || overLeft.includes(x.key) || overRight.includes(x.key) || overPane.includes(x.key))
  const { barHit, leftHit, paneHit, trayHit } = useBarDrops({ barRef, itemsRef, leftRef, leftItemsRef, paneRef, paneItemsRef, trayRef }, bar.keys, inTray.map((x) => x.key), statusBarMore)
  useLeftWidth(leftRef, barRef, paneRef)
  useJumps(paneRef, fc?.pane ?? "")
  const trayOpen = tray && inTray.length > 0
  useEffect(() => {
    if (!trayOpen) return
    const down = (e: PointerEvent) => { if (!(e.target as Element).closest?.("[data-status-tray], [data-status-more]")) setTray(false) }
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setTray(false) }
    addEventListener("pointerdown", down, true); addEventListener("keydown", key, true)
    return () => { removeEventListener("pointerdown", down, true); removeEventListener("keydown", key, true) }
  }, [trayOpen])
  useSteady(rowRef, `${path}\n${setup}`)
  useSteady(paneRowRef, `${path}\n${setup}`)

  const fileDraw = (x: BarItem): ReactNode => {
    if (!late) return null
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
  // eslint-disable-next-line react-hooks/exhaustive-deps -- slot and item_ are new each render; these are what they read
  const ambientSlots = useMemo(() => new Map(inBar.filter((x) => x.ambient).map((x) => [x.key, slot(x, item_(x.key, () => x.ambient!.render()), "bar", holdOf(x.key))])), [inBar, held, dragged, path])
  // eslint-disable-next-line react-hooks/exhaustive-deps -- fileDraw and slot are new each render; these are what they read
  const fileSlots = useMemo(() => new Map(inBar.filter((x) => !x.ambient).map((x) => [x.key, open ? slot(x, fileDraw(x), "bar", holdOf(x.key))
    : <span key={x.key} aria-hidden data-status-coming data-fit={fitRank(x)} className="shrink-0" style={{ width: holdOf(x.key) }} />])), [inBar, held, dragged, open, late, counts, fileHead, fileText])
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
  const right = row(inRight, held && held.filter(([k, , file]) => !leftKeys.has(k) && !(apart && file))), left = row(inLeft, held && held.filter(([k]) => leftKeys.has(k)))
  const mid = row(inPane, apart && held ? held.filter(([k, , file]) => !leftKeys.has(k) && file) : null)
  const ambient = (key: string) => !!bar.all.find((x) => x.key === (key === INCOMING ? dragged : key))?.ambient
  const withSeps = (hit: Gap | null, seps: string[]) => hit?.order?.flatMap((key, i, all) => (i && ambient(key) !== ambient(all[i - 1]) ? [seps.shift() ?? "", key] : [key])).filter(Boolean) ?? null
  useSlide(itemsRef, withSeps(barHit, [...right.seps]), "x")
  useSlide(leftItemsRef, withSeps(leftHit, [...left.seps]), "x")
  useSlide(paneItemsRef, withSeps(paneHit, [...mid.seps]), "x")
  useSlide(trayRef, trayHit?.order ?? null, "wrap")
  const gap = (g: Gap | null) => g?.order?.includes(INCOMING) && <span aria-hidden data-slide={INCOMING} className="h-5 shrink-0" />
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
  const split = cols.length > 1
  const others = room.filter((c) => c !== fc)
  const width = (c: Column, ...less: string[]) => (!split ? MAX_WIDTH : columnWidth(c, ...(c === first ? ["var(--status-left, 0px)"] : []), ...less))
  const lastWord = others.includes(last) && <PaneWord col={last} />
  return (
    <>
      {/* role="status" is polite by default: a screen reader would read the counts at every keystroke */}
      <div ref={leftRef} role="status" aria-live="off" aria-label="Status bar, left" data-status-bar data-status-left data-dragging={dragged ? "" : undefined} data-drop={leftHit ? "" : undefined}
        data-off={off || undefined} style={off ? { display: "none" } : { left: columnLeft(first), maxWidth: split ? `calc(${columnWidth(first)} / 2 - 6px - var(--pane-gap, 0px))` : LEFT_MAX_WIDTH }} onContextMenu={menuFor(barMenu)}
        className="vau-room sight-foot fixed bottom-0 z-20 transition-[left] duration-(--motion-spring) ease-(--spring) hidden h-7 box-content pb-[env(safe-area-inset-bottom)] items-center rounded-tr-[8px] border-t-[0.5px] border-r-[0.5px] border-border bg-sidebar pr-2 pl-1 text-[12px] whitespace-nowrap text-muted-foreground tabular-nums md:flex">
        <div ref={leftRowRef} data-status-row className="flex min-w-0 items-center gap-2">
          <div ref={leftItemsRef} data-status-items className="relative flex h-6 shrink-0 items-center gap-1">
            {left.els}
            {gap(leftHit)}
          </div>
        </div>
      </div>
      <div ref={barRef} role="status" aria-live="off" aria-label="Status bar" data-status-bar data-status-right data-off={off || undefined}
        style={off ? { display: "none" } : { right: columnRight(last), maxWidth: width(last, PAD) }} onContextMenu={menuFor(barMenu)} className={FOOT}>
        <div ref={rowRef} data-status-row className="flex min-w-0 items-center gap-2">
          {!moreApart && more}
          <div ref={itemsRef} data-status-items className="relative flex h-6 shrink-0 items-center gap-1">
            {right.els}
            {gap(barHit)}
          </div>
          {lastWord}
        </div>
        {!moreApart && trayBox}
      </div>
      {others.filter((c) => c !== last).map((c) => <PaneWord key={c.pane} col={c} maxWidth={width(c, PAD)} />)}
      <div ref={paneRef} role={apart ? "status" : undefined} aria-live="off" aria-label="Status bar, focused pane" data-status-bar data-status-pane data-dragging={dragged ? "" : undefined} data-drop={paneHit ? "" : undefined}
        style={fc && apart ? { right: columnRight(fc), maxWidth: width(fc, PAD) } : { display: "none" }} onContextMenu={menuFor(barMenu)}
        className={FOOT}>
        <div ref={paneRowRef} data-status-row className="flex min-w-0 items-center gap-2">
          {moreApart && more}
          <div ref={paneItemsRef} data-status-items className="relative flex h-6 shrink-0 items-center gap-1">
            {mid.els}
            {gap(paneHit)}
          </div>
        </div>
        {moreApart && trayBox}
      </div>
    </>
  )
})

const WHOLE: Column[] = [{ pane: "", x: 0, w: 1, full: false }]
const PAD = "calc(18px + var(--pane-gap, 0px) * 2)"
const FOOT = "vau-room sight-foot fixed bottom-0 z-20 transition-[right] duration-(--motion-spring) ease-(--spring) hidden h-7 box-content pb-[env(safe-area-inset-bottom)] items-center rounded-tl-[8px] border-t-[0.5px] border-l-[0.5px] border-border bg-sidebar pr-3 pl-1 text-[12px] whitespace-nowrap text-muted-foreground tabular-nums md:flex"

const PaneWord = memo(function PaneWord({ col, maxWidth }: { col: Column; maxWidth?: string }) {
  const s = paneStatusSubs.use(() => paneStatus.get(col.pane) ?? null)
  const path = s?.path ?? "", body = s?.body ?? "", text = !!s && !s.info && !s.says
  const nb = /\.ipynb$/i.test(path), code = !!s && /^(code|other|notebook)$/.test(kindOf(path))
  const counts = useCounts(path, body, text, code, nb)
  const n = (v: number, one: string) => `${numberText(v)} ${one}${v === 1 ? "" : "s"}`
  const word = !s ? null : s.info ? s.info[0] ?? null : s.says ? s.says(body)
    : !counts ? null : nb && s.mode === "read" ? n(counts.cells, "cell") : code ? n(counts.lines, "line") : n(counts.words, "word")
  if (!word) return null
  const chip = (
    <button type="button" data-status-word={col.pane} onClick={() => setFocusedPane(col.pane)} aria-label={`${word}, ${path.split("/").pop()}. Focus its pane`}
      className="flex h-6 shrink-0 cursor-pointer items-center truncate rounded-[5px] px-1 text-tertiary hover:text-muted-foreground">
      {word}
    </button>
  )
  if (!maxWidth) return chip
  return (
    <div data-status-bar data-status-word-bar onContextMenu={menuFor(barMenu)} style={{ right: columnRight(col), maxWidth }} className={cn(FOOT, "pr-2")}>
      {chip}
    </div>
  )
})

function useJumps(el: RefObject<HTMLElement | null>, at: string) {
  const was = useRef(at)
  useLayoutEffect(() => {
    const e = el.current
    if (!e || was.current === at) return
    was.current = at
    e.style.transition = "none"
    void e.offsetWidth
    const f = requestAnimationFrame(() => { e.style.transition = "" })
    return () => cancelAnimationFrame(f)
  }, [el, at])
}

function useLeftWidth(left: RefObject<HTMLElement | null>, ...right: RefObject<HTMLElement | null>[]) {
  useLayoutEffect(() => {
    const l = left.current, rs = right.flatMap((r) => (r.current ? [r.current] : []))
    if (!l || !rs.length) return
    const set = (w: number) => { for (const r of rs) r.style.setProperty("--status-left", `${Math.ceil(w)}px`) }
    set(l.getBoundingClientRect().width)
    const ro = new ResizeObserver(([e]) => set(e.borderBoxSize[0]?.inlineSize ?? 0))
    ro.observe(l)
    return () => ro.disconnect()
  }, [left, ...right]) // eslint-disable-line react-hooks/exhaustive-deps -- a fixed list of refs
}

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

type Refs = Record<"barRef" | "itemsRef" | "leftRef" | "leftItemsRef" | "paneRef" | "paneItemsRef" | "trayRef", RefObject<HTMLElement | null>>

function useBarDrops({ barRef, itemsRef, leftRef, leftItemsRef, paneRef, paneItemsRef, trayRef }: Refs, keys: string[], trayKeys: string[], tucked: string[]) {
  const afterTray = (key: string) => {
    const rest = keys.filter((k) => k !== key), end = trayKeys.filter((k) => k !== key).at(-1)
    return end ? rest[rest.indexOf(end) + 1] ?? null : rest[0] ?? null
  }
  const slots = (box: HTMLElement) => [...box.querySelectorAll<HTMLElement>(":scope > [data-status-key]")].filter((el) => el.offsetWidth)
  const corner = (side: "left" | "right" | "pane") => (item: { status?: string }, x: number, y: number, el: Element | null): Gap | null => {
    const bar = (side === "left" ? leftRef : side === "pane" ? paneRef : barRef).current, box = (side === "left" ? leftItemsRef : side === "pane" ? paneItemsRef : itemsRef).current
    if (!item.status || !bar?.offsetWidth || !box || el?.closest("[data-status-tray], [data-status-more]")) return null
    const b = bar.getBoundingClientRect(), f = box.getBoundingClientRect()
    if (side !== "left" ? x < f.left - 24 || x > b.right : x < b.left || x > Math.max(b.right, f.right + 24)) return null
    if (y < b.top - 24 || y > b.bottom) return null
    const coming = box.querySelector<HTMLElement>(`:scope > [data-slide="${INCOMING}"]`)
    if (coming) coming.style.display = "none"
    const at = slots(box), { order, before, same } = reorder(at.map((el) => el.dataset.statusKey!), [item.status], slotAt(box, at, x, y, "x"))
    if (coming) coming.style.display = ""
    return same ? null : { before: before ?? afterLast(at.map((el) => el.dataset.statusKey!), item.status), order }
  }
  const afterLast = (corner: string[], key: string) => {
    const rest = keys.filter((k) => k !== key), end = corner.filter((k) => k !== key).at(-1)
    return end ? rest[rest.indexOf(end) + 1] ?? null : null
  }
  const drop = (place: BarPlace) => (item: { status?: string }, g: Gap) => moveBarItem(item.status!, g.before, place)
  useDropTarget<Gap>("status:bar", corner("right"), drop("right"))
  useDropTarget<Gap>("status:left", corner("left"), drop("left"))
  useDropTarget<Gap>("status:pane", corner("pane"), drop("right"))
  useDropTarget<Gap>("status:more", (item, x, y, el) => {
    if (!item.status) return null
    const tray = trayRef.current
    if (tray && el && tray.contains(el)) {
      const at = slots(tray), { order, before, same } = reorder(at.map((el) => el.dataset.statusKey!), [item.status], slotAt(tray, at, x, y, "wrap"))
      return same && tucked.includes(item.status) ? null : { before: before ?? afterTray(item.status), order }
    }
    return el?.closest("[data-status-more]") ? { before: afterTray(item.status) } : null
  }, drop("tray"))
  return { barHit: useDropHit<Gap>("status:bar"), leftHit: useDropHit<Gap>("status:left"), paneHit: useDropHit<Gap>("status:pane"), trayHit: useDropHit<Gap>("status:more") }
}

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

const FileItem = memo(function FileItem({ item, head, text, reads }: { item: StatusItem; head: FileHead; text: string; reads: { text: boolean } }) {
  const file = useMemo(() => Object.defineProperty({ ...head }, "text", { enumerable: true, get: () => { reads.text = true; return text } }) as OpenFile, [head, text, reads])
  return <Catch reset={head.path} fallback={() => null}><Drawn draw={() => item.render(file)} /></Catch>
}, (a, b) => a.item === b.item && a.head === b.head && a.reads === b.reads && (a.text === b.text || !b.reads.text))

function useSettled() {
  const [settled, setSettled] = useState(() => status_)
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined, last = status_
    const on = () => {
      const s = status_, go = () => startTransition(() => setSettled(s))
      clearTimeout(t)
      if ((s?.body.length ?? 0) > WAIT_FOR_PAUSE_PAST && s?.path === last?.path) t = setTimeout(go, 500)
      else go()
      last = s
    }
    on()
    const off = statusSubs.subscribe(on)
    return () => { off(); clearTimeout(t) }
  }, [])
  return settled
}

let worker: Worker | null = null, asked = 0
function useCounts(path: string, body: string, text: boolean, code: boolean, nb: boolean): Counts | null {
  const big = body.length > WORKER_PAST
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

function useSteady(row: RefObject<HTMLElement | null>, reset: string) {
  const widest = useRef(new Map<string, number>())
  const watched = useRef(new Set<HTMLElement>())
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
