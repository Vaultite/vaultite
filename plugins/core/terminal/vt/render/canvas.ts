// Canvas2D: the same frame drawn with fillText, for translucent pages (WebGL draws text on a see-through ground thin
// and ragged) and where WebGL2 is missing or its context was lost.
import { F_OVERLINE, F_STRIKE, F_UNDERLINE, F_WIDE, UL_SHIFT } from "../screen.ts"
import { drawBox, isBox } from "./boxdraw.ts"
import { colorsOf, lines, styleOf, underlineShape, type Frame, type Renderer } from "./frame.ts"
import { css, G_BOLD, G_ITALIC, type Metrics } from "./glyphs.ts"

export class CanvasRenderer implements Renderer {
  readonly kind = "canvas"
  canvas: HTMLCanvasElement
  private g: CanvasRenderingContext2D
  private m: Metrics | null = null
  private fonts: string[] = []

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    this.g = canvas.getContext("2d", { alpha: true })!
  }
  resize(width: number, height: number, m: Metrics) {
    if (this.canvas.width !== width) this.canvas.width = width
    if (this.canvas.height !== height) this.canvas.height = height
    this.m = m
    this.fonts = [0, 1, 2, 3].map((s) => `${s & G_ITALIC ? "italic " : ""}${s & G_BOLD ? "bold " : ""}${m.size * m.dpr}px ${m.font}`)
  }
  draw(f: Frame) {
    const m = this.m, g = this.g
    if (!m) return
    const { w, h, baseline } = m, { lw, under, strike } = lines(m)
    g.setTransform(1, 0, 0, 1, 0, 0)
    g.clearRect(0, 0, this.canvas.width, this.canvas.height)
    if (!f.clear) { g.fillStyle = css(f.bg); g.fillRect(0, 0, this.canvas.width, this.canvas.height) }
    g.textBaseline = "alphabetic"
    let font = -1
    const text = (s: string, style: number, x: number, y: number, cells: number, color: number) => {
      g.fillStyle = css(color)
      if (isBox(s)) { drawBox(g, s, x, y, w * cells, h, m.dpr); return }
      if (font !== style) { g.font = this.fonts[style]; font = style }
      g.fillText(s, x, y + baseline)
    }
    for (let y = 0; y < f.rows.length; y++) {
      const row = f.rows[y]
      if (!row) continue
      const top = y * h
      for (let c = 0; c < f.cols; c++) {
        const bg = colorsOf(f, row, c)[1]
        if (bg >= 0) { g.fillStyle = css(bg); g.fillRect(c * w, top, w * (row.flags[c] & F_WIDE ? 2 : 1), h) }
      }
      if (row.sel) { g.fillStyle = css(f.selection.color, f.selection.alpha); g.fillRect(row.sel[0] * w, top, (row.sel[1] - row.sel[0] + 1) * w, h) }
    }
    for (const k of f.marks) {
      g.fillStyle = css(k.color, k.alpha); g.fillRect(k.x1 * w, k.y * h, (k.x2 - k.x1 + 1) * w, h)
      if (k.border !== undefined) { g.strokeStyle = css(k.border); g.lineWidth = lw; g.strokeRect(k.x1 * w + lw / 2, k.y * h + lw / 2, (k.x2 - k.x1 + 1) * w - lw, h - lw) }
    }
    for (let y = 0; y < f.rows.length; y++) {
      const row = f.rows[y]
      if (!row) continue
      const top = y * h
      for (let c = 0; c < f.cols; c++) {
        const [fg, , visible] = colorsOf(f, row, c), fl = row.flags[c], cells = fl & F_WIDE ? 2 : 1, s = row.text[c]
        if (s && s !== " " && visible) text(s, styleOf(fl), c * w, top, cells, fg)
        const ul = (fl & F_UNDERLINE) >> UL_SHIFT
        if (ul) {
          g.fillStyle = css(row.ul[c] >= 0 ? row.ul[c] : fg)
          if (ul === 1) g.fillRect(c * w, top + under, w * cells, lw)
          else if (ul === 2) { g.fillRect(c * w, top + under - lw, w * cells, lw); g.fillRect(c * w, top + Math.min(h - lw, under + lw), w * cells, lw) }
          else for (let k = 0; k < cells; k++) underlineShape(ul, m)(g, (c + k) * w, top, w)
        }
        g.fillStyle = css(fg)
        if (fl & F_STRIKE) g.fillRect(c * w, top + strike, w * cells, lw)
        if (fl & F_OVERLINE) g.fillRect(c * w, top, w * cells, lw)
      }
    }
    for (const k of f.links) {
      const row = f.rows[k.y]
      for (let c = k.x1; c <= k.x2 && row; c++) { g.fillStyle = css(colorsOf(f, row, c)[0]); g.fillRect(c * w, k.y * h + under, w, lw) }
    }
    const cur = f.cursor
    if (cur && f.rows[cur.y]) {
      const row = f.rows[cur.y], cx = cur.x * w, cy = cur.y * h, cells = row.flags[cur.x] & F_WIDE ? 2 : 1
      if (f.preedit) {
        let x = cx
        for (const ch of f.preedit) {
          if (!f.clear) { g.fillStyle = css(f.bg); g.fillRect(x, cy, w, h) } else g.clearRect(x, cy, w, h)
          text(ch, 0, x, cy, 1, f.fg)
          g.fillRect(x, cy + under, w, lw)
          x += w
        }
      } else if (cur.style === "block") {
        g.fillStyle = css(cur.color); g.fillRect(cx, cy, w * cells, h)
        const s = row.text[cur.x]
        if (s) text(s, styleOf(row.flags[cur.x]), cx, cy, cells, cur.accent)
      } else {
        g.fillStyle = css(cur.color)
        if (cur.style === "outline") { g.strokeStyle = css(cur.color); g.lineWidth = lw; g.strokeRect(cx + lw / 2, cy + lw / 2, w * cells - lw, h - lw) }
        else if (cur.style === "bar") g.fillRect(cx, cy, lw, h)
        else g.fillRect(cx, cy + h - lw, w * cells, lw)
      }
    }
    const sb = f.scrollbar
    if (sb && sb.alpha > 0) {
      const W = this.canvas.width, H = this.canvas.height, bw = Math.round(6 * m.dpr)
      for (const k of sb.marks) { g.fillStyle = css(k.color); g.fillRect(W - Math.round(4 * m.dpr), Math.round(k.at * H), Math.round(4 * m.dpr), Math.max(lw * 2, 2)) }
      g.fillStyle = css(sb.color, sb.alpha)
      g.fillRect(W - bw - Math.round(2 * m.dpr), Math.round(sb.top * H), bw, Math.max(Math.round(sb.height * H), bw * 3))
    }
  }
  dispose() { this.canvas.width = this.canvas.height = 0 }
}
