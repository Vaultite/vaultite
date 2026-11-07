// Region capture's rules (the desktop app's capture.ts runs them, captures.ts sends what it made): what a Talk key's
// words ask of it, the box a drag makes and its moves over a clip, their words by time. No Electron: the tests read it.
export type Rect = { x: number; y: number; width: number; height: number }
export type Point = { x: number; y: number }
/** The box from `t` on (ms since 1970), in screen points: a clip is cropped to the box as it was at each moment. */
export type BoxAt = { t: number; rect: Rect }
/** The box as the overlay draws it: `recording` since when, `saving` while its clip is made, `replay`: the last
 *  seconds are kept (its button sends them). */
export type RegionScene = { rect: Rect; tint: string; recording?: number; saving?: boolean; replay?: boolean }
/** Their words over a clip, `t` ms from its start. */
export type Narration = { t: number; text: string }

/** How far back "that, just now" reaches (ms), and the longest recording (it stops and sends itself). */
export const REPLAY_MS = 25_000, RECORD_MOST_MS = 180_000
/** A drag smaller than this either way is a slip, not a box (points). */
export const BOX_LEAST = 24

/** What a Talk key's words ask of capture, and the rest of them (what they said after it, kept as narration):
 *  `record` starts a clip of the box, `stop` ends one, `replay` takes the last seconds. Null: an ask like any. */
export function captureCommand(text: string, recording: boolean): { do: "record" | "stop" | "replay"; rest: string } | null {
  const t = text.trim().replace(/\s+/g, " ")
  const lead = String.raw`^(?:(?:ok(?:ay)?|hey|so|now|please|and|alright|right)[,.!]?\s+)*(?:(?:can|could|would) you\s+)?`
  const m = (re: string) => new RegExp(`${lead}${re}(?=$|[\\s,.!?:;])[\\s,.!?:;]*`, "i").exec(t)
  const rest = (x: RegExpExecArray) => t.slice(x[0].length).trim()
  if (recording) {
    const stop = m(String.raw`(?:stop(?: recording| the recording| it| now)?|that's it|that is it|done(?: recording)?|end (?:it|the recording)|cut|send it)`)
    // (while it records, anything else they say is narration: never an ask)
    return stop ? { do: "stop", rest: rest(stop) } : null
  }
  const replay = m(String.raw`(?:(?:look at |see |send |catch |grab |record )?(?:that|this)[,.]?\s+just now|what just happened|did you (?:see|catch) that|(?:send|grab|catch) (?:that|the last (?:few )?seconds))`)
  if (replay) return { do: "replay", rest: rest(replay) }
  const record = m(String.raw`(?:(?:start )?record(?:ing)?(?: (?:this|that|it|here|the box))?|watch this)`)
  return record ? { do: "record", rest: rest(record) } : null
}

/** A box from a drag's two corners, kept on the display it began on; null: too small to be meant. */
export function boxOf(a: Point, b: Point, display?: Rect): Rect | null {
  let x = Math.min(a.x, b.x), y = Math.min(a.y, b.y), x2 = Math.max(a.x, b.x), y2 = Math.max(a.y, b.y)
  if (display) {
    x = Math.max(x, display.x); y = Math.max(y, display.y)
    x2 = Math.min(x2, display.x + display.width); y2 = Math.min(y2, display.y + display.height)
  }
  const r = { x: Math.round(x), y: Math.round(y), width: Math.round(x2 - x), height: Math.round(y2 - y) }
  return r.width >= BOX_LEAST && r.height >= BOX_LEAST ? r : null
}

/** The box's moves since `from`: the one in place then, and each after it (`at`: when the clip ends). */
export function boxesSince(boxes: BoxAt[], from: number, at = Infinity): BoxAt[] {
  const before = boxes.filter((b) => b.t <= from).at(-1)
  const after = boxes.filter((b) => b.t > from && b.t <= at)
  return [...(before ? [{ t: from, rect: before.rect }] : []), ...after]
}
/** A box move (as it's dragged, many a second): kept a tenth of a second apart at most, and none older than the one in
 *  place at `keepFrom` (what's kept of the screen begins there). */
export function boxMoved(boxes: BoxAt[], rect: Rect, t: number, keepFrom: number): BoxAt[] {
  const i = boxes.findLastIndex((b) => b.t <= keepFrom), kept = i > 0 ? boxes.slice(i) : boxes, last = kept.at(-1)
  return last && t - last.t < 100 ? [...kept.slice(0, -1), { t: last.t, rect }] : [...kept, { t, rect }]
}

/** Their words as they went, for a worker: "[3.2 s] it blinks here". */
export const narrationLines = (n: Narration[]) => n.filter((x) => x.text.trim()).map((x) => `[${(x.t / 1000).toFixed(1)} s] ${x.text.trim()}`)

/** A capture's name: their first words, else what it shows. */
export function captureTitle(n: Narration[], where: string) {
  const said = n.map((x) => x.text.trim()).find(Boolean)?.replace(/[.!?]+$/, "") ?? ""
  const t = (said || where || "Screen").replace(/[\\/:*?"<>|#^[\]]+/g, " ").replace(/\s+/g, " ").trim()
  const cut = t.length > 60 ? t.slice(0, 60).replace(/\s+\S*$/, "") : t
  return cut.charAt(0).toUpperCase() + cut.slice(1)
}

/** How long a recording has run, as its pill says it (0:04). */
export const clock = (ms: number) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` }
