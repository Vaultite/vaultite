// Box drawing and block characters drawn as shapes filling their cell exactly (after xterm.js's custom glyphs, MIT,
// NOTICE): a font's would leave seams between rows and columns in borders like Claude Code's.

/** Each line character from U+2500 to U+257F (dashes and arcs apart): its up, right, down and left arms, as
 *  0 none, 1 light, 2 heavy, 3 double. */
const ARMS = "0101020210102020000000000000000000000000000000000110021001200220" + "0011001200210022110012002100220010011002200120021110121021101120"
  + "2120221012202220101110122011102120212012102220220111011202110212" + "0121012202210222110111021201120221012102220122021111111212111212"
  + "2111112121212112221111221221221212222122222122220000000000000000" + "0303303003100130033000130031003313003100330010033001300313103130"
  + "3330101330313033031301310333130331013303131331313333000000000000" + "0000000000000000000110000100001000022000020000200201102001022010"

const arms = (cp: number) => {
  const i = (cp - 0x2500) * 4
  return [0, 1, 2, 3].map((k) => +ARMS[i + k]) as [number, number, number, number]
}

export function drawBox(g: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, ch: string, x: number, y: number, w: number, h: number, dpr: number): boolean {
  const cp = ch.codePointAt(0)!
  if (ch.length > 2 || cp < 0x2500 || cp > 0x259f) return false
  const light = Math.max(1, Math.round(dpr)), heavy = Math.max(light + 1, light * 2)
  const cx = x + Math.floor(w / 2), cy = y + Math.floor(h / 2)
  const rect = (a: number, b: number, c: number, d: number) => { if (c > 0 && d > 0) g.fillRect(a, b, c, d) }
  if (cp >= 0x2580) {
    const eighthsH = (n: number) => Math.round((h * n) / 8), eighthsW = (n: number) => Math.round((w * n) / 8)
    if (cp === 0x2580) return rect(x, y, w, eighthsH(4)), true
    if (cp >= 0x2581 && cp <= 0x2588) { const n = cp - 0x2580, t = eighthsH(n); return rect(x, y + h - t, w, t), true }
    if (cp >= 0x2589 && cp <= 0x258f) return rect(x, y, eighthsW(0x2590 - cp), h), true
    if (cp === 0x2590) { const l = eighthsW(4); return rect(x + l, y, w - l, h), true }
    if (cp >= 0x2591 && cp <= 0x2593) {
      const p = Math.max(1, Math.round(dpr))
      for (let j = 0; j * p < h; j++) for (let i = 0; i * p < w; i++) {
        const on = cp === 0x2591 ? i % 2 === 0 && j % 2 === 0 : cp === 0x2592 ? (i + j) % 2 === 0 : !(i % 2 === 0 && j % 2 === 0)
        if (on) rect(x + i * p, y + j * p, Math.min(p, w - i * p), Math.min(p, h - j * p))
      }
      return true
    }
    if (cp === 0x2594) return rect(x, y, w, eighthsH(1)), true
    if (cp === 0x2595) { const t = eighthsW(1); return rect(x + w - t, y, t, h), true }
    const q = { 0x2596: 4, 0x2597: 8, 0x2598: 1, 0x2599: 13, 0x259a: 9, 0x259b: 7, 0x259c: 11, 0x259d: 2, 0x259e: 6, 0x259f: 14 }[cp] ?? 0
    const mw = Math.round(w / 2), mh = Math.round(h / 2)
    if (q & 1) rect(x, y, mw, mh)
    if (q & 2) rect(x + mw, y, w - mw, mh)
    if (q & 4) rect(x, y + mh, mw, h - mh)
    if (q & 8) rect(x + mw, y + mh, w - mw, h - mh)
    return true
  }
  const dash: Record<number, [boolean, number, number]> = { 0x2504: [true, 3, 1], 0x2505: [true, 3, 2], 0x2506: [false, 3, 1], 0x2507: [false, 3, 2],
    0x2508: [true, 4, 1], 0x2509: [true, 4, 2], 0x250a: [false, 4, 1], 0x250b: [false, 4, 2], 0x254c: [true, 2, 1], 0x254d: [true, 2, 2], 0x254e: [false, 2, 1], 0x254f: [false, 2, 2] }
  const d = dash[cp]
  if (d) {
    const [across, n, weight] = d, t = weight === 2 ? heavy : light, len = across ? w : h, step = len / n, gap = Math.max(1, Math.round(step / 3))
    for (let i = 0; i < n; i++) {
      const a = Math.round(i * step), b = Math.round((i + 1) * step) - gap
      if (across) rect(x + a, cy - Math.floor(t / 2), b - a, t); else rect(cx - Math.floor(t / 2), y + a, t, b - a)
    }
    return true
  }
  if (cp >= 0x256d && cp <= 0x2570) {
    const t = light, r = Math.min(Math.floor(w / 2), Math.floor(h / 2)), px = cx - Math.floor(t / 2) + t / 2, py = cy - Math.floor(t / 2) + t / 2
    g.save()
    g.strokeStyle = g.fillStyle as string
    g.lineWidth = t
    g.beginPath()
    const [vy, hx] = cp === 0x256d ? [y + h, x + w] : cp === 0x256e ? [y + h, x] : cp === 0x256f ? [y, x] : [y, x + w]
    const sy = vy > py ? 1 : -1, sx = hx > px ? 1 : -1
    g.moveTo(px, vy)
    g.lineTo(px, py + sy * r)
    g.arcTo(px, py, px + sx * r, py, r)
    g.lineTo(hx, py)
    g.stroke()
    g.restore()
    return true
  }
  if (cp >= 0x2571 && cp <= 0x2573) {
    g.save()
    g.strokeStyle = g.fillStyle as string
    g.lineWidth = light
    g.beginPath()
    if (cp !== 0x2572) { g.moveTo(x + w, y); g.lineTo(x, y + h) }
    if (cp !== 0x2571) { g.moveTo(x, y); g.lineTo(x + w, y + h) }
    g.stroke()
    g.restore()
    return true
  }
  const [u, r, dn, l] = arms(cp)
  if (!(u || r || dn || l)) return false
  const gap = Math.max(light, Math.round(w / 6))
  const thick = (k: number) => (k === 2 ? heavy : light)
  const half = (k: number) => Math.floor(thick(k) / 2)
  const across = (a: number, b: number) => Math.max(a && a !== 3 ? thick(a) : 0, b && b !== 3 ? thick(b) : 0)
  const fl = Math.floor(light / 2)
  const single = (k: number, horizontal: boolean, toEnd: boolean) => {
    const t = thick(k), c = horizontal ? cy : cx, mid = horizontal ? cx : cy, lo = mid - half(k)
    const p = horizontal ? across(u, dn) : across(l, r), meetsDouble = horizontal ? (u === 3 || dn === 3) : (l === 3 || r === 3)
    const pLo = p ? mid - Math.floor(p / 2) : lo, pHi = p ? pLo + p : lo + t
    const from = toEnd ? (meetsDouble ? mid + gap - fl : Math.min(lo, pLo)) : (horizontal ? x : y)
    const to = toEnd ? (horizontal ? x + w : y + h) : (meetsDouble ? mid - gap - fl + light : Math.max(lo + t, pHi))
    if (horizontal) rect(from, c - half(k), to - from, t); else rect(c - half(k), from, t, to - from)
  }
  const double = (dir: "u" | "r" | "d" | "l") => {
    const horizontal = dir === "r" || dir === "l"
    const sides: ["u" | "d" | "l" | "r", "u" | "d" | "l" | "r"] = horizontal ? ["u", "d"] : ["l", "r"]
    const armOf = { u, r, d: dn, l }
    for (const [i, side] of sides.entries()) {
      const offset = (i === 0 ? -gap : gap) - Math.floor(light / 2)
      const opposite = sides[1 - i]
      const start = armOf[side] === 3 ? gap : armOf[opposite] === 3 ? -gap : armOf[side] || armOf[opposite] ? -gap : 0
      if (horizontal) {
        const yy = cy + offset
        if (dir === "r") rect(cx + start - fl, yy, x + w - cx - start + fl, light); else rect(x, yy, cx - start - fl + light - x, light)
      } else {
        const xx = cx + offset
        if (dir === "d") rect(xx, cy + start - fl, light, y + h - cy - start + fl); else rect(xx, y, light, cy - start - fl + light - y)
      }
    }
  }
  if (u) u === 3 ? double("u") : single(u, false, false)
  if (dn) dn === 3 ? double("d") : single(dn, false, true)
  if (l) l === 3 ? double("l") : single(l, true, false)
  if (r) r === 3 ? double("r") : single(r, true, true)
  return true
}

export const isBox = (ch: string) => { const cp = ch.codePointAt(0)!; return ch.length === 1 && cp >= 0x2500 && cp <= 0x259f && (cp >= 0x2580 || cp >= 0x256d || +ARMS[(cp - 0x2500) * 4] + +ARMS[(cp - 0x2500) * 4 + 1] + +ARMS[(cp - 0x2500) * 4 + 2] + +ARMS[(cp - 0x2500) * 4 + 3] > 0 || [0x2504, 0x2505, 0x2506, 0x2507, 0x2508, 0x2509, 0x250a, 0x250b, 0x254c, 0x254d, 0x254e, 0x254f].includes(cp)) }
