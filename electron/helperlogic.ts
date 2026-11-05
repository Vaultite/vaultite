// The menu-bar helper's reckoning, apart from Electron so it's tested alone (tools/test/vault/helper.ts).
import { diffLines } from "../core/linediff.ts"

export type Rect = { x: number; y: number; width: number; height: number }
type Decls = Record<string, { default?: unknown }>
export type Prefs = { fn: boolean; keys: string[]; cursor: "dock" | "trail"; privateApps: string[]; dictation: Record<string, unknown> }
/** The home vault's settings the helper follows: dictation's, the companion's and screen's data.json, their manifests'
 *  `settings` giving the defaults. */
export function prefsOf(d: Record<string, unknown>, c: Record<string, unknown>, s: Record<string, unknown>, DEFAULTS: Record<"dictation" | "companion" | "screen", Decls>): Prefs {
  const def = (from: Record<string, { default?: unknown }>, k: string) => from[k]?.default
  const val = <T>(x: unknown, fallback: T) => (x === undefined || x === null ? fallback : x as T)
  return {
    fn: val(d.fn, def(DEFAULTS.dictation, "fn") ?? true) !== false,
    keys: Array.isArray(d.keys) ? d.keys.map(String) : (def(DEFAULTS.dictation, "keys") as string[] | undefined) ?? [],
    cursor: val(c.screen_cursor, def(DEFAULTS.companion, "screen_cursor")) === "trail" ? "trail" : "dock",
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
  idle: { name: string; tint: string; sx: number; sy: number; docked: boolean; from?: Point; leaving?: boolean } | null
  pill: { level: number; text: string; ready: boolean; display?: number } | null
}
type Display = { id: number; bounds: Rect }
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
