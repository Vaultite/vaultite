import type { WebSocket } from "ws"
import { z } from "zod"
import type { Message } from "./rooms.ts"
import { stepEffect, thingText, type Thing } from "../../../core/desktop/uimodel.ts"
import { answerOf } from "../../../core/desktop/yesno.ts"

type Rect = { x: number; y: number; width: number; height: number }
export type Near = Thing & { id: string; ax?: string }
const Frame = z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() })
const ThingIn = z.looseObject({ role: z.string(), label: z.string(), frame: Frame,
  state: z.object({ expanded: z.boolean().optional(), selected: z.boolean().optional(), checked: z.union([z.boolean(), z.literal("mixed")]).optional(), disabled: z.boolean().optional(),
    focused: z.boolean().optional(), value: z.string().optional() }).catch({}),
  actions: z.array(z.enum(["press", "expand", "collapse", "focus", "select", "scroll", "menu"])).catch([]), inside: z.array(z.object({ role: z.string(), label: z.string() })).catch([]),
  ui: z.string().optional(), id: z.string().optional() })
const NearIn = ThingIn.extend({ ax: z.string().optional(), id: z.string() })
const maybe = <T extends z.ZodType>(t: T) => t.optional().catch(undefined)
const DoneIn = z.looseObject({ ok: z.boolean().catch(false), why: maybe(z.string()), text: maybe(z.string()), how: maybe(z.string()), near: maybe(z.array(NearIn)), app: maybe(z.string()),
  title: maybe(z.string()), bundle: maybe(z.string()), frame: maybe(Frame), found: maybe(NearIn), moved: maybe(z.boolean()), things: maybe(z.array(ThingIn)),
  behind: maybe(z.boolean()), before: maybe(ThingIn), target: maybe(ThingIn), effect: maybe(z.object({ ok: z.boolean(), saw: z.string() })) })
const Heard = z.object({ kind: z.enum(["ask", "point"]), text: z.unknown() })
const FromHelper = z.discriminatedUnion("t", [
  z.object({ t: z.literal("takeover-asking"), id: maybe(z.string()), ms: maybe(z.number()) }),
  z.object({ t: z.literal("takeover-at"), agent: maybe(z.string()), sx: maybe(z.number()), sy: maybe(z.number()) }),
  DoneIn.extend({ t: z.literal("takeover-done"), id: z.string() }),
])
export type ScreenAct = { action: string; ax?: string; sx?: number; sy?: number; value?: string; key?: string; direction?: string; ask?: string; doing?: string
  app?: string; find?: string; role?: string }
export type Done = { ok: boolean; why?: string; text?: string; how?: string; near?: Near[]; app?: string; title?: string; bundle?: string; frame?: Rect
  found?: Near
  moved?: boolean
  things?: Thing[]
  behind?: boolean
  before?: Thing; target?: Thing; effect?: { ok: boolean; saw: string } }

export function effectOf(action: string, r: Done, was: Near[]): Done["effect"] | undefined {
  if (!r.ok || (!r.before && !r.target)) return undefined
  const a = action === "expand" || action === "collapse" || action === "select" ? action : "click"
  const changed = (r.near ?? []).map((e) => thingText(e)).join("\n") !== was.map((e) => thingText(e)).join("\n")
  const e = stepEffect(a, r.before ?? null, r.target ?? null, changed), s = r.target?.state ?? r.before?.state ?? {}
  return !e.ok && s.expanded === undefined && s.checked === undefined && s.selected === undefined && r.target ? { ok: true, saw: "nothing near it changed, so look at the screen to be sure" } : e
}

export function stepOf(p: ScreenAct, near: Near[]): { action: string; el?: { frame: Rect; role: string; label: string }; at?: { x: number; y: number }; value?: string; key?: string; direction?: string; doing?: string
  app?: string; find?: string; role?: string } {
  const action = p.action === "select" ? "click" : p.action
  const base = { action, ...(p.value !== undefined ? { value: p.value } : {}), ...(p.key ? { key: p.key } : {}), ...(p.direction ? { direction: p.direction } : {}),
    ...(p.doing?.trim() ? { doing: p.doing.trim().slice(0, 52) } : {}),
    ...(p.app?.trim() ? { app: p.app.trim(), ...(p.find?.trim() ? { find: p.find.trim(), ...(p.role ? { role: p.role } : {}) } : {}) } : {}) }
  if (p.ax) {
    const e = near.find((x) => x.id === p.ax)
    if (!e) throw new Error(`no element ${p.ax} near their pointer: the ids are the last ask's (or the last step's) near list`)
    return { ...base, el: { frame: e.frame, role: e.ax ?? e.role, label: e.label } }
  }
  if (p.sx !== undefined && p.sy !== undefined) return { ...base, at: { x: Math.round(p.sx), y: Math.round(p.sy) } }
  return base
}

export const nearText = (near: Near[] = [], head = "Near it now (act or point by id)") =>
  near.length ? `\n${head}:\n${near.slice(0, 40).map((e) => `  ${thingText(e, { frame: true })}`).join("\n")}` : ""

export function doneText(r: Done): string {
  if (!r.ok) return r.text ?? `It didn't work (${r.why ?? "no answer"}).`
  if (r.effect && !r.effect.ok) return `It did the step, but ${r.effect.saw}: tell them plainly, or try another way.${nearText(r.near?.slice(0, 20))}`
  const how = r.how === "none" ? " (it already was)" : r.how === "ax" ? " (through Accessibility)" : r.how === "point" ? (r.behind ? " (clicked there, their pointer untouched)" : " (with the pointer)") : r.how === "key" ? " (with the keys)" : ""
  if (r.behind) return `Done in ${r.app ?? "that app"}, behind their window${how}, and read back${r.effect?.ok ? `: ${r.effect.saw}` : ""}.`
  const now = r.app ? ` Now in ${r.app}${r.title ? `, "${r.title}"` : ""}.` : ""
  if (r.moved === false) return `Scrolled${how}, but nothing there moved: it's at its end, or that part doesn't scroll (point at what to scroll).${now}`
  return `Done${how}${r.effect ? `: ${r.effect.saw}` : ""}.${now}${nearText(r.near?.slice(0, 20))}`
}


const STEP_MS = 120_000

export function takeovers(send: (ws: WebSocket, m: object) => void, fly: (agent: string, sx: number, sy: number) => void) {
  const waiting = new Map<string, { ws: WebSocket; done: (r: Done) => void; wait: (ms: number) => void }>()
  const offering = new Map<WebSocket, Set<string>>()
  const up = (ws: WebSocket) => (offering.get(ws)?.size ?? 0) > 0
  const drop = (ws: WebSocket, id?: string) => { const o = offering.get(ws); if (!o) return; if (id) o.delete(id); else o.clear(); if (!o.size) offering.delete(ws) }
  let from: WebSocket | null = null, n = 0
  return {
    heard(ws: WebSocket, msg: Message): boolean {
      from = ws
      const m = Heard.safeParse(msg).data
      if (!up(ws) || !m) return false
      const yes = typeof m.text === "string" ? answerOf(m.text) : null
      if (yes === null) drop(ws)
      send(ws, yes === null ? { t: "takeover-answer", yes: false, asked: true } : { t: "takeover-answer", yes })
      return yes !== null
    },
    offering: up,
    message(ws: WebSocket, msg: Message): boolean {
      const m = FromHelper.safeParse(msg).data
      if (m?.t === "takeover-asking") { if (m.id !== undefined) offering.set(ws, (offering.get(ws) ?? new Set()).add(m.id)); if (m.id !== undefined && m.ms !== undefined) waiting.get(m.id)?.wait(m.ms + STEP_MS); return true }
      if (m?.t === "takeover-at") { if (m.agent !== undefined && m.sx !== undefined && m.sy !== undefined) fly(m.agent, m.sx, m.sy); return true }
      if (m?.t !== "takeover-done") return false
      drop(ws, m.id)
      const w = waiting.get(m.id)
      if (w?.ws === ws) { waiting.delete(m.id); w.done(m) }
      return true
    },
    closed(ws: WebSocket) {
      offering.delete(ws)
      if (from === ws) from = null
      for (const [id, w] of waiting) if (w.ws === ws) { waiting.delete(id); w.done({ ok: false, why: "gone", text: "the helper went away (the app quit or restarted)" }) }
    },
    async act(step: ReturnType<typeof stepOf>, who: { agent: string; tint: string; ask?: string }): Promise<Done> {
      const { apps, sites } = (await import("./settings.ts")).privates()
      return request((id) => ({ t: "takeover", id, agent: who.agent, tint: who.tint, step, apps, sites, ...(who.ask ? { ask: who.ask } : {}) }), STEP_MS)
    },
    confirm: (line: string, sub: string, who: { agent: string; tint: string }) => request((id) => ({ t: "confirm", id, line, sub, agent: who.agent, tint: who.tint }), 15_000),
    open: (o: { url?: string; app?: string; path?: string }) => request((id) => ({ t: "open", id, ...o }), 15_000),
    find: (text: string) => request((id) => ({ t: "find", id, text }), 3000),
    things: () => request((id) => ({ t: "things", id }), 3000),
  }
  function request(m: (id: string) => object, ms: number): Promise<Done> {
    const ws = from
    if (!ws || ws.readyState !== ws.OPEN) return Promise.resolve({ ok: false, why: "none", text: "no Mac's helper asked: acting on the screen works only on an ask made there (the Talk key)" })
    const id = `to${++n}`
    return new Promise((done) => {
      let late: ReturnType<typeof setTimeout> | undefined
      const wait = (t: number) => { clearTimeout(late); late = setTimeout(() => { if (waiting.delete(id)) done({ ok: false, why: "timeout", text: "the helper didn't answer in time" }) }, t) }
      wait(ms)
      waiting.set(id, { ws, done: (r) => { clearTimeout(late); done(r) }, wait })
      send(ws, m(id))
    })
  }
}

export function macOpen(to: string, app: string, vault: string, home: string): { url?: string; app?: string; path?: string } | null {
  const full = to === "~" ? home : to.startsWith("~/") ? `${home}/${to.slice(2)}` : to
  const inVault = full === vault || full.startsWith(`${vault}/`)
  const what: { url?: string; path?: string } | null = !to ? {} : /^[a-z][\w+.-]*:/i.test(to) && !/^(view|file):/i.test(to) ? { url: to } : full.startsWith("/") && !inVault ? { path: full } : null
  if (app) return what ? { app, ...what } : { app }
  return what && (what.url || what.path) && !/^https?:/i.test(what.url ?? "") ? what : null
}

const BROWSERS = /^(com\.google\.Chrome(\.\w+)?|com\.apple\.Safari(TechnologyPreview)?|org\.mozilla\.\w+|company\.thebrowser\.\w+|com\.brave\.Browser(\.\w+)?|com\.microsoft\.edgemac(\.\w+)?|com\.operasoftware\.Opera\w*|com\.vivaldi\.Vivaldi|app\.zen-browser\.zen|org\.chromium\.Chromium|com\.kagi\.kagimacOS|ai\.perplexity\.comet)$/
export const isBrowser = (bundle: string) => BROWSERS.test(bundle)
