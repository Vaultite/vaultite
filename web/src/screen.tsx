// The companion over the screen (electron/overlay.ts): cursors in other apps, bubbles, the companion waiting, the pill; a
// cursor dragged onto a window points, one clicked opens its conversation (#panel: a window that takes the keyboard).
import { StrictMode, useEffect, useLayoutEffect, useReducer, useRef, useState, useSyncExternalStore } from "react"
import { createRoot } from "react-dom/client"
import { Check, Mic } from "lucide-react"
import { Marked } from "marked"
import "./index.css"
import { makePill } from "@/core/pill"
import { snippet } from "@/core/plaintext"
import { sanitizeHtml } from "@/core/sanitize"
import { joinText } from "../../core/dictationtext"
import { CURSOR_SPRING, glide, stiffness, type Glide } from "@/core/spring"
import { cn, followSystemTheme } from "@/lib/utils"
// (what its flag shows, by the window's own rule: the two draw one cursor)
import { presence, type Mark as MarkKind } from "../../plugins/core/companion/look"
import { Chat, type ChatItem } from "../../plugins/core/companion/Chat"

type Point = { x: number; y: number }
type Say = { id: string; text: string; question?: boolean }
type Agent = { name: string; tint: string; state: string; sx: number; sy: number; t?: number; seen?: boolean; why?: string; from?: Point; leaving?: boolean; say?: Say }
type Idle = { name: string; tint: string; sx: number; sy: number; docked: boolean; from?: Point; leaving?: boolean; side?: "left" | "right"; unread?: boolean }
type Shown = { width: number; height: number; top: number; agents: Agent[]; idle: Idle | null
  pill: { level: number; text: string; ready: boolean } | null }
/** Only the places changed (helperlogic.ts splitScene). */
type At = { agents: Record<string, [number, number]>; idle: [number, number] | null }
type PanelData = { name: string; tint: string; how: string; items: ChatItem[]; words?: { text: string; listening: boolean; done?: boolean; id?: number } }
type Bridge = { on: (fn: (s: Shown) => void) => () => void; onAt: (fn: (a: At) => void) => () => void; grab: (on: boolean) => void
  drop: (name: string, x: number, y: number) => void; open: (name: string, x: number, y: number) => void; home: (name: string) => void
  menu: (name: string, x: number, y: number) => void; stop: () => void
  panel: { on: (fn: (d: PanelData) => void) => () => void; size: (h: number) => void; send: (text: string) => void; close: () => void; mic: () => void; more: (x: number, y: number) => void } }
const api = (window as unknown as { vaultiteScreen?: Bridge }).vaultiteScreen

followSystemTheme()

// ---------- motion: each cursor glides on a spring, painted straight onto its element; the loop sleeps when all are still

type Paint = (el: HTMLElement, x: number, y: number) => void
type Mover = { g: Glide; tx: number; ty: number; w: number; el: HTMLElement | null; paint: Paint
  /** Dragged: at the pointer, whatever its target. */
  held: Point | null
  /** Dropped: it stays where it was let go till its target changes (where it was dropped, as the server answers) or a moment passes. */
  left: { until: number; tx: number; ty: number } | null }
const movers = new Map<string, Mover>()
/** An agent's cursor settles in about the in-app one's time; the waiting one trailing the pointer, sooner. */
const AGENT = CURSOR_SPRING, TRAIL = stiffness(160)
let raf = 0, last = 0

function frame(t: number) {
  // (the first frame after a rest counts as one frame, not the whole rest)
  const dt = last ? Math.min(0.05, (t - last) / 1000) : 1 / 60
  last = t
  let moving = false
  for (const m of movers.values()) {
    if (m.held) continue
    if (m.left && t < m.left.until && m.left.tx === m.tx && m.left.ty === m.ty) continue
    m.left = null
    if (!glide(m.g, m.tx, m.ty, m.w, dt)) moving = true
    if (m.el) m.paint(m.el, m.g.x, m.g.y)
  }
  raf = moving ? requestAnimationFrame(frame) : 0
  if (!moving) last = 0
}
const kick = () => { if (!raf) raf = requestAnimationFrame(frame) }

/** Where `key` goes now; a new one starts where it came from (`from`), else there. */
function aim(key: string, x: number, y: number, w: number, from?: Point) {
  let m = movers.get(key)
  if (!m) {
    const s = from ?? { x, y }
    m = { g: { x: s.x, y: s.y, vx: 0, vy: 0 }, tx: x, ty: y, w, el: null, paint: () => {}, held: null, left: null }
    movers.set(key, m)
  }
  if (m.tx === x && m.ty === y && m.w === w) return
  Object.assign(m, { tx: x, ty: y, w })
  kick()
}

/** Its element, painted where it is now (it draws itself after: React never sets its place). */
function attach(key: string, paint: Paint) {
  return (el: HTMLElement | null) => {
    const m = movers.get(key)
    if (!m) return
    m.el = el
    m.paint = paint
    if (el) paint(el, m.held?.x ?? m.g.x, m.held?.y ?? m.g.y)
  }
}
// (the arrow's tip at the point; what opens beside it opens toward the room, as in the window: its bubble above it, or
// below its flag where the menu bar or the screen's top leaves no room)
const paintCursor: Paint = (el, x, y) => {
  el.style.transform = `translate(${x - 3}px, ${y - 2}px)`
  const right = x > innerWidth - 320 && x > innerWidth / 2, low = y + 44 > innerHeight - 8
  el.toggleAttribute("data-right", right)
  el.toggleAttribute("data-flag-right", x > innerWidth - 140)
  el.toggleAttribute("data-low", low)
  const bubble = el.querySelector<HTMLElement>("[data-bubble-text]")?.parentElement
  el.toggleAttribute("data-high", !!bubble && !low && y + 16 - bubble.offsetHeight < (view.s?.top ?? 0) + 6)
  el.style.setProperty("--room", `${Math.round(right ? x - 30 : innerWidth - x - 34)}px`)
}
/** Its element painted again where it is (its bubble came or changed: which way it opens). */
function repaint(key: string) {
  const m = movers.get(key)
  if (m?.el) m.paint(m.el, m.held?.x ?? m.g.x, m.held?.y ?? m.g.y)
}
const paintDot: Paint = (el, x, y) => { el.style.transform = `translate(${x - 10}px, ${y - 10}px)` }
const paintTrail: Paint = (el, x, y) => { el.style.transform = `translate(${x}px, ${y}px) scale(0.7)` }

// ---------- what's drawn: the scene, and what just left it (fading where it was going)

type View = { s: Shown | null; gone: Agent[]; idleGone: Idle | null }
let view: View = { s: null, gone: [], idleGone: null }
const fading = new Map<string, ReturnType<typeof setTimeout>>()
const listeners = new Set<() => void>()
const set = (v: Partial<View>) => { view = { ...view, ...v }; for (const l of listeners) l() }
const FADE = 260

function leave(key: string, done: () => void) {
  if (fading.has(key)) return
  fading.set(key, setTimeout(() => { fading.delete(key); movers.delete(key); done() }, FADE))
}
function back(key: string) { clearTimeout(fading.get(key)); fading.delete(key) }

function onScene(s: Shown) {
  const was = view.s
  for (const a of s.agents) { back(`agent:${a.name}`); aim(`agent:${a.name}`, a.sx, a.sy, AGENT, a.from) }
  if (s.idle) { back("idle"); aim("idle", s.idle.sx, s.idle.sy, s.idle.docked ? AGENT : TRAIL, s.idle.from) }
  const names = new Set(s.agents.map((a) => a.name))
  // (one that became its other form, the cursor or the companion waiting, goes at once: that one glides on from it)
  const swap = (name: string, key: string) => { const twin = s.idle?.name === name || names.has(name); if (twin) { back(key); movers.delete(key) } return !twin }
  const gone = [...view.gone.filter((a) => !names.has(a.name)), ...(was?.agents ?? []).filter((a) => !names.has(a.name) && !view.gone.some((g) => g.name === a.name))]
    .filter((a) => swap(a.name, `agent:${a.name}`))
  for (const a of gone) leave(`agent:${a.name}`, () => set({ gone: view.gone.filter((g) => g.name !== a.name) }))
  let idleGone = s.idle ? null : view.idleGone ?? was?.idle ?? null
  if (idleGone && !swap(idleGone.name, "idle")) idleGone = null
  if (idleGone) leave("idle", () => set({ idleGone: null }))
  set({ s, gone, idleGone })
}
function onAt(at: At) {
  for (const a of view.s?.agents ?? []) { const p = at.agents[a.name]; if (p) aim(`agent:${a.name}`, p[0], p[1], AGENT) }
  if (view.s?.idle && at.idle) aim("idle", at.idle[0], at.idle[1], view.s.idle.docked ? AGENT : TRAIL)
}

// ---------- the pointer: what it's over takes it (to drag, to click); let go, it goes through again

let grabbed = 0
const grab = (on: boolean) => { grabbed = Math.max(0, grabbed + (on ? 1 : -1)); api?.grab(grabbed > 0) }

function Arrow({ tint }: { tint: string }) {
  return (
    <svg width={20} height={20} viewBox="0 0 20 20" className="drop-shadow-[0_1px_2px_rgba(0,0,0,0.35)]">
      <path d="M3 2.5 L16.5 9.2 L10.3 10.9 L7.6 16.8 Z" fill={tint} stroke="white" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  )
}

/** A click on a cursor, to tell a double one (a call back) by the time from the last. */
let clicked = { key: "", at: 0 }, opening: ReturnType<typeof setTimeout> | undefined
const DOUBLE_MS = 300
/** Its conversation, by where it is now. */
function open(name: string, key: string) {
  const m = movers.get(key)
  if (m) api?.open(name, Math.round(m.g.x), Math.round(m.g.y))
}

/** A cursor or the waiting dot: dragged, it's at the pointer (its spring let go); dropped, it tells where and stays there.
 *  Double-clicked, it's called back; right-clicked, its menu. */
function useDrag(name: string, key: string, opensAtOnce = false) {
  const [dragging, setDragging] = useState(false)
  const down = (e: React.PointerEvent<HTMLElement>) => {
    if (e.button === 2) { e.preventDefault(); api?.menu(name, e.clientX, e.clientY); return }
    if (e.button !== 0) return
    e.preventDefault()
    const el = e.currentTarget, id = e.pointerId
    el.setPointerCapture(id)
    const hold = (p: Point | null) => {
      const m = movers.get(key)
      if (!m) return
      m.held = p
      if (p && m.el) m.paint(m.el, p.x, p.y)
    }
    const move = (ev: PointerEvent) => { hold({ x: ev.clientX, y: ev.clientY }); setDragging(true) }
    const up = (ev: PointerEvent) => {
      el.removeEventListener("pointermove", move)
      el.removeEventListener("pointerup", up)
      hold(null)
      setDragging(false)
      const m = movers.get(key)
      if (Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) > 6) {
        if (m) { Object.assign(m, { g: { x: ev.clientX, y: ev.clientY, vx: 0, vy: 0 }, left: { until: performance.now() + 1500, tx: m.tx, ty: m.ty } }); setTimeout(kick, 1550) }
        api?.drop(name, ev.clientX, ev.clientY)
        clicked = { key: "", at: 0 }
      } else if (!opensAtOnce) {
        // (once: its conversation, once a second click is no longer coming; twice: called back)
        const now = performance.now(), twice = clicked.key === key && now - clicked.at < DOUBLE_MS
        clearTimeout(opening)
        clicked = twice ? { key: "", at: 0 } : { key, at: now }
        if (twice) api?.home(name)
        else opening = setTimeout(() => open(name, key), DOUBLE_MS)
      } else open(name, key)
      kick()
    }
    el.addEventListener("pointermove", move)
    el.addEventListener("pointerup", up)
  }
  return { dragging, down }
}

function Hold({ children, className, style, onPointerDown, onHover }: { children: React.ReactNode; className?: string; style?: React.CSSProperties
  onPointerDown?: (e: React.PointerEvent<HTMLDivElement>) => void; onHover?: (on: boolean) => void }) {
  const over = useRef(false)
  useEffect(() => () => { if (over.current) grab(false) }, [])
  return (
    <div className={className} style={style} onPointerDown={onPointerDown}
      onPointerEnter={() => { if (!over.current) { over.current = true; grab(true); onHover?.(true) } }}
      onPointerLeave={() => { if (over.current) { over.current = false; grab(false); onHover?.(false) } }}>
      {children}
    </div>
  )
}

/** Since it last acted, as the window counts it (look.ts): 0 under 3 s, 1 under 4 s, 2 under 8 s, 3 after. */
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

/** A flag's mark, as the window draws it: dots working, a wave listening, a tick for a moment let pass. */
function Mark({ mark, at }: { mark: MarkKind; at?: number }) {
  if (mark === "dots") return <span className="companion-dots" aria-hidden><i /><i /><i /></span>
  if (mark === "wave") return <span className="companion-wave" aria-hidden><i /><i /><i /></span>
  if (mark === "tick") return <Check key={at} className="companion-seen size-3" strokeWidth={3} aria-label="seen" />
  return null
}

/** An agent's cursor as the window draws it (plugins/core/companion/Overlay.tsx): the arrow, its flag below (its name,
 *  what it does, its mark), its bubble beside; going into the window, it fades as it lands where the window draws it. */
function Cursor({ a, gone }: { a: Agent; gone?: boolean }) {
  const tint = `var(--${a.tint})`, key = `agent:${a.name}`, { dragging, down } = useDrag(a.name, key)
  const [hover, setHover] = useState(false), age = useAge(a.t)
  const shown = presence({ state: a.state as Parameters<typeof presence>[0]["state"], seen: a.seen, why: a.why }, { bubble: !!a.say, age, looked: hover || dragging })
  useLayoutEffect(() => repaint(key), [key, a.say?.id, a.say?.text])
  return (
    <div ref={attach(key, paintCursor)} data-gone={gone || a.leaving || undefined} data-leaving={a.leaving || undefined}
      className={cn("screen-in group fixed top-0 left-0 transition-opacity duration-300 data-gone:pointer-events-none data-gone:opacity-0 data-leaving:delay-150", shown.dim && "opacity-55")}>
      <Hold className={cn("relative cursor-grab", shown.bob && !dragging && "companion-bob")} onPointerDown={down} onHover={setHover}><Arrow tint={tint} /></Hold>
      <Hold onPointerDown={down} onHover={setHover} style={{ background: tint }}
        className={cn("absolute top-[18px] left-[13px] flex cursor-grab items-center gap-1 rounded-full px-2 py-[2px] text-[11.5px] font-semibold whitespace-nowrap text-white shadow-sm transition-opacity duration-300",
          "group-data-[flag-right]:right-[-6px] group-data-[flag-right]:left-auto group-data-[low]:top-[-20px]", !shown.flag && "pointer-events-none opacity-0")}>
        {a.name}
        {shown.words && <span className="font-medium opacity-85">{shown.words}</span>}
        <Mark mark={shown.mark} at={a.t} />
        {shown.why && <span className="max-w-[220px] truncate font-medium opacity-90">{shown.why}</span>}
      </Hold>
      {a.say && (
        <Hold onPointerDown={(e) => { if (e.button === 0) open(a.name, key) }}
          className={cn("companion-pop absolute bottom-[2px] left-[24px] flex w-max cursor-pointer flex-col rounded-[12px] rounded-tl-[4px] border border-border/60 px-3 py-1.5 text-[13.5px] leading-snug text-foreground shadow-lg",
            "group-data-[right]:right-[22px] group-data-[right]:left-auto group-data-[right]:rounded-tl-[12px] group-data-[right]:rounded-tr-[4px] group-data-[low]:bottom-[22px]",
            "group-data-[high]:top-[40px] group-data-[high]:bottom-auto",
            a.say.question ? "bg-[color-mix(in_srgb,var(--c)_9%,var(--background))]" : "bg-background")}
          style={{ "--c": tint, maxWidth: "clamp(200px, var(--room, 320px), 320px)",
            boxShadow: `0 0 0 ${a.say.question ? 2 : 1.5}px color-mix(in srgb, ${tint} ${a.say.question ? 70 : 45}%, transparent), 0 8px 24px rgba(0,0,0,.12)` } as React.CSSProperties}>
          <span data-bubble-text className="line-clamp-[12]">{snippet(a.say.text)}</span>
        </Hold>
      )}
    </div>
  )
}

/** The companion waiting: a dot at the screen's edge (where the user docked it: dragged to an edge, it stays there), or by
 *  the pointer (which it never takes: it's under it). Hovered, its name; clicked, its conversation; dragged out, it points. */
function Waiting({ i, gone }: { i: Idle; gone?: boolean }) {
  const tint = `var(--${i.tint})`, { dragging, down } = useDrag(i.name, "idle", true), [hover, setHover] = useState(false)
  const fade = "screen-in transition-opacity duration-300 data-gone:pointer-events-none data-gone:opacity-0 data-leaving:delay-150", off = gone || i.leaving || undefined
  if (!i.docked && !dragging) return <div ref={attach("idle", paintTrail)} data-gone={off} data-leaving={i.leaving || undefined} className={`pointer-events-none fixed top-0 left-0 origin-top-left opacity-80 ${fade}`}><Arrow tint={tint} /></div>
  return (
    <div ref={attach("idle", dragging ? paintCursor : paintDot)} data-gone={off} data-leaving={i.leaving || undefined} data-companion-dock={i.side} className={`fixed top-0 left-0 ${fade}`}>
      <Hold className={cn("grid size-5 place-items-center", dragging ? "cursor-grabbing" : "cursor-pointer")} onPointerDown={down} onHover={setHover}>
        {dragging ? <Arrow tint={tint} /> : <span data-unread={i.unread || undefined} className={cn("size-3 rounded-full shadow-[0_0_0_2px_white,0_1px_4px_rgba(0,0,0,0.3)] transition-transform duration-150", hover && "scale-125", i.unread && "companion-unread")}
          style={{ background: tint, "--c": tint } as React.CSSProperties} />}
      </Hold>
      {hover && !dragging && (
        <span className={cn("companion-pop pointer-events-none absolute top-[1px] flex items-center gap-1 rounded-full px-2 py-[2px] text-[11.5px] font-semibold whitespace-nowrap text-white shadow-sm",
          i.side === "left" ? "left-[26px]" : "right-[26px]")} style={{ background: tint }}>
          {i.name}{i.unread && <span className="font-medium opacity-85">new</span>}
        </span>
      )}
    </div>
  )
}

function Pill({ p }: { p: NonNullable<Shown["pill"]> }) {
  const box = useRef<HTMLDivElement>(null), now = useRef(p)
  now.current = p
  useEffect(() => {
    const pill = makePill()
    pill.el.style.position = "static"
    box.current!.append(pill.el)
    let raf = requestAnimationFrame(function frame(t) { raf = requestAnimationFrame(frame); pill.set(now.current.level, now.current.ready, now.current.text, t) })
    return () => { cancelAnimationFrame(raf); pill.el.remove() }
  }, [])
  return <Hold className="fixed bottom-14 left-1/2 -translate-x-1/2 cursor-default" onPointerDown={() => api?.stop()}><div ref={box} /></Hold>
}

// ---------- a cursor's conversation (#panel): the window's own look (Chat.tsx), in a window that takes the keyboard

const marked = new Marked({ gfm: true, breaks: true })
// (its words as Markdown, made safe; links open in the browser: overlay.ts)
const linkAttrs = (href: string) => (/^https?:/i.test(href) ? ` href="${href.replace(/"/g, "&quot;")}" target="_blank" rel="noreferrer"` : null)
const html = (text: string) => sanitizeHtml(marked.parse(text, { async: false }) as string, { link: linkAttrs, image: () => null })
const TIME = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" })

function Panel() {
  const [d, setD] = useState<PanelData | null>(null)
  const [draft, setDraft] = useState("")
  const took = useRef(0), box = useRef<HTMLDivElement>(null)
  useEffect(() => api?.panel.on((x) => {
    setD(x)
    // (words said into its box, once each)
    const w = x.words
    if (w?.done && w.id && w.id !== took.current) { took.current = w.id; setDraft((v) => (v + joinText(v, w.text)).trimStart()) }
  }), [])
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") api?.panel.close() }
    addEventListener("keydown", esc)
    return () => removeEventListener("keydown", esc)
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
      <Chat name={d.name} tint={tint} how={d.how} items={d.items} draft={text} setDraft={listening ? () => {} : setDraft} focus
        send={() => { if (text.trim()) api?.panel.send(text) }} close={() => api?.panel.close()} more={(e) => api?.panel.more(e.clientX, e.clientY)}
        words={(n) => <div className="note-prose compact companion-md" dangerouslySetInnerHTML={{ __html: html(n.text ?? "") }} />}
        time={(t) => TIME.format(t)}
        tools={
          <button type="button" aria-label={listening ? "Stop dictating" : "Dictate"} aria-pressed={listening} data-tip={listening ? "Stop" : "Dictate"}
            className="mr-1 grid size-7 shrink-0 cursor-pointer place-items-center rounded-full text-muted-foreground hover:bg-foreground/[0.07] hover:text-foreground aria-pressed:text-white aria-pressed:hover:bg-[var(--c)]"
            style={{ "--c": tint, ...(listening ? { background: tint } : {}) } as React.CSSProperties} onClick={() => api?.panel.mic()}>
            {listening ? <span className="companion-wave" aria-hidden><i /><i /><i /></span> : <Mic className="size-4" />}
          </button>
        } />
    </div>
  )
}

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }
function Screen() {
  const { s, gone, idleGone } = useSyncExternalStore(subscribe, () => view)
  useEffect(() => { const a = api?.on(onScene), b = api?.onAt(onAt); return () => { a?.(); b?.() } }, [])
  if (!s) return null
  return (
    <>
      {s.agents.map((a) => <Cursor key={a.name} a={a} />)}
      {gone.map((a) => <Cursor key={a.name} a={a} gone />)}
      {(s.idle ?? idleGone) && <Waiting i={(s.idle ?? idleGone)!} gone={!s.idle} />}
      {s.pill && <Pill p={s.pill} />}
    </>
  )
}

// (the window's marks and pops, as plugins/core/companion/Overlay.tsx has them)
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
@keyframes companion-wave { 0%, 100% { transform: scaleY(.35) } 50% { transform: scaleY(1) } }
.companion-seen { animation: companion-seen .5s ease-out; }
@keyframes companion-seen { from { opacity: 0; scale: .4; } }
.companion-pop { animation: companion-pop .28s cubic-bezier(.2,.9,.3,1.25); transform-origin: top left; }
@keyframes companion-pop { from { opacity: 0; scale: .9; } }
.companion-unread { animation: companion-unread 2s ease-out infinite; }
@keyframes companion-unread { 0% { box-shadow: 0 0 0 2px white, 0 0 0 2px var(--c); } 70%, 100% { box-shadow: 0 0 0 2px white, 0 0 0 9px transparent; } }
@media (prefers-reduced-motion: reduce) { .screen-in, .companion-bob, .companion-pop, .companion-dots i, .companion-wave i, .companion-seen, .companion-unread { animation: none !important; } }
`
document.head.append(Object.assign(document.createElement("style"), { textContent: STYLE }))
document.documentElement.style.background = "transparent"
createRoot(document.getElementById("root")!).render(<StrictMode>{location.hash === "#panel" ? <Panel /> : <Screen />}</StrictMode>)
