// A cell's size, measured as xterm.js did (a screen keeps its columns), and WebGL's glyph atlas: each glyph drawn once
// by Canvas2D in its colour on its ground (on a clear one text reads heavier), the ground then cleared, as xterm.js did.
import { drawBox, isBox } from "./boxdraw.ts"

export type Metrics = {
  /** A cell in device pixels (whole ones, so rows and columns tile without seams) and in CSS pixels. */
  w: number; h: number; cssW: number; cssH: number; dpr: number
  /** Where text's baseline sits in a cell, device pixels from its top. */
  baseline: number
  font: string; size: number
}

export function measure(family: string, size: number, lineHeight: number, dpr: number): Metrics {
  const span = document.createElement("span")
  span.style.cssText = `position:absolute;top:0;left:-9999px;visibility:hidden;white-space:pre;font-family:${family};font-size:${size}px;line-height:normal`
  span.textContent = "W".repeat(32)
  document.body.appendChild(span)
  const width = span.getBoundingClientRect().width / 32, height = span.getBoundingClientRect().height
  span.remove()
  const w = Math.max(1, Math.floor(width * dpr)), charH = Math.ceil(height * dpr), h = Math.max(1, Math.floor(charH * lineHeight))
  const g = new OffscreenCanvas(1, 1).getContext("2d")!
  g.font = `${size * dpr}px ${family}`
  const m = g.measureText("Wg│")
  const asc = m.fontBoundingBoxAscent ?? size * dpr * 0.8, desc = m.fontBoundingBoxDescent ?? size * dpr * 0.2
  return { w, h, cssW: w / dpr, cssH: h / dpr, dpr, baseline: Math.round((h - (asc + desc)) / 2 + asc), font: family, size }
}

/** A slot of the atlas; `color`: drawn as it is (else a white shape, tinted when drawn). */
export type Glyph = { x: number; y: number; w: number; h: number; color: boolean
  /** Where its ink starts in its slot (it's drawn only there: a quad a slot's size each overdraws its neighbours). */
  ox: number; oy: number }

/** Style bits a glyph is drawn in. */
export const G_BOLD = 1, G_ITALIC = 2

/** Atlases by cell and font: terminals drawn alike share one, as xterm.js's did. */
const shared = new Map<string, { atlas: Atlas; users: number }>()
const keyOf = (m: Metrics) => `${m.font}|${m.size}|${m.dpr}|${m.w}x${m.h}|${m.baseline}`
export function acquireAtlas(m: Metrics) {
  const k = keyOf(m), had = shared.get(k)
  if (had) { had.users++; return had.atlas }
  const atlas = new Atlas(m)
  shared.set(k, { atlas, users: 1 })
  return atlas
}
export function releaseAtlas(a: Atlas) {
  const k = keyOf(a.m), had = shared.get(k)
  if (had?.atlas === a && --had.users <= 0) { shared.delete(k); a.canvas.width = a.canvas.height = 0 }
}

/** Glyphs packed in rows of a canvas; each slot a cell (two for wide ones) plus a margin all round for what spills
 *  out of it (italics, accents). Full, it grows once, then starts again (`generation`: renderers upload it whole). */
export class Atlas {
  canvas: OffscreenCanvas
  size = 1024
  private g: OffscreenCanvasRenderingContext2D
  private map = new Map<string, Glyph | null>()
  private x = 0; private y = 0; private rowH = 0
  /** Margin round each slot, device pixels. */
  pad: number
  m: Metrics
  generation = 0
  /** Every slot drawn this generation, in order (each renderer uploads those it hasn't). */
  log: Glyph[] = []

  constructor(m: Metrics) {
    this.m = m
    this.pad = Math.ceil(m.w / 2)
    this.canvas = new OffscreenCanvas(this.size, this.size)
    this.g = this.canvas.getContext("2d", { willReadFrequently: true })!
  }
  private reset() {
    if (this.size < 2048) { this.size = 2048; this.canvas.width = this.canvas.height = this.size }
    else this.g.clearRect(0, 0, this.size, this.size)
    this.map.clear(); this.x = this.y = this.rowH = 0
    this.generation++
    this.log = []
  }
  /** The glyph for `text` in `style`, `cells` wide, in `fg` on `bg` (null: nothing to draw). */
  get(text: string, style: number, cells: number, fg: number, bg: number): Glyph | null {
    const key = `${fg},${bg},${style}${cells}${text}`
    const had = this.map.get(key)
    if (had !== undefined) return had
    const out = this.draw(text, style, cells, fg, bg)
    this.map.set(key, out)
    return out
  }
  /** A special shape (curly underline...) drawn by `paint` into a cell-sized slot. */
  shape(key: string, paint: (g: OffscreenCanvasRenderingContext2D, x: number, y: number, w: number, h: number) => void): Glyph {
    const had = this.map.get(key)
    if (had) return had
    const s = this.slot(1)
    this.g.fillStyle = "#fff"
    paint(this.g, s.x + this.pad, s.y + this.pad, this.m.w, this.m.h)
    const out = { ...s, color: false, ox: 0, oy: 0 }
    this.map.set(key, out)
    this.log.push(out)
    return out
  }
  private slot(cells: number) {
    const w = this.m.w * cells + this.pad * 2, h = this.m.h + this.pad * 2
    if (this.x + w > this.size) { this.x = 0; this.y += this.rowH; this.rowH = 0 }
    if (this.y + h > this.size) this.reset()
    const s = { x: this.x, y: this.y, w, h }
    this.x += w; this.rowH = Math.max(this.rowH, h)
    return s
  }
  private draw(text: string, style: number, cells: number, fg: number, bg: number): Glyph | null {
    if (!text || text === " ") return null
    const s = this.slot(cells), g = this.g, { w, h, dpr, baseline, size, font } = this.m
    const x = s.x + this.pad, y = s.y + this.pad
    g.fillStyle = css(bg)
    g.fillRect(s.x, s.y, s.w, s.h)
    g.fillStyle = css(fg)
    if (isBox(text)) drawBox(g, text, x, y, w * cells, h, dpr)
    else {
      g.save()
      g.beginPath(); g.rect(s.x, s.y, s.w, s.h); g.clip()
      g.font = `${style & G_ITALIC ? "italic " : ""}${style & G_BOLD ? "bold " : ""}${size * dpr}px ${font}`
      g.textBaseline = "alphabetic"
      // (an emoji wider than its cells is drawn narrower, as terminals do)
      const ink = g.measureText(text).width, room = w * cells
      if (ink > room * 1.05 && /\p{Extended_Pictographic}/u.test(text)) { g.translate(x, 0); g.scale(room / ink, 1); g.fillText(text, 0, y + baseline) }
      else g.fillText(text, x, y + baseline)
      g.restore()
    }
    // Its ground made clear: what spills into the cells beside it doesn't cover them.
    const data = g.getImageData(s.x, s.y, s.w, s.h), d = data.data, br = (bg >> 16) & 255, bgg = (bg >> 8) & 255, bb = bg & 255
    let x0 = s.w, y0 = s.h, x1 = -1, y1 = -1
    for (let i = 0; i < d.length; i += 4) {
      if (d[i] === br && d[i + 1] === bgg && d[i + 2] === bb) { d[i + 3] = 0; continue }
      const px = (i >> 2) % s.w, py = (i >> 2) / s.w | 0
      if (px < x0) x0 = px; if (px > x1) x1 = px; if (py < y0) y0 = py; if (py > y1) y1 = py
    }
    if (x1 < 0) return null
    g.putImageData(data, s.x, s.y)
    const out = { x: s.x + x0, y: s.y + y0, w: x1 - x0 + 1, h: y1 - y0 + 1, color: true, ox: x0, oy: y0 }
    this.log.push(out)
    return out
  }
}

/** 0xRRGGBB as CSS. */
export const css = (c: number, a = 1) => (a >= 1 ? `#${(c & 0xffffff).toString(16).padStart(6, "0")}` : `rgba(${(c >> 16) & 255},${(c >> 8) & 255},${c & 255},${a})`)
/** a toward b by t (0..1). */
export const blend = (a: number, b: number, t: number) => {
  const ch = (s: number) => Math.round(((a >> s) & 255) + (((b >> s) & 255) - ((a >> s) & 255)) * t)
  return (ch(16) << 16) | (ch(8) << 8) | ch(0)
}
