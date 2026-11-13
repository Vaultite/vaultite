import { screens, screenDrawing, displaysOf, takeover } from "./windows.ts"
import { z } from "zod"
import type { Item } from "../../../core/vault.ts"
import { type Message } from "./rooms.ts"
import { checkMarks, type Mark, type Spot as ScreenSpot } from "../../../core/desktop/screenmarks.ts"
import { beforeLayer, FLIPS } from "./proof.ts"
import { sitesOf } from "./guides.ts"
import { type Screen } from "./tours.ts"
import type { Tour } from "./tour.ts"
import type { Seen } from "../../../core/desktop/anchor.ts"
import { MARKS, markOf, type Spot } from "./tags.ts"
import { check as checkOn, listView } from "../../../core/desktop/uimodel.ts"
import { plugin } from "./self.ts"
import { agents, notes, said, passedAt, showedAt, windows, send, key, isMain } from "./state.ts"
import { addMoment } from "./intake.ts"
import { askWindow } from "./edits.ts"
import { messageOf } from "./errors.ts"
import { AS_TOOL } from "./chat.ts"
import { lane } from "./lane.ts"
import { turning } from "./chatturns.ts"
import { awayIn } from "./momentstext.ts"
import { askOf } from "./wiring.ts"
import { logger } from "../../../core/plugins.ts"

const log = logger("companion")

const lastWindow = () => [...windows.entries()].sort((a, b) => b[1].at - a[1].at)[0]?.[0]
const Frame = z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() })
const Shown = z.looseObject({ role: z.string(), label: z.string(), frame: Frame, ui: z.string().optional(), id: z.string().optional(), within: z.string().optional(),
  inside: z.array(z.object({ role: z.string(), label: z.string() })).optional() })
const withinOf = (s: Seen) => ("within" in s && typeof s.within === "string" ? s.within : undefined)
const tagKind = (k: string) => (k === "point" ? k : MARKS.find((x) => x === k))
const ActDone = z.object({ ok: z.boolean().optional(), text: z.string().optional(), saw: z.string().optional() })
function glides(up: Mark[], marks: unknown[]) {
  let next: Mark[]
  try { next = checkMarks(marks) } catch { return null }
  if (up.length !== next.length) return null
  const box = (v?: ScreenSpot) => (v && "x" in v && "w" in v ? v : null)
  const out: { mark: string; dx: number; dy: number }[] = []
  for (const [i, m] of up.entries()) {
    const n = next[i], a = "at" in m ? box(m.at) : null, b = "at" in n ? box(n.at) : null
    if (!m.id || m.type !== n.type || !a || !b || Math.abs(a.w - b.w) > 4 || Math.abs(a.h - b.h) > 4) return null
    out.push({ mark: m.id, dx: b.x - a.x, dy: b.y - a.y })
  }
  return out
}
let flipping: { layer: string; timers: ReturnType<typeof setTimeout>[] } | null = null
export function stopFlips() {
  if (!flipping) return
  for (const t of flipping.timers) clearTimeout(t)
  screenDrawing.clear({ agent: flipping.layer })
  flipping = null
}
async function flip(name: string, src: string, at: { x: number; y: number; width: number; height: number }) {
  stopFlips()
  const layer = beforeLayer(name)
  try {
    await screenDrawing.draw(layer, [{ type: "image", src, at: [at.x, at.y, at.width, at.height], over: true, caption: "Before", life: "dismiss" }])
  } catch (e) { return void log.error(`a before picture didn't show: ${messageOf(e)}`) }
  const mine: NonNullable<typeof flipping> = { layer, timers: [] }
  mine.timers = FLIPS.map(([ms, on]) => setTimeout(() => { if (flipping === mine) screenDrawing.toggle(layer, on) }, ms))
  flipping = mine
}
export const ownTour = (t: Pick<Tour, "app" | "site">) => !t.site.length && (!t.app.length || t.app.includes("vaultite"))
export function screenOf(name: string, o: { vaultite?: boolean } = {}): Screen | null {
  const ask = askOf(name), away = ask && !o.vaultite ? awayIn([ask]) : ""
  if (away === "a private app") return null
  const call = (op: string, p: Item) => plugin.host.call(op, { ...p, ...(isMain(name) ? {} : { as: name }) }, AS_TOOL, { report: "companion tour" })
  const mid = (s: Seen) => ({ sx: Math.round(s.frame.x + s.frame.width / 2), sy: Math.round(s.frame.y + s.frame.height / 2) })
  const spot = (s: Seen): Spot => ({ sx: s.frame.x, sy: s.frame.y, w: s.frame.width, h: s.frame.height })
  const sayIt = async (text: string) => { await call("companion.say", { text }) }
  const drawnOf = (marks: Parameters<Screen["show"]>[1]) => marks.flatMap((m) => {
    const kind = tagKind(m.kind)
    const x = !m.at || !kind || kind === "point" ? null : markOf({ kind, at: spot(m.at), ...(m.to ? { to: spot(m.to) } : {}), ...(m.label ? { label: m.label } : {}), ...(m.n !== undefined ? { n: m.n } : {}), ...(m.dir ? { dir: m.dir } : {}), offset: 0 })
    return x ? [x] : []
  })
  const overScreen = () => screens.size > 0 && displaysOf(name).length > 0
  let drewCard = false
  async function show(text: string, marks: Parameters<Screen["show"]>[1], before?: string, draw?: Parameters<Screen["show"]>[3]) {
    stopFlips()
    if (drewCard) { drewCard = false; screenDrawing.clear({ agent: name }) }
    const placed = marks.filter((m) => m.at)
    const asked = askOf(name), here = overScreen() && asked?.sx !== undefined ? { sx: asked.sx, sy: asked.sy } : {}
    if (draw?.length) {
      drewCard = true
      const at = drawnOf(placed), point = placed.find((m) => m.kind === "point")
      if (point || "sx" in here) await call("companion.look", point ? mid(point.at!) : here)
      return void await call("companion.draw", { marks: [...at, ...draw.map((d) => ({ life: "ask", ...d }))], ...(text ? { say: text } : {}) })
    }
    if (before && overScreen() && placed[0]) void flip(name, before, placed[0].at!.frame)
    if (overScreen() && placed.length) {
      const drawn = drawnOf(placed)
      const point = placed.find((m) => m.kind === "point")
      if (point) await call("companion.look", mid(point.at!))
      if (drawn.length) return void await call("companion.draw", { marks: drawn, ...(text ? { say: text } : {}) })
      if (text) await call("companion.say", { text, ...(point ? mid(point.at!) : {}) })
      return
    }
    const places = placed.flatMap((m) => { const s = m.at, within = s && withinOf(s); return !s ? [] : s.ui ? [{ ui: s.ui }] : within ? [{ ui: within, find: s.label }] : [] })
    for (const p of places.slice(1)) await call("companion.highlight", p).catch(() => {})
    if (text) await call("companion.say", { text, ...(places[0] ?? here) })
    else if (places[0]) await call("companion.look", places[0])
  }
  async function act(d: Parameters<Screen["act"]>[0], at: Seen | null) {
    try {
      if (away) {
        const step = d.action === "click" ? { action: "click" } : d.action === "type" ? { action: "type", value: d.value ?? "" } : d.action === "press" ? { action: "press", key: d.key } : { action: "scroll", direction: d.dir ?? "down" }
        const r = ActDone.safeParse((await call("companion.act", { ...step, ...(at ? mid(at) : {}) })).result).data
        return r?.ok === false ? { ok: false, why: r.text ?? "it didn't work" } : { ok: true }
      }
      if (d.action !== "click") return { ok: false, why: `in Vaultite's own UI it only clicks: ${d.action} isn't something it can do there, so the user does it` }
      const s = at, within = s && withinOf(s)
      if (!s) return { ok: false, why: "nothing to click: name it by its words" }
      const r = ActDone.safeParse((await call("companion.act", { action: "click", ...(s.ui ? { ui: s.ui } : { ...(within ? { ui: within } : {}), find: s.label }) })).result).data
      return r?.ok === false ? { ok: false, why: r.saw ?? "it didn't work" } : { ok: true }
    } catch (e) { return { ok: false, why: messageOf(e) } }
  }
  async function fallback(tour: Parameters<Screen["fallback"]>[0], step: Parameters<Screen["fallback"]>[1], missing: string[], signal?: AbortSignal) {
    const t0 = Date.now(), last = askOf(name)
    const place = Object.fromEntries((["app", "window", "title", "sx", "sy", "path", "line", "pane", "ui", "url", "displays"] as const).flatMap((k) => (last?.[k] !== undefined ? [[k, last[k]]] : [])))
    const text = `(A step of their tour "${tour.title}", played for them, not their words. Step ${step.n}: ${step.text}\nNot found on their screen now: ${missing.map((x) => JSON.stringify(x)).join(", ")}. If it shows there under other words or moved, say this step yourself, its tag on it as it shows now. If it isn't on their screen, say nothing: let it pass (mcp__vaultite-app__pass "not there"); the tour tells them itself.)`
    if (signal?.aborted) return false
    const m = addMoment({ kind: "ask", for: name, summoned: true, tour: true, text, ...place })
    if (!m) return false
    const k = key(name), showed = () => !((passedAt.get(k) ?? 0) >= t0) && ((showedAt.get(k) ?? 0) >= t0 || (agents.get(k)?.pointed ?? 0) >= t0)
    const answered = () => (passedAt.get(k) ?? 0) >= t0 || [...notes.values(), ...said].some((n) => n.kind === "say" && key(n.agent) === k && n.t >= t0) || showed()
    const busy = () => (lane().takes(m) ? lane().busy() : turning.has(k))
    const withdraw = () => { if (lane().takes(m)) lane().drop(m) }
    signal?.addEventListener("abort", withdraw, { once: true })
    try {
      let began = false
      for (const end = t0 + 90_000; Date.now() < end && !signal?.aborted;) {
        await new Promise((ok) => setTimeout(ok, 300))
        if (busy()) began = true
        else if (began || answered()) break
      }
      return !signal?.aborted && showed()
    } finally { signal?.removeEventListener("abort", withdraw) }
  }
  const inputs = (on: boolean) => { for (const ws of [...windows.keys(), ...screens]) send(ws, { t: "inputs", on }) }
  async function follow(marks: Parameters<Screen["show"]>[1]) {
    if (!overScreen()) return
    const drawn = drawnOf(marks), up = screenDrawing.layer(name), moves = up && glides(up.marks.filter((m) => !m.gone), drawn)
    if (up && moves) return void screenDrawing.moved(up.id, moves)
    screenDrawing.clear({ agent: name })
    if (drawn.length) await call("companion.draw", { marks: drawn }).catch(() => {})
  }
  if (away) {
    if (!screens.size) return null
    const site = sitesOf(ask!)[0]
    const read = async () => { const r = await takeover.things(); return r.ok ? r.things ?? [] : null }
    return {
      things: async () => { const t = await read(); return t && { where: { app: ask!.app, ...(site ? { site } : {}) }, things: t } },
      holds: async (c, before) => { const t = await read(); return !!t && checkOn(c, listView(t), before).ok },
      snapshot: async () => listView((await read()) ?? []).snapshot(),
      show, say: sayIt, act, fallback, inputs, ...(overScreen() ? { follow } : {}),
    }
  }
  if (!lastWindow()) return null
  const fromWindow = async <S extends z.ZodType>(m: Message, reply: S): Promise<z.infer<S> | null> => {
    const ws = lastWindow(), got = {}
    if (!ws) return null
    return (await askWindow(ws, m, 3000, got).catch(() => false)) ? reply.safeParse(got).data ?? null : null
  }
  return {
    things: async () => {
      const r = await fromWindow({ t: "things" }, z.object({ window: Frame.optional(), things: z.array(Shown).optional() }))
      return r?.things ? { where: { app: "vaultite", ...(r.window ? { window: r.window } : {}) }, things: r.things } : null
    },
    holds: async (c, before) => (await fromWindow({ t: "check", condition: c, ...(before !== undefined ? { before } : {}) }, z.object({ verdict: z.object({ ok: z.boolean() }).optional() })))?.verdict?.ok === true,
    snapshot: async () => (await fromWindow({ t: "snapshot" }, z.object({ snapshot: z.string().optional() })))?.snapshot ?? "",
    show, say: sayIt, act, fallback, inputs, ...(overScreen() ? { follow } : {}),
  }
}
