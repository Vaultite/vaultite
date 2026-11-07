// A QA walk's chip (electron/walk.ts) under the menu bar, or a lesson's (teach.ts: its steps, Done makes it): on, its
// count, a word as each item is noted; its buttons scratch the last item, Done, or discard it after asking once more.
import { useEffect, useRef, useState } from "react"
import { Undo2, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { countText, type WalkScene } from "../../plugins/core/companion/walks"

const BUTTON = "flex h-6 cursor-pointer items-center gap-1 rounded-full px-2 hover:bg-foreground/[0.07] disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent"

export function WalkChip({ w, top, grab, act }: { w: WalkScene; top: number; grab: (on: boolean) => void; act: (what: string) => void }) {
  const [discard, setDiscard] = useState(false)
  const told = w.state === "told", lesson = w.of === "lesson"
  const count = lesson ? (w.count === 1 ? "1 step" : `${w.count} steps`) : countText(w.count)
  const over = useRef(false)
  // (the window takes the pointer over the chip only)
  const enter = () => { if (!over.current) { over.current = true; grab(true) } }
  const leave = () => { if (over.current) { over.current = false; grab(false) } }
  useEffect(() => () => leave(), [])
  useEffect(() => { if (told) leave() }, [told])
  useEffect(() => { if (!discard) return; const t = setTimeout(() => setDiscard(false), 3500); return () => clearTimeout(t) }, [discard])
  return (
    <div className="screen-in pointer-events-none fixed right-3 flex max-w-[440px] justify-end" style={{ top: top + 8 }}>
      <div role="status" aria-label={told ? w.note : `${lesson ? "Watching" : "QA walk"}, ${count}`} data-walk={w.state}
        className="pointer-events-auto flex min-w-0 items-center gap-0.5 rounded-full border border-black/10 bg-background/95 p-0.5 text-[12px] font-medium shadow-md backdrop-blur"
        onPointerEnter={told ? undefined : enter} onPointerLeave={told ? undefined : leave}>
        {told ? <span className="truncate px-2.5 py-1">{w.note}</span> : <>
          <span className="flex shrink-0 items-center gap-1.5 py-1 pr-1 pl-2">
            <span className={cn("size-2 rounded-full", w.state === "on" ? "region-dot bg-[var(--red)]" : "bg-muted-foreground/50")} />
            {lesson ? "Watching" : "QA walk"}
            <span className="text-muted-foreground tabular-nums" data-walk-count={w.count}>{count}</span>
          </span>
          {w.note && <span key={w.note} className="screen-in min-w-0 truncate px-1 text-muted-foreground">{w.note}</span>}
          {w.state === "sending" ? <span className="shrink-0 px-2.5 py-1 text-muted-foreground">{lesson ? "Making it…" : "Sending…"}</span>
            : discard ? (
              <button type="button" className={cn(BUTTON, "shrink-0 text-[var(--red)]")} onClick={() => { setDiscard(false); act("cancel") }}>
                Discard {count}
              </button>
            ) : <>
              {!lesson && <button type="button" className={cn(BUTTON, "w-6 shrink-0 justify-center px-0 text-muted-foreground hover:text-foreground")} disabled={!w.count} onClick={() => act("scratch")} aria-label="Scratch the last item">
                <Undo2 className="size-3.5" />
              </button>}
              <button type="button" className={cn(BUTTON, "shrink-0")} disabled={!w.count} onClick={() => act("done")} aria-label={lesson ? "Done: make it a tour or a skill" : "Done: send the walk"}>Done</button>
              <button type="button" className={cn(BUTTON, "w-6 shrink-0 justify-center px-0 text-muted-foreground hover:text-foreground")} onClick={() => (w.count ? setDiscard(true) : act("cancel"))} aria-label={lesson ? "Stop watching and forget it" : "End the walk without sending it"}>
                <X className="size-3.5" />
              </button>
            </>}
        </>}
      </div>
    </div>
  )
}
