// The menu-bar helper's reckoning, apart from Electron so it's tested alone (tools/test/vault/helper.ts).
import { diffLines } from "../core/linediff.ts"

export type Rect = { x: number; y: number; width: number; height: number }
type Decls = Record<string, { default?: unknown }>
/** `keys` dictate, `talk` talk to the companion (its own: a key in both talks). */
export type Prefs = { fn: boolean; keys: string[]; talk: string[]; cursor: "dock" | "trail" | "app"; privateApps: string[]; dictation: Record<string, unknown> }
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
    cursor: ((x) => (x === "trail" || x === "app" ? x : "dock"))(val(c.screen_cursor, def(DEFAULTS.companion, "screen_cursor"))),
    privateApps: Array.isArray(s.private_apps) ? s.private_apps.map(String) : (def(DEFAULTS.screen, "private_apps") as string[] | undefined) ?? [],
    dictation: d,
  }
}

/** Where on screen an element (or a window) is: by its left edge's middle, an element; a window, by its title bar. */
export function pointIn(r: Rect, element: boolean) {
  return element ? { x: r.x + Math.min(16, r.width / 2), y: r.y + r.height / 2 } : { x: r.x + r.width / 2, y: r.y + 12 }
}

/** What changed between two readings of a window, as the companion's hunks (a few, a few lines each). */
export function hunksOf(a: string[], b: string[]) {
  return diffLines(a, b).filter((o) => o[0] !== "equal").slice(0, 20)
    .map(([, i1, i2, j1, j2]) => ({ line: j1 + 1, removed: a.slice(i1, i2).slice(0, 40), added: b.slice(j1, j2).slice(0, 40) }))
}

/** An agent's cursor at a point of the screen (global points): its bubble, its flag's state (`t`: when it last acted);
 *  `from`: where it just was (glided in from); `leaving`: on its way into the app's window, which draws it there. */
export type ScreenAgent = { name: string; tint: string; state: string; sx: number; sy: number; t?: number; seen?: boolean; why?: string; from?: Point; leaving?: boolean
  say?: { id: string; text: string; question?: boolean } }
export type Point = { x: number; y: number }
/** What the overlay draws: cursors, the companion waiting (`docked` at an edge, else by the pointer) and the
 *  dictation pill, by its display's bottom centre (`display`: the one; else the pointer's). */
export type Scene = {
  agents: ScreenAgent[]
  idle: { name: string; tint: string; sx: number; sy: number; docked: boolean; from?: Point; leaving?: boolean
    /** Docked: on which edge, and whether it said something not seen yet. */
    side?: Dock["side"]; unread?: boolean } | null
  /** `hint`: a word for a moment, nothing heard (a key pressed where it does nothing). */
  pill: { level: number; text: string; ready: boolean; display?: number; hint?: boolean } | null
}
type Display = { id: number; bounds: Rect; workArea?: Rect }
const inside = (d: Display, x: number, y: number) => x >= d.bounds.x && x < d.bounds.x + d.bounds.width && y >= d.bounds.y && y < d.bounds.y + d.bounds.height
/** What one display shows, in its own coordinates: a cursor on its way from or to it too. */
export function sceneFor(d: Display, s: Scene, pointer: Point, all: Display[]) {
  const on = (x: number, y: number) => inside(d, x, y)
  const here = (a: { sx: number; sy: number; from?: Point }) => on(a.sx, a.sy) || (!!a.from && on(a.from.x, a.from.y))
  const local = <T extends { sx: number; sy: number; from?: Point }>(a: T) =>
    ({ ...a, sx: a.sx - d.bounds.x, sy: a.sy - d.bounds.y, ...(a.from ? { from: { x: a.from.x - d.bounds.x, y: a.from.y - d.bounds.y } } : {}) })
  const pillHere = !!s.pill && (s.pill.display !== undefined && all.some((x) => x.id === s.pill!.display) ? s.pill.display === d.id : on(pointer.x, pointer.y))
  return {
    width: d.bounds.width, height: d.bounds.height,
    // (the menu bar's height: a bubble that wouldn't fit above its cursor under it opens below)
    top: d.workArea ? Math.max(0, d.workArea.y - d.bounds.y) : 0,
    agents: s.agents.filter(here).map(local),
    idle: s.idle && here(s.idle) ? local(s.idle) : null,
    pill: pillHere ? s.pill : null,
  }
}
export type DisplayScene = ReturnType<typeof sceneFor>

/** A display's scene as what it draws (`shape`, compared as text) and where (`at`): while only places change (the
 *  pointer's trail, a window moved), only `at` goes to the window. */
export function splitScene(s: DisplayScene) {
  const shape = JSON.stringify({ ...s, agents: s.agents.map(({ sx: _x, sy: _y, from: _f, ...a }) => a), idle: s.idle && { ...s.idle, sx: 0, sy: 0, from: undefined } })
  const at = { agents: Object.fromEntries(s.agents.map((a) => [a.name, [a.sx, a.sy]])), idle: s.idle ? [s.idle.sx, s.idle.sy] : null }
  return { shape, at }
}

/** Where the companion waits outside the app: an edge of the screen, and how far down it (0 the top, 1 the bottom of
 *  the space windows get). The user's to move: dragged to an edge, it stays there. */
export type Dock = { side: "left" | "right"; at: number }
export const DOCK: Dock = { side: "right", at: 1 / 3 }
/** How near an edge a drop docks (points): the menu bar's and the Dock's edges are for pointing at what's there. */
const EDGE = 36
const INSET = 14
/** A drop at `p` on a display (its bounds, the space windows get): the dock there, by its left or right edge; else null. */
export function dockAt(bounds: Rect, area: Rect, p: Point): Dock | null {
  const side = p.x <= bounds.x + EDGE ? "left" : p.x >= bounds.x + bounds.width - EDGE ? "right" : null
  if (!side || p.y < area.y || p.y > area.y + area.height) return null
  return { side, at: Math.round(Math.max(0, Math.min(1, (p.y - area.y) / Math.max(1, area.height))) * 1000) / 1000 }
}
/** Where the docked companion sits on a display: by its edge, inset a little, kept clear of the space's ends. */
export function dockPoint(area: Rect, d: Dock): Point {
  const y = area.y + Math.max(INSET * 2, Math.min(area.height - INSET * 2, Math.round(area.height * d.at)))
  return { x: d.side === "left" ? area.x + INSET : area.x + area.width - INSET, y }
}
/** A dock as saved (vaults.json), or the default. */
export function dockOf(x: unknown): Dock {
  const d = x as Partial<Dock> | null | undefined
  return d && (d.side === "left" || d.side === "right") && typeof d.at === "number" && d.at >= 0 && d.at <= 1 ? { side: d.side, at: d.at } : DOCK
}

/** Where a cursor's conversation opens (its top left, points) for a cursor at `p`: to its right and below its flag
 *  where there's room, else to the left or above, always inside the space windows get. */
export function panelAt(p: Point, size: { width: number; height: number }, area: Rect): Point {
  const right = p.x + size.width - 6 <= area.x + area.width - 8
  const x = right ? p.x - 6 : p.x + 26 - size.width
  const below = p.y + 42 + size.height <= area.y + area.height - 8
  const y = below ? p.y + 36 : p.y - 6 - size.height
  return { x: Math.round(Math.max(area.x + 8, Math.min(area.x + area.width - 8 - size.width, x))), y: Math.round(Math.max(area.y + 8, Math.min(area.y + area.height - 8 - size.height, y))) }
}

/** Where `p` is in a window's picture, in words ("40% across, 12% down"); null outside it. */
export function spotIn(frame: Rect, p: Point) {
  if (frame.width <= 0 || frame.height <= 0 || p.x < frame.x || p.y < frame.y || p.x > frame.x + frame.width || p.y > frame.y + frame.height) return null
  return `${Math.round(((p.x - frame.x) / frame.width) * 100)}% across, ${Math.round(((p.y - frame.y) / frame.height) * 100)}% down`
}

/** A point kept inside a window as it moves: where in it (from its top left) the user left a cursor. */
export const offsetIn = (frame: Rect, p: Point) => ({ dx: Math.round(p.x - frame.x), dy: Math.round(p.y - frame.y) })
/** That point now, the window at `frame`; one left past its size (it shrank) stays inside it. */
export const atOffset = (frame: Rect, o: { dx: number; dy: number }) =>
  ({ x: frame.x + Math.max(8, Math.min(frame.width - 8, o.dx)), y: frame.y + Math.max(8, Math.min(frame.height - 8, o.dy)) })
