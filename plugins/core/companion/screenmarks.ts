// What the companion draws over the screen (companion draw --marks): marks as data, checked here for the server and the
// overlay alike (no Node, no DOM), and a drawing kept as an .excalidraw scene. web/src/screendraw draws them.
import { sayable, speakable } from "./spoken.ts"
import { boundsOf, flatten, parsePath } from "./svgpath.ts"

/** A rectangle in screen points (a point: w and h 0); an element's, with what it says. */
export type Rect = { x: number; y: number; w: number; h: number; label?: string }
/** Where a card goes on a display by name: a corner, an edge's middle, the centre, or by the cursor (the default). */
export type Area = "cursor" | "top-left" | "top" | "top-right" | "left" | "centre" | "right" | "bottom-left" | "bottom" | "bottom-right"
export const AREAS: Area[] = ["cursor", "top-left", "top", "top-right", "left", "centre", "right", "bottom-left", "bottom", "bottom-right"]
/** Where a mark goes: a point or a box (screen points), an element of the ask (`el`, its id), a pane or the app's UI, or
 *  words to find on the screen (`find`: an element saying them, else where the window shows them); a card also an area. */
export type Spot = Rect | { el: string } | { pane: string } | { ui: string } | { find: string } | { area: Area }
export type Action = { copy: string } | { open: string } | { ask: string }
/** How long a mark stays up: until the next ask (what points, by default), until it's dismissed (cards, by default:
 *  the user's ×, Clear, a later answer erasing it), or until the screen under it changes. */
export type Life = "ask" | "dismiss" | "screen"
export const LIVES: Life[] = ["ask", "dismiss", "screen"]
/** `id`: its name for later changes (draw actions); `life`: how long it stays; `gone`: erased then (ms), its pen run
 *  backward before it goes. Its anchor is its spot (`at`, a connect's ends), found as a screen rect in the layer's places. */
type Base = { beat?: number; id?: string; life?: Life; gone?: number }
/** A paper item's end: a point on the paper, or the id of a shape on it (the line starts or ends at its edge). */
export type End = [number, number] | string
/** A colour: a palette name (black, gray, red, pink, purple, violet, blue, cyan, teal, green, yellow, orange), ink (the
 *  theme's text colour), tint (the companion's), or #hex; a fill also none. */
type Ink = { id?: string; color?: string; fill?: string; gone?: number }
export type SvgPath = { d: string; color?: string; fill?: string; width?: number }
export type PaperItem = Ink & (
  | { type: "line" | "arrow"; from: End; to: End; label?: string }
  | { type: "rect" | "ellipse" | "diamond"; x: number; y: number; w: number; h: number; label?: string }
  | { type: "path"; points: [number, number][] }
  | { type: "text"; x: number; y: number; text: string; size?: Size }
  | { type: "chart"; kind: "bar" | "line"; x: number; y: number; w: number; h: number; values: number[]; labels?: string[] }
  | { type: "svg"; x: number; y: number; w: number; h: number; paths: SvgPath[]; viewBox?: [number, number, number, number]; style?: "clean" | "sketch" })
export type Size = "s" | "m" | "l"
/** An image or a video on the screen: `src` as given (a vault path, a file of this machine, an https address, or
 *  "screenshot": their latest); the rest the server's, as it found it: where the overlay loads it, its name, its pixels. */
export type Media = { type: "image" | "video"; at?: Spot; src: string; caption?: string; size?: Size; url?: string; name?: string; px?: [number, number] }
export type Mark = Base & (
  | { type: "point" | "ring" | "frame"; at: Spot; label?: string }
  | { type: "underline" | "strike" | "check" | "cross" | "spotlight"; at: Spot }
  | { type: "scroll"; at: Spot; dir: "up" | "down" | "left" | "right"; label?: string }
  | { type: "num"; at: Spot; n: number }
  | { type: "connect"; from: Spot; to: Spot; label?: string }
  | { type: "write"; at?: Spot; text: string; size?: Size }
  | { type: "paper"; at?: Spot; w: number; h: number; title?: string; grid?: boolean; items: PaperItem[] }
  | { type: "sticky"; at?: Spot; text: string; title?: string }
  | { type: "list"; at?: Spot; title?: string; items: string[]; numbered?: boolean }
  | { type: "button"; at?: Spot; label: string; do: Action }
  | { type: "copy"; at?: Spot; text: string; label?: string }
  | { type: "open"; at?: Spot; url: string; label?: string }
  | Media)
export type MarkType = Mark["type"]
/** A drawing as the overlay gets it: an agent's marks, the words they're timed with (`caption`, its sentences the
 *  beats), and the screen rects of its places (`places`: "el:e12", "pane:t3", "ui:tab:t3"). */
export type Drawing = { id: string; agent: string; tint: string; t: number; marks: Mark[]; caption?: string; places?: Record<string, Rect>; kept?: string
  /** Its caption's sentences as they're heard aloud (the companion's voice): when each began (ms, the clock's) and how
   *  long it took; null, not heard (yet). The pen draws each beat while its sentence is heard; `waits`, still being said. */
  spoken?: (Spoken | null)[]; waits?: boolean
  /** From an exchange before (a new ask came since): its cards stay up to be changed by id; new marks replace it. */
  past?: boolean
  /** Hidden for now (companion layer --hide): kept as it is, drawn again when shown. */
  hidden?: boolean }
export type Spoken = { at: number; dur: number }

export const MARK_TYPES: MarkType[] = ["point", "ring", "frame", "underline", "strike", "connect", "num", "check", "cross", "spotlight", "scroll", "write", "paper", "sticky", "list", "button", "copy", "open", "image", "video"]
/** Cards: placed by the cursor when they have no `at`, else at it (an area, a point, beside a thing); the user can drag
 *  one or dismiss it. */
export const CARDS = new Set<MarkType>(["write", "paper", "sticky", "list", "button", "copy", "open", "image", "video"])
export const MOST = { marks: 40, items: 60, points: 200, values: 24, list: 12, label: 60, text: 300, copy: 4000, paper: [720, 520] as const, paths: 40, d: 6000, svg: 40_000 }
export const PAPER = { w: 360, h: 240 }
export const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif|bmp|svg|heic|heif|tiff?)$/i
export const VIDEO_EXT = /\.(mp4|m4v|mov|webm)$/i

/** The vocabulary in a few lines, for the op's help and the docs. */
export const VOCABULARY = `Spots: {"el": "<id>"} (an element of the ask: snaps to its frame; the best), {"find": "<words>"} (the thing on the screen saying them now, by their pointer), {"pane": "<id>"} or {"ui": "tab:<id>"} in the app; [x, y, w, h] or [x, y] in screen points only for what has none (a bare point snaps to a frame round what they drew there, else to the element there).
On the screen: point, ring, frame (a thing or an area boxed, the whole of it: what it is), underline, strike, check, cross, spotlight {at, label?}; num {at, n}; scroll {at, dir}; connect {from, to, label?}.
Cards (by your cursor unless at says: an area "top-left" | "top" | "top-right" | "left" | "centre" | "right" | "bottom-left" | "bottom" | "bottom-right", a point [x, y] for its top left, or a spot it goes beside; the user can drag or dismiss one): write {text, size: s|m|l}; sticky {text, title?}; list {items, title?, numbered?}; image or video {src, caption?, size?: s|m|l}: src a vault path, a file of this Mac (~/...), an https address, or "screenshot" (their latest screenshot; a video: their latest screen recording); a video plays muted, looped.
paper {w, h, title?, grid?, items}: a pad, its items in its own units (0,0 its top left), Excalidraw's: rect|ellipse|diamond {x,y,w,h,label?}, arrow|line {from, to, label?} (an end [x,y], or a shape's id: bound to it), text {x,y,text,size?}, path {points} (freehand), chart {kind: bar|line, x,y,w,h, values, labels?}, svg {paths: [{d, color?, fill?, width?}], x?,y?,w?,h? (its box, the pad's by default), viewBox?, style?: clean|sketch} (path data only: a logo, an animal, any shape, fitted into its box). Each item may say id (to change it later), color and fill (black, gray, red, pink, purple, violet, blue, cyan, teal, green, yellow, orange, ink, tint or #hex; fill none).
Actions: copy {text}, open {url}, button {label, do: {copy}|{open}|{ask: "<follow-up>"}}.
Every mark may say beat: the sentence of your words (0 the first) it appears with; id: its name for draw actions; life: ask (until their next ask: what points, by default; it fades sooner if the screen under it changes, and one on an element follows it as it moves), dismiss (until dismissed: cards, by default) or screen (until the screen under it changes).`

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v)
const num = (v: unknown) => typeof v === "number" && Number.isFinite(v)
const COORD = 100_000

/** `marks` checked: the marks as drawn, or an Error saying what's wrong with which one, and how it's written. */
export function checkMarks(marks: unknown): Mark[] {
  if (!Array.isArray(marks)) throw new Error("marks: a JSON list of marks")
  if (marks.length > MOST.marks) throw new Error(`marks: at most ${MOST.marks}`)
  return marks.map((m, i) => {
    const at = `marks[${i}]${isObj(m) && typeof m.type === "string" ? ` (${m.type})` : ""}`
    try { return checkMark(m) } catch (e) { throw new Error(`${at}: ${(e as Error).message}`) }
  })
}

function checkMark(m: unknown): Mark {
  if (!isObj(m)) throw new Error("a mark is an object: {\"type\": ..., ...}")
  // (an arrow is a connect, as its tag is)
  const type = (m.type === "arrow" ? "connect" : m.type) as MarkType
  if (!MARK_TYPES.includes(type)) throw new Error(`type is one of ${MARK_TYPES.join(", ")}`)
  const base: Base = {}
  if (m.beat !== undefined) { if (!Number.isInteger(m.beat) || (m.beat as number) < 0 || (m.beat as number) > 50) throw new Error("beat: a sentence's index, from 0"); base.beat = m.beat as number }
  if (m.id !== undefined) base.id = idOf(m.id, "id")
  if (m.life !== undefined) { if (!LIVES.includes(m.life as Life)) throw new Error("life: ask (until the next ask), dismiss (until dismissed) or screen (until the screen under it changes)"); base.life = m.life as Life }
  const label = () => (m.label === undefined ? {} : { label: words(m.label, "label", MOST.label) })
  const card = () => (m.at === undefined ? {} : { at: spot(m.at, "at", true) })
  switch (type) {
    case "point": case "ring": case "frame": return { ...base, type, at: spot(m.at, "at"), ...label() }
    case "underline": case "strike": case "check": case "cross": case "spotlight": return { ...base, type, at: spot(m.at, "at") }
    case "scroll": {
      const dir = m.dir ?? "down"
      if (!["up", "down", "left", "right"].includes(dir as string)) throw new Error("dir: up, down, left or right")
      return { ...base, type, at: spot(m.at, "at"), dir: dir as "down", ...label() }
    }
    case "num": {
      if (!Number.isInteger(m.n) || (m.n as number) < 0 || (m.n as number) > 99) throw new Error("n: the step's number, 0 to 99")
      return { ...base, type, at: spot(m.at, "at"), n: m.n as number }
    }
    case "connect": return { ...base, type, from: spot(m.from, "from"), to: spot(m.to, "to"), ...label() }
    case "write": return { ...base, type, ...card(), text: words(m.text, "text", MOST.text), ...size(m.size) }
    case "sticky": return { ...base, type, ...card(), text: words(m.text, "text", MOST.text), ...(m.title === undefined ? {} : { title: words(m.title, "title", MOST.label) }) }
    case "list": {
      if (!Array.isArray(m.items) || !m.items.length || m.items.length > MOST.list) throw new Error(`items: a list of 1 to ${MOST.list} lines`)
      return { ...base, type, ...card(), items: m.items.map((x, i) => words(x, `items[${i}]`, 120)), ...(m.title === undefined ? {} : { title: words(m.title, "title", MOST.label) }), ...(m.numbered ? { numbered: true } : {}) }
    }
    case "button": return { ...base, type, ...card(), label: words(m.label, "label", MOST.label), do: action(m.do) }
    case "copy": return { ...base, type, ...card(), text: words(m.text, "text", MOST.copy), ...label() }
    case "open": return { ...base, type, ...card(), url: url(m.url), ...label() }
    // (where it loads from is the server's to find: url, name and px given are dropped)
    case "image": case "video": return { ...base, type, ...card(), src: words(m.src ?? m.path ?? m.url, "src", 2000), ...size(m.size),
      ...(m.caption === undefined ? {} : { caption: words(m.caption, "caption", MOST.text) }) }
    case "paper": {
      const w = m.w === undefined ? PAPER.w : m.w, h = m.h === undefined ? PAPER.h : m.h
      if (!num(w) || !num(h) || (w as number) < 80 || (h as number) < 60 || (w as number) > MOST.paper[0] || (h as number) > MOST.paper[1]) throw new Error(`w, h: its size, 80x60 to ${MOST.paper.join("x")} (default ${PAPER.w}x${PAPER.h})`)
      if (!Array.isArray(m.items) || m.items.length > MOST.items) throw new Error(`items: a list of up to ${MOST.items} things on it`)
      const items = m.items.map((x, i) => { try { return paperItem(x, w as number, h as number) } catch (e) { throw new Error(`items[${i}]: ${(e as Error).message}`) } })
      checkItems(items)
      return { ...base, type, ...card(), w: w as number, h: h as number, ...(m.title === undefined ? {} : { title: words(m.title, "title", MOST.label) }), ...(m.grid ? { grid: true } : {}), items }
    }
  }
}

const ID_RE = /^[\w-]{1,40}$/
const idOf = (v: unknown, what: string) => { if (typeof v !== "string" || !ID_RE.test(v)) throw new Error(`${what}: letters, digits, - and _ (up to 40)`); return v }
/** A pad's items together: ids once each, a bound end a shape's. */
export function checkItems(items: PaperItem[]) {
  const ids = new Set<string>()
  for (const it of items) if (it.id) { if (ids.has(it.id)) throw new Error(`items: id "${it.id}" twice`); ids.add(it.id) }
  const shape = (id: string) => items.some((x) => x.id === id && !x.gone && (x.type === "rect" || x.type === "ellipse" || x.type === "diamond" || x.type === "text" || x.type === "svg"))
  items.forEach((it, i) => {
    if (it.type !== "line" && it.type !== "arrow") return
    for (const e of [it.from, it.to]) if (typeof e === "string" && !shape(e)) throw new Error(`items[${i}]: ${JSON.stringify(e)} isn't a shape's id on this pad`)
  })
}

function words(v: unknown, what: string, most: number) {
  if (typeof v !== "string" || !v.trim()) throw new Error(`${what}: some words`)
  if (v.length > most) throw new Error(`${what}: at most ${most} characters`)
  return v.trim()
}
const size = (v: unknown) => { if (v === undefined) return {}; if (v !== "s" && v !== "m" && v !== "l") throw new Error("size: s, m or l"); return { size: v as Size } }
function url(v: unknown) {
  if (typeof v !== "string" || !/^https?:\/\/[^\s]+$/i.test(v) || v.length > 2000) throw new Error("url: an http(s) address")
  return v
}
function action(v: unknown): Action {
  if (!isObj(v)) throw new Error("do: {\"copy\": text}, {\"open\": url} or {\"ask\": a follow-up}")
  if (v.copy !== undefined) return { copy: words(v.copy, "do.copy", MOST.copy) }
  if (v.open !== undefined) return { open: url(v.open) }
  if (v.ask !== undefined) return { ask: words(v.ask, "do.ask", MOST.text) }
  throw new Error("do: {\"copy\": text}, {\"open\": url} or {\"ask\": a follow-up}")
}
const ID = /^[\w.:/-]{1,120}$/
/** A spot as given: [x, y], [x, y, w, h], {x, y, w?, h?}, {el}, {pane}, {ui}; a card's also an area ("top-right"). */
function spot(v: unknown, what: string, card = false): Spot {
  const how = `${what}: {"el": "<id>"}, {"find": "<words>"}, {"pane": "<id>"}, {"ui": "<id>"}, [x, y, w, h] or [x, y] (screen points)${card ? `, or an area: ${AREAS.join(", ")}` : ""}`
  const area = typeof v === "string" ? v : isObj(v) && typeof v.area === "string" ? v.area : null
  if (area !== null) {
    const a = area.trim().toLowerCase().replace(/\s+/g, "-").replace("center", "centre").replace(/^(pointer|mouse)$/, "cursor")
    if (!card) throw new Error(`${what}: an area places a card; a mark goes at a thing (${how})`)
    if (!AREAS.includes(a as Area)) throw new Error(how)
    return { area: a as Area }
  }
  if (Array.isArray(v)) {
    if ((v.length !== 2 && v.length !== 4) || !v.every((n) => num(n) && Math.abs(n) < COORD)) throw new Error(how)
    if (v.length === 4 && (v[2] < 0 || v[3] < 0)) throw new Error(`${what}: w and h aren't negative`)
    return { x: v[0], y: v[1], w: v[2] ?? 0, h: v[3] ?? 0 }
  }
  if (!isObj(v)) throw new Error(how)
  for (const k of ["el", "pane", "ui"] as const) if (v[k] !== undefined) { if (typeof v[k] !== "string" || !ID.test(v[k])) throw new Error(`${what}.${k}: an id`); return { [k]: v[k] } as Spot }
  if (v.find !== undefined) return { find: words(v.find, `${what}.find`, 120) }
  if (num(v.x) && num(v.y)) {
    const w = v.w ?? v.width ?? 0, h = v.h ?? v.height ?? 0
    if (!num(w) || !num(h) || (w as number) < 0 || (h as number) < 0) throw new Error(how)
    return { x: v.x as number, y: v.y as number, w: w as number, h: h as number }
  }
  throw new Error(how)
}
/** A card's spot, as an action gives one (draw actions' move). */
export const cardSpot = (v: unknown) => spot(v, "at", true)
function pt(v: unknown, what: string, w: number, h: number): [number, number] {
  if (!Array.isArray(v) || v.length !== 2 || !num(v[0]) || !num(v[1])) throw new Error(`${what}: [x, y]`)
  if (v[0] < -1 || v[1] < -1 || v[0] > w + 1 || v[1] > h + 1) throw new Error(`${what}: inside the paper (0..${w}, 0..${h})`)
  return [v[0], v[1]]
}
function box(m: Record<string, unknown>, w: number, h: number) {
  if (![m.x, m.y, m.w, m.h].every(num) || (m.w as number) < 0 || (m.h as number) < 0) throw new Error("x, y, w, h: its box on the paper")
  const x = m.x as number, y = m.y as number, bw = m.w as number, bh = m.h as number
  if (x < -1 || y < -1 || x + bw > w + 1 || y + bh > h + 1) throw new Error(`x, y, w, h: inside the paper (${w}x${h})`)
  return { x, y, w: bw, h: bh }
}
const SHAPE_SIZE = (label?: string) => ({ w: Math.max(100, Math.min(260, (label?.length ?? 0) * 8.5 + 36)), h: 56 })
/** A colour as given: a palette name, ink, tint or #hex (a fill also none). */
export function colorOf(v: unknown, what: string, fill = false) {
  if (v === undefined) return undefined
  const s = String(v).trim().toLowerCase()
  if (fill && (s === "none" || s === "transparent")) return "none"
  if (/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/.test(s) || s in PALETTE || s === "ink" || s === "tint") return s
  throw new Error(`${what}: ${Object.keys(PALETTE).join(", ")}, ink, tint or #hex${fill ? " (or none)" : ""}`)
}
const inkOf = (v: Record<string, unknown>): Ink => {
  const c = colorOf(v.color ?? v.stroke, "color"), f = colorOf(v.fill, "fill", true)
  return { ...(v.id === undefined ? {} : { id: idOf(v.id, "id") }), ...(c ? { color: c } : {}), ...(f ? { fill: f } : {}) }
}
const end = (v: unknown, what: string, w: number, h: number): End => (typeof v === "string" ? idOf(v, `${what} (a shape's id)`) : pt(v, what, w, h))
/** A paper item checked on a pad `w` by `h` (Excalidraw's names too: rectangle, freedraw). */
export function paperItem(v: unknown, w: number, h: number): PaperItem {
  if (!isObj(v)) throw new Error("an item is an object: {\"type\": ..., ...}")
  const label = v.label === undefined ? {} : { label: words(v.label, "label", MOST.label) }
  const type = v.type === "rectangle" ? "rect" : v.type === "freedraw" ? "path" : v.type
  const ink = inkOf(v)
  switch (type) {
    case "line": case "arrow": return { ...ink, type, from: end(v.from, "from", w, h), to: end(v.to, "to", w, h), ...label }
    case "rect": case "ellipse": case "diamond": {
      const s = v.w === undefined && v.h === undefined && num(v.x) && num(v.y) ? SHAPE_SIZE(label.label) : null
      return { ...ink, type, ...box(s ? { ...v, ...s } : v, w, h), ...label }
    }
    case "path": {
      if (!Array.isArray(v.points) || v.points.length < 2 || v.points.length > MOST.points) throw new Error(`points: 2 to ${MOST.points} [x, y]`)
      return { ...ink, type: "path", points: v.points.map((p, i) => pt(p, `points[${i}]`, w, h)) }
    }
    case "text": {
      if (!num(v.x) || !num(v.y)) throw new Error("x, y: where it starts")
      return { ...ink, type: "text", x: v.x as number, y: v.y as number, text: words(v.text ?? v.label, "text", MOST.text), ...size(v.size) }
    }
    case "chart": {
      if (v.kind !== "bar" && v.kind !== "line") throw new Error("kind: bar or line")
      if (!Array.isArray(v.values) || !v.values.length || v.values.length > MOST.values || !v.values.every((n) => num(n) && Math.abs(n) < 1e12)) throw new Error(`values: 1 to ${MOST.values} numbers`)
      const b = v.x === undefined ? { x: 16, y: 16, w: w - 32, h: h - 32 } : box(v, w, h)
      if (v.labels !== undefined && (!Array.isArray(v.labels) || v.labels.length !== v.values.length)) throw new Error("labels: one per value")
      return { ...ink, type: "chart", kind: v.kind, ...b, values: v.values as number[], ...(v.labels ? { labels: (v.labels as unknown[]).map((l, i) => words(String(l), `labels[${i}]`, 24)) } : {}) }
    }
    case "svg": {
      const given = v.paths ?? (v.d === undefined ? undefined : [{ d: v.d, color: v.color, fill: v.fill, width: v.width }])
      if (!Array.isArray(given) || !given.length || given.length > MOST.paths) throw new Error(`paths: 1 to ${MOST.paths} {d, color?, fill?, width?} (SVG path data, no markup)`)
      let total = 0
      const paths = given.map((p, i): SvgPath => {
        const what = `paths[${i}]`
        if (!isObj(p) || typeof p.d !== "string" || !p.d.trim()) throw new Error(`${what}: {d: "M10 10 L50 50 ..."}`)
        if (p.d.length > MOST.d) throw new Error(`${what}.d: at most ${MOST.d} characters`)
        total += p.d.length
        try { parsePath(p.d) } catch (e) { throw new Error(`${what}.${(e as Error).message}`) }
        if (p.width !== undefined && (!num(p.width) || (p.width as number) <= 0 || (p.width as number) > 20)) throw new Error(`${what}.width: its stroke's width, 0.5 to 20`)
        const c = colorOf(p.color ?? p.stroke, `${what}.color`, true), f = colorOf(p.fill, `${what}.fill`, true)
        return { d: p.d.trim(), ...(c ? { color: c } : {}), ...(f ? { fill: f } : {}), ...(p.width === undefined ? {} : { width: p.width as number }) }
      })
      if (total > MOST.svg) throw new Error(`paths: at most ${MOST.svg} characters of path data in all`)
      let vb: [number, number, number, number] | undefined
      if (v.viewBox !== undefined) {
        const raw = typeof v.viewBox === "string" ? v.viewBox.trim().split(/[\s,]+/).map(Number) : v.viewBox
        if (!Array.isArray(raw) || raw.length !== 4 || !raw.every(num) || raw[2] <= 0 || raw[3] <= 0) throw new Error("viewBox: [x, y, w, h], the paths' own units")
        vb = raw as [number, number, number, number]
      }
      if (v.style !== undefined && v.style !== "clean" && v.style !== "sketch") throw new Error("style: clean (smooth lines, the default) or sketch (hand-drawn)")
      const b = v.x === undefined && v.w === undefined ? { x: 12, y: 12, w: w - 24, h: h - 24 } : box(v, w, h)
      return { ...ink, type: "svg", ...b, paths, ...(vb ? { viewBox: vb } : {}), ...(v.style ? { style: v.style as "clean" } : {}) }
    }
  }
  throw new Error("type is one of rect, ellipse, diamond, line, arrow, text, path, chart, svg")
}

/** Excalidraw's palette by name: a stroke and the fill that goes with it. */
export const PALETTE: Record<string, [string, string]> = {
  black: ["#1e1e1e", "#e9ecef"], gray: ["#868e96", "#e9ecef"], red: ["#e03131", "#ffc9c9"], pink: ["#c2255c", "#fcc2d7"],
  purple: ["#9c36b5", "#eebefa"], violet: ["#6741d9", "#d0bfff"], blue: ["#1971c2", "#a5d8ff"], cyan: ["#0c8599", "#99e9f2"],
  teal: ["#099268", "#96f2d7"], green: ["#2f9e44", "#b2f2bb"], yellow: ["#f08c00", "#ffec99"], orange: ["#e8590c", "#ffd8a8"],
}

/** How long `m` stays: as it says, else a card until it's dismissed, what points until the next ask. */
export const lifeOf = (m: Mark): Life => m.life ?? (CARDS.has(m.type) ? "dismiss" : "ask")

/** The places a drawing's marks name that the app must find: panes and UI ("pane:t3", "ui:tab:t3"). */
export function appPlaces(marks: Mark[]) {
  const out = new Set<string>()
  for (const s of spots(marks)) { if ("pane" in s) out.add(`pane:${s.pane}`); else if ("ui" in s) out.add(`ui:${s.ui}`) }
  return [...out]
}
/** The words `marks` name to find on the screen ("find:<words>" places). */
export const findsOf = (marks: Mark[]) => [...new Set(spots(marks).flatMap((s) => ("find" in s ? [s.find] : [])))]
/** Every spot of `marks`, in order. */
export function spots(marks: Mark[]): Spot[] {
  return marks.flatMap((m) => ("from" in m ? [m.from, m.to] : "at" in m && m.at ? [m.at] : []))
}
/** A spot's rect: as given, or found in `places` (null: not known). */
export function rectOf(s: Spot, places: Record<string, Rect> = {}): Rect | null {
  if ("el" in s) return places[`el:${s.el}`] ?? null
  if ("pane" in s) return places[`pane:${s.pane}`] ?? null
  if ("ui" in s) return places[`ui:${s.ui}`] ?? null
  if ("find" in s) return places[`find:${s.find}`] ?? null
  if ("area" in s) return null
  return s
}

/** Why each of `marks` can't show, null where it can: its spot found nowhere (`places` lacks it), or its box off every
 *  one of `displays` (screen points; none known, not checked). A card with no spot goes on calm space: it shows. */
export function unshown(marks: Mark[], places: Record<string, Rect> = {}, displays: Rect[] = []): (string | null)[] {
  const on = (r: Rect) => displays.some((d) => r.x + r.w >= d.x && r.x <= d.x + d.w && r.y + r.h >= d.y && r.y <= d.y + d.h)
  return marks.map((m) => {
    for (const s of "from" in m ? [m.from, m.to] : "at" in m && m.at ? [m.at] : []) {
      if ("area" in s) continue
      const r = rectOf(s, places)
      if (!r) return "el" in s ? `found nothing: ${s.el} isn't an element the ask listed` : "found nothing there"
      if (displays.length && !on(r)) return `at ${Math.round(r.x)},${Math.round(r.y)} is off their screen`
    }
    return null
  })
}

/** Words as found: a key's glyph by its name (macOS labels the fn key 🌐, which people call fn or globe). */
const norm = (t: string) => t.toLowerCase().replace(/🌐/gu, " fn ").replace(/\bglobe\b/g, "fn").replace(/[^\p{L}\p{N}]+/gu, " ").trim()
/** The element of `els` saying `text`: the same words, else the most like them (its label in them, or them in it). */
export function byLabel<T extends { label: string }>(els: T[], text: string): T | null {
  const want = norm(text)
  if (!want) return null
  return els.find((e) => norm(e.label) === want) ?? els.find((e) => norm(e.label).startsWith(want)) ?? els.find((e) => norm(e.label).includes(want))
    ?? els.find((e) => norm(e.label).length >= 3 && want.includes(norm(e.label))) ?? null
}

/** Words found on the screen, and how well (3: an element named them; 2: their whole words; 1: inside longer words). */
export type Found = Rect & { q: number }
const gapOf = (a: Rect, b: Rect) => Math.hypot(Math.max(0, b.x - a.x - a.w, a.x - b.x - b.w), Math.max(0, b.y - a.y - a.h, a.y - b.y - b.h))
/** Of places words were found, the one meant: the best match, then the nearest `by` (what the user drew, else their
 *  pointer), so of two panes saying them the one they're at wins. */
export function bestFound(found: Found[], by: Rect[] = []): Found | null {
  const gap = (r: Rect) => (by.length ? Math.min(...by.map((b) => gapOf(r, b))) : 0)
  return [...found].sort((a, b) => b.q - a.q || gap(a) - gap(b))[0] ?? null
}

/** Marks whose size is what they mean (a ring, a frame, a line under or through, a spotlight). */
const SIZED = new Set<MarkType>(["ring", "frame", "underline", "strike", "spotlight"])
const contains = (r: Rect, x: number, y: number) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h
const iou = (a: Rect, b: Rect) => {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
  const i = w > 0 && h > 0 ? w * h : 0
  return i ? i / (a.w * a.h + b.w * b.h - i) : 0
}
const within = (r: Rect, b: Rect, slack = 8) => r.x >= b.x - slack && r.y >= b.y - slack && r.x + r.w <= b.x + b.w + slack && r.y + r.h <= b.y + b.h + slack
/** `marks` at what's there: a sized mark at a guessed pixel or box goes round what the user drew there (`drawn`; a ring
 *  there a frame: they circled a thing or a group), else the element it's on, by or much like (`places`' "el:a3"). */
export function snapMarks(marks: Mark[], places: Record<string, Rect> = {}, drawn: Rect[] = []): Mark[] {
  const els = Object.entries(places).filter(([k, r]) => k.startsWith("el:") && r.w > 0 && r.h > 0).map(([k, r]) => ({ id: k.slice(3), r }))
  const area = (r: Rect) => r.w * r.h
  // (what they circled: round the elements inside it, the whole of each, else as drawn)
  const circled = (ring: Rect): Rect => {
    const inside = els.map((e) => e.r).filter((r) => within(r, ring) && area(r) < area(ring) * 0.9)
    if (!inside.length) return { x: ring.x, y: ring.y, w: ring.w, h: ring.h }
    const x = Math.min(...inside.map((r) => r.x)), y = Math.min(...inside.map((r) => r.y))
    return { x, y, w: Math.max(...inside.map((r) => r.x + r.w)) - x, h: Math.max(...inside.map((r) => r.y + r.h)) - y }
  }
  const snap = (s: Spot): { at: Spot; ring?: true } => {
    if (!("x" in s)) return { at: s }
    if (s.w || s.h) {
      const like = els.filter((e) => iou(e.r, s) >= 0.6).sort((a, b) => iou(b.r, s) - iou(a.r, s))[0]
      if (like) return { at: { el: like.id } }
      const ring = drawn.filter((r) => iou(r, s) >= 0.5).sort((a, b) => iou(b, s) - iou(a, s))[0]
      return ring ? { at: circled(ring), ring: true } : { at: s }
    }
    const ring = drawn.filter((r) => contains(r, s.x, s.y)).sort((a, b) => area(a) - area(b))[0]
    if (ring) return { at: circled(ring), ring: true }
    const on = els.filter((e) => contains(e.r, s.x, s.y)).sort((a, b) => area(a.r) - area(b.r))[0]
    if (on) return { at: { el: on.id } }
    const by = els.filter((e) => gapOf(e.r, s) <= 12).sort((a, b) => gapOf(a.r, s) - gapOf(b.r, s))[0]
    return { at: by ? { el: by.id } : s }
  }
  return marks.map((m) => {
    if (!SIZED.has(m.type) || !("at" in m) || !m.at) return m
    const { at, ring } = snap(m.at)
    return { ...m, ...(ring && m.type === "ring" ? { type: "frame" } : {}), at } as Mark
  })
}

// ---------- timing: marks come in beats, each with a sentence of the words

/** The words' sentences, as read (a sentence's end, or a line's). */
export function sentences(text: string) {
  return text.replace(/\s+\n/g, "\n").split(/(?<=[.!?…:])\s+(?=\S)|\n+/).map((s) => s.trim()).filter(Boolean)
}
/** When each beat starts (ms after the words show): the time to read the sentences before it. */
export function beatTimes(caption: string, beats: number) {
  const ss = sentences(caption), out = [0]
  for (let i = 1; i <= beats; i++) out.push(out[i - 1] + (ss[i - 1] ? readMs(ss[i - 1]) : 1200))
  return out
}
const readMs = (s: string) => Math.min(3500, Math.max(700, 300 + s.split(/\s+/).length * 230))

/** A sentence as the voice said it (electron/voice.ts, or any voice that plays the answer): its words, when it began
 *  (ms, the clock's), how long it took. */
export type Heard = { text: string; at: number; dur: number }
const wordsOf = (s: string) => sayable(speakable(s)).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean)
/** Each of `caption`'s sentences as it was heard: matched in order to the sentences said (most of their words the same),
 *  null for one not heard yet. */
export function heardBeats(caption: string, heard: Heard[]): (Spoken | null)[] {
  const said = heard.map((h) => ({ h, w: new Set(wordsOf(h.text)) }))
  let from = 0
  return sentences(caption).map((s) => {
    const w = wordsOf(s)
    if (!w.length) return null
    for (let i = from; i < said.length; i++) {
      const same = w.filter((x) => said[i].w.has(x)).length
      if (same >= Math.max(1, 0.6 * Math.max(w.length, said[i].w.size))) { from = i + 1; return { at: said[i].h.at, dur: said[i].h.dur } }
    }
    return null
  })
}
/** When each beat starts (ms after `t0`, the drawing's clock) and how long its marks spread over: while its sentence is
 *  heard (one not heard yet while it `waits`: Infinity); else the time to read the ones before, on from the last heard. */
export function pacedBeats(caption: string, beats: number, spoken: (Spoken | null)[] | undefined, t0: number, waits = false) {
  const ss = sentences(caption), times: number[] = [], spread: (number | null)[] = []
  for (let b = 0; b <= beats; b++) {
    const h = spoken?.[b], was = b ? spoken?.[b - 1] : null
    const t = h ? h.at - t0 : waits ? Infinity : b === 0 ? 0 : was ? was.at + was.dur - t0 : times[b - 1] + (ss[b - 1] ? readMs(ss[b - 1]) : 1200)
    times.push(Math.max(0, b ? times[b - 1] : 0, t))
    spread.push(h ? h.dur : null)
  }
  return { times, spread }
}

// ---------- changed in place: a drawing's marks and its pads' items by id (draw actions without a path)

/** How long what's erased stays (its pen run backward), ms. */
export const ERASE_MS = 700
const live = <T extends { gone?: number }>(x: T) => !x.gone
const ITEM_TYPES = new Set(["rect", "rectangle", "ellipse", "diamond", "line", "arrow", "text", "path", "freedraw", "chart", "svg"])
/** Every id in `marks`: its marks' and its pads' items'. */
export function idsIn(marks: Mark[]) {
  return new Set(marks.flatMap((m) => [...(m.id ? [m.id] : []), ...(m.type === "paper" ? m.items.flatMap((i) => (i.id ? [i.id] : [])) : [])]))
}
/** `marks` with what was erased more than a moment ago (`now`) gone for good. */
export const pruned = (marks: Mark[], now = Date.now()): Mark[] => marks.filter((m) => !m.gone || now - m.gone < ERASE_MS)
  .map((m) => (m.type === "paper" && m.items.some((i) => i.gone) ? { ...m, items: m.items.filter((i) => !i.gone || now - i.gone < ERASE_MS) } : m))

/** `marks` with `actions` made, in order, each checked first (an error names the action and why); `added`: the marks
 *  they added (their places are still to find), `touched`: the ids they changed. */
export function editMarks(marks: Mark[], actions: unknown, now = Date.now()): { marks: Mark[]; added: Mark[]; touched: string[] } {
  if (!Array.isArray(actions) || !actions.length) throw new Error("actions: a list of at least one ({\"op\": \"add\" | \"move\" | \"change\" | \"delete\", ...})")
  if (actions.length > MOST.items) throw new Error(`actions: at most ${MOST.items}`)
  const out: Mark[] = marks.map((m) => (m.type === "paper" ? { ...m, items: m.items.map((i) => ({ ...i })) } : { ...m })), added: Mark[] = [], touched: string[] = []
  const touch = (id?: string) => { if (id && !touched.includes(id)) touched.push(id) }
  const find = (id: unknown) => {
    if (typeof id !== "string") throw new Error("id: the id of a mark or an item (what's up lists them)")
    for (const m of out) {
      if (m.gone) continue
      if (m.id === id) return { mark: m }
      if (m.type === "paper") { const item = m.items.find((i) => i.id === id && live(i)); if (item) return { mark: m, item } }
    }
    throw new Error(`no ${JSON.stringify(id)} up now (what's up lists the ids)`)
  }
  actions.forEach((raw, n) => {
    const a = isObj(raw) ? raw : {}, op = a.op
    try {
      if (op === "add") {
        if (a.mark !== undefined) {
          const m = checkMark(a.mark)
          if (m.id && idsIn(out).has(m.id)) throw new Error(`id "${m.id}" is taken`)
          out.push(m); added.push(m); touch(m.id)
          return
        }
        if (!ITEM_TYPES.has(String(a.type))) throw new Error(`type: an item for a pad (${[...ITEM_TYPES].join(", ")}); a new mark is {"op": "add", "mark": {...}}`)
        const pads = out.filter((m): m is Extract<Mark, { type: "paper" }> => m.type === "paper" && live(m))
        const pad = a.in === undefined ? pads.at(-1) : pads.find((p) => p.id === a.in)
        if (!pad) throw new Error(a.in === undefined ? "no pad up to add to: draw one (a paper mark), or add a mark" : `no pad ${JSON.stringify(a.in)} up`)
        const { op: _op, in: _in, ...item } = a
        const it = paperItem(item, pad.w, pad.h)
        if (it.id && idsIn(out).has(it.id)) throw new Error(`id "${it.id}" is taken`)
        checkItems([...pad.items, it])
        pad.items.push(it); touch(it.id)
      } else if (op === "move") {
        const { mark, item } = find(a.id)
        if (!item) {
          if (a.at === undefined) throw new Error(`at: where it goes (${CARDS.has(mark.type) ? "an area, a point or a spot" : "a spot"})`)
          if (mark.type === "connect") throw new Error("a connect moves by its ends: delete it and add another")
          ;(mark as { at?: Spot }).at = CARDS.has(mark.type) ? cardSpot(a.at) : spotOf(a.at)
          touch(mark.id)
          return
        }
        const pad = mark as Extract<Mark, { type: "paper" }>, p = (k: string) => (a[k] === undefined ? undefined : num(a[k]) ? (a[k] as number) : bad(`${k}: a number`))
        const x = p("x"), y = p("y"), dx = p("dx"), dy = p("dy")
        if (x === undefined && y === undefined && dx === undefined && dy === undefined) throw new Error("x and y (its top left, on the pad), or dx and dy")
        const b = itemBox(item, pad.items)
        // (kept on the pad)
        const mx = Math.min(Math.max((x ?? b.x + (dx ?? 0)), 0), Math.max(0, pad.w - b.w)) - b.x, my = Math.min(Math.max((y ?? b.y + (dy ?? 0)), 0), Math.max(0, pad.h - b.h)) - b.y
        shift(item, mx, my); touch(item.id)
      } else if (op === "change") {
        const { mark, item } = find(a.id)
        const keys = Object.keys(a).filter((k) => k !== "op" && k !== "id")
        if (!keys.length) throw new Error("what changes: label, text, color, fill, w, h, size, caption, title")
        if (item) {
          const pad = mark as Extract<Mark, { type: "paper" }>
          const { op: _op, ...change } = a
          const next = paperItem({ ...item, ...change, type: item.type }, pad.w, pad.h)
          const i = pad.items.indexOf(item)
          pad.items[i] = { ...next, ...(item.id ? { id: item.id } : {}) }
          checkItems(pad.items)
          touch(item.id)
        } else {
          const { op: _op, id: _id, ...rest } = a
          const next = checkMark({ ...mark, ...rest })
          // (another source is found again)
          if ((mark.type === "image" || mark.type === "video") && rest.src !== undefined) { delete mark.url; delete mark.name; delete mark.px; added.push(mark) }
          Object.assign(mark, next); touch(mark.id)
        }
      } else if (op === "delete") {
        const { mark, item } = find(a.id)
        if (!item) { mark.gone = now; touch(mark.id); return }
        item.gone = now; touch(item.id)
        // (what's bound to it goes with it)
        const pad = mark as Extract<Mark, { type: "paper" }>
        for (const x of pad.items) if ((x.type === "line" || x.type === "arrow") && live(x) && (x.from === item.id || x.to === item.id)) { x.gone = now; touch(x.id) }
      } else throw new Error(`op ${JSON.stringify(op ?? "")}: add, move, change or delete`)
    } catch (e) { throw new Error(`actions[${n}]${typeof op === "string" ? ` (${op})` : ""}: ${(e as Error).message}`) }
  })
  return { marks: out, added, touched }
}
const bad = (why: string): never => { throw new Error(why) }
const spotOf = (v: unknown) => spot(v, "at")
/** An item's box on its pad (a bound end at its shape's centre). */
export function itemBox(it: PaperItem, items: PaperItem[] = []): Rect {
  if ("w" in it) return { x: it.x, y: it.y, w: it.w, h: it.h }
  if (it.type === "text") return { x: it.x, y: it.y, w: it.text.length * 8, h: it.size === "l" ? 26 : 18 }
  const pts = it.type === "path" ? it.points : [endPoint(it.from, items), endPoint(it.to, items)]
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]), x = Math.min(...xs), y = Math.min(...ys)
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y }
}
/** A line's end as a point: as given, or its shape's centre. */
export function endPoint(e: End, items: PaperItem[]): [number, number] {
  if (Array.isArray(e)) return e
  const s = items.find((i) => i.id === e)
  if (!s) return [0, 0]
  const b = itemBox(s, items)
  return [b.x + b.w / 2, b.y + b.h / 2]
}
function shift(it: PaperItem, dx: number, dy: number) {
  if ("x" in it) { it.x += dx; it.y += dy; return }
  if (it.type === "path") { it.points = it.points.map(([x, y]) => [x + dx, y + dy]); return }
  if (it.type === "line" || it.type === "arrow") for (const k of ["from", "to"] as const) { const e = it[k]; if (Array.isArray(e)) it[k] = [e[0] + dx, e[1] + dy] }
}

/** A drawing as its agent reads it at its next ask: each mark and pad item by id, to change in place. */
export function drawingText(d: Drawing) {
  const q = (t: string) => JSON.stringify(t.length > 40 ? `${t.slice(0, 40)}…` : t)
  const at = (s?: Spot) => (!s ? "" : "area" in s ? ` at ${s.area}` : "el" in s ? ` at ${s.el}` : "find" in s ? ` at ${q(s.find)}` : "x" in s ? ` at ${Math.round(s.x)},${Math.round(s.y)}` : "")
  const item = (i: PaperItem, all: PaperItem[]) => {
    const end = (e: End) => (typeof e === "string" ? e : e.map(Math.round).join(","))
    const c = [i.color, i.fill && `fill ${i.fill}`].filter(Boolean).join(", "), tail = c ? ` (${c})` : ""
    if (i.type === "line" || i.type === "arrow") return `${i.id} ${i.type} ${end(i.from)} -> ${end(i.to)}${i.label ? ` ${q(i.label)}` : ""}${tail}`
    const b = itemBox(i, all), words = "label" in i && i.label ? ` ${q(i.label)}` : i.type === "text" ? ` ${q(i.text)}` : i.type === "svg" ? ` (${i.paths.length} paths)` : ""
    return `${i.id} ${i.type}${words} at ${Math.round(b.x)},${Math.round(b.y)} ${Math.round(b.w)}x${Math.round(b.h)}${tail}`
  }
  const lines = d.marks.filter(live).map((m) => {
    const name = `${m.id ?? "?"} ${m.type}`
    if (m.type === "paper") return [`- ${name}${m.title ? ` ${q(m.title)}` : ""} ${m.w}x${m.h}${at(m.at)}:`, ...m.items.filter(live).map((i) => `    ${item(i, m.items)}`)].join("\n")
    if (m.type === "image" || m.type === "video") return `- ${name} ${m.name ?? m.src}${m.caption ? ` ${q(m.caption)}` : ""}${at(m.at)}`
    const words = "label" in m && m.label ? ` ${q(m.label)}` : "text" in m ? ` ${q(m.text)}` : "title" in m && m.title ? ` ${q(m.title)}` : ""
    return `- ${name}${words}${"at" in m ? at(m.at) : ""}`
  })
  return lines.length ? lines.join("\n") : ""
}

// ---------- kept: a drawing as an .excalidraw scene (vau docs excalidraw)

/** The palette Excalidraw picks from, by the app's tint names. */
export const HEX: Record<string, string> = { orange: "#e8590c", blue: "#1971c2", purple: "#9c36b5", green: "#2f9e44", red: "#e03131", yellow: "#f08c00", pink: "#c2255c", teal: "#099268", gray: "#868e96" }
const INK = "#1e1e1e"
type El = Record<string, unknown>

/** A kept image's bytes, by its mark's id: a data URL, and its pixels when known. */
export type KeptFile = { dataURL: string; mime: string; px?: [number, number] }
/** What's worth keeping of `marks`: its scratch pads and cards (`all`: the marks on the screen too, where `places` knows
 *  them); `files`, the images' bytes (one without is kept as a link). Null: nothing to keep. */
export function toExcalidraw(marks: Mark[], opts: { tint?: string; places?: Record<string, Rect>; all?: boolean; files?: Record<string, KeptFile> } = {}) {
  marks = marks.filter(live)
  const tint = HEX[opts.tint ?? ""] ?? HEX.orange, els: El[] = [], files: Record<string, El> = {}
  const strokeOf = (c?: string) => (!c || c === "tint" ? tint : c === "ink" ? INK : c.startsWith("#") ? c : PALETTE[c]?.[0] ?? tint)
  const fillOf = (c?: string) => (!c || c === "none" ? "transparent" : c === "tint" ? tint : c === "ink" ? INK : c.startsWith("#") ? c : PALETTE[c]?.[1] ?? "transparent")
  let n = 0, seed = 1
  const taken = idsIn(marks)
  const id = (p: string) => { let x; do x = `${p}${++n}`; while (taken.has(x)); return x }
  const common = (x: number, y: number, w: number, h: number, more: El = {}): El =>
    ({ x: r1(x), y: r1(y), width: r1(w), height: r1(h), angle: 0, strokeColor: INK, backgroundColor: "transparent", fillStyle: "solid", strokeWidth: 2, strokeStyle: "solid",
      roughness: 1, opacity: 100, groupIds: [], frameId: null, roundness: null, seed: seed++, version: 1, versionNonce: seed * 7919, isDeleted: false, boundElements: null,
      updated: 1, link: null, locked: false, ...more })
  const text = (x: number, y: number, t: string, fontSize = 20, more: El = {}): El => {
    const lines = t.split("\n"), w = Math.max(...lines.map((l) => l.length)) * fontSize * 0.55, h = lines.length * fontSize * 1.25
    return { id: id("t"), type: "text", ...common(x, y, w, h), text: t, originalText: t, fontSize, fontFamily: 5, textAlign: "left", verticalAlign: "top", containerId: null, lineHeight: 1.25, autoResize: true, ...more }
  }
  const bind = (s: El, b: { id: unknown; type: string }) => { s.boundElements = [...((s.boundElements as El[] | null) ?? []), b] }
  const shape = (type: "rectangle" | "ellipse" | "diamond", x: number, y: number, w: number, h: number, label?: string, more: El = {}, own?: string) => {
    const s: El = { id: own ?? id(type[0]), type, ...common(x, y, w, h, { ...(type === "rectangle" ? { roundness: { type: 3 } } : {}), ...more }) }
    els.push(s)
    if (label) {
      const t = text(x, y, label, 16, { containerId: s.id, textAlign: "center", verticalAlign: "middle", strokeColor: s.backgroundColor !== "transparent" ? INK : s.strokeColor })
      Object.assign(t, { x: r1(x + w / 2 - (t.width as number) / 2), y: r1(y + h / 2 - (t.height as number) / 2) })
      bind(s, { id: t.id, type: "text" })
      els.push(t)
    }
    return s
  }
  const linear = (type: "line" | "arrow", pts: [number, number][], more: El = {}, own?: string) => {
    const [x0, y0] = pts[0], rel = pts.map(([x, y]) => [r1(x - x0), r1(y - y0)]), xs = rel.map((p) => p[0]), ys = rel.map((p) => p[1])
    const e: El = { id: own ?? id(type[0]), type, startBinding: null, endBinding: null, ...common(x0, y0, Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), more),
      points: rel, lastCommittedPoint: null, startArrowhead: null, endArrowhead: type === "arrow" ? "arrow" : null }
    els.push(e)
    return e
  }
  // (cards side by side, a row, in the order drawn)
  let cx = 0
  const GAP = 40
  for (const m of marks) {
    if (m.type === "paper") {
      const top = m.title ? 36 : 0
      if (m.title) els.push(text(cx, 0, m.title, 24))
      shape("rectangle", cx, top, m.w, m.h, undefined, { strokeColor: "#ced4da", backgroundColor: "#ffffff", roughness: 0 })
      const items = m.items.filter(live), made = new Map<string, El>()
      // (shapes first, so an arrow binds to what's drawn)
      for (const it of [...items.filter((i) => i.type !== "line" && i.type !== "arrow"), ...items.filter((i) => i.type === "line" || i.type === "arrow")]) paperEl(it, items, cx, top, made)
      cx += m.w + GAP
    } else if (m.type === "sticky") {
      shape("rectangle", cx, 0, 220, 160, undefined, { backgroundColor: "#ffec99", strokeColor: "#f08c00" })
      els.push(text(cx + 14, 14, [m.title, m.text].filter(Boolean).join("\n\n"), 18))
      cx += 220 + GAP
    } else if (m.type === "list") {
      const t = text(cx, 0, [m.title, ...m.items.map((x, i) => `${m.numbered ? `${i + 1}.` : "•"} ${x}`)].filter(Boolean).join("\n"), 18)
      els.push(t)
      cx += (t.width as number) + GAP
    } else if (m.type === "write") {
      const t = text(cx, 0, m.text, m.size === "l" ? 32 : m.size === "s" ? 16 : 22, { strokeColor: tint })
      els.push(t)
      cx += (t.width as number) + GAP
    } else if (m.type === "image" || m.type === "video") {
      const f = m.id ? opts.files?.[m.id] : undefined, px = f?.px ?? m.px ?? [16, 10], k = Math.min(1, 480 / px[0], 360 / px[1]), w = Math.round(px[0] * k), h = Math.round(px[1] * k)
      const link = /^https?:/i.test(m.src) ? m.src : m.url && !m.url.startsWith("api/companion/media/") ? m.src : null
      if (m.type === "image" && f) {
        const fileId = `f${hash16(f.dataURL)}`
        files[fileId] = { mimeType: f.mime, id: fileId, dataURL: f.dataURL, created: 1 }
        els.push({ id: id("i"), type: "image", ...common(cx, 0, w, h, { strokeColor: "transparent", roughness: 0 }), fileId, status: "saved", scale: [1, 1], link })
      } else {
        const s = shape("rectangle", cx, 0, Math.max(w, 240), Math.max(h, 120), `${m.type === "video" ? "Video" : "Image"}: ${m.name ?? m.src}`, { strokeColor: tint, roughness: 0 })
        s.link = link
      }
      if (m.caption) els.push(text(cx, Math.max(h, m.type === "video" || !f ? 120 : 0) + 10, m.caption, 16))
      cx += Math.max(w, f && m.type === "image" ? 0 : 240) + GAP
    }
  }
  function paperEl(it: PaperItem, items: PaperItem[], ox: number, oy: number, made: Map<string, El>) {
    const p = (q: [number, number]): [number, number] => [ox + q[0], oy + q[1]]
    const stroke = strokeOf(it.color), bg = fillOf(it.fill), own = it.id && !made.has(it.id) ? it.id : undefined
    const keep = (e: El) => { if (it.id) made.set(it.id, e); return e }
    if (it.type === "line" || it.type === "arrow") {
      const ends = [it.from, it.to].map((e) => (typeof e === "string" ? made.get(e) : undefined))
      const pts = [p(edgeOf(it.from, it.to, items)), p(edgeOf(it.to, it.from, items))]
      const e = linear(it.type, pts, { strokeColor: stroke,
        ...(ends[0] ? { startBinding: { elementId: ends[0].id, focus: 0, gap: 6 } } : {}), ...(ends[1] ? { endBinding: { elementId: ends[1].id, focus: 0, gap: 6 } } : {}) }, own)
      for (const s of ends) if (s) bind(s, { id: e.id, type: "arrow" })
      keep(e)
      if (it.label) {
        const t = text((pts[0][0] + pts[1][0]) / 2, (pts[0][1] + pts[1][1]) / 2 - 10, it.label, 16, { containerId: e.id, textAlign: "center", verticalAlign: "middle" })
        bind(e, { id: t.id, type: "text" }); els.push(t)
      }
    } else if (it.type === "rect" || it.type === "ellipse" || it.type === "diamond") keep(shape(it.type === "rect" ? "rectangle" : it.type, ox + it.x, oy + it.y, it.w, it.h, it.label, { strokeColor: stroke, backgroundColor: bg }, own))
    else if (it.type === "path") keep(linear("line", it.points.map(p), { strokeColor: stroke }, own))
    else if (it.type === "text") keep(els[els.push(text(ox + it.x, oy + it.y, it.text, it.size === "l" ? 28 : it.size === "s" ? 14 : 18, { strokeColor: it.color ? stroke : INK, ...(own ? { id: own } : {}) })) - 1])
    else if (it.type === "svg") {
      // (its paths as lines, fitted into its box as the screen draws them; one grouped, so it moves as one)
      const fit = svgFit(it), group = id("g")
      it.paths.forEach((sp) => {
        for (const sub of flatten(sp.d)) {
          const pts = sub.pts.map(([x, y]) => p([it.x + fit.ox + (x - fit.vx) * fit.k, it.y + fit.oy + (y - fit.vy) * fit.k]))
          const f = fillOf(sp.fill ?? it.fill)
          linear("line", pts, { strokeColor: sp.color === "none" ? "transparent" : strokeOf(sp.color ?? it.color), backgroundColor: sub.closed ? f : "transparent",
            strokeWidth: Math.max(1, Math.min(4, sp.width ?? 2)), roughness: it.style === "sketch" ? 1 : 0, groupIds: [group], roundness: null })
        }
      })
    } else if (it.type === "chart") {
      const top = Math.max(...it.values, 0), low = Math.min(...it.values, 0), span = top - low || 1, step = it.w / it.values.length
      const yOf = (v: number) => oy + it.y + it.h - ((v - low) / span) * it.h
      if (it.kind === "bar") it.values.forEach((v, i) => shape("rectangle", ox + it.x + i * step + step * 0.15, Math.min(yOf(v), yOf(0)), step * 0.7, Math.abs(yOf(v) - yOf(0)), undefined, { strokeColor: stroke, backgroundColor: stroke, fillStyle: "hachure", roundness: null }))
      else linear("line", it.values.map((v, i): [number, number] => [ox + it.x + i * step + step / 2, yOf(v)]), { strokeColor: stroke })
      it.labels?.forEach((l, i) => els.push(text(ox + it.x + i * step + 2, oy + it.y + it.h + 4, l, 12)))
    }
  }
  if (opts.all) {
    // (the marks on the screen, under the cards, where they were: their places as the overlay found them)
    const below = 260, stroke = tint
    for (const m of marks) {
      const r = "at" in m && m.at ? rectOf(m.at, opts.places) : null
      const o = (q: Rect): Rect => ({ ...q, y: q.y + below })
      if (m.type === "connect") {
        const a = rectOf(m.from, opts.places), b = rectOf(m.to, opts.places)
        if (a && b) linear("arrow", [[a.x + a.w / 2, a.y + a.h / 2 + below], [b.x + b.w / 2, b.y + b.h / 2 + below]], { strokeColor: stroke })
        continue
      }
      if (!r || CARDS.has(m.type)) continue
      const q = o(r)
      if (m.type === "ring") shape("ellipse", q.x - 10, q.y - 10, q.w + 20, q.h + 20, undefined, { strokeColor: stroke })
      else if (m.type === "frame" || m.type === "spotlight") shape("rectangle", q.x - 6, q.y - 6, q.w + 12, q.h + 12, undefined, { strokeColor: stroke, roundness: null })
      else if (m.type === "underline") linear("line", [[q.x, q.y + q.h + 4], [q.x + q.w, q.y + q.h + 4]], { strokeColor: stroke })
      else if (m.type === "strike") linear("line", [[q.x, q.y + q.h / 2], [q.x + q.w, q.y + q.h / 2]], { strokeColor: stroke })
      else if (m.type === "num") shape("ellipse", q.x - 14, q.y - 14, 28, 28, String(m.n), { strokeColor: stroke })
      else if (m.type === "point") linear("arrow", [[q.x - 50, q.y - 40], [q.x - 4, q.y - 4]], { strokeColor: stroke })
      if ("label" in m && m.label) els.push(text(q.x, q.y - 34, m.label, 16, { strokeColor: stroke }))
    }
  }
  if (!els.length) return null
  return { type: "excalidraw", version: 2, source: "vaultite", elements: els, appState: { viewBackgroundColor: "#ffffff", gridSize: null }, files }
}
const hash16 = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i += Math.max(1, s.length >> 12)) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return (h >>> 0).toString(16) + s.length.toString(16) }

/** Where an svg item's paths go in its box: their viewBox (else their own bounds) fitted in, centred. */
export function svgFit(it: Extract<PaperItem, { type: "svg" }>) {
  const vb = it.viewBox ?? boundsOf(it.paths.flatMap((p) => { try { return flatten(p.d) } catch { return [] } })) ?? [0, 0, it.w, it.h]
  const [vx, vy, vw, vh] = [vb[0], vb[1], Math.max(vb[2], 1e-6), Math.max(vb[3], 1e-6)], k = Math.min(it.w / vw, it.h / vh)
  return { vx, vy, k, ox: (it.w - vw * k) / 2, oy: (it.h - vh * k) / 2 }
}
/** A line's end on a pad: its point, or where it leaves its shape (box, ellipse or diamond) toward the other end. */
export function edgeOf(e: End, other: End, items: PaperItem[], gap = 6): [number, number] {
  if (Array.isArray(e)) return e
  const s = items.find((i) => i.id === e)
  if (!s) return [0, 0]
  const b = itemBox(s, items), c = { x: b.x + b.w / 2, y: b.y + b.h / 2 }, [tx, ty] = endPoint(other, items), dx = tx - c.x, dy = ty - c.y
  if (!dx && !dy) return [c.x, c.y]
  const rx = b.w / 2 + gap, ry = b.h / 2 + gap
  const k = s.type === "ellipse" ? 1 / Math.hypot(dx / rx, dy / ry) : s.type === "diamond" ? 1 / (Math.abs(dx) / rx + Math.abs(dy) / ry)
    : Math.min(dx ? rx / Math.abs(dx) : Infinity, dy ? ry / Math.abs(dy) : Infinity)
  return [c.x + dx * Math.min(1, k), c.y + dy * Math.min(1, k)]
}
const r1 = (v: number) => Math.round(v * 10) / 10
