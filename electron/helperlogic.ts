// The menu-bar helper's reckoning, apart from Electron so it's tested alone (tools/test/vault/helper.ts).
import { arrowBox, boxAt, flagBox } from "../plugins/core/companion/boxes.ts"

export type Rect = { x: number; y: number; width: number; height: number }
type Decls = Record<string, { default?: unknown }>
/** `keys` dictate, `talk` talk to the companion (its own: a key in both talks). */
export type Prefs = { fn: boolean; keys: string[]; talk: string[]; privateApps: string[]; dictation: Record<string, unknown> }
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
  }
}

/** Where on screen an element (or a window) is: by its left edge's middle, an element; a window, by its title bar. */
export function pointIn(r: Rect, element: boolean) {
  return element ? { x: r.x + Math.min(16, r.width / 2), y: r.y + r.height / 2 } : { x: r.x + r.width / 2, y: r.y + 12 }
}

/** An agent's cursor at a point of the screen (global points): its bubble, its state (`t`: when it last acted); `from`:
 *  glided in from; `leaving`: into the app's window; `target`: what it points at, which its words never cover. */
export type ScreenAgent = { name: string; tint: string; state: string; sx: number; sy: number; t?: number; seen?: boolean; why?: string; from?: Point; leaving?: boolean
  target?: Rect; say?: { id: string; text: string; question?: boolean } }
export type Point = { x: number; y: number }
/** The companion called up by a Talk key: at the pointer, listening (its words as they come) or thinking. */
export type Summoned = { name: string; tint: string; state: "listening" | "thinking" | "watching"; sx: number; sy: number; words?: string; from?: Point; leaving?: boolean }
/** What the overlay draws: cursors, the companion summoned, the ink drawn while its key is held, and the dictation pill,
 *  by its display's bottom centre (`display`: the one; else the pointer's). */
export type Scene = {
  agents: ScreenAgent[]
  summon: Summoned | null
  ink: { tint: string; strokes: Point[][] } | null
  /** `hint`: a word for a moment, nothing heard (a key pressed where it does nothing). */
  pill: { level: number; text: string; ready: boolean; display?: number; hint?: boolean } | null
}
type Display = { id: number; bounds: Rect; workArea?: Rect }
const inside = (d: Display, x: number, y: number) => x >= d.bounds.x && x < d.bounds.x + d.bounds.width && y >= d.bounds.y && y < d.bounds.y + d.bounds.height
/** What one display shows, in its own coordinates: a cursor on its way from or to it too. */
export function sceneFor(d: Display, s: Scene, pointer: Point, all: Display[]) {
  const on = (x: number, y: number) => inside(d, x, y)
  const here = (a: { sx: number; sy: number; from?: Point }) => on(a.sx, a.sy) || (!!a.from && on(a.from.x, a.from.y))
  const dx = d.bounds.x, dy = d.bounds.y
  const local = <T extends { sx: number; sy: number; from?: Point; target?: Rect }>(a: T) =>
    ({ ...a, sx: a.sx - dx, sy: a.sy - dy, ...(a.from ? { from: { x: a.from.x - dx, y: a.from.y - dy } } : {}), ...(a.target ? { target: { ...a.target, x: a.target.x - dx, y: a.target.y - dy } } : {}) })
  const pillHere = !!s.pill && (s.pill.display !== undefined && all.some((x) => x.id === s.pill!.display) ? s.pill.display === d.id : on(pointer.x, pointer.y))
  const strokes = s.ink?.strokes.filter((k) => k.some((p) => on(p.x, p.y))).map((k) => k.map((p) => ({ x: p.x - dx, y: p.y - dy }))) ?? []
  return {
    width: d.bounds.width, height: d.bounds.height,
    // (the menu bar's height: what goes above a cursor stays under it)
    top: d.workArea ? Math.max(0, d.workArea.y - d.bounds.y) : 0,
    agents: s.agents.filter(here).map(local),
    summon: s.summon && here(s.summon) ? local(s.summon) : null,
    ink: s.ink && strokes.length ? { tint: s.ink.tint, strokes } : null,
    pill: pillHere ? s.pill : null,
  }
}
export type DisplayScene = ReturnType<typeof sceneFor>

/** A display's scene as what it draws (`shape`, compared as text) and where (`at`): while only places change (the
 *  pointer, a window moved), only `at` goes to the window. */
export function splitScene(s: DisplayScene) {
  const shape = JSON.stringify({ ...s, agents: s.agents.map(({ sx: _x, sy: _y, from: _f, target: _t, ...a }) => a), summon: s.summon && { ...s.summon, sx: 0, sy: 0, from: undefined } })
  const at = { agents: Object.fromEntries(s.agents.map((a) => [a.name, [a.sx, a.sy, ...(a.target ? [a.target.x, a.target.y, a.target.width, a.target.height] : [])]])), summon: s.summon ? [s.summon.sx, s.summon.sy] : null }
  return { shape, at }
}

/** Ink as the agent reads it: each stroke's shape (a ring round something, a line, a scribble), its box and its points,
 *  a few dozen at most (screen points). */
export function inkOf(strokes: Point[][]) {
  return strokes.filter((k) => k.length > 1).slice(0, 12).map((k) => {
    const xs = k.map((p) => p.x), ys = k.map((p) => p.y)
    const box = { x: Math.round(Math.min(...xs)), y: Math.round(Math.min(...ys)), width: Math.round(Math.max(...xs) - Math.min(...xs)), height: Math.round(Math.max(...ys) - Math.min(...ys)) }
    const len = k.slice(1).reduce((n, p, i) => n + Math.hypot(p.x - k[i].x, p.y - k[i].y), 0)
    const ends = Math.hypot(k[0].x - k.at(-1)!.x, k[0].y - k.at(-1)!.y), size = Math.max(1, Math.hypot(box.width, box.height))
    const shape = len < 6 ? "dot" : ends < size * 0.3 && len > size * 1.5 ? "ring" : len < ends * 1.25 ? (box.width > box.height * 3 ? "underline" : "line") : "scribble"
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
 *  the space windows get, never over its arrow, its name (`flag`: its width, about) or what it points at. */
export function panelAt(p: Point, size: { width: number; height: number }, area: Rect, flag = 120, target?: Rect | null): Point {
  const b = boxAt(p, size, area, [arrowBox(p), flagBox(p, flag, area), ...(target ? [target] : [])])
  return { x: Math.round(b.x), y: Math.round(b.y) }
}

/** A point kept inside a window as it moves: where in it (from its top left) the user left a cursor. */
export const offsetIn = (frame: Rect, p: Point) => ({ dx: Math.round(p.x - frame.x), dy: Math.round(p.y - frame.y) })
/** That point now, the window at `frame`; one left past its size (it shrank) stays inside it. */
export const atOffset = (frame: Rect, o: { dx: number; dy: number }) =>
  ({ x: frame.x + Math.max(8, Math.min(frame.width - 8, o.dx)), y: frame.y + Math.max(8, Math.min(frame.height - 8, o.dy)) })

/** A job the companion handed off (plugins/core/companion/jobs.ts), as the menu bar lists it. */
export type HelperJob = { id: string; title: string; state: string; link: string | null; unseen: boolean; at: number }
const ACTIVE = new Set(["running", "needs you"])
/** The Jobs in the menu: those needing the user or at work first, then the latest ended ones of the last day; a few. */
export function jobsShown(jobs: HelperJob[], now = Date.now()) {
  const rank = (j: HelperJob) => (j.state === "needs you" ? 0 : j.state === "running" ? 1 : 2)
  return jobs.filter((j) => ACTIVE.has(j.state) || (j.state !== "cancelled" && (j.unseen || now - j.at < 86_400_000)))
    .sort((a, b) => rank(a) - rank(b) || b.at - a.at).slice(0, 6)
}
/** Jobs that ended or came to need the user since `before` (null: the first list heard, no news): a notification each. */
export function jobNews(before: HelperJob[] | null, after: HelperJob[]) {
  if (!before) return []
  const was = new Map(before.map((j) => [j.id, j.state]))
  return after.filter((j) => was.has(j.id) && was.get(j.id) !== j.state && (j.state === "needs you" || ((j.state === "done" || j.state === "failed") && j.unseen)))
}
/** The menu bar icon's badge: its words not seen, and jobs ended that weren't opened. */
export const badgeOf = (unread: number, jobs: HelperJob[]) => { const n = unread + jobs.filter((j) => j.unseen).length; return n ? String(n) : "" }
