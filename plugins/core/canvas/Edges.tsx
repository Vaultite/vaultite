// A canvas's arrows, each memoized on its two cards so moving a card redraws only its own arrows.
import { memo } from "react"
import { cn } from "@vaultite"
import { colorOf, styleOf, type CanvasEdge, type CanvasNode, type Side } from "./codec"
import { head, type Pt } from "./geometry"
import { edgePath, px } from "./look"

/** A line style's dashes (round caps make "0 n" dots). */
const DASHES: Record<string, string | undefined> = { "long-dashed": "14 8", "short-dashed": "6 6", dotted: "0 6" }

type Props = {
  edge: CanvasEdge; from: CanvasNode; to: CanvasNode
  selected: boolean; editingLabel: boolean; interactive: boolean
  /** One of its ends is being dragged elsewhere: drawn faint. */
  moving: boolean
}

export const Edge = memo(function Edge({ edge: e, from, to, selected, editingLabel, interactive, moving }: Props) {
  const { d, mid, c1, c2, pa, pb } = edgePath(e, from, to)
  const c = colorOf(e.color) ?? "var(--muted-foreground)"
  const ink = selected ? "var(--primary)" : c
  return (
    <g data-edge={e.id} className="group/edge" opacity={moving ? 0.3 : 1}>
      <path d={d} fill="none" stroke="transparent" className={cn(interactive && "cursor-pointer")}
        style={{ pointerEvents: interactive ? "stroke" : "none", strokeWidth: `max(14px, ${px(14)})` }} data-canvas-edge={e.id} />
      <path d={d} fill="none" stroke={ink} strokeWidth={selected ? 3 : 2} strokeLinecap="round" strokeDasharray={DASHES[styleOf(e, "path")]}
        className={cn(interactive && !selected && "group-hover/edge:stroke-[var(--primary)]")} />
      {(e.toEnd ?? "arrow") === "arrow" && <polygon points={head(pb, c2, 12)} fill={ink} className={cn(interactive && !selected && "group-hover/edge:fill-[var(--primary)]")} />}
      {(e.fromEnd ?? "none") === "arrow" && <polygon points={head(pa, c1, 12)} fill={ink} className={cn(interactive && !selected && "group-hover/edge:fill-[var(--primary)]")} />}
      {!editingLabel && e.label ? (
        <foreignObject x={mid.x - 120} y={mid.y - 14} width={240} height={28} style={{ overflow: "visible", pointerEvents: interactive ? "auto" : "none" }}>
          <div className="flex h-full items-center justify-center" data-edge-label={e.id}>
            <span className="max-w-full truncate rounded-[6px] bg-background px-1.5 text-[14px] text-foreground" data-canvas-edge={e.id}>{String(e.label)}</span>
          </div>
        </foreignObject>
      ) : null}
    </g>
  )
})

/** The arrow being drawn: dashed, from where it starts to the pointer (or the side of the card under it). */
export function Preview({ pa, sa, pb, sb }: { pa: Pt; sa: Side; pb: Pt; sb: Side | null }) {
  const d = Math.max(30, Math.min(220, Math.hypot(pb.x - pa.x, pb.y - pa.y) / 2))
  const dir = { top: [0, -1], right: [1, 0], bottom: [0, 1], left: [-1, 0] } as const
  const c1 = { x: pa.x + dir[sa][0] * d, y: pa.y + dir[sa][1] * d }
  const c2 = sb ? { x: pb.x + dir[sb][0] * d, y: pb.y + dir[sb][1] * d } : c1
  const a = Math.atan2(pb.y - c2.y, pb.x - c2.x)
  const h = (t: number) => `${pb.x - 12 * Math.cos(a + t)},${pb.y - 12 * Math.sin(a + t)}`
  return <g><path d={`M ${pa.x} ${pa.y} C ${c1.x} ${c1.y} ${c2.x} ${c2.y} ${pb.x} ${pb.y}`} fill="none" stroke="var(--primary)" strokeWidth={2} strokeDasharray="6 5" />
    <polygon points={`${pb.x},${pb.y} ${h(0.45)} ${h(-0.45)}`} fill="var(--primary)" /></g>
}
