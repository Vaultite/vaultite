import { StrictMode, useEffect, useLayoutEffect, useReducer, useRef, useState, useSyncExternalStore } from "react"
import { createRoot } from "react-dom/client"
import { Check, CircleHelp, Mic, Play, Square, VolumeOff } from "lucide-react"
import { Marked } from "marked"
import "./index.css"
import { makePill } from "@/core/pill"
import { snippet } from "@/core/plaintext"
import { sanitizeHtml } from "@/core/sanitize"
import { joinText } from "../../core/dictationtext"
import { CURSOR_SPRING, glide, type Glide } from "@/core/spring"
import { makePilot, type PenScript, type Pilot } from "@/core/pilot"
import { trackSoon } from "@/core/unsaved"
import { type Sample, TRAIL, trailPieces } from "@/core/trail"
import { type Cue, cueLength, playCue } from "@/core/cues"
import { penSound } from "@/core/pensound"
import { cn, followSystemTheme } from "@/lib/utils"
import { presence, type Mark as MarkKind } from "../../core/desktop/cursor"
import { arrowBox, boxAt, flagBox } from "../../core/desktop/boxes"
import { Chat, type ChatItem } from "@/components/Chat"
import { type DrawBridge, ScreenDrawings } from "./screendraw"
import { type Box, HOLD, tellHolds } from "./screendraw/hold"
import { Region, REGION_STYLE } from "./screenregion"
import { Island, ISLAND_STYLE } from "./screenisland"
import type { RegionScene } from "../../core/desktop/clips"

type Point = { x: number; y: number }
type Rect = { x: number; y: number; width: number; height: number }
type Say = { id: string; text: string; question?: boolean }
type Doing = { doing?: string; paused?: boolean }
type Agent = { name: string; tint: string; state: string; sx: number; sy: number; t?: number; seen?: boolean; why?: string; from?: Point; leaving?: boolean; target?: Rect; say?: Say } & Doing
type Summoned = Doing & { name: string; tint: string; state: "listening" | "thinking" | "watching" | "missed"; sx: number; sy: number; words?: string; from?: Point; leaving?: boolean
  missed?: string
  follow?: boolean; aim?: { id: string; x: number; y: number }; level?: number; drag?: boolean }
type Shown = { width: number; height: number; top: number; agents: Agent[]; summon: Summoned | null
  pill: { level: number; text: string; pending?: string; ready: boolean; free?: boolean; hint?: boolean } | null
  speaking?: { name: string; level?: number } | null
  region?: RegionScene | null
  behind?: Behind | null }
type Behind = { agent: string; tint: string; app: string; title: string; img: string; aspect: number; cursor: Point | null; caption: string
  end?: "done" | "unsure"; edge: { right: number; bottom: number } }
type At = { agents: Record<string, number[]>; summon: [number, number] | null; level?: number; hear?: number }
type PanelData = { name: string; tint: string; items: ChatItem[]; busy?: boolean; words?: { text: string; listening: boolean; done?: boolean; id?: number; send?: boolean }
  hint?: string
  play?: "play" | "stop"
  quiet?: string }
export type ScreenBridge = { on: (fn: (s: Shown) => void) => () => void; onAt: (fn: (a: At) => void) => () => void
  holds?: (m: { boxes: Box[]; pressing: boolean }) => void; near?: () => void
  onPointer?: (fn: (p: [number, number, number, number]) => void) => () => void; pilot?: (to: [number, number] | null) => void
  pen?: (s: PenScript | null) => void; onPen?: (fn: (s: PenScript | null) => void) => () => void
  onCue?: (fn: (name: Cue) => void) => () => void
  open: (name: string, x: number, y: number) => void; stop: () => void; draw?: DrawBridge
  region?: (r: Rect) => void; regionAct?: (what: string) => void
  panel: { on: (fn: (d: PanelData) => void) => () => void; size: (h: number) => void; send: (text: string) => void; close: (esc?: boolean) => void; mic: () => void; play?: () => void; stop?: () => void; notCall?: () => void; more: (x: number, y: number) => void } }
const api = window.vaultiteScreen

followSystemTheme()

type Paint = (el: HTMLElement, x: number, y: number) => void
type Mover = { g: Glide; tx: number; ty: number; w: number; el: HTMLElement | null; paint: Paint }
const movers = new Map<string, Mover>()
const AGENT = CURSOR_SPRING
let raf = 0, last = 0

function frame(t: number) {
  const dt = last ? Math.min(0.05, (t - last) / 1000) : 1 / 60
  last = t
  let moving = false
  for (const m of movers.values()) {
    if (!glide(m.g, m.tx, m.ty, m.w, dt)) moving = true
    if (m.el) m.paint(m.el, m.g.x, m.g.y)
  }
  if (flying.pilot && flyPose(t + clockOff)) moving = true
  if (trail.pts.length && drawTrail(t + clockOff)) moving = true
  raf = moving ? requestAnimationFrame(frame) : 0
  if (!moving) last = 0
}
let clockOff = Date.now() - performance.now()
const clock = () => performance.now() + clockOff
trackSoon("the cursor's motion", () => raf !== 0)
const kick = () => { if (!raf) { clockOff = Date.now() - performance.now(); raf = requestAnimationFrame(frame) } }

const flying: { pilot: Pilot | null; el: HTMLElement | null; to: string; reduced: boolean; at: Point | null; sound: boolean; inked: { x: number; y: number; t: number } | null } = { pilot: null, el: null, to: "", reduced: matchMedia("(prefers-reduced-motion: reduce)").matches, at: null, sound: false, inked: null }
const pen = penSound(() => (audio ??= new AudioContext()), () => napAudio())
function flyPose(now: number) {
  const pilot = flying.pilot!, pose = pilot.pose(now), el = flying.el
  flying.at = { x: pose.x, y: pose.y }
  const onHere = pose.x > -40 && pose.y > -40 && pose.x < innerWidth + 40 && pose.y < innerHeight + 40
  if (pose.ink && flying.sound && onHere) {
    const was = flying.inked, dt = was ? (now - was.t) / 1000 : 0
    if (was && dt > 0) pen.ink(Math.hypot(pose.x - was.x, pose.y - was.y) / dt)
    flying.inked = { x: pose.x, y: pose.y, t: now }
  } else if (flying.inked) { flying.inked = null; pen.lift() }
  if (el) {
    paintCursor(el, pose.x, pose.y)
    el.style.setProperty("--pilot-scale", pose.scale.toFixed(3))
    const on = pose.x > -40 && pose.y > -40 && pose.x < innerWidth + 40 && pose.y < innerHeight + 40
    el.style.visibility = on ? "" : "hidden"
    el.toggleAttribute("data-parked", pose.mode === "parked")
    el.toggleAttribute("data-moving", pose.mode === "fly" || pose.mode === "pen" || pose.mode === "back")
    const to = pose.to ? `${Math.round(pose.to.x)},${Math.round(pose.to.y)}` : ""
    if (on && to !== flying.to) { flying.to = to; api?.pilot?.(pose.to ? [Math.round(pose.to.x), Math.round(pose.to.y)] : null) }
  }
  return pose.busy
}
function startFlying(c: Summoned) {
  const now = clock()
  if (!flying.pilot) {
    flying.pilot = makePilot({ reduced: flying.reduced }); flying.to = ""
    flying.pilot.pointer({ x: c.sx - 24, y: c.sy - 20 }, { x: c.sx, y: c.sy }, now)
  }
  if (c.state === "listening") flying.pilot.release(now)
  flying.pilot.aim(c.state === "listening" ? null : c.aim ?? null, now)
  kick()
}
let audio: AudioContext | null = null
function cueNow(name: Cue) {
  audio ??= new AudioContext()
  if (audio.state === "suspended") void audio.resume()
  playCue(audio, name)
  napAudio(cueLength(name) * 1000)
}
let audioUntil = 0, audioNap: ReturnType<typeof setTimeout> | undefined
function napAudio(ms = 0) {
  audioUntil = Math.max(audioUntil, Date.now() + ms)
  clearTimeout(audioNap)
  audioNap = setTimeout(() => { if (!pen.busy() && audio?.state === "running") void audio.suspend() }, audioUntil - Date.now() + 300)
}
function pointerMoved(p: [number, number, number, number]) {
  if (view.s?.summon?.state === "listening" && !view.s.summon.drag) {
    if (!trail.pts.length || trail.tint !== view.s.summon.tint) { trail.tint = view.s.summon.tint; trail.colour = getComputedStyle(document.documentElement).getPropertyValue(`--${trail.tint}`).trim() || "#e8590c" }
    trail.pts.push({ x: p[0], y: p[1], t: clock() })
    kick()
  }
  if (!flying.pilot) return
  flying.pilot.pointer({ x: p[0], y: p[1] }, { x: p[2], y: p[3] }, clock())
  kick()
}

const trail: { pts: Sample[]; tint: string; colour: string; el: HTMLCanvasElement | null; mask: HTMLCanvasElement | null
  into: number } = { pts: [], tint: "", colour: "#e8590c", el: null, mask: null, into: 0 }
const INTO_MS = 380
const ALPHA = "vaultite-trail-alpha"
function drawTrail(now: number) {
  const held = view.s?.summon?.state === "listening"
  if (flying.reduced && !held) trail.pts = []
  const gone = trail.into && !held ? Math.min(1, (now - trail.into) / INTO_MS) : 0, to = flying.at
  if (gone >= 1) trail.pts = []
  const pull = (p: Sample, i: number, all: Sample[]) => {
    if (!gone || !to) return p
    const f = Math.min(1, gone * (1.6 - (0.6 * (all.length - 1 - i)) / Math.max(1, all.length - 1))), e = f * f * (3 - 2 * f)
    return { ...p, x: p.x + (to.x - p.x) * e, y: p.y + (to.y - p.y) * e }
  }
  const pieces = trailPieces(trail.pts.map(pull), now, { still: flying.reduced })
  const newest = trail.pts.at(-1)
  if (!pieces.length && (!held || !newest || now - newest.t > (flying.reduced ? TRAIL.still : TRAIL.fade))) trail.pts = []
  else if (trail.pts.length > 600) trail.pts = trail.pts.filter((p) => now - p.t < TRAIL.fade)
  const c = trail.el ??= Object.assign(document.createElement("canvas"), { className: "pointer-events-none fixed inset-0", ariaHidden: "true" })
  if (!c.isConnected) {
    document.body.prepend(c)
    document.body.insertAdjacentHTML("beforeend", `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><filter id="${ALPHA}" color-interpolation-filters="sRGB"><feColorMatrix type="luminanceToAlpha"/></filter></svg>`)
  }
  const dpr = devicePixelRatio || 1, w = Math.round(innerWidth * dpr), h = Math.round(innerHeight * dpr)
  const want = trail.pts.length ? [w, h] : [0, 0]
  if (c.width !== want[0] || c.height !== want[1]) { c.width = want[0]; c.height = want[1]; c.style.width = `${innerWidth}px`; c.style.height = `${innerHeight}px` }
  const g = c.getContext("2d")
  if (!g || !trail.pts.length) return false
  g.setTransform(1, 0, 0, 1, 0, 0)
  g.clearRect(0, 0, w, h)
  if (!pieces.length) return true
  const pad = TRAIL.width, xs = pieces.flatMap((p) => [p.a[0], p.b[0]]), ys = pieces.flatMap((p) => [p.a[1], p.b[1]])
  const x0 = Math.max(0, Math.floor((Math.min(...xs) - pad) * dpr)), y0 = Math.max(0, Math.floor((Math.min(...ys) - pad) * dpr))
  const x1 = Math.min(w, Math.ceil((Math.max(...xs) + pad) * dpr)), y1 = Math.min(h, Math.ceil((Math.max(...ys) + pad) * dpr))
  if (x1 <= x0 || y1 <= y0) return true
  const m = trail.mask ??= document.createElement("canvas")
  if (m.width < x1 - x0 || m.height < y1 - y0) { m.width = Math.max(m.width, x1 - x0); m.height = Math.max(m.height, y1 - y0) }
  const k = m.getContext("2d")!
  k.setTransform(1, 0, 0, 1, 0, 0)
  k.globalCompositeOperation = "source-over"
  k.fillStyle = "#000"
  k.fillRect(0, 0, x1 - x0, y1 - y0)
  k.setTransform(dpr, 0, 0, dpr, -x0, -y0)
  k.globalCompositeOperation = "lighten"
  k.lineCap = "round"
  for (const p of pieces) {
    const grey = Math.round(p.alpha * 255)
    k.strokeStyle = `rgb(${grey},${grey},${grey})`
    k.lineWidth = p.width
    k.beginPath(); k.moveTo(p.a[0], p.a[1]); k.lineTo(p.b[0], p.b[1]); k.stroke()
  }
  g.filter = `url(#${ALPHA})`
  g.drawImage(m, 0, 0, x1 - x0, y1 - y0, x0, y0, x1 - x0, y1 - y0)
  g.filter = "none"
  g.globalCompositeOperation = "source-in"
  g.fillStyle = trail.colour
  g.fillRect(x0, y0, x1 - x0, y1 - y0)
  g.globalCompositeOperation = "source-over"
  return true
}
function penFor(s: PenScript | null, told = false) {
  if (!told) api?.pen?.(s)
  flying.sound = !!s?.sound
  if (!flying.pilot) return
  flying.pilot.pen(s, clock())
  kick()
}

function aim(key: string, x: number, y: number, w: number, from?: Point, now = false) {
  let m = movers.get(key)
  if (!m) {
    const s = from ?? { x, y }
    m = { g: { x: s.x, y: s.y, vx: 0, vy: 0 }, tx: x, ty: y, w, el: null, paint: () => {} }
    movers.set(key, m)
  }
  if (now) { Object.assign(m, { g: { x, y, vx: 0, vy: 0 }, tx: x, ty: y }); if (m.el) m.paint(m.el, x, y); return }
  if (m.tx === x && m.ty === y && m.w === w) return
  Object.assign(m, { tx: x, ty: y, w })
  kick()
}

function attach(key: string, paint: Paint) {
  return (el: HTMLElement | null) => {
    const m = movers.get(key)
    if (!m) return
    m.el = el
    m.paint = paint
    if (el) paint(el, m.g.x, m.g.y)
  }
}
const paintCursor: Paint = (el, x, y) => {
  el.style.transform = `translate(${x - 3}px, ${y - 2}px)`
  const top = view.s?.top ?? 0, area = { x: 0, y: top, width: innerWidth, height: innerHeight - top }, tip = { x, y }
  const flag = el.querySelector<HTMLElement>("[data-flag]"), f = flagBox(tip, flag?.offsetWidth ?? 80, area)
  el.toggleAttribute("data-flag-right", f.right)
  el.toggleAttribute("data-low", f.low)
  const bubble = el.querySelector<HTMLElement>("[data-bubble]")
  if (!bubble) return
  const target = el.dataset.target?.split(",").map(Number), clear = [arrowBox(tip), f, ...(target?.length === 4 ? [{ x: target[0], y: target[1], width: target[2], height: target[3] }] : [])]
  const b = boxAt(tip, { width: bubble.offsetWidth, height: bubble.offsetHeight }, area, clear)
  bubble.style.left = `${b.x - (x - 3)}px`
  bubble.style.top = `${b.y - (y - 2)}px`
  bubble.dataset.side = b.side
  bubble.toggleAttribute("data-up", b.up)
}
function repaint(key: string) {
  const m = movers.get(key)
  if (m?.el) m.paint(m.el, m.g.x, m.g.y)
}

type View = { s: Shown | null; gone: Agent[]; summonGone: Summoned | null; behindGone: Behind | null }
let view: View = { s: null, gone: [], summonGone: null, behindGone: null }
const fading = new Map<string, ReturnType<typeof setTimeout>>()
trackSoon("a cursor fading out", () => fading.size > 0)
const listeners = new Set<() => void>()
const set = (v: Partial<View>) => { view = { ...view, ...v }; for (const l of listeners) l() }
const FADE = 560

function leave(key: string, done: () => void) {
  if (fading.has(key)) return
  fading.set(key, setTimeout(() => { fading.delete(key); movers.delete(key); done() }, FADE))
}
function back(key: string) { clearTimeout(fading.get(key)); fading.delete(key) }
const targetOf = (a: Agent) => (a.target ? [a.target.x, a.target.y, a.target.width, a.target.height].join() : undefined)

const speakAt = (v: number) => document.documentElement.style.setProperty("--speak", String(v))
const hearAt = (v: number) => document.documentElement.style.setProperty("--hear", String(v))
function onScene(s: Shown) {
  const was = view.s
  if (was?.summon?.state === "listening" && s.summon?.state !== "listening" && trail.pts.length) { trail.into = clock(); kick() }
  if (s.summon?.state === "listening") trail.into = 0
  speakAt(s.speaking?.level ?? 0)
  hearAt(s.summon?.level ?? 0)
  for (const a of s.agents) { back(`agent:${a.name}`); aim(`agent:${a.name}`, a.sx, a.sy, AGENT, a.from) }
  if (s.summon?.follow) { back("summon"); startFlying(s.summon) }
  else if (s.summon) { back("summon"); aim("summon", s.summon.sx, s.summon.sy, AGENT, undefined, s.summon.state === "listening") }
  const names = new Set(s.agents.map((a) => a.name))
  const swap = (name: string, key: string) => { const twin = s.summon?.name === name || names.has(name); if (twin) { back(key); movers.delete(key) } return !twin }
  const gone = [...view.gone.filter((a) => !names.has(a.name)), ...(was?.agents ?? []).filter((a) => !names.has(a.name) && !view.gone.some((g) => g.name === a.name))]
    .filter((a) => swap(a.name, `agent:${a.name}`))
  for (const a of gone) leave(`agent:${a.name}`, () => set({ gone: view.gone.filter((g) => g.name !== a.name) }))
  let summonGone = s.summon ? null : view.summonGone ?? was?.summon ?? null
  if (summonGone && !swap(summonGone.name, "summon")) summonGone = null
  if (summonGone) leave("summon", () => { set({ summonGone: null }); if (!view.s?.summon) flying.pilot = null })
  if (!s.summon && !summonGone) flying.pilot = null
  const behindGone = s.behind ? null : view.behindGone ?? was?.behind ?? null
  if (s.behind) back(BEHIND)
  else if (behindGone) leave(BEHIND, () => set({ behindGone: null }))
  set({ s, gone, summonGone, behindGone })
}
function onAt(at: At) {
  speakAt(at.level ?? 0)
  hearAt(at.hear ?? 0)
  for (const a of view.s?.agents ?? []) {
    const p = at.agents[a.name]
    if (!p) continue
    const m = movers.get(`agent:${a.name}`)
    if (m?.el) { if (p.length === 6) m.el.dataset.target = p.slice(2).join(); else delete m.el.dataset.target }
    aim(`agent:${a.name}`, p[0], p[1], AGENT)
  }
  if (view.s?.summon && !view.s.summon.follow && at.summon) aim("summon", at.summon[0], at.summon[1], AGENT, undefined, view.s.summon.state === "listening")
}

function Arrow({ tint }: { tint: string }) {
  return (
    <svg width={20} height={20} viewBox="0 0 20 20" className="drop-shadow-[0_1px_2px_rgba(0,0,0,0.35)]">
      <path d="M3 2.5 L16.5 9.2 L10.3 10.9 L7.6 16.8 Z" fill={tint} stroke="white" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  )
}

function open(name: string, key: string) {
  const m = movers.get(key)
  if (m) api?.open(name, Math.round(m.g.x), Math.round(m.g.y))
}

function Hold({ children, onHover, ...rest }: React.HTMLAttributes<HTMLDivElement> & { onHover?: (on: boolean) => void } & Record<`data-${string}`, unknown>) {
  return (
    <div {...rest} {...HOLD} onPointerEnter={() => onHover?.(true)} onPointerLeave={() => onHover?.(false)}>
      {children}
    </div>
  )
}

function useAge(t?: number): 0 | 1 | 2 | 3 {
  const [, tick] = useReducer((n: number) => n + 1, 0)
  const since = t ? Date.now() - t : Infinity, age = since < 3000 ? 0 : since < 4000 ? 1 : since < 8000 ? 2 : 3
  useEffect(() => {
    if (age === 3) return
    const id = setTimeout(tick, [3000, 4000, 8000][age] - since + 20)
    return () => clearTimeout(id)
  }, [t, age])
  return age
}

function Mark({ mark, at }: { mark: MarkKind | "speak" | "hear"; at?: number }) {
  if (mark === "speak") return <span className="companion-speak" aria-label="speaking"><i /><i /><i /></span>
  if (mark === "hear") return <span className="companion-hear" aria-label="listening"><i /><i /><i /><i /></span>
  if (mark === "dots") return <span className="companion-dots" aria-hidden><i /><i /><i /></span>
  if (mark === "wave") return <span className="companion-wave" aria-hidden><i /><i /><i /></span>
  if (mark === "tick") return <Check key={at} className="companion-seen size-3" strokeWidth={3} aria-label="seen" />
  return null
}

const FLAG = cn("absolute top-[18px] left-[13px] flex items-center gap-1 rounded-full px-2 py-[2px] text-[11.5px] font-semibold whitespace-nowrap text-white shadow-sm transition-opacity duration-300",
  "group-data-[flag-right]:right-[-6px] group-data-[flag-right]:left-auto group-data-[low]:top-[-20px]")
const WORDS = cn("companion-pop absolute top-0 left-0 flex w-max max-w-[320px] flex-col rounded-[12px] border border-border/60 px-3 py-1.5 text-[13.5px] leading-snug text-foreground shadow-lg",
  "data-[side=right]:data-up:rounded-bl-[4px] data-[side=left]:data-up:rounded-br-[4px] data-[side=right]:not-data-up:rounded-tl-[4px] data-[side=left]:not-data-up:rounded-tr-[4px]")
const FADES = "screen-in group fixed top-0 left-0 transition-opacity duration-300 data-gone:pointer-events-none data-gone:opacity-0 data-gone:duration-500 data-gone:ease-out data-leaving:delay-150"

function Cursor({ a, gone, speaking }: { a: Agent; gone?: boolean; speaking?: boolean }) {
  const tint = `var(--${a.tint})`, key = `agent:${a.name}`
  const [hover, setHover] = useState(false), age = useAge(a.t)
  const shown = presence({ state: a.state as Parameters<typeof presence>[0]["state"], seen: a.seen, why: a.why }, { bubble: !!a.say, age, looked: hover })
  useLayoutEffect(() => repaint(key), [key, a.say?.id, a.say?.text, shown.flag, shown.words])
  return (
    <div ref={attach(key, paintCursor)} data-gone={gone || a.leaving || undefined} data-leaving={a.leaving || undefined} data-target={targetOf(a)}
      className={cn(FADES, "pointer-events-none", shown.dim && "opacity-55")}>
      <div className={cn("relative", shown.bob && "companion-bob")}><Arrow tint={tint} /></div>
      <div data-flag style={{ background: tint }} className={cn(FLAG, !shown.flag && !speaking && !a.doing && "opacity-0")}>
        {a.name}
        {shown.words && !speaking && !a.doing && <span className="font-medium opacity-85">{shown.words}</span>}
        <Mark mark={speaking ? "speak" : a.doing ? null : shown.mark} at={a.t} />
        {a.doing ? <Doing d={a} /> : shown.why && <span className="max-w-[220px] truncate font-medium opacity-90">{shown.why}</span>}
      </div>
      {a.say && (
        <Hold onPointerDown={(e) => { if (e.button === 0) open(a.name, key) }} onHover={setHover} data-bubble
          className={cn(WORDS, "pointer-events-auto cursor-pointer", a.say.question ? "bg-[color-mix(in_srgb,var(--c)_9%,var(--background))]" : "bg-background")}
          style={{ "--c": tint,
            boxShadow: `0 0 0 ${a.say.question ? 2 : 1.5}px color-mix(in srgb, ${tint} ${a.say.question ? 70 : 45}%, transparent), 0 8px 24px rgba(0,0,0,.12)` }}>
          <span data-bubble-text className="line-clamp-[12]">{snippet(a.say.text)}</span>
        </Hold>
      )}
    </div>
  )
}

function Summon({ c, gone, speaking }: { c: Summoned; gone?: boolean; speaking?: boolean }) {
  const tint = `var(--${c.tint})`
  useLayoutEffect(() => { if (c.follow) { if (flying.pilot && flying.el) flyPose(clock()) } else repaint("summon") }, [c.words, c.state, c.follow])
  const ref = c.follow ? (el: HTMLElement | null) => { flying.el = el; if (el && flying.pilot) flyPose(clock()) } : attach("summon", paintCursor)
  return (
    <div ref={ref} data-gone={gone || c.leaving || undefined} data-companion-summoned={c.state} data-follow={c.follow || undefined} data-speaking={speaking || undefined}
      className={cn(FADES, "pointer-events-none")} style={{ "--c": tint }}>
      <span aria-hidden className="companion-glow" />
      <div className="pilot-arrow relative origin-[3px_2px] [scale:var(--pilot-scale,1)]"><div className={cn(c.state === "thinking" && "companion-bob", c.state === "missed" && "companion-miss")}><Arrow tint={tint} /></div></div>
      <div data-flag style={{ background: tint }} className={FLAG}>
        {c.name}
        {c.state === "missed" && c.missed && <span data-companion-missed className="font-medium opacity-90">{c.missed}</span>}
        {c.doing && c.state !== "listening" && <Doing d={c} />}
        <Mark mark={speaking && c.state !== "listening" ? "speak" : c.state === "listening" ? (c.level === undefined ? "wave" : "hear") : c.state === "thinking" && !c.doing ? "dots" : null} />
      </div>
      {c.words && <div data-bubble className={cn(WORDS, "bg-background")} style={{ boxShadow: `0 0 0 1.5px color-mix(in srgb, ${tint} 45%, transparent), 0 8px 24px rgba(0,0,0,.12)` }}>
        <span className="line-clamp-[8] text-foreground/80">{c.words}</span>
      </div>}
    </div>
  )
}

function Doing({ d }: { d: Doing }) {
  return <span key={d.doing} data-companion-doing={d.paused ? "paused" : "doing"} className={cn("screen-in max-w-[260px] truncate font-medium", d.paused ? "opacity-75 italic" : "opacity-90")}>{d.doing}</span>
}

const THUMB_W = 268, THUMB_H = 200, BEHIND = "behind"
function fitted(aspect: number) {
  const h = Math.min(THUMB_H, Math.round(THUMB_W / (aspect || 1)))
  return { h, w: Math.min(THUMB_W, Math.round(h * (aspect || 1))) }
}
const paintArrow: Paint = (el, x, y) => { el.style.transform = `translate(${x - 3}px, ${y - 2}px)` }
function BehindCard({ b, gone }: { b: Behind; gone?: boolean }) {
  const tint = `var(--${b.tint})`, { w, h } = fitted(b.aspect), arrow = useRef<HTMLDivElement>(null)
  const x = b.cursor ? (THUMB_W - w) / 2 + b.cursor.x * w : null, y = b.cursor ? b.cursor.y * h : null
  useLayoutEffect(() => {
    if (x === null || y === null) return
    aim(BEHIND, x, y, AGENT)
    attach(BEHIND, paintArrow)(arrow.current)
  }, [x, y])
  const sub = b.end === "done" ? "Done" : b.end === "unsure" ? "Couldn't confirm" : `${b.agent} in ${b.app}`
  return (
    <div data-companion-behind={b.end ?? "doing"} data-gone={gone || undefined}
      className="behind-in pointer-events-none fixed w-[280px] rounded-[14px] bg-card p-1.5 transition-[opacity,translate] duration-300 data-gone:translate-y-1.5 data-gone:opacity-0"
      style={{ right: 16 + b.edge.right, bottom: 16 + b.edge.bottom,
        boxShadow: `0 0 0 1.5px color-mix(in srgb, ${tint} 45%, transparent), 0 14px 36px rgba(0,0,0,.2), 0 2px 8px rgba(0,0,0,.08)` }}>
      <div className="relative" style={{ height: h }}>
        <img src={b.img} alt="" draggable={false} className="absolute top-0 h-full max-w-none rounded-[8.5px] shadow-[0_0_0_0.5px_rgba(0,0,0,.18),0_1px_4px_rgba(0,0,0,.14)]"
          style={{ left: (THUMB_W - w) / 2, width: w }} />
        <div ref={arrow} className={cn("absolute top-0 left-0 transition-opacity duration-200", !b.cursor && "opacity-0")}>
          {!b.end && <span key={b.caption} aria-hidden className="behind-tap" style={{ "--c": tint }} />}
          <Arrow tint={tint} />
        </div>
      </div>
      <div className="flex items-center gap-2 px-1.5 pt-2 pb-1">
        <div className="min-w-0 flex-1 leading-tight">
          <div key={b.caption} className="screen-in truncate text-[13px] font-medium text-foreground">{b.caption}</div>
          <div key={sub} className="screen-in truncate text-[11.5px] text-muted-foreground">{sub}</div>
        </div>
        {b.end === "done" ? <span key="done" className="companion-seen flex size-5 shrink-0 items-center justify-center rounded-full text-white" style={{ background: tint }}><Check className="size-3" strokeWidth={3} /></span>
          : b.end === "unsure" ? <CircleHelp key="unsure" className="screen-in size-[18px] shrink-0 text-muted-foreground" />
          : <span className="companion-dots mr-1 shrink-0" style={{ color: tint }}><i /><i /><i /></span>}
      </div>
    </div>
  )
}

const BOX_AT = "screen-box fixed right-3 flex max-w-[380px] justify-end"
function Hint({ text, top }: { text: string; top: number }) {
  return <div className={cn("screen-in pointer-events-none", BOX_AT)} style={{ top: top + 8 }}><div className="dictation-pill" data-ready><span className="dictation-pending">{text}</span></div></div>
}

function Pill({ p, top }: { p: NonNullable<Shown["pill"]>; top: number }) {
  const bars = useRef<HTMLDivElement>(null), now = useRef(p)
  now.current = p
  useEffect(() => {
    const pill = makePill()
    bars.current!.append(pill.el)
    let raf = requestAnimationFrame(function frame(t) { raf = requestAnimationFrame(frame); pill.set(now.current.level, now.current.ready, "", t) })
    return () => { cancelAnimationFrame(raf); pill.el.remove() }
  }, [])
  const said = !!(p.text || p.pending)
  return (
    <Hold className={cn("screen-in cursor-default", BOX_AT)} style={{ top: top + 8 }} onPointerDown={() => api?.stop()}>
      <div className="dictation-box" data-said={said ? "" : undefined}>
        <div className="flex items-center gap-2"><div ref={bars} />{p.free && <span className="dictation-free">Hands-free</span>}</div>
        {said && <div className="dictation-words" data-long={p.text.length + (p.pending?.length ?? 0) > 300 ? "" : undefined}><p>{p.text}{p.text && p.pending ? " " : ""}<span className="dictation-pending-words">{p.pending}</span></p></div>}
      </div>
    </Hold>
  )
}

const marked = new Marked({ gfm: true, breaks: true })
const linkAttrs = (href: string) => (/^https?:/i.test(href) ? ` href="${href.replace(/"/g, "&quot;")}" target="_blank" rel="noreferrer"` : null)
const html = (text: string) => sanitizeHtml(marked.parse(text, { async: false }) as string, { link: linkAttrs, image: () => null })
const TIME = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" })

function Panel() {
  const [d, setD] = useState<PanelData | null>(null)
  const [draft, setDraft] = useState("")
  const took = useRef(0), box = useRef<HTMLDivElement>(null)
  useEffect(() => api?.panel.on((x) => {
    setD(x)
    const w = x.words
    if (w?.done && w.id && w.id !== took.current) {
      took.current = w.id
      setDraft((v) => { const all = (v + joinText(v, w.text)).trimStart(); if (!w.send || !all.trim()) return all; api?.panel.send(all); return "" })
    }
  }), [])
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") api?.panel.close(true) }
    const focused = () => { const f = document.querySelector<HTMLInputElement>("[data-companion-popover] input"); if (f && document.activeElement !== f) f.focus() }
    addEventListener("keydown", esc)
    addEventListener("focus", focused)
    return () => { removeEventListener("keydown", esc); removeEventListener("focus", focused) }
  }, [])
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const tell = () => api?.panel.size(el.offsetHeight)
    tell()
    const ro = new ResizeObserver(tell)
    ro.observe(el)
    return () => ro.disconnect()
  }, [d === null])
  if (!d) return null
  const listening = !!d.words?.listening, heard = listening ? d.words!.text : ""
  const text = heard ? (draft + joinText(draft, heard)).trimStart() : draft
  const tint = `var(--${d.tint})`
  return (
    <div ref={box} className="w-fit p-4">
      <Chat name={d.name} tint={tint} items={d.items} draft={text} setDraft={listening ? () => {} : setDraft} focus placeholder={d.hint} windowed
        send={() => { if (text.trim()) { api?.panel.send(text); setDraft("") } }} busy={d.busy} close={() => api?.panel.close()} more={(e) => api?.panel.more(e.clientX, e.clientY)}
        words={(n) => <div className="note-prose compact companion-md" dangerouslySetInnerHTML={{ __html: html(n.text ?? "") }} />}
        time={(t) => TIME.format(t)}
        notice={d.quiet && (
          <div data-companion-quiet role="status" className="flex items-center gap-2 border-t border-border/60 py-1 pr-1.5 pl-3 text-[12px] text-muted-foreground">
            <VolumeOff className="size-3.5 shrink-0" aria-hidden />
            <span className="min-w-0 flex-1 truncate">{d.quiet}</span>
            <button type="button" data-tip="Speak again until it lets go of the mic"
              className="h-6 shrink-0 cursor-pointer rounded-full bg-foreground/[0.06] px-2.5 font-medium text-foreground hover:bg-foreground/[0.11]" onClick={() => api?.panel.notCall?.()}>
              Not a call
            </button>
          </div>
        )}
        tools={<>
          {d.play && (
            <button type="button" aria-label={d.play === "stop" ? "Stop speaking" : "Say it aloud"} aria-pressed={d.play === "stop"} data-tip={d.play === "stop" ? "Stop" : "Say it aloud"}
              className="mr-1 grid size-7 shrink-0 cursor-pointer place-items-center rounded-full text-muted-foreground hover:bg-foreground/[0.07] hover:text-foreground aria-pressed:text-white aria-pressed:hover:bg-[var(--c)]"
              style={{ "--c": tint, ...(d.play === "stop" ? { background: tint } : {}) }}
              onClick={() => (d.play === "stop" ? api?.panel.stop?.() : api?.panel.play?.())}>
              {d.play === "stop" ? <Square className="size-3 fill-current" /> : <Play className="size-4 translate-x-px" />}
            </button>
          )}
          <button type="button" aria-label={listening ? "Stop dictating" : "Dictate"} aria-pressed={listening} data-tip={listening ? "Stop" : "Dictate"}
            className="mr-1 grid size-7 shrink-0 cursor-pointer place-items-center rounded-full text-muted-foreground hover:bg-foreground/[0.07] hover:text-foreground aria-pressed:text-white aria-pressed:hover:bg-[var(--c)]"
            style={{ "--c": tint, ...(listening ? { background: tint } : {}) }} onClick={() => api?.panel.mic()}>
            {listening ? <span className="companion-wave" aria-hidden><i /><i /><i /></span> : <Mic className="size-4" />}
          </button>
        </>} />
    </div>
  )
}

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }
function Screen() {
  const { s, gone, summonGone, behindGone } = useSyncExternalStore(subscribe, () => view)
  useEffect(() => { const a = api?.on(onScene), b = api?.onAt(onAt), c = api?.onPointer?.(pointerMoved), d = api?.onCue?.(cueNow), e = api?.onPen?.((s) => penFor(s, true))
    return () => { a?.(); b?.(); c?.(); d?.(); e?.() } }, [])
  if (!s) return null
  return (
    <>
      <ScreenDrawings pen={s.summon?.follow ? penFor : undefined} />
      {s.agents.map((a) => <Cursor key={a.name} a={a} speaking={s.speaking?.name === a.name} />)}
      {gone.map((a) => <Cursor key={a.name} a={a} gone />)}
      {(s.summon ?? summonGone) && <Summon c={(s.summon ?? summonGone)!} gone={!s.summon} speaking={!!s.summon && s.speaking?.name === s.summon.name} />}
      {s.region && <Region r={s.region} top={s.top} moved={(r) => api?.region?.(r)} act={(w) => api?.regionAct?.(w)} />}
      {(s.behind ?? behindGone) && <BehindCard b={(s.behind ?? behindGone)!} gone={!s.behind} />}
      {s.pill && (s.pill.hint ? <Hint text={s.pill.text} top={s.top} /> : <Pill p={s.pill} top={s.top} />)}
    </>
  )
}

const STYLE = `
.screen-in { animation: screen-in .2s ease-out; }
@keyframes screen-in { from { opacity: 0; } }
.companion-bob { animation: companion-bob 1.1s ease-in-out infinite; }
@keyframes companion-bob { 50% { transform: translate(1px, -3px) rotate(-6deg); } }
.companion-dots { display: inline-flex; gap: 2px; }
.companion-dots i { width: 3px; height: 3px; border-radius: 9px; background: currentColor; animation: companion-dot 1s infinite ease-in-out; }
.companion-dots i:nth-child(2) { animation-delay: .15s } .companion-dots i:nth-child(3) { animation-delay: .3s }
@keyframes companion-dot { 0%, 80%, 100% { opacity: .35 } 40% { opacity: 1 } }
.companion-wave { display: inline-flex; align-items: center; gap: 1.5px; height: 9px; }
.companion-wave i { width: 2px; height: 100%; border-radius: 9px; background: currentColor; transform-origin: center; animation: companion-wave 1s infinite ease-in-out; }
.companion-wave i:nth-child(2) { animation-delay: .2s } .companion-wave i:nth-child(3) { animation-delay: .4s }
.companion-hear { display: inline-flex; align-items: center; gap: 1.5px; height: 10px; }
.companion-hear i { width: 2px; height: 100%; border-radius: 9px; background: currentColor; transform: scaleY(min(1, calc(.25 + var(--hear, 0) * var(--k)))); transition: transform 70ms ease-out; }
.companion-hear i:nth-child(1) { --k: .5 } .companion-hear i:nth-child(2) { --k: 1 } .companion-hear i:nth-child(3) { --k: .8 } .companion-hear i:nth-child(4) { --k: .4 }
.companion-speak { display: inline-flex; align-items: center; gap: 1.5px; height: 10px; }
.companion-speak i { width: 2px; height: 100%; border-radius: 9px; background: currentColor; transform: scaleY(min(1, calc(.3 + var(--speak, 0) * .6))); transition: transform 90ms ease-out; }
.companion-speak i:nth-child(2) { transform: scaleY(min(1, calc(.3 + var(--speak, 0) * .9))); }
@keyframes companion-wave { 0%, 100% { transform: scaleY(.35) } 50% { transform: scaleY(1) } }
.companion-seen { animation: companion-seen .5s ease-out; }
@keyframes companion-seen { from { opacity: 0; scale: .4; } }
.companion-pop { animation: companion-pop .28s cubic-bezier(.2,.9,.3,1.25); transform-origin: top left; }
@keyframes companion-pop { from { opacity: 0; scale: .9; } }
[data-parked] .pilot-arrow { animation: pilot-float 2.6s ease-in-out infinite; }
.companion-miss { animation: companion-miss .45s ease-in-out; }
@keyframes companion-miss { 20% { translate: -3px 0; } 45% { translate: 3px 0; } 70% { translate: -2px 0; } }
.companion-glow { position: absolute; left: -14px; top: -15px; width: 34px; height: 34px; border-radius: 99px; pointer-events: none; opacity: 0; scale: .6;
  background: radial-gradient(circle, color-mix(in srgb, var(--c) 55%, transparent) 0%, color-mix(in srgb, var(--c) 18%, transparent) 45%, transparent 70%); transition: opacity .3s ease-out, scale .3s ease-out; }
[data-companion-summoned="thinking"]:not([data-speaking]):not([data-moving]) .companion-glow { opacity: 1; scale: 1; animation: companion-glow 1.4s ease-in-out infinite; }
@keyframes companion-glow { 0%, 100% { scale: .8; opacity: .55; } 50% { scale: 1.15; opacity: 1; } }
@keyframes pilot-float { 50% { translate: 0 -3px; } }
.behind-in { animation: behind-in .3s cubic-bezier(.2,.9,.3,1); transform-origin: bottom right; }
@keyframes behind-in { from { opacity: 0; translate: 0 8px; scale: .97; } }
.behind-tap { position: absolute; left: -9px; top: -10px; width: 24px; height: 24px; border-radius: 99px; pointer-events: none; opacity: 0;
  border: 2px solid var(--c); animation: behind-tap .7s ease-out .3s both; }
@keyframes behind-tap { from { opacity: .7; scale: .3; } to { opacity: 0; scale: 1.3; } }
@media (prefers-reduced-motion: reduce) { .companion-miss, .companion-glow, .pilot-arrow, .screen-in, .companion-bob, .companion-pop, .companion-dots i, .companion-wave i, .companion-seen, .behind-in, .behind-tap { animation: none !important; } }
`
document.head.append(Object.assign(document.createElement("style"), { textContent: location.hash === "#island" ? ISLAND_STYLE : STYLE + REGION_STYLE }))
document.documentElement.style.background = "transparent"
if (location.hash !== "#panel") tellHolds(api)
createRoot(document.getElementById("root")!).render(<StrictMode>{location.hash === "#panel" ? <Panel /> : location.hash === "#island" ? <Island /> : <Screen />}</StrictMode>)
