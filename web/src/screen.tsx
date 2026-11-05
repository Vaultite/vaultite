// The companion over the screen (electron/overlay.ts): summoned (listening, thinking), agents' cursors where they point,
// their bubbles (a click opens #panel, a window that takes the keyboard), the ink, the dictation pill. Nothing rests here.
import { StrictMode, useEffect, useLayoutEffect, useReducer, useRef, useState, useSyncExternalStore } from "react"
import { createRoot } from "react-dom/client"
import { Check, Mic } from "lucide-react"
import { Marked } from "marked"
import "./index.css"
import { makePill } from "@/core/pill"
import { snippet } from "@/core/plaintext"
import { sanitizeHtml } from "@/core/sanitize"
import { joinText } from "../../core/dictationtext"
import { CURSOR_SPRING, glide, type Glide } from "@/core/spring"
import { cn, followSystemTheme } from "@/lib/utils"
// (what its flag shows, by the window's own rule: the two draw one cursor)
import { presence, type Mark as MarkKind } from "../../plugins/core/companion/look"
import { arrowBox, boxAt, flagBox } from "../../plugins/core/companion/boxes"
import { Chat, type ChatItem } from "../../plugins/core/companion/Chat"
import { type DrawBridge, ScreenDrawings } from "./screendraw"

type Point = { x: number; y: number }
type Rect = { x: number; y: number; width: number; height: number }
type Say = { id: string; text: string; question?: boolean }
type Agent = { name: string; tint: string; state: string; sx: number; sy: number; t?: number; seen?: boolean; why?: string; from?: Point; leaving?: boolean; target?: Rect; say?: Say }
type Summoned = { name: string; tint: string; state: "listening" | "thinking" | "watching"; sx: number; sy: number; words?: string; from?: Point; leaving?: boolean }
type Shown = { width: number; height: number; top: number; agents: Agent[]; summon: Summoned | null; ink: { tint: string; strokes: Point[][] } | null
  pill: { level: number; text: string; ready: boolean; hint?: boolean } | null }
/** Only the places changed (helperlogic.ts splitScene): x, y and a target's frame. */
type At = { agents: Record<string, number[]>; summon: [number, number] | null }
type PanelData = { name: string; tint: string; how: string; items: ChatItem[]; busy?: boolean; words?: { text: string; listening: boolean; done?: boolean; id?: number; send?: boolean } }
type Bridge = { on: (fn: (s: Shown) => void) => () => void; onAt: (fn: (a: At) => void) => () => void; grab: (on: boolean) => void
  open: (name: string, x: number, y: number) => void; stop: () => void; draw?: DrawBridge
  panel: { on: (fn: (d: PanelData) => void) => () => void; size: (h: number) => void; send: (text: string) => void; close: () => void; mic: () => void; more: (x: number, y: number) => void } }
const api = (window as unknown as { vaultiteScreen?: Bridge }).vaultiteScreen

followSystemTheme()

// ---------- motion: each cursor glides on a spring, painted straight onto its element; the loop sleeps when all are still

type Paint = (el: HTMLElement, x: number, y: number) => void
type Mover = { g: Glide; tx: number; ty: number; w: number; el: HTMLElement | null; paint: Paint }
const movers = new Map<string, Mover>()
/** An agent's cursor settles in about the in-app one's time. */
const AGENT = CURSOR_SPRING
let raf = 0, last = 0

function frame(t: number) {
  // (the first frame after a rest counts as one frame, not the whole rest)
  const dt = last ? Math.min(0.05, (t - last) / 1000) : 1 / 60
  last = t
  let moving = false
  for (const m of movers.values()) {
    if (!glide(m.g, m.tx, m.ty, m.w, dt)) moving = true
    if (m.el) m.paint(m.el, m.g.x, m.g.y)
  }
  raf = moving ? requestAnimationFrame(frame) : 0
  if (!moving) last = 0
}
const kick = () => { if (!raf) raf = requestAnimationFrame(frame) }

/** Where `key` goes now; a new one starts where it came from (`from`), else there; `now`: there at once (the summoned
 *  one follows the pointer as it is). */
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

/** Its element, painted where it is now (it draws itself after: React never sets its place). */
function attach(key: string, paint: Paint) {
  return (el: HTMLElement | null) => {
    const m = movers.get(key)
    if (!m) return
    m.el = el
    m.paint = paint
    if (el) paint(el, m.g.x, m.g.y)
  }
}
// (the arrow's tip at the point; its name and words placed by the window's rule (boxes.ts): never over its arrow, its
// name or what it points at)
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
/** Its element painted again where it is (its words came or changed: where they go). */
function repaint(key: string) {
  const m = movers.get(key)
  if (m?.el) m.paint(m.el, m.g.x, m.g.y)
}

// ---------- what's drawn: the scene, and what just left it (fading where it was going)

type View = { s: Shown | null; gone: Agent[]; summonGone: Summoned | null }
let view: View = { s: null, gone: [], summonGone: null }
const fading = new Map<string, ReturnType<typeof setTimeout>>()
const listeners = new Set<() => void>()
const set = (v: Partial<View>) => { view = { ...view, ...v }; for (const l of listeners) l() }
const FADE = 260

function leave(key: string, done: () => void) {
  if (fading.has(key)) return
  fading.set(key, setTimeout(() => { fading.delete(key); movers.delete(key); done() }, FADE))
}
function back(key: string) { clearTimeout(fading.get(key)); fading.delete(key) }
const targetOf = (a: Agent) => (a.target ? [a.target.x, a.target.y, a.target.width, a.target.height].join() : undefined)

function onScene(s: Shown) {
  const was = view.s
  for (const a of s.agents) { back(`agent:${a.name}`); aim(`agent:${a.name}`, a.sx, a.sy, AGENT, a.from) }
  if (s.summon) { back("summon"); aim("summon", s.summon.sx, s.summon.sy, AGENT, undefined, s.summon.state === "listening") }
  const names = new Set(s.agents.map((a) => a.name))
  // (one that became the other, summoned or its own cursor, goes at once: that one glides on from it)
  const swap = (name: string, key: string) => { const twin = s.summon?.name === name || names.has(name); if (twin) { back(key); movers.delete(key) } return !twin }
  const gone = [...view.gone.filter((a) => !names.has(a.name)), ...(was?.agents ?? []).filter((a) => !names.has(a.name) && !view.gone.some((g) => g.name === a.name))]
    .filter((a) => swap(a.name, `agent:${a.name}`))
  for (const a of gone) leave(`agent:${a.name}`, () => set({ gone: view.gone.filter((g) => g.name !== a.name) }))
  let summonGone = s.summon ? null : view.summonGone ?? was?.summon ?? null
  if (summonGone && !swap(summonGone.name, "summon")) summonGone = null
  if (summonGone) leave("summon", () => set({ summonGone: null }))
  set({ s, gone, summonGone })
}
function onAt(at: At) {
  for (const a of view.s?.agents ?? []) {
    const p = at.agents[a.name]
    if (!p) continue
    const m = movers.get(`agent:${a.name}`)
    if (m?.el) { if (p.length === 6) m.el.dataset.target = p.slice(2).join(); else delete m.el.dataset.target }
    aim(`agent:${a.name}`, p[0], p[1], AGENT)
  }
  if (view.s?.summon && at.summon) aim("summon", at.summon[0], at.summon[1], AGENT, undefined, view.s.summon.state === "listening")
}

// ---------- the pointer: what it's over takes it (a bubble, the pill, to click); off them, it goes through again

let grabbed = 0
const grab = (on: boolean) => { grabbed = Math.max(0, grabbed + (on ? 1 : -1)); api?.grab(grabbed > 0) }

function Arrow({ tint }: { tint: string }) {
  return (
    <svg width={20} height={20} viewBox="0 0 20 20" className="drop-shadow-[0_1px_2px_rgba(0,0,0,0.35)]">
      <path d="M3 2.5 L16.5 9.2 L10.3 10.9 L7.6 16.8 Z" fill={tint} stroke="white" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  )
}

/** Its conversation, by where it is now. */
function open(name: string, key: string) {
  const m = movers.get(key)
  if (m) api?.open(name, Math.round(m.g.x), Math.round(m.g.y))
}

function Hold({ children, onHover, ...rest }: React.HTMLAttributes<HTMLDivElement> & { onHover?: (on: boolean) => void } & Record<`data-${string}`, unknown>) {
  const over = useRef(false)
  useEffect(() => () => { if (over.current) grab(false) }, [])
  return (
    <div {...rest}
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

const FLAG = cn("absolute top-[18px] left-[13px] flex items-center gap-1 rounded-full px-2 py-[2px] text-[11.5px] font-semibold whitespace-nowrap text-white shadow-sm transition-opacity duration-300",
  "group-data-[flag-right]:right-[-6px] group-data-[flag-right]:left-auto group-data-[low]:top-[-20px]")
const WORDS = cn("companion-pop absolute top-0 left-0 flex w-max max-w-[320px] flex-col rounded-[12px] border border-border/60 px-3 py-1.5 text-[13.5px] leading-snug text-foreground shadow-lg",
  "data-[side=right]:data-up:rounded-bl-[4px] data-[side=left]:data-up:rounded-br-[4px] data-[side=right]:not-data-up:rounded-tl-[4px] data-[side=left]:not-data-up:rounded-tr-[4px]")
const FADES = "screen-in group fixed top-0 left-0 transition-opacity duration-300 data-gone:pointer-events-none data-gone:opacity-0 data-leaving:delay-150"

/** An agent's cursor as the window draws it (plugins/core/companion/Overlay.tsx): the arrow, its flag (its name, what it
 *  does, its mark), its bubble beside; going into the window, it fades as it lands where the window draws it. */
function Cursor({ a, gone }: { a: Agent; gone?: boolean }) {
  const tint = `var(--${a.tint})`, key = `agent:${a.name}`
  const [hover, setHover] = useState(false), age = useAge(a.t)
  const shown = presence({ state: a.state as Parameters<typeof presence>[0]["state"], seen: a.seen, why: a.why }, { bubble: !!a.say, age, looked: hover })
  useLayoutEffect(() => repaint(key), [key, a.say?.id, a.say?.text, shown.flag, shown.words])
  return (
    <div ref={attach(key, paintCursor)} data-gone={gone || a.leaving || undefined} data-leaving={a.leaving || undefined} data-target={targetOf(a)}
      className={cn(FADES, "pointer-events-none", shown.dim && "opacity-55")}>
      <div className={cn("relative", shown.bob && "companion-bob")}><Arrow tint={tint} /></div>
      <div data-flag style={{ background: tint }} className={cn(FLAG, !shown.flag && "opacity-0")}>
        {a.name}
        {shown.words && <span className="font-medium opacity-85">{shown.words}</span>}
        <Mark mark={shown.mark} at={a.t} />
        {shown.why && <span className="max-w-[220px] truncate font-medium opacity-90">{shown.why}</span>}
      </div>
      {a.say && (
        <Hold onPointerDown={(e) => { if (e.button === 0) open(a.name, key) }} onHover={setHover} data-bubble
          className={cn(WORDS, "pointer-events-auto cursor-pointer", a.say.question ? "bg-[color-mix(in_srgb,var(--c)_9%,var(--background))]" : "bg-background")}
          style={{ "--c": tint,
            boxShadow: `0 0 0 ${a.say.question ? 2 : 1.5}px color-mix(in srgb, ${tint} ${a.say.question ? 70 : 45}%, transparent), 0 8px 24px rgba(0,0,0,.12)` } as React.CSSProperties}>
          <span data-bubble-text className="line-clamp-[12]">{snippet(a.say.text)}</span>
        </Hold>
      )}
    </div>
  )
}

/** The companion summoned by a Talk key: at the pointer, listening (a wave, its words as they come) or thinking (dots),
 *  till its own cursor takes over where it was asked. */
function Summon({ c, gone }: { c: Summoned; gone?: boolean }) {
  const tint = `var(--${c.tint})`
  useLayoutEffect(() => repaint("summon"), [c.words, c.state])
  return (
    <div ref={attach("summon", paintCursor)} data-gone={gone || c.leaving || undefined} data-companion-summoned={c.state} className={cn(FADES, "pointer-events-none")}>
      <div className={cn("relative", c.state === "thinking" && "companion-bob")}><Arrow tint={tint} /></div>
      <div data-flag style={{ background: tint }} className={FLAG}>
        {c.name}
        <Mark mark={c.state === "listening" ? "wave" : c.state === "thinking" ? "dots" : null} />
      </div>
      {c.words && <div data-bubble className={cn(WORDS, "bg-background")} style={{ boxShadow: `0 0 0 1.5px color-mix(in srgb, ${tint} 45%, transparent), 0 8px 24px rgba(0,0,0,.12)` }}>
        <span className="line-clamp-[8] text-foreground/80">{c.words}</span>
      </div>}
    </div>
  )
}

/** What the user draws while a Talk key is held: strokes in its colour, as by pen. */
function Ink({ ink }: { ink: NonNullable<Shown["ink"]> }) {
  const d = (k: Point[]) => k.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ")
  return (
    <svg className="screen-in pointer-events-none fixed inset-0 size-full" aria-hidden>
      {ink.strokes.map((k, i) => <path key={i} d={d(k)} fill="none" stroke={`var(--${ink.tint})`} strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round" opacity={0.9} />)}
    </svg>
  )
}

/** A key pressed where it does nothing: a word where the pill shows, a moment. */
function Hint({ text }: { text: string }) {
  return <div className="screen-in pointer-events-none fixed bottom-14 left-1/2 -translate-x-1/2"><div className="dictation-pill" data-ready><span className="dictation-pending">{text}</span></div></div>
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
    if (w?.done && w.id && w.id !== took.current) {
      took.current = w.id
      // (a Talk key's words go as they stop, with what was typed before them)
      setDraft((v) => { const all = (v + joinText(v, w.text)).trimStart(); if (!w.send || !all.trim()) return all; api?.panel.send(all); return "" })
    }
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
        send={() => { if (text.trim()) { api?.panel.send(text); setDraft("") } }} busy={d.busy} close={() => api?.panel.close()} more={(e) => api?.panel.more(e.clientX, e.clientY)}
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
  const { s, gone, summonGone } = useSyncExternalStore(subscribe, () => view)
  useEffect(() => { const a = api?.on(onScene), b = api?.onAt(onAt); return () => { a?.(); b?.() } }, [])
  if (!s) return null
  return (
    <>
      {s.ink && <Ink ink={s.ink} />}
      {/* (the agents' drawings, under their cursors) */}
      <ScreenDrawings grab={grab} />
      {s.agents.map((a) => <Cursor key={a.name} a={a} />)}
      {gone.map((a) => <Cursor key={a.name} a={a} gone />)}
      {(s.summon ?? summonGone) && <Summon c={(s.summon ?? summonGone)!} gone={!s.summon} />}
      {s.pill && (s.pill.hint ? <Hint text={s.pill.text} /> : <Pill p={s.pill} />)}
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
@media (prefers-reduced-motion: reduce) { .screen-in, .companion-bob, .companion-pop, .companion-dots i, .companion-wave i, .companion-seen { animation: none !important; } }
`
document.head.append(Object.assign(document.createElement("style"), { textContent: STYLE }))
document.documentElement.style.background = "transparent"
createRoot(document.getElementById("root")!).render(<StrictMode>{location.hash === "#panel" ? <Panel /> : <Screen />}</StrictMode>)
