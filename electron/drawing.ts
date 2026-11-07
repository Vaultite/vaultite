// The companion's drawing over the screens (overlay.ts), apart from Electron so it's tested alone: each display's part.
import { type Drawing, rectOf, spots } from "../plugins/core/companion/screenmarks.ts"

export type { Drawing }
type Display = { id: number; bounds: { x: number; y: number; width: number; height: number }; workArea?: { y: number } }
type Pt = { x: number; y: number }
/** What the user pressed on a drawing (web/src/screendraw). */
export type DrawAct = { id: string; kind: "clear" | "settle" | "keep" | "copy" | "open" | "ask" | "dismiss"; text?: string; url?: string; places?: Drawing["places"]
  /** A card the user dismissed, by its id. */
  mark?: string }

const within = (d: Display, p: Pt) => p.x >= d.bounds.x && p.x < d.bounds.x + d.bounds.width && p.y >= d.bounds.y && p.y < d.bounds.y + d.bounds.height
/** The display with the cards: where its first known place is, else the pointer's. */
export function homeOf(dr: Drawing, all: Display[], pointer: Pt) {
  for (const s of spots(dr.marks)) {
    const r = rectOf(s, dr.places)
    const d = r && all.find((x) => within(x, { x: r.x + r.w / 2, y: r.y + r.h / 2 }))
    if (d) return d.id
  }
  return (all.find((x) => within(x, pointer)) ?? all[0])?.id
}
/** Display `d`'s drawing: the whole of it, with where `d` is (the page draws what falls on it); `sound`: its pen heard. */
export function drawingFor(dr: Drawing, d: Display, all: Display[], pointer: Pt, sound = false) {
  return { ...dr, here: { width: d.bounds.width, height: d.bounds.height, origin: { x: d.bounds.x, y: d.bounds.y }, home: homeOf(dr, all, pointer) === d.id,
    top: d.workArea ? Math.max(0, d.workArea.y - d.bounds.y) : 0, ...(within(d, pointer) ? { pointer } : {}), ...(sound ? { sound } : {}) } }
}
/** The elements an ask came with (the helper's, by id), as a drawing's places: `{el: "<id>"}` snaps to their frames. */
export function elementPlaces(near: { id: string; label?: string; frame: { x: number; y: number; width: number; height: number } }[] | null | undefined) {
  return Object.fromEntries((near ?? []).map((e) => [`el:${e.id}`, { x: e.frame.x, y: e.frame.y, w: e.frame.width, h: e.frame.height, ...(e.label ? { label: e.label } : {}) }]))
}
/** Whether a copy or an open is one the drawing offers (the page asks only for what it shows). */
export function offered(dr: Drawing, a: DrawAct) {
  return dr.marks.some((m) => (a.kind === "copy" && ((m.type === "copy" && m.text === a.text) || (m.type === "button" && "copy" in m.do && m.do.copy === a.text)))
    || (a.kind === "open" && ((m.type === "open" && m.url === a.url) || (m.type === "button" && "open" in m.do && m.do.open === a.url)))
    || (a.kind === "ask" && m.type === "button" && "ask" in m.do && m.do.ask === a.text))
}
