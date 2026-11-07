// The summoned companion's words as it writes them: plain text, spoken as it streams, with tags inline for pointing and
// marks ("It's this one [point a3], and you send it from here [ring a5 "Send"]."). No Node: the tests read it too.
import { sentences } from "./screenmarks.ts"

/** Where a tag points: an element the ask listed (a3), a screen point or rect, words to find, a pane, the app's UI, a
 *  page's element (e12). */
export type Spot = { ax: string } | { sx: number; sy: number; w?: number; h?: number } | { find: string } | { pane: string } | { ui: string } | { el: string }
export const MARKS = ["ring", "frame", "underline", "strike", "check", "cross", "spotlight", "num", "scroll", "arrow", "connect"] as const
export type Tag = { kind: "point" | typeof MARKS[number]; at: Spot; to?: Spot; label?: string; n?: number; dir?: string
  /** Where it sits in the words said: its offset there. */
  offset: number }
const KINDS = new Set<string>(["point", ...MARKS])
/** A tag longer than this isn't one: its bracket is words. */
const LONGEST = 160
/** A tag naming its kind (`[frame "…"`) is one however long its words: never said aloud, up to this. */
const KIND_LONGEST = 800

/** `text` so far as said (its tags out, the words around them joined) and its tags, complete ones only. A tag still
 *  being written holds back what follows it, so what's said only grows. */
export function parseTags(text: string): { said: string; tags: Tag[] } {
  // (`joined`: where the last tag said in its words' place ended, so "[A] and [B] do x" says both)
  let said = "", i = 0, joined = -1
  const tags: Tag[] = []
  while (i < text.length) {
    const open = text.indexOf("[", i)
    if (open < 0) { said += text.slice(i); break }
    said += text.slice(i, open)
    const close = text.indexOf("]", open)
    const head = /^\[\s*([a-z]*)/i.exec(text.slice(open, open + 12))?.[1].toLowerCase() ?? ""
    const maybe = head === "" ? text.length - open < 2 : [...KINDS].some((k) => k.startsWith(head))
    // (being written: held back till it closes, or it's clearly words)
    const kind = KINDS.has(head) && /^\[\s*[a-z]+(?=[\s\]])/i.test(text.slice(open, open + 14)), most = kind ? KIND_LONGEST : LONGEST
    if (close < 0) { if ((maybe || kind) && text.length - open <= most) { said = said.trimEnd(); break } said += text.slice(open); break }
    const tag = close - open <= most && KINDS.has(head) ? tagOf(head, text.slice(open + 1 + text.slice(open + 1).search(/[a-z]/i) + head.length, close)) : null
    // (a tag it meant but got wrong is dropped, never read out)
    if (!tag && kind && close - open <= most) { said = said.trimEnd(); i = close + 1; continue }
    if (!tag) { said += text.slice(open, close + 1); i = close + 1; continue }
    const lead = /(^|[.:;!?\n-])\s*$/.test(said) || (joined >= 0 && !/[.!?]/.test(said.slice(joined)) && /(,|\band|\bor)\s*$/i.test(said))
    said = said.trimEnd()
    tags.push({ ...tag, offset: said.length })
    i = close + 1
    const name = lead ? nameSaid(tag, text.slice(i)) : null
    if (name === undefined) break
    if (name) { said += (said ? " " : "") + name; joined = said.length }
    // (the words on each side of it, a space between them unless punctuation follows)
    if (said && i < text.length && !/^[\s.,;:!?)…]/.test(text.slice(i))) said += " "
  }
  return { said: said.replace(/^\s+/, "").replace(/[ \t]{2,}/g, " ").replace(/ +([.,;:!?])/g, "$1"), tags }
}

/** A tag starting its clause with no subject after it ("[ring "Discard"] throws it away"): its words said in its place,
 *  as it meant them; null: not; undefined: can't tell yet (what follows may still be its words again). */
function nameSaid(t: Omit<Tag, "offset">, rest: string): string | null | undefined {
  const name = t.kind === "arrow" || t.kind === "connect" ? "" : t.label ?? ("find" in t.at ? t.at.find.trim() : "")
  const r = rest.trimStart(), head = r.slice(0, name.length).toLowerCase()
  if (!name || !r || head === name.toLowerCase()) return null
  if (r.length < name.length && name.toLowerCase().startsWith(head)) return undefined
  return /^\p{Ll}/u.test(r) ? name : null
}

function tagOf(kind: string, args: string): Omit<Tag, "offset"> | null {
  const words: string[] = [], quoted: string[] = []
  for (const m of args.matchAll(/"([^"]*)"|“([^”]*)”|(\S+)/g)) { if (m[3] !== undefined) words.push(m[3]); else quoted.push(m[1] ?? m[2] ?? "") }
  const spots = words.map(spotOf).filter((s): s is Spot => !!s), label = quoted.find((q) => q.trim())?.trim()
  if (kind === "point") {
    const at = spots[0] ?? (label ? { find: label } : null)
    return at ? { kind, at, ...(spots[0] && label ? { label } : {}) } : null
  }
  // (a mark with words alone, [ring "Send"]: at the thing on the screen saying them)
  const at = spots[0] ?? (label ? { find: label } : null)
  if (!at) return null
  if (kind === "arrow" || kind === "connect") {
    const ends = [...spots, ...quoted.map((q) => q.trim()).filter(Boolean).map((q) => ({ find: q }))]
    return ends[1] ? { kind, at: ends[0], to: ends[1], ...(spots.length >= 2 && label ? { label } : {}) } : null
  }
  if (kind === "num") { const n = words.map(Number).find((x) => Number.isInteger(x) && x > 0 && x < 100); return { kind, at, n: n ?? 1 } }
  if (kind === "scroll") return { kind, at, dir: words.find((w) => /^(up|down|left|right)$/i.test(w))?.toLowerCase() ?? "down" }
  return { kind: kind as Tag["kind"], at, ...(spots[0] && label && (kind === "ring" || kind === "frame") ? { label } : {}) }
}

function spotOf(w: string): Spot | null {
  if (/^a\d+$/.test(w)) return { ax: w }
  if (/^e\d+$/.test(w)) return { el: w }
  const xy = /^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)(?:,(\d+(?:\.\d+)?),(\d+(?:\.\d+)?))?$/.exec(w)
  if (xy) return { sx: Math.round(+xy[1]), sy: Math.round(+xy[2]), ...(xy[3] ? { w: Math.round(+xy[3]), h: Math.round(+xy[4]) } : {}) }
  const m = /^(pane|ui|el):(.+)$/.exec(w)
  if (m) return m[1] === "pane" ? { pane: m[2] } : m[1] === "ui" ? { ui: m[2] } : { el: m[2] }
  return null
}

/** A point tag's place, as say and look take one. */
export function placeOf(s: Spot): Record<string, unknown> {
  if ("ax" in s) return { ax: s.ax }
  if ("sx" in s) return { sx: s.w ? s.sx + Math.round(s.w / 2) : s.sx, sy: s.h ? s.sy + Math.round(s.h / 2) : s.sy }
  return { ...s }
}

/** The sentence of `said` a tag at `offset` goes with (0 the first): the one it's in, or the next when it's between. */
export function beatOf(said: string, offset: number) {
  const before = said.slice(0, offset), n = sentences(before).length
  return !n ? 0 : /[.!?…:]\s*$/.test(before) ? n : n - 1
}

/** A mark tag as draw's marks have it (screenmarks.ts), with its beat; null for a point (its cursor flies there). */
export function markOf(t: Tag, beat?: number): Record<string, unknown> | null {
  const spot = (s: Spot) => ("ax" in s ? { el: s.ax } : "sx" in s ? (s.w ? [s.sx, s.sy, s.w, s.h] : [s.sx, s.sy]) : s)
  if (t.kind === "point") return null
  const at = spot(t.at)
  if (!at) return null
  const b = beat ? { beat: Math.min(50, beat) } : {}
  if (t.kind === "arrow" || t.kind === "connect") { const to = t.to ? spot(t.to) : null; return to ? { type: "connect", from: at, to, ...(t.label ? { label: t.label } : {}), ...b } : null }
  return { type: t.kind, at, ...(t.label ? { label: t.label } : {}), ...(t.n !== undefined ? { n: t.n } : {}), ...(t.dir ? { dir: t.dir } : {}), ...b }
}
