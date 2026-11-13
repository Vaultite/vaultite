import { useEffect, useLayoutEffect, useReducer, useRef, useState, useSyncExternalStore } from "react"
import type { EditorView } from "@codemirror/view"
import { ArrowDown, ArrowUp, X } from "lucide-react"
import { cn, haptic, Markdown, menuBelow, notifyError, useVisibleArea } from "@vaultite"
import { type Agent, answer, answered, askedFromHere, type Note, sawShown, sawSays, typing, viewOf } from "./live"
import { answerAsk, unsent } from "./overlaykit"
import { coords, posIn, scroller } from "./spots"
import { Mark, Popover, readMs, SayActions } from "./Bubble"
import { agentMenu } from "./session"

const PHONE = "(max-width: 767px), (hover: none) and (pointer: coarse)"
const query = typeof matchMedia === "function" ? matchMedia(PHONE) : null
export const isPhone = () => !!query?.matches
const onPhone = (f: () => void) => { query?.addEventListener("change", f); return () => query?.removeEventListener("change", f) }
export const usePhone = () => useSyncExternalStore(onPhone, isPhone)

type Doing = "writing" | "thinking" | "listening" | "pointing" | "seen"
const DOING: Record<Doing, string> = { writing: "is writing", thinking: "is thinking", listening: "is listening", pointing: "is pointing", seen: "saw it" }
const POINT_MS = 2600
const FADE_MS = 400

type Act = { a: Agent; doing: Doing; v: EditorView; pos: number; lines?: [number, number]; since: number; typed?: boolean }
type Drawn = { name: string; tint: string; doing: Doing; why?: string; x: number; top: number; h: number; end: boolean; below: boolean; goneAt?: number }

function actOf(a: Agent, pointedAt: number, now: number): Act | null {
  if (a.state === "away") return null
  if (typing?.agent === a.name && typing.view.dom.isConnected) return { a, doing: "writing", v: typing.view, pos: Math.min(typing.pos, typing.view.state.doc.length), since: 0, typed: true }
  const busy = a.state === "thinking" || a.state === "reading" || a.state === "starting"
  const doing: Doing | null = a.state === "writing" ? "writing" : a.state === "listening" ? "listening" : busy && askedFromHere(a.name) ? "thinking"
    : now - pointedAt < POINT_MS ? "pointing" : null
  return doing && actAt(a, a, doing, pointedAt)
}
function actAt(a: Agent, t: Agent, doing: Doing, since: number): Act | null {
  const v = t.path ? viewOf(t.path) : null, at = v ? posIn(v, t) : null
  if (!v || at === null) return null
  const doc = v.state.doc, line = doc.lineAt(at), end = t.find ? Math.min(doc.length, at + t.find.length) : line.to, last = doc.lineAt(end)
  const pos = doing === "pointing" ? last.to : Math.min(last.to, Math.max(end, line.from))
  return { a, doing, v, pos, since, ...(doing === "pointing" ? { lines: [line.from, last.to] satisfies [number, number] } : {}) }
}

function caretAt(v: EditorView, pos: number, cover: number) {
  const { box } = coords(v, pos)
  const bottom = Math.min(box.bottom, cover)
  let r: { left: number; top: number; bottom: number } | null = null
  try { r = v.coordsAtPos(pos, -1) ?? v.coordsAtPos(pos, 1) } catch {}
  if (r && r.top >= box.top - 2 && r.bottom <= bottom + 2) return { x: r.left, top: r.top, h: Math.max(14, r.bottom - r.top), box, dir: 0 as const }
  return { box, dir: (r ? r.top < box.top : pos < v.viewport.from) ? (-1 as const) : (1 as const) }
}

function linesAt(v: EditorView, [from, to]: [number, number], box: { top: number; bottom: number }) {
  let a: { top: number } | null = null, b: { bottom: number } | null = null
  try { a = v.coordsAtPos(from, 1); b = v.coordsAtPos(to, -1) } catch {}
  if (!a || !b) return null
  const c = v.contentDOM.getBoundingClientRect(), top = Math.max(a.top - 2, box.top), bottom = Math.min(b.bottom + 2, box.bottom)
  return bottom - top > 4 ? { left: c.left - 6, width: c.width + 12, top, height: bottom - top } : null
}

function floorOf() {
  const vv = visualViewport, bars = [...document.querySelectorAll("[data-phone-bar], [data-key-bar]")].map((e) => e.getBoundingClientRect()).filter((r) => r.height > 0 && r.top < innerHeight)
  return Math.min(vv ? vv.offsetTop + vv.height : innerHeight, innerHeight, ...bars.map((r) => r.top))
}

export function PhoneLayer({ agents, sayOf, popped, setPopped }: {
  agents: Agent[]
  sayOf: (a: Agent) => { said: Note | null; waiting: boolean }
  popped: string | null; setPopped: (name: string | null) => void }) {
  const [, redraw] = useReducer((x: number) => x + 1, 0)
  useVisibleArea(true)
  const now = Date.now()
  const pointed = useRef(new Map<string, { was?: number; at: number }>())
  const stack = useRef<HTMLDivElement>(null), [cover, setCover] = useState(Infinity)
  const thought = useRef(new Set<string>()), passed = useRef(new Map<string, number>())
  const acts: Act[] = []
  for (const a of agents) {
    const p = pointed.current.get(a.name)
    if (!p) pointed.current.set(a.name, { was: a.pointed, at: 0 })
    else if (a.pointed !== undefined && p.was !== a.pointed) Object.assign(p, { was: a.pointed, at: now })
    const act = actOf(a, pointed.current.get(a.name)!.at, now)
    if (act?.doing === "thinking") thought.current.add(a.name)
    else if (thought.current.delete(a.name) && a.state === "watching" && a.seen) passed.current.set(a.name, now)
    const passedAt = passed.current.get(a.name)
    const shown = act ?? (passedAt && now - passedAt < POINT_MS ? actAt(a, a, "seen", passedAt) : null)
    if (shown) acts.push(shown)
  }
  const drawn: Drawn[] = [], chips: { act: Act; dir: -1 | 1; top: number }[] = [], flashes: { key: string; tint: string; r: NonNullable<ReturnType<typeof linesAt>> }[] = []
  for (const act of acts) {
    const tint = `var(--${act.a.tint})`, at = caretAt(act.v, act.pos, cover)
    if (act.lines) { const r = linesAt(act.v, act.lines, { top: at.box.top, bottom: Math.min(at.box.bottom, cover) }); if (r) flashes.push({ key: `${act.a.name}:${act.since}`, tint, r }) }
    if (at.dir) { chips.push({ act, dir: at.dir, top: at.box.top }); continue }
    const same = drawn.filter((d) => Math.abs(d.x - at.x) < 6 && Math.abs(d.top - at.top) < 4).length
    drawn.push({ name: act.a.name, tint, doing: act.doing, why: act.doing === "seen" ? act.a.why : undefined, x: at.x + same * 3, top: at.top, h: at.h,
      end: act.typed || act.pos === act.v.state.doc.lineAt(act.pos).to, below: at.top - 19 < at.box.top })
  }
  const last = useRef(new Map<string, Drawn>())
  for (const [name, d] of last.current) {
    if (drawn.some((x) => x.name === name)) continue
    if (chips.some((c) => c.act.a.name === name)) { last.current.delete(name); continue }
    d.goneAt ??= now
    if (now - d.goneAt < FADE_MS) drawn.push(d)
    else last.current.delete(name)
  }
  for (const d of drawn) if (!d.goneAt) last.current.set(d.name, d)
  const ends = [...acts.filter((x) => x.doing === "pointing" || x.doing === "seen").map((x) => x.since + POINT_MS), ...drawn.filter((d) => d.goneAt).map((d) => d.goneAt! + FADE_MS)].filter((t) => t > now)
  const next = ends.length ? Math.min(...ends) : 0
  useEffect(() => { if (!next) return; const t = setTimeout(redraw, next - Date.now() + 20); return () => clearTimeout(t) }, [next])

  const open = popped ? agents.find((a) => a.name === popped) : undefined
  const asking = agents.find((a) => a.asks)
  const latest = agents.map((a) => ({ a, said: sayOf(a).said })).filter((x) => !!x.said).sort((x, y) => y.said!.t - x.said!.t)[0]
  const [held, setHeld] = useState(false), kept = useRef<{ a: Agent; said: Note } | null>(null)
  if (latest) kept.current = { a: latest.a, said: latest.said! }
  const say = latest ? { a: latest.a, said: latest.said! } : held ? kept.current : null
  useLayoutEffect(() => {
    const t = stack.current?.querySelector("[data-companion-card]")?.getBoundingClientRect().top ?? Infinity
    if (t !== cover) setCover(t)
  })
  const floor = floorOf()
  const down = chips.filter((c) => c.dir > 0), up = chips.filter((c) => c.dir < 0)
  const card = open ? <Conversation a={open} close={() => setPopped(null)} />
    : asking?.asks ? <AskCard key={asking.asks.event} a={asking} />
    : say ? <SayCard key={say.said.id} n={say.said} a={say.a} hold={setHeld} /> : null
  return <>
    <style>{STYLE}</style>
    {flashes.map((f) => (
      <div key={f.key} data-companion-flash className="companion-flash pointer-events-none fixed top-0 left-0 z-(--z-page-float) rounded-[6px]"
        style={{ translate: `${f.r.left}px ${f.r.top}px`, width: f.r.width, height: f.r.height, background: `color-mix(in srgb, ${f.tint} 18%, transparent)` }} />
    ))}
    {drawn.map((d) => <Caret key={d.name} d={d} />)}
    {up.length > 0 && (
      <div className="pointer-events-none fixed inset-x-0 z-(--z-page-float) flex flex-col items-center" style={{ top: Math.min(...up.map((c) => c.top)) + 4 }}>
        {up.map((c) => <Chip key={c.act.a.name} c={c} />)}
      </div>
    )}
    {(down.length > 0 || card) && (
      <div ref={stack} data-companion-stack className="pointer-events-none fixed inset-x-2 z-(--z-page-float) mx-auto flex max-w-md flex-col items-center" style={{ bottom: innerHeight - floor + 8 }}>
        {down.map((c) => <Chip key={c.act.a.name} c={c} />)}
        {card}
      </div>
    )}
  </>
}

function Caret({ d }: { d: Drawn }) {
  const flag = useRef<HTMLSpanElement>(null), [w, setW] = useState(0)
  useLayoutEffect(() => { const x = flag.current?.offsetWidth ?? 0; if (x !== w) setW(x) })
  const after = d.end && d.x + 6 + w <= innerWidth - 8
  const left = !after && d.x + w > innerWidth - 8
  const corner = after ? "" : d.below ? (left ? "rounded-tr-none" : "rounded-tl-none") : (left ? "rounded-br-none" : "rounded-bl-none")
  return (
    <div data-companion-caret={d.name} data-doing={d.doing} data-gone={d.goneAt ? "" : undefined} data-flag={after ? "after" : d.below ? "below" : "above"}
      className={cn("pointer-events-none fixed top-0 left-0 z-(--z-page-float) transition-opacity duration-400", d.goneAt ? "opacity-0" : "companion-fade")}
      style={{ translate: `${d.x}px ${d.top}px`, height: d.h }}>
      <span className={cn("absolute -inset-y-px -left-px w-[2px] rounded-full", d.doing === "thinking" && "companion-caret-think")} style={{ background: d.tint }} />
      <span ref={flag} data-companion-flag className={cn("absolute flex h-[18px] items-center gap-1 rounded-[5px] px-1.5 text-[11.5px] leading-none font-semibold whitespace-nowrap text-white shadow-sm", corner,
        after ? "top-1/2 left-[6px] -translate-y-1/2" : d.below ? "top-full mt-px" : "bottom-full mb-px", !after && (left ? "-right-px" : "-left-px"))} style={{ background: d.tint }}>
        {d.name}
        <Mark mark={d.doing === "thinking" ? "dots" : d.doing === "listening" ? "wave" : d.doing === "seen" ? "tick" : null} label={d.doing === "thinking" ? "thinking" : undefined} />
        {d.why && <span className="max-w-[180px] truncate font-medium opacity-90">{d.why}</span>}
      </span>
    </div>
  )
}

function Chip({ c }: { c: { act: Act; dir: -1 | 1 } }) {
  const { a, doing, v, pos } = c.act, Arrow = c.dir > 0 ? ArrowDown : ArrowUp
  return (
    <button type="button" data-companion-edge={a.name} data-dir={c.dir > 0 ? "down" : "up"} onClick={() => { haptic("light"); scroller(v, pos) }}
      className="companion-fade pointer-events-auto flex min-h-11 cursor-pointer items-center">
      <span className="flex h-8 items-center gap-1.5 rounded-full border border-border/60 bg-background pr-2.5 pl-3 text-[14px] font-medium text-foreground shadow-md">
        <span aria-hidden className="size-2 rounded-full" style={{ background: `var(--${a.tint})` }} />
        {a.name} {DOING[doing]}
        <Arrow className="size-3.5 text-muted-foreground" strokeWidth={2.25} />
      </span>
    </button>
  )
}

function Head({ a, words, busy, children }: { a: Agent; words?: string; busy?: boolean; children?: React.ReactNode }) {
  return (
    <div data-swipe className="flex touch-none items-center gap-2 pt-1.5 pr-1 pl-3.5">
      <span aria-hidden className="grid size-6 shrink-0 place-items-center rounded-full text-[12px] font-bold text-white" style={{ background: `var(--${a.tint})` }}>{a.name.charAt(0).toUpperCase()}</span>
      <span className="flex min-w-0 flex-1 items-center gap-1.5 text-[14px] font-semibold text-foreground">
        <span className="truncate">{a.name}</span>
        {words && <span className="truncate font-normal text-muted-foreground">{words}</span>}
        {busy && <span className="companion-dots text-muted-foreground" aria-label="still working"><i /><i /><i /></span>}
      </span>
      {children}
    </div>
  )
}

function useSwipeAway(away: () => void) {
  const ref = useRef<HTMLDivElement>(null), drag = useRef<{ id: number; x: number; y: number; dy: number; on: boolean } | null>(null)
  const put = (dy: number, held = false) => { const el = ref.current; if (el) { el.style.transition = held ? "none" : ""; el.style.translate = dy ? `0 ${dy}px` : ""; el.style.opacity = dy ? String(1 - Math.min(0.6, dy / 220)) : "" } }
  const end = (e: React.PointerEvent) => {
    const d = drag.current
    drag.current = null
    if (!d?.on) return
    if (d.dy > 56 && e.type === "pointerup") { haptic("light"); away() } else put(0)
  }
  return { ref, onPointerUp: end, onPointerCancel: end,
    onPointerDown: (e: React.PointerEvent) => { if (e.pointerType !== "mouse" && e.target instanceof Element && e.target.closest("[data-swipe]") && !e.target.closest("button, input")) drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, dy: 0, on: false } },
    onPointerMove: (e: React.PointerEvent) => {
      const d = drag.current
      if (!d || d.id !== e.pointerId) return
      const dx = e.clientX - d.x, dy = e.clientY - d.y
      if (!d.on) {
        if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return
        if (Math.abs(dx) > Math.abs(dy) || dy < 0) { drag.current = null; return }
        d.on = true
        e.currentTarget.setPointerCapture(e.pointerId)
      }
      d.dy = Math.max(0, dy)
      put(d.dy, true)
    } }
}

const CARD = "companion-card pointer-events-auto flex w-full flex-col overflow-hidden rounded-card border border-border/60 bg-background text-foreground shadow-lg"
const ring = (tint: string, question?: boolean) => ({ boxShadow: `0 0 0 ${question ? 2 : 1.5}px color-mix(in srgb, ${tint} ${question ? 70 : 45}%, transparent), 0 8px 28px rgba(0,0,0,.16)` })
const CLOSE = "grid size-11 shrink-0 cursor-pointer place-items-center rounded-control text-muted-foreground active:bg-foreground/[0.07]"

function SayCard({ n, a, hold }: { n: Note; a: Agent; hold: (on: boolean) => void }) {
  const [draft, setDraft] = useState(""), [inside, setInside] = useState(false), [gone, setGone] = useState(false)
  const tint = `var(--${a.tint})`, words = useRef<HTMLDivElement>(null)
  useEffect(() => { hold(!gone && (inside || !!draft)); return () => hold(false) }, [inside, draft, gone])
  useEffect(() => { sawShown(n.id) }, [n.id])
  useEffect(() => {
    if (n.seen) return
    const t = setTimeout(() => { if (document.visibilityState === "visible" && document.hasFocus()) sawSays([n.id]) }, readMs(n.text ?? ""))
    return () => clearTimeout(t)
  }, [n.id])
  const text = n.text ?? "", end = useRef(true)
  useLayoutEffect(() => { const el = words.current; if (el && end.current) el.scrollTop = el.scrollHeight }, [text])
  const close = () => { answer(n.id, "dismiss"); setGone(true) }
  const send = () => {
    const t = draft.trim()
    if (!t) return
    if (!answer(n.id, "reply", t)) return unsent()
    setDraft("")
    setGone(true)
  }
  const swipe = useSwipeAway(close)
  if (gone) return null
  const busy = a.state === "thinking" || a.state === "reading" || a.state === "writing"
  return (
    <div {...swipe} data-companion-card="say" data-companion-bubble={n.id} data-question={n.question || undefined} role={n.question ? "group" : undefined} aria-label={n.question ? `${a.name} asks` : `${a.name} says`}
      onFocus={() => setInside(true)} onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setInside(false) }}
      className={cn(CARD, n.question && "bg-[color-mix(in_srgb,var(--c)_8%,var(--background))]")} style={{ "--c": tint, ...ring(tint, n.question) } as React.CSSProperties}>
      <span aria-hidden data-swipe className="mx-auto mt-1.5 h-1 w-9 shrink-0 touch-none rounded-full bg-foreground/15" />
      <Head a={a} busy={busy}>
        <SayActions n={n} small />
        <button type="button" aria-label="Close" className={CLOSE} onClick={close}><X className="size-[18px]" /></button>
      </Head>
      <div ref={words} onScroll={(e) => { const el = e.currentTarget; end.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 8 }}
        className="edge-fade-y max-h-[min(38vh,320px)] min-w-0 overflow-y-auto overscroll-contain px-4 pb-2 text-[17px] leading-[1.4] select-text [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <Markdown text={text} className="companion-md" />
      </div>
      <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={n.question ? `Answer ${a.name}` : "Reply"} aria-label={`Reply to ${a.name}`} enterKeyHint="send"
        onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); send() } }}
        className="mx-2.5 mb-2.5 h-11 rounded-control border border-border/70 bg-background px-3 text-[17px] outline-none focus:border-foreground/30" />
    </div>
  )
}

function Conversation({ a, close }: { a: Agent; close: () => void }) {
  const swipe = useSwipeAway(close)
  useEffect(() => {
    const down = (e: PointerEvent) => { if (!(e.target instanceof Node && swipe.ref.current?.contains(e.target)) && !(e.target instanceof Element && e.target.closest("[data-menu-layer]"))) close() }
    addEventListener("pointerdown", down, true)
    return () => removeEventListener("pointerdown", down, true)
  }, [])
  return <div {...swipe} data-companion-card="conversation" className="companion-card pointer-events-auto w-full"><Popover a={a} phone close={close} menu={(e) => menuBelow(e, agentMenu(a))} /></div>
}

function AskCard({ a }: { a: Agent }) {
  const tint = `var(--${a.tint})`, ask = a.asks!
  const go = (v: "approve" | "deny") => { haptic("medium"); const undo = answered(a.name); answerAsk(ask.event, v).catch((e) => { undo(); notifyError(e, "Couldn't answer it") }) }
  return (
    <div data-companion-card="ask" data-companion-ask={ask.event} role="group" aria-label={`${a.name} asks`} className={CARD} style={ring(tint, true)}>
      <Head a={a} words="needs you" />
      <div className="px-4 pt-1.5 pb-2 text-[17px] leading-[1.4]">{ask.text}</div>
      <div className="flex gap-2 px-2.5 pb-2.5">
        <button type="button" data-gate="deny" onClick={() => go("deny")} className="h-11 flex-1 cursor-pointer rounded-control bg-foreground/[0.06] text-[17px] font-medium text-foreground active:bg-foreground/[0.12]">Deny</button>
        <button type="button" data-gate="approve" onClick={() => go("approve")} className="h-11 flex-1 cursor-pointer rounded-control text-[17px] font-medium text-white active:brightness-110" style={{ background: tint }}>Approve</button>
      </div>
    </div>
  )
}

const STYLE = `
.companion-flash { animation: companion-flash ${POINT_MS}ms ease-out forwards; }
@keyframes companion-flash { 0% { opacity: 0 } 12%, 60% { opacity: 1 } 100% { opacity: 0 } }
.companion-caret-think { animation: companion-caret-think 1.2s ease-in-out infinite; }
@keyframes companion-caret-think { 50% { opacity: .35 } }
.companion-card { animation: companion-card .3s cubic-bezier(.2,.9,.3,1); transition: translate .2s ease-out, opacity .2s; }
@keyframes companion-card { from { opacity: 0; translate: 0 16px; } }
@media (prefers-reduced-motion: reduce) { .companion-flash, .companion-caret-think, .companion-card, [data-companion-caret] { animation: none !important; transition: none !important; } }
`
