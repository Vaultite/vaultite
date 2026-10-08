// While recording: a small bar floating over the app (bottom centre on computers, under the header on phones, clear of
// the toasts), with the time, the level, pause and stop (and send: a voice note). Drawn by `background` into <body>.
import { useEffect, useState, useSyncExternalStore } from "react"
import { createPortal } from "react-dom"
import { Loader2, Pause, Play, Square } from "lucide-react"
import { cn } from "@vaultite"
import { elapsed, getStatus, level, pause, resume, stop, subscribe } from "./recorder"

const clock = (s: number) => {
  const t = Math.floor(s), h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = t % 60
  return `${h ? `${h}:${String(m).padStart(2, "0")}` : m}:${String(sec).padStart(2, "0")}`
}

/** Five bars for the input's level (0..1). */
function Meter({ on }: { on: boolean }) {
  const [v, setV] = useState(0)
  useEffect(() => {
    if (!on) { setV(0); return }
    let raf = 0, last = 0
    const tick = (t: number) => {
      if (t - last > 80) { last = t; setV((old) => Math.max(level(), old * 0.7)) }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [on])
  return (
    <span className="flex h-4 items-center gap-[2px]" aria-hidden>
      {[0.1, 0.25, 0.45, 0.65, 0.85].map((t, i) => (
        <span key={i} className={cn("w-[3px] rounded-full transition-[height,background-color] duration-100", v > t ? "bg-[var(--red)]" : "bg-foreground/20")}
          style={{ height: `${6 + i * 2.5}px` }} />
      ))}
    </span>
  )
}

const btn = "grid size-11 shrink-0 cursor-pointer place-items-center rounded-full md:size-8"

export function Indicator() {
  const s = useSyncExternalStore(subscribe, getStatus)
  const [, tick] = useState(0)
  const live = s.state === "recording"
  useEffect(() => {
    if (!live) return
    const t = setInterval(() => tick((n) => n + 1), 250)
    return () => clearInterval(t)
  }, [live])
  if (s.state === "idle") return null
  const busy = s.state === "starting" || s.state === "saving"
  const paused = s.state === "paused"
  const voice = (s.state === "recording" || s.state === "paused") && !!s.voice
  return createPortal(
    <div role="status" aria-live="polite" data-recorder={s.state}
      className={cn("glass-strong fixed left-1/2 z-40 flex -translate-x-1/2 items-center gap-2 rounded-full py-1 pr-1 pl-4 shadow-lg md:gap-2.5 md:pl-3.5",
        "top-[calc(env(safe-area-inset-top)+3.5rem)] md:top-auto md:bottom-12")}>
      {busy ? <Loader2 className="size-4 animate-spin text-muted-foreground" strokeWidth={2.25} />
        : <span className={cn("size-2.5 rounded-full bg-[var(--red)]", live && "animate-pulse")} />}
      <span className="text-[15px] font-medium whitespace-nowrap md:text-[13px]">
        {s.state === "starting" ? "Starting…" : s.state === "saving" ? "Saving…" : paused ? "Paused" : voice ? "Voice note" : "Recording"}
      </span>
      {!busy && <span className="min-w-[3.25rem] text-[15px] tabular-nums text-muted-foreground md:min-w-[2.75rem] md:text-[13px]">{clock(elapsed(s))}</span>}
      {!busy && <Meter on={live} />}
      {!busy && (
        <>
          <button type="button" aria-label={paused ? "Resume recording" : "Pause recording"} data-tip={paused ? "Resume" : "Pause"} onClick={paused ? resume : pause}
            className={cn(btn, "text-foreground hover:bg-foreground/[0.08]")}>
            {paused ? <Play className="size-4" strokeWidth={2.25} /> : <Pause className="size-4" strokeWidth={2.25} />}
          </button>
          <button type="button" aria-label={voice ? "Stop and send" : "Stop recording"} data-tip={voice ? "Stop and send to your inbox" : "Stop and save"} onClick={stop}
            className={cn(btn, "bg-[var(--red)] text-primary-foreground hover:opacity-90")}>
            <Square className="size-3.5 fill-current" strokeWidth={2.25} />
          </button>
        </>
      )}
      {busy && <span className="w-2" />}
    </div>,
    document.body,
  )
}
