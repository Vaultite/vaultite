// Charts drawn in SVG in the scheme's chart colours: bar, line, area, pie and donut, scatter (DIL's <chart>, ```chart).
import { useLayoutEffect, useRef, useState } from "react"
import { cn } from "@vaultite"
import { chartData, COLORS, isNum, type ChartSpec, type Series } from "./chartdata"

/** Round steps for an axis from lo to hi. */
function ticks(lo: number, hi: number, n = 4) {
  if (lo === hi) { hi = lo + 1; lo -= 1 }
  const raw = (hi - lo) / n, mag = 10 ** Math.floor(Math.log10(raw)), step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw
  const out: number[] = []
  const end = Math.ceil(hi / step - 1e-9) * step
  for (let v = Math.floor(lo / step + 1e-9) * step; v <= end + step * 1e-9; v += step) out.push(+v.toFixed(10))
  return out
}
const fmt = (v: number, unit = "", fix?: { prefix?: string; suffix?: string }) => {
  const a = Math.abs(v)
  const s = a >= 1e9 ? `${+(v / 1e9).toFixed(1)}B` : a >= 1e6 ? `${+(v / 1e6).toFixed(1)}M` : a >= 1e4 ? `${+(v / 1e3).toFixed(1)}k` : String(+v.toFixed(2))
  if (fix?.prefix || fix?.suffix) return `${fix.prefix ?? ""}${s}${fix.suffix ?? ""}`
  return unit === "$" || unit === "€" || unit === "£" ? `${unit}${s}` : unit ? `${s}${unit === "%" ? "" : " "}${unit}` : s
}

export type { ChartSpec }

export function Chart({ spec, className }: { spec: ChartSpec; className?: string }) {
  const box = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(0)
  const [hover, setHover] = useState<{ i: number; s?: number } | null>(null)
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(() => setW(Math.round(el.clientWidth)))
    ro.observe(el)
    setW(Math.round(el.clientWidth))
    return () => ro.disconnect()
  }, [])
  const type = String(spec.type ?? "bar").toLowerCase().replace(/chart$/, "")
  const { cats, series } = chartData(spec)
  const h = Math.max(140, Math.min(600, Number(spec.height) || 240))
  const unit = spec.unit ?? ""
  const f = (v: number) => fmt(v, unit, spec)
  if (!series.length || !cats.length) return <p className="text-[14px] text-muted-foreground">Nothing to chart.</p>
  const legend = series.length > 1 && !/pie|donut|doughnut/.test(type)
  return (
    <figure className={cn("genui-chart m-0 flex min-w-0 flex-col gap-2", className)}>
      {spec.title && <figcaption className="text-[14px] font-semibold">{spec.title}</figcaption>}
      <div ref={box} className="relative w-full" style={{ height: type === "hbar" ? undefined : h }}>
        {type === "hbar" ? <HBars cats={cats} series={series} f={f} /> : w > 0 && (/pie|donut|doughnut/.test(type)
          ? <Pie cats={cats} s={series[0]} w={w} h={h} hole={type !== "pie"} f={f} hover={hover} setHover={setHover} />
          : <XY type={type} cats={cats} series={series} w={w} h={h} stacked={!!spec.stacked} f={f} range={{ min: spec.min, max: spec.max }} hover={hover} setHover={setHover} />)}
      </div>
      {legend && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-muted-foreground">
          {series.map((s) => <span key={s.key} className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-[3px]" style={{ background: s.color }} />{s.label}</span>)}
        </div>
      )}
    </figure>
  )
}

type HoverProps = { hover: { i: number; s?: number } | null; setHover: (h: { i: number; s?: number } | null) => void }

function XY({ type, cats, series, w, h, stacked, f, range, hover, setHover }: { type: string; cats: string[]; series: Series[]; w: number; h: number; stacked: boolean; f: (v: number) => string; range: { min?: number; max?: number } } & HoverProps) {
  const bar = !/line|area|scatter/.test(type)
  const sums = cats.map((_, i) => series.reduce((a, s) => a + Math.max(0, s.values[i] ?? 0), 0))
  const all = stacked ? sums : series.flatMap((s) => s.values.filter(isNum))
  // Bars start at zero; a line shows its own range (a weight between 79 and 81).
  const min = Math.min(...all), max = Math.max(...all)
  const lo = bar || min <= 0 ? Math.min(0, min) : min - (max - min) * 0.1, hi = bar || max >= 0 ? Math.max(0, max) : max + (max - min) * 0.1
  const ts = ticks(range.min ?? lo, range.max ?? hi)
  const yMin = ts[0], yMax = ts[ts.length - 1]
  const left = Math.max(28, ...ts.map((t) => f(t).length * 6.5 + 8)), right = 8, top = 8, bottom = 24
  const pw = w - left - right, ph = h - top - bottom
  const y = (v: number) => top + ph - ((v - yMin) / (yMax - yMin || 1)) * ph
  const band = pw / cats.length
  const x = (i: number) => left + (bar ? band * (i + 0.5) : cats.length === 1 ? pw / 2 : (pw * i) / (cats.length - 1))
  const every = Math.max(1, Math.ceil((cats.reduce((a, c) => Math.max(a, c.length), 0) * 6.5 + 10) / (bar ? band : pw / Math.max(1, cats.length - 1))))
  const tip = hover ? cats[hover.i] + ": " + series.map((s) => `${series.length > 1 ? `${s.label} ` : ""}${s.values[hover.i] === null ? "–" : f(s.values[hover.i]!)}`).join(", ") : ""
  return (
    <>
      <svg width={w} height={h} className="block overflow-visible text-muted-foreground" onMouseLeave={() => setHover(null)} role="img" aria-label={series.map((s) => s.label).join(", ")}>
        {ts.map((t) => <g key={t}><line x1={left} x2={w - right} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeWidth={t === 0 ? 1 : 0.5} /><text x={left - 6} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill="currentColor">{f(t)}</text></g>)}
        {cats.map((c, i) => (i % every === 0 ? <text key={i} x={x(i)} y={h - 6} textAnchor="middle" fontSize={11} fill="currentColor">{c.length > 14 ? `${c.slice(0, 13)}…` : c}</text> : null))}
        {bar && cats.map((_, i) => {
          const gw = Math.min(band * 0.72, (stacked ? 1 : series.length) * 44), bw = stacked ? gw : gw / series.length
          let acc = 0
          return (
            <g key={i} onMouseEnter={() => setHover({ i })}>
              <rect x={left + band * i} y={top} width={band} height={ph} fill={hover?.i === i ? "color-mix(in oklab, var(--foreground) 5%, transparent)" : "transparent"} />
              {series.map((s, k) => {
                const v = s.values[i]
                if (v === null) return null
                const base = stacked ? acc : 0
                if (stacked) acc += Math.max(0, v)
                const y0 = y(base), y1 = y(stacked ? acc : v)
                const bx = left + band * i + (band - gw) / 2 + (stacked ? 0 : bw * k)
                return <rect key={s.key} x={bx} y={Math.min(y0, y1)} width={Math.max(1, bw - (stacked ? 0 : 2))} height={Math.max(1, Math.abs(y1 - y0))} rx={Math.min(4, bw / 4)} fill={s.color} />
              })}
            </g>
          )
        })}
        {!bar && series.map((s) => {
          const pts = s.values.map((v, i) => (v === null ? null : [x(i), y(v)] as const))
          const path = pts.reduce((d, p, i) => (p ? `${d}${d && pts[i - 1] ? "L" : "M"}${p[0]},${p[1]}` : d), "")
          return (
            <g key={s.key}>
              {type === "area" && <path d={`${path}L${x(s.values.length - 1)},${y(Math.max(0, yMin))}L${x(0)},${y(Math.max(0, yMin))}Z`} fill={s.color} opacity={0.16} />}
              {type !== "scatter" && <path d={path} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />}
              {pts.map((p, i) => (p && (type === "scatter" || hover?.i === i || cats.length <= 12) ? <circle key={i} cx={p[0]} cy={p[1]} r={type === "scatter" ? 4 : hover?.i === i ? 4 : 2.5} fill={s.color} /> : null))}
            </g>
          )
        })}
        {!bar && cats.map((_, i) => <rect key={i} x={x(i) - pw / Math.max(1, cats.length - 1) / 2} y={top} width={pw / Math.max(1, cats.length - 1)} height={ph} fill="transparent" onMouseEnter={() => setHover({ i })} />)}
        {!bar && hover && <line x1={x(hover.i)} x2={x(hover.i)} y1={top} y2={top + ph} stroke="var(--border)" />}
      </svg>
      {hover && <Tip x={Math.min(w - 8, Math.max(8, x(hover.i)))} text={tip} />}
    </>
  )
}

function Pie({ cats, s, w, h, hole, f, hover, setHover }: { cats: string[]; s: Series; w: number; h: number; hole: boolean; f: (v: number) => string } & HoverProps) {
  const vals = s.values.map((v) => Math.max(0, v ?? 0)), total = vals.reduce((a, b) => a + b, 0) || 1
  const legendW = w > 360 ? Math.min(220, w * 0.4) : 0
  const r = Math.max(30, Math.min((w - legendW) / 2, h / 2) - 6), cx = (w - legendW) / 2, cy = h / 2
  let a = -Math.PI / 2
  const arcs = vals.map((v, i) => {
    const a0 = a, a1 = a + (v / total) * Math.PI * 2
    a = a1
    const big = a1 - a0 > Math.PI ? 1 : 0, ri = hole ? r * 0.58 : 0
    const p = (rad: number, ang: number) => `${cx + rad * Math.cos(ang)},${cy + rad * Math.sin(ang)}`
    const d = v >= total ? `M${p(r, 0)}A${r},${r} 0 1 1 ${p(r, Math.PI)}A${r},${r} 0 1 1 ${p(r, 0)}Z` : `M${p(r, a0)}A${r},${r} 0 ${big} 1 ${p(r, a1)}L${p(ri, a1)}${ri ? `A${ri},${ri} 0 ${big} 0 ${p(ri, a0)}` : ""}Z`
    return { d, color: COLORS[i % COLORS.length], i }
  })
  return (
    <>
      <svg width={w} height={h} className="block" onMouseLeave={() => setHover(null)}>
        {arcs.map((x) => <path key={x.i} d={x.d} fill={x.color} stroke="var(--background)" strokeWidth={1.5} opacity={hover && hover.i !== x.i ? 0.55 : 1} onMouseEnter={() => setHover({ i: x.i })} />)}
        {hole && <text x={cx} y={cy} dy="0.32em" textAnchor="middle" fontSize={15} fontWeight={600} fill="var(--foreground)">{f(hover ? vals[hover.i] : total)}</text>}
      </svg>
      {legendW > 0 && (
        <div className="absolute top-1/2 right-0 flex -translate-y-1/2 flex-col gap-1 text-[12px]" style={{ width: legendW }}>
          {cats.map((c, i) => <span key={i} className="flex items-center gap-1.5"><span className="size-2.5 shrink-0 rounded-[3px]" style={{ background: COLORS[i % COLORS.length] }} /><span className="min-w-0 flex-1 truncate">{c}</span><span className="text-muted-foreground tabular-nums">{Math.round((vals[i] / total) * 100)}%</span></span>)}
        </div>
      )}
      {hover && !legendW && <Tip x={cx} text={`${cats[hover.i]}: ${f(vals[hover.i])} (${Math.round((vals[hover.i] / total) * 100)}%)`} />}
    </>
  )
}

/** Bars across (ChatGPT's vertical layout): a row per category, its label, its bar and its value. */
function HBars({ cats, series, f }: { cats: string[]; series: Series[]; f: (v: number) => string }) {
  const max = Math.max(...series.flatMap((s) => s.values.filter(isNum)), 0) || 1
  return (
    <div className="grid items-center gap-x-3 gap-y-1.5 text-[13px]" style={{ gridTemplateColumns: "minmax(0, max-content) minmax(0, 1fr)" }}>
      {cats.map((c, i) => (
        <div key={i} className="contents">
          <span className="truncate text-muted-foreground">{c}</span>
          <span className="flex min-w-0 flex-col gap-0.5">
            {series.map((s) => {
              const v = s.values[i]
              return (
                <span key={s.key} className="flex min-w-0 items-center gap-2">
                  <span className="h-4 rounded-[4px]" style={{ width: `${(Math.max(0, v ?? 0) / max) * 85}%`, minWidth: 2, background: s.color }} />
                  <span className="shrink-0 tabular-nums">{v === null ? "–" : f(v)}</span>
                </span>
              )
            })}
          </span>
        </div>
      ))}
    </div>
  )
}

function Tip({ x, text }: { x: number; text: string }) {
  return <div className="pointer-events-none absolute top-0 z-10 max-w-[80%] -translate-x-1/2 rounded-[6px] border-[0.5px] border-border bg-card px-2 py-1 text-[12px] whitespace-nowrap shadow-sm" style={{ left: x }}>{text}</div>
}
