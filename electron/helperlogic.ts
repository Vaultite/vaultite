// The menu-bar helper's reckoning, apart from Electron so it's tested alone (tools/test/vault/helper.ts).
import { arrowBox, boxAt, flagBox } from "../plugins/core/companion/boxes.ts"

export type Rect = { x: number; y: number; width: number; height: number }
type Decls = Record<string, { default?: unknown }>
/** `keys` dictate, `talk` talk to the companion (its own: a key in both talks). */
export type Prefs = { fn: boolean; keys: string[]; talk: string[]; privateApps: string[]; dictation: Record<string, unknown>
  /** Whether its answers are spoken (`auto`: an ask by voice), by which cloud voice first, which voices, how fast. */
  voice: { mode: "auto" | "always" | "off"; provider: "auto" | "elevenlabs" | "soniox"; name: string; eleven: { voice: string; model: string }; speed: number }
  /** Soft cues as it's summoned, sent an ask, and answers (the companion's `sounds`). */
  sounds: boolean
  /** Who hears a spoken ask and answers it first (realtimefront.ts): a realtime model, or dictation and the voice. */
  realtime: { front: "realtime" | "pipeline"; model: string; voice: string } }
/** The home vault's settings the helper follows: dictation's, the companion's and screen's data.json, their manifests'
 *  `settings` giving the defaults. */
export function prefsOf(d: Record<string, unknown>, c: Record<string, unknown>, s: Record<string, unknown>, DEFAULTS: Record<"dictation" | "companion" | "screen", Decls>): Prefs {
  const def = (from: Record<string, { default?: unknown }>, k: string) => from[k]?.default
  const val = <T>(x: unknown, fallback: T) => (x === undefined || x === null ? fallback : x as T)
  const list = (from: Record<string, unknown>, decls: Decls) => (Array.isArray(from.keys) ? from.keys.map(String) : (def(decls, "keys") as string[] | undefined) ?? [])
  const talk = list(c, DEFAULTS.companion)
  return {
    fn: val(d.fn, def(DEFAULTS.dictation, "fn") ?? true) !== false,
    keys: list(d, DEFAULTS.dictation).filter((k) => !talk.includes(k)),
    talk,
    privateApps: Array.isArray(s.private_apps) ? s.private_apps.map(String) : (def(DEFAULTS.screen, "private_apps") as string[] | undefined) ?? [],
    dictation: d,
    sounds: val(c.sounds, def(DEFAULTS.companion, "sounds") ?? true) !== false,
    voice: {
      mode: (["auto", "always", "off"] as const).find((m) => m === val(c.voice, def(DEFAULTS.companion, "voice"))) ?? "auto",
      provider: (["auto", "elevenlabs", "soniox"] as const).find((m) => m === val(c.voice_provider, def(DEFAULTS.companion, "voice_provider"))) ?? "auto",
      name: String(val(c.voice_name, def(DEFAULTS.companion, "voice_name") ?? "") || ""),
      eleven: { voice: String(val(c.elevenlabs_voice, def(DEFAULTS.companion, "elevenlabs_voice") ?? "") || ""),
        model: String(val(c.elevenlabs_model, def(DEFAULTS.companion, "elevenlabs_model") ?? "") || "") },
      speed: Math.min(1.3, Math.max(0.7, Number(val(c.voice_speed, def(DEFAULTS.companion, "voice_speed") ?? 1)) || 1)),
    },
    realtime: {
      front: val(c.voice_front, def(DEFAULTS.companion, "voice_front")) === "pipeline" ? "pipeline" : "realtime",
      model: String(val(c.realtime_model, def(DEFAULTS.companion, "realtime_model") ?? "") || "gpt-realtime-2.1-mini"),
      voice: String(val(c.realtime_voice, def(DEFAULTS.companion, "realtime_voice") ?? "") || "cedar"),
    },
  }
}

/** The dictation keys heard: none while Dictate anywhere is off. */
export const dictationKeys = (p: Pick<Prefs, "fn" | "keys">) => (p.fn ? p.keys : [])
/** What the screen helper's tap hears: the dictation keys and the Talk keys, which turning dictation off never takes. */
export const tappedKeys = (p: Pick<Prefs, "fn" | "keys" | "talk">) => [...dictationKeys(p), ...p.talk]

/** Where on screen an element (or a window) is: by its left edge's middle, an element; a window, by its title bar. */
export function pointIn(r: Rect, element: boolean) {
  return element ? { x: r.x + Math.min(16, r.width / 2), y: r.y + r.height / 2 } : { x: r.x + r.width / 2, y: r.y + 12 }
}

/** An agent's cursor at a point of the screen (global points): its bubble, its state (`t`: when it last acted); `from`:
 *  glided in from; `leaving`: into the app's window; `target`: what it points at, which its words never cover. */
export type ScreenAgent = { name: string; tint: string; state: string; sx: number; sy: number; t?: number; seen?: boolean; why?: string; from?: Point; leaving?: boolean
  target?: Rect; say?: { id: string; text: string; question?: boolean } }
export type Point = { x: number; y: number }
/** The companion called up by a Talk key, listening (its words as they come) or thinking; `follow`: in its exchange, it
 *  rides beside the pointer on every display (the overlay's feed); `aim`: what it points at, which it flies to. */
export type Summoned = { name: string; tint: string; state: "listening" | "thinking" | "watching" | "missed"; sx: number; sy: number; words?: string; from?: Point; leaving?: boolean
  /** Its press went nowhere: what it says a moment. */
  missed?: string
  follow?: boolean; aim?: { id: string; x: number; y: number }
  /** Listening, how loud they are (0 to 1). */
  level?: number }
/** What the overlay draws: cursors, the companion summoned (the pointer's trail while its key is held: the overlay draws
 *  it from its feed), and dictation's box, under the menu bar of the pointer's display. */
export type Scene = {
  agents: ScreenAgent[]
  summon: Summoned | null
  /** `text`: the words settled so far, `pending` those still changing; `hint`: a word for a moment, nothing heard; `free`:
   *  hands-free, on till the next press. */
  pill: { level: number; text: string; pending?: string; ready: boolean; free?: boolean; hint?: boolean } | null
  /** The cursor whose answer is being said aloud (its name), and how loud it is now (0 to 1). */
  speaking?: { name: string; level: number } | null
}
type Display = { id: number; bounds: Rect; workArea?: Rect }
const inside = (d: Display, x: number, y: number) => x >= d.bounds.x && x < d.bounds.x + d.bounds.width && y >= d.bounds.y && y < d.bounds.y + d.bounds.height
/** What one display shows, in its own coordinates: a cursor on its way from or to it too. */
export function sceneFor(d: Display, s: Scene, pointer: Point, all: Display[]) {
  const on = (x: number, y: number) => inside(d, x, y)
  const here = (a: { sx: number; sy: number; from?: Point }) => on(a.sx, a.sy) || (!!a.from && on(a.from.x, a.from.y))
  const dx = d.bounds.x, dy = d.bounds.y
  const local = <T extends { sx: number; sy: number; from?: Point; target?: Rect; aim?: { id: string; x: number; y: number } }>(a: T) =>
    ({ ...a, sx: a.sx - dx, sy: a.sy - dy, ...(a.from ? { from: { x: a.from.x - dx, y: a.from.y - dy } } : {}), ...(a.target ? { target: { ...a.target, x: a.target.x - dx, y: a.target.y - dy } } : {}),
      ...(a.aim ? { aim: { ...a.aim, x: a.aim.x - dx, y: a.aim.y - dy } } : {}) })
  const pillHere = !!s.pill && (on(pointer.x, pointer.y) || !all.some((x) => inside(x, pointer.x, pointer.y)))
  return {
    width: d.bounds.width, height: d.bounds.height,
    // (the menu bar's height: what goes above a cursor stays under it)
    top: d.workArea ? Math.max(0, d.workArea.y - d.bounds.y) : 0,
    agents: s.agents.filter(here).map(local),
    // (riding with the pointer, it's on every display: each draws it while it's there)
    summon: s.summon && (s.summon.follow || here(s.summon)) ? local(s.summon) : null,
    pill: pillHere ? s.pill : null,
    speaking: s.speaking ?? null,
  }
}
export type DisplayScene = ReturnType<typeof sceneFor>

/** A display's scene as what it draws (`shape`, compared as text) and where (`at`): while only places change (the
 *  pointer, a window moved), only `at` goes to the window. */
export function splitScene(s: DisplayScene) {
  // (its voice's level and theirs as it listens change many times a second: places, not a shape)
  const shape = JSON.stringify({ ...s, speaking: s.speaking ? { name: s.speaking.name } : null, agents: s.agents.map(({ sx: _x, sy: _y, from: _f, target: _t, ...a }) => a),
    summon: s.summon && { ...s.summon, sx: 0, sy: 0, from: undefined, level: s.summon.level === undefined ? undefined : 0 } })
  const at = { agents: Object.fromEntries(s.agents.map((a) => [a.name, [a.sx, a.sy, ...(a.target ? [a.target.x, a.target.y, a.target.width, a.target.height] : [])]])), summon: s.summon ? [s.summon.sx, s.summon.sy] : null,
    ...(s.speaking ? { level: s.speaking.level } : {}), ...(s.summon?.level !== undefined ? { hear: s.summon.level } : {}) }
  return { shape, at }
}

/** What the pointer drew while the Talk key was held: its trail's last `keep` ms before `until` (what still showed),
 *  in strokes where it paused (`gap` ms still), each long enough to be meant. */
export function trailStrokes(samples: (Point & { t: number })[], until: number, keep = 2000, gap = 250): Point[][] {
  const out: Point[][] = []
  let last = -Infinity
  for (const p of samples) {
    if (p.t < until - keep || p.t > until) continue
    if (p.t - last > gap || !out.length) out.push([])
    out.at(-1)!.push({ x: p.x, y: p.y })
    last = p.t
  }
  return out.filter((k) => k.slice(1).reduce((n, p, i) => n + Math.hypot(p.x - k[i].x, p.y - k[i].y), 0) >= 24)
}
/** What of the trail was meant as a drawing: rings round something and underlines (or strikes); the way the pointer
 *  went to point at a thing, a wander or a twitch is no drawing. */
export function drawnShapes(ink: ReturnType<typeof inkOf>) {
  return ink.filter((k) => (k.shape === "ring" && Math.min(k.box.width, k.box.height) >= 14 && Math.max(k.box.width, k.box.height) <= 900) ||
    (k.shape === "underline" && k.box.width >= 40 && k.box.height <= 14))
}
/** Where a stroke comes back round on itself (a ring drawn after the way there): the index the loop starts at, or -1. */
function loopAt(k: Point[]) {
  const pts = simplify(k, 2)
  for (let j = 3; j < pts.length; j++) {
    let run = 0
    for (let i = j - 1; i >= 0; i--) {
      run += Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y)
      if (run > 90 && Math.hypot(pts[j].x - pts[i].x, pts[j].y - pts[i].y) < 22) return k.indexOf(pts[i])
    }
  }
  return -1
}

/** Ink as the agent reads it: each stroke's shape (a ring round something, a line, a scribble), its box and its points,
 *  a few dozen at most (screen points). A ring drawn at the end of the way there is that ring. */
export function inkOf(strokes: Point[][]) {
  return strokes.filter((k) => k.length > 1).slice(0, 12).map((whole) => {
    const at = loopAt(whole), k = at > 0 ? whole.slice(at) : whole
    const xs = k.map((p) => p.x), ys = k.map((p) => p.y)
    const box = { x: Math.round(Math.min(...xs)), y: Math.round(Math.min(...ys)), width: Math.round(Math.max(...xs) - Math.min(...xs)), height: Math.round(Math.max(...ys) - Math.min(...ys)) }
    const len = k.slice(1).reduce((n, p, i) => n + Math.hypot(p.x - k[i].x, p.y - k[i].y), 0)
    const ends = Math.hypot(k[0].x - k.at(-1)!.x, k[0].y - k.at(-1)!.y), size = Math.max(1, Math.hypot(box.width, box.height))
    const shape = len < 6 ? "dot" : at >= 0 || (ends < size * 0.3 && len > size * 1.5) ? "ring" : len < ends * 1.25 ? (box.width > box.height * 3 ? "underline" : "line") : "scribble"
    return { shape, box, points: simplify(k, 2.5).slice(0, 40).map((p) => [Math.round(p.x), Math.round(p.y)] as [number, number]) }
  })
}
/** A stroke's points with the ones a line through their neighbours would draw anyway left out (Ramer-Douglas-Peucker). */
function simplify(k: Point[], eps: number): Point[] {
  if (k.length < 3) return k
  const a = k[0], b = k.at(-1)!, d = Math.hypot(b.x - a.x, b.y - a.y) || 1
  let far = 0, at = 0
  for (let i = 1; i < k.length - 1; i++) {
    const p = k[i], off = Math.abs((b.y - a.y) * p.x - (b.x - a.x) * p.y + b.x * a.y - b.y * a.x) / d
    if (off > far) { far = off; at = i }
  }
  return far <= eps ? [a, b] : [...simplify(k.slice(0, at + 1), eps).slice(0, -1), ...simplify(k.slice(at), eps)]
}

/** Where a cursor's conversation opens (its top left, points) for a cursor at `p`, by the window's rule (boxes.ts): inside
 *  the space windows get, never over its arrow, its name (`flag`: its width, about), what it points at or `clear`. */
export function panelAt(p: Point, size: { width: number; height: number }, area: Rect, flag = 120, target?: Rect | null, clear: Rect[] = []): Point {
  const b = boxAt(p, size, area, [arrowBox(p), flagBox(p, flag, area), ...(target ? [target] : []), ...clear])
  return { x: Math.round(b.x), y: Math.round(b.y) }
}

// ---------- the summoned companion's exchange: beside the pointer, its box with it, the display's picture

/** Where the companion rides beside the pointer: a little right of and below its arrow, on the other side near an edge. */
export const BESIDE = { x: 24, y: 20 }
export function besidePointer(p: Point, bounds: Rect): Point {
  const right = p.x + BESIDE.x + 40 > bounds.x + bounds.width, low = p.y + BESIDE.y + 40 > bounds.y + bounds.height
  return { x: Math.round(right ? p.x - BESIDE.x - 14 : p.x + BESIDE.x), y: Math.round(low ? p.y - BESIDE.y - 10 : p.y + BESIDE.y) }
}
/** What the user's own pointer covers (its arrow, at the system's size): the box never goes there. */
export const pointerBox = (p: Point): Rect => ({ x: p.x - 6, y: p.y - 6, width: 30, height: 34 })

/** Whether the box holds still for the pointer: it's in it, or heading for it (fast enough, its way within 35° of the
 *  box's nearest point, not far): then it can be reached and clicked; moving elsewhere, the box comes along. */
export function reaching(p: Point, v: Point, box: Rect) {
  const pad = 10
  if (p.x >= box.x - pad && p.x <= box.x + box.width + pad && p.y >= box.y - pad && p.y <= box.y + box.height + pad) return true
  const near = { x: Math.max(box.x, Math.min(box.x + box.width, p.x)), y: Math.max(box.y, Math.min(box.y + box.height, p.y)) }
  const dx = near.x - p.x, dy = near.y - p.y, d = Math.hypot(dx, dy), speed = Math.hypot(v.x, v.y)
  if (d > 520 || speed < 120) return false
  return (dx * v.x + dy * v.y) / (d * speed) > Math.cos((35 * Math.PI) / 180)
}

/** The largest picture Claude takes as it is (no scaling: a pixel stays a point), by its vision limits: about 1.15
 *  megapixels, 1568 px on the long side. */
export const SHOT_MOST = { pixels: 1_150_000, side: 1568 }
/** The part of display `d` pictured for an ask at `p`: all of it when it fits, else as much as fits around the pointer
 *  (a pixel a point, centred on it and kept inside the display). */
export function shotCrop(d: Rect, p: Point): Rect {
  const scale = Math.min(1, SHOT_MOST.side / Math.max(d.width, d.height), Math.sqrt(SHOT_MOST.pixels / (d.width * d.height)))
  const w = Math.floor(d.width * scale), h = Math.floor(d.height * scale)
  const at = (c: number, size: number, from: number, span: number) => Math.round(Math.max(from, Math.min(from + span - size, c - size / 2)))
  return { x: at(p.x, w, d.x, d.width), y: at(p.y, h, d.y, d.height), width: w, height: h }
}

/** A point kept inside a window as it moves: where in it (from its top left) the user left a cursor. */
export const offsetIn = (frame: Rect, p: Point) => ({ dx: Math.round(p.x - frame.x), dy: Math.round(p.y - frame.y) })
/** That point now, the window at `frame`; one left past its size (it shrank) stays inside it. */
export const atOffset = (frame: Rect, o: { dx: number; dy: number }) =>
  ({ x: frame.x + Math.max(8, Math.min(frame.width - 8, o.dx)), y: frame.y + Math.max(8, Math.min(frame.height - 8, o.dy)) })

/** A job the companion handed off, as the menu bar lists it (plugins/core/companion/jobs.ts' JobCard: its states). */
export type HelperJob = { id: string; title: string; state: string; link: string | null; unseen: boolean; at: number; where?: string; now?: string; took?: string; result?: string }
const ACTIVE = new Set(["starting", "working", "needs you"])
const RANK: Record<string, number> = { "needs you": 0, "ready for review": 1, working: 2, starting: 2 }
/** The Jobs in the menu: those needing the user, to review or at work first, then the latest ended ones of the last day; a few. */
export function jobsShown(jobs: HelperJob[], now = Date.now()) {
  return jobs.filter((j) => ACTIVE.has(j.state) || (j.state !== "stopped" && (j.unseen || now - j.at < 86_400_000)))
    .sort((a, b) => (RANK[a.state] ?? 3) - (RANK[b.state] ?? 3) || b.at - a.at).slice(0, 6)
}
/** Jobs that came to need the user, or ended (ready for review, done, failed), since `before` (null: the first list
 *  heard, no news): a notification each. */
export function jobNews(before: HelperJob[] | null, after: HelperJob[]) {
  if (!before) return []
  const was = new Map(before.map((j) => [j.id, j.state]))
  return after.filter((j) => was.has(j.id) && was.get(j.id) !== j.state && (j.state === "needs you" || (["ready for review", "done", "failed"].includes(j.state) && j.unseen)))
}
/** A job's line under its title in the menu: its state, where, and what it does now or ended with. */
export const jobSublabel = (j: HelperJob) => [`${JOB_SAID[j.state] ?? j.state}${j.unseen ? ", new" : ""}${j.took ? ` · ${j.took}` : ""}`, j.where, ACTIVE.has(j.state) ? j.now : j.result]
  .filter(Boolean).join("\n")
export const JOB_SAID: Record<string, string> = { starting: "Starting", working: "Working", "needs you": "Needs you", "ready for review": "Ready for review", done: "Done", failed: "Failed", stopped: "Stopped" }
/** The menu bar icon's badge: its words not seen, and jobs ended that weren't opened. */
export const badgeOf = (unread: number, jobs: HelperJob[]) => { const n = unread + jobs.filter((j) => j.unseen).length; return n ? String(n) : "" }

/** Whether this copy may hear the user's keys (the global tap) and take the one lock: their app, never one a script
 *  drives (VAULTITE_QUIET) or run from source unless asked (VAULTITE_HELPER_TAP=1): a test can't take their Talk key. */
export const liveInput = (env: Record<string, string | undefined>, packaged: boolean) => !env.VAULTITE_QUIET && (packaged || env.VAULTITE_HELPER_TAP === "1")

/** The size two pictures of the display are compared at (helper.ts' shotChanged): a cell is about 30 points. */
export const THUMB = { w: 48, h: 32 }
/** Whether two same-size BGRA bitmaps differ past noise: a few cells changed clearly (a toast, a menu, a dialog), not
 *  one a little (a caret's blink, a clock's second). */
export function bitmapsDiffer(a: Buffer, b: Buffer, cells = 3, by = 40) {
  if (a.length !== b.length) return true
  let changed = 0
  for (let i = 0; i + 3 < a.length; i += 4) {
    if (Math.abs(a[i] - b[i]) > by || Math.abs(a[i + 1] - b[i + 1]) > by || Math.abs(a[i + 2] - b[i + 2]) > by) changed++
    if (changed >= cells) return true
  }
  return false
}
