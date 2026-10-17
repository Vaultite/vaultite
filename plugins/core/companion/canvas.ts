// The companion on drawings (the canvases a format registers, registerCanvas): its agents there as the canvas's own
// collaborators, what the user does there said back (where, what changed after a pause, @name in a text), its drawing.
import { canvases, canvasOf, canvasShown, choose, notify, onCanvases, pluginSettings, type CanvasItem, type CanvasPeer, type OpenCanvas } from "@vaultite"
import { type Agent, bump, getState, liveAgents, mentionIn, say, sayWhere, sendMoment, setDrawings, subscribe, type Target } from "./live"

export type DrawAsk = { rid: string; agent: string; path: string; actions: unknown[] }
type Point = { x: number; y: number }

/** The canvas the user did something in last, and when. */
let last: OpenCanvas | null = null
let lastAt = 0
const watched = new Map<OpenCanvas, { stop: () => void; hold: (on: boolean) => void; peers: () => void }>()

/** The drawings this window shows, and where the user is in the one they're in (their pointer). */
function drawingWhere(): { open: string[]; focus: Target | null } {
  const c = last && canvasShown(last) && (last.el.contains(document.activeElement) || Date.now() - lastAt < 60_000) ? last : null
  const p = c?.pointer()
  return { open: [...new Set(canvases().map((x) => x.path))], focus: c ? { path: c.path, ...(p ? { x: Math.round(p.x), y: Math.round(p.y) } : {}) } : null }
}

/** An item by id, else by its text (exact, then in part). */
export function findItem(items: CanvasItem[], find: string) {
  const f = find.trim(), low = f.toLowerCase()
  return items.find((i) => i.id === f) ?? items.find((i) => i.text?.trim().toLowerCase() === low) ?? items.find((i) => !!i.text && i.text.toLowerCase().includes(low)) ?? null
}

// (where an agent with nowhere in particular goes: by the user's pointer as it was when the agent last changed)
const parked = new Map<string, { t: number; p: Point }>()
/** Where an agent's pointer is on a canvas: its point, under the middle of the element it looks at, else by the user. */
export function pointFor(c: OpenCanvas, a: Agent, items = c.items()): Point {
  if (a.x !== undefined && a.y !== undefined) return { x: a.x, y: a.y }
  const it = a.find ? findItem(items, a.find) : null
  if (it) return { x: it.x + it.w / 2, y: it.y + it.h }
  const k = `${c.path}\n${a.name}`, was = parked.get(k)
  if (was?.t === a.t) return was.p
  const v = c.view(), u = c.pointer(), off = v.w * 0.03
  const p = u ? { x: u.x + off, y: u.y + off } : { x: v.x + v.w * 0.6, y: v.y + v.h * 0.45 }
  parked.set(k, { t: a.t, p })
  return p
}

/** A colour the canvas can draw with (its tint's value now: the theme's, light or dark). */
function colorOf(tint: string) {
  const css = getComputedStyle(document.documentElement).getPropertyValue(`--${tint}`).trim() || "#e8590c"
  const g = document.createElement("canvas").getContext("2d", { willReadFrequently: true })
  if (!g) return css
  g.fillStyle = css
  g.fillRect(0, 0, 1, 1)
  const [r, gr, b] = g.getImageData(0, 0, 1, 1).data
  return `rgb(${r}, ${gr}, ${b})`
}

/** The agents on a canvas, as it draws them: where each looks, what it lit (a highlight: its selection there). */
function peersOn(c: OpenCanvas) {
  const s = getState()
  if (s.mode === "off") return c.setPeers([])
  const items = c.items()
  c.setPeers(s.agents.filter((a) => a.state !== "away" && a.path === c.path).map((a): CanvasPeer => ({
    id: a.name, name: a.name, color: colorOf(a.tint), ...pointFor(c, a, items), busy: a.state === "thinking" || a.state === "reading",
    selected: s.notes.flatMap((n) => (n.kind === "highlight" && n.agent === a.name && n.path === c.path && n.find ? [findItem(items, n.find)?.id ?? ""] : [])).filter(Boolean),
  })))
}

const quote = (s?: string) => JSON.stringify((s ?? "").length > 60 ? `${s!.slice(0, 60)}…` : s ?? "")
const LINES = new Set(["arrow", "line"])
const itemLine = (i: CanvasItem) => `${i.id} ${i.type}${i.text ? ` ${quote(i.text)}` : ""}${LINES.has(i.type) ? ` ${i.from ?? "(a free end)"} -> ${i.to ?? "(a free end)"}` : ` at ${i.x},${i.y}`}`

/** What changed from `a` to `b`, a line each: + added, - deleted, ~ changed (an arrow's shape follows its ends: left out). */
export function changesOf(a: Map<string, CanvasItem>, b: CanvasItem[]): string[] {
  const out: string[] = [], now = new Set(b.map((i) => i.id))
  for (const i of b) {
    const o = a.get(i.id)
    if (!o) out.push(`+ ${itemLine(i)}`)
    else if ((o.text ?? "") !== (i.text ?? "")) out.push(`~ ${i.id} ${i.type}: ${quote(o.text)} -> ${quote(i.text)}`)
    else if (LINES.has(i.type) ? o.from !== i.from || o.to !== i.to : o.x !== i.x || o.y !== i.y || o.w !== i.w || o.h !== i.h) out.push(`~ ${itemLine(i)}${LINES.has(i.type) ? "" : ` ${i.w}x${i.h}`}`)
  }
  for (const [id, o] of a) if (!now.has(id)) out.push(`- ${itemLine(o)}`)
  return out.length > 40 ? [...out.slice(0, 40), `… and ${out.length - 40} more`] : out
}

/** What a moment from a drawing carries: the user's pointer and the scene as text. */
function sceneOf(c: OpenCanvas) {
  const p = c.pointer()
  return { path: c.path, ...(p ? { x: Math.round(p.x), y: Math.round(p.y) } : {}), scene: c.describe({ pointer: p, selected: c.selected() }) }
}

function watch(c: OpenCanvas) {
  const index = (items: CanvasItem[]) => new Map(items.map((i) => [i.id, i]))
  let base = index(c.items())
  // (texts with an @name already there aren't asked again; one is asked once its writing is done)
  const asked = new Set([...base.values()].filter((i) => i.text).map((i) => `${i.id}\n${i.text}`))
  let tick: ReturnType<typeof setTimeout> | null = null, pause: ReturnType<typeof setTimeout> | null = null, where: ReturnType<typeof setTimeout> | null = null
  let held = false, pointer = c.pointer(), selected = c.selected().join()
  const report = () => {
    if (pause) { clearTimeout(pause); pause = null }
    if (c.editing()) { pause = setTimeout(report, 1000); return }
    const items = c.items(), changes = changesOf(base, items)
    base = index(items)
    const md = getState().mode
    if (changes.length && (md === "notice" || md === "pair")) sendMoment({ kind: "edit", changes, ...sceneOf(c) })
  }
  const run = () => {
    tick = null
    const items = c.items(), editing = c.editing()
    for (const i of items) {
      const k = `${i.id}\n${i.text}`
      if (!i.text || i.id === editing || asked.has(k)) continue
      asked.add(k)
      const m = mentionIn(i.text.replace(/\s*\n\s*/g, " "))
      if (m && !held && getState().mode !== "off") sendMoment({ kind: "ask", agent: m.name, text: m.text, find: i.id, ...sceneOf(c) })
    }
    if (!held && changesOf(base, items).length) {
      if (pause) clearTimeout(pause)
      pause = setTimeout(report, (Number(pluginSettings("companion").get().pause) || 2) * 1000)
    }
    peersOn(c)
  }
  const stop = c.subscribe(() => {
    const p = c.pointer(), sel = c.selected().join()
    if (p !== pointer || sel !== selected) {
      pointer = p; selected = sel; last = c; lastAt = Date.now()
      if (!where) where = setTimeout(() => { where = null; sayWhere(true) }, 600)
    }
    if (!tick) tick = setTimeout(run, 150)
    bump()
  })
  return {
    stop: () => { stop(); for (const t of [tick, where]) if (t) clearTimeout(t); if (pause) report(); c.setPeers([]); if (last === c) last = null },
    // (while an agent draws: what it makes isn't the user's)
    hold: (on: boolean) => {
      held = on
      if (on) return
      base = index(c.items())
      for (const i of base.values()) if (i.text) asked.add(`${i.id}\n${i.text}`)
    },
    peers: () => peersOn(c),
  }
}

/** The canvases followed while the companion runs in this window. */
export function watchCanvases() {
  setDrawings({ where: drawingWhere, draw: (m) => void draw(m as DrawAsk) })
  const sync = () => {
    const now = canvases()
    for (const c of now) if (!watched.has(c)) watched.set(c, watch(c))
    for (const [c, w] of watched) if (!now.includes(c)) { w.stop(); watched.delete(c) }
    sayWhere()
  }
  sync()
  let frame = 0
  const offs = [onCanvases(sync), subscribe(() => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; for (const w of watched.values()) w.peers() }) })]
  return () => { setDrawings(null); for (const o of offs) o(); cancelAnimationFrame(frame); for (const w of watched.values()) w.stop(); watched.clear() }
}

/** An agent's actions made on the drawing this window shows (`m.path`), its pointer going to each. */
async function draw(m: DrawAsk) {
  const c = canvasOf(m.path), w = c ? watched.get(c) : undefined
  if (!c) return say({ t: "done", rid: m.rid, ok: false })
  w?.hold(true)
  try {
    say({ t: "done", rid: m.rid, ok: true, touched: await c.apply(m.actions, m.agent) })
  } catch (e) {
    say({ t: "done", rid: m.rid, ok: false, error: e instanceof Error ? e.message : String(e) })
  } finally { w?.hold(false) }
}

/** Ask about what's selected in the drawing the user is in (which agent, when several are around): false when they're
 *  in none. */
export function askDrawing(agent?: string) {
  const c = last && canvasShown(last) ? last : canvases().find(canvasShown)
  if (!c) return false
  const name = agent ?? getState().name
  if (!c.selected().length) { notify(`Select something to ask about, or write @${name.toLowerCase()} in a text`); return true }
  const send = (to: string) => sendMoment({ kind: "ask", agent: to, text: "(look at the selection)", find: c.selected()[0], ...sceneOf(c) })
  const live = liveAgents()
  if (agent || live.length < 2) send(name)
  else choose({ title: "Ask an agent", placeholder: "Ask who?", items: live.map((a) => ({ id: a.name, label: a.name, detail: a.name === getState().name ? "companion" : undefined })), onPick: (x) => send(x.id) })
  return true
}
