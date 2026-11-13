import path from "node:path"
import { type RawData, WebSocket } from "ws"
import { z } from "zod"
import { LOCAL, logger, vaultPath, type Who } from "../../../core/plugins.ts"
import { bridges } from "./bridge.ts"
import { type Message, messageFrom, rooms } from "./rooms.ts"
import { paneSource } from "../../../core/desktop/places.ts"
import { screenDrawings } from "./drawings.ts"
import { screenMedia } from "./media.ts"
import { bestFound, byLabel, type Found, type Rect as ScreenRect } from "../../../core/desktop/screenmarks.ts"
import { layerOwner } from "./proof.ts"
import { toursOf } from "./tours.ts"
import { takeovers } from "./takeover.ts"
import { drawing, point, answer, saw, hide, reopen, pin } from "./comments.ts"
import { plugin } from "./self.ts"
import type { Near } from "./types.ts"
import { str, hidden, privatePage } from "./settings.ts"
import { moments, notes, windows, asked, send, snapshot, key, agentOf, wroteAt } from "./state.ts"
import { addMoment } from "./intake.ts"
import { panesFrom, privatePane, resolve, paneMoment } from "./windowpanes.ts"
import { askWindow } from "./edits.ts"
import { messageOf } from "./errors.ts"
import { READ_ONLY } from "./lane.ts"
import { target, who } from "./args.ts"
import { awayIn } from "./momentstext.ts"
import { shown, askOf, jobs } from "./wiring.ts"
import { review } from "./propose.ts"
import { openedFor } from "./opening.ts"
import { personComment, mentioned, askIn } from "./people.ts"
import { nearBy, screenSocket } from "./screensocket.ts"
import { ownTour, screenOf } from "./tourscreen.ts"

const log = logger("companion")

export const co = rooms(plugin)
plugin.onChange((paths) => co.changed(paths))
const OWNER = "Owner"
export const YOU: Who = { client: "app/web", agent: null, label: "You", source: "app" }
const notePath = (p: unknown) => { try { return vaultPath(p, false, plugin.vault) } catch { return null } }

const there = bridges(plugin, (ws, m, path) => void co.heard(ws, m, path))
plugin.onUnload(() => there.stop())
const roomMessage = (m: Message) => m.t.startsWith("y") || m.t === "aw"

export const screens = new Set<WebSocket>()
export const takeover = takeovers(send, (name, sx, sy) => void resolve(target({ sx, sy }, true), name).then((t) => wroteAt(name, { ...t, pointed: Date.now() }), () => {}))
export const screenDrawing = screenDrawings(plugin, {
  send: (m) => { for (const ws of screens) send(ws, m) },
  locate: (places) => windowRects(places),
  tint: (a) => agentOf(layerOwner(a)).tint,
  elements: (a) => Object.fromEntries((nearBy.get(key(a)) ?? []).map((e) => [`el:${e.id}`, rectOfNear(e)])),
  live: async (a, ids) => {
    const ask = askOf(a), ui = (e: Near) => e.ui
    if (!ask || awayIn([ask])) return {}
    const els = (nearBy.get(key(a)) ?? []).filter((e) => ids.includes(e.id) && ui(e))
    const now = await Promise.all(els.map((e) => windowRects([`ui:${ui(e)}`], { x: e.frame.x + e.frame.width / 2, y: e.frame.y + e.frame.height / 2 }).then((r) => r[`ui:${ui(e)}`])))
    return Object.fromEntries(els.flatMap((e, i) => (now[i] ? [[`el:${e.id}`, { ...now[i], label: e.label }]] : [])))
  },
  find: (a, text) => screenFind(a, text),
  drawn: (a) => (askOf(a)?.ink ?? []).map((k) => ({ x: k.box.x, y: k.box.y, w: k.box.width, h: k.box.height })),
  words: (a) => {
    const asked = moments.findLast((m) => m.for === a && (m.kind === "ask" || m.kind === "point"))?.t ?? 0
    return [...notes.values()].findLast((n) => n.kind === "say" && n.agent === a && n.t >= asked)?.text
  },
  displays: (a) => (screens.size ? displaysOf(layerOwner(a)).map((d) => ({ x: d.x, y: d.y, w: d.width, h: d.height })) : null),
  media: screenMedia(plugin, { readable: (abs) => READ_ONLY.dirs.some((d) => abs.startsWith(`${d}${path.sep}`)) && !abs.startsWith(`${path.resolve(LOCAL)}${path.sep}`) && !/(^|\/)\.env/.test(abs) }),
})

export const tours = toursOf(plugin, { screen: (name, t) => (t && ownTour(t) ? screenOf(name, { vaultite: true }) : null) ?? screenOf(name), who: (p) => who(p) })
export type ScreenRectLike = { x: number; y: number; width: number; height: number }
export function displaysOf(name: string): ScreenRectLike[] {
  const asked = askOf(name)?.displays ?? []
  return asked.length ? asked : shown?.displays ?? []
}
const rectOfNear = (e: Near): ScreenRect => ({ x: e.frame.x, y: e.frame.y, w: e.frame.width, h: e.frame.height, label: e.label })
async function windowRects(places: string[], near?: { x: number; y: number }): Promise<Record<string, ScreenRect & { q?: number }>> {
  const ws = [...windows.entries()].sort((a, b) => b[1].at - a[1].at)[0]?.[0], reply: { rects?: Record<string, ScreenRect & { q?: number }> } = {}
  if (ws) await askWindow(ws, { t: "locate", places, ...(near ? { near } : {}) }, 3000, reply).catch(() => false)
  return reply.rects ?? {}
}
export async function screenFind(a: string, text: string): Promise<ScreenRect | null> {
  const ask = askOf(a), near = byLabel(nearBy.get(key(a)) ?? [], text)
  if (awayIn([ask].filter((m) => !!m)) || (openedFor.has(key(a)) && openedFor.get(key(a)) === ask)) {
    if (near) return rectOfNear(near)
    const r = await takeover.find(text)
    return r.ok && r.found ? rectOfNear(r.found) : null
  }
  const pointer = ask?.sx !== undefined && ask.sy !== undefined ? { x: ask.sx, y: ask.sy } : undefined
  const by = ask?.ink?.length ? ask.ink.map((k) => ({ x: k.box.x, y: k.box.y, w: k.box.width, h: k.box.height })) : pointer ? [{ ...pointer, w: 0, h: 0 }] : []
  const [here, pages] = await Promise.all([windowRects([`find:${text}`, "pages"], pointer), pageFinds(a, text)])
  const found: Found[] = here[`find:${text}`] ? [{ q: 2, ...here[`find:${text}`] }] : []
  for (const p of pages) {
    const box = here[`page:${p.pane}`]
    for (const r of box ? p.found : []) {
      const at = { x: Math.round(box.x + r.x * p.zoom), y: Math.round(box.y + r.y * p.zoom), w: Math.round(r.w * p.zoom), h: Math.round(r.h * p.zoom), q: r.q }
      if (at.x < box.x + box.w && at.y < box.y + box.h && at.x + at.w > box.x && at.y + at.h > box.y) found.push(at)
    }
  }
  const best = bestFound(found, by)
  if (best) return { x: best.x, y: best.y, w: best.w, h: best.h }
  return near ? rectOfNear(near) : null
}
const Tabs = z.array(z.object({ tab: z.number(), url: z.string(), container: z.string().nullable(), access: z.string(), pane: z.string().optional(), shown: z.boolean().optional() }))
const PageFound = z.object({ zoom: z.number(), found: z.array(z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number(), q: z.number(), label: z.string().optional() })) })
async function pageFinds(name: string, text: string) {
  const tabs = Tabs.safeParse(await plugin.desktop("agent:tabs", { name, session: "", task: "", summary: "", remote: false }).catch(() => [])).data ?? []
  const shown = tabs.filter((t) => t.pane && t.shown && t.access !== "none" && !privatePage(t.url, t.container)).slice(0, 8)
  const late = <T,>(ms: number) => new Promise<T>((_ok, no) => setTimeout(() => no(new Error("late")), ms))
  const each = await Promise.all(shown.map((t) => Promise.race([plugin.desktop("agent:find", t.tab, text), late(1500)])
    .then((r) => { const p = PageFound.safeParse(r).data; return p ? { pane: t.pane!, ...p } : null }, () => null)))
  return each.filter((x) => x !== null)
}

const Focus = z.looseObject({ path: z.string() })
const Hunks = z.array(z.object({ line: z.number(), added: z.array(z.string()), removed: z.array(z.string()) }))
const VERDICTS = ["accept", "reject", "dismiss", "reply"] as const
const isVerdict = (v: unknown): v is typeof VERDICTS[number] => VERDICTS.some((x) => x === v)
plugin.socket("companion/live", (ws, req, { query }) => {
  if (query.screen === "1") return screenSocket(ws, req)
  co.add(ws, { who: YOU, name: OWNER, tint: "red", edits: true, see: (rel) => rel })
  if (query.rooms === "1") {
    ws.on("message", (data: RawData) => {
      const m = messageFrom(data)
      if (m && roomMessage(m)) co.heard(ws, m, notePath(m.path))
    })
    return
  }
  windows.set(ws, { open: [], shown: [], focus: null, at: 0, panes: [] })
  there.add(ws)
  send(ws, snapshot())
  ws.on("message", (data: RawData) => {
    const m = messageFrom(data)
    if (!m) return
    if (roomMessage(m)) {
      const path = notePath(m.path)
      if (path && /\.md$/i.test(path) && there.heard(ws, m, path)) return
      if (co.heard(ws, m, path)) return
    }
    const w = windows.get(ws)
    if (!w) return
    if (m.t === "input") return void tours.input(m)
    if (m.t === "where") {
      w.open = Array.isArray(m.open) ? m.open.filter((p): p is string => typeof p === "string") : w.open
      w.shown = Array.isArray(m.shown) ? m.shown.filter((p): p is string => typeof p === "string") : w.shown
      const f = Focus.safeParse(m.focus).data
      w.focus = f ? { path: f.path, ...(drawing(f.path) ? point(f) : { line: Number(f.line) || 1 }) } : w.focus && w.open.includes(w.focus.path!) ? w.focus : null
      if (w.focus?.path && hidden(w.focus.path)) w.focus = null
      if (m.active) w.at = Date.now()
      if (w.focus && m.active && w.focus.path !== w.was) { w.was = w.focus.path; addMoment({ kind: "open", ...w.focus }) }
      if (Array.isArray(m.panes)) w.panes = panesFrom(m.panes)
      const shownJobs = m.active && w.panes.length ? jobs.cards().filter((j) => j.unseen && w.panes.some((x) => x.to === j.link)) : []
      if (shownJobs.length) jobs.seen(shownJobs.map((j) => j.id))
      w.pane = str(m.pane) || undefined
      const pn = w.panes.find((x) => x.id === w.pane), kind = pn && paneSource(pn.to).kind
      if (pn && m.active && pn.id !== w.told && kind !== "note" && !privatePane(pn)) { w.told = pn.id; addMoment({ kind: "open", pane: pn.id, title: pn.title, ...(kind === "site" ? { url: paneSource(pn.to).url } : {}) }) }
      else if (kind === "note") w.told = pn!.id
    } else if (m.t === "moment" && (m.kind === "ask" || m.kind === "point" || m.kind === "change") && (str(m.pane) || str(m.ui)) && !str(m.path)) {
      w.at = Date.now()
      void paneMoment(m, req)
    } else if (m.t === "moment" && (m.kind === "ask" || m.kind === "point" || m.kind === "edit")) {
      w.at = Date.now()
      addMoment({ kind: m.kind, for: str(m.agent) || undefined, path: str(m.path) || undefined, line: Number(m.line) || undefined, text: str(m.text) || undefined,
        selection: str(m.selection) || undefined, find: m.kind === "point" || str(m.scene) ? str(m.find).slice(0, 200) || undefined : undefined,
        hunks: Hunks.safeParse(m.hunks).data?.slice(0, 40),
        ...(Number(m.waited) >= 0 ? { waited: Math.min(600_000, Math.round(Number(m.waited))) } : {}), ...point(m),
        ...(Array.isArray(m.changes) ? { changes: m.changes.map(String).slice(0, 40) } : {}), ...(str(m.scene) ? { scene: str(m.scene).slice(0, 20_000) } : {}) }, req)
    } else if (m.t === "pin" && typeof m.id === "string") {
      pin(m.id)
    } else if (m.t === "seen" && Array.isArray(m.ids)) {
      saw(m.ids.filter((x): x is string => typeof x === "string"))
    } else if (m.t === "hide" && typeof m.id === "string") {
      hide(m.id)
    } else if (m.t === "reopen" && typeof m.id === "string") {
      reopen(m.id)
    } else if (m.t === "answer" && typeof m.id === "string" && isVerdict(m.verdict)) {
      answer(m.id, m.verdict, str(m.text) || undefined, req)
    } else if (m.t === "review" && typeof m.id === "string" && (m.verdict === "accept" || m.verdict === "reject")) {
      void review(m.id, m.verdict, str(m.change) || undefined, req).catch((e) => log.error(messageOf(e)))
    } else if (m.t === "comment") {
      const c = personComment({ by: "user", agent: "" }, str(m.path), { text: m.text, line: m.line, find: m.find }), to = c && mentioned(c.text!)
      if (c && to) askIn(c, to, str(m.selection).slice(0, 20_000), req)
    } else if (m.t === "done" && typeof m.rid === "string") {
      asked.get(m.rid)?.done(m.ok === true, str(m.error) || undefined, m)
    }
  })
  ws.on("close", () => {
    windows.delete(ws)
    for (const x of [...asked.values()]) if (x.ws === ws) x.done(false, "the window showing it closed as it was typed: read it again before another change")
  })
})
