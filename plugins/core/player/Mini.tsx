// The mini player: what's playing while no view of it is in sight, above the phone's bar or in a corner between the
// sidebars (dragged to another, like picture in picture). A video plays in it; a tap goes back to the note it came from.
import { useEffect, useLayoutEffect, useRef, type MouseEvent, type PointerEvent as ReactPointerEvent } from "react"
import { Pause, Play, X } from "lucide-react"
import { cn, kindIcon, openFile, rawUrl, useDesktop, useScopedState } from "@vaultite"
import { sendOfflinePlaces } from "./phone"
import { BACK, clock, FORWARD, homeOf, loadPlaces, pictureOf, labelOf, presenting, shown, stop, useNow, useTick, useVersion, watchAway } from "./now"

type Corner = "tl" | "tr" | "bl" | "br"
// Top corners sit under the pane's tab bar and file bar (back, forward), bottom ones over the status bar.
const CORNERS: Record<Corner, string> = {
  tl: "top-22 left-[calc(var(--left-sidebar,0px)+1rem)]",
  tr: "top-22 right-[calc(var(--right-sidebar,0px)+1rem)]",
  bl: "bottom-10 left-[calc(var(--left-sidebar,0px)+1rem)]",
  br: "bottom-10 right-[calc(var(--right-sidebar,0px)+1rem)]",
}

export function MiniPlayer() {
  useVersion()
  const now = useNow()
  const desktop = useDesktop()
  const [corner, setCorner] = useScopedState<Corner>("player:corner", "br", "device")
  const showing = !!now && !shown(now.el)
  useEffect(() => { loadPlaces(true); sendOfflinePlaces(); return watchAway() }, [])
  // What's drawn at the bottom (toasts, a page's last lines) keeps clear of it while it's in a bottom corner.
  const room = !showing ? "0px" : !desktop ? "68px" : corner[0] === "t" ? "0px" : now!.video ? "236px" : "84px"
  useEffect(() => {
    document.documentElement.style.setProperty("--mini-player", room)
    return () => { document.documentElement.style.setProperty("--mini-player", "0px") }
  }, [room])
  if (!now || !showing) return null
  return <Bar key={now.path} desktop={desktop} corner={CORNERS[corner] ? corner : "br"} setCorner={setCorner} />
}

/** Dragging the desktop's mini player anywhere on it (a click still clicks), and where it lands: the corner it was
 *  thrown towards, as iOS's and browsers' picture in picture do. */
function useCornerDrag(corner: Corner, setCorner: (c: Corner) => void) {
  const card = useRef<HTMLDivElement>(null)
  const dragged = useRef(false)
  const from = useRef<{ x: number; y: number } | null>(null)
  // Glides from where it was let go to its corner (drawn there already, so the corner's own place is measured).
  const settle = (el: HTMLElement, at: { x: number; y: number }) => {
    const r = el.getBoundingClientRect()
    if (typeof el.animate !== "function" || matchMedia("(prefers-reduced-motion: reduce)").matches) return
    el.animate([{ transform: `translate(${at.x - r.left}px, ${at.y - r.top}px)` }, { transform: "none" }], { duration: 320, easing: "cubic-bezier(0.2, 0.9, 0.25, 1.05)" })
  }
  useLayoutEffect(() => {
    if (!from.current || !card.current) return
    settle(card.current, from.current)
    from.current = null
  }, [corner])

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    const el = e.currentTarget, id = e.pointerId, x0 = e.clientX, y0 = e.clientY
    let moving = false, last = { x: x0, y: y0, t: e.timeStamp }, v = { x: 0, y: 0 }
    dragged.current = false
    const move = (m: PointerEvent) => {
      if (m.pointerId !== id) return
      const dx = m.clientX - x0, dy = m.clientY - y0
      if (!moving) {
        if (Math.hypot(dx, dy) < 4) return
        moving = dragged.current = true
        try { el.setPointerCapture(id) } catch { /* not a live pointer */ }
        el.dataset.dragging = ""
        getSelection()?.removeAllRanges()
      }
      const dt = m.timeStamp - last.t
      if (dt > 0) v = { x: 0.6 * v.x + 0.4 * (m.clientX - last.x) / dt, y: 0.6 * v.y + 0.4 * (m.clientY - last.y) / dt }
      last = { x: m.clientX, y: m.clientY, t: m.timeStamp }
      el.style.transform = `translate(${dx}px, ${dy}px)`
    }
    const up = (u: PointerEvent) => {
      if (u.pointerId !== id) return
      removeEventListener("pointermove", move)
      removeEventListener("pointerup", up)
      removeEventListener("pointercancel", up)
      if (!moving) return
      delete el.dataset.dragging
      const r = el.getBoundingClientRect()
      el.style.transform = ""
      // Where it would coast to: a flick throws it to the far corner of the room between the sidebars.
      const root = getComputedStyle(document.documentElement)
      const left = parseFloat(root.getPropertyValue("--left-sidebar")) || 0, right = parseFloat(root.getPropertyValue("--right-sidebar")) || 0
      const still = u.timeStamp - last.t > 80
      const cx = r.left + r.width / 2 + (still ? 0 : v.x * 180), cy = r.top + r.height / 2 + (still ? 0 : v.y * 180)
      const next = `${cy < innerHeight / 2 ? "t" : "b"}${cx < (left + innerWidth - right) / 2 ? "l" : "r"}` as Corner
      if (next === corner) settle(el, { x: r.left, y: r.top })
      else { from.current = { x: r.left, y: r.top }; setCorner(next) }
    }
    addEventListener("pointermove", move)
    addEventListener("pointerup", up)
    addEventListener("pointercancel", up)
  }
  // A drag isn't a click on what it started on (the note, a button).
  const onClickCapture = (e: MouseEvent) => { if (dragged.current) { dragged.current = false; e.stopPropagation(); e.preventDefault() } }
  return { ref: card, onPointerDown, onClickCapture }
}

function Bar({ desktop, corner, setCorner }: { desktop: boolean; corner: Corner; setCorner: (c: Corner) => void }) {
  const now = useNow()!
  const { el, path, video, from } = now
  useTick(el)
  const box = useRef<HTMLDivElement>(null)
  // A video nothing else draws plays here; a view of it that comes back takes it again (Player.tsx).
  useLayoutEffect(() => {
    if (video && box.current && !homeOf(el) && !presenting(el) && el.parentElement !== box.current) {
      el.controls = false // (the bar has them; the picture's own can't be reached under the drag)
      box.current.append(el)
    }
  })
  const drag = useCornerDrag(corner, setCorner)
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
    <div data-mini-player role="region" aria-label="Now playing" {...(desktop ? drag : {})}
      className={cn("glass-strong fixed z-[19] overflow-hidden", desktop ? cn("w-[340px] touch-none rounded-[12px] select-none transition-[left,right] duration-200 ease-out data-dragging:cursor-grabbing data-dragging:shadow-2xl data-dragging:transition-none", CORNERS[corner])
        : "inset-x-2 rounded-[14px]")}
      style={desktop ? undefined : { bottom: "calc(var(--phone-bar) + 0.5rem)" }}>
      {desktop && inMini && <div ref={box} onClick={open} className="aspect-video w-full cursor-pointer bg-black [&>video]:size-full [&>video]:object-contain [&>video]:pointer-events-none" />}
      <div className={cn("flex items-center gap-2", desktop ? "h-11 px-2" : "h-[60px] px-2")}>
        {!desktop && inMini ? <div ref={box} onClick={open} className="h-11 w-[78px] shrink-0 cursor-pointer overflow-hidden rounded-[8px] bg-black [&>video]:size-full [&>video]:object-cover [&>video]:pointer-events-none" />
          : !inMini || !desktop ? (pic ? <img src={rawUrl(pic)} alt="" draggable={false} onClick={open} className="size-11 shrink-0 cursor-pointer rounded-[8px] object-cover md:size-8 md:rounded-[6px]" />
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
