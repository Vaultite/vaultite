// The full player, as audiobook apps draw it: artwork, a scrubber, big controls, speed, sleep timer, bookmarks and
// chapters. A sound's own tab is this (the mini player opens it); under a video in its tab, only Book.
import { useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react"
import { Airplay, Bookmark, FileText, Pause, Play, SkipBack, SkipForward, Trash2 } from "lucide-react"
import { cn, kindIcon, List, menuFor, notify, openFile, phoneFiles, Segmented, SwipeRow, type SwipeAction } from "@vaultite"
import type { Chapter, Mark } from "./shelves"
import { btn, icon, Keep, MarkButton, SleepButton, Skip, SpeedButton } from "./Buttons"
import { artOf, BACK, chapterAt, clock, FORWARD, getNow, labelOf, setMarks, stepChapter, useMeta, usePlaces, useTick } from "./now"

export function Full({ el, path }: { el: HTMLMediaElement; path: string }) {
  useTick(el)
  const meta = useMeta(path)
  const cs = meta?.chapters ?? []
  const from = getNow()?.el === el ? getNow()!.from : el.dataset.from || undefined
  const label = labelOf({ path, from })
  const art = artOf(path)
  const Icon = kindIcon(path)
  const i = chapterAt(cs, el.currentTime)
  return (
    <div className="mx-auto flex w-full max-w-md flex-col px-4 pt-4 pb-10 md:pt-8" data-player-full>
      {art ? <img src={art} alt="" draggable={false} className="mx-auto aspect-square w-full max-w-80 rounded-[12px] object-cover shadow-lg" />
        : <div className="mx-auto grid aspect-square w-full max-w-80 place-items-center rounded-[12px] bg-foreground/[0.06]"><Icon className="size-16 text-muted-foreground" strokeWidth={1.25} /></div>}
      <div className="mt-6 min-w-0">
        <h1 className="line-clamp-2 text-[20px] leading-tight font-semibold break-words">{label.title}</h1>
        {label.by && <p className="mt-0.5 truncate text-[15px] text-muted-foreground">{label.by}</p>}
      </div>
      <Scrubber el={el} cs={cs} className="mt-4" />
      {cs[i] && <p className="-mt-0.5 truncate text-center text-[13px] text-muted-foreground">{cs[i].title}</p>}
      <Transport el={el} cs={cs} className="mt-3" />
      <div className="mt-4 flex items-center justify-center gap-1">
        <SpeedButton el={el} />
        <SleepButton el={el} cs={cs} />
        <MarkButton el={el} path={path} cs={cs} />
        {"webkitShowPlaybackTargetPicker" in el && (
          <button type="button" className={btn} aria-label="AirPlay" data-tip="AirPlay"
            onClick={() => (el as HTMLMediaElement & { webkitShowPlaybackTargetPicker: () => void }).webkitShowPlaybackTargetPicker()}>
            <Airplay className={icon} strokeWidth={2} />
          </button>
        )}
        {phoneFiles && <Keep path={path} />}
        {from && <button type="button" className={btn} onClick={() => openFile(from)} aria-label="Open note" data-tip="Open note"><FileText className={icon} strokeWidth={2} /></button>}
      </div>
      <Book el={el} path={path} cs={cs} className="mt-6" />
    </div>
  )
}

/** Where it is: dragged or tapped to anywhere, with the chapters marked on it. */
function Scrubber({ el, cs, className }: { el: HTMLMediaElement; cs: Chapter[]; className?: string }) {
  const bar = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<number | null>(null)
  const d = Number.isFinite(el.duration) ? el.duration : 0
  const t = drag ?? el.currentTime
  const at = (e: PointerEvent) => {
    const r = bar.current!.getBoundingClientRect()
    return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * d
  }
  const keys = (e: KeyboardEvent) => {
    const by = { ArrowLeft: -BACK, ArrowRight: FORWARD, Home: -Infinity, End: Infinity }[e.key]
    if (by === undefined || !d) return
    e.preventDefault()
    el.currentTime = Math.max(0, Math.min(d, el.currentTime + by))
  }
  const pct = d ? `${(t / d) * 100}%` : "0%"
  return (
    <div className={className}>
      <div ref={bar} role="slider" tabIndex={0} aria-label="Position" aria-valuemin={0} aria-valuemax={Math.round(d)} aria-valuenow={Math.round(t)} aria-valuetext={clock(t)}
        className="group relative h-8 cursor-pointer touch-none select-none outline-none" data-dragging={drag !== null ? "" : undefined}
        onPointerDown={(e) => { if (!d) return; e.currentTarget.setPointerCapture(e.pointerId); setDrag(at(e)) }}
        onPointerMove={(e) => { if (drag !== null) setDrag(at(e)) }}
        onPointerUp={(e) => { if (drag === null) return; el.currentTime = at(e); setDrag(null) }}
        onPointerCancel={() => setDrag(null)} onKeyDown={keys}>
        <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 overflow-hidden rounded-full bg-foreground/[0.12] transition-[height] group-data-dragging:h-2">
          <div className="h-full bg-foreground/60" style={{ width: pct }} />
          {d > 0 && cs.slice(1).map((c) => <span key={c.t} className="absolute inset-y-0 w-[2px] bg-background" style={{ left: `${(c.t / d) * 100}%` }} />)}
        </div>
        <div className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground shadow transition-[width,height] group-focus-visible:ring-2 group-focus-visible:ring-primary group-data-dragging:size-4" style={{ left: pct }} />
      </div>
      <div className="flex justify-between text-[12px] text-muted-foreground tabular-nums">
        <span>{clock(t)}</span><span>−{clock(Math.max(0, d - t))}</span>
      </div>
    </div>
  )
}

function Transport({ el, cs, className }: { el: HTMLMediaElement; cs: Chapter[]; className?: string }) {
  const skip = (s: number) => { el.currentTime = Math.max(0, Math.min(el.duration || Infinity, el.currentTime + s)) }
  const b = "grid size-12 shrink-0 cursor-pointer place-items-center rounded-full text-foreground hover:bg-foreground/[0.06] disabled:cursor-default disabled:opacity-30"
  const i = chapterAt(cs, el.currentTime)
  return (
    <div className={cn("flex items-center justify-center gap-2", className)}>
      {cs.length > 1 && <button type="button" className={b} onClick={() => stepChapter(el, cs, -1)} aria-label="Previous chapter" data-tip="Previous chapter"><SkipBack className="size-6 fill-current" strokeWidth={1.5} /></button>}
      <button type="button" className={b} onClick={() => skip(-BACK)} aria-label={`Back ${BACK} seconds`} data-tip={`Back ${BACK} seconds`}><Skip back big /></button>
      <button type="button" onClick={() => (el.paused ? void el.play() : el.pause())} aria-label={el.paused ? "Play" : "Pause"}
        className="mx-2 grid size-16 shrink-0 cursor-pointer place-items-center rounded-full bg-foreground text-background active:scale-95">
        {el.paused ? <Play className="ml-1 size-7 fill-current" strokeWidth={0} /> : <Pause className="size-7 fill-current" strokeWidth={0} />}
      </button>
      <button type="button" className={b} onClick={() => skip(FORWARD)} aria-label={`Forward ${FORWARD} seconds`} data-tip={`Forward ${FORWARD} seconds`}><Skip big /></button>
      {cs.length > 1 && <button type="button" className={b} disabled={!cs[i + 1]} onClick={() => stepChapter(el, cs, 1)} aria-label="Next chapter" data-tip="Next chapter"><SkipForward className="size-6 fill-current" strokeWidth={1.5} /></button>}
    </div>
  )
}

type Shelf = "chapters" | "marks"
/** Its chapters and bookmarks: a tap plays from there. Nothing for a file with neither. */
export function Book({ el, path, cs, className }: { el: HTMLMediaElement; path: string; cs: Chapter[]; className?: string }) {
  const marks = usePlaces()[path]?.marks ?? []
  const [pick, setPick] = useState<Shelf | null>(null)
  const show: Shelf = cs.length > 1 ? pick ?? "chapters" : "marks" // (the chapters come a moment after the first draw)
  if (cs.length < 2 && !marks.length) return null
  const go = (t: number) => { el.currentTime = t; if (el.paused) void el.play().catch(() => {}) }
  return (
    <section className={className} aria-label={show === "chapters" ? "Chapters" : "Bookmarks"}>
      {cs.length > 1 ? (
        <Segmented label="Show" value={show} onChange={setPick} className="mb-2"
          options={[{ value: "chapters", label: `Chapters ${cs.length}` }, { value: "marks", label: marks.length ? `Bookmarks ${marks.length}` : "Bookmarks" }]} />
      ) : <h2 className="mb-1 text-[13px] font-semibold text-muted-foreground">Bookmarks</h2>}
      {show === "chapters" ? <Chapters el={el} cs={cs} go={go} />
        : marks.length ? <Marks path={path} marks={marks} cs={cs} go={go} />
        : <p className="py-6 text-center text-[15px] text-muted-foreground md:text-[13px]">No bookmarks yet</p>}
    </section>
  )
}

function Chapters({ el, cs, go }: { el: HTMLMediaElement; cs: Chapter[]; go: (t: number) => void }) {
  const i = chapterAt(cs, el.currentTime)
  return (
    <List>
      {cs.map((c, k) => (
        <button key={k} type="button" onClick={() => go(c.t)} aria-current={k === i ? "true" : undefined}
          className="relative isolate flex min-h-11 w-full cursor-pointer items-center gap-3 py-2 text-left before:absolute before:inset-y-0 before:-inset-x-2 before:-z-10 before:rounded-[8px] hover:before:bg-foreground/[0.04] active:before:bg-foreground/[0.07] aria-[current]:text-primary">
          <span className="w-6 shrink-0 text-right text-[13px] text-muted-foreground tabular-nums">{k + 1}</span>
          <span className="min-w-0 flex-1 truncate text-[15px]">{c.title}</span>
          <span className="shrink-0 text-[13px] text-muted-foreground tabular-nums">{clock(c.t)}</span>
        </button>
      ))}
    </List>
  )
}

function Marks({ path, marks, cs, go }: { path: string; marks: Mark[]; cs: Chapter[]; go: (t: number) => void }) {
  const [editing, setEditing] = useState<number | null>(null)
  const drop = (m: Mark) => { setMarks(path, marks.filter((x) => x !== m)); notify(`Deleted the bookmark at ${clock(m.t)}`, { action: { label: "Undo", run: () => setMarks(path, marks) } }) }
  const note = (m: Mark, text: string) => { setEditing(null); if ((m.note ?? "") !== text.trim()) setMarks(path, marks.map((x) => (x === m ? { t: m.t, ...(text.trim() ? { note: text.trim() } : {}) } : x))) }
  return (
    <List>
      {marks.map((m) => {
        const c = cs[chapterAt(cs, m.t)]
        const menu = menuFor(() => [
          { label: m.note ? "Edit note" : "Add note", run: () => setEditing(m.t) },
          { label: "Delete", icon: Trash2, danger: true, run: () => drop(m) },
        ])
        const swipe = (): SwipeAction[] => [{ label: "Delete", icon: Trash2, danger: true, removes: true, run: () => drop(m) }]
        return (
          <SwipeRow key={m.t} actions={swipe}>
            <div onContextMenu={menu as unknown as (e: MouseEvent) => void} className="flex min-h-11 items-center gap-3 py-2">
              <Bookmark className="size-4 shrink-0 text-primary" strokeWidth={2} />
              {editing === m.t ? (
                <input autoFocus defaultValue={m.note ?? ""} placeholder="Note" aria-label="Note"
                  className="min-w-0 flex-1 rounded-[6px] bg-foreground/[0.06] px-2 py-1 text-[15px] outline-none md:text-[13px]"
                  onBlur={(e) => note(m, e.currentTarget.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") setEditing(null) }} />
              ) : (
                <button type="button" onClick={() => go(m.t)} className="min-w-0 flex-1 cursor-pointer text-left">
                  <span className="block truncate text-[15px]">{m.note || c?.title || "Bookmark"}</span>
                  {m.note && c && <span className="block truncate text-[13px] text-muted-foreground">{c.title}</span>}
                </button>
              )}
              {editing !== m.t && <span className="shrink-0 text-[13px] text-muted-foreground tabular-nums">{clock(m.t)}</span>}
            </div>
          </SwipeRow>
        )
      })}
    </List>
  )
}
