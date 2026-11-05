// A drawing on one display, as a hand would make it in the companion's colour: strokes drawn as by a pen, in beats with
// its words; labels in pills, cards on calm space, a Keep and a Clear while it's up.
import { useEffect, useMemo, useRef, useState } from "react"
import { ArrowRight, Check, Copy, ExternalLink, X } from "lucide-react"
import { beatTimes, type Mark, type PaperItem, type Rect } from "../../../plugins/core/companion/screenmarks"
import { centre, inflate, markSpot, place, ringBox, type Placed, type Pt, type Size } from "./layout"
import { bowLine, checkLines, crossLines, curveLine, hash, headLines, inkPath, type Line, linePath, ringLine, seeded, sketch } from "./ink"
import type { Act, Shown } from "./index"

const STAGGER = 170
const PILL_H = 22

let ctx: CanvasRenderingContext2D | null = null
/** How wide `text` is in the overlay's font. */
export function measure(text: string, px: number, bold = false) {
  ctx ??= document.createElement("canvas").getContext("2d")
  if (!ctx) return text.length * px * 0.55
  ctx.font = `${bold ? 600 : 400} ${px}px ${getComputedStyle(document.body).fontFamily || "system-ui"}`
  return ctx.measureText(text).width
}
const labelOf = (m: Mark) => ("label" in m && m.label && m.type !== "button" && m.type !== "copy" && m.type !== "open" ? m.label : m.type === "scroll" ? "Scroll" : null)
const labelSize = (m: Mark): Size | null => { const l = labelOf(m); return l ? { w: Math.ceil(measure(l, 12.5, true)) + 18, h: PILL_H } : null }

/** When each drawing was first seen: its beats count from then, whatever comes again (kept, a new place). */
const born = new Map<string, number>()

export default function Draw({ d, act, grab, leaving }: { d: Shown; act: (a: Act) => void; grab: (on: boolean) => void; leaving?: boolean }) {
  if (!born.has(d.id)) { born.set(d.id, Date.now()); if (born.size > 20) born.delete(born.keys().next().value!) }
  const t0 = born.get(d.id)!
  const last = Math.max(0, ...d.marks.map((m) => m.beat ?? 0)), times = useMemo(() => beatTimes(d.caption ?? "", last), [d.caption, last])
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const next = times.find((t) => t0 + t > now)
    if (next === undefined) return
    const id = setTimeout(() => setNow(Date.now()), t0 + next - Date.now() + 5)
    return () => clearTimeout(id)
  }, [now, times, t0])
  const beat = times.filter((t) => t0 + t <= now).length - 1
  const placed = useMemo(() => place(d, d.here, labelSize, measure), [d])
  // (in each beat, one after another)
  const order = new Map<number, number>(), counts = new Map<number, number>()
  for (const p of placed) { const b = p.mark.beat ?? 0, k = counts.get(b) ?? 0; counts.set(b, k + 1); order.set(p.i, k * STAGGER) }
  const shown = placed.filter((p) => (p.mark.beat ?? 0) <= beat)
  const W = d.here.width, H = d.here.height, seed = hash(d.id)
  const keepable = d.marks.some((m) => m.type === "paper" || m.type === "sticky" || m.type === "list" || m.type === "write")
  return (
    <div data-screendraw={d.id} data-beat={beat} className={`sd-root pointer-events-none fixed inset-0 ${leaving ? "sd-leave" : ""}`} style={{ "--tint": `var(--${d.tint})` } as React.CSSProperties}>
      {shown.filter((p) => p.mark.type === "spotlight" && p.box).map((p) => <Spotlight key={p.i} r={p.box!} W={W} H={H} delay={order.get(p.i)!} />)}
      <svg className="sd-glow absolute inset-0 overflow-visible" width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
        {shown.map((p) => <Strokes key={p.i} p={p} id={`sd${seed}-${p.i}`} seed={seed + p.i * 97} delay={order.get(p.i)!} W={W} H={H} />)}
      </svg>
      {shown.map((p) => <Parts key={p.i} p={p} delay={order.get(p.i)!} act={(a) => act({ ...a, id: d.id })} grab={grab} seed={seed + p.i * 131} id={`sd${seed}-${p.i}`} />)}
      {d.here.home && shown.length > 0 && !leaving && <Toolbar kept={d.kept} keepable={keepable} keep={() => act({ kind: "keep", id: d.id, places: d.places })} clear={() => act({ kind: "clear", id: d.id })} grab={grab} />}
    </div>
  )
}

const ms = (n: number) => `${Math.round(n)}ms`
const lenOf = (l: Line) => l.reduce((s, p, i) => (i ? s + Math.hypot(p[0] - l[i - 1][0], p[1] - l[i - 1][1]) : 0), 0)
const durOf = (l: Line) => Math.min(650, Math.max(180, lenOf(l) * 1.3))

/** Ink along each line, revealed as a pen draws it (a mask along the line), one line after the other. */
function Ink({ id, lines, size = 4.5, delay, W, H }: { id: string; lines: Line[]; size?: number; delay: number; W: number; H: number }) {
  let at = delay
  return lines.map((l, j) => {
    const dur = durOf(l), start = at, mid = `${id}-${j}`
    at += dur * 0.85
    return (
      <g key={j}>
        <mask id={mid} maskUnits="userSpaceOnUse" x={-50} y={-50} width={W + 100} height={H + 100}>
          <path d={linePath(l)} pathLength={1} className="sd-pen" fill="none" stroke="#fff" strokeWidth={size * 3.4} strokeLinecap="round" strokeLinejoin="round" style={{ "--delay": ms(start), "--dur": ms(dur) } as React.CSSProperties} />
        </mask>
        <path d={inkPath(l, size)} mask={`url(#${mid})`} className="sd-ink" />
      </g>
    )
  })
}
/** rough.js' strokes, drawn as by a pen. */
function Sketch({ paths, delay, dur = 520, hatch = false }: { paths: { d: string; hatch: boolean }[]; delay: number; dur?: number; hatch?: boolean }) {
  return paths.map((p, j) => (
    <path key={j} d={p.d} pathLength={1} className={`sd-pen sd-line ${p.hatch || hatch ? "sd-hatch" : ""}`} style={{ "--delay": ms(delay + (p.hatch ? dur * 0.6 : j * 60)), "--dur": ms(dur) } as React.CSSProperties} />
  ))
}

/** A mark's strokes on the screen (cards draw their own). */
function Strokes({ p, id, seed, delay, W, H }: { p: Placed; id: string; seed: number; delay: number; W: number; H: number }) {
  const m = p.mark, r = p.box, rnd = seeded(seed), ink = (lines: Line[], size?: number) => <Ink id={id} lines={lines} size={size} delay={delay} W={W} H={H} />
  if (!r) return null
  switch (m.type) {
    case "ring": return ink([ringLine(ringBox(m, r), rnd)])
    case "frame": return (
      <g>
        <rect x={r.x - 6} y={r.y - 6} width={r.w + 12} height={r.h + 12} rx={8} className="sd-tintfill sd-fade" style={{ "--delay": ms(delay + 250) } as React.CSSProperties} />
        <Sketch paths={sketch("rect", inflate(r, 6), seed, { roughness: 0.9 })} delay={delay} dur={700} />
      </g>
    )
    case "underline": return ink([bowLine({ x: r.x - 4, y: r.y + r.h + 5 }, { x: r.x + r.w + 4, y: r.y + r.h + 3 + rnd() * 2 }, 2 + rnd() * 2)], 4)
    case "strike": return ink([bowLine({ x: r.x - 5, y: r.y + r.h * 0.55 }, { x: r.x + r.w + 5, y: r.y + r.h * 0.45 }, 1.5)], 3.6)
    case "check": return ink(checkLines(markSpot(r)), 4.6)
    case "cross": return ink(crossLines(markSpot(r)), 4.6)
    case "point": {
      if (!p.arrow) return null
      const { tip, tail } = p.arrow, shaft = bowLine(tail, tip, 7)
      return ink([shaft, ...headLines(tip, pt(shaft[shaft.length - 4]))], 4.2)
    }
    case "connect": {
      if (!p.curve) return null
      const a = p.curve, c = curveLine(a.from, a.control, a.to)
      return ink([c, ...headLines(a.to, pt(c[c.length - 4]))], 4.2)
    }
    case "scroll": {
      const c = centre(r), v = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[m.dir], from = { x: c.x - v[0] * 28, y: c.y - v[1] * 28 }, to = { x: c.x + v[0] * 28, y: c.y + v[1] * 28 }
      return <g className={`sd-bob-${m.dir}`}><Ink id={id} lines={[bowLine(from, to, 3), ...headLines(to, from, 12)]} size={4.4} delay={delay} W={W} H={H} /></g>
    }
    default: return null
  }
}
const pt = (p: [number, number]): Pt => ({ x: p[0], y: p[1] })

/** Everything around the screen dimmed but `r`. */
function Spotlight({ r, W, H, delay }: { r: Rect; W: number; H: number; delay: number }) {
  const h = inflate(r, 8), rr = 10
  const hole = `M${h.x + rr},${h.y}H${h.x + h.w - rr}Q${h.x + h.w},${h.y} ${h.x + h.w},${h.y + rr}V${h.y + h.h - rr}Q${h.x + h.w},${h.y + h.h} ${h.x + h.w - rr},${h.y + h.h}H${h.x + rr}Q${h.x},${h.y + h.h} ${h.x},${h.y + h.h - rr}V${h.y + rr}Q${h.x},${h.y} ${h.x + rr},${h.y}Z`
  return <svg className="absolute inset-0" width={W} height={H}><path d={`M0,0H${W}V${H}H0Z${hole}`} fillRule="evenodd" className="sd-dim sd-fade" style={{ "--delay": ms(delay) } as React.CSSProperties} /></svg>
}

/** What a mark shows besides strokes: its label, a step's badge, its card. */
function Parts({ p, delay, act, grab, seed, id }: { p: Placed; delay: number; act: (a: Act) => void; grab: (on: boolean) => void; seed: number; id: string }) {
  const m = p.mark, label = labelOf(m)
  const pop = (d: number) => ({ "--delay": ms(delay + d) }) as React.CSSProperties
  if (m.type === "num" && p.box) {
    const r = p.box, at = r.w || r.h ? { x: r.x - 11, y: r.y - 11 } : { x: r.x - 13, y: r.y - 13 }
    return <div data-mark="num" className="sd-badge sd-pop absolute" style={{ left: at.x, top: at.y, ...pop(0) }}>{m.n}</div>
  }
  if (p.card) return <Card p={p} delay={delay} act={act} grab={grab} seed={seed} id={id} />
  if (!label || !p.label) return null
  return <div data-mark-label={m.type} className="sd-pill sd-pop absolute" style={{ left: p.label.x, top: p.label.y, width: p.label.w, ...pop(m.type === "connect" || m.type === "ring" ? 420 : 300) }}>{label}</div>
}

/** Chrome a person can press: it takes the pointer while it's under it (the overlay lets it through elsewhere). */
function Press({ children, className, style, onClick, grab, label }: { children: React.ReactNode; className: string; style?: React.CSSProperties; onClick: () => void; grab: (on: boolean) => void; label?: string }) {
  const over = useRef(false)
  useEffect(() => () => { if (over.current) grab(false) }, [grab])
  return (
    <button type="button" aria-label={label} className={`pointer-events-auto ${className}`} style={style} onClick={onClick}
      onPointerEnter={() => { if (!over.current) { over.current = true; grab(true) } }} onPointerLeave={() => { if (over.current) { over.current = false; grab(false) } }}>
      {children}
    </button>
  )
}

function Card({ p, delay, act, grab, seed, id }: { p: Placed; delay: number; act: (a: Act) => void; grab: (on: boolean) => void; seed: number; id: string }) {
  const m = p.mark, c = p.card!, [done, setDone] = useState(false)
  const box = { left: c.x, top: c.y, width: c.w, "--delay": ms(delay) } as React.CSSProperties
  if (m.type === "write") return <div data-mark="write" className={`sd-write sd-fade absolute sd-${m.size ?? "m"}`} style={box}>{m.text}</div>
  if (m.type === "sticky") return (
    <div data-mark="sticky" className="sd-card sd-sticky sd-pop absolute" style={{ ...box, minHeight: c.h }}>
      {m.title && <div className="sd-title">{m.title}</div>}
      <div className="whitespace-pre-wrap">{m.text}</div>
    </div>
  )
  if (m.type === "list") return (
    <div data-mark="list" className="sd-card sd-pop absolute" style={box}>
      {m.title && <div className="sd-title">{m.title}</div>}
      <ol className="flex flex-col gap-1">
        {m.items.map((x, i) => <li key={i} className="sd-fade flex gap-2" style={{ "--delay": ms(delay + 200 + i * 140) } as React.CSSProperties}><span className="sd-bullet">{m.numbered ? i + 1 : "•"}</span><span>{x}</span></li>)}
      </ol>
    </div>
  )
  if (m.type === "paper") return <Paper m={m} c={c} delay={delay} seed={seed} id={id} />
  // (actions: copy, open, the next step)
  const run = () => {
    const a = m.type === "copy" ? { copy: m.text } : m.type === "open" ? { open: m.url } : m.type === "button" ? m.do : null
    if (!a) return
    act("copy" in a ? { kind: "copy", text: a.copy } : "open" in a ? { kind: "open", url: a.open } : { kind: "ask", text: a.ask })
    if ("copy" in a) { setDone(true); setTimeout(() => setDone(false), 1500) }
  }
  const text = m.type === "copy" ? (done ? "Copied" : m.label ?? "Copy") : m.type === "open" ? m.label ?? "Open" : m.type === "button" ? m.label : ""
  const Icon = m.type === "copy" ? (done ? Check : Copy) : m.type === "open" ? ExternalLink : m.type === "button" && "copy" in m.do ? Copy : m.type === "button" && "open" in m.do ? ExternalLink : ArrowRight
  return (
    <Press className="sd-chip sd-pop absolute" style={{ ...box, width: undefined, maxWidth: c.w }} onClick={run} grab={grab}>
      <Icon className="size-3.5 shrink-0" strokeWidth={2.2} /><span className="truncate">{text}</span>
    </Press>
  )
}

/** A scratch pad: a card on calm space, plain or ruled in a grid, its items drawn on it in order. */
function Paper({ m, c, delay, seed, id }: { m: Extract<Mark, { type: "paper" }>; c: Rect; delay: number; seed: number; id: string }) {
  const W = m.w, H = m.h
  return (
    <div data-mark="paper" className="sd-card sd-paper sd-pop absolute p-0" style={{ left: c.x, top: c.y, width: c.w, "--delay": ms(delay) } as React.CSSProperties}>
      {m.title && <div className="sd-title px-3 pt-2.5">{m.title}</div>}
      <div className={`relative ${m.grid ? "sd-grid" : ""}`} style={{ width: W, height: H }}>
        <svg className="absolute inset-0 overflow-visible" width={W} height={H}>
          {m.items.map((it, i) => <Item key={i} it={it} id={`${id}-p${i}`} seed={seed + i * 13} delay={delay + 260 + i * 160} W={W} H={H} />)}
        </svg>
        {m.items.map((it, i) => <ItemText key={i} it={it} delay={delay + 260 + i * 160} />)}
      </div>
    </div>
  )
}
function Item({ it, id, seed, delay, W, H }: { it: PaperItem; id: string; seed: number; delay: number; W: number; H: number }) {
  const ink = (lines: Line[], size = 3.4) => <Ink id={id} lines={lines} size={size} delay={delay} W={W} H={H} />
  if (it.type === "rect" || it.type === "ellipse") return <Sketch paths={sketch(it.type, it, seed)} delay={delay} />
  if (it.type === "line") return <Sketch paths={sketch("line", [pt(it.from), pt(it.to)], seed)} delay={delay} dur={360} />
  if (it.type === "arrow") return ink([[it.from, it.to], ...headLines(pt(it.to), pt(it.from), 10)])
  if (it.type === "path") return ink([it.points])
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
  return <g>{base}{ink([pts], 3.2)}{pts.map(([px, py], i) => <circle key={i} cx={px} cy={py} r={3.2} className="sd-dot sd-fade" style={{ "--delay": ms(delay + 300 + i * 60) } as React.CSSProperties} />)}</g>
}
function ItemText({ it, delay }: { it: PaperItem; delay: number }) {
  const at = (x: number, y: number, extra: React.CSSProperties = {}) => ({ left: x, top: y, "--delay": ms(delay + 200), ...extra }) as React.CSSProperties
  if (it.type === "text") return <div className={`sd-ptext sd-fade absolute sd-${it.size ?? "m"}`} style={at(it.x, it.y)}>{it.text}</div>
  if ((it.type === "rect" || it.type === "ellipse") && it.label) return <div className="sd-plabel sd-fade absolute grid place-items-center text-center" style={at(it.x, it.y, { width: it.w, height: it.h })}>{it.label}</div>
  if ((it.type === "line" || it.type === "arrow") && it.label) return <div className="sd-plabel sd-fade absolute -translate-x-1/2 -translate-y-full pb-1" style={at((it.from[0] + it.to[0]) / 2, (it.from[1] + it.to[1]) / 2)}>{it.label}</div>
  if (it.type === "chart" && it.labels) {
    const step = it.w / it.values.length
    return it.labels.map((l, i) => <div key={i} className="sd-axis sd-fade absolute truncate text-center" style={at(it.x + i * step, it.y + it.h - 14, { width: step })}>{l}</div>)
  }
  return null
}

function Toolbar({ kept, keepable, keep, clear, grab }: { kept?: string; keepable: boolean; keep: () => void; clear: () => void; grab: (on: boolean) => void }) {
  return (
    <div className="sd-tools sd-pop absolute bottom-5 left-1/2 flex -translate-x-1/2 items-center gap-1" style={{ "--delay": "500ms" } as React.CSSProperties}>
      {keepable && (kept
        ? <span data-kept className="sd-tool"><Check className="size-3.5" strokeWidth={2.4} /><span className="max-w-[260px] truncate">Kept in {kept.replace(/\.excalidraw$/, "")}</span></span>
        : <Press className="sd-tool" onClick={keep} grab={grab}>Keep</Press>)}
      <Press className="sd-tool" onClick={clear} grab={grab} label="Clear the drawing"><X className="size-3.5" strokeWidth={2.4} />Clear</Press>
    </div>
  )
}
