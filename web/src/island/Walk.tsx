import { useEffect, useState } from "react"
import { Undo2, X } from "lucide-react"
import { cn } from "@/lib/utils"
import type { WalkScene } from "../../../core/desktop/walks"
import { api } from "./data"
import { walkWords } from "./walkwords"

export function WalkMark({ w }: { w: WalkScene }) {
  const { name, count } = walkWords(w)
  return (
    <span className="flex shrink-0 items-center gap-1.5 pr-1 text-[12.5px] leading-none" data-walk={w.state} aria-label={`${name}, ${count}`}>
      <span className={cn("size-2 rounded-full", w.state === "on" ? "bg-[var(--red)]" : "bg-white/45")} />
      <b className="font-semibold">{name}</b>
      <span className="text-white/60 tabular-nums" data-walk-count={w.count}>{w.count}</span>
    </span>
  )
}

function subOf(w: WalkScene, lesson: boolean) {
  if (w.state === "sending") return lesson ? "Making it…" : "Sending…"
  if (w.note) return w.note
  if (w.state === "paused") return "Paused while you talk to the companion"
  return lesson ? "Say done to make it a tour or a skill" : "Talk as you go; say done to send"
}

function WalkActs({ w }: { w: WalkScene }) {
  const [discard, setDiscard] = useState(false)
  useEffect(() => { if (!discard) return; const t = setTimeout(() => setDiscard(false), 3500); return () => clearTimeout(t) }, [discard])
  const { count, lesson } = walkWords(w), act = (what: string) => api?.act("walk", what)
  if (discard) return <button type="button" className="island-chip shrink-0 text-[var(--red)]" onClick={() => { setDiscard(false); act("cancel") }}>Discard {count}</button>
  return (
    <span className="flex shrink-0 gap-1">
      {!lesson && <button type="button" className="island-chip island-icon" disabled={!w.count} onClick={() => act("scratch")} aria-label="Scratch the last item"><Undo2 className="size-3.5" /></button>}
      <button type="button" className="island-chip" disabled={!w.count} onClick={() => act("done")} aria-label={lesson ? "Done: make it a tour or a skill" : "Done: send the walk"}>Done</button>
      <button type="button" className="island-chip island-icon" onClick={() => (w.count ? setDiscard(true) : act("cancel"))} aria-label={lesson ? "Stop watching and forget it" : "End the walk without sending it"}><X className="size-3.5" /></button>
    </span>
  )
}

export function WalkRow({ w }: { w: WalkScene }) {
  const { name, count, lesson } = walkWords(w), sub = subOf(w, lesson)
  return (
    <div role="listitem" className="island-row" data-walk-row={w.state}>
      <span className={cn("grid size-[22px] shrink-0 place-items-center rounded-full", w.state === "on" ? "bg-[var(--red)]/25" : "bg-white/10")}>
        <span className={cn("size-2 rounded-full", w.state === "on" ? "bg-[var(--red)]" : "bg-white/50")} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2"><span className="truncate text-[12.5px] font-semibold">{name}</span>
          <span className="shrink-0 text-[11px] text-white/55 tabular-nums">{count}</span></span>
        <span key={sub} className="island-fade block truncate text-[11.5px] text-white/70">{sub}</span>
      </span>
      {w.state !== "sending" && <WalkActs w={w} />}
    </div>
  )
}
