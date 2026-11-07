// Where a drawing's parts go on one display (no DOM): labels beside what they name, never over it and on screen; cards on
// calm space, clear of what's marked; arrows bent between two things.
import { type Area, CARDS, type Drawing, type Mark, type Media, PAPER, type Rect, rectOf, type Spot } from "../../../plugins/core/companion/screenmarks"

export type Size = { w: number; h: number }
export type Pt = { x: number; y: number }

export const inflate = (r: Rect, d: number): Rect => ({ x: r.x - d, y: r.y - d, w: r.w + d * 2, h: r.h + d * 2 })
export const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
const area = (a: Rect, b: Rect) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y))
export const inside = (r: Rect, b: Rect) => r.x >= b.x && r.y >= b.y && r.x + r.w <= b.x + b.w && r.y + r.h <= b.y + b.h
export const centre = (r: Rect): Pt => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 })
/** `r` moved (not resized, unless it's bigger) to be inside `b`. */
export function clampInto(r: Rect, b: Rect): Rect {
  const w = Math.min(r.w, b.w), h = Math.min(r.h, b.h)
  return { x: Math.min(Math.max(r.x, b.x), b.x + b.w - w), y: Math.min(Math.max(r.y, b.y), b.y + b.h - h), w, h }
}

/** A label of `size` by `target`: right of it (by a tall one's top), else left, below, above, on screen and clear of it
 *  and `taken`; none fits, the one covering least. `away`: a direction to prefer (an arrow's label, off its shaft). */
export function labelAt(target: Rect, size: Size, bounds: Rect, taken: Rect[] = [], gap = 8, away?: Pt): Rect {
  const t = inflate(target, gap), { w, h } = size, cx = target.x + target.w / 2 - w / 2, cy = target.y + target.h / 2 - h / 2, ry = target.h > 90 ? target.y : cy
  let tries: Rect[] = [
    { x: t.x + t.w, y: ry, w, h }, { x: t.x - w, y: ry, w, h }, { x: t.x + t.w, y: cy, w, h }, { x: t.x - w, y: cy, w, h },
    { x: cx, y: t.y + t.h, w, h }, { x: cx, y: t.y - h, w, h },
    { x: target.x, y: t.y + t.h, w, h }, { x: target.x + target.w - w, y: t.y + t.h, w, h }, { x: target.x, y: t.y - h, w, h }, { x: target.x + target.w - w, y: t.y - h, w, h },
    { x: t.x + t.w, y: t.y + t.h, w, h }, { x: t.x - w, y: t.y + t.h, w, h }, { x: t.x + t.w, y: t.y - h, w, h }, { x: t.x - w, y: t.y - h, w, h },
  ]
  // (none fits close by: the same a little farther out)
  const far = inflate(target, gap + 26)
  tries.push({ x: far.x + far.w, y: cy, w, h }, { x: far.x - w, y: cy, w, h }, { x: cx, y: far.y + far.h, w, h }, { x: cx, y: far.y - h, w, h },
    { x: far.x + far.w, y: far.y + far.h, w, h }, { x: far.x - w, y: far.y + far.h, w, h }, { x: far.x + far.w, y: far.y - h, w, h }, { x: far.x - w, y: far.y - h, w, h })
  if (away) {
    const c = centre(target), toward = (r: Rect) => { const d = centre(r), dx = d.x - c.x, dy = d.y - c.y; return (dx * away.x + dy * away.y) / (Math.hypot(dx, dy) || 1) }
    tries = tries.map((r, i) => ({ r, k: Math.round(toward(r) * 4) / 4, i })).sort((a, b) => b.k - a.k || a.i - b.i).map((x) => x.r)
  }
  const clear = (r: Rect) => inside(r, bounds) && !overlaps(r, target) && !taken.some((x) => overlaps(r, x))
  const fit = tries.find(clear)
  if (fit) return fit
  // (a target as big as the screen: inside it, by its top)
  const cost = (r: Rect) => area(r, target) * 4 + taken.reduce((s, x) => s + area(r, x), 0)
  return tries.map((r) => clampInto(r, bounds)).sort((a, b) => cost(a) - cost(b))[0]
}

/** Where a frame's label goes, snug at it as a design tool names a frame: over its top left, else beside its top right, under
 *  its bottom left, beside its top left, over its top right, under its bottom right. */
export const TAB_SIDES = ["above-left", "right-top", "below-left", "left-top", "above-right", "below-right"] as const
export type TabSide = (typeof TAB_SIDES)[number]
const TAB_GAP = 3
export function tabAt(f: Rect, { w, h }: Size, side: TabSide): Rect {
  const left = f.x, right = f.x + f.w - w, above = f.y - h - TAB_GAP, below = f.y + f.h + TAB_GAP
  return side === "above-left" ? { x: left, y: above, w, h } : side === "right-top" ? { x: f.x + f.w + TAB_GAP, y: f.y, w, h }
    : side === "below-left" ? { x: left, y: below, w, h } : side === "left-top" ? { x: f.x - w - TAB_GAP, y: f.y, w, h }
    : side === "above-right" ? { x: right, y: above, w, h } : { x: right, y: below, w, h }
}

/** A frame round `r`, 6 out, but less toward a frame beside it (`frames`' other rects, touching or a little over it): two
 *  side by side, as a sidebar's panels, keep a hairline apart, never overlapping. */
export function frameRect(r: Rect, frames: Rect[]): Rect {
  let l = 6, t = 6, rt = 6, b = 6
  const pad = (gap: number) => Math.max(-8, (gap - 3) / 2)
  // (how far apart along one axis, negative when they overlap there: by a little, still side by side)
  const apart = (a0: number, a1: number, b0: number, b1: number) => (b0 + b1 >= a0 + a1 ? b0 - a1 : a0 - b1)
  for (const o of frames) {
    if (o === r) continue
    const gx = apart(r.x, r.x + r.w, o.x, o.x + o.w), gy = apart(r.y, r.y + r.h, o.y, o.y + o.h), little = (g: number, a: number, c: number) => g > -12 && g > -Math.min(a, c) / 3
    if (gx < 0 && gy < 15 && little(gy, r.h, o.h)) { if (o.y + o.h / 2 > r.y + r.h / 2) b = Math.min(b, pad(gy)); else t = Math.min(t, pad(gy)) }
    else if (gy < 0 && gx < 15 && little(gx, r.w, o.w)) { if (o.x + o.w / 2 > r.x + r.w / 2) rt = Math.min(rt, pad(gx)); else l = Math.min(l, pad(gx)) }
  }
  return { x: r.x - l, y: r.y - t, w: r.w + l + rt, h: r.h + t + b }
}

/** Calm space for a card of `size`: clear of `avoid` (what's on screen, marked, other cards) by a margin, in the emptiest
 *  room (the farthest from all of it, up to `calm`), then nearest `near`; on screen. */
export function calmSpot(size: Size, bounds: Rect, avoid: Rect[], near: Pt, margin = 24, calm = 140, beside: Rect[] = []): Rect {
  // (`beside`: other cards, kept clear of but not counted against the room: cards gather)
  const room0 = avoid.map((r) => inflate(r, margin)), keep = [...room0, ...beside.map((r) => inflate(r, 12))], step = 24, edge = 16
  let best: Rect | null = null, bestScore = -Infinity, least: Rect | null = null, leastA = Infinity, leastD = Infinity
  for (let y = bounds.y + edge; y + size.h <= bounds.y + bounds.h - edge; y += step) {
    for (let x = bounds.x + edge; x + size.w <= bounds.x + bounds.w - edge; x += step) {
      const r = { x, y, ...size }, a = keep.reduce((s, k) => s + area(r, k), 0), c = centre(r), d = Math.hypot(c.x - near.x, c.y - near.y)
      if (a === 0) {
        // (room around it counts first, a step at a time; then being near)
        const room = Math.min(calm, ...room0.map((k) => gapOf(r, k))), score = Math.floor(room / step) * 1e6 - d
        if (score > bestScore) { best = r; bestScore = score }
      }
      if (a < leastA || (a === leastA && d < leastD)) { least = r; leastA = a; leastD = d }
    }
  }
  return best ?? least ?? clampInto({ x: near.x, y: near.y, ...size }, bounds)
}
/** How far apart two rects are (0: touching or overlapping). */
const gapOf = (a: Rect, b: Rect) => Math.hypot(Math.max(0, b.x - (a.x + a.w), a.x - (b.x + b.w)), Math.max(0, b.y - (a.y + a.h), a.y - (b.y + b.h)))

/** Where a curved arrow from `a` to `b` runs: from `a`'s edge to just short of `b`'s, bent to one side. */
export function arrowPath(a: Rect, b: Rect, bounds: Rect) {
  const ca = centre(a), cb = centre(b)
  const p0 = edgeToward(a, cb, 6), p1 = edgeToward(b, ca, 8)
  const dx = p1.x - p0.x, dy = p1.y - p0.y, len = Math.hypot(dx, dy) || 1
  // (bent away from the screen's middle, so it reads as a hand's arc)
  const mid = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 }, nx = -dy / len, ny = dx / len, sc = centre(bounds)
  const side = (mid.x - sc.x) * nx + (mid.y - sc.y) * ny >= 0 ? 1 : -1, bend = Math.min(90, len * 0.2) * side
  const c = { x: mid.x + nx * bend, y: mid.y + ny * bend }
  return { from: p0, to: p1, control: c, mid: { x: (p0.x + 2 * c.x + p1.x) / 4, y: (p0.y + 2 * c.y + p1.y) / 4 } }
}
/** The point of `r`'s edge (out by `gap`) on the way from its centre to `p`. */
export function edgeToward(r: Rect, p: Pt, gap = 0): Pt {
  const c = centre(r), dx = p.x - c.x, dy = p.y - c.y
  if (!dx && !dy) return c
  const hw = r.w / 2 + gap, hh = r.h / 2 + gap, s = Math.min(dx ? hw / Math.abs(dx) : Infinity, dy ? hh / Math.abs(dy) : Infinity)
  return { x: c.x + dx * s, y: c.y + dy * s }
}

/** A pointing arrow at `r`: from the side with room that crosses least of `avoid` (below left first), its tip just off
 *  the thing. */
export function pointArrow(r: Rect, bounds: Rect, avoid: Rect[] = [], len = 64) {
  const dirs = [[-1, 1], [1, 1], [-1, -1], [1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]] as const
  const tries = [1, 1.5].flatMap((k) => dirs.map(([sx, sy]) => {
    const tip = !r.w && !r.h ? { x: r.x + sx * 6, y: r.y + sy * 6 } : { x: sx < 0 ? r.x - 4 : sx > 0 ? r.x + r.w + 4 : r.x + r.w / 2, y: sy < 0 ? r.y - 4 : sy > 0 ? r.y + r.h + 4 : r.y + r.h / 2 }
    return { tip, tail: { x: tip.x + sx * len * k * (sy ? 0.75 : 1), y: tip.y + sy * len * k * (sx ? 0.65 : 1) } }
  }))
  // (what holds the thing itself, as a frame around it, isn't in the way)
  const others = avoid.filter((x) => !(x.x <= r.x && x.y <= r.y && x.x + x.w >= r.x + r.w && x.y + x.h >= r.y + r.h))
  const cost = (a: { tip: Pt; tail: Pt }) => others.reduce((s, x) => s + area(inflate(spanOf(a.tip, a.tail), 14), x), 0)
  const fits = tries.filter((a) => inside({ x: a.tail.x - 30, y: a.tail.y - 14, w: 60, h: 28 }, bounds))
  return (fits.length ? fits : tries).reduce((b, a) => (cost(a) < cost(b) ? a : b))
}
const spanOf = (a: Pt, b: Pt): Rect => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) })
/** Where a tick or a cross goes: on a small thing, over it; by a wide one's right end. */
export const markSpot = (r: Rect): Pt => (r.w > 80 ? { x: r.x + r.w + 18, y: r.y + r.h / 2 } : centre(r))

/** A display's part of a drawing: `origin` its top left in screen points, `home` the one that has the cards. */
export type Here = { width: number; height: number; origin: Pt; home: boolean; pointer?: Pt; top?: number }
/** A mark as drawn here: its target (`box`, a connect's `to`), what its ink covers, its card, its label, its arrow. */
export type Placed = { i: number; mark: Mark; box: Rect | null; to?: Rect | null; ink?: Rect; card?: Rect; label?: Rect
  arrow?: { tip: Pt; tail: Pt }; curve?: ReturnType<typeof arrowPath> }

/** How much of a display a picture or video takes at most, by its size (s, m, l): width and height. */
const MEDIA_MOST = { s: [0.22, 0.26], m: [0.3, 0.36], l: [0.4, 0.45] } as const
export const CAPTION_H = 30
/** An image or video card's size on a display `W` by `H`: its pixels (as loaded, else as the server read them, else
 *  16:10) fitted in its share of the display; a small one up to twice its size, at least 160 wide. Its caption below. */
export function mediaSize(m: Media, W: number, H: number, natural?: [number, number]): Size {
  const [fw, fh] = MEDIA_MOST[m.size ?? "m"], [nw, nh] = natural ?? m.px ?? [1600, 1000]
  const k = Math.min((W * fw) / nw, (H * fh) / nh, Math.max(2, 160 / nw))
  return { w: Math.round(Math.max(160, nw * k)), h: Math.round(Math.max(90, nh * k) + (m.caption ? CAPTION_H : 0)) }
}

/** A card of `size` at an area of `bounds`, `margin` in from its edges. */
export function areaRect(a: Area, size: Size, bounds: Rect, margin = 24): Rect {
  const l = bounds.x + margin, r = bounds.x + bounds.w - margin - size.w, t = bounds.y + margin, b = bounds.y + bounds.h - margin - size.h
  const cx = bounds.x + (bounds.w - size.w) / 2, cy = bounds.y + (bounds.h - size.h) / 2
  const x = /left/.test(a) ? l : /right/.test(a) ? r : cx, y = /^top/.test(a) ? t : /^bottom/.test(a) ? b : cy
  return clampInto({ x, y, ...size }, bounds)
}

/** A card's size before it's measured (the renderer measures its text: `measure` gives that). */
export function cardSize(m: Mark, measure: (text: string, px: number, bold?: boolean) => number = rough): Size {
  if (m.type === "image" || m.type === "video") return mediaSize(m, 1440, 900)
  if (m.type === "paper") return { w: m.w + 2, h: m.h + (m.title ? 34 : 0) + 2 }
  if (m.type === "sticky") return { w: 240, h: Math.max(90, 48 + lines(m.text, 210, 14, measure) * 20 + (m.title ? 22 : 0)) }
  if (m.type === "list") return { w: Math.min(320, Math.max(180, ...m.items.map((x) => measure(x, 14) + 52), measure(m.title ?? "", 14, true) + 32)), h: 24 + (m.title ? 26 : 0) + m.items.length * 24 }
  if (m.type === "write") { const px = m.size === "l" ? 30 : m.size === "s" ? 16 : 22, w = Math.min(420, measure(m.text, px) + 8); return { w, h: lines(m.text, w, px, measure) * px * 1.3 + 6 } }
  const label = m.type === "button" ? m.label : m.type === "copy" ? m.label ?? "Copy" : m.type === "open" ? m.label ?? "Open" : ""
  return { w: Math.min(280, measure(label, 13, true) + 44), h: 30 }
}
const rough = (text: string, px: number, bold = false) => text.length * px * (bold ? 0.58 : 0.54)
const lines = (text: string, w: number, px: number, measure: (t: string, px: number) => number) =>
  text.split("\n").reduce((n, l) => n + Math.max(1, Math.ceil(measure(l, px) / Math.max(40, w - 24))), 0)

/** Each mark of `d` drawn here, where its parts go: its target box, its card's place, its label's. */
export function place(d: Drawing, here: Here, labelSize: (m: Mark) => Size | null, measure?: (text: string, px: number, bold?: boolean) => number,
  naturals: Record<string, [number, number]> = {}): Placed[] {
  const bounds: Rect = { x: 0, y: here.top ?? 0, w: here.width, h: here.height - (here.top ?? 0) }
  const local = (s: Spot | undefined): Rect | null => {
    const r = s && rectOf(s, d.places)
    return r ? { x: r.x - here.origin.x, y: r.y - here.origin.y, w: r.w, h: r.h } : null
  }
  const on = (r: Rect | null) => !!r && overlaps(inflate(r, 1), { x: 0, y: 0, w: here.width, h: here.height })
  const out: Placed[] = []
  d.marks.forEach((mark, i) => {
    if (mark.type === "connect") {
      const a = local(mark.from), b = local(mark.to)
      if (a && b && (on(a) || on(b))) out.push({ i, mark, box: a, to: b })
      return
    }
    const box = "at" in mark ? local(mark.at) : null
    if (CARDS.has(mark.type) ? (box ? on(box) : here.home) : on(box)) out.push({ i, mark, box })
  })
  // (what's marked and the ink around it: cards and labels keep clear of all of it; cards of what's on screen too, as far
  // as the ask's elements say)
  const marked = out.flatMap((p) => (CARDS.has(p.mark.type) || !p.box ? [] : p.to ? [p.box, p.to] : [p.box]))
  const content = Object.entries(d.places ?? {}).filter(([k]) => k.startsWith("el:")).map(([, r]) => local(r)!).filter(on)
  const inks: Rect[] = [], frames = out.flatMap((p) => (p.mark.type === "frame" && p.box ? [p.box] : []))
  for (const p of out) {
    if (!p.box || CARDS.has(p.mark.type)) continue
    if (p.to) { p.curve = arrowPath(p.box, p.to, bounds); p.ink = spanOf(p.curve.from, p.curve.to) }
    else if (p.mark.type === "point") { p.arrow = pointArrow(p.box, bounds, [...marked.filter((m) => m !== p.box), ...inks]); p.ink = inflate(spanOf(p.arrow.tip, p.arrow.tail), 8) }
    else if (p.mark.type === "underline") p.ink = { x: p.box.x - 6, y: p.box.y, w: p.box.w + 12, h: p.box.h + 10 }
    else if (p.mark.type === "check" || p.mark.type === "cross") { const c = markSpot(p.box); p.ink = { x: c.x - 16, y: c.y - 16, w: 32, h: 32 } }
    else p.ink = p.mark.type === "frame" ? frameRect(p.box, frames) : ringBox(p.mark, p.box)
    inks.push(p.ink)
  }
  // (cards first; then labels, clear of the marks, the cards and each other)
  const avoid = [...marked, ...inks], taken: Rect[] = []
  const near = here.pointer ? { x: here.pointer.x - here.origin.x, y: here.pointer.y - here.origin.y } : marked.length ? centre(marked[0]) : { x: here.width * 0.7, y: here.height * 0.35 }
  let at = near
  for (const p of out) {
    const m = p.mark
    if (!CARDS.has(m.type)) continue
    const size = m.type === "image" || m.type === "video" ? mediaSize(m, here.width, here.height - (here.top ?? 0), m.id ? naturals[m.id] : undefined) : cardSize(m, measure)
    const area = "at" in m && m.at && "area" in m.at ? m.at.area : null
    if (p.box && !p.box.w && !p.box.h) p.card = clampInto({ x: p.box.x, y: p.box.y, ...size }, bounds)
    // (beside what it's about, never over it)
    else if (p.box) p.card = labelAt(p.box, size, bounds, [...taken, ...avoid.filter((x) => x !== p.box)], 12)
    else if (area && area !== "cursor") {
      const r = areaRect(area, size, bounds)
      p.card = taken.some((x) => overlaps(r, x)) ? calmSpot(size, bounds, [], centre(r), 12, 0, taken) : r
    } else {
      // (by the cursor: each by the last, the cards together, in the calmest room)
      p.card = calmSpot(size, bounds, [...avoid, ...content], at, 24, 140, taken)
      at = centre(p.card)
    }
    taken.push(p.card)
  }
  // (frames' labels first, snug at them: all on the side that fits the most, as a set reads alike; one it doesn't fit, on
  // the first side that does)
  const tabbed = out.filter((p) => p.mark.type === "frame" && p.ink && labelSize(p.mark) && !saysItsOwn(p.mark, d.places))
  const blocks = (p: Placed) => [...avoid.filter((x) => x !== p.box && x !== p.ink && !inside(p.box!, x)), ...taken]
  const fits = (r: Rect, p: Placed, also: Rect[] = []) => inside(r, bounds) && !overlaps(r, p.ink!) && ![...blocks(p), ...also].some((x) => overlaps(r, x))
  const counts = TAB_SIDES.map((k) => { const got: Rect[] = []; for (const p of tabbed) { const r = tabAt(p.ink!, labelSize(p.mark)!, k); if (fits(r, p, got)) got.push(r) } return got.length })
  const side = TAB_SIDES[counts.indexOf(Math.max(...counts))]
  for (const p of tabbed) {
    const s = labelSize(p.mark)!, k = [side, ...TAB_SIDES].find((t) => fits(tabAt(p.ink!, s, t), p))
    p.label = k ? tabAt(p.ink!, s, k) : labelAt(p.ink!, s, bounds, blocks(p), TAB_GAP)
    taken.push(p.label)
  }
  for (const p of out) {
    const s = labelSize(p.mark)
    if (!s || !p.box || p.label || CARDS.has(p.mark.type) || saysItsOwn(p.mark, d.places)) continue
    // (clear of every other mark's thing and ink, the cards and the labels placed)
    const others = [...avoid.filter((x) => x !== p.box && x !== p.ink && x !== p.to), ...taken]
    if (p.curve) p.label = labelAt({ x: p.curve.mid.x - 2, y: p.curve.mid.y - 2, w: 4, h: 4 }, s, bounds, [...others, p.box, p.to!], 6)
    else if (p.arrow) p.label = labelAt({ x: p.arrow.tail.x - 3, y: p.arrow.tail.y - 3, w: 6, h: 6 }, s, bounds, [...others, p.box], 4, { x: p.arrow.tail.x - p.arrow.tip.x, y: p.arrow.tail.y - p.arrow.tip.y })
    else p.label = labelAt(p.ink!, s, bounds, others)
    taken.push(p.label)
  }
  return out
}

/** A label that only repeats what its element already says ("Share" on the Share button): left out. */
export function saysItsOwn(m: Mark, places: Record<string, Rect> = {}) {
  if (!("label" in m) || !m.label || !("at" in m) || !m.at || !("el" in m.at)) return false
  const own = places[`el:${m.at.el}`]?.label, norm = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()
  return !!own && norm(own) === norm(m.label)
}

/** What a mark draws around its target (a ring is wider than its thing): its label goes outside that. */
export function ringBox(m: Mark, r: Rect): Rect {
  if (m.type === "ring") { const pad = 8 + Math.min(r.w, r.h) * 0.12; return inflate(r, pad) }
  if (m.type === "frame" || m.type === "spotlight") return inflate(r, 6)
  if (m.type === "scroll") return inflate(r.w || r.h ? r : { ...r, x: r.x - 20, y: r.y - 30, w: 40, h: 60 }, 6)
  return r
}
export { PAPER }
