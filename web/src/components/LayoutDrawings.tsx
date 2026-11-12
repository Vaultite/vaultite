import { useId, type CSSProperties, type ReactNode } from "react"
import type { Sketch } from "../../../core/bundlesketch.ts"
import { onlyMode } from "@/core/appearance"
import { cn } from "@/lib/utils"

export type Drawable = Pick<Sketch, "theme" | "scheme" | "panels" | "home"> & { id: string; source: "app" | "vault"; shape: Partial<Sketch["shape"]> | null }

const W = 160, H = 100

const ink = (p: number) => `color-mix(in oklab, var(--foreground) ${p}%, transparent)`
const tint = (c: string, p: number) => `color-mix(in oklab, ${c} ${p}%, transparent)`
const BG = "var(--background)", SIDE = "var(--sidebar)", LINE = "var(--border)", ACCENT = "var(--primary)"
const PANE = "color-mix(in oklab, var(--foreground) 16%, transparent)"
const DOTS = ["var(--red)", "var(--blue)", "var(--green)", "var(--orange)", "var(--purple)", "var(--teal)"]

const fill = (c: string): CSSProperties => ({ fill: c })
const R = ({ x, y, w, h, r = 0, c }: { x: number; y: number; w: number; h: number; r?: number; c: string }) =>
  <rect x={x} y={y} width={w} height={h} rx={r} style={fill(c)} />
const Dot = ({ x, y, r = 1.6, c }: { x: number; y: number; r?: number; c: string }) => <circle cx={x} cy={y} r={r} style={fill(c)} />
const VLine = ({ x, y = 0, y2 = H }: { x: number; y?: number; y2?: number }) => <rect x={x - 0.25} y={y} width={0.5} height={y2 - y} style={fill(LINE)} />
const HLine = ({ y, x = 0, x2 = W }: { y: number; x?: number; x2?: number }) => <rect x={x} y={y - 0.25} width={x2 - x} height={0.5} style={fill(LINE)} />

const Lights = ({ x = 6, y = 6 }: { x?: number; y?: number }) => <>{["var(--red)", "var(--yellow)", "var(--green)"].map((c, i) => <Dot key={c} x={x + i * 4.6} y={y} r={1.5} c={c} />)}</>

function Side({ x, w, c = SIDE, children }: { x: number; w: number; c?: string; children?: ReactNode }) {
  return <g><R x={x} y={0} w={w} h={H} c={c} /><VLine x={x === 0 ? w : x} />{children}</g>
}

const Row = ({ x, y, w, c = ink(22), bar = ink(14), square }: { x: number; y: number; w: number; c?: string; bar?: string; square?: boolean }) => <>
  {square ? <R x={x} y={y - 2} w={4} h={4} r={1.2} c={c} /> : <Dot x={x + 1.6} y={y} c={c} />}
  <R x={x + 7} y={y - 1.5} w={w} h={3} r={1.5} c={bar} />
</>

function Note({ x, y, w, n = 4 }: { x: number; y: number; w: number; n?: number }) {
  const ws = [0.94, 0.82, 0.9, 0.58, 0.86, 0.72]
  return <>
    <R x={x} y={y} w={w * 0.5} h={5} r={2} c={ink(24)} />
    {ws.slice(0, n).map((f, i) => <R key={i} x={x} y={y + 11 + i * 6.5} w={w * f} h={3} r={1.5} c={ink(11)} />)}
  </>
}

function Cards({ x, y, w, h }: { x: number; y: number; w: number; h: number }) {
  const g = 4, cw = (w - g) / 2, ch = (h - 9 - g) / 2
  return <>
    <R x={x} y={y} w={w * 0.4} h={5} r={2} c={ink(24)} />
    {[0, 1, 2, 3].map((i) => {
      const cx = x + (i % 2) * (cw + g), cy = y + 9 + Math.floor(i / 2) * (ch + g)
      return <g key={i}><R x={cx} y={cy} w={cw} h={ch} r={3} c={ink(6)} /><R x={cx + 3} y={cy + 3.5} w={cw * 0.45} h={3} r={1.5} c={i ? ink(18) : tint(ACCENT, 70)} /></g>
    })}
  </>
}

function Terminal({ x, y, w }: { x: number; y: number; w: number }) {
  return <g>
    <R x={x} y={y} w={w} h={H - y} c={SIDE} />
    <HLine y={y} x={x} x2={x + w} />
    {[0, 1].map((i) => {
      const ry = y + 9 + i * 9
      return <g key={i}>
        <path d={`M${x + 7} ${ry - 2.5} l2.6 2.5 l-2.6 2.5`} fill="none" style={{ stroke: "var(--green)" }} strokeWidth={1.3} strokeLinecap="round" strokeLinejoin="round" />
        <R x={x + 13} y={ry - 1.5} w={i ? 14 : w * 0.42} h={3} r={1.5} c={ink(i ? 14 : 24)} />
        {i === 1 && <R x={x + 29} y={ry - 2.5} w={3} h={5} r={0.6} c={ACCENT} />}
      </g>
    })}
  </g>
}

function TabBar({ x, w }: { x: number; w: number }) {
  return <g>
    <HLine y={12} x={x} x2={x + w} />
    <R x={x + 3} y={3} w={Math.min(30, w * 0.36)} h={9} r={2.5} c={ink(8)} />
    <Dot x={x + 8} y={7.5} r={1.4} c={ACCENT} />
    <R x={x + 11.5} y={6} w={Math.min(16, w * 0.2)} h={3} r={1.5} c={ink(30)} />
    {[0, 1].map((i) => <R key={i} x={x + 3 + Math.min(30, w * 0.36) + 6 + i * 20} y={6} w={13} h={3} r={1.5} c={ink(14)} />)}
  </g>
}

const Edge = ({ side }: { side: "left" | "right" }) => <R x={side === "left" ? 2 : W - 4.5} y={38} w={2.5} h={24} r={1.25} c={ink(22)} />

function Standard() {
  return <>
    <R x={0} y={0} w={W} h={H} c={BG} />
    <Side x={0} w={40}>
      <Lights />
      <R x={5} y={12} w={30} h={6} r={3} c={ink(8)} />
      <Row x={5} y={25} w={18} c={ACCENT} square /><Row x={5} y={31.5} w={14} square /><Row x={5} y={38} w={20} square />
      <HLine y={45} x={5} x2={35} />
      <Row x={5} y={52} w={16} c={ink(30)} bar={ink(18)} /><Row x={10} y={58.5} w={14} /><Row x={10} y={65} w={11} /><Row x={5} y={71.5} w={18} c={ink(30)} bar={ink(18)} />
    </Side>
    <Side x={128} w={32}>
      <R x={132} y={7} w={24} h={22} r={3} c={ink(6)} /><R x={135} y={10.5} w={12} h={3} r={1.5} c={ink(20)} /><R x={135} y={17} w={17} h={2.5} r={1.25} c={ink(11)} /><R x={135} y={22} w={14} h={2.5} r={1.25} c={ink(11)} />
      <R x={132} y={33} w={24} h={30} r={3} c={ink(6)} /><R x={135} y={36.5} w={10} h={3} r={1.5} c={ink(20)} />
      {[0, 1, 2].map((i) => <R key={i} x={135 + (i % 2) * 4} y={43 + i * 5.5} w={13} h={2.5} r={1.25} c={ink(11)} />)}
    </Side>
    <TabBar x={40} w={88} />
    <Note x={50} y={20} w={68} n={3} />
    <Terminal x={40} y={60} w={88} />
  </>
}

function Zen({ shadow }: { shadow: string }) {
  return <>
    <R x={0} y={0} w={W} h={H} c={SIDE} />
    <Lights />
    <Edge side="left" /><Edge side="right" />
    <g filter={`url(#${shadow})`}><R x={22} y={13} w={116} h={80} r={7} c={BG} /></g>
    <rect x={22.25} y={13.25} width={115.5} height={79.5} rx={6.8} fill="none" style={{ stroke: PANE }} strokeWidth={0.6} />
    <Note x={56} y={28} w={48} n={5} />
  </>
}

function Browser() {
  const tabs = [20, 15, 22, 17, 12]
  return <>
    <R x={0} y={0} w={W} h={H} c={BG} />
    <Side x={0} w={44}>
      <Lights />
      {DOTS.map((c, i) => {
        const x = 5 + (i % 3) * 12, y = 13 + Math.floor(i / 3) * 11
        return <g key={i}><R x={x} y={y} w={10} h={8.5} r={2.5} c={ink(7)} /><Dot x={x + 5} y={y + 4.25} c={c} /></g>
      })}
      <HLine y={37} x={5} x2={39} />
      {tabs.map((w, i) => {
        const y = 41 + i * 9
        return <g key={i}>
          {i === 1 && <R x={3.5} y={y} w={37} h={7.5} r={2.2} c={BG} />}
          <Dot x={9} y={y + 3.75} r={1.5} c={DOTS[(i + 1) % DOTS.length]} />
          <R x={13} y={y + 2.25} w={w} h={3} r={1.5} c={ink(i === 1 ? 32 : 16)} />
        </g>
      })}
    </Side>
    <R x={50} y={4} w={104} h={9} r={4.5} c={ink(7)} />
    <Dot x={56} y={8.5} r={1.4} c={ink(32)} />
    <R x={60} y={7} w={38} h={3} r={1.5} c={ink(22)} />
    <HLine y={17} x={44} x2={W} />
    <R x={52} y={23} w={7} h={7} r={2} c={ACCENT} />
    {[0, 1, 2].map((i) => <R key={i} x={118 + i * 12} y={25} w={8} h={3} r={1.5} c={ink(18)} />)}
    <R x={52} y={36} w={100} h={28} r={4} c={tint(ACCENT, 15)} />
    <R x={60} y={43} w={46} h={5} r={2} c={tint(ACCENT, 55)} />
    <R x={60} y={53} w={20} h={6} r={3} c={ACCENT} />
    {[0, 1, 2].map((i) => <R key={i} x={52 + i * 35} y={70} w={30} h={24} r={3} c={ink(6)} />)}
  </>
}

function panel(key: string, x: number, y: number, w: number, folded: boolean, out: ReactNode[]): number {
  const kind = key.split(":")[0], k = out.length
  if (kind === "search") { out.push(<R key={k} x={x} y={y} w={w} h={6} r={3} c={ink(8)} />); return 6 }
  if (folded) {
    out.push(<g key={k}><path d={`M${x + 0.5} ${y + 1} l2.4 2 l-2.4 2`} fill="none" style={{ stroke: ink(30) }} strokeWidth={1} strokeLinecap="round" /><R x={x + 5} y={y + 1.5} w={w * 0.45} h={3} r={1.5} c={ink(18)} /></g>)
    return 6
  }
  if (kind === "terminal") {
    out.push(<g key={k}><R x={x} y={y} w={w} h={14} r={2.5} c={ink(7)} />
      <path d={`M${x + 3.5} ${y + 4.5} l2.2 2.2 l-2.2 2.2`} fill="none" style={{ stroke: "var(--green)" }} strokeWidth={1.1} strokeLinecap="round" strokeLinejoin="round" />
      <R x={x + 8} y={y + 5.2} w={w * 0.4} h={3} r={1.5} c={ink(22)} /></g>)
    return 14
  }
  const rows = kind === "pages" ? 3 : kind === "tabs" ? 4 : kind === "files" ? 4 : 2
  const g: ReactNode[] = []
  for (let i = 0; i < rows; i++) {
    const ry = y + 2 + i * 6.5, bw = Math.max(6, (w - 9) * [0.8, 0.6, 0.72, 0.5][i])
    if (kind === "pages") g.push(<Row key={i} x={x} y={ry} w={bw} c={i ? ink(22) : ACCENT} square />)
    else if (kind === "tabs") g.push(<g key={i}>{i === 0 && <R x={x - 1.5} y={ry - 3.2} w={w + 3} h={6.4} r={2} c={BG} />}<Row x={x} y={ry} w={bw} c={DOTS[i % DOTS.length]} bar={ink(i ? 16 : 30)} /></g>)
    else if (kind === "files") g.push(<Row key={i} x={x + (i === 1 || i === 2 ? 4 : 0)} y={ry} w={bw - (i === 1 || i === 2 ? 4 : 0)} c={ink(i === 1 || i === 2 ? 20 : 30)} />)
    else g.push(<Row key={i} x={x} y={ry} w={bw} />)
  }
  out.push(<g key={k}>{g}</g>)
  return rows * 6.5
}

function Panels({ keys, folded, x, w, top }: { keys: string[]; folded: string[]; x: number; w: number; top: number }) {
  const out: ReactNode[] = []
  let y = top
  for (const k of keys) {
    if (y > H - 10) break
    y += panel(k, x, y, w, folded.includes(k), out) + 6
  }
  return <>{out}</>
}

function Drawn({ b, shadow, desk }: { b: Drawable; shadow: string; desk: string }) {
  const s = b.shape ?? {}
  const left = b.panels?.left ?? ["search:search", "pages:pages", "files:files"], right = b.panels?.right ?? []
  const folded = b.panels?.collapsed ?? []
  const floating = !!s.floating, hidden = floating && s.rails === false, tabs = s.tabBar !== false
  const lw = !hidden && left.length ? 40 : 0, rw = !hidden && right.length ? 32 : 0
  const inset = floating ? 5 : 0
  const px = lw + inset + (hidden ? 17 : 0), pw = W - lw - rw - inset * 2 - (hidden ? 34 : 0)
  const py = inset + (hidden ? 8 : 0), ph = H - py - inset - (hidden ? 2 : 0)
  const body = tabs ? 14 : !lw && !floating ? 8 : 0
  const glass = s.glass ?? null, side = glass ? tint(SIDE, 40) : SIDE, bg = glass === "pages" ? tint(BG, 55) : BG
  const page = b.home && b.home.length ? <Cards x={px + 8} y={py + body + 8} w={pw - 16} h={ph - body - 12} /> : <Note x={px + 9} y={py + body + 8} w={pw - 18} n={pw > 90 ? 5 : 4} />
  return <>
    {glass && <rect x={0} y={0} width={W} height={H} fill={`url(#${desk})`} />}
    {glass ? <R x={lw} y={0} w={W - lw - rw} h={H} c={floating ? side : bg} /> : <R x={0} y={0} w={W} h={H} c={floating ? SIDE : BG} />}
    {lw > 0 && <Side x={0} w={lw} c={side}><Panels keys={left} folded={folded} x={5} w={30} top={13} /></Side>}
    {rw > 0 && <Side x={W - rw} w={rw} c={side}><Panels keys={right} folded={folded} x={W - rw + 4} w={24} top={7} /></Side>}
    <Lights />
    {hidden && left.length > 0 && <Edge side="left" />}
    {hidden && right.length > 0 && <Edge side="right" />}
    {floating ? <>
      <g filter={hidden ? `url(#${shadow})` : undefined}><R x={px} y={py} w={pw} h={ph} r={6} c={bg} /></g>
      <rect x={px + 0.25} y={py + 0.25} width={pw - 0.5} height={ph - 0.5} rx={5.8} fill="none" style={{ stroke: PANE }} strokeWidth={0.6} />
    </> : null}
    {tabs && (floating ? <g transform={`translate(0 ${py})`}><TabBar x={px} w={pw} /></g> : <TabBar x={px} w={pw} />)}
    {page}
  </>
}

const BUILT_IN: Record<string, (shadow: string) => ReactNode> = {
  standard: () => <Standard />, zen: (s) => <Zen shadow={s} />, browser: () => <Browser />,
}

export function LayoutDrawing({ b, className }: { b: Drawable; className?: string }) {
  const id = useId().replace(/[^\w-]/g, ""), shadow = `ld${id}`, desk = `ldd${id}`
  const own = b.source === "app" ? BUILT_IN[b.id] : undefined
  const mode = b.scheme ? onlyMode(b.scheme) : undefined, theme = mode ?? (b.theme === "dark" || b.theme === "light" ? b.theme : null)
  const look = !!b.scheme || !!theme
  return (
    <svg viewBox={`0 0 ${W} ${H}`} aria-hidden preserveAspectRatio="xMidYMid slice" data-layout-drawing={own ? b.id : "drawn"}
      data-scheme={b.scheme && b.scheme !== "default" ? b.scheme : undefined}
      className={cn(look && "scheme-preview", theme === "dark" && "dark", className)}>
      <defs>
        <filter id={shadow} x="-20%" y="-20%" width="140%" height="150%">
          <feDropShadow dx={0} dy={1.5} stdDeviation={2.2} floodColor="black" floodOpacity={0.14} />
        </filter>
        <linearGradient id={desk} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" style={{ stopColor: "var(--teal)" }} /><stop offset="0.5" style={{ stopColor: "var(--blue)" }} /><stop offset="1" style={{ stopColor: "var(--purple)" }} />
        </linearGradient>
      </defs>
      {own ? own(shadow) : <Drawn b={b} shadow={shadow} desk={desk} />}
    </svg>
  )
}
