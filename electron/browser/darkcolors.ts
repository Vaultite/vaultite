// Dark pages' tint: auto dark's ramp onto the theme's, as CSS filter functions fitted to it (scrolling, they cost the
// page nothing; an SVG matrix ~1 ms of main thread a frame and ~25 MB), the exact matrix only for themes they miss.

/** Auto dark's page background: white pages go #121212, which the tint takes to the theme's background. */
export const AUTO_BG = 18 / 255
const W = [0.2126, 0.7152, 0.0722]
const SAT = 0.9 // (accents a little toward the theme's own muted ones)
type V = [number, number, number]
type M = V[]

const rgb = (hex: string): V => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as V
const clamp = (v: number) => Math.min(1, Math.max(0, v))
const apply = (m: M, x: V, o = 0): V => m.map((r) => clamp(r[0] * x[0] + r[1] * x[1] + r[2] * x[2] + o)) as V
const lum = (v: V) => W[0] * v[0] + W[1] * v[1] + W[2] * v[2]
const I: M = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]
const scale = (k: number): M => I.map((r) => r.map((v) => v * k) as V)
// (the Filter Effects spec's matrices, which Chromium applies one after another, clamping each)
const sepia = (p: number): M => { const q = 1 - p; return [[0.393 + 0.607 * q, 0.769 - 0.769 * q, 0.189 - 0.189 * q], [0.349 - 0.349 * q, 0.686 + 0.314 * q, 0.168 - 0.168 * q], [0.272 - 0.272 * q, 0.534 - 0.534 * q, 0.131 + 0.869 * q]] }
const hue = (deg: number): M => {
  const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a)
  return [[0.213 + c * 0.787 - s * 0.213, 0.715 - c * 0.715 - s * 0.715, 0.072 - c * 0.072 + s * 0.928],
    [0.213 - c * 0.213 + s * 0.143, 0.715 + c * 0.285 + s * 0.140, 0.072 - c * 0.072 - s * 0.283],
    [0.213 - c * 0.213 - s * 0.787, 0.715 - c * 0.715 + s * 0.715, 0.072 + c * 0.928 + s * 0.072]]
}
const saturate = (s: number): M => [[0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s], [0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s], [0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s]]

/** brightness(k0) sepia(p) hue-rotate(h) saturate(s) brightness(k) contrast(c): its parameters in that order. */
type Chain = [number, number, number, number, number, number]
const BOUNDS: [number, number][] = [[0.2, 1], [0, 1], [-180, 180], [0, 3], [0, 4], [0, 2]]
function run([k0, p, h, s, k, c]: Chain, x: V) {
  x = apply(scale(k0), x); x = apply(sepia(p), x); x = apply(hue(h), x); x = apply(saturate(s), x); x = apply(scale(k), x)
  return apply(scale(c), x, 0.5 - 0.5 * c)
}
const css = ([k0, p, h, s, k, c]: Chain) =>
  `brightness(${k0.toFixed(3)}) sepia(${p.toFixed(3)}) hue-rotate(${h.toFixed(1)}deg) saturate(${s.toFixed(3)}) brightness(${k.toFixed(3)}) contrast(${c.toFixed(3)})`

/** The exact map: auto dark's ramp onto the theme's, accents at SAT. */
function exact(bg: V, fg: V, x: V): V {
  const l = lum(x)
  return [0, 1, 2].map((i) => clamp(bg[i] + (l + SAT * (x[i] - l) - AUTO_BG) / (1 - AUTO_BG) * (fg[i] - bg[i]))) as V
}
// (greys weigh most: they're most of a page)
const SAMPLES: V[] = [[AUTO_BG, AUTO_BG, AUTO_BG], [0.25, 0.25, 0.25], [0.5, 0.5, 0.5], [0.75, 0.75, 0.75], [1, 1, 1],
  [0.9, 0.3, 0.3], [0.3, 0.6, 0.95], [0.4, 0.8, 0.4], [0.95, 0.85, 0.3]]
const GREYS = 5
function error(c: Chain, bg: V, fg: V) {
  let e = 0
  c.forEach((v, i) => { const [lo, hi] = BOUNDS[i]; e += Math.max(0, lo - v, v - hi) * 10 })
  SAMPLES.forEach((x, i) => { const a = run(c, x), t = exact(bg, fg, x); e += (i < GREYS ? 4 : 1) * a.reduce((q, v, j) => q + (v - t[j]) ** 2, 0) })
  return e
}
/** The worst a chain is off, out of 255: on greys, on colours. */
function worst(c: Chain, bg: V, fg: V) {
  const off = (xs: V[]) => Math.max(...xs.map((x) => { const a = run(c, x), t = exact(bg, fg, x); return Math.max(...a.map((v, j) => Math.abs(v - t[j]) * 255)) }))
  return [off(SAMPLES.slice(0, GREYS)), off(SAMPLES.slice(GREYS))]
}

/** Nelder-Mead from `start`. */
function refine(f: (c: Chain) => number, start: Chain): Chain {
  const n = start.length, steps = [0.1, 0.1, 10, 0.2, 0.2, 0.1]
  let pts = [start, ...start.map((_, i) => start.map((v, j) => v + (i === j ? steps[i] : 0)) as Chain)].map((p) => ({ p, e: f(p) }))
  for (let it = 0; it < 400; it++) {
    pts.sort((a, b) => a.e - b.e)
    const mid = start.map((_, j) => pts.slice(0, n).reduce((s, x) => s + x.p[j], 0) / n) as Chain
    const at = (t: number) => { const p = mid.map((v, j) => v + t * (v - pts[n].p[j])) as Chain; return { p, e: f(p) } }
    const r = at(1)
    if (r.e < pts[0].e) { const x = at(2); pts[n] = x.e < r.e ? x : r } else if (r.e < pts[n - 1].e) pts[n] = r
    else {
      const k = at(-0.5)
      if (k.e < pts[n].e) pts[n] = k
      else pts = pts.map((x, i) => { if (!i) return x; const p = x.p.map((v, j) => pts[0].p[j] + 0.5 * (v - pts[0].p[j])) as Chain; return { p, e: f(p) } })
    }
  }
  pts.sort((a, b) => a.e - b.e)
  return pts[0].p
}

/** The chain closest to the exact map: its tint's direction from sepia turned by hue-rotate (a coarse search), the
 *  offset from contrast, then refined. */
function fitted(bg: V, fg: V): Chain {
  const k0 = 0.5, off = (bg[0] + bg[1] + bg[2]) / 3 - AUTO_BG * (lum(fg) - lum(bg)) / (1 - AUTO_BG)
  const d = Math.min(0.45, Math.max(0, off)), c = 1 - 2 * d
  const delta = fg.map((x, i) => x - bg[i]) as V, ld = Math.max(lum(delta), 0.05)
  let best: { c: Chain; e: number } | null = null
  for (let p = 0; p <= 1.0001; p += 0.05) {
    const lambda = (1 + 0.215 * p) / ld
    for (let h = -180; h < 180; h += 6) {
      const u = apply(hue(h), [0.5 + 0.1755 * p, 0.5 + 0.1015 * p, 0.5 - 0.0315 * p]), uc = u.map((x) => x - lum(u))
      const want = delta.map((x) => (x - ld) * lambda), uu = uc.reduce((s, x) => s + x * x, 0)
      const s = uu < 1e-9 ? SAT : Math.max(0, Math.min(3, uc.reduce((q, x, i) => q + x * want[i], 0) / uu * 0.5))
      const chain: Chain = [k0, p, h, s, 1 / (c * k0 * lambda * (1 - AUTO_BG)), c]
      const e = error(chain, bg, fg)
      if (!best || e < best.e) best = { c: chain, e }
    }
  }
  return refine((x) => error(x, bg, fg), best!.c)
}

/** An SVG colour matrix, exact (in a data: address, as Chromium takes for a filter). */
function matrix(bg: V, fg: V) {
  const rows = [0, 1, 2].map((i) => {
    const k = (fg[i] - bg[i]) / (1 - AUTO_BG)
    return [...[0, 1, 2].map((j) => k * ((1 - SAT) * W[j] + (i === j ? SAT : 0))), 0, bg[i] - AUTO_BG * k]
  })
  const values = [...rows, [0, 0, 0, 1, 0]].flat().map((v) => +v.toFixed(4)).join(" ")
  const svg = `<svg xmlns="http://www.w3.org/2000/svg"><filter id="t" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="${values}"/></filter></svg>`
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}#t")`
}

const made = new Map<string, string>()
/** The tint for a theme (#rrggbb background and text) as a `filter` value: the fitted functions when they're within a
 *  few levels of exact (greys 6/255, colours 20/255), else the matrix. */
export function tintFilter(bg: string, fg: string) {
  const key = `${bg} ${fg}`, had = made.get(key)
  if (had) return had
  const b = rgb(bg), f = rgb(fg), chain = fitted(b, f), [greys, colours] = worst(chain, b, f)
  const out = greys <= 6 && colours <= 20 ? css(chain) : matrix(b, f)
  if (made.size > 20) made.clear()
  made.set(key, out)
  return out
}
