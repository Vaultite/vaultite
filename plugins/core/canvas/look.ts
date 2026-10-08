// Small helpers the board's pieces share (Board.tsx, Card.tsx, Edges.tsx): sizes that stay the same on screen at any
// zoom, a card's tint, file names, and where an arrow's ends are.
import type { CanvasEdge, CanvasNode } from "./codec"
import { anchor, center, curve, facing } from "./geometry"

const IMAGE = /\.(png|jpe?g|gif|webp|svg|avif|bmp)$/i
export const isImage = (p: string) => IMAGE.test(p)
export const fileName = (p: string) => p.slice(p.lastIndexOf("/") + 1)
/** A colour mixed into the card's (`pct` of it), or the card's own. */
export const tint = (c: string | null, pct: number, base = "var(--card)") => (c ? `color-mix(in srgb, ${c} ${pct}%, ${base})` : base)
/** A size that stays the same on screen at any zoom (the board sets --k, its zoom). */
export const px = (n: number) => `calc(${n}px / var(--k, 1))`

/** Where an arrow's ends are and how it curves (its sides facing each other when the file names none). */
export function edgePath(e: CanvasEdge, a: CanvasNode, b: CanvasNode) {
  const sa = e.fromSide ?? facing(a, center(b)), sb = e.toSide ?? facing(b, center(a))
  const pa = anchor(a, sa), pb = anchor(b, sb)
  return { sa, sb, pa, pb, ...curve(pa, sa, pb, sb) }
}
