import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { ArrowRight, Check, Copy, ExternalLink, ImageOff, Pause, Play, Volume2, VolumeX, X } from "lucide-react"
import { edgeOf, type Media, type Mark, pacedBeats, PALETTE, type PaperItem, type Rect, svgFit } from "../../../core/desktop/screenmarks"
import { flatten } from "../../../core/desktop/svgpath"
import { PEN_LEAD, type PenScript } from "../core/pilot"
import { CAPTION_H, clampInto, inflate, place, type Placed, type Pt, ringShape, type Size, TOOLS, toolsRoom } from "./layout"
import { hash, headLines, inkPath, type Line, linePath, sketch, type Sketched } from "./ink"
import { durOf, FRAME_MS, lineStarts, markInk, penStrokes, STAGGER, waitForPen } from "./pen"
import type { Act, Shown } from "./index"
import { HOLD } from "./hold"

const PILL_H = 24, PILL_PX = 13, TAB_H = 20, TAB_PX = 12

let ctx: CanvasRenderingContext2D | null = null
export function measure(text: string, px: number, bold = false) {
  ctx ??= document.createElement("canvas").getContext("2d")
  if (!ctx) return text.length * px * 0.55
  ctx.font = `${bold ? 600 : 400} ${px}px ${getComputedStyle(document.body).fontFamily || "system-ui"}`
  return ctx.measureText(text).width
}
const labelOf = (m: Mark) => ("label" in m && m.label && m.type !== "button" && m.type !== "copy" && m.type !== "open" ? m.label : m.type === "scroll" ? "Scroll" : null)
const labelSize = (m: Mark): Size | null => { const l = labelOf(m); return !l ? null : m.type === "frame" ? { w: Math.ceil(measure(l, TAB_PX, true)) + 16, h: TAB_H } : { w: Math.ceil(measure(l, PILL_PX, true)) + 22, h: PILL_H } }

const born = new Map<string, { t0: number; shown: Map<number, number>; at: number; committed?: boolean; beat?: number
  began: Map<number, { at: number; delay: number }>
  penned: boolean }>()

export default function Draw({ d, act, leaving, pen, slot = 0, named = false }: { d: Shown; act: (a: Act) => void; leaving?: boolean; pen?: (s: PenScript | null) => void; slot?: number; named?: boolean }) {
  if (!born.has(d.id)) { const penned = !!pen && !!d.here.home && !still(); born.set(d.id, { t0: Date.now() + (penned ? PEN_LEAD : 0), shown: new Map(), began: new Map(), at: Date.now(), penned }); if (born.size > 20) born.delete(born.keys().next().value!) }
  const { t0, shown: showedAt, penned } = born.get(d.id)!
  const last = Math.max(0, ...d.marks.map((m) => m.beat ?? 0)), { times, spread } = useMemo(() => pacedBeats(d.caption ?? "", last, d.spoken, t0, d.waits), [d.caption, last, d.spoken, t0, d.waits])
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const next = times.find((t) => t0 + t > now)
    if (next === undefined || !Number.isFinite(next)) return
    const id = setTimeout(() => setNow(Date.now()), t0 + next - Date.now() + 5)
    return () => clearTimeout(id)
  }, [now, times, t0])
  const b0 = born.get(d.id)!, beat = b0.beat = Math.max(b0.beat ?? (Number.isFinite(times[0]) ? 0 : -1), times.filter((t) => t0 + t <= now).length - 1)
  const [naturals, setNaturals] = useState<Record<string, [number, number]>>({})
  const [moved, setMoved] = useState<Record<string, Pt>>({}), [hidden, setHidden] = useState<Set<string>>(() => new Set()), [full, setFull] = useState<Media | null>(null)
  const spots = useRef(new Map<string, { at: string; card: Rect }>())
  const drawnAs = useRef(new Map<string, Placed>())
  const placed = useMemo(() => {
    const room = [...(d.here.home ? [toolsRoom(d.here.width, d.here.height, slot)] : []), ...held(d.marks, spots.current)]
    return steady(place(d, d.here, labelSize, measure, naturals, room), spots.current, d.here).map((p) => asDrawn(p, drawnAs.current))
  }, [d, naturals, slot])
  const W = d.here.width, H = d.here.height, seed = hash(d.id)
  const startAt = useMemo(() => {
    const out = new Map<number, number>(), counts = new Map<number, number>(), of = new Map<number, number>()
    for (const p of placed) of.set(p.mark.beat ?? 0, (of.get(p.mark.beat ?? 0) ?? 0) + 1)
    for (const p of placed) { const b = p.mark.beat ?? 0, k = counts.get(b) ?? 0, gap = Math.max(STAGGER, (spread[b] ?? 0) / (of.get(b) ?? 1)); counts.set(b, k + 1); out.set(p.i, t0 + (times[b] ?? 0) + k * gap) }
    return penned ? waitForPen(placed.map(geometry), (i) => seed + i * 97, (i) => out.get(i)!) : out
  }, [placed, times, spread, t0, penned, seed])
  const shown = placed.filter((p) => (p.mark.beat ?? 0) <= beat)
  for (const p of shown) if (!showedAt.has(p.i)) showedAt.set(p.i, Date.now())
  const order = new Map(shown.map((p) => {
    const was = b0.began.get(p.i), at = startAt.get(p.i)!
    if (was && was.at <= Date.now()) return [p.i, was.delay]
    const delay = at - showedAt.get(p.i)!
    b0.began.set(p.i, { at, delay })
    return [p.i, delay]
  }))
  const script = useMemo(() => (pen && d.here.home ? { id: d.id, strokes: penStrokes(placed.filter((p) => !p.mark.gone && Number.isFinite(startAt.get(p.i))).map(geometry), (i) => seed + i * 97, (i) => startAt.get(i)!), ...(d.here.sound ? { sound: true } : {}) } : null), [pen, d.id, d.here.home, d.here.sound, placed, seed, startAt])
  // CSS animations may start after the commit (React holds a suspended part back): the clock starts with the first.
  const root = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const b = born.get(d.id)
    if (!b || b.committed) return
    b.committed = true
    let tries = 0, id = 0
    const align = () => {
      const el = root.current?.querySelector<SVGElement | HTMLElement>("[data-mark-i] .sd-pen, .sd-focus[data-mark-i]"), a = el?.getAnimations()[0], i = Number(el?.closest<SVGElement | HTMLElement>("[data-mark-i]")?.dataset.markI)
      if ((!a || a.startTime === null) && ++tries < 6) { id = requestAnimationFrame(align); return }
      const was = b.shown.get(i)
      if (!a || a.startTime === null || was === undefined) return
      const shift = Number(a.startTime) + (Date.now() - performance.now()) - was
      if (Math.abs(shift) < 2) return
      b.t0 += shift
      for (const [k, t] of b.shown) b.shown.set(k, t + shift)
      setNow(Date.now())
    }
    id = requestAnimationFrame(align)
    return () => cancelAnimationFrame(id)
  }, [d.id])
  const told = useRef("")
  useEffect(() => {
    if (!pen) return
    const s = leaving ? null : script, said = JSON.stringify(s)
    if (said !== told.current) { told.current = said; pen(s) }
  }, [pen, script, leaving])
  useEffect(() => () => pen?.(null), [pen])
  const newest = Math.max(0, ...shown.filter((p) => (startAt.get(p.i) ?? Infinity) <= now).map((p) => p.mark.beat ?? 0))
  const pastOf = (p: Placed) => (p.mark.gone || (p.mark.id && hidden.has(p.mark.id)) ? "sd-erase" : (p.mark.beat ?? 0) >= newest || p.card ? undefined : GONE.has(p.mark.type) ? "sd-gone" : STEP_BACK.has(p.mark.type) ? "sd-past" : undefined)
  const keepable = d.marks.some((m) => !m.gone && KEEPS.has(m.type))
  const bounds = { x: 0, y: d.here.top ?? 0, w: W, h: H - (d.here.top ?? 0) }
  const card = (p: Placed): CardCtx => {
    const id = p.mark.id ?? String(p.i), off = moved[id] ?? { x: 0, y: 0 }
    const ids = p.answers ? p.answers.map((a, i) => a.id ?? `${p.i + i}`) : [id]
    const away = !!leaving || !!d.hidden || !!p.mark.gone || ids.some((x) => hidden.has(x))
    return { off, bounds, move: (o) => setMoved((m) => ({ ...m, [id]: o })), open: setFull, agent: d.agent, question: d.question, hint: d.hint, away,
      natural: (px) => setNaturals((n) => (n[id]?.[0] === px[0] && n[id]?.[1] === px[1] ? n : { ...n, [id]: px })),
      media: (state) => act({ kind: "media", id: d.id, mark: id, ...state }),
      dismiss: () => { setHidden((h) => new Set([...h, ...ids])); for (const mark of ids) act({ kind: "dismiss", id: d.id, mark }) } }
  }
  return (
    <div ref={root} data-screendraw={d.id} data-beat={beat} data-agent={d.agent} className={`sd-root pointer-events-none fixed inset-0 ${leaving ? "sd-leave" : d.hidden ? "sd-hidden" : ""}`} style={{ "--tint": `var(--${d.tint})` }}>
      {shown.filter((p) => p.mark.type === "spotlight" && p.box).map((p) => <div key={p.i} className={pastOf(p)}><Spotlight r={p.box!} W={W} H={H} delay={order.get(p.i)!} /></div>)}
      {shown.filter((p) => p.mark.type === "frame" && p.box).map((p) => <div key={p.i} className={`sd-move ${pastOf(p) ?? ""}`} style={glide(p)}><Focus p={geometry(p)} delay={order.get(p.i)!} /></div>)}
      <svg className="sd-glow absolute inset-0 overflow-visible" width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
        {shown.map((p) => <g key={p.i} className={`sd-move ${pastOf(p) ?? ""}`} style={glide(p)}><Strokes p={geometry(p)} id={`sd${seed}-${p.i}`} seed={seed + p.i * 97} delay={order.get(p.i)!} /></g>)}
      </svg>
      {shown.map((p) => <div key={p.mark.id ?? p.i} className={`${p.card ? "" : "sd-move absolute left-0 top-0"} ${pastOf(p) ?? ""}`} style={p.card ? undefined : glide(p)}><Parts p={p.card ? p : geometry(p)} delay={order.get(p.i)!} act={(a) => act({ ...a, id: d.id })} card={p.card ? card(p) : undefined} seed={seed + p.i * 131} id={`sd${seed}-${p.mark.id ?? p.i}`} /></div>)}
      {d.here.home && shown.length > 0 && !leaving && !d.hidden && !shown.every((p) => isOver(p.mark)) && <Toolbar kept={d.kept} keepable={keepable} keep={() => act({ kind: "keep", id: d.id, places: d.places })} clear={() => act({ kind: "clear", id: d.id })} slot={slot} who={named ? d.agent : undefined} />}
      {full && <Lightbox m={full} close={() => setFull(null)} />}
    </div>
  )
}

type Moved = Placed & { drawn?: Placed }
function asDrawn(p: Placed, was: Map<string, Placed>): Moved {
  const key = `${p.mark.id ?? p.i}`, w = was.get(key)
  const same = w && w.box && p.box && w.mark.type === p.mark.type && p.mark.type !== "connect" && !p.card && (w.mark.beat ?? 0) === (p.mark.beat ?? 0)
    && near(w.box.w, p.box.w) && near(w.box.h, p.box.h) && (p.mark.type !== "ring" || ringShape(w.box) === ringShape(p.box))
  if (!same) { was.set(key, p); return p }
  return w.box!.x === p.box!.x && w.box!.y === p.box!.y && w.box!.w === p.box!.w && w.box!.h === p.box!.h ? p : { ...p, drawn: w }
}
const near = (a: number, b: number) => Math.abs(a - b) <= Math.max(4, Math.max(a, b) * 0.4)
const geometry = (p: Moved): Placed => p.drawn ?? p
function glide(p: Moved): React.CSSProperties {
  const a = p.drawn?.box, b = p.box
  if (!a || !b) return { transform: "translate(0px, 0px) scale(1, 1) translate(0px, 0px)", transformOrigin: "0 0" }
  const sx = a.w && b.w ? b.w / a.w : 1, sy = a.h && b.h ? b.h / a.h : 1
  return { transform: `translate(${b.x}px, ${b.y}px) scale(${sx}, ${sy}) translate(${-a.x}px, ${-a.y}px)`, transformOrigin: "0 0" }
}

const KEEPS = new Set<Mark["type"]>(["paper", "sticky", "list", "write", "image", "video", "button", "copy", "open"])
const isOver = (m: Mark) => (m.type === "image" || m.type === "video") && !!m.over
const atKey = (m: Mark) => JSON.stringify(("at" in m && m.at) || null)
const held = (marks: Mark[], was: Map<string, { at: string; card: Rect }>) =>
  marks.flatMap((m) => { const w = !m.gone && m.id ? was.get(m.id) : undefined; return w && w.at === atKey(m) ? [w.card] : [] })
function steady(placed: Placed[], was: Map<string, { at: string; card: Rect }>, here: { width: number; height: number; top?: number }) {
  const bounds = { x: 0, y: here.top ?? 0, w: here.width, h: here.height - (here.top ?? 0) }
  for (const p of placed) {
    if (!p.card || !p.mark.id) continue
    const at = atKey(p.mark), w = was.get(p.mark.id)
    if (w && w.at === at) p.card = clampInto({ x: w.card.x, y: w.card.y, w: p.card.w, h: p.card.h }, bounds)
    was.set(p.mark.id, { at, card: p.card })
  }
  return placed
}
const GONE = new Set<Mark["type"]>(["point", "spotlight"]), STEP_BACK = new Set<Mark["type"]>(["ring", "frame", "underline", "strike", "connect", "scroll"])
const ms = (n: number) => `${Number.isFinite(n) ? Math.round(n) : 86_400_000}ms`
const still = () => matchMedia("(prefers-reduced-motion: reduce)").matches

function boundsOf(l: Line, pad: number) {
  const xs = l.map((p) => p[0]), ys = l.map((p) => p[1]), x = Math.min(...xs) - pad, y = Math.min(...ys) - pad
  return { x, y, w: Math.max(...xs) + pad - x, h: Math.max(...ys) + pad - y }
}
function Ink({ id, lines, size = 4.5, delay }: { id: string; lines: Line[]; size?: number; delay: number }) {
  const starts = lineStarts(lines)
  return lines.map((l, j) => {
    const dur = durOf(l), start = delay + starts[j], mid = `${id}-${j}`, b = boundsOf(l, size * 3.4)
    return (
      <g key={j}>
        <mask id={mid} maskUnits="userSpaceOnUse" x={b.x} y={b.y} width={b.w} height={b.h}>
          <path d={linePath(l)} pathLength={1} className="sd-pen" fill="none" stroke="#fff" strokeWidth={size * 3.4} strokeLinecap="round" strokeLinejoin="round" style={{ "--delay": ms(start), "--dur": ms(dur) }} />
        </mask>
        <path d={inkPath(l, size)} mask={`url(#${mid})`} className="sd-ink" />
      </g>
    )
  })
}
function Sketch({ paths, delay, dur = 520, hatch = false }: { paths: Sketched[]; delay: number; dur?: number; hatch?: boolean }) {
  return paths.map((p, j) => (p.fill
    ? <path key={j} d={p.d} className="sd-fill sd-fade" style={{ "--delay": ms(delay + dur * 0.55) }} />
    : <path key={j} d={p.d} pathLength={1} className={`sd-pen sd-line ${p.hatch || hatch ? "sd-hatch" : ""}`} style={{ "--delay": ms(delay + (p.hatch ? dur * 0.6 : j * 60)), "--dur": ms(dur) }} />))
}

function Strokes({ p, id, seed, delay }: { p: Placed; id: string; seed: number; delay: number }) {
  const m = p.mark, r = p.box
  if (!r) return null
  const ink = markInk(p, seed)
  if (!ink) return null
  const lines = <Ink id={id} lines={ink.lines} size={ink.size} delay={delay} />
  return <g data-mark-i={p.i} className={m.type === "scroll" ? `sd-bob-${m.dir}` : undefined}>{lines}</g>
}
const pt = (p: [number, number]): Pt => ({ x: p[0], y: p[1] })

function Focus({ p, delay }: { p: Placed; delay: number }) {
  const r = p.ink ?? inflate(p.box!, 6)
  return <div data-mark-i={p.i} data-focus className="sd-focus absolute" style={{ left: r.x, top: r.y, width: r.w, height: r.h, borderRadius: Math.min(10, r.w / 2, r.h / 2), "--delay": ms(delay), "--dur": ms(FRAME_MS) }} />
}

function Spotlight({ r, W, H, delay }: { r: Rect; W: number; H: number; delay: number }) {
  const h = inflate(r, 8), rr = 10
  const hole = `M${h.x + rr},${h.y}H${h.x + h.w - rr}Q${h.x + h.w},${h.y} ${h.x + h.w},${h.y + rr}V${h.y + h.h - rr}Q${h.x + h.w},${h.y + h.h} ${h.x + h.w - rr},${h.y + h.h}H${h.x + rr}Q${h.x},${h.y + h.h} ${h.x},${h.y + h.h - rr}V${h.y + rr}Q${h.x},${h.y} ${h.x + rr},${h.y}Z`
  return <svg className="absolute inset-0" width={W} height={H}><path fillRule="evenodd" className="sd-dim sd-fade" style={{ d: `path("M0,0H${W}V${H}H0Z${hole}")`, "--delay": ms(delay) }} /></svg>
}

function Parts({ p, delay, act, card, seed, id }: { p: Placed; delay: number; act: (a: Act) => void; card?: CardCtx; seed: number; id: string }) {
  const m = p.mark, label = labelOf(m)
  const pop = (d: number) => ({ "--delay": ms(delay + d) })
  if (m.type === "num" && p.box) {
    const r = p.box, at = r.w || r.h ? { x: r.x - 11, y: r.y - 11 } : { x: r.x - 13, y: r.y - 13 }
    return <div data-mark="num" className="sd-badge sd-pop absolute" style={{ left: at.x, top: at.y, ...pop(0) }}>{m.n}</div>
  }
  if (p.card && card && isOver(m)) return <div data-card={m.id ?? p.i} className="pointer-events-none absolute" style={{ left: p.card.x, top: p.card.y, width: p.card.w }}><Card p={p} delay={delay} act={act} ctx={card} seed={seed} id={id} /></div>
  if (p.card && card) return <Shell p={p} ctx={card}><Card p={p} delay={delay} act={act} ctx={card} seed={seed} id={id} /></Shell>
  if (!label || !p.label) return null
  const after = m.type === "frame" ? FRAME_MS * 0.8 : m.type === "connect" || m.type === "ring" ? 420 : 300, t = p.ink ?? p.box!, l = p.label
  const from = l.x >= t.x + t.w - 1 ? { o: "left center", dx: -10, dy: 0 } : l.x + l.w <= t.x + 1 ? { o: "right center", dx: 10, dy: 0 } : l.y >= t.y + t.h - 1 ? { o: "center top", dx: 0, dy: -6 } : { o: "center bottom", dx: 0, dy: 6 }
  return (
    <div data-mark-label={m.type} aria-label={label} className={`${m.type === "frame" ? "sd-pill sd-frame-tag" : "sd-pill"} sd-tag absolute`}
      style={{ left: l.x, top: l.y, width: l.w, transformOrigin: from.o, "--dx": `${from.dx}px`, "--dy": `${from.dy}px`, ...pop(after) }}>
      <Typed text={label} delay={delay + after + 60} />
    </div>
  )
}
function Typed({ text, delay }: { text: string; delay: number }) {
  const [n, setN] = useState(() => (delay <= 0 || still() ? text.length : 0))
  useEffect(() => {
    if (n >= text.length) return
    const id = setTimeout(() => setN((k) => k + 1), n === 0 ? delay : Math.min(30, 480 / text.length))
    return () => clearTimeout(id)
  }, [n, text, delay])
  return <><span>{text.slice(0, n)}</span><span aria-hidden className="invisible">{text.slice(n)}</span></>
}

function Press({ children, className, style, onClick, label }: { children: React.ReactNode; className: string; style?: React.CSSProperties; onClick: () => void; label?: string }) {
  return (
    <button type="button" aria-label={label} className={`pointer-events-auto ${className}`} style={style} onClick={onClick} {...HOLD}>
      {children}
    </button>
  )
}

type CardCtx = { off: Pt; bounds: Rect; move: (off: Pt) => void; dismiss: () => void; open: (m: Media) => void; natural: (px: [number, number]) => void
  media: (state: { sound?: boolean; paused?: boolean }) => void
  agent: string; question?: string; hint?: string
  away: boolean }

function Shell({ p, ctx, children }: { p: Placed; ctx: CardCtx; children: React.ReactNode }) {
  const c = p.card!, drag = useRef<{ x: number; y: number; ox: number; oy: number; moved: boolean } | null>(null), dragged = useRef(false)
  const clampOff = (o: Pt) => {
    const r = clampInto({ x: c.x + o.x, y: c.y + o.y, w: c.w, h: c.h }, ctx.bounds)
    return { x: r.x - c.x, y: r.y - c.y }
  }
  const off = clampOff(ctx.off)
  return (
    <div data-card={p.mark.id ?? p.i} className="sd-shell pointer-events-auto absolute" style={{ left: c.x + off.x, top: c.y + off.y, width: c.w }}
      {...HOLD}
      onPointerDown={(e) => { if (e.button !== 0 || (e.target as HTMLElement).closest("[data-nodrag]")) return; drag.current = { x: e.clientX, y: e.clientY, ox: off.x, oy: off.y, moved: false } }}
      onPointerMove={(e) => {
        const g = drag.current
        if (!g) return
        const dx = e.clientX - g.x, dy = e.clientY - g.y
        if (!g.moved && Math.hypot(dx, dy) < 4) return
        if (!g.moved) { g.moved = true; e.currentTarget.setPointerCapture(e.pointerId) }
        ctx.move(clampOff({ x: g.ox + dx, y: g.oy + dy }))
      }}
      onPointerUp={() => {
        const g = drag.current
        drag.current = null
        if (!g?.moved) return
        dragged.current = true
        setTimeout(() => { dragged.current = false })
      }}
      onClickCapture={(e) => { if (dragged.current) { e.stopPropagation(); e.preventDefault() } }}>
      {children}
      <button type="button" data-nodrag aria-label="Dismiss" className="sd-x" onClick={ctx.dismiss}><X className="size-3" strokeWidth={2.6} /></button>
    </div>
  )
}

function Card({ p, delay, act, ctx, seed, id }: { p: Placed; delay: number; act: (a: Act) => void; ctx: CardCtx; seed: number; id: string }) {
  const m = p.mark, c = p.card!, [done, setDone] = useState(false)
  const box = { width: c.w, "--delay": ms(delay) }
  if (m.type === "write") return <div data-mark="write" className={`sd-write sd-fade sd-${m.size ?? "m"}`} style={box}>{m.text}</div>
  if (m.type === "sticky") return (
    <div data-mark="sticky" className="sd-card sd-sticky sd-pop" style={{ ...box, minHeight: c.h }}>
      {m.title && <div className="sd-title">{m.title}</div>}
      <div className="whitespace-pre-wrap">{m.text}</div>
    </div>
  )
  if (m.type === "list") return (
    <div data-mark="list" className="sd-card sd-pop" style={box}>
      {m.title && <div className="sd-title">{m.title}</div>}
      <ol className="flex flex-col gap-1">
        {m.items.map((x, i) => <li key={i} className="sd-fade flex gap-2" style={{ "--delay": ms(delay + 200 + i * 140) }}><span className="sd-bullet">{m.numbered ? i + 1 : "•"}</span><span>{x}</span></li>)}
      </ol>
    </div>
  )
  if (m.type === "paper") return <Paper m={m} c={c} delay={delay} seed={seed} id={id} />
  if (m.type === "image" || m.type === "video") return <MediaCard m={m} c={c} delay={delay} ctx={ctx} />
  if (p.answers) return <Choices answers={p.answers} c={c} delay={delay} ctx={ctx} act={act} />
  const run = () => {
    const a = m.type === "copy" ? { copy: m.text } : m.type === "open" ? { open: m.url } : m.type === "button" ? m.do : null
    if (!a) return
    act("copy" in a ? { kind: "copy", text: a.copy } : "open" in a ? { kind: "open", url: a.open } : { kind: "ask", text: a.ask })
    if ("copy" in a) { setDone(true); setTimeout(() => setDone(false), 1500) }
  }
  const text = m.type === "copy" ? (done ? "Copied" : m.label ?? "Copy") : m.type === "open" ? m.label ?? "Open" : m.type === "button" ? m.label : ""
  const Icon = m.type === "copy" ? (done ? Check : Copy) : m.type === "open" ? ExternalLink : m.type === "button" && "copy" in m.do ? Copy : m.type === "button" && "open" in m.do ? ExternalLink : ArrowRight
  return (
    <Press className="sd-chip sd-pop" style={{ "--delay": ms(delay), maxWidth: c.w }} onClick={run}>
      <Icon className="size-3.5 shrink-0" strokeWidth={2.2} /><span className="truncate">{text}</span>
    </Press>
  )
}

function MediaCard({ m, c, delay, ctx }: { m: Media; c: Rect; delay: number; ctx: CardCtx }) {
  const [state, setState] = useState<"loading" | "ok" | "failed">("loading"), v = useRef<HTMLVideoElement>(null)
  const [muted, setMuted] = useState(!m.sound), [playing, setPlaying] = useState(!m.paused), [at, setAt] = useState(0), [dur, setDur] = useState(0)
  const h = c.h - (m.caption && !m.over ? CAPTION_H : 0), name = m.name ?? m.src.split("/").pop()
  const failed = state === "failed" || !m.url
  const loaded = (e: HTMLVideoElement) => { setState("ok"); setDur(Number.isFinite(e.duration) ? e.duration : 0); if (e.videoWidth) ctx.natural([e.videoWidth, e.videoHeight]) }
  useEffect(() => {
    const e = v.current
    if (!e) return
    if (e.readyState >= 1) loaded(e)
    const t0 = Date.now(), id = setInterval(() => {
      if (e.readyState >= 1) { loaded(e); clearInterval(id) } else if (e.error || Date.now() - t0 > LOAD_MS) { setState("failed"); clearInterval(id) }
    }, 250)
    return () => clearInterval(id)
  }, [m.url])
  useEffect(() => { if (m.type !== "image" || state !== "loading") return; const t = setTimeout(() => setState((s) => (s === "loading" ? "failed" : s)), LOAD_MS); return () => clearTimeout(t) }, [m.type, m.url, state])
  const rounds = useRef(0)
  useEffect(() => { const e = v.current; if (e && !m.paused) play(e) }, [m.url])
  const play = (e: HTMLVideoElement) => {
    rounds.current = 0
    if (e.ended) e.currentTime = 0
    e.play().catch(() => { if (!e.muted) { e.muted = true; setMuted(true); ctx.media({ sound: false }); void e.play().catch(() => {}) } })
  }
  const said = useRef({ sound: !!m.sound, paused: !!m.paused })
  useEffect(() => {
    const e = v.current, was = said.current
    said.current = { sound: !!m.sound, paused: !!m.paused }
    if (!e) return
    if (!!m.sound !== was.sound) { setMuted(!m.sound); e.muted = !m.sound; if (m.sound && !m.paused && e.paused) play(e) }
    if (!!m.paused !== was.paused) { if (m.paused) e.pause(); else if (e.paused) play(e) }
  }, [m.sound, m.paused])
  const stoppedAway = useRef(false)
  useEffect(() => {
    const e = v.current
    if (!e) return
    if (ctx.away && !e.paused) { stoppedAway.current = true; e.pause() } else if (!ctx.away && stoppedAway.current) { stoppedAway.current = false; void e.play().catch(() => {}) }
  }, [ctx.away])
  const toggleSound = () => { const e = v.current, on = muted; setMuted(!on); if (e) { e.muted = !on; if (on && e.paused) { play(e); ctx.media({ sound: true, paused: false }); return } } ctx.media({ sound: on }) }
  const togglePlay = () => { const e = v.current; if (!e) return; if (e.paused) { play(e); ctx.media({ paused: false }) } else { e.pause(); ctx.media({ paused: true }) } }
  return (
    <div data-mark={m.type} data-state={failed ? "failed" : state} data-over={m.over ? "" : undefined} data-sound={m.type === "video" ? (muted ? "off" : "on") : undefined} data-playing={m.type === "video" ? (playing ? "" : undefined) : undefined}
      className={`sd-card sd-media ${m.over ? "sd-over" : "sd-pop"}`} style={{ width: c.w, padding: 0, "--delay": ms(delay) }}>
      <div className="sd-media-box relative" style={{ height: h }}>
        {failed ? <div role="alert" className="sd-media-failed"><ImageOff className="size-5" strokeWidth={1.8} /><span>Couldn't load {name}</span></div>
          : m.type === "image"
            ? <img src={m.url} alt={m.caption ?? name ?? ""} draggable={false} className={`size-full ${m.over ? "object-fill" : "cursor-zoom-in object-contain"}`}
              onLoad={(e) => { setState("ok"); ctx.natural([e.currentTarget.naturalWidth, e.currentTarget.naturalHeight]) }} onError={() => setState("failed")} onClick={() => { if (!m.over) ctx.open(m) }} />
            : <>
              <video ref={v} src={m.url} muted={muted} autoPlay={!m.paused} playsInline className="size-full cursor-pointer object-contain"
                onEnded={(e) => { if (muted && ++rounds.current < ROUNDS) void e.currentTarget.play(); else ctx.media({ paused: true }) }}
                onLoadedMetadata={(e) => loaded(e.currentTarget)}
                onTimeUpdate={(e) => { setAt(e.currentTarget.currentTime); if (!dur && Number.isFinite(e.currentTarget.duration)) setDur(e.currentTarget.duration) }} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onError={() => setState("failed")}
                onClick={togglePlay} />
              {state === "ok" && !playing && <button type="button" data-nodrag aria-label="Play" className="sd-media-big" onClick={togglePlay}><Play className="size-5" fill="currentColor" /></button>}
              {state === "ok" && <button type="button" data-nodrag aria-label={muted ? "Unmute" : "Mute"} className="sd-media-sound" onClick={toggleSound}>
                {muted ? <VolumeX className="size-3.5" /> : <Volume2 className="size-3.5" />}</button>}
              <div data-nodrag className="sd-media-bar">
                <button type="button" aria-label={playing ? "Pause" : "Play"} onClick={togglePlay}>{playing ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}</button>
                <input type="range" aria-label="Scrub" min={0} max={dur || 1} step={0.05} value={at} onChange={(e) => { const x = Number(e.target.value); setAt(x); if (v.current) v.current.currentTime = x }} />
                <span className="sd-media-time">{clock(at)} / {clock(dur)}</span>
              </div>
            </>}
        {state === "loading" && !failed && <div className="sd-media-wait" />}
      </div>
      {m.caption && (m.over ? <div className="sd-over-tab">{m.caption}</div> : <div className="sd-media-caption truncate">{m.caption}</div>)}
    </div>
  )
}
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`

function Choices({ answers, c, delay, ctx, act }: { answers: Extract<Mark, { type: "button" }>[]; c: Rect; delay: number; ctx: CardCtx; act: (a: Act) => void }) {
  const [picked, setPicked] = useState<number | null>(null)
  return (
    <div data-choices role="group" aria-label={ctx.question ?? "Choose one"} className="sd-card sd-choices sd-pop" style={{ width: c.w, "--delay": ms(delay) }}>
      <div className="sd-choices-who">{ctx.question ? `${ctx.agent} asks` : ctx.agent}</div>
      {ctx.question ? <div className="sd-choices-q">{ctx.question}</div> : <div className="h-1" />}
      <div className="flex flex-col gap-1">
        {answers.map((a, i) => {
          const ask = "ask" in a.do ? a.do.ask : a.label
          return (
            <button key={a.id ?? i} type="button" data-nodrag data-answer={a.id} disabled={picked !== null} data-picked={picked === i ? "" : undefined}
              className="sd-answer sd-fade" style={{ "--delay": ms(delay + 120 + i * 90) }}
              onClick={() => { setPicked(i); act({ kind: "ask", text: ask }) }}>
              {picked === i ? <Check className="size-3.5 shrink-0" strokeWidth={2.6} /> : <ArrowRight className="size-3.5 shrink-0" strokeWidth={2.4} />}
              <span className="min-w-0 flex-1"><span className="block truncate">{a.label}</span>{ask !== a.label && <span className="sd-answer-sub">{ask}</span>}</span>
            </button>
          )
        })}
      </div>
      {ctx.hint && <div className="sd-choices-hint sd-fade" style={{ "--delay": ms(delay + 120 + answers.length * 90) }}>{ctx.hint}</div>}
    </div>
  )
}

const LOAD_MS = 15_000, ROUNDS = 3

function Lightbox({ m, close }: { m: Media; close: () => void }) {
  return (
    <button type="button" aria-label="Close the picture" data-lightbox {...HOLD} className="sd-lightbox pointer-events-auto fixed inset-0 grid cursor-zoom-out place-items-center" onClick={close}>
      <img src={m.url} alt={m.caption ?? m.name ?? ""} draggable={false} className="max-h-[88vh] max-w-[92vw] rounded-lg object-contain shadow-2xl" />
      {m.caption && <span className="sd-lightbox-caption">{m.caption}</span>}
    </button>
  )
}

const inkCss = (c?: string) => (!c || c === "tint" ? "var(--tint)" : c === "ink" || c === "black" ? "var(--foreground)" : c.startsWith("#") ? c : PALETTE[c]?.[0] ?? "var(--tint)")
const fillCss = (c?: string) => (!c || c === "none" ? "none" : c === "tint" ? "color-mix(in srgb, var(--tint) 28%, var(--background))" : c === "ink" ? "color-mix(in srgb, var(--foreground) 16%, var(--background))" : c.startsWith("#") ? c : PALETTE[c]?.[1] ?? "none")
const onFill = (c?: string) => (c && c !== "none" && c !== "ink" && c !== "tint" && !c.startsWith("#") ? "#1e1e1e" : undefined)

function Paper({ m, c, delay, seed, id }: { m: Extract<Mark, { type: "paper" }>; c: Rect; delay: number; seed: number; id: string }) {
  const W = m.w, H = m.h, first = useRef<Set<string> | null>(null), later = useRef(new Map<string, number>())
  const keyOf = (it: PaperItem, i: number) => it.id ?? String(i)
  first.current ??= new Set(m.items.map(keyOf))
  let k = 0
  const delays = m.items.map((it, i) => {
    const key = keyOf(it, i)
    if (first.current!.has(key)) return delay + 260 + i * 160
    if (!later.current.has(key)) later.current.set(key, 120 + k++ * 220)
    return later.current.get(key)!
  })
  return (
    <div data-mark="paper" className="sd-card sd-paper sd-pop" style={{ width: c.w, padding: 0, "--delay": ms(delay) }}>
      {m.title && <div className="sd-title px-3 pt-2.5">{m.title}</div>}
      <div className={`relative ${m.grid ? "sd-grid" : ""}`} style={{ width: W, height: H }}>
        <svg className="absolute inset-0 overflow-visible" width={W} height={H}>
          {m.items.map((it, i) => <g key={keyOf(it, i)} data-item={it.id} className={it.gone ? "sd-erase" : undefined} style={{ "--ink": inkCss(it.color), "--fill": fillCss(it.fill) }}>
            <Item it={it} items={m.items} id={`${id}-p${keyOf(it, i)}`} seed={seed + hash(keyOf(it, i))} delay={delays[i]} /></g>)}
        </svg>
        {m.items.map((it, i) => <div key={keyOf(it, i)} className={it.gone ? "sd-erase" : undefined}><ItemText it={it} items={m.items} delay={delays[i]} /></div>)}
      </div>
    </div>
  )
}
const at = (x: number, y: number) => ({ transform: `translate(${x}px, ${y}px)` })
function Item({ it, items, id, seed, delay }: { it: PaperItem; items: PaperItem[]; id: string; seed: number; delay: number }) {
  const ink = (lines: Line[], size = 3.4) => <Ink id={id} lines={lines} size={size} delay={delay} />
  const shape = (paths: Sketched[]) => <Sketch paths={paths} delay={delay} />
  if (it.type === "rect" || it.type === "ellipse" || it.type === "diamond") {
    const local = { x: 0, y: 0, w: it.w, h: it.h }, fill = it.fill && it.fill !== "none"
    return <g className="sd-move" style={at(it.x, it.y)}>{shape(sketch(it.type, local, seed, { solid: !!fill, roughness: 1 }))}</g>
  }
  if (it.type === "line" || it.type === "arrow") {
    const a = edgeOf(it.from, it.to, items), b = edgeOf(it.to, it.from, items), from = pt(a), to = pt(b)
    const heads = it.type === "arrow" ? headLines(to, from, 11).map((l) => sketch("open", l, seed + 3, { roughness: 0.6 })).flat() : []
    return <g key={`${a.join()}-${b.join()}`}><Sketch paths={[...sketch("line", [from, to], seed, { roughness: 1 }), ...heads]} delay={delay} dur={420} /></g>
  }
  if (it.type === "path") return ink([it.points])
  if (it.type === "svg") return <Svg it={it} seed={seed} delay={delay} />
  if (it.type !== "chart") return null
  const { x, y, w, h } = it, foot = it.labels ? 16 : 0, top = Math.max(...it.values, 0), low = Math.min(...it.values, 0), span = top - low || 1, step = w / it.values.length
  const yOf = (v: number) => y + (h - foot) - ((v - low) / span) * (h - foot)
  const base = <Sketch paths={sketch("line", [{ x, y: yOf(0) }, { x: x + w, y: yOf(0) }], seed, { roughness: 0.6 })} delay={delay} dur={300} />
  if (it.kind === "bar") return (
    <g>{base}{it.values.map((v, i) => {
      const bx = x + i * step + step * 0.18, bw = step * 0.64, by = Math.min(yOf(v), yOf(0)), bh = Math.max(1, Math.abs(yOf(v) - yOf(0)))
      return <Sketch key={i} paths={sketch("rect", { x: bx, y: by, w: bw, h: bh }, seed + i, { fill: true, roughness: 0.8 })} delay={delay + 200 + i * 90} dur={380} />
    })}</g>
  )
  const pts = it.values.map((v, i): [number, number] => [x + i * step + step / 2, yOf(v)])
  return <g>{base}{ink([pts], 3.2)}{pts.map(([px, py], i) => <circle key={i} cx={px} cy={py} r={3.2} className="sd-dot sd-fade" style={{ "--delay": ms(delay + 300 + i * 60) }} />)}</g>
}
function Svg({ it, seed, delay }: { it: Extract<PaperItem, { type: "svg" }>; seed: number; delay: number }) {
  const fit = useMemo(() => svgFit(it), [it]), n = it.paths.length, step = Math.min(420, 3200 / n), dur = Math.min(900, Math.max(320, step * 1.6))
  const style = (j: number, extra: React.CSSProperties = {}) => ({ "--delay": ms(delay + j * step), "--dur": ms(dur), ...extra })
  if (it.style === "sketch") {
    const toBox = ([x, y]: [number, number]): [number, number] => [it.x + fit.ox + (x - fit.vx) * fit.k, it.y + fit.oy + (y - fit.vy) * fit.k]
    return <g>{it.paths.map((sp, j) => {
      const fill = sp.fill ?? it.fill, stroke = sp.color === "none" ? fill : sp.color ?? it.color
      return <g key={j} style={{ "--ink": inkCss(stroke), "--fill": fillCss(fill) }}>
        {flatten(sp.d).map((sub, k) => <Sketch key={k} paths={sketch(sub.closed ? "poly" : "open", sub.pts.map(toBox), seed + j * 31 + k, { solid: sub.closed && !!fill && fill !== "none", roughness: 0.9 })} delay={delay + j * step} dur={dur} />)}
      </g>
    })}</g>
  }
  // No vector-effect: non-scaling-stroke here: it breaks the pen's dash animation in Chromium.
  return (
    <g transform={`translate(${it.x + fit.ox} ${it.y + fit.oy}) scale(${fit.k}) translate(${-fit.vx} ${-fit.vy})`}>
      {it.paths.map((sp, j) => {
        const fill = sp.fill ?? it.fill, stroke = sp.color === "none" ? (fill && fill !== "none" ? fill : undefined) : sp.color ?? it.color
        return <g key={j}>
          {fill && fill !== "none" && <path d={sp.d} className="sd-svg-fill" style={style(j, { fill: fillCss(fill) === "none" ? undefined : fillCss(fill), "--delay": ms(delay + j * step + dur * 0.7) })} />}
          {stroke !== undefined || !fill || fill === "none" ? <path d={sp.d} pathLength={1} className="sd-pen sd-svg" style={style(j, { stroke: inkCss(stroke), strokeWidth: (sp.width ?? 2.4) / fit.k })} /> : null}
        </g>
      })}
    </g>
  )
}
function ItemText({ it, items, delay }: { it: PaperItem; items: PaperItem[]; delay: number }) {
  const pos = (x: number, y: number, extra: React.CSSProperties = {}) => ({ left: x, top: y, "--delay": ms(delay + 200), ...extra })
  const color = it.color ? { color: inkCss(it.color) } : {}
  if (it.type === "text") return <div className={`sd-ptext sd-fade sd-move-xy absolute sd-${it.size ?? "m"}`} style={pos(it.x, it.y, color)}>{it.text}</div>
  if ((it.type === "rect" || it.type === "ellipse" || it.type === "diamond") && it.label) return <div className="sd-plabel sd-fade sd-move-xy absolute grid place-items-center text-center" style={pos(it.x, it.y, { width: it.w, height: it.h, padding: it.type === "diamond" ? `0 ${it.w * 0.18}px` : "0 6px", whiteSpace: "normal", color: onFill(it.fill) })}>{it.label}</div>
  if ((it.type === "line" || it.type === "arrow") && it.label) {
    const a = edgeOf(it.from, it.to, items), b = edgeOf(it.to, it.from, items), steep = Math.abs(b[1] - a[1]) > Math.abs(b[0] - a[0])
    return <div className={`sd-plabel sd-fade sd-move-xy absolute ${steep ? "-translate-y-1/2 pl-1.5" : "-translate-x-1/2 -translate-y-full pb-1"}`} style={pos((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)}>{it.label}</div>
  }
  if (it.type === "chart" && it.labels) {
    const step = it.w / it.values.length
    return it.labels.map((l, i) => <div key={i} className="sd-axis sd-fade absolute truncate text-center" style={pos(it.x + i * step, it.y + it.h - 14, { width: step })}>{l}</div>)
  }
  return null
}

function Toolbar({ kept, keepable, keep, clear, slot, who }: { kept?: string; keepable: boolean; keep: () => void; clear: () => void; slot: number; who?: string }) {
  return (
    <div className="sd-tools sd-pop absolute left-1/2 flex -translate-x-1/2 items-center gap-1" style={{ bottom: TOOLS.bottom + slot * TOOLS.row, "--delay": "500ms" }}>
      {who && <span className="sd-tool sd-who">{who}</span>}
      {keepable && (kept
        ? <span data-kept className="sd-tool"><Check className="size-3.5" strokeWidth={2.4} /><span className="max-w-[260px] truncate">Kept in {kept.replace(/\.excalidraw$/, "")}</span></span>
        : <Press className="sd-tool" onClick={keep}>Keep</Press>)}
      <Press className="sd-tool" onClick={clear} label="Clear the drawing"><X className="size-3.5" strokeWidth={2.4} />Clear</Press>
    </div>
  )
}
