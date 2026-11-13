import type { CanvasEdge, CanvasNode } from "./codec"
import { anchor, center, curve, facing } from "./geometry"

const IMAGE = /\.(png|jpe?g|gif|webp|svg|avif|bmp)$/i
export const isImage = (p: string) => IMAGE.test(p)
export const isNote = (n: CanvasNode | undefined) => n?.type === "file" && /\.md$/i.test(String(n.file ?? ""))
export const fileSize = (p: string) => (isImage(p) ? { width: 400, height: 300 } : /\.(mp3|m4a|wav|ogg|flac|aac)$/i.test(p) ? { width: 400, height: 120 } : { width: 400, height: 400 })
export const fileName = (p: string) => p.slice(p.lastIndexOf("/") + 1)
export const tint = (c: string | null, pct: number, base = "var(--card)") => (c ? `color-mix(in srgb, ${c} ${pct}%, ${base})` : base)
export const px = (n: number) => `calc(${n}px / var(--k, 1))`

export function edgePath(e: CanvasEdge, a: CanvasNode, b: CanvasNode) {
  const sa = e.fromSide ?? facing(a, center(b)), sb = e.toSide ?? facing(b, center(a))
  const pa = anchor(a, sa), pb = anchor(b, sb)
  return { sa, sb, pa, pb, ...curve(pa, sa, pb, sb) }
}
