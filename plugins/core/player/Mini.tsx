// The mini player: what's playing while no view of it is in sight, above the phone's bar or at the window's bottom
// right. A video plays in it; tapping it goes back to the note it was started in.
import { useEffect, useLayoutEffect, useRef } from "react"
import { Pause, Play, X } from "lucide-react"
import { cn, kindIcon, openFile, rawUrl, useDesktop } from "@vaultite"
import { sendOfflinePlaces } from "./phone"
import { BACK, clock, FORWARD, homeOf, loadPlaces, pictureOf, labelOf, presenting, shown, stop, useNow, useTick, useVersion, watchAway } from "./now"

export function MiniPlayer() {
  useVersion()
  const now = useNow()
  const desktop = useDesktop()
  const showing = !!now && !shown(now.el)
  useEffect(() => { loadPlaces(true); sendOfflinePlaces(); return watchAway() }, [])
  useEffect(() => {
    document.documentElement.style.setProperty("--mini-player", showing ? (desktop ? (now!.video ? "236px" : "84px") : "68px") : "0px")
    return () => { document.documentElement.style.setProperty("--mini-player", "0px") }
  }, [showing, desktop, now])
  if (!now || !showing) return null
  return <Bar key={now.path} desktop={desktop} />
}

function Bar({ desktop }: { desktop: boolean }) {
  const now = useNow()!
  const { el, path, video, from } = now
  useTick(el)
  const box = useRef<HTMLDivElement>(null)
  // A video nothing else draws plays here; a view of it that comes back takes it again (Player.tsx).
  useLayoutEffect(() => {
    if (video && box.current && !homeOf(el) && !presenting(el) && el.parentElement !== box.current) box.current.append(el)
  })
  const pic = pictureOf(path)
  const Icon = kindIcon(path)
  const label = labelOf(now)
  const pct = el.duration ? (el.currentTime / el.duration) * 100 : 0
  const back = () => { el.currentTime = Math.max(0, el.currentTime - BACK) }
  const fwd = () => { el.currentTime = Math.min(el.duration || Infinity, el.currentTime + FORWARD) }
  const open = () => openFile(from ?? path)
  const b = "grid size-11 shrink-0 cursor-pointer place-items-center rounded-full text-foreground hover:bg-foreground/[0.06] md:size-8"
  const inMini = video && !homeOf(el)
  return (
    <div data-mini-player role="region" aria-label="Now playing"
      className={cn("glass-strong fixed z-[19] overflow-hidden", desktop ? "right-4 bottom-10 w-[340px] rounded-[12px]" : "inset-x-2 rounded-[14px]")}
      style={desktop ? undefined : { bottom: "calc(var(--phone-bar) + 0.5rem)" }}>
      {desktop && inMini && <div ref={box} onClick={open} className="aspect-video w-full cursor-pointer bg-black [&>video]:size-full [&>video]:object-contain [&>video]:pointer-events-none" />}
      <div className={cn("flex items-center gap-2", desktop ? "h-11 px-2" : "h-[60px] px-2")}>
        {!desktop && inMini ? <div ref={box} onClick={open} className="h-11 w-[78px] shrink-0 cursor-pointer overflow-hidden rounded-[8px] bg-black [&>video]:size-full [&>video]:object-cover [&>video]:pointer-events-none" />
          : !inMini || !desktop ? (pic ? <img src={rawUrl(pic)} alt="" onClick={open} className="size-11 shrink-0 cursor-pointer rounded-[8px] object-cover md:size-8 md:rounded-[6px]" />
            : <button type="button" onClick={open} className="grid size-11 shrink-0 cursor-pointer place-items-center rounded-[8px] bg-foreground/[0.06] md:size-8"><Icon className="size-5 text-muted-foreground md:size-4" strokeWidth={2} /></button>) : null}
        <button type="button" onClick={open} className="min-w-0 flex-1 cursor-pointer text-left">
          <div className="truncate text-[15px] font-medium md:text-[13px]">{label.title}</div>
          <div className="truncate text-[13px] text-muted-foreground tabular-nums md:text-[12px]">{clock(el.currentTime)}{el.duration ? ` / ${clock(el.duration)}` : ""}{label.by ? ` · ${label.by}` : ""}</div>
        </button>
        {!desktop ? null : <button type="button" className={b} onClick={back} aria-label={`Back ${BACK} seconds`} data-tip={`Back ${BACK} seconds`}><span className="text-[11px] font-semibold">−{BACK}</span></button>}
        <button type="button" className={b} onClick={() => (el.paused ? void el.play() : el.pause())} aria-label={el.paused ? "Play" : "Pause"}>
          {el.paused ? <Play className="size-6 fill-current md:size-4" strokeWidth={0} /> : <Pause className="size-6 fill-current md:size-4" strokeWidth={0} />}
        </button>
        <button type="button" className={b} onClick={fwd} aria-label={`Forward ${FORWARD} seconds`} data-tip={`Forward ${FORWARD} seconds`}><span className="text-[13px] font-semibold md:text-[11px]">+{FORWARD}</span></button>
        <button type="button" className={cn(b, "text-muted-foreground")} onClick={stop} aria-label="Stop" data-tip="Stop"><X className="size-5 md:size-4" strokeWidth={2} /></button>
      </div>
      <div className="absolute inset-x-0 bottom-0 h-[2px] bg-foreground/[0.08]"><div className="h-full bg-primary" style={{ width: `${pct}%` }} /></div>
    </div>
  )
}
