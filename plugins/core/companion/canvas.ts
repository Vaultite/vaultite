import { canvases, canvasOf, canvasShown, choose, notify, onCanvases, pluginSettings, type CanvasItem, type CanvasPeer, type OpenCanvas } from "@vaultite"
import { type Agent, bump, getState, liveAgents, mentionIn, say, sayWhere, sendMoment, setDrawings, subscribe, type Target } from "./live"

export type DrawAsk = { rid: string; agent: string; path: string; actions: unknown[] }
type Point = { x: number; y: number }

let last: OpenCanvas | null = null
let lastAt = 0
const watched = new Map<OpenCanvas, { stop: () => void; hold: (on: boolean) => void; peers: () => void }>()

function drawingWhere(): { open: string[]; focus: Target | null } {
  const c = last && canvasShown(last) && (last.el.contains(document.activeElement) || Date.now() - lastAt < 60_000) ? last : null
  const p = c?.pointer()
  return { open: [...new Set(canvases().map((x) => x.path))], focus: c ? { path: c.path, ...(p ? { x: Math.round(p.x), y: Math.round(p.y) } : {}) } : null }
}

export function findItem(items: CanvasItem[], find: string) {
  const f = find.trim(), low = f.toLowerCase()
  return items.find((i) => i.id === f) ?? items.find((i) => i.text?.trim().toLowerCase() === low) ?? items.find((i) => !!i.text && i.text.toLowerCase().includes(low)) ?? null
}

const parked = new Map<string, { t: number; p: Point }>()
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

function colorOf(tint: string) {
  const css = getComputedStyle(document.documentElement).getPropertyValue(`--${tint}`).trim() || "#e8590c"
  const g = document.createElement("canvas").getContext("2d", { willReadFrequently: true })
  if (!g) return css
  g.fillStyle = css
  g.fillRect(0, 0, 1, 1)
  const [r, gr, b] = g.getImageData(0, 0, 1, 1).data
  return `rgb(${r}, ${gr}, ${b})`
}

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

export function changesOf(a: Map<string, CanvasItem>, b: CanvasItem[]): string[] {
  const out: string[] = [], now = new Set(b.map((i) => i.id)), off = (x: number, y: number) => Math.abs(x - y) > 1
  for (const i of b) {
    const o = a.get(i.id)
    if (!o) out.push(`+ ${itemLine(i)}`)
    else if ((o.text ?? "") !== (i.text ?? "")) out.push(`~ ${i.id} ${i.type}: ${quote(o.text)} -> ${quote(i.text)}`)
    else if (LINES.has(i.type) ? o.from !== i.from || o.to !== i.to : off(o.x, i.x) || off(o.y, i.y) || (i.type !== "text" && (off(o.w, i.w) || off(o.h, i.h)))) out.push(`~ ${itemLine(i)}${LINES.has(i.type) ? "" : ` ${i.w}x${i.h}`}`)
  }
  for (const [id, o] of a) if (!now.has(id)) out.push(`- ${itemLine(o)}`)
  return out.length > 40 ? [...out.slice(0, 40), `… and ${out.length - 40} more`] : out
}

function sceneOf(c: OpenCanvas) {
  const p = c.pointer()
  return { path: c.path, ...(p ? { x: Math.round(p.x), y: Math.round(p.y) } : {}), scene: c.describe({ pointer: p, selected: c.selected() }) }
}

function watch(c: OpenCanvas) {
  const index = (items: CanvasItem[]) => new Map(items.map((i) => [i.id, i]))
  let base = index(c.items())
  const asked = new Set([...base.values()].filter((i) => i.text).map((i) => `${i.id}\n${i.text}`))
  let tick: ReturnType<typeof setTimeout> | null = null, pause: ReturnType<typeof setTimeout> | null = null, where: ReturnType<typeof setTimeout> | null = null
  let held = false, pointer = c.pointer(), selected = c.selected().join()
  const report = () => {
    if (pause) { clearTimeout(pause); pause = null }
    if (c.editing()) { pause = setTimeout(report, 1000); return }
    const items = c.items(), changes = changesOf(base, items)
    base = index(items)
    const md = getState().mode
    if (changes.length && md === "pair") sendMoment({ kind: "edit", changes, ...sceneOf(c) })
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
  const stop = c.subscribe((outside) => {
    if (outside?.length) { const now = index(c.items()); for (const id of outside) { const i = now.get(id); if (i) base.set(id, i); else base.delete(id) } }
    const p = c.pointer(), sel = c.selected().join()
    if (p !== pointer || sel !== selected) {
      pointer = p; selected = sel; last = c; lastAt = Date.now()
      if (!where) where = setTimeout(() => { where = null; sayWhere(true) }, 600)
    }
    if (!tick) tick = setTimeout(run, 150)
    bump()
  })
  return {
    stop: () => { stop(); for (const t of [tick, where]) if (t) clearTimeout(t); if (pause && c.items().length) report(); c.setPeers([]); if (last === c) last = null },
    hold: (on: boolean) => {
      held = on
      if (on) return
      base = index(c.items())
      for (const i of base.values()) if (i.text) asked.add(`${i.id}\n${i.text}`)
    },
    peers: () => peersOn(c),
  }
}

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

async function draw(m: DrawAsk) {
  const c = canvasOf(m.path), w = c ? watched.get(c) : undefined
  if (!c?.apply) return say({ t: "done", rid: m.rid, ok: false })
  w?.hold(true)
  try {
    say({ t: "done", rid: m.rid, ok: true, touched: await c.apply(m.actions, m.agent) })
  } catch (e) {
    say({ t: "done", rid: m.rid, ok: false, error: e instanceof Error ? e.message : String(e) })
  } finally { w?.hold(false) }
}

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
