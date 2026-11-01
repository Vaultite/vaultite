// The mind map: a tidy tree laid out left to right (leaves a row each, a parent centred on its children), each top
// branch in a colour of its own. Text is measured once per label; folding a branch is this session's, per file.
import { useMemo, useState } from "react"
import type { MindNode } from "./tree"

const ROW = 30, GAP = 44, PAD = 10, MAX_W = 260, MARGIN = 16, H = 24
const BRANCH = ["blue", "orange", "green", "purple", "pink", "teal", "red", "indigo", "yellow"]
const folded = new Map<string, Set<number>>()

let ctx: CanvasRenderingContext2D | null = null
const widths = new Map<string, number>()
/** A label's width in px at the map's font. */
function measure(text: string, bold: boolean) {
  const key = `${bold ? 1 : 0}${text}`
  const hit = widths.get(key)
  if (hit !== undefined) return hit
  ctx ??= document.createElement("canvas").getContext("2d")
  let w = text.length * 7.2
  if (ctx) {
    ctx.font = `${bold ? 600 : 400} 13px ${getComputedStyle(document.body).fontFamily || "system-ui"}`
    w = ctx.measureText(text).width
  }
  widths.set(key, w)
  return w
}

type Laid = { node: MindNode; x: number; y: number; w: number; label: string; color: string; kids: Laid[]; hidden: number }

/** Each node's place: right of its parent, a leaf a row each, a parent centred on its children. */
function layout(root: MindNode, shut: Set<number>, depth: number) {
  let rows = 0, width = 0
  const place = (n: MindNode, d: number, x: number, color: string): Laid => {
    const bold = d === 0
    const full = measure(n.text, bold)
    let label = n.text
    if (full + PAD * 2 > MAX_W) {
      while (label.length > 1 && measure(`${label}…`, bold) + PAD * 2 > MAX_W) label = label.slice(0, -1)
      label = `${label.trimEnd()}…`
    }
    const w = Math.min(MAX_W, full + PAD * 2)
    width = Math.max(width, x + w)
    const open = d < depth && !(d > 0 && shut.has(n.line))
    const kids = open ? n.children.map((c, i) => place(c, d + 1, x + w + GAP, d === 0 ? BRANCH[i % BRANCH.length] : color)) : []
    const y = kids.length ? (kids[0].y + kids.at(-1)!.y) / 2 : rows++ * ROW
    return { node: n, x, y, w, label, color, kids, hidden: open ? 0 : count(n) }
  }
  const all: Laid[] = []
  const walk = (l: Laid) => { all.push(l); l.kids.forEach(walk) }
  walk(place(root, 0, 0, "gray"))
  return { all, width, height: Math.max(1, rows) * ROW }
}
const count = (n: MindNode): number => n.children.reduce((s, c) => s + 1 + count(c), 0)

export function MindMap({ root, path, depth = 6, onGo, height }: { root: MindNode; path: string; depth?: number; onGo: (line: number) => void; height?: number }) {
  const [, redraw] = useState(0)
  const shut = folded.get(path) ?? new Set<number>()
  const { all, width, height: h } = useMemo(() => layout(root, shut, depth), [root, depth, shut.size, [...shut].join()])
  const toggle = (line: number) => {
    const s = new Set(shut)
    if (!s.delete(line)) s.add(line)
    folded.set(path, s)
    redraw((n) => n + 1)
  }
  const W = width + MARGIN * 2 + 24, Hh = h + MARGIN * 2
  return (
    <div className="overflow-auto" style={height ? { height } : undefined} data-mind-map>
      <svg width={W} height={Hh} viewBox={`${-MARGIN} ${-MARGIN - ROW / 2} ${W} ${Hh}`} className="block min-w-full" role="tree" aria-label={`Mind map of ${root.text}`}
        style={{ minHeight: height ? height - 2 : undefined }}>
        {all.flatMap((p) => p.kids.map((c) => {
          const a = p.x + p.w, m = (a + c.x) / 2
          return <path key={`e${c.node.line}`} d={`M${a},${p.y} C${m},${p.y} ${m},${c.y} ${c.x},${c.y}`} fill="none" stroke={`var(--${c.color})`} strokeOpacity={0.55} strokeWidth={1.5} />
        }))}
        {all.map((l, i) => {
          const root = i === 0
          const c = `var(--${l.color})`
          const go = () => onGo(l.node.line)
          return (
            <g key={`n${l.node.line}`} transform={`translate(${l.x},${l.y})`} role="treeitem" aria-label={l.node.text} aria-expanded={l.node.children.length && !root ? !l.hidden : undefined}
              data-mind-node={l.node.text}>
              <g role="button" tabIndex={0} className="cursor-pointer outline-none [&:focus-visible>rect]:stroke-[2.5]" onClick={go}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go() } }}>
                <title>{l.node.text}</title>
                <rect x={0} y={-H / 2} width={l.w} height={H} rx={root ? H / 2 : 6}
                  fill={root ? "var(--foreground)" : `color-mix(in oklab, ${c} 14%, var(--background))`} stroke={root ? "none" : c} strokeOpacity={0.6} />
                <text x={PAD} y={0} dominantBaseline="central" fontSize={13} fontWeight={root ? 600 : 400}
                  fill={root ? "var(--background)" : "var(--foreground)"}>{l.label}</text>
              </g>
              {!root && l.node.children.length > 0 && (
                <g role="button" tabIndex={0} aria-label={l.hidden ? `Unfold ${l.node.text}` : `Fold ${l.node.text}`} className="cursor-pointer outline-none"
                  onClick={() => toggle(l.node.line)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(l.node.line) } }}
                  transform={`translate(${l.w + (l.hidden ? 12 : 0)},0)`} data-mind-fold>
                  <circle r={l.hidden ? 9 : 5} fill={l.hidden ? c : "var(--background)"} stroke={c} strokeWidth={1.5} />
                  {l.hidden > 0 && <text textAnchor="middle" dominantBaseline="central" fontSize={10} fontWeight={600} fill="var(--background)">{l.hidden > 99 ? "99+" : l.hidden}</text>}
                </g>
              )}
            </g>
          )
        })}
      </svg>
    </div>
  )
}
