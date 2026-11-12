import { OpError } from "../../../core/plugins.ts"
import type { Target } from "../../../core/desktop/places.ts"
import "./chatturns.ts"
import { str, ownName } from "./settings.ts"
import { agents, key, focus } from "./state.ts"
import { drawing, point } from "./comments.ts"
import { nearBy } from "./windows.ts"

export const AS = { type: "string", description: "your name in the app, when several agents keep the user company (default: the companion's, Claude)" } as const
export const PATH = { type: "string", format: "path", description: "the file (Notes/Idea.md); default: the one the user is in" } as const
export const LINE = { type: "integer", minimum: 0, description: "a line of it (from 1, counting its frontmatter)" } as const
export const FIND = { type: "string", description: "text in that line or near it, exactly as in the file (the occurrence nearest line); on a drawing, an element's id or text" } as const
const X = { type: "number", description: "on a drawing: a point of it, with y (its units, as its elements')" } as const
const Y = { type: "number", description: "on a drawing: a point of it, with x" } as const

export const PANE = { type: "string", description: "instead of a note: a pane of the user's window, a terminal or a web page (its id: vau tabs; a pane showing a note is that note)" } as const
export const UI = { type: "string", description: "instead of a note: the app's own UI, by its id (tab:<id>, pane:<id>, group:<id>, panel:<plugin>:<name>, button:<command id>)" } as const
export const ROW = { type: "integer", minimum: 1, description: "in a terminal pane: a row of its screen, from 1 (or find: its text)" } as const
export const EL = { type: "string", description: "in a web page's pane: an element, by its ref (e12: companion see)" } as const
/** Where an op points, in a note, a pane, the app's UI, or (the helper's) an app's window and the screen. */
export const PLACE = { path: PATH, line: LINE, find: FIND, x: X, y: Y, pane: PANE, ui: UI, row: ROW, el: EL,
  app: { type: "string", description: "outside the app (the helper): an app, by its bundle id" } as const,
  window: { type: "integer", description: "outside the app: a window of it (its CGWindowID)" } as const,
  sx: { type: "number", description: "outside the app: a point on the screen, with sy (points)" } as const,
  sy: { type: "number", description: "outside the app: a point on the screen, with sx" } as const,
  display: { type: "integer", description: "outside the app: the display sx and sy are on" } as const,
  ax: { type: "string", description: "outside the app: an element the user's last ask listed near their pointer (a3), instead of sx and sy: your cursor snaps to it" } as const }

/** A target from params: the user's file when none is given; a pane, the app's UI or the screen (`elsewhere`: the ops
 *  that point) without one. */
export function target(p: Record<string, unknown>, elsewhere = false): Target {
  const out: Target = {}
  if (str(p.ax)) {
    const e = nearBy.get(key(who(p)))?.find((x) => x.id === str(p.ax))
    if (!e) throw new OpError(`no element ${str(p.ax)} near their pointer: the ids are the last ask's (its near list)`, 404)
    Object.assign(out, { sx: e.frame.x + Math.min(16, e.frame.width / 2), sy: e.frame.y + e.frame.height / 2, frame: e.frame })
  }
  for (const k of ["pane", "ui", "el", "app"] as const) if (str(p[k])) out[k] = str(p[k])
  for (const k of ["row", "window", "sx", "sy", "display"] as const) if (p[k] !== undefined && p[k] !== null && Number.isFinite(Number(p[k]))) out[k] = Number(p[k])
  const away = !!(out.pane || out.ui || out.app || out.sx !== undefined)
  if (out.frame) { out.sx = Math.round(out.sx!); out.sy = Math.round(out.sy!) }
  if (away && !elsewhere) throw new OpError("this is for notes: give `path` (in a pane or the app's UI: companion look, say or highlight)")
  const path = str(p.path) || (away ? "" : focus()?.path)
  if (!path && !away) throw new OpError("the user has no file open: give `path` (or `pane`, `ui`)")
  return { ...(path ? { path } : {}), ...(p.line !== undefined ? { line: Number(p.line) } : {}), ...(str(p.find) ? { find: str(p.find) } : {}), ...point(p), ...out }
}
/** What a drawing doesn't have (a margin, lines to write in): the op that does it there instead. */
export function notOnDrawing(t: Target, what: string) {
  if (t.path && drawing(t.path)) throw new OpError(`${t.path} is a drawing: ${what}`)
}
/** The agent acting: --as (as it was first called), else the companion. */
export const who = (p: Record<string, unknown>) => { const n = str(p.as).trim(); return n ? agents.get(key(n))?.name ?? n : ownName() }
