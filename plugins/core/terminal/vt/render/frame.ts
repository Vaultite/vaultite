// What a renderer draws for one frame: the rows (screen.ts) and what goes over them. Both renderers (webgl.ts,
// canvas.ts) take this, so they draw the same thing.
import { F_BOLD, F_FAINT, F_INVERSE, F_INVISIBLE, F_ITALIC, type Drawn, type Row } from "../screen.ts"
import type { Picture } from "../vt.ts"
import { blend, G_BOLD, G_ITALIC, type Metrics } from "./glyphs.ts"

export type Mark = { y: number; x1: number; x2: number; color: number; alpha: number; border?: number }
export type Frame = {
  rows: Row[]; cols: number
  /** The terminal's own colours. */
  fg: number; bg: number
  /** No ground drawn (translucent pages): the pane shows through. */
  clear: boolean
  selection: { color: number; alpha: number }
  cursor: { x: number; y: number; style: "block" | "bar" | "underline" | "outline"; color: number; accent: number } | null
  /** Search matches lit (viewport rows), drawn under the text. */
  marks: Mark[]
  /** A link under the pointer: underlined. */
  links: { y: number; x1: number; x2: number }[]
  scrollbar: { top: number; height: number; alpha: number; color: number; marks: { at: number; color: number }[] } | null
  /** What an input method is composing, drawn at the cursor. */
  preedit: string
  /** Kitty graphics pictures, in drawing order (layer, then z), and their pixels by image id (read once per
   *  generation: renderers keep what they made of them, keyed by id and generation). */
  pictures: Drawn[]
  picture: (id: number) => Picture | null
}

export interface Renderer {
  readonly kind: "webgl" | "canvas"
  readonly canvas: HTMLCanvasElement
  /** The canvas `width` by `height` device pixels, cells `m`. */
  resize(width: number, height: number, m: Metrics): void
  draw(f: Frame): void
  dispose(): void
}

/** A cell's text colour and ground (-1: the terminal's own ground), with inverse, faint and invisible applied. */
export function colorsOf(f: Frame, row: Row, c: number): [number, number, number] {
  const fl = row.flags[c]
  let fg = row.fg[c] < 0 ? f.fg : row.fg[c], bg = row.bg[c]
  if (fl & F_INVERSE) { const b = bg < 0 ? f.bg : bg; bg = fg; fg = b }
  if (fl & F_FAINT) fg = blend(fg, bg < 0 ? f.bg : bg, 0.5)
  return [fg, bg, fl & F_INVISIBLE ? 0 : 1]
}
export const styleOf = (fl: number) => (fl & F_BOLD ? G_BOLD : 0) | (fl & F_ITALIC ? G_ITALIC : 0)

/** Underline and strike positions in a cell (device pixels from its top) and the line width. */
export function lines(m: Metrics) {
  const lw = Math.max(1, Math.round(m.dpr))
  return { lw, under: Math.min(m.h - lw, m.baseline + lw), strike: Math.round(m.baseline - m.size * m.dpr * 0.3) }
}

/** Curly, dotted and dashed underlines drawn into a cell-sized slot (white; tinted when drawn). */
export function underlineShape(style: number, m: Metrics) {
  const { lw, under } = lines(m)
  return (g: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D, x: number, y: number, w: number) => {
    if (style === 3) {
      const amp = Math.max(1, Math.round(lw * 1.2))
      g.save(); g.strokeStyle = g.fillStyle as string; g.lineWidth = lw; g.beginPath()
      for (let i = 0; i <= w; i++) { const yy = y + under - amp + amp * Math.cos((i / w) * Math.PI * 2) * -1 + lw / 2; if (i) g.lineTo(x + i, yy); else g.moveTo(x, yy) }
      g.stroke(); g.restore()
    } else if (style === 4) for (let i = 0; i < w; i += lw * 2) g.fillRect(x + i, y + under, lw, lw)
    else if (style === 5) { const d = Math.max(2, Math.round(w / 4)); g.fillRect(x, y + under, d, lw); g.fillRect(x + d * 2, y + under, d, lw) }
  }
}

/** A picture's pixels as RGBA (`premultiplied`: WebGL's blending; ImageData's is straight). */
export function rgba(p: Picture, premultiplied: boolean) {
  const n = p.width * p.height, src = p.data, out = new Uint8ClampedArray(n * 4)
  const ch = p.format === "rgba" ? 4 : p.format === "rgb" ? 3 : p.format === "gray_alpha" ? 2 : 1
  if (src.length < n * ch) return null
  for (let i = 0, j = 0; i < n; i++, j += ch) {
    const g = ch <= 2, a = ch === 4 ? src[j + 3] : ch === 2 ? src[j + 1] : 255
    const r = src[j], gg = g ? r : src[j + 1], b = g ? r : src[j + 2], o = i * 4
    if (a === 255 || !premultiplied) { out[o] = r; out[o + 1] = gg; out[o + 2] = b } else { out[o] = (r * a + 127) / 255; out[o + 1] = (gg * a + 127) / 255; out[o + 2] = (b * a + 127) / 255 }
    out[o + 3] = a
  }
  return out
}
/** Where a picture is drawn (device px) and the part of the grid it may cover (the screen: no rows above or below). */
export function placeOf(d: Drawn, w: number, h: number, rows: number, cols: number) {
  return { x: d.col * w + d.dx, y: d.row * h + d.dy, w: d.width, h: d.height, clip: { x: 0, y: 0, w: cols * w, h: rows * h } }
}
