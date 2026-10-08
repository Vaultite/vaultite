// A canvas's arrows, each memoized on its two cards so moving a card redraws only its own arrows.
import { memo } from "react"
import { cn } from "@vaultite"
import { colorOf, type CanvasEdge, type CanvasNode } from "./codec"
import { head } from "./geometry"
import { edgePath, px } from "./look"

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
      <path d={d} fill="none" stroke={ink} strokeWidth={selected ? 3 : 2} strokeLinecap="round"
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
