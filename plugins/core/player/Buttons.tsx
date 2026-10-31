// The player's buttons, shared by the full player and the one under a video: skips, speed, the sleep timer, a bookmark,
// and keeping the file on the iPhone.
import { useEffect, useState, type MouseEvent } from "react"
import { ArrowDownToLine, BookmarkPlus, Check, CircleCheck, Moon, RotateCcw, RotateCw } from "lucide-react"
import { cn, menuBelow, notify } from "@vaultite"
import type { Chapter } from "./shelves"
import { keep, keptOf, unkeep, useKept } from "./phone"
import { BACK, chapterAt, chapterEnd, clock, FORWARD, setMarks, setSleep, speed, SPEEDS, usePlaces, useSleep } from "./now"

export const icon = "size-5 md:size-4"
export const btn = "inline-flex h-11 min-w-11 cursor-pointer items-center justify-center gap-1.5 rounded-[8px] px-2 text-[15px] font-medium text-muted-foreground tabular-nums hover:bg-foreground/[0.06] hover:text-foreground md:h-8 md:min-w-8 md:text-[13px] aria-pressed:text-primary"

export function SpeedButton({ el }: { el: HTMLMediaElement }) {
  const pick = (e: MouseEvent) => menuBelow(e, SPEEDS.map((r) => ({ label: `${r}×`, icon: el.playbackRate === r ? Check : undefined, checked: el.playbackRate === r,
    run: () => { el.playbackRate = r; speed.set(r) } })))
  return <button type="button" className={cn(btn, "min-w-12")} onClick={pick} data-tip="Speed" aria-label={`Speed: ${el.playbackRate}×`}>{el.playbackRate}×</button>
}

const SLEEPS = [5, 10, 15, 30, 45, 60]
export function SleepButton({ el, cs }: { el: HTMLMediaElement; cs: Chapter[] }) {
  const sleep = useSleep()
  // (the minutes left count down on the button)
  const [, redraw] = useState(0)
  useEffect(() => { if (!sleep || !("until" in sleep)) return; const t = setInterval(() => redraw((n) => n + 1), 1000); return () => clearInterval(t) }, [sleep])
  const i = chapterAt(cs, el.currentTime)
  const left = !sleep ? "" : "until" in sleep ? clock((sleep.until - Date.now()) / 1000)
    : clock((chapterEnd(cs, i, el.duration) - el.currentTime) / Math.max(0.25, el.playbackRate))
  const pick = (e: MouseEvent) => menuBelow(e, [
    { label: "Off", checked: !sleep, icon: !sleep ? Check : undefined, run: () => setSleep(null) },
    ...SLEEPS.map((m) => ({ label: `${m} minutes`, run: () => setSleep({ until: Date.now() + m * 60_000 }) })),
    ...(cs.length > 1 ? [{ label: "End of chapter", checked: !!sleep && "chapter" in sleep, icon: sleep && "chapter" in sleep ? Check : undefined, run: () => setSleep({ chapter: true }) }] : []),
  ])
  return (
    <button type="button" className={btn} aria-pressed={!!sleep} onClick={pick} data-tip="Sleep timer" aria-label={sleep ? `Sleep timer: ${left} left` : "Sleep timer"}>
      <Moon className={icon} strokeWidth={2} />{left && <span>{left}</span>}
    </button>
  )
}

/** A bookmark here, now (with Undo). */
export function MarkButton({ el, path, cs }: { el: HTMLMediaElement; path: string; cs: Chapter[] }) {
  const places = usePlaces()
  const add = () => {
    const t = Math.floor(el.currentTime), was = places[path]?.marks ?? []
    if (was.some((m) => Math.abs(m.t - t) < 2)) return notify(`Already bookmarked at ${clock(t)}`)
    setMarks(path, [...was, { t }])
    const c = cs[chapterAt(cs, t)]
    notify(`Bookmarked ${clock(t)}${c ? ` in ${c.title}` : ""}`, { action: { label: "Undo", run: () => setMarks(path, was) } })
  }
  return <button type="button" className={btn} onClick={add} aria-label="Add bookmark" data-tip="Add bookmark"><BookmarkPlus className={icon} strokeWidth={2} /></button>
}

/** Download to this iPhone, to play without the server; how far it's got; kept. */
export function Keep({ path }: { path: string }) {
  const k = keptOf(useKept(), path)
  if (k?.done) return (
    <button type="button" className={cn(btn, "text-primary")} aria-label="On this iPhone" data-tip="On this iPhone"
      onClick={(e) => menuBelow(e, [{ label: "Remove from this iPhone", danger: true, run: () => void unkeep(path) }])}>
      <CircleCheck className="size-5 md:size-4" strokeWidth={2} />
    </button>
  )
  if (k && !k.error) return <span className={btn} aria-label="Downloading">{k.size ? `${Math.floor((k.got / k.size) * 100)}%` : "…"}</span>
  return (
    <button type="button" className={btn} onClick={() => keep(path)} aria-label={k?.error ? `Download again (${k.error})` : "Download to this iPhone"} data-tip="Download to this iPhone">
      <ArrowDownToLine className="size-5 md:size-4" strokeWidth={2} />
    </button>
  )
}

/** The skip icons with their seconds in them, as podcast apps draw them. */
export function Skip({ back, big }: { back?: boolean; big?: boolean }) {
  const Icon = back ? RotateCcw : RotateCw
  return (
    <span className="relative grid place-items-center">
      <Icon className={big ? "size-8" : "size-6 md:size-5"} strokeWidth={big ? 1.5 : 1.75} />
      <span className={cn("absolute font-bold", big ? "text-[10px]" : "text-[8px] md:text-[7px]")}>{back ? BACK : FORWARD}</span>
    </span>
  )
}
