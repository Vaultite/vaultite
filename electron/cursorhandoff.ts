// One cursor, two drawers (helper.ts'): the window draws its agents in it, the overlay the rest; between them it glides,
// never jumps. An agent's cursor new to the screen comes from where it was drawn; one going into the window glides there.
import type { WebContents } from "electron"
import { type AgentPlace, onScreen } from "./cursorplaces.ts"
import type { Point, Rect, Scene, ScreenAgent } from "./helperlogic.ts"

/** The home vault's window while it's on screen: its page, where it is (points), its zoom. */
export type HomeWindow = { page: WebContents; bounds: Rect; zoom: number }
type Summoned = NonNullable<Scene["summon"]>
export const keyOf = (x: { name: string }) => `agent:${x.name}`

/** Where the window's cursors are (Overlay.tsx; its page's DOM, never its code), in screen points: `at` drawn now, `to`
 *  where it's going. None off screen, nor one faded where it last was (`data-faded`): none flies to or from it. */
export async function inApp(w: HomeWindow | null): Promise<Map<string, { at: Point; to: Point }>> {
  if (!w || w.page.isDestroyed()) return new Map()
  const code = `[...document.querySelectorAll(".companion-cursor[data-agent]:not([data-faded])")].map((el) => { const r = el.getBoundingClientRect(),
    m = /^(-?[\\d.]+),(-?[\\d.]+)$/.exec(el.dataset.to ?? ""); return [el.dataset.agent, r.left, r.top, m ? +m[1] : r.left, m ? +m[2] : r.top] })`
  const rows = await w.page.executeJavaScriptInIsolatedWorld(1007, [{ code }]).catch(() => []) as [string, number, number, number, number][]
  // (its tip: 3, 2 into the box, as both draw the arrow)
  const pt = (x: number, y: number) => ({ x: Math.round(w.bounds.x + (x + 3) * w.zoom), y: Math.round(w.bounds.y + (y + 2) * w.zoom) })
  return new Map((Array.isArray(rows) ? rows : []).map(([name, x, y, tx, ty]) => [name, { at: pt(x, y), to: pt(tx, ty) }]))
}

export function cursorHandOff(o: { window: () => HomeWindow | null; agent: (name: string) => (AgentPlace & { state: string }) | undefined
  last: () => ScreenAgent[] | undefined; draw: () => void }) {
  /** Where each cursor (`agent:<name>`, or `idle`: the companion waiting) was drawn last, and where it came from a
   *  moment ago: one new to a display glides in from there. */
  const drawnAt = new Map<string, Point>(), cameFrom = new Map<string, { p: Point; until: number }>()
  const FROM_MS = 900
  let fromTimer: ReturnType<typeof setTimeout> | undefined
  function cameFromAt(key: string, p: Point) {
    cameFrom.set(key, { p, until: Date.now() + FROM_MS })
    clearTimeout(fromTimer)
    fromTimer = setTimeout(o.draw, FROM_MS + 20)
  }
  function movedFrom(key: string, p: Point) {
    const was = drawnAt.get(key)
    drawnAt.set(key, p)
    if (was && (was.x !== p.x || was.y !== p.y)) cameFromAt(key, was)
    const c = cameFrom.get(key)
    if (c && c.until < Date.now()) cameFrom.delete(key)
    return c && c.until >= Date.now() ? c.p : undefined
  }
  /** A cursor new on screen whose agent was in the window: shown once where it was there is known (a few ms). */
  const fromWindow = new Map<string, { p: Point | null; asked: number }>()
  /** Cursors gone from the screen into the window: drawn a moment longer, gliding to where the window draws them, fading. */
  const intoWindow = new Map<string, { item: ScreenAgent; to: Point | null; until: number }>()
  const INTO_MS = 450
  let drawnKeys = new Map<string, string>()

  /** The scene made one cursor: an agent's that appears comes from where it was (summoned there, else the window's cursor),
   *  one going into the window glides there first; the summoned one is at the pointer at once. */
  function handOff(agents: ScreenAgent[], called: Scene["summon"]): { agents: ScreenAgent[]; summon: Scene["summon"] } {
    const items = new Map<string, ScreenAgent | Summoned>(agents.map((a) => [keyOf(a), a]))
    if (called) items.set("summon", called)
    const shown = !!o.window()
    for (const k of fromWindow.keys()) if (!items.has(k)) fromWindow.delete(k)
    for (const [k, it] of [...items]) {
      if (drawnKeys.has(k) || k === "summon") continue
      // (summoned there a moment ago: from there)
      if (drawnKeys.get("summon") === it.name && !items.has("summon") && drawnAt.has("summon")) { cameFromAt(k, drawnAt.get("summon")!); continue }
      const asked = fromWindow.get(k)
      if (asked && (asked.p || asked.asked === 0 || Date.now() - asked.asked > 150)) { fromWindow.delete(k); if (asked.p) cameFromAt(k, asked.p); continue }
      if (asked) { items.delete(k); continue }
      if (!shown) continue
      // (asked first: drawn once the window says where it was)
      const ask = { p: null as Point | null, asked: Date.now() }
      fromWindow.set(k, ask)
      items.delete(k)
      void inApp(o.window()).then((m) => { if (fromWindow.get(k) !== ask) return; Object.assign(ask, { p: m.get(it.name)?.at ?? null, asked: 0 }); o.draw() })
      setTimeout(o.draw, 160)
    }
    for (const [k, name] of drawnKeys) {
      if (k === "summon" || items.has(k) || intoWindow.has(k) || !shown) continue
      const a = o.agent(name), last = o.last()?.find((x) => x.name === name)
      // (into the window: its place went there; else it fades where it is)
      if (!a || a.state === "away" || !last || onScreen(a) || [...items.values()].some((x) => x.name === name)) continue
      const going = { item: last, to: null as Point | null, until: Date.now() + INTO_MS }
      intoWindow.set(k, going)
      // (a moment for the window to draw it where it's going)
      setTimeout(() => void inApp(o.window()).then((m) => { going.to = m.get(name)?.to ?? null; o.draw() }), 60)
      setTimeout(o.draw, INTO_MS + 20)
    }
    drawnKeys = new Map([...items].map(([k, it]) => [k, it.name]))
    for (const k of new Set([...drawnAt.keys(), ...cameFrom.keys()])) if (!items.has(k)) { drawnAt.delete(k); cameFrom.delete(k) }
    for (const [k, into] of intoWindow) {
      if (items.has(k) || Date.now() > into.until) { intoWindow.delete(k); continue }
      const p = into.to ?? { x: into.item.sx, y: into.item.sy }
      items.set(k, { ...into.item, sx: p.x, sy: p.y, from: undefined, leaving: true })
    }
    const out = [...items].map(([k, it]) => {
      const from = it.leaving || k === "summon" ? undefined : movedFrom(k, { x: it.sx, y: it.sy })
      if (k === "summon") drawnAt.set(k, { x: it.sx, y: it.sy })
      return [k, from ? { ...it, from } : it] as const
    })
    return { agents: out.filter(([k]) => k !== "summon").map(([, it]) => it as ScreenAgent), summon: (out.find(([k]) => k === "summon")?.[1] as Summoned | undefined) ?? null }
  }

  return { handOff, drawnAt: (key: string) => drawnAt.get(key) }
}
