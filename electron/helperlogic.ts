// The menu-bar helper's reckoning, apart from Electron so it's tested alone (tools/test/vault/helper.ts).
import { diffLines } from "../core/linediff.ts"

export type Rect = { x: number; y: number; width: number; height: number }
type Decls = Record<string, { default?: unknown }>
export type Prefs = { fn: boolean; cursor: "dock" | "trail"; privateApps: string[]; dictation: Record<string, unknown> }
/** The home vault's settings the helper follows: dictation's, the companion's and screen's data.json, their manifests'
 *  `settings` giving the defaults. */
export function prefsOf(d: Record<string, unknown>, c: Record<string, unknown>, s: Record<string, unknown>, DEFAULTS: Record<"dictation" | "companion" | "screen", Decls>): Prefs {
  const def = (from: Record<string, { default?: unknown }>, k: string) => from[k]?.default
  const val = <T>(x: unknown, fallback: T) => (x === undefined || x === null ? fallback : x as T)
  return {
    fn: val(d.fn, def(DEFAULTS.dictation, "fn") ?? true) !== false,
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

/** An agent's cursor at a point of the screen (global points), with its bubble. */
export type ScreenAgent = { name: string; tint: string; state: string; sx: number; sy: number; say?: { id: string; text: string; question?: boolean } }
/** What the overlay draws: cursors, the companion waiting (`docked` at an edge, else by the pointer) and the
 *  dictation pill, by its display's bottom centre (`display`: the one; else the pointer's). */
export type Scene = {
  agents: ScreenAgent[]
  idle: { name: string; tint: string; sx: number; sy: number; docked: boolean } | null
  pill: { level: number; text: string; ready: boolean; display?: number } | null
}
type Display = { id: number; bounds: Rect }
const inside = (d: Display, x: number, y: number) => x >= d.bounds.x && x < d.bounds.x + d.bounds.width && y >= d.bounds.y && y < d.bounds.y + d.bounds.height
/** What one display shows, in its own coordinates. */
export function sceneFor(d: Display, s: Scene, pointer: { x: number; y: number }, all: Display[]) {
  const on = (x: number, y: number) => inside(d, x, y)
  const local = <T extends { sx: number; sy: number }>(a: T) => ({ ...a, sx: a.sx - d.bounds.x, sy: a.sy - d.bounds.y })
  const pillHere = !!s.pill && (s.pill.display !== undefined && all.some((x) => x.id === s.pill!.display) ? s.pill.display === d.id : on(pointer.x, pointer.y))
  return {
    width: d.bounds.width, height: d.bounds.height,
    agents: s.agents.filter((a) => on(a.sx, a.sy)).map(local),
    idle: s.idle && on(s.idle.sx, s.idle.sy) ? local(s.idle) : null,
    pill: pillHere ? s.pill : null,
  }
}
