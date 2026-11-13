import { screens, takeover, tours, screenDrawing, YOU } from "./windows.ts"
import type { IncomingMessage } from "node:http"
import { type RawData, WebSocket } from "ws"
import { z } from "zod"
import { type Message, messageFrom } from "./rooms.ts"
import { PLACE_KEYS } from "../../../core/desktop/places.ts"
import { rectOf, spots } from "../../../core/desktop/screenmarks.ts"
import { thingFrom } from "../../../core/desktop/uimodel.ts"
import { saw, hide, keepSaid } from "./comments.ts"
import { plugin } from "./self.ts"
import type { Rect, Near, Note } from "./types.ts"
import { sayMs, str, mode, ownName } from "./settings.ts"
import { agents, notes, said, setSaid, acts, did, windows, send, broadcast, snapshot, key, isMain, setAgent, putNote, dropNote } from "./state.ts"
import { addMoment } from "./intake.ts"
import { screenUnheard, paneMoment } from "./windowpanes.ts"
import { stopStreams } from "./edits.ts"
import { messageOf } from "./errors.ts"
import { lane } from "./lane.ts"
import { jobs, knocks } from "./wiring.ts"

export const SCREEN_NEWS = new Set(["state", "agent", "note", "drop", "said", "hush", "voice"])
export let lastScreen: WebSocket | null = null
export const toScreens = (m: object) => { const text = JSON.stringify(m); for (const ws of screens) if (ws.readyState === ws.OPEN) ws.send(text) }
const OWN_SHOT = /[/\\]screens[/\\](window-\d+-\d+|display-\d+-\d+|close-\d+-\d+)\.png$/
const Box = z.object({ x: z.coerce.number(), y: z.coerce.number(), width: z.coerce.number(), height: z.coerce.number() })
  .transform((v): Rect => ({ x: Math.round(v.x), y: Math.round(v.y), width: Math.round(v.width), height: Math.round(v.height) }))
const rect = Box.nullable().catch(null).parse
const listOf = <T,>(item: z.ZodType<T | null>, most: number) => z.array(z.unknown()).catch([]).transform((xs) => xs.slice(0, most).flatMap((x) => item.safeParse(x).data ?? []))
const NearList = listOf(z.unknown().transform((e) => { const t = thingFrom(e); return t?.id ? { ...t, id: t.id } : null }), 40)
const InkList = listOf(z.looseObject({ box: z.unknown().optional(), points: z.array(z.unknown()).catch([]) }).transform((k) => {
  const box = rect(k.box)
  return box && { shape: str(k.shape).slice(0, 20), box, points: k.points.slice(0, 40).map((p): [number, number] => (Array.isArray(p) ? [Math.round(Number(p[0])), Math.round(Number(p[1]))] : [0, 0])) }
}), 12)
const FloatingList = listOf(z.object({ frame: z.unknown().optional(), app: z.unknown().optional(), name: z.unknown().optional() })
  .transform((w) => { const frame = rect(w.frame); return frame && str(w.app) ? { app: str(w.app).slice(0, 200), name: str(w.name).slice(0, 120), frame } : null }), 6)
const ClickList = listOf(z.object({ sx: z.coerce.number(), sy: z.coerce.number(), under: z.unknown().optional() })
  .transform((c) => ({ sx: Math.round(c.sx), sy: Math.round(c.sy), ...(str(c.under) ? { under: str(c.under).slice(0, 300) } : {}) })), 8)
const Displays = listOf(Box.refine((d) => d.width > 0 && d.height > 0), 8)
const CloseUpIn = z.object({ shot: z.string().regex(OWN_SHOT), at: Box, scale: z.coerce.number().min(1).max(4), mark: z.enum(["ring", "pointer"]).optional().catch(undefined) })
type ScreenAsk = Partial<Message>
function screenPlace(m: ScreenAsk) {
  const shot = str(m.shot), down = str(m.shotDown), window = Number(m.window), sx = Number(m.sx), sy = Number(m.sy)
  const near = NearList.parse(m.near), ink = InkList.parse(m.ink), floating = FloatingList.parse(m.floating), clicks = ClickList.parse(m.clicks)
  const c = CloseUpIn.safeParse(m.closeUp).data
  const close = OWN_SHOT.test(shot) && c ? { shot: c.shot, at: c.at, scale: c.scale, ...(c.mark ? { mark: c.mark } : {}) } : null
  const at = rect(m.shotAt), displays = Displays.parse(m.displays)
  return { ...(str(m.app) ? { app: str(m.app).slice(0, 200), ...(str(m.appName) ? { appName: str(m.appName).slice(0, 120) } : {}) } : {}), ...(Number.isInteger(window) && window > 0 ? { window } : {}), ...(Number.isInteger(Number(m.shotWindow)) && Number(m.shotWindow) > 0 ? { shotWindow: Number(m.shotWindow) } : {}), ...(str(m.title) ? { title: str(m.title).slice(0, 300) } : {}),
    ...(str(m.screen) ? { screen: str(m.screen).slice(0, 20_000) } : {}), ...(str(m.under) ? { under: str(m.under).slice(0, 700) } : {}),
    ...(str(m.chrome) ? { chrome: str(m.chrome).slice(0, 40) } : {}),
    ...(Number.isFinite(sx) && Number.isFinite(sy) && m.sx !== undefined && m.sy !== undefined ? { sx: Math.round(sx), sy: Math.round(sy) } : {}),
    ...(OWN_SHOT.test(shot) ? { shot, ...(at ? { shotAt: at } : {}) } : {}),
    ...(OWN_SHOT.test(down) && OWN_SHOT.test(shot) ? { shotDown: down, ...(rect(m.shotDownAt) ? { shotDownAt: rect(m.shotDownAt)! } : {}) } : {}),
    ...(str(m.notices) ? { notices: str(m.notices).slice(0, 1200) } : {}), ...(close ? { closeUp: close } : {}),
    ...(near.length ? { near } : {}), ...(ink.length ? { ink } : {}), ...(floating.length ? { floating } : {}), ...(displays.length ? { displays } : {}), ...(rect(m.region) ? { region: rect(m.region)! } : {}),
    ...(clicks.length ? { clicks } : {}) }
}
export const nearBy = new Map<string, Near[]>()
export function comeBack(name: string) {
  if (!agents.has(key(name))) return
  const w = [...windows.values()].sort((a, b) => b.at - a.at).find((x) => x.focus), f = w?.focus?.path && w.shown.includes(w.focus.path) ? w.focus : null
  setAgent(name, { ...Object.fromEntries(PLACE_KEYS.map((k) => [k, undefined])), ...(f?.path ? { path: f.path, line: f.line } : {}) }, true)
}
export function screenMoment(m: ScreenAsk, req?: IncomingMessage) {
  if (m.kind !== "ask" && m.kind !== "point") return null
  const place = screenPlace(m)
  if (!place.app && place.sx === undefined) return null
  nearBy.set(key(str(m.agent) || ownName()), place.near ?? [])
  const up = Number(m.keyUp), waited = Number.isFinite(up) ? Date.now() - up : NaN
  const talk = Array.isArray(m.talk) ? m.talk.slice(-8).map((x) => str(x).slice(0, 300)).filter(Boolean) : []
  const asked = { summoned: true as const, ...(m.voice === true ? { voice: true } : {}), ...(waited >= 0 && waited < 60_000 ? { waited: Math.round(waited) } : {}),
    ...(m.front === "realtime" ? { front: "realtime" as const, ...(talk.length ? { talk } : {}) } : {}) }
  if (!place.app && (str(m.pane) || str(m.ui))) {
    const { under: _, title: __, ...seen } = place
    return void paneMoment({ ...m, summoned: true }, req, { ...seen, ...asked })
  }
  if (!place.app && str(m.path)) {
    const selection = str(m.selection).slice(0, 4000) || undefined
    return addMoment({ kind: m.kind, for: str(m.agent) || undefined, path: str(m.path), line: Number(m.line) || undefined, text: str(m.text) || undefined, ...(selection ? { selection } : {}),
      ...(m.kind === "point" && str(m.find) ? { find: str(m.find).slice(0, 200) } : {}), ...place, ...asked }, req)
  }
  return addMoment({ kind: m.kind, for: str(m.agent) || undefined, text: str(m.text) || undefined, ...place, ...asked }, req)
}
export const realtimePaused = new Map<WebSocket, { account: string; why: string; until: number } | null>()
export const pausedNow = () => [...realtimePaused.values()].find((p) => p && p.until > Date.now()) ?? null
export const mics = new Map<WebSocket, string>()
export const calls = new Map<WebSocket, string>()
function screenAnswered(m: Message) {
  const name = str(m.agent) || ownName(), heard = str(m.heard).trim().slice(0, 2000), words = str(m.said).trim().slice(0, 2000)
  if (!words || mode() === "off") return
  const t = Date.now()
  const asks = m.withdraw === true && isMain(name) ? lane().withdraw() : []
  if (asks.length) { did(name, "withdrawn", asks.map((x) => x.seq)); acts.append(t, [{ t, as: name, op: "say", text: words }]) }
  else did(name, "talked", undefined, JSON.stringify({ heard, said: words }))
  if (asks.length) {
    const ts = new Set(asks.map((x) => x.t)), theirs = (n: Note) => n.kind === "say" && key(n.agent) === key(name) && !!n.answers && ts.has(n.answers.t)
    for (const n of [...notes.values()].filter(theirs)) dropNote(n.id)
    if (said.some(theirs)) { setSaid(said.filter((n) => !theirs(n))); broadcast({ t: "said", said }) }
  } else if (heard) keepSaid({ id: `ask-rt-${t}`, kind: "ask", by: "user", agent: name, text: heard, t, seen: true })
  keepSaid(putNote({ kind: "say", agent: name, text: words, seen: true, answers: { t, realtime: true } }, sayMs(words)))
}
const Paused = z.object({ account: z.unknown().optional(), why: z.unknown().optional(), until: z.unknown().optional() })
export function screenSocket(ws: WebSocket, req: IncomingMessage) {
  screens.add(ws)
  send(ws, snapshot())
  for (const m of screenDrawing.messages()) send(ws, m)
  send(ws, { t: "jobs", jobs: jobs.cards() })
  knocks.hello()
  ws.on("message", (data: RawData) => {
    const m = messageFrom(data)
    if (!m) return
    if (takeover.message(ws, m)) return
    if (m.t === "input") return void tours.input(m)
    if (m.t === "hide" && typeof m.id === "string") return void hide(m.id)
    if (m.t === "home" && typeof m.agent === "string") return void comeBack(m.agent)
    if (m.t === "summoning") return void lane().warm()
    if (m.t === "interrupt") return void (takeover.offering(ws) || bargeIn())
    if (m.t === "riding") return void ride(ws, str(m.agent).slice(0, 80))
    if (m.t === "job-seen" && Array.isArray(m.ids)) return void jobs.seen(m.ids.filter((x): x is string => typeof x === "string").slice(0, 30))
    if (m.t === "saw" && Array.isArray(m.ids)) return void saw(m.ids.filter((x): x is string => typeof x === "string").slice(0, 100))
    if (m.t === "knock" || m.t === "moment") lastScreen = ws
    if (m.t === "knock") return void knocks.heard(m)
    if (m.t === "drawing-act") return void drawingAct(m, req)
    if (m.t === "moment" && !takeover.heard(ws, m)) screenMoment(m, req)
    if (m.t === "answered") screenAnswered(m)
    if (m.t === "mic") mics.set(ws, str(m.mic).slice(0, 300))
    if (m.t === "unheard" || m.t === "heard") return void screenUnheard(m)
    if (m.t === "call") { if (str(m.call)) calls.set(ws, str(m.call).slice(0, 120)); else calls.delete(ws) }
    if (m.t === "realtime") { const p = Paused.safeParse(m.paused).data; realtimePaused.set(ws, p ? { account: str(p.account), why: str(p.why).slice(0, 300), until: Number(p.until) || 0 } : null) }
  })
  ws.on("close", () => { screens.delete(ws); realtimePaused.delete(ws); mics.delete(ws); calls.delete(ws); takeover.closed(ws); ride(ws, "") })
}
function bargeIn() {
  if (!lane().busy()) return
  const name = ownName()
  stopStreams(name)
  void lane().interrupt().then((ok) => { if (ok) did(name, "stopped") }, () => {})
}
const ridingBy = new Map<WebSocket, string>()
export const riding = () => [...ridingBy.values()].find(Boolean) ?? ""
function ride(ws: WebSocket, agent: string) {
  const was = riding()
  if (agent) ridingBy.set(ws, agent); else ridingBy.delete(ws)
  if (riding() === was) return
  const there = was ? [...notes.values()].filter((n) => n.kind === "say" && n.answers && key(n.agent) === key(was)).map((n) => n.id) : []
  for (const id of there) dropNote(id)
  saw(there)
  broadcast({ t: "riding", agent: riding() })
}

const Move = z.object({ mark: z.string(), dx: z.number(), dy: z.number() })
function drawingAct(m: Message, req: IncomingMessage) {
  if (m.kind === "changed" && Array.isArray(m.marks)) return void screenDrawing.changed(str(m.id), m.marks.filter((x): x is string => typeof x === "string"))
  if (m.kind === "moved" && Array.isArray(m.moves)) return void screenDrawing.moved(str(m.id), m.moves.flatMap((x) => Move.safeParse(x).data ?? []))
  const d = screenDrawing.byId(str(m.id))
  if (!d) return
  if (m.kind === "clear") return void screenDrawing.clear({ id: d.id })
  if (m.kind === "settle") return void screenDrawing.settle(d.agent)
  if (m.kind === "dismiss" && typeof m.mark === "string") return void screenDrawing.dismiss(d.id, m.mark)
  if (m.kind === "media" && typeof m.mark === "string") return void screenDrawing.media(d.id, m.mark, { ...(typeof m.sound === "boolean" ? { sound: m.sound } : {}), ...(typeof m.paused === "boolean" ? { paused: m.paused } : {}) })
  if (m.kind === "keep") return void plugin.runOp("companion.save-drawing", { id: d.id, places: m.places ?? {} }, YOU, req).catch((e) => console.error(`companion: keep: ${messageOf(e)}`))
  const a = agents.get(key(d.agent)), r = spots(d.marks).map((s) => rectOf(s, d.places)).find(Boolean)
  if (m.kind === "ask" && str(m.text)) addMoment({ kind: "ask", for: d.agent, text: str(m.text).slice(0, 2000), ...(a?.app ? { app: a.app } : {}),
    ...(r ? { sx: Math.round(r.x + r.w / 2), sy: Math.round(r.y + r.h / 2) } : a?.sx !== undefined ? { sx: a.sx, sy: a.sy } : {}) }, req)
}
