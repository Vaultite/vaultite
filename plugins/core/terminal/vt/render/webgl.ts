// WebGL2: every frame, rectangles (grounds, selection, lines, the cursor) and glyphs from the atlas, each kind one
// instanced draw (after ghostty-web's renderer, MIT, NOTICE). Its context lost, the terminal draws with canvas.ts.
import { F_INVERSE, F_OVERLINE, F_STRIKE, F_UNDERLINE, F_WIDE, UL_SHIFT } from "../screen.ts"
import { colorsOf, lines, placeOf, rgba, styleOf, underlineShape, type Frame, type Mark, type Renderer } from "./frame.ts"
import { acquireAtlas, blend, releaseAtlas, type Atlas, type Glyph, type Metrics } from "./glyphs.ts"

const RECT_VS = `#version 300 es
layout(location=0) in vec2 a_unit; layout(location=1) in vec4 a_rect; layout(location=2) in vec4 a_color;
uniform vec2 u_size; out vec4 v_color;
void main() { vec2 p = a_rect.xy + a_unit * a_rect.zw; gl_Position = vec4(p / u_size * vec2(2.0, -2.0) + vec2(-1.0, 1.0), 0.0, 1.0); v_color = a_color; }`
const RECT_FS = `#version 300 es
precision mediump float; in vec4 v_color; out vec4 o; void main() { o = v_color; }`
const GLYPH_VS = `#version 300 es
layout(location=0) in vec2 a_unit; layout(location=1) in vec4 a_rect; layout(location=2) in vec4 a_color; layout(location=3) in vec4 a_uv;
uniform vec2 u_size; uniform float u_atlasSize; out vec4 v_color; out vec2 v_uv; out float v_kind;
void main() { vec2 p = a_rect.xy + a_unit * abs(a_rect.zw); gl_Position = vec4(p / u_size * vec2(2.0, -2.0) + vec2(-1.0, 1.0), 0.0, 1.0);
  v_color = a_color; v_uv = (a_uv.xy + a_unit * a_uv.zw) / u_atlasSize; v_kind = a_rect.z < 0.0 ? 1.0 : 0.0; }`
const GLYPH_FS = `#version 300 es
precision mediump float; uniform sampler2D u_atlas; in vec4 v_color; in vec2 v_uv; in float v_kind; out vec4 o;
void main() { vec4 t = texture(u_atlas, v_uv); o = v_kind > 0.5 ? t * v_color.a : v_color * t.a; }`

const PICTURE_VS = `#version 300 es
layout(location=0) in vec2 a_unit; uniform vec2 u_size; uniform vec4 u_rect; uniform vec4 u_uv; out vec2 v_uv;
void main() { vec2 p = u_rect.xy + a_unit * u_rect.zw; gl_Position = vec4(p / u_size * vec2(2.0, -2.0) + vec2(-1.0, 1.0), 0.0, 1.0); v_uv = u_uv.xy + a_unit * u_uv.zw; }`
const PICTURE_FS = `#version 300 es
precision mediump float; uniform sampler2D u_pic; in vec2 v_uv; out vec4 o; void main() { o = texture(u_pic, v_uv); }`

/** Instances, grown as needed: rects are x, y, w, h, r, g, b, a; glyphs add the atlas rect. */
class Batch {
  data: Float32Array
  n = 0
  stride: number
  constructor(stride: number) { this.stride = stride; this.data = new Float32Array(stride * 1024) }
  room() { if ((this.n + 1) * this.stride > this.data.length) { const d = new Float32Array(this.data.length * 2); d.set(this.data); this.data = d } }
}

export class WebglRenderer implements Renderer {
  readonly kind = "webgl"
  canvas: HTMLCanvasElement
  private gl: WebGL2RenderingContext
  private rectProg: WebGLProgram; private glyphProg: WebGLProgram; private picProg: WebGLProgram
  /** Pictures drawn lately as textures, by image id and generation, most recent last (null: too big to be one). */
  private pics = new Map<string, { tex: WebGLTexture | null; w: number; h: number }>()
  private vao: WebGLVertexArrayObject; private unit: WebGLBuffer; private inst: WebGLBuffer
  private tex: WebGLTexture
  private atlas: Atlas | null = null
  private generation = -1
  private uploaded = 0
  private m: Metrics | null = null
  private ground = new Batch(8); private glyphs = new Batch(12); private over = new Batch(8); private top = new Batch(12)
  lost = false
  private sizeAt = new Map<WebGLProgram, WebGLUniformLocation>()

  constructor(canvas: HTMLCanvasElement, onLost: () => void) {
    this.canvas = canvas
    const gl = canvas.getContext("webgl2", { alpha: true, antialias: false, depth: false, stencil: false, premultipliedAlpha: true, preserveDrawingBuffer: false })
    if (!gl) throw new Error("no WebGL2")
    this.gl = gl
    canvas.addEventListener("webglcontextlost", (e) => { e.preventDefault(); if (this.lost) return; this.lost = true; onLost() }, { once: true })
    const prog = (vs: string, fs: string) => {
      const p = gl.createProgram()!
      for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]] as const) {
        const s = gl.createShader(type)!
        gl.shaderSource(s, src); gl.compileShader(s)
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) throw new Error(`terminal shader: ${gl.getShaderInfoLog(s)}`)
        gl.attachShader(p, s)
      }
      gl.linkProgram(p)
      return p
    }
    this.rectProg = prog(RECT_VS, RECT_FS); this.glyphProg = prog(GLYPH_VS, GLYPH_FS); this.picProg = prog(PICTURE_VS, PICTURE_FS)
    this.vao = gl.createVertexArray()!
    gl.bindVertexArray(this.vao)
    this.unit = gl.createBuffer()!
    gl.bindBuffer(gl.ARRAY_BUFFER, this.unit)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
    this.inst = gl.createBuffer()!
    this.tex = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, this.tex)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true)
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
  }

  resize(width: number, height: number, m: Metrics) {
    if (this.canvas.width !== width) this.canvas.width = width
    if (this.canvas.height !== height) this.canvas.height = height
    if (!this.m || this.m.w !== m.w || this.m.h !== m.h || this.m.font !== m.font || this.m.size !== m.size || this.m.dpr !== m.dpr || this.m.baseline !== m.baseline) {
      if (this.atlas) releaseAtlas(this.atlas)
      this.atlas = acquireAtlas(m); this.generation = -1
    }
    this.m = m
  }

  private rect(b: Batch, x: number, y: number, w: number, h: number, c: number, a = 1) {
    b.room()
    const d = b.data, i = b.n++ * b.stride
    d[i] = x; d[i + 1] = y; d[i + 2] = w; d[i + 3] = h
    d[i + 4] = ((c >> 16) & 255) / 255 * a; d[i + 5] = ((c >> 8) & 255) / 255 * a; d[i + 6] = (c & 255) / 255 * a; d[i + 7] = a
    if (b.stride === 12) d[i + 8] = d[i + 9] = d[i + 10] = d[i + 11] = 0
  }
  private glyph(b: Batch, g: Glyph, x: number, y: number, c: number, a = 1) {
    b.room()
    const d = b.data, i = b.n++ * b.stride, pad = this.atlas!.pad
    d[i] = x - pad + g.ox; d[i + 1] = y - pad + g.oy; d[i + 2] = g.color ? -g.w : g.w; d[i + 3] = g.h
    d[i + 4] = ((c >> 16) & 255) / 255 * a; d[i + 5] = ((c >> 8) & 255) / 255 * a; d[i + 6] = (c & 255) / 255 * a; d[i + 7] = a
    d[i + 8] = g.x; d[i + 9] = g.y; d[i + 10] = g.w; d[i + 11] = g.h
  }

  draw(f: Frame) {
    const atlas = this.atlas, gen = atlas?.generation
    this.build(f)
    // (the atlas started again while this frame was laid out: its first glyphs are gone, so it's laid out again)
    if (atlas && atlas.generation !== gen) this.build(f)
    this.flush(f)
  }
  private build(f: Frame) {
    const gl = this.gl, m = this.m, atlas = this.atlas
    if (!m || !atlas || this.lost || gl.isContextLost()) return
    const { w, h } = m, { lw, under, strike } = lines(m)
    for (const b of [this.ground, this.glyphs, this.over, this.top]) b.n = 0
    const sel = f.selection
    // Marks by row: a cell's ground is its own, the selection's over it, or a match's.
    const marks = new Map<number, Mark[]>()
    for (const k of f.marks) marks.set(k.y, [...(marks.get(k.y) ?? []), k])
    for (let y = 0; y < f.rows.length; y++) {
      const row = f.rows[y]
      if (!row) continue
      const top = y * h, rowMarks = marks.get(y)
      const { text: texts, bg: grounds, flags } = row
      for (let c = 0; c < f.cols; c++) {
        // (most cells are blank on the terminal's own ground: nothing to draw)
        if (texts[c] === " " && grounds[c] < 0 && !(flags[c] & (F_INVERSE | F_UNDERLINE | F_STRIKE | F_OVERLINE)) && !row.sel && !rowMarks) continue
        let [fg, bg, visible] = colorsOf(f, row, c)
        const fl = row.flags[c], cells = fl & F_WIDE ? 2 : 1
        if (row.sel && c >= row.sel[0] && c <= row.sel[1]) bg = blend(bg < 0 ? f.bg : bg, sel.color, sel.alpha)
        const mark = rowMarks?.find((k) => c >= k.x1 && c <= k.x2)
        if (mark) bg = mark.color
        if (bg >= 0) this.rect(this.ground, c * w, top, w * cells, h, bg)
        const text = row.text[c]
        if (text !== " " && text && visible) {
          const g = atlas.get(text, styleOf(fl), cells, fg, bg < 0 ? f.bg : bg)
          if (g) this.glyph(this.glyphs, g, c * w, top, fg)
        }
        const ul = (fl & F_UNDERLINE) >> UL_SHIFT
        if (ul) {
          const uc = row.ul[c] >= 0 ? row.ul[c] : fg
          if (ul === 1) this.rect(this.over, c * w, top + under, w * cells, lw, uc)
          else if (ul === 2) { this.rect(this.over, c * w, top + under - lw, w * cells, lw, uc); this.rect(this.over, c * w, top + Math.min(h - lw, under + lw), w * cells, lw, uc) }
          else { const s = atlas.shape(`ul${ul}`, underlineShape(ul, m)); for (let k = 0; k < cells; k++) this.glyph(this.glyphs, s, (c + k) * w, top, uc) }
        }
        if (fl & F_STRIKE) this.rect(this.over, c * w, top + strike, w * cells, lw, fg)
        if (fl & F_OVERLINE) this.rect(this.over, c * w, top, w * cells, lw, fg)
      }
    }
    for (const k of f.marks) if (k.border !== undefined) this.outline(this.over, k.x1 * w, k.y * h, (k.x2 - k.x1 + 1) * w, h, lw, k.border)
    for (const k of f.links) {
      const row = f.rows[k.y]
      for (let c = k.x1; c <= k.x2 && row; c++) this.rect(this.over, c * w, k.y * h + under, w, lw, colorsOf(f, row, c)[0])
    }
    const cur = f.cursor
    if (cur && f.rows[cur.y]) {
      const row = f.rows[cur.y], cx = cur.x * w, cy = cur.y * h, cells = row.flags[cur.x] & F_WIDE ? 2 : 1
      if (f.preedit) {
        // (what the input method composes, over the cursor, underlined)
        let x = cx
        for (const ch of f.preedit) {
          const g = atlas.get(ch, 0, 1, f.fg, f.bg)
          this.rect(this.top, x, cy, w, h, f.bg)
          if (g) this.glyph(this.top, g, x, cy, f.fg)
          this.rect(this.top, x, cy + under, w, lw, f.fg)
          x += w
        }
      } else if (cur.style === "block") {
        this.rect(this.top, cx, cy, w * cells, h, cur.color)
        const text = row.text[cur.x], g = text && text !== " " ? atlas.get(text, styleOf(row.flags[cur.x]), cells, cur.accent, cur.color) : null
        if (g) this.glyph(this.top, g, cx, cy, cur.accent)
      } else if (cur.style === "outline") this.outline(this.top, cx, cy, w * cells, h, lw, cur.color)
      else if (cur.style === "bar") this.rect(this.top, cx, cy, lw, h, cur.color)
      else this.rect(this.top, cx, cy + h - lw, w * cells, lw, cur.color)
    }
    const sb = f.scrollbar
    if (sb && sb.alpha > 0) {
      const W = this.canvas.width, H = this.canvas.height, bw = Math.round(6 * m.dpr), x = W - bw - Math.round(2 * m.dpr)
      for (const k of sb.marks) this.rect(this.top, W - Math.round(4 * m.dpr), Math.round(k.at * H), Math.round(4 * m.dpr), Math.max(lw * 2, 2), k.color, 1)
      this.rect(this.top, x, Math.round(sb.top * H), bw, Math.max(Math.round(sb.height * H), bw * 3), sb.color, sb.alpha)
    }
  }
  private flush(f: Frame) {
    const gl = this.gl, m = this.m, atlas = this.atlas
    if (!m || !atlas || this.lost || gl.isContextLost()) return
    gl.viewport(0, 0, this.canvas.width, this.canvas.height)
    const a = f.clear ? 0 : 1
    gl.clearColor(((f.bg >> 16) & 255) / 255 * a, ((f.bg >> 8) & 255) / 255 * a, (f.bg & 255) / 255 * a, a)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.bindTexture(gl.TEXTURE_2D, this.tex)
    if (this.generation !== atlas.generation) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlas.canvas as unknown as TexImageSource)
      this.generation = atlas.generation
      this.uploaded = atlas.log.length
    } else if (this.uploaded < atlas.log.length) {
      const g = atlas.canvas.getContext("2d")!
      for (const s of atlas.log.slice(this.uploaded)) gl.texSubImage2D(gl.TEXTURE_2D, 0, s.x, s.y, s.w, s.h, gl.RGBA, gl.UNSIGNED_BYTE, g.getImageData(s.x, s.y, s.w, s.h))
      this.uploaded = atlas.log.length
    }
    gl.bindVertexArray(this.vao)
    this.pictures(f, 0)
    this.pass(this.ground, false)
    this.pictures(f, 1)
    this.pass(this.glyphs, true); this.pass(this.over, false)
    this.pictures(f, 2)
    this.passMixed(this.top)
    this.forget(f)
  }
  /** A layer's pictures, each its part of a texture on a quad, clipped to the grid. */
  private pictures(f: Frame, layer: number) {
    const gl = this.gl, m = this.m!
    let drew = false
    for (const d of f.pictures) {
      if (d.layer !== layer || d.sw <= 0 || d.sh <= 0) continue
      const t = this.texture(f, d)
      if (!t?.tex) continue
      if (!drew) {
        drew = true
        gl.useProgram(this.picProg)
        for (const loc of [1, 2, 3]) gl.disableVertexAttribArray(loc)
        gl.uniform2f(gl.getUniformLocation(this.picProg, "u_size"), this.canvas.width, this.canvas.height)
        gl.enable(gl.SCISSOR_TEST)
      }
      const at = placeOf(d, m.w, m.h, f.rows.length, f.cols)
      gl.scissor(at.clip.x, this.canvas.height - at.clip.y - at.clip.h, at.clip.w, at.clip.h)
      gl.bindTexture(gl.TEXTURE_2D, t.tex)
      gl.uniform4f(gl.getUniformLocation(this.picProg, "u_rect"), at.x, at.y, at.w, at.h)
      gl.uniform4f(gl.getUniformLocation(this.picProg, "u_uv"), d.sx / t.w, d.sy / t.h, d.sw / t.w, d.sh / t.h)
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    }
    if (drew) { gl.disable(gl.SCISSOR_TEST); gl.bindTexture(gl.TEXTURE_2D, this.tex) }
  }
  private texture(f: Frame, d: Frame["pictures"][number]) {
    const gl = this.gl, key = `${d.image}:${d.generation}`
    let t = this.pics.get(key)
    if (t) { this.pics.delete(key); this.pics.set(key, t); return t }
    const p = f.picture(d.image)
    if (!p) return null
    const max = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number, px = p.width <= max && p.height <= max ? rgba(p, true) : null
    t = { tex: null, w: p.width, h: p.height }
    if (px) {
      t.tex = gl.createTexture()!
      gl.bindTexture(gl.TEXTURE_2D, t.tex)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      // (premultiplied already: the atlas' setting would do it twice)
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, p.width, p.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(px.buffer))
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true)
    }
    this.pics.set(key, t)
    return t
  }
  /** Textures of pictures not in this frame freed, past the few kept for coming back (a scroll). */
  private forget(f: Frame) {
    const keep = new Set(f.pictures.map((d) => `${d.image}:${d.generation}`))
    for (const [k, t] of this.pics) if (this.pics.size > keep.size + 4 && !keep.has(k)) { if (t.tex) this.gl.deleteTexture(t.tex); this.pics.delete(k) }
  }
  private outline(b: Batch, x: number, y: number, w: number, h: number, lw: number, c: number) {
    this.rect(b, x, y, w, lw, c); this.rect(b, x, y + h - lw, w, lw, c); this.rect(b, x, y, lw, h, c); this.rect(b, x + w - lw, y, lw, h, c)
  }
  /** The top layer holds both kinds (the cursor's block, then its glyph): drawn in order, a run of one kind at a time. */
  private passMixed(b: Batch) {
    if (!b.n) return
    // (rects were written with stride 12 too: a zero atlas rect marks one)
    let i = 0
    while (i < b.n) {
      const glyph = b.data[i * 12 + 10] > 0
      let j = i
      while (j < b.n && (b.data[j * 12 + 10] > 0) === glyph) j++
      this.passRange(b, i, j, glyph)
      i = j
    }
  }
  private pass(b: Batch, glyph: boolean) { if (b.n) this.passRange(b, 0, b.n, glyph) }
  private passRange(b: Batch, from: number, to: number, glyph: boolean) {
    const gl = this.gl, stride = b.stride * 4
    const p = glyph ? this.glyphProg : this.rectProg
    gl.useProgram(p)
    let at = this.sizeAt.get(p)
    if (!at) { at = gl.getUniformLocation(p, "u_size")!; this.sizeAt.set(p, at) }
    gl.uniform2f(at, this.canvas.width, this.canvas.height)
    if (glyph) gl.uniform1f(gl.getUniformLocation(p, "u_atlasSize"), this.atlas!.size)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.inst)
    gl.bufferData(gl.ARRAY_BUFFER, b.data.subarray(from * b.stride, to * b.stride), gl.STREAM_DRAW)
    const attr = (loc: number, size: number, off: number) => { gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, off * 4); gl.vertexAttribDivisor(loc, 1) }
    attr(1, 4, 0); attr(2, 4, 4)
    if (glyph) attr(3, 4, 8); else gl.disableVertexAttribArray(3)
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, to - from)
  }

  dispose() {
    const gl = this.gl
    this.lost = true
    if (this.atlas) { releaseAtlas(this.atlas); this.atlas = null }
    gl.deleteBuffer(this.unit); gl.deleteBuffer(this.inst); gl.deleteTexture(this.tex); gl.deleteVertexArray(this.vao)
    for (const t of this.pics.values()) if (t.tex) gl.deleteTexture(t.tex)
    this.pics.clear()
    gl.deleteProgram(this.rectProg); gl.deleteProgram(this.glyphProg); gl.deleteProgram(this.picProg)
    gl.getExtension("WEBGL_lose_context")?.loseContext()
  }
}
