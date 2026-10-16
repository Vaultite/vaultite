// DIL's components drawn as the app's own: its colours, type and controls, so an answer reads like the note around
// it. Unknown ones draw their insides. Props follow ChatGPT's (sizes, colours, spacing units of 4px).
import { createContext, Suspense, useContext, useId, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { cn, haptic, Markdown, namedIcon, PinMap, Switch } from "@vaultite"
import type { Tree } from "./sandbox"
import type { Data } from "./dil"
import { AppFrame } from "./AppFrame"
import { Chart, type ChartSpec } from "./Chart"
import { fromChatGpt } from "./chartdata"
import { Quiz } from "./Quiz"

type P = Record<string, unknown>
/** How a drawn piece reaches back: call a handler by its id, and the file it's in. */
export type Host = { call: (fn: number, args: unknown[]) => void; from: string; action: (name: string, args: unknown[]) => void; data?: Data }
const HostCtx = createContext<Host>({ call: () => {}, from: "", action: () => {} })
// Text inside a line (a title, a button): Markdown drawn inline.
const InlineCtx = createContext(false)
// Inside an <svg>: its children are SVG's own elements.
const SvgCtx = createContext(false)

const fnOf = (host: Host, v: unknown) =>
  v && typeof v === "object" && typeof (v as { $fn?: unknown }).$fn === "number" ? (...a: unknown[]) => host.call((v as { $fn: number }).$fn, a) : null
const str = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : undefined)
const num = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && v.trim() && !isNaN(+v) ? +v : undefined)

/** A spacing value: units of 4px, or CSS as written ("12px", "1rem"). */
const space = (v: unknown) => { const n = num(v); return n !== undefined ? `${n * 4}px` : str(v) }
/** `padding={3}`, `padding={[2, 4]}` or `{x: 4, y: 2}`. */
function pad(v: unknown): string | undefined {
  if (Array.isArray(v)) return v.map((x) => space(x) ?? "0").join(" ")
  if (v && typeof v === "object") { const o = v as P; return `${space(o.top ?? o.y) ?? 0} ${space(o.right ?? o.x) ?? 0} ${space(o.bottom ?? o.y) ?? 0} ${space(o.left ?? o.x) ?? 0}` }
  return space(v)
}
const RADIUS: Record<string, string> = { none: "0", "2xs": "2px", xs: "4px", sm: "6px", md: "8px", lg: "10px", xl: "12px", "2xl": "16px", "3xl": "20px", "4xl": "24px", full: "9999px" }
const radius = (v: unknown) => (typeof v === "string" ? RADIUS[v] ?? v : typeof v === "number" ? `${v}px` : v === true ? RADIUS.md : undefined)

/** ChatGPT's surfaces and colours as the scheme's. */
const SURFACE: Record<string, string> = {
  surface: "var(--card)", "surface-primary": "var(--card)", "surface-secondary": "color-mix(in oklab, var(--foreground) 3%, var(--background))",
  "surface-tertiary": "color-mix(in oklab, var(--foreground) 6%, var(--background))", "surface-elevated": "var(--card)",
  "surface-elevated-secondary": "color-mix(in oklab, var(--foreground) 4%, var(--card))", "surface-canvas": "color-mix(in oklab, var(--foreground) 2%, var(--background))",
  primary: "var(--primary)", secondary: "color-mix(in oklab, var(--foreground) 6%, transparent)", muted: "var(--muted)", transparent: "transparent",
}
const TONE: Record<string, string> = {
  primary: "var(--foreground)", default: "var(--foreground)", secondary: "var(--muted-foreground)",
  tertiary: "color-mix(in oklab, var(--muted-foreground) 70%, transparent)", muted: "var(--muted-foreground)",
  accent: "var(--primary)", brand: "var(--primary)", info: "var(--blue)", success: "var(--green)", warning: "var(--orange)",
  caution: "var(--orange)", danger: "var(--red)", error: "var(--red)", discovery: "var(--purple)",
  red: "var(--red)", orange: "var(--orange)", yellow: "var(--yellow)", green: "var(--green)", teal: "var(--teal)",
  blue: "var(--blue)", indigo: "var(--indigo)", purple: "var(--purple)", pink: "var(--pink)", gray: "var(--gray)",
}
TONE.prose = TONE.emphasis = "var(--foreground)"
const tone = (v: unknown) => (typeof v === "string" ? TONE[v] ?? (/^(#|rgb|hsl|oklch|var\()/.test(v) ? v : undefined) : undefined)
const surface = (v: unknown) => (typeof v === "string" ? SURFACE[v] ?? (/^(\w+)-solid$/.test(v) && TONE[v.slice(0, -6)] ? TONE[v.slice(0, -6)] : /^(\w+)-surface$/.test(v) && TONE[v.slice(0, -8)] ? `color-mix(in oklab, ${TONE[v.slice(0, -8)]} 10%, transparent)` : undefined) ?? (TONE[v] ? `color-mix(in oklab, ${TONE[v]} 14%, transparent)` : /^(#|rgb|hsl|oklch|var\()/.test(v) ? v : undefined) : undefined)

// ChatGPT's scales (px, line height): text, headings (a title's) and captions.
const TEXT: Record<string, [number, number]> = { "3xs": [8, 12], "2xs": [10, 14], xs: [12, 18], sm: [14, 20], md: [16, 24], base: [16, 24], lg: [18, 29], xl: [20, 28], "2xl": [24, 32], "3xl": [30, 38] }
const HEADING: Record<string, [number, number]> = { "2xs": [14, 20], xs: [16, 24], sm: [18, 26], md: [20, 26], lg: [24, 28], xl: [32, 38], "2xl": [36, 42], "3xl": [48, 48], "4xl": [60, 60], "5xl": [72, 72] }
const CAPTION: Record<string, [number, number]> = { xs: [10, 13], sm: [10, 13], md: [12, 16], lg: [14, 18] }
const WEIGHT: Record<string, number> = { light: 300, normal: 400, regular: 400, medium: 500, semibold: 600, bold: 700, heavy: 800 }
const JUSTIFY: Record<string, string> = { start: "flex-start", end: "flex-end", center: "center", between: "space-between", around: "space-around", evenly: "space-evenly", stretch: "stretch" }
const ALIGN: Record<string, string> = { start: "flex-start", end: "flex-end", center: "center", baseline: "baseline", stretch: "stretch" }

/** What every element may say about its own box. */
function boxStyle(p: P): CSSProperties {
  const s: CSSProperties = {}
  if (p.gap !== undefined) s.gap = space(p.gap)
  if (p.padding !== undefined) s.padding = pad(p.padding)
  for (const [k, css] of [["paddingX", ["paddingLeft", "paddingRight"]], ["paddingY", ["paddingTop", "paddingBottom"]], ["marginX", ["marginLeft", "marginRight"]], ["marginY", ["marginTop", "marginBottom"]]] as const)
    if (p[k] !== undefined) for (const c of css) (s as P)[c] = space(p[k])
  if (p.margin !== undefined) s.margin = pad(p.margin)
  for (const k of ["marginTop", "marginBottom", "paddingTop", "paddingBottom", "paddingLeft", "paddingRight"] as const) if (p[k] !== undefined) (s as P)[k] = space(p[k])
  const bg = surface(p.background ?? p.bg)
  if (bg) s.background = bg
  if (p.radius !== undefined) s.borderRadius = radius(p.radius)
  if (p.border) s.border = `${typeof p.border === "number" ? p.border : 1}px solid ${tone(p.borderColor) ?? "var(--border)"}`
  if (p.shadow) s.boxShadow = "0 1px 3px rgb(0 0 0 / 0.08), 0 1px 2px rgb(0 0 0 / 0.04)"
  for (const k of ["width", "minWidth", "maxWidth", "height", "minHeight", "maxHeight"] as const) {
    const v = p[k]
    if (v !== undefined) (s as P)[k] = typeof v === "number" ? `${v}px` : v === "full" ? "100%" : v
  }
  if (p.flex !== undefined) s.flex = typeof p.flex === "number" ? p.flex : str(p.flex) === "1" ? 1 : str(p.flex)
  if (p.grow) s.flexGrow = 1
  if (p.shrink === false) s.flexShrink = 0
  if (p.textAlign) s.textAlign = p.textAlign as CSSProperties["textAlign"]
  if (p.opacity !== undefined) s.opacity = num(p.opacity)
  if (p.overflow) s.overflow = str(p.overflow) as CSSProperties["overflow"]
  if (p.clip) s.overflow = "hidden"
  const c = tone(p.color)
  if (c) s.color = c
  return s
}

function flexStyle(p: P, dir: "row" | "column"): CSSProperties {
  // (a box's `size` is its width and height: an icon's tile)
  const size = typeof p.size === "number" ? `${p.size}px` : typeof p.size === "string" && /^\d/.test(p.size) ? p.size : undefined
  return {
    ...(size ? { width: size, height: size, flexShrink: 0 } : {}),
    display: "flex", flexDirection: dir, minWidth: 0,
    gap: space(p.gap ?? (dir === "row" ? 2 : 3)),
    justifyContent: JUSTIFY[str(p.justify) ?? ""] ?? undefined,
    alignItems: ALIGN[str(p.align) ?? ""] ?? (dir === "row" ? "center" : undefined),
    flexWrap: p.wrap === true || p.wrap === "wrap" ? "wrap" : undefined,
    ...boxStyle(p),
  }
}

function textStyle(p: P, base: string, weight = 400, scale = TEXT): CSSProperties {
  const [size, line] = num(p.fontSize) ? [num(p.fontSize)!, Math.round(num(p.fontSize)! * 1.4)] : scale[str(p.size) ?? base] ?? scale[base]
  const s: CSSProperties = { fontSize: size, lineHeight: `${line}px`, fontWeight: WEIGHT[str(p.weight) ?? ""] ?? weight, ...boxStyle(p) }
  if (p.italic) s.fontStyle = "italic"
  if (p.strong) s.fontWeight = Math.max(Number(s.fontWeight) || 0, 600)
  if (p.tabularNums) s.fontVariantNumeric = "tabular-nums"
  if (p.preserveWhitespace) s.whiteSpace = "pre-wrap"
  if (p.highlight) s.background = "color-mix(in oklab, var(--yellow) 30%, transparent)"
  if (size >= 30) s.letterSpacing = "-0.025em"
  if (p.lineThrough) s.textDecoration = "line-through"
  if (p.underline) s.textDecoration = "underline"
  if (p.uppercase) s.textTransform = "uppercase"
  if (p.mono || p.monospace) s.fontFamily = "var(--font-mono)"
  if (p.truncate) Object.assign(s, { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" })
  if (num(p.maxLines)) Object.assign(s, { display: "-webkit-box", WebkitLineClamp: num(p.maxLines), WebkitBoxOrient: "vertical", overflow: "hidden" })
  return s
}

const label = (k: Tree[]): string => k.map((x) => (x.t === "md" ? x.s : x.t === "el" ? label(x.k) : "")).join(" ").replace(/\\(.)/g, "$1").replace(/[*_`]/g, "").trim()

/** Kids inline (a title's text, a button's label). */
function Inline({ k }: { k: Tree[] }) {
  return <InlineCtx.Provider value={true}><Kids k={k} /></InlineCtx.Provider>
}

export { HostCtx }

export function Kids({ k }: { k: Tree[] }) {
  return <>{k.map((x, i) => <Piece key={keyOf(x, i)} t={x} />)}</>
}
const keyOf = (x: Tree, i: number) => (x.t === "el" && (typeof x.p.key === "string" || typeof x.p.key === "number") ? `k${x.p.key}` : i)

/** One piece of what the program drew. */
export function Piece({ t }: { t: Tree }) {
  const inline = useContext(InlineCtx)
  const host = useContext(HostCtx)
  const svg = useContext(SvgCtx)
  if (t.t === "md") return t.slots?.length ? <Slotted s={t.s} slots={t.slots} inline={inline} from={host.from} /> : <Md s={t.s} inline={inline} from={host.from} />
  if (t.t === "app") return <AppFrame p={t.p} html={t.html} host={host} />
  if (svg) return <SvgPart t={t} />
  const p = t.p
  const C = PARTS[t.n] ?? PARTS[t.n.toLowerCase()] ?? PARTS[t.n.replace(/-([a-z])/g, (_, c) => c.toUpperCase())]
  if (C) return <C p={p} k={t.k} />
  // Something it has that this doesn't draw: its insides, laid out like a box.
  return inline ? <Inline k={t.k} /> : <div style={flexStyle(p, "column")}><Kids k={t.k} /></div>
}

function Md({ s, inline, from }: { s: string; inline: boolean; from: string }) {
  if (!s.trim()) return null
  return inline ? <Markdown text={s.trim()} inline plain from={from} /> : <Markdown text={s} full from={from} className="genui-md" />
}

const SLOT = /\u2063(\d+)\u2063/
/** Text with elements in its lines (`The <Entity/> is…`): the Markdown drawn, each element put where its token is. */
function Slotted({ s, slots, inline, from }: { s: string; slots: Tree[]; inline: boolean; from: string }) {
  const box = useRef<HTMLDivElement>(null)
  const [at, setAt] = useState<HTMLElement[]>([])
  useLayoutEffect(() => {
    const root = box.current
    if (!root) return
    const found: HTMLElement[] = []
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    const texts: Text[] = []
    while (walker.nextNode()) if (SLOT.test((walker.currentNode as Text).data)) texts.push(walker.currentNode as Text)
    for (const t of texts) {
      const bits = t.data.split(/\u2063(\d+)\u2063/)
      const frag = document.createDocumentFragment()
      bits.forEach((b, i) => {
        if (i % 2 === 0) { if (b) frag.append(b) } else { const el = document.createElement("span"); el.dataset.slot = b; found[+b] = el; frag.append(el) }
      })
      t.replaceWith(frag)
    }
    setAt(found)
  }, [s])
  const Tag = inline ? "span" : "div"
  return (
    <Tag ref={box as never} className="contents">
      <Md s={s} inline={inline} from={from} />
      {at.map((el, i) => (el && slots[i] ? createPortal(<InlineCtx.Provider value={true}><Piece t={slots[i]} /></InlineCtx.Provider>, el) : null))}
    </Tag>
  )
}

type Part = (x: { p: P; k: Tree[] }) => ReactNode

function Box({ p, k }: { p: P; k: Tree[] }) { return <div style={flexStyle(p, "column")}><Kids k={k} /></div> }
function Row({ p, k }: { p: P; k: Tree[] }) { return <div style={flexStyle(p, "row")}><Kids k={k} /></div> }

function Grid({ p, k }: { p: P; k: Tree[] }) {
  const cols = num(p.columns ?? p.cols) ?? 2
  const min = str(p.minColumnWidth ?? p.minChildWidth)
  // Narrow (a phone): more than two columns fold to two, as ChatGPT's do.
  return (
    <div className="genui-grid" data-cols={cols > 2 ? "many" : undefined}
      style={{ display: "grid", gridTemplateColumns: min ? `repeat(auto-fill, minmax(min(100%, ${min}), 1fr))` : `repeat(${cols}, minmax(0, 1fr))`, gap: space(p.gap ?? 3), ...boxStyle({ ...p, gap: undefined }) }}>
      <Kids k={k} />
    </div>
  )
}
function GridItem({ p, k }: { p: P; k: Tree[] }) {
  const span = num(p.span ?? p.colSpan)
  return <div className="genui-cell" style={{ gridColumn: span ? `span ${span} / span ${span}` : undefined, minWidth: 0, display: "flex", flexDirection: "column", ...boxStyle(p) }}><Kids k={k} /></div>
}

const text = (base: string, weight = 400, extra?: CSSProperties, Tag: "div" | "span" | "strong" | "label" = "div", scale = TEXT): Part => ({ p, k }) => {
  const T = p.inline ? "span" : Tag
  return <T style={{ ...extra, ...textStyle(p, base, weight, scale) }} className="genui-text"><Inline k={k.length ? k : str(p.label ?? p.value) ? [{ t: "md", s: str(p.label ?? p.value)! }] : []} /></T>
}

function Title({ p, k }: { p: P; k: Tree[] }) {
  return <div role="heading" aria-level={2} className="genui-text" style={textStyle({ ...p, strong: p.strong !== false && !p.weight }, "md", p.strong === false ? 400 : 600, HEADING)}><Inline k={k} /></div>
}

function Icon({ p }: { p: P; k: Tree[] }) {
  const I = namedIcon(ICON_NAMES[str(p.name) ?? ""] ?? str(p.name) ?? "") ?? namedIcon("circle")
  const size = { xs: 12, sm: 14, md: 16, lg: 20, xl: 24, "2xl": 32 }[str(p.size) ?? "md"] ?? (num(p.size) ?? 16)
  return I ? <I style={{ width: size, height: size, color: tone(p.color), flexShrink: 0, display: "inline-block", verticalAlign: "-0.15em" }} strokeWidth={2} aria-hidden /> : null
}
/** ChatGPT's icon names Lucide calls otherwise. */
const ICON_NAMES: Record<string, string> = {
  "check-circle": "circle-check", "x-circle": "circle-x", "alert-circle": "circle-alert", "alert-triangle": "triangle-alert",
  "info-circle": "info", "help-circle": "circle-help", "plus-circle": "circle-plus", "minus-circle": "circle-minus",
  close: "x", trash: "trash-2", edit: "pencil", external: "external-link", "external-link": "external-link", refresh: "refresh-cw",
  "arrow-up-right": "arrow-up-right", sparkle: "sparkles", sparkles: "sparkles", chart: "chart-column", "bar-chart": "chart-column",
  "line-chart": "chart-line", "pie-chart": "chart-pie", gear: "settings", cog: "settings", home: "house", location: "map-pin",
  pin: "map-pin", time: "clock", warning: "triangle-alert", error: "circle-x", success: "circle-check", lightbulb: "lightbulb",
}

// ChatGPT's control heights (px) and padding, a pill unless `pill={false}`.
const CONTROL: Record<string, [number, number]> = { "3xs": [22, 6], "2xs": [24, 6], xs: [26, 8], sm: [28, 10], md: [32, 12], lg: [36, 12], xl: [40, 14], "2xl": [44, 16], "3xl": [48, 16] }
const control = (size: unknown, dflt: string, pill: unknown, uniform?: unknown): CSSProperties => {
  const [h, x] = CONTROL[str(size) ?? dflt] ?? CONTROL[dflt]
  return { height: h, minHeight: h, padding: uniform ? 0 : `0 ${x}px`, width: uniform ? h : undefined, borderRadius: pill === false ? 10 : 9999, fontSize: h >= 44 ? 16 : 14 }
}
function Button({ p, k }: { p: P; k: Tree[] }) {
  const host = useContext(HostCtx)
  const on = fnOf(host, p.onClick ?? p.onPress)
  const variant = str(p.variant) ?? "solid", c = str(p.color) ?? (variant === "solid" ? "primary" : "secondary")
  const ink = c === "primary" || c === "secondary" ? null : tone(c)
  const look =
    variant === "solid" ? (c === "secondary" ? "bg-foreground/[0.07] text-foreground hover:bg-foreground/[0.11]" : ink ? "text-white hover:opacity-90" : "bg-primary text-primary-foreground hover:bg-primary/85")
    : variant === "outline" ? "border-[0.5px] border-border bg-background hover:bg-foreground/[0.05]"
    : variant === "soft" ? "bg-foreground/[0.06] hover:bg-foreground/[0.1]"
    : variant === "link" ? "!h-auto !px-0 underline-offset-2 hover:underline"
    : "hover:bg-foreground/[0.06]"
  const href = str(p.href)
  return (
    <button type="button" disabled={!!p.disabled || (!on && !href)} aria-pressed={p.pressed === undefined ? undefined : !!p.pressed}
      onClick={(e) => { e.stopPropagation(); haptic(); if (on) on(); else if (href) host.action("openUrl", [href]) }}
      className={cn("inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 font-medium whitespace-nowrap transition-colors disabled:cursor-default disabled:opacity-50", look, !!(p.block || p.fullWidth) && "w-full")}
      style={{ ...control(p.size, "lg", p.pill, p.uniform), ...(variant === "link" ? { height: "auto", minHeight: 0, padding: 0 } : {}), ...(variant === "solid" && ink ? { background: ink } : ink ? { color: ink } : {}), ...(p.width ? { width: str(p.width) } : {}) }}>
      {str(p.iconStart ?? p.icon) && <Icon p={{ name: p.iconStart ?? p.icon, size: "sm" }} k={[]} />}
      <Inline k={k.length ? k : str(p.label) ? [{ t: "md", s: str(p.label)! }] : []} />
      {str(p.iconEnd) && <Icon p={{ name: p.iconEnd, size: "sm" }} k={[]} />}
    </button>
  )
}

type Option = { value: string; label: string; description?: string }
const optionsOf = (v: unknown): Option[] =>
  Array.isArray(v) ? v.map((o) => (o && typeof o === "object" ? { value: String((o as P).value ?? (o as P).id ?? (o as P).label), label: String((o as P).label ?? (o as P).value), description: str((o as P).description) } : { value: String(o), label: String(o) })) : []

function Select({ p }: { p: P; k: Tree[] }) {
  const host = useContext(HostCtx)
  const on = fnOf(host, p.onChange)
  const opts = optionsOf(p.options)
  const v = p.value === undefined || p.value === null ? "" : String(p.value)
  return (
    <select value={v} disabled={!!p.disabled} aria-label={str(p.ariaLabel ?? p.placeholder) ?? "Choose"} onChange={(e) => { const o = opts.find((x) => x.value === e.target.value); on?.(typeof p.value === "number" ? +e.target.value : o?.value ?? e.target.value) }}
      className={cn("genui-select max-w-full cursor-pointer border-[0.5px] border-border bg-card text-foreground", !!p.block && "w-full")}
      style={{ ...control(p.size, "xl", p.pill), paddingRight: 32 }}>
      {!v && <option value="" disabled>{str(p.placeholder) ?? "Choose"}</option>}
      {opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  )
}

function Checkbox({ p, k }: { p: P; k: Tree[] }) {
  const host = useContext(HostCtx)
  const on = fnOf(host, p.onChange ?? p.onCheckedChange)
  const checked = !!p.checked
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-[15px]" style={boxStyle({ ...p, color: undefined })}>
      <input type="checkbox" checked={checked} disabled={!on} onChange={(e) => { haptic(); on?.(e.target.checked) }} className="genui-check size-4 shrink-0 cursor-pointer accent-[var(--primary)]" />
      <span style={checked && p.lineThrough !== false && p.lineThrough !== undefined ? { textDecoration: "line-through", color: "var(--muted-foreground)" } : undefined}><Inline k={k.length ? k : str(p.label) ? [{ t: "md", s: str(p.label)! }] : []} /></span>
    </label>
  )
}

function Toggle({ p, k }: { p: P; k: Tree[] }) {
  const host = useContext(HostCtx)
  const on = fnOf(host, p.onChange ?? p.onCheckedChange)
  const l = label(k) || str(p.label) || ""
  return (
    <label className="inline-flex items-center gap-2.5 text-[15px]">
      <Switch on={!!(p.checked ?? p.value)} onChange={(v) => on?.(v)} label={l || "Switch"} disabled={!on} />
      {l && <span><Inline k={k.length ? k : [{ t: "md", s: l }]} /></span>}
    </label>
  )
}

function Slider({ p }: { p: P; k: Tree[] }) {
  const host = useContext(HostCtx)
  const on = fnOf(host, p.onChange ?? p.onValueChange)
  const min = num(p.min) ?? 0, max = num(p.max) ?? 100, step = num(p.step) ?? 1
  const v = num(p.value) ?? min
  return (
    <input type="range" min={min} max={max} step={step} value={v} disabled={!on} aria-label={str(p.label) ?? "Value"}
      onChange={(e) => on?.(+e.target.value)} className="genui-slider w-full cursor-pointer accent-[var(--primary)]" style={boxStyle({ ...p, color: undefined })} />
  )
}

/** A text field: what's typed shows at once, and goes to the program as it's typed. */
function Field({ p, area }: { p: P; area?: boolean }) {
  const host = useContext(HostCtx)
  const on = fnOf(host, p.onChange ?? p.onValueChange ?? p.onInput)
  const submit = fnOf(host, p.onSubmit ?? p.onEnter)
  const outside = p.value === undefined || p.value === null ? "" : String(p.value)
  const [v, setV] = useState(outside)
  const focused = useRef(false)
  useEffect(() => { if (!focused.current) setV(outside) }, [outside])
  const type = str(p.inputType ?? p.type) ?? (typeof p.value === "number" ? "number" : "text")
  const send = (s: string) => on?.(type === "number" ? (s === "" ? "" : +s) : s)
  const cls = cn("border-[0.5px] border-border bg-card text-foreground placeholder:text-muted-foreground focus:ring-2 focus:ring-primary/40 focus:outline-none", p.block !== false && "w-full")
  const common = {
    value: v, placeholder: str(p.placeholder), disabled: !on && !submit, "aria-label": str(p.label ?? p.placeholder) ?? "Text",
    onFocus: () => { focused.current = true }, onBlur: () => { focused.current = false; setV(outside) },
    onChange: (e: { target: { value: string } }) => { setV(e.target.value); send(e.target.value) },
  }
  if (area) return <textarea {...common} rows={num(p.rows) ?? 3} className={cn(cls, "rounded-[12px] px-3.5 py-2 text-[15px]")} />
  return <input {...common} type={type} min={num(p.min) ?? str(p.min)} max={num(p.max) ?? str(p.max)} step={num(p.step)} className={cls} style={control(p.size, "xl", p.pill)}
    onKeyDown={(e) => { if (e.key === "Enter" && submit) { e.preventDefault(); submit(v) } }} />
}

function Segmented({ p }: { p: P; k: Tree[] }) {
  const host = useContext(HostCtx)
  const on = fnOf(host, p.onChange ?? p.onValueChange)
  const opts = optionsOf(p.options ?? p.items)
  const v = p.value === undefined || p.value === null ? "" : String(p.value)
  return (
    <div role="radiogroup" className={cn("flex w-fit max-w-full overflow-x-auto bg-muted p-[3px]", !!p.block && "w-full", p.pill === false ? "rounded-[10px]" : "rounded-full")}>
      {opts.map((o) => {
        const sel = o.value === v
        return (
          <button key={o.value} type="button" role="radio" aria-checked={sel} onClick={() => { haptic("selection"); on?.(typeof p.value === "number" ? +o.value : o.value) }}
            className={cn("relative min-h-8 flex-1 cursor-pointer px-3.5 text-[14px] whitespace-nowrap", p.pill === false ? "rounded-[8px]" : "rounded-full", " transition-[background,box-shadow] duration-200", sel ? "bg-card font-semibold shadow-[0_3px_8px_rgb(0_0_0/0.12),0_3px_1px_rgb(0_0_0/0.04)] dark:bg-[var(--segment-on)]" : "font-medium text-foreground/80")}>
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

/** Tabs: `<tabs value onChange>` with `<tab value label>` children, or `options`. Without a handler it keeps its own. */
function Tabs({ p, k }: { p: P; k: Tree[] }) {
  const host = useContext(HostCtx)
  const on = fnOf(host, p.onChange ?? p.onValueChange)
  const tabs = k.filter((x): x is Extract<Tree, { t: "el" }> => x.t === "el" && /^(tab|tabs-item|tab-panel|TabsItem)$/i.test(x.n))
  const opts = tabs.length ? tabs.map((t, i) => ({ value: String(t.p.value ?? t.p.id ?? i), label: String(t.p.label ?? t.p.title ?? t.p.value ?? i + 1) })) : optionsOf(p.options ?? p.items)
  const [own, setOwn] = useState(opts[0]?.value ?? "")
  const v = p.value !== undefined && on ? String(p.value) : own
  const shown = tabs.find((t, i) => String(t.p.value ?? t.p.id ?? i) === v) ?? tabs[0]
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div role="tablist" className="flex gap-1 overflow-x-auto border-b-[0.5px] border-border">
        {opts.map((o) => (
          <button key={o.value} type="button" role="tab" aria-selected={o.value === v}
            onClick={() => { haptic("selection"); if (on) on(o.value); else setOwn(o.value) }}
            className={cn("-mb-px cursor-pointer border-b-2 px-3 pb-2 text-[14px] whitespace-nowrap transition-colors", o.value === v ? "border-primary font-semibold text-foreground" : "border-transparent font-medium text-muted-foreground hover:text-foreground")}>
            {o.label}
          </button>
        ))}
      </div>
      {shown ? <div style={flexStyle(shown.p, "column")}><Kids k={shown.k} /></div> : <Kids k={k.filter((x) => !(x.t === "el" && tabs.includes(x as never)))} />}
    </div>
  )
}

function Badge({ p, k }: { p: P; k: Tree[] }) {
  const c = tone(p.color) ?? "var(--muted-foreground)"
  const solid = str(p.variant) === "solid"
  return (
    <span className="inline-flex w-fit shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-medium whitespace-nowrap"
      style={solid ? { background: c, color: "white" } : { background: `color-mix(in oklab, ${c} 14%, transparent)`, color: str(p.color) && str(p.color) !== "secondary" ? c : "var(--foreground)" }}>
      <Inline k={k.length ? k : str(p.label) ? [{ t: "md", s: str(p.label)! }] : []} />
    </span>
  )
}

function Divider({ p }: { p: P; k: Tree[] }) {
  return p.vertical ? <div className="w-px self-stretch bg-border" /> : <hr className="my-1 border-0 border-t-[0.5px] border-border" style={{ marginTop: space(p.spacing), marginBottom: space(p.spacing) }} />
}

function Progress({ p }: { p: P; k: Tree[] }) {
  const max = num(p.max) ?? 100, v = Math.max(0, Math.min(max, num(p.value) ?? 0))
  return (
    <div role="progressbar" aria-valuemin={0} aria-valuemax={max} aria-valuenow={v} className="h-2 w-full overflow-hidden rounded-full bg-foreground/[0.08]" style={boxStyle({ height: p.height, width: p.width })}>
      <div className="h-full rounded-full transition-[width] duration-300" style={{ width: `${(v / max) * 100}%`, background: tone(p.color) ?? "var(--primary)" }} />
    </div>
  )
}

function Image({ p }: { p: P; k: Tree[] }) {
  const src = str(p.src ?? p.url)
  if (!src || !/^(https:|data:image\/)/i.test(src)) return str(p.alt) ? <span className="text-muted-foreground">{str(p.alt)}</span> : null
  return <img src={src} alt={str(p.alt) ?? ""} loading="lazy" referrerPolicy="no-referrer" style={{ maxWidth: "100%", objectFit: (str(p.fit) as CSSProperties["objectFit"]) ?? "cover", aspectRatio: str(p.aspectRatio)?.replace(":", "/"), ...boxStyle({ ...p, radius: p.radius ?? "lg" }) }} />
}

function Link({ p, k }: { p: P; k: Tree[] }) {
  const host = useContext(HostCtx)
  const href = str(p.href ?? p.url)
  return <a href={href && /^https?:/i.test(href) ? href : undefined} onClick={(e) => { e.preventDefault(); e.stopPropagation(); if (href) host.action("openUrl", [href]) }} className="cursor-pointer text-primary underline-offset-2 hover:underline"><Inline k={k} /></a>
}

/** `<table columns={[...]} rows={[...]}>` (or `data`), or rows written as children. */
function Table({ p, k }: { p: P; k: Tree[] }) {
  const rows = (Array.isArray(p.rows) ? p.rows : Array.isArray(p.data) ? p.data : null) as unknown[] | null
  const sections = k.some((x) => x.t === "el" && x.n === "table-section")
  if (!rows) return <div className="overflow-x-auto"><table className="genui-table w-full">{sections ? <Kids k={k} /> : <tbody><Kids k={k} /></tbody>}</table></div>
  const cols = (Array.isArray(p.columns) ? p.columns : rows[0] && typeof rows[0] === "object" && !Array.isArray(rows[0]) ? Object.keys(rows[0] as P) : []).map((c, i) =>
    c && typeof c === "object" ? { key: String((c as P).key ?? (c as P).id ?? (c as P).field ?? i), label: String((c as P).label ?? (c as P).title ?? (c as P).header ?? (c as P).key ?? ""), align: str((c as P).align) } : { key: String(c), label: String(c), align: undefined })
  const cell = (r: unknown, c: { key: string }, i: number) => (Array.isArray(r) ? r[i] : r && typeof r === "object" ? (r as P)[c.key] : r)
  return (
    <div className="overflow-x-auto">
      <table className="genui-table w-full">
        <thead><tr>{cols.map((c) => <th key={c.key} style={{ textAlign: (c.align as CSSProperties["textAlign"]) ?? "left" }}>{c.label}</th>)}</tr></thead>
        <tbody>{rows.map((r, ri) => <tr key={ri}>{cols.map((c, ci) => { const v = cell(r, c, ci); return <td key={c.key} style={{ textAlign: (c.align as CSSProperties["textAlign"]) ?? (typeof v === "number" ? "right" : "left") }}>{v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v)}</td> })}</tr>)}</tbody>
      </table>
    </div>
  )
}
const Tr: Part = ({ k }) => <tr><Kids k={k} /></tr>
const Td: Part = ({ p, k }) => <td style={{ textAlign: p.align as CSSProperties["textAlign"] }}><Inline k={k} /></td>
const Th: Part = ({ p, k }) => <th style={{ textAlign: (p.align as CSSProperties["textAlign"]) ?? "left" }}><Inline k={k} /></th>

function ChartPart({ p }: { p: P; k: Tree[] }) {
  return <Chart spec={p.content && typeof p.content === "object" ? fromChatGpt(p.content as P) : p as ChartSpec} />
}

/** A card: a bordered box, ChatGPT's surface. */
const Card: Part = ({ p, k }) => <div style={flexStyle({ border: true, radius: "lg", padding: 4, gap: 2, ...p }, "column")}><Kids k={k} /></div>

/** A list: `<list>` of `<list-item label description>`s or `items`; `marker` bullet, number, check, none or an icon's
 *  name; `connector="line"` joins the markers (a timeline). */
const ListCtx = createContext<{ marker: string; line: boolean; start: number }>({ marker: "bullet", line: false, start: 1 })
const List: Part = ({ p, k }) => {
  const marker = str(p.marker) ?? (p.ordered ? "number" : "bullet")
  const items = Array.isArray(p.items) ? (p.items as unknown[]).map((x): Tree => ({ t: "el", n: "list-item", p: x && typeof x === "object" ? (x as P) : { label: String(x) }, k: [] })) : null
  const kids = items ?? k
  return (
    <ListCtx.Provider value={{ marker, line: str(p.connector) === "line" || str(p.connector) === "solid" || str(p.connector) === "dashed", start: num(p.start) ?? 1 }}>
      <div role="list" className="flex flex-col" style={{ gap: space(p.gap ?? 2) }}>
        {kids.map((x, i) => <ItemAt key={i} n={i} last={i === kids.length - 1} t={x} />)}
      </div>
    </ListCtx.Provider>
  )
}
const ItemCtx = createContext({ n: 0, last: true })
function ItemAt({ t, n, last }: { t: Tree; n: number; last: boolean }) {
  return <ItemCtx.Provider value={{ n, last }}><Piece t={t} /></ItemCtx.Provider>
}
const ListItem: Part = ({ p, k }) => {
  const { marker: m0, line, start } = useContext(ListCtx)
  const { n, last } = useContext(ItemCtx)
  const marker = str(p.marker) ?? m0
  const I = !["bullet", "number", "none", "check", "dot"].includes(marker) ? namedIcon(ICON_NAMES[marker] ?? marker) : marker === "check" ? namedIcon("check") : null
  return (
    <div role="listitem" className="relative flex gap-3">
      {marker !== "none" && (
        <div className="relative flex w-5 shrink-0 justify-center pt-[3px]">
          {I ? <I className="size-4 text-muted-foreground" /> : marker === "number" ? <span className="text-[14px] leading-5 text-muted-foreground tabular-nums">{start + n}.</span>
            : <span className={cn("mt-[6px] rounded-full", line ? "size-2.5 border-2 border-primary bg-background" : "size-1.5 bg-foreground/60")} />}
          {line && !last && <span className="absolute top-[22px] -bottom-3 left-1/2 w-px -translate-x-1/2 bg-border" />}
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        {str(p.label) && <div className="text-[15px] leading-6 font-medium"><Md s={str(p.label)!} inline from="" /></div>}
        {str(p.description) && <div className="text-[14px] leading-5 text-muted-foreground"><Md s={str(p.description)!} inline from="" /></div>}
        {k.length > 0 && <div style={flexStyle({ gap: 1 }, "column")}><Kids k={k} /></div>}
      </div>
    </div>
  )
}

const Spacer: Part = ({ p }) => <div style={{ flex: p.size === undefined ? 1 : undefined, height: space(p.size), width: space(p.size) }} />

const Stat: Part = ({ p, k }) => (
  <div className="flex min-w-0 flex-col gap-0.5" style={boxStyle(p)}>
    {str(p.label) && <div className="text-[12px] text-muted-foreground">{str(p.label)}</div>}
    <div className="text-[24px] leading-8 font-semibold tracking-tight tabular-nums">{p.value !== undefined ? String(p.value) : <Inline k={k} />}</div>
    {str(p.caption ?? p.hint ?? p.delta) && <div className="text-[12px]" style={{ color: tone(p.deltaColor) ?? "var(--muted-foreground)" }}>{str(p.caption ?? p.hint ?? p.delta)}</div>}
  </div>
)

const Quote: Part = ({ k }) => <blockquote className="border-l-2 border-border pl-3 text-muted-foreground"><Kids k={k} /></blockquote>
const Code: Part = ({ p, k }) => p.block === false || p.inline
  ? <code className="rounded-[4px] bg-foreground/[0.06] px-1 font-mono text-[0.9em]">{label(k) || str(p.code)}</code>
  : <Md s={"```" + (str(p.language ?? p.lang) ?? "") + "\n" + (str(p.code) ?? label(k)) + "\n```"} inline={false} from="" />

/** A form: its children, and Enter or its submit button calling onSubmit. */
const Form: Part = ({ p, k }) => {
  const host = useContext(HostCtx)
  const on = fnOf(host, p.onSubmit)
  return <form onSubmit={(e) => { e.preventDefault(); on?.() }} style={flexStyle(p, "column")}><Kids k={k} /></form>
}

/** Details that open: `<collapsible title>` / `<accordion>`. */
const Collapsible: Part = ({ p, k }) => (
  <details className="genui-details rounded-[10px] border-[0.5px] border-border" open={!!(p.open ?? p.defaultOpen)}>
    <summary className="cursor-pointer px-3 py-2 text-[15px] font-medium">{str(p.title ?? p.label ?? p.summary) ?? "More"}</summary>
    <div className="px-3 pb-3" style={flexStyle({ gap: p.gap ?? 2 }, "column")}><Kids k={k} /></div>
  </details>
)

/** A server-found image (AsyncImage): it comes with a query, not an address, so it's a search for it. */
const AsyncImage: Part = ({ p }) => {
  const host = useContext(HostCtx)
  const found = typeof p.$n === "number" ? host.data?.images?.[p.$n]?.[0] : undefined
  const src = str(p.src ?? p.url) ?? found?.url
  if (src) return <Image p={{ ...p, src, alt: p.alt ?? found?.alt, fit: p.fit ?? "contain" }} k={[]} />
  const q = str(p.query ?? p.alt ?? p.description)
  if (!q) return null
  return (
    <button type="button" onClick={() => host.action("openUrl", [`https://www.google.com/search?tbm=isch&q=${encodeURIComponent(q)}`])}
      className="flex min-h-24 w-full cursor-pointer flex-col items-center justify-center gap-1 rounded-[12px] bg-foreground/[0.04] p-3 text-[13px] text-muted-foreground hover:bg-foreground/[0.07]"
      style={{ aspectRatio: str(p.aspectRatio)?.replace(":", "/") }}>
      {(() => { const I = namedIcon("image"); return I ? <I className="size-5" /> : null })()}
      <span className="line-clamp-2 text-center">{q}</span>
    </button>
  )
}
const AsyncImageGroup: Part = ({ p }) => {
  const qs = (Array.isArray(p.queries) ? p.queries : Array.isArray(p.images) ? p.images : []) as unknown[]
  return <div className="grid grid-cols-2 gap-2 @md:grid-cols-3">{qs.map((q, i) => <AsyncImage key={i} p={typeof q === "string" ? { query: q } : (q as P)} k={[]} />)}</div>
}
/** Something ChatGPT knows (a place, a product): its name, and a search for it. */
const Entity: Part = ({ p, k }) => {
  const host = useContext(HostCtx)
  const name = str(p.value ?? p.name ?? p.title ?? p.query) ?? label(k)
  return <button type="button" onClick={() => host.action("openUrl", [`https://www.google.com/search?q=${encodeURIComponent(name)}`])} className="inline cursor-pointer font-medium text-primary underline-offset-2 hover:underline">{name}</button>
}
const Cite: Part = ({ p, k }) => {
  const host = useContext(HostCtx)
  // Its sources by ChatGPT's refs (turn0search3), when they came with it.
  const refs = (Array.isArray(p.refs) ? p.refs : typeof p.ref === "string" ? [p.ref] : []).map((r) => host.data?.refs?.[String(r)]).filter((r) => !!r)
  if (refs.length && !str(p.url ?? p.href)) return <>{refs.slice(0, 3).map((r) => <Cite key={r.url} p={{ url: r.url, title: r.source ?? r.title }} k={[]} />)}</>
  const href = str(p.url ?? p.href)
  if (!href) return k.length ? <Inline k={k} /> : null
  return <button type="button" onClick={() => host.action("openUrl", [href])} className="ml-0.5 inline-flex cursor-pointer items-center rounded-full bg-foreground/[0.06] px-1.5 align-[1px] text-[11px] text-muted-foreground hover:bg-foreground/[0.1]">{str(p.title ?? p.label) ?? new URL(href).hostname.replace(/^www\./, "")}</button>
}

/** A box that's a button (`<pressable onClick>`). */
const Pressable: Part = ({ p, k }) => {
  const host = useContext(HostCtx)
  const on = fnOf(host, p.onClick ?? p.onPress)
  return (
    <div role="button" tabIndex={0} onClick={(e) => { e.stopPropagation(); haptic(); on?.() }} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); on?.() } }}
      className="cursor-pointer rounded-[12px] transition-colors hover:bg-foreground/[0.04]" style={flexStyle({ gap: 0, ...p }, "column")}><Kids k={k} /></div>
  )
}

/** SVG's own elements, as written (attributes camel-cased, handlers called back). */
const SVG_TAGS = new Set(["svg", "g", "path", "circle", "ellipse", "rect", "line", "polyline", "polygon", "text", "tspan", "defs", "linearGradient", "radialGradient", "stop", "clipPath", "mask", "pattern", "use", "title", "desc", "marker", "foreignObject"])
function SvgPart({ t }: { t: Extract<Tree, { t: "el" }> }) {
  const host = useContext(HostCtx)
  if (!SVG_TAGS.has(t.n)) return null
  const attrs: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(t.p)) {
    if (k === "key" || k === "$n") continue
    const f = fnOf(host, v)
    if (f) { if (/^on[A-Z]/.test(k)) attrs[k] = () => f(); continue }
    if (typeof v !== "string" && typeof v !== "number") continue
    const name = k === "class" ? "className" : k.includes("-") && !k.startsWith("data-") && !k.startsWith("aria-") ? k.replace(/-([a-z])/g, (_, c) => c.toUpperCase()) : k
    attrs[name] = typeof v === "string" && v === "prose" ? "currentColor" : v
  }
  const El = t.n as "g"
  return <El {...attrs}>{t.k.map((x, i) => (x.t === "md" ? x.s.replace(/\\(.)/g, "$1") : <Piece key={i} t={x} />))}</El>
}
const Svg: Part = ({ p, k }) => {
  const size = num(p.size) ?? str(p.size)
  const c = tone(p.color) ?? "currentColor"
  return (
    <SvgCtx.Provider value={true}>
      <svg viewBox={str(p.viewBox) ?? "0 0 24 24"} width={p.width as number ?? size ?? "100%"} height={p.height as number ?? size} preserveAspectRatio={str(p.preserveAspectRatio)}
        fill={str(p.fill) === "currentColor" || !p.fill ? c : str(p.fill)} stroke={str(p.stroke)} strokeWidth={num(p.strokeWidth)} strokeLinecap={str(p.strokeLinecap) as never} strokeLinejoin={str(p.strokeLinejoin) as never}
        style={{ color: c, maxWidth: "100%", display: "block" }}>
        {k.map((x, i) => <Piece key={i} t={x} />)}
      </svg>
    </SvgCtx.Provider>
  )
}

/** Things in a row that scroll sideways, `visibleItems` at a time. */
const Carousel: Part = ({ p, k }) => {
  const shown = num(p.visibleItems)
  return (
    <div className="genui-carousel -mx-1 flex snap-x snap-proximity overflow-x-auto px-1 pb-1" style={{ gap: space(p.gap ?? 2) }}>
      {k.map((x, i) => <div key={i} className="shrink-0 snap-start" style={{ width: shown ? `calc((100% - ${(shown - 1) * 8}px) / ${shown})` : "min(260px, 80%)" }}><Piece t={x} /></div>)}
    </div>
  )
}
const CarouselItem: Part = ({ p, k }) => {
  const host = useContext(HostCtx)
  const media = p.media && typeof p.media === "object" ? p.media as P : null
  return (
    <div style={flexStyle({ radius: "xl", gap: 2, ...p, aspectRatio: undefined }, "column")} className="h-full overflow-hidden">
      {media && <Image p={{ ...media, src: media.src ?? media.url, radius: p.radius ?? "xl", aspectRatio: p.aspectRatio ?? "4:3" }} k={[]} />}
      {!media && typeof p.aspectRatio === "string" && !k.length ? null : <Kids k={k} />}
      {void host}
    </div>
  )
}

/** A packed grid of tiles (flow): `columns`, items spanning `span` and `rowSpan`. */
const Flow: Part = ({ p, k }) => (
  <div className="grid grid-flow-dense" style={{ gridTemplateColumns: `repeat(${num(p.columns) ?? 3}, minmax(0, 1fr))`, gap: space(p.gap ?? 4) }}><Kids k={k} /></div>
)
const FlowItem: Part = ({ p, k }) => (
  <div style={{ gridColumn: num(p.span) ? `span ${num(p.span)}` : undefined, gridRow: num(p.rowSpan) ? `span ${num(p.rowSpan)}` : undefined, aspectRatio: str(p.aspectRatio)?.replace(":", "/"), minWidth: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}><Kids k={k} /></div>
)

/** Choices as radio buttons: `<radio-group value onChange>` with `<radio value>Label</radio>`s, or `options`. */
const RadioGroupCtx = createContext<{ value: unknown; set: ((v: unknown) => void) | null; name: string }>({ value: undefined, set: null, name: "" })
const RadioGroup: Part = ({ p, k }) => {
  const host = useContext(HostCtx)
  const on = fnOf(host, p.onChange ?? p.onValueChange)
  const [own, setOwn] = useState<unknown>(p.defaultValue)
  const name = useId()
  const opts = optionsOf(p.options)
  const value = p.value !== undefined ? p.value : own
  const set = (v: unknown) => { haptic("selection"); if (on) on(v); else setOwn(v) }
  return (
    <RadioGroupCtx.Provider value={{ value, set, name }}>
      <div role="radiogroup" style={flexStyle({ gap: 2, ...p }, str(p.direction) === "row" || str(p.orientation) === "horizontal" ? "row" : "column")}>
        {opts.length ? opts.map((o) => <Radio key={o.value} p={{ value: o.value, label: o.label }} k={[]} />) : <Kids k={k} />}
      </div>
    </RadioGroupCtx.Provider>
  )
}
const Radio: Part = ({ p, k }) => {
  const g = useContext(RadioGroupCtx)
  const v = p.value
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-[15px]">
      <input type="radio" name={g.name} checked={g.value !== undefined && String(g.value) === String(v)} disabled={!!p.disabled} onChange={() => g.set?.(v)} className="size-4 cursor-pointer accent-[var(--primary)]" />
      <span><Inline k={k.length ? k : str(p.label) ? [{ t: "md", s: str(p.label)! }] : []} /></span>
    </label>
  )
}

/** A popover: its trigger toggles its content under it. */
const PopCtx = createContext<{ open: boolean; toggle: () => void }>({ open: false, toggle: () => {} })
const Popover: Part = ({ p, k }) => {
  const [open, setOpen] = useState(!!p.open)
  return <PopCtx.Provider value={{ open, toggle: () => setOpen((x) => !x) }}><div className="relative inline-flex flex-col"><Kids k={k} /></div></PopCtx.Provider>
}
const PopoverTrigger: Part = ({ p, k }) => {
  const c = useContext(PopCtx), host = useContext(HostCtx)
  const on = fnOf(host, p.onClick)
  return <div role="button" tabIndex={0} className={cn("cursor-pointer", p.block ? "flex" : "inline-flex")} onClick={() => { c.toggle(); on?.() }}><Kids k={k} /></div>
}
const PopoverContent: Part = ({ p, k }) => {
  const c = useContext(PopCtx)
  if (!c.open) return null
  return <div className="absolute top-full left-0 z-20 mt-1.5 rounded-[12px] border-[0.5px] border-border bg-card p-3 shadow-lg" style={{ width: space(p.width) ?? 260 }}><div style={flexStyle({ gap: 2 }, "column")}><Kids k={k} /></div></div>
}

/** A card that turns over when clicked: its first child the front, the second the back. */
const Flashcard: Part = ({ k }) => {
  const [back, setBack] = useState(false)
  const faces = k.filter((x) => !(x.t === "md" && !x.s.trim()))
  return (
    <button type="button" onClick={() => { haptic(); setBack((b) => !b) }} aria-pressed={back}
      className="flex min-h-32 w-full cursor-pointer flex-col justify-center rounded-[16px] border-[0.5px] border-border bg-card p-5 text-left transition-transform duration-200 active:scale-[0.99]">
      {faces[back ? 1 : 0] ? <Piece t={faces[back ? 1 : 0]} /> : null}
    </button>
  )
}

const MathPart: Part = ({ p, k }) => {
  const host = useContext(HostCtx)
  const tex = str(p.value) ?? label(k)
  return <Md s={p.block ? `$$\n${tex}\n$$` : `$${tex}$`} inline={!p.block} from={host.from} />
}

const Youtube: Part = ({ p }) => {
  const host = useContext(HostCtx)
  const id = str(p.videoId)
  if (!id || !/^[\w-]{6,20}$/.test(id)) return null
  const Play = namedIcon("play")
  return (
    <button type="button" onClick={() => host.action("openUrl", [`https://www.youtube.com/watch?v=${id}`])} aria-label={str(p.title) ?? "Play on YouTube"}
      className="relative w-full cursor-pointer overflow-hidden rounded-[12px] bg-black" style={{ aspectRatio: str(p.aspectRatio)?.replace(":", "/") ?? "16 / 9", maxWidth: str(p.maxWidth) }}>
      <img src={`https://i.ytimg.com/vi/${id}/hqdefault.jpg`} alt="" referrerPolicy="no-referrer" className="size-full object-cover opacity-90" />
      <span className="absolute inset-0 grid place-items-center">{Play && <span className="grid size-14 place-items-center rounded-full bg-black/70 text-white"><Play className="size-6" fill="currentColor" /></span>}</span>
    </button>
  )
}

const Favicon: Part = ({ p }) => {
  const u = str(p.url)
  let host = ""
  try { host = u ? new URL(u).hostname : "" } catch { /* not an address */ }
  if (!host) return null
  const size = num(p.size) ?? 16
  return <img src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`} alt={str(p.alt) ?? ""} width={size} height={size} referrerPolicy="no-referrer" className={cn("inline-block shrink-0 rounded-[4px] align-[-2px]", !!p.frame && "border-[0.5px] border-border p-0.5")} />
}

const HtmlView: Part = ({ p }) => {
  const host = useContext(HostCtx)
  return <AppFrame p={{ title: p.title }} html={str(p.html) ?? ""} host={host} />
}

const Spinner: Part = ({ p }) => (
  <span className="inline-flex items-center gap-2 text-[14px] text-muted-foreground" role="status">
    <span className="size-4 animate-spin rounded-full border-2 border-foreground/15 border-t-foreground/60" />{str(p.label) && str(p.label) !== "Loading" ? str(p.label) : null}
  </span>
)
const LoadingBlock: Part = ({ p, k }) => <div className="animate-pulse rounded-[12px]" style={{ background: surface(p.background) ?? SURFACE["surface-tertiary"], minHeight: 48, ...boxStyle({ ...p, background: undefined }) }}><Kids k={k} /></div>
const Pulse: Part = ({ p }) => {
  const size = num(p.size) ?? 12, c = tone(p.color) ?? "var(--green)"
  return <span className="relative inline-flex shrink-0" style={{ width: size, height: size }}><span className="absolute inset-0 animate-ping rounded-full opacity-60" style={{ background: tone(p.pulseColor) ?? c }} /><span className="relative rounded-full" style={{ width: size, height: size, background: c }} /></span>
}
const Tooltip: Part = ({ p, k }) => <span data-tip={str(p.content) ?? ""} className="inline-flex"><Kids k={k} /></span>
const mark = (style: CSSProperties, Tag: "span" | "em" | "strong" | "u" | "s" = "span"): Part => ({ p, k }) => <Tag style={{ ...style, ...(p.weight ? { fontWeight: WEIGHT[str(p.weight) ?? ""] } : {}) }}><Inline k={k} /></Tag>
const Pass: Part = ({ k }) => <Kids k={k} />
const MarkdownPart: Part = ({ k }) => {
  const host = useContext(HostCtx)
  return <Md s={k.map((x) => (x.t === "md" ? x.s : "")).join("\n\n")} inline={false} from={host.from} />
}
/** Table rows written as children: a section (thead or tbody) and its rows. */
const TableSection: Part = ({ p, k }) => (p.header ? <thead><Kids k={k} /></thead> : <tbody><Kids k={k} /></tbody>)
const TableRow: Part = ({ p, k }) => <tr data-header={p.header ? "" : undefined}>{str(p.label) && <th>{str(p.label)}</th>}<Kids k={k} /></tr>
const TableCell: Part = ({ p, k }) => {
  const Tag = p.header ? "th" : "td"
  return <Tag colSpan={num(p.colSpan)} rowSpan={num(p.rowSpan)} style={{ textAlign: (str(p.align) as CSSProperties["textAlign"]) ?? "left", verticalAlign: str(p.vAlign) === "center" ? "middle" : str(p.vAlign) === "end" ? "bottom" : "top", width: str(p.width) }}><Inline k={k} /></Tag>
}

/** ChatGPT's map (MapWidgetV2): its places on the app's map when their coordinates came with it, and each day's
 *  stops in order, each a link to a map search. */
const MapWidget: Part = ({ p }) => {
  const host = useContext(HostCtx)
  const [failed, setFailed] = useState(false)
  const points = (Array.isArray(p.points) ? p.points : []) as P[]
  const found = typeof p.$n === "number" ? host.data?.maps?.[p.$n] ?? [] : []
  const groups = (Array.isArray(p.groups) && p.groups.length ? p.groups : [{ locations: points.map((x, i) => ({ point_id: str(x.id ?? x.ref) ?? String(i) })) }]) as P[]
  // A point by its id (`ref` for one ChatGPT found, matched to the found ones in order), with its name.
  const at = (id: string) => {
    const i = points.findIndex((x) => str(x.id ?? x.ref) === id)
    const pt = points[i] ?? {}
    const f = found.find((x) => x.name === str(pt.name)) ?? found[i]
    return { name: str(pt.name) ?? f?.name ?? id, address: str(pt.address) ?? f?.address, lat: f?.lat ?? num(pt.latitude ?? pt.lat), lon: f?.lon ?? num(pt.longitude ?? pt.lon) }
  }
  const pins = points.map((x, i) => ({ ...at(str(x.id ?? x.ref) ?? String(i)), i })).filter((x) => x.lat !== undefined && x.lon !== undefined)
    .map((x) => ({ id: String(x.i), title: x.name, lat: x.lat!, lon: x.lon!, meta: x.address }))
  const search = (q: string) => host.action("openUrl", [`https://www.google.com/maps/search/${encodeURIComponent(q)}`])
  return (
    <div className="flex flex-col gap-3 overflow-hidden rounded-[16px] border-[0.5px] border-border">
      {pins.length > 0 && !failed && <div className="h-56 w-full"><Suspense fallback={null}><PinMap pins={pins} zoom={14} onOpen={(id) => search(pins.find((x) => x.id === id)?.title ?? "")} onFail={() => setFailed(true)} /></Suspense></div>}
      <div className="flex flex-col gap-3 px-4 pb-4" style={{ paddingTop: pins.length && !failed ? 0 : 16 }}>
        {groups.map((g, gi) => (
          <div key={gi} className="flex flex-col gap-1.5">
            {str(g.title) && <div className="text-[15px] font-semibold">{str(g.title)}</div>}
            <ol className="flex flex-col gap-1.5">
              {((Array.isArray(g.locations) ? g.locations : []) as P[]).map((l, li) => {
                const pt = at(str(l.point_id) ?? "")
                return (
                  <li key={li} className="flex gap-2.5 text-[14px]">
                    <span className="mt-px grid size-5 shrink-0 place-items-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground">{li + 1}</span>
                    <span className="min-w-0 flex-1">
                      <button type="button" className="cursor-pointer text-left font-medium hover:underline" onClick={() => search(pt.address ? `${pt.name}, ${pt.address}` : pt.name)}>{pt.name}</button>
                      {str(l.notes) && <span className="block text-muted-foreground">{str(l.notes)}</span>}
                    </span>
                  </li>
                )
              })}
            </ol>
          </div>
        ))}
      </div>
    </div>
  )
}

const PARTS: Record<string, Part> = {
  box: Box, col: Box, column: Box, stack: Box, vstack: Box, section: Box, div: Box, view: Box,
  row: Row, hstack: Row, inline: Row, group: Row,
  grid: Grid, "grid-item": GridItem, gridItem: GridItem, cell: GridItem,
  title: Title, heading: Title, h1: Title, h2: Title, h3: Title,
  text: text("md"), p: text("md"), paragraph: text("md"), body: text("md"),
  caption: text("lg", 400, { color: "var(--muted-foreground)" }, "div", CAPTION), label: text("sm", 500, undefined, "label"),
  bold: text("md", 600, undefined, "strong"), strong: text("md", 600, undefined, "strong"), small: text("xs"),
  icon: Icon, button: Button, select: Select, dropdown: Select, checkbox: Checkbox, switch: Toggle, toggle: Toggle,
  slider: Slider, range: Slider, input: ({ p }) => <Field p={p} />, textfield: ({ p }) => <Field p={p} />, "text-input": ({ p }) => <Field p={p} />,
  "number-input": ({ p }) => <Field p={{ type: "number", ...p }} />, textarea: ({ p }) => <Field p={p} area />,
  segmented: Segmented, "segmented-control": Segmented, segmentedControl: Segmented,
  tabs: Tabs, badge: Badge, pill: Badge, tag: Badge, chip: Badge, divider: Divider, separator: Divider, hr: Divider,
  progress: Progress, "progress-bar": Progress, image: Image, img: Image, link: Link, a: Link,
  table: Table, tr: Tr, td: Td, th: Th,
  chart: ChartPart, "bar-chart": (x) => <ChartPart p={{ type: "bar", ...x.p }} k={[]} />, "line-chart": (x) => <ChartPart p={{ type: "line", ...x.p }} k={[]} />,
  "pie-chart": (x) => <ChartPart p={{ type: "pie", ...x.p }} k={[]} />, "area-chart": (x) => <ChartPart p={{ type: "area", ...x.p }} k={[]} />,
  card: Card, list: List, ul: List, "list-item": ListItem, li: ListItem, spacer: Spacer, stat: Stat, metric: Stat,
  quote: Quote, blockquote: Quote, code: Code, form: Form, collapsible: Collapsible, accordion: Collapsible, details: Collapsible,
  pressable: Pressable, clickable: Pressable, LearningQuiz: ({ p }) => <Quiz p={p} />, quiz: ({ p }) => <Quiz p={p} />,
  // (ChatGPT's reaction to the user's message: nothing in a note)
  MessageReaction: () => null,
  AsyncImage, AsyncImageGroup, Entity, Cite, "search-image": AsyncImage, MapWidgetV2: MapWidget, MapWidget, map: MapWidget,
  svg: Svg, carousel: Carousel, "carousel-item": CarouselItem, "carousel-media-item": CarouselItem, flow: Flow, "flow-item": FlowItem,
  "radio-group": RadioGroup, radioGroup: RadioGroup, radio: Radio, popover: Popover, "popover-trigger": PopoverTrigger, "popover-content": PopoverContent,
  "flashcard-flip": Flashcard, flashcard: Flashcard, math: MathPart, youtube: Youtube, favicon: Favicon, "html-view": HtmlView,
  loading: Spinner, "loading-indicator": Spinner, "loading-block": LoadingBlock, "shimmer-text": text("md", 400, { color: "var(--muted-foreground)" }),
  "pulse-indicator": Pulse, tooltip: Tooltip, italic: mark({ fontStyle: "italic" }, "em"), em: mark({ fontStyle: "italic" }, "em"), i: mark({ fontStyle: "italic" }, "em"),
  underline: mark({ textDecoration: "underline" }, "u"), strikethrough: mark({ textDecoration: "line-through" }, "s"), b: mark({ fontWeight: 600 }, "strong"),
  animate: Pass, "animate-group": Pass, "animate-item": Pass, transition: Pass, celebration: Pass, lottie: () => null, markdown: MarkdownPart,
  "table-section": TableSection, "table-row": TableRow, "table-cell": TableCell, "date-picker": ({ p }) => <Field p={{ inputType: "date", ...p }} />, asyncImage: AsyncImage, entity: Entity, cite: Cite,
}

/** What a program drew, with the way back to it. */
export function Drawn({ tree, host }: { tree: Tree[]; host: Host }) {
  return (
    <HostCtx.Provider value={host}>
      <div className="genui flex min-w-0 flex-col gap-4 @container"><Kids k={tree} /></div>
    </HostCtx.Provider>
  )
}
