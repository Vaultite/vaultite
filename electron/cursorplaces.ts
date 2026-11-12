// Where the agents' cursors point on screen (helper.ts'): places resolved to points through the screen helper and kept a
// moment, as windows move. Each knows its window and its frame then, so a move of it moves the point at once.
import { atOffset, pointIn, type Point } from "./helperlogic.ts"
import type { AppWindowInfo, Rect } from "./screen.ts"

export type Ask = <T = Record<string, unknown>>(op: string, req?: Record<string, unknown>) => Promise<T>
/** An agent's place, as the companion's socket tells it. */
export type AgentPlace = { name: string; app?: string; window?: number; find?: string; sx?: number; sy?: number; path?: string
  line?: number; pane?: string; row?: number; ui?: string }
export type Placed = { at: number; p: Point | null; pending: boolean; win?: number; frame?: Rect | null; find?: boolean
  /** The element found (`find`): its words never cover it. */
  target?: Rect
  /** Where in its window the user left it (parks): it moves with the window. */
  off?: { dx: number; dy: number }
  /** A window in front covers it (Vaultite's, another app's): it isn't drawn, pointing at nothing seen. */
  covered?: boolean }

export const placeKey = (a: AgentPlace) => `${a.name}:${a.app ?? ""}|${a.window ?? ""}|${a.find ?? ""}|${a.sx ?? ""}|${a.sy ?? ""}|${a.path ?? ""}|${a.line ?? ""}|${a.pane ?? ""}|${a.row ?? ""}|${a.ui ?? ""}`
export const onScreen = (a: AgentPlace) => !a.path && (!!a.app || (typeof a.sx === "number" && typeof a.sy === "number"))

export function cursorPlaces(o: { ask: Ask; hidden: (a: { bundle?: string; name?: string }) => boolean; agents: () => Iterable<AgentPlace>; draw: () => void }) {
  const placed = new Map<string, Placed>()
  /** Where each agent's cursor was asked about in a window: that spot of it, not its title bar, as the window moves. */
  const parks = new Map<string, { window: number; dx: number; dy: number }>()
  function park(name: string, window: number, off: { dx: number; dy: number }) {
    parks.set(name, { window, ...off })
    for (const [k, e] of placed) if (k.startsWith(`${name}:`)) e.at = 0
  }
  /** `r` with whether a window in front of its own covers its point. */
  async function seen(r: Omit<Placed, "at" | "pending">): Promise<Omit<Placed, "at" | "pending">> {
    if (!r.p) return r
    const c = await o.ask<{ covered?: boolean }>("covered", { window: r.win ?? 0, x: r.p.x, y: r.p.y }).catch(() => null)
    return { ...r, covered: !!c?.covered }
  }
  async function resolve(a: AgentPlace): Promise<Omit<Placed, "at" | "pending">> {
    return seen(await find(a))
  }
  async function find(a: AgentPlace): Promise<Omit<Placed, "at" | "pending">> {
    if (typeof a.sx === "number" && typeof a.sy === "number") return { p: { x: a.sx, y: a.sy } }
    if (!a.app || o.hidden({ bundle: a.app, name: a.app })) return { p: null }
    if (a.find) {
      const r = await o.ask<{ ok?: boolean; found?: Rect | null; window?: number; frame?: Rect | null }>("find", { window: a.window ?? 0, bundle: a.app, text: a.find })
      if (r.found) return { p: pointIn(r.found, true), win: r.window, frame: r.frame, find: true, target: r.found }
    }
    const w = await o.ask<AppWindowInfo>("window", { window: a.window ?? 0, bundle: a.app })
    if (!w.frame) return { p: null }
    const pk = parks.get(a.name), off = pk && pk.window === w.window ? { dx: pk.dx, dy: pk.dy } : undefined
    return { p: off ? atOffset(w.frame, off) : pointIn(w.frame, false), win: w.window, frame: w.frame, ...(off ? { off } : {}) }
  }
  function pointOf(a: AgentPlace): Placed {
    const k = placeKey(a), had = placed.get(k)
    // (a plain point is there at once; whether it's covered comes a moment later)
    if (typeof a.sx === "number" && typeof a.sy === "number" && !had) {
      const p = { x: a.sx, y: a.sy }
      placed.set(k, { p, at: Date.now(), pending: false })
      void seen({ p }).then((r) => { placed.set(k, { ...r, at: Date.now(), pending: false }); o.draw() })
      return placed.get(k)!
    }
    if (!had || (!had.pending && Date.now() - had.at > (a.find ? 3000 : 1000))) {
      placed.set(k, { ...(had ?? { p: null }), at: Date.now(), pending: true })
      const done = (r: Omit<Placed, "at" | "pending">) => { placed.set(k, { ...r, at: Date.now(), pending: false }); o.draw() }
      void resolve(a).then(done, () => done({ p: null }))
    }
    return placed.get(k)!
  }

  /** The windows the cursors point at are watched for moves and resizes (screen.swift's AXObservers), only those. */
  let watched = ""
  function watchWindows() {
    const used = new Set([...o.agents()].filter(onScreen).map(placeKey))
    for (const [k, e] of placed) if (!used.has(k) && Date.now() - e.at > 60_000) placed.delete(k)
    const wins = [...new Set([...placed].filter(([k, e]) => used.has(k) && e.win).map(([, e]) => e.win!))].sort()
    if (wins.join() === watched) return
    watched = wins.join()
    void o.ask("watch", { windows: wins }).catch(() => {})
  }
  const refinding = new Map<number, ReturnType<typeof setTimeout>>()
  /** A watched window moved or resized: its points move with it now; an element in a resized one is found again once it settles. */
  function windowMoved(m: Record<string, unknown>) {
    const win = Number(m.window) || 0, f = m.frame as Rect | null
    for (const e of placed.values()) {
      if (win && e.win !== win) continue
      if (m.gone || !f) { e.at = 0; continue }
      if (!e.find) e.p = e.off ? atOffset(f, e.off) : pointIn(f, false)
      else if (e.p && e.frame) {
        const dx = f.x - e.frame.x, dy = f.y - e.frame.y
        e.p = { x: e.p.x + dx, y: e.p.y + dy }
        if (e.target) e.target = { ...e.target, x: e.target.x + dx, y: e.target.y + dy }
      }
      const resized = !!e.frame && (e.frame.width !== f.width || e.frame.height !== f.height)
      e.frame = f
      if (e.find && resized) {
        clearTimeout(refinding.get(win))
        refinding.set(win, setTimeout(() => { refinding.delete(win); for (const x of placed.values()) if (x.win === win) x.at = 0; o.draw() }, 300))
      }
    }
    o.draw()
  }
  return {
    pointOf, park, watchWindows, windowMoved,
    unpark: (name: string) => parks.delete(name),
    /** Another app in front may cover or uncover what they point at: each looked at again. */
    lookAgain: () => { for (const e of placed.values()) e.at = 0 },
  }
}
