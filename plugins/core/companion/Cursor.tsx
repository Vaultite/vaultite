import { memo, useEffect, useLayoutEffect, useRef, useState } from "react"
import { cn, CURSOR_SPRING, springStep, type Glide, stiffness, moves, dismissNotice, haptic, menuBelow, menuFor, notifyError, useMenuShowing } from "@vaultite"
import { type Agent, answered, type Target, type Note } from "./live"
import { arrowBox, boxAt } from "../../../core/desktop/boxes"
import { presence } from "../../../core/desktop/cursor"
import { agentMenu } from "./session"
import { answerAsk, sameProps } from "./overlaykit"
import { follow, type Spot } from "./spots"
import { Bubble, CORNER, Fan, Mark, Popover } from "./Bubble"

export function Arrow({ tint, size = 20, className, ...rest }: { tint?: string; size?: number; className?: string } & React.SVGProps<SVGSVGElement>) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" className={className ?? "drop-shadow-[0_1px_2px_rgba(0,0,0,0.35)]"} {...rest}>
      <path d="M3 2.5 L16.5 9.2 L10.3 10.9 L7.6 16.8 Z" fill={tint ?? "none"} stroke={tint ? "white" : "currentColor"} strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  )
}

const WRITING_MS = 120
function useGlide(el: React.RefObject<HTMLDivElement | null>, x: number, y: number, instant: boolean, w: number) {
  const g = useRef<Glide | null>(null), to = useRef({ x, y, w }), raf = useRef(0)
  to.current = { x, y, w }
  useLayoutEffect(() => {
    const put = () => { if (el.current && g.current) el.current.style.translate = `${g.current.x}px ${g.current.y}px` }
    if (!g.current || instant || !moves()) {
      cancelAnimationFrame(raf.current)
      raf.current = 0
      g.current = { x, y, vx: 0, vy: 0 }
      return put()
    }
    put()
    if (raf.current) return
    let last = performance.now()
    const frame = (now: number) => {
      const t = to.current, still = springStep(g.current!, t.x, t.y, t.w, Math.max(0, now - last) / 1000)
      last = now
      put()
      raf.current = still ? 0 : requestAnimationFrame(frame)
    }
    raf.current = requestAnimationFrame(frame)
  })
  useEffect(() => () => cancelAnimationFrame(raf.current), [])
}

export const Cursor = memo(function Cursor({ a, spot, said, waiting, others, under, shift, age, typed, open, setOpen, pop, hold }: { a: Agent; spot: Spot; said: Note | null; others: Agent[]; under: boolean
  waiting: boolean
  shift: number
  age: 0 | 1 | 2 | 3
  typed: boolean
  open: boolean; setOpen: (open: boolean) => void; pop: (name: string) => void
  hold: (on: boolean, at?: { x: number; y: number }, text?: Target) => void }) {
  const tint = `var(--${a.tint})`
  const [hover, setHover] = useState(false)
  const [fan, setFan] = useState(false)
  const menuOn = useMenuShowing(), [menued, setMenued] = useState(false)
  useEffect(() => { if (!menuOn) setMenued(false) }, [menuOn])
  const menu = (e: React.MouseEvent, below = false) => { setMenued(true); if (below) menuBelow(e, agentMenu(a)); else menuFor(() => agentMenu(a))(e) }
  const [keep, setKeep] = useState(false), last = useRef<Note | null>(null)
  if (said) last.current = said
  const bubble = said ?? (keep ? last.current : null)
  const still = hover || open || fan || menued || keep
  useEffect(() => {
    if (!still) return
    hold(true)
    return () => hold(false)
  }, [still])
  const shut = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const flagRef = useRef<HTMLButtonElement>(null)
  const box = useRef<HTMLDivElement>(null)
  const at = { ...spot, x: spot.x + shift * 4 }
  const many = others.length > 0
  const keepFan = () => { clearTimeout(shut.current); if (many) setFan(true) }
  const closeFan = (focusFlag = false) => { clearTimeout(shut.current); if (focusFlag) { setFan(false); flagRef.current?.focus() } else shut.current = setTimeout(() => setFan(false), 350) }
  useEffect(() => () => clearTimeout(shut.current), [])
  useEffect(() => { if (!many) setFan(false) }, [many])
  const flagRight = at.x > innerWidth - 140
  const shown = presence(a, { bubble: !!bubble, held: waiting, typed, age, looked: hover || open || fan })
  const seen = shown.mark === "tick", why = shown.why
  const low = !!spot.low, tag = shown.flag && (!under || hover || open)
  useEffect(() => {
    if (!open && !fan) return
    const down = (e: PointerEvent) => { if (!(e.target instanceof Node && box.current?.contains(e.target))) { setOpen(false); setFan(false) } }
    addEventListener("pointerdown", down, true)
    return () => removeEventListener("pointerdown", down, true)
  }, [open, fan, setOpen])
  const docked = !!spot.docked && !open
  const asked = docked ? undefined : a.asks?.event
  useEffect(() => {
    if (!asked) return
    dismissNotice(`inbox-${asked}`)
    const t = setTimeout(() => dismissNotice(`inbox-${asked}`), 1500)
    return () => clearTimeout(t)
  }, [asked])
  const away = !!spot.away && !open
  const wasAway = useRef(false), arriveBy = useRef(0)
  if (wasAway.current && !away) arriveBy.current = Date.now() + 700
  wasAway.current = away
  const arriving = Date.now() < arriveBy.current
  const floats = !docked && !away
  const tx = docked ? at.x : at.x - 3, ty = docked ? at.y : at.y - 2
  const wasDocked = useRef(docked), rested = wasDocked.current && !docked
  wasDocked.current = docked
  useGlide(box, tx, ty, away || arriving || rested, a.state === "writing" || typed ? stiffness(WRITING_MS) : CURSOR_SPRING)
  useLayoutEffect(() => {
    const el = box.current, words = el?.querySelector<HTMLElement>(":scope > [data-companion-bubble], :scope > [data-companion-popover], :scope > [data-companion-ask]")
    if (!el || !words || docked) return
    const o = { x: at.x - 3, y: at.y - 2 }, f = flagRef.current
    const clear = [arrowBox(at), ...(f && f.offsetWidth ? [{ x: o.x + f.offsetLeft, y: o.y + f.offsetTop, width: f.offsetWidth, height: f.offsetHeight }] : []), ...(spot.target ? [spot.target] : [])]
    const b = boxAt(at, { width: words.offsetWidth, height: words.offsetHeight }, { x: 4, y: 4, width: innerWidth - 8, height: innerHeight - 8 }, clear)
    words.style.left = `${b.x - o.x}px`
    words.style.top = `${b.y - o.y}px`
    words.dataset.side = b.side
    words.toggleAttribute("data-up", b.up)
  })
  if (spot.drawn && !bubble && !a.asks) return null
  const enter = (e: React.PointerEvent) => { if (e.pointerType !== "touch") setHover(true) }
  return (
    <div ref={box} className="companion-cursor pointer-events-none fixed top-0 left-0 z-(--z-page-float)" data-agent={a.name} data-floats={floats ? "" : undefined} data-state={a.state} data-seen={seen || undefined} data-open={open || undefined} data-stacked={many ? others.length + 1 : undefined}
      onPointerEnter={enter} onPointerLeave={() => setHover(false)}
      data-docked={docked || undefined} data-faded={(docked && spot.faded) || undefined} data-away={away || undefined} data-loose={spot.loose} data-to={`${Math.round(tx)},${Math.round(ty)}`}
      style={{
        transition: away ? "none" : arriving ? "opacity .2s .35s" : docked ? "opacity .6s ease-out, visibility 0s .6s" : "opacity .3s",
        opacity: docked || away ? 0 : shown.dim ? 0.55 : 1, visibility: docked || away ? "hidden" : undefined, zIndex: spot.rides ? "var(--z-peek-rider)" : open || fan ? "calc(var(--z-page-float) + 2)" : many ? "calc(var(--z-page-float) + 1)" : undefined }}>
      {!spot.drawn && <>
      <div className={cn("relative", shown.bob && "companion-bob")}>
        <Arrow tint={tint} />
      </div>
      <button ref={flagRef} type="button" tabIndex={tag || many ? 0 : -1} aria-label={many ? `${[a, ...others].map((x) => x.name).join(", ")} here` : `Go to ${a.name}`} aria-haspopup={many ? "menu" : undefined} aria-expanded={many ? fan : undefined}
        data-companion-flag data-floats={floats && (tag || fan) ? "" : undefined} data-under-pages={floats && (tag || fan) ? undefined : ""} data-tip={many || !(a.path || a.pane) ? undefined : "Go to where it is"}
        onPointerEnter={(e) => { if (e.pointerType !== "touch") keepFan() }} onPointerLeave={(e) => { if (e.pointerType !== "touch") closeFan() }}
        onFocus={keepFan} onBlur={(e) => { if (!box.current?.querySelector("[data-companion-fan]")?.contains(e.relatedTarget)) closeFan() }}
        onKeyDown={(e) => { if (many && e.key === "ArrowDown") { e.preventDefault(); setFan(true); requestAnimationFrame(() => box.current?.querySelector<HTMLElement>("[data-companion-fan] button")?.focus()) } else if (e.key === "Escape" && fan) { e.preventDefault(); setFan(false) } }}
        onContextMenu={menu}
        onClick={(e) => { if (!many) return follow(a); if (e.detail === 0 || ("pointerType" in e.nativeEvent && e.nativeEvent.pointerType === "touch")) setFan((f) => !f); else follow(a) }}
        className={cn("absolute flex items-center gap-1 rounded-full px-2 py-[2px] text-[11.5px] font-semibold whitespace-nowrap text-white shadow-sm transition-opacity duration-300",
          flagRight ? "right-[-6px]" : "left-[13px]", low ? "top-[-20px]" : "top-[18px]", tag || fan ? "pointer-events-auto cursor-pointer" : "opacity-0 focus-visible:opacity-100")} style={{ background: tint }}>
        {a.name}
        {many && <span className="font-medium opacity-85">+{others.length}</span>}
        {shown.words && !many && <span className="font-medium opacity-85">{shown.words}</span>}
        <Mark mark={shown.mark} label={a.state} at={a.t} />
        {why && <span data-companion-why className="max-w-[220px] truncate font-medium opacity-90">{why}</span>}
      </button>
      {fan && many && !open && <Fan agents={[a, ...others]} up={low} right={flagRight} keep={keepFan} close={closeFan} pop={(name) => { setFan(false); pop(name) }} />}
      {open && <Popover a={a} close={() => setOpen(false)} menu={(e) => menu(e, true)} />}
      </>}
      {!floats ? null : a.asks && !open ? (
        <div key={a.asks.event} data-companion-ask={a.asks.event} data-floats role="group" aria-label={`${a.name} asks`}
          className={cn("companion-pop pointer-events-auto absolute top-0 left-0 flex w-max flex-col gap-1.5 rounded-[12px] border border-border/60 bg-background px-3 py-2 text-[13.5px] leading-snug text-foreground shadow-lg", CORNER)}
          style={{ maxWidth: Math.min(300, innerWidth - 16), boxShadow: `0 0 0 1.5px color-mix(in srgb, ${tint} 45%, transparent), 0 8px 24px rgba(0,0,0,.12)` }}>
          <span>{a.asks.text}</span>
          <span className="flex justify-end gap-1">
            {(["deny", "approve"] as const).map((v) => (
              <button key={v} type="button" data-gate={v} className={cn("cursor-pointer rounded-[7px] px-2.5 py-1 text-[12.5px] font-medium max-sm:py-1.5",
                v === "approve" ? "text-white hover:brightness-110" : "text-muted-foreground hover:bg-foreground/[0.07] hover:text-foreground")}
                style={v === "approve" ? { background: tint } : undefined}
                onClick={() => { haptic("medium"); const undo = answered(a.name); answerAsk(a.asks!.event, v).catch((e) => { undo(); notifyError(e, "Couldn't answer it") }) }}>
                {v === "approve" ? "Approve" : "Deny"}</button>
            ))}
          </span>
        </div>
      ) : bubble && !open && (
        <Bubble n={bubble} tint={tint} drawn={!!spot.drawn} hold={setKeep}
          maxWidth={Math.min(320, innerWidth - 16)} room={Math.min(360, innerHeight - 24)} />
      )}
    </div>
  )
}, sameProps)