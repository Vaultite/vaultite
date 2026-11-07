// What the companion draws over the screen (companion draw --marks): marks as data, checked here for the server and the
// overlay alike (no Node, no DOM), and a drawing kept as an .excalidraw scene. web/src/screendraw draws them.
import { sayable, speakable } from "./spoken.ts"

/** A rectangle in screen points (a point: w and h 0); an element's, with what it says. */
export type Rect = { x: number; y: number; w: number; h: number; label?: string }
/** Where a mark goes: a point or a box (screen points), an element of the ask (`el`, its id), a pane or the app's UI, or
 *  words to find on the screen (`find`: an element saying them, else where the window shows them). */
export type Spot = Rect | { el: string } | { pane: string } | { ui: string } | { find: string }
export type Action = { copy: string } | { open: string } | { ask: string }
type Base = { beat?: number }
export type PaperItem =
  | { type: "line" | "arrow"; from: [number, number]; to: [number, number]; label?: string }
  | { type: "rect" | "ellipse"; x: number; y: number; w: number; h: number; label?: string }
  | { type: "path"; points: [number, number][] }
  | { type: "text"; x: number; y: number; text: string; size?: Size }
  | { type: "chart"; kind: "bar" | "line"; x: number; y: number; w: number; h: number; values: number[]; labels?: string[] }
export type Size = "s" | "m" | "l"
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
  | { type: "open"; at?: Spot; url: string; label?: string })
export type MarkType = Mark["type"]
/** A drawing as the overlay gets it: an agent's marks, the words they're timed with (`caption`, its sentences the
 *  beats), and the screen rects of its places (`places`: "el:e12", "pane:t3", "ui:tab:t3"). */
export type Drawing = { id: string; agent: string; tint: string; t: number; marks: Mark[]; caption?: string; places?: Record<string, Rect>; kept?: string
  /** Its caption's sentences as they're heard aloud (the companion's voice): when each began (ms, the clock's) and how
   *  long it took; null, not heard (yet). The pen draws each beat while its sentence is heard; `waits`, still being said. */
  spoken?: (Spoken | null)[]; waits?: boolean }
export type Spoken = { at: number; dur: number }

export const MARK_TYPES: MarkType[] = ["point", "ring", "frame", "underline", "strike", "connect", "num", "check", "cross", "spotlight", "scroll", "write", "paper", "sticky", "list", "button", "copy", "open"]
/** Cards: placed on calm space when they have no `at`. */
export const CARDS = new Set<MarkType>(["write", "paper", "sticky", "list", "button", "copy", "open"])
export const MOST = { marks: 40, items: 60, points: 200, values: 24, list: 12, label: 60, text: 300, copy: 4000, paper: [720, 520] as const }
export const PAPER = { w: 360, h: 240 }

/** The vocabulary in a few lines, for the op's help and the docs. */
export const VOCABULARY = `Spots: {"el": "<id>"} (an element of the ask: snaps to its frame; the best), {"find": "<words>"} (the thing on the screen saying them now, by their pointer), {"pane": "<id>"} or {"ui": "tab:<id>"} in the app; [x, y, w, h] or [x, y] in screen points only for what has none (a bare point snaps to a frame round what they drew there, else to the element there).
On the screen: point, ring, frame (a thing or an area boxed, the whole of it: what it is), underline, strike, check, cross, spotlight {at, label?}; num {at, n}; scroll {at, dir}; connect {from, to, label?}.
On calm space (at optional): write {text, size: s|m|l}; paper {w, h, title?, grid?, items}: its items in its own units (0,0 its top left): line|arrow {from: [x,y], to}, rect|ellipse {x,y,w,h,label?}, path {points}, text {x,y,text}, chart {kind: bar|line, x,y,w,h, values, labels?}; sticky {text, title?}; list {items, title?, numbered?}.
Actions: copy {text}, open {url}, button {label, do: {copy}|{open}|{ask: "<follow-up>"}}.
Every mark may say beat: the sentence of your words (0 the first) it appears with.`

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
  const label = () => (m.label === undefined ? {} : { label: words(m.label, "label", MOST.label) })
  const card = () => (m.at === undefined ? {} : { at: spot(m.at, "at") })
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
    case "paper": {
      const w = m.w === undefined ? PAPER.w : m.w, h = m.h === undefined ? PAPER.h : m.h
      if (!num(w) || !num(h) || (w as number) < 80 || (h as number) < 60 || (w as number) > MOST.paper[0] || (h as number) > MOST.paper[1]) throw new Error(`w, h: its size, 80x60 to ${MOST.paper.join("x")} (default ${PAPER.w}x${PAPER.h})`)
      if (!Array.isArray(m.items) || m.items.length > MOST.items) throw new Error(`items: a list of up to ${MOST.items} things on it`)
      return { ...base, type, ...card(), w: w as number, h: h as number, ...(m.title === undefined ? {} : { title: words(m.title, "title", MOST.label) }), ...(m.grid ? { grid: true } : {}),
        items: m.items.map((x, i) => { try { return paperItem(x, w as number, h as number) } catch (e) { throw new Error(`items[${i}]: ${(e as Error).message}`) } }) }
    }
  }
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
/** A spot as given: [x, y], [x, y, w, h], {x, y, w?, h?}, {el}, {pane}, {ui}. */
function spot(v: unknown, what: string): Spot {
  const how = `${what}: {"el": "<id>"}, {"find": "<words>"}, {"pane": "<id>"}, {"ui": "<id>"}, [x, y, w, h] or [x, y] (screen points)`
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
function paperItem(v: unknown, w: number, h: number): PaperItem {
  if (!isObj(v)) throw new Error("an item is an object: {\"type\": ..., ...}")
  const label = v.label === undefined ? {} : { label: words(v.label, "label", MOST.label) }
  switch (v.type) {
    case "line": case "arrow": return { type: v.type, from: pt(v.from, "from", w, h), to: pt(v.to, "to", w, h), ...label }
    case "rect": case "ellipse": return { type: v.type, ...box(v, w, h), ...label }
    case "path": {
      if (!Array.isArray(v.points) || v.points.length < 2 || v.points.length > MOST.points) throw new Error(`points: 2 to ${MOST.points} [x, y]`)
      return { type: "path", points: v.points.map((p, i) => pt(p, `points[${i}]`, w, h)) }
    }
    case "text": {
      if (!num(v.x) || !num(v.y)) throw new Error("x, y: where it starts")
      return { type: "text", x: v.x as number, y: v.y as number, text: words(v.text, "text", MOST.text), ...size(v.size) }
    }
    case "chart": {
      if (v.kind !== "bar" && v.kind !== "line") throw new Error("kind: bar or line")
      if (!Array.isArray(v.values) || !v.values.length || v.values.length > MOST.values || !v.values.every((n) => num(n) && Math.abs(n) < 1e12)) throw new Error(`values: 1 to ${MOST.values} numbers`)
      const b = v.x === undefined ? { x: 16, y: 16, w: w - 32, h: h - 32 } : box(v, w, h)
      if (v.labels !== undefined && (!Array.isArray(v.labels) || v.labels.length !== v.values.length)) throw new Error("labels: one per value")
      return { type: "chart", kind: v.kind, ...b, values: v.values as number[], ...(v.labels ? { labels: (v.labels as unknown[]).map((l, i) => words(String(l), `labels[${i}]`, 24)) } : {}) }
    }
  }
  throw new Error("type is one of line, arrow, rect, ellipse, path, text, chart")
}

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
  return s
}

/** Why each of `marks` can't show, null where it can: its spot found nowhere (`places` lacks it), or its box off every
 *  one of `displays` (screen points; none known, not checked). A card with no spot goes on calm space: it shows. */
export function unshown(marks: Mark[], places: Record<string, Rect> = {}, displays: Rect[] = []): (string | null)[] {
  const on = (r: Rect) => displays.some((d) => r.x + r.w >= d.x && r.x <= d.x + d.w && r.y + r.h >= d.y && r.y <= d.y + d.h)
  return marks.map((m) => {
    for (const s of "from" in m ? [m.from, m.to] : "at" in m && m.at ? [m.at] : []) {
      const r = rectOf(s, places)
      if (!r) return "el" in s ? `found nothing: ${s.el} isn't an element the ask listed` : "found nothing there"
      if (displays.length && !on(r)) return `at ${Math.round(r.x)},${Math.round(r.y)} is off their screen`
    }
    return null
  })
}

const norm = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()
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

// ---------- kept: a drawing as an .excalidraw scene (vau docs excalidraw)

/** The palette Excalidraw picks from, by the app's tint names. */
export const HEX: Record<string, string> = { orange: "#e8590c", blue: "#1971c2", purple: "#9c36b5", green: "#2f9e44", red: "#e03131", yellow: "#f08c00", pink: "#c2255c", teal: "#099268", gray: "#868e96" }
const INK = "#1e1e1e"
type El = Record<string, unknown>

/** What's worth keeping of `marks`: its scratch pads and cards (`all`: the marks on the screen too, where `places` knows
 *  them). Null: nothing to keep. */
export function toExcalidraw(marks: Mark[], opts: { tint?: string; places?: Record<string, Rect>; all?: boolean } = {}) {
  const stroke = HEX[opts.tint ?? ""] ?? HEX.orange, els: El[] = []
  let n = 0, seed = 1
  const id = (p: string) => `${p}${++n}`
  const common = (x: number, y: number, w: number, h: number, more: El = {}): El =>
    ({ x: r1(x), y: r1(y), width: r1(w), height: r1(h), angle: 0, strokeColor: INK, backgroundColor: "transparent", fillStyle: "solid", strokeWidth: 2, strokeStyle: "solid",
      roughness: 1, opacity: 100, groupIds: [], frameId: null, roundness: null, seed: seed++, version: 1, versionNonce: seed * 7919, isDeleted: false, boundElements: null,
      updated: 1, link: null, locked: false, ...more })
  const text = (x: number, y: number, t: string, fontSize = 20, more: El = {}): El => {
    const lines = t.split("\n"), w = Math.max(...lines.map((l) => l.length)) * fontSize * 0.55, h = lines.length * fontSize * 1.25
    return { id: id("t"), type: "text", ...common(x, y, w, h), text: t, originalText: t, fontSize, fontFamily: 5, textAlign: "left", verticalAlign: "top", containerId: null, lineHeight: 1.25, autoResize: true, ...more }
  }
  const shape = (type: "rectangle" | "ellipse", x: number, y: number, w: number, h: number, label?: string, more: El = {}) => {
    const s: El = { id: id(type[0]), type, ...common(x, y, w, h, more) }
    els.push(s)
    if (label) {
      const t = text(x, y, label, 16, { containerId: s.id, textAlign: "center", verticalAlign: "middle" })
      Object.assign(t, { x: r1(x + w / 2 - (t.width as number) / 2), y: r1(y + h / 2 - (t.height as number) / 2) })
      s.boundElements = [{ id: t.id, type: "text" }]
      els.push(t)
    }
  }
  const linear = (type: "line" | "arrow", pts: [number, number][], more: El = {}) => {
    const [x0, y0] = pts[0], rel = pts.map(([x, y]) => [r1(x - x0), r1(y - y0)]), xs = rel.map((p) => p[0]), ys = rel.map((p) => p[1])
    els.push({ id: id(type[0]), type, ...common(x0, y0, Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), more), points: rel, lastCommittedPoint: null,
      startBinding: null, endBinding: null, startArrowhead: null, endArrowhead: type === "arrow" ? "arrow" : null })
  }
  // (cards side by side, a row, in the order drawn)
  let cx = 0
  const GAP = 40
  for (const m of marks) {
    if (m.type === "paper") {
      const top = m.title ? 36 : 0
      if (m.title) els.push(text(cx, 0, m.title, 24))
      shape("rectangle", cx, top, m.w, m.h, undefined, { strokeColor: "#ced4da", backgroundColor: "#ffffff", roughness: 0, roundness: { type: 3 } })
      for (const it of m.items) paperEl(it, cx, top)
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
      const t = text(cx, 0, m.text, m.size === "l" ? 32 : m.size === "s" ? 16 : 22, { strokeColor: stroke })
      els.push(t)
      cx += (t.width as number) + GAP
    }
  }
  function paperEl(it: PaperItem, ox: number, oy: number) {
    const p = (q: [number, number]): [number, number] => [ox + q[0], oy + q[1]]
    if (it.type === "line" || it.type === "arrow") {
      linear(it.type, [p(it.from), p(it.to)], { strokeColor: stroke })
      if (it.label) els.push(text(ox + (it.from[0] + it.to[0]) / 2, oy + (it.from[1] + it.to[1]) / 2 - 22, it.label, 16))
    } else if (it.type === "rect" || it.type === "ellipse") shape(it.type === "rect" ? "rectangle" : "ellipse", ox + it.x, oy + it.y, it.w, it.h, it.label, { strokeColor: stroke })
    else if (it.type === "path") linear("line", it.points.map(p), { strokeColor: stroke })
    else if (it.type === "text") els.push(text(ox + it.x, oy + it.y, it.text, it.size === "l" ? 28 : it.size === "s" ? 14 : 18))
    else if (it.type === "chart") {
      const top = Math.max(...it.values, 0), low = Math.min(...it.values, 0), span = top - low || 1, step = it.w / it.values.length
      const yOf = (v: number) => oy + it.y + it.h - ((v - low) / span) * it.h
      if (it.kind === "bar") it.values.forEach((v, i) => shape("rectangle", ox + it.x + i * step + step * 0.15, Math.min(yOf(v), yOf(0)), step * 0.7, Math.abs(yOf(v) - yOf(0)), undefined, { strokeColor: stroke, backgroundColor: stroke, fillStyle: "hachure" }))
      else linear("line", it.values.map((v, i): [number, number] => [ox + it.x + i * step + step / 2, yOf(v)]), { strokeColor: stroke })
      it.labels?.forEach((l, i) => els.push(text(ox + it.x + i * step + 2, oy + it.y + it.h + 4, l, 12)))
    }
  }
  if (opts.all) {
    // (the marks on the screen, under the cards, where they were: their places as the overlay found them)
    const below = 260
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
      else if (m.type === "frame" || m.type === "spotlight") shape("rectangle", q.x - 6, q.y - 6, q.w + 12, q.h + 12, undefined, { strokeColor: stroke })
      else if (m.type === "underline") linear("line", [[q.x, q.y + q.h + 4], [q.x + q.w, q.y + q.h + 4]], { strokeColor: stroke })
      else if (m.type === "strike") linear("line", [[q.x, q.y + q.h / 2], [q.x + q.w, q.y + q.h / 2]], { strokeColor: stroke })
      else if (m.type === "num") shape("ellipse", q.x - 14, q.y - 14, 28, 28, String(m.n), { strokeColor: stroke })
      else if (m.type === "point") linear("arrow", [[q.x - 50, q.y - 40], [q.x - 4, q.y - 4]], { strokeColor: stroke })
      if ("label" in m && m.label) els.push(text(q.x, q.y - 34, m.label, 16, { strokeColor: stroke }))
    }
  }
  if (!els.length) return null
  return { type: "excalidraw", version: 2, source: "vaultite", elements: els, appState: { viewBackgroundColor: "#ffffff", gridSize: null }, files: {} }
}
const r1 = (v: number) => Math.round(v * 10) / 10
