// Take-over, the server's side: act on the screen goes to the helper the ask came from (electron/takeover.ts); a
// spoken yes or no while its offer waits answers it instead of being an ask.
import type { WebSocket } from "ws"
import { stepEffect, thingText, type Thing } from "./uimodel.ts"

type Rect = { x: number; y: number; width: number; height: number }
/** A thing near the pointer (uimodel.ts), by its id; `ax`: its Accessibility role, which the helper finds it again by. */
export type Near = Thing & { id: string; ax?: string }
/** What act was told, on the screen. */
export type ScreenAct = { action: string; ax?: string; sx?: number; sy?: number; value?: string; key?: string; direction?: string; ask?: string; doing?: string
  /** Behind their windows: the app, and the element there by its words (and role). */
  app?: string; find?: string; role?: string }
export type Done = { ok: boolean; why?: string; text?: string; how?: string; near?: Near[]; app?: string; title?: string; bundle?: string; frame?: Rect
  /** A find's: the element saying the words, in the window asked about. */
  found?: Near
  /** A scroll's: false when nothing there moved (at its end, or not what scrolls). */
  moved?: boolean
  /** A things request's: every thing in the window asked about (uimodel.ts' shape). */
  things?: Thing[]
  /** Done behind their windows (read back there), their pointer and front app untouched. */
  behind?: boolean
  /** A step's element before it and after, read back; `effect`: what that says it did (the server's). */
  before?: Thing; target?: Thing; effect?: { ok: boolean; saw: string } }

/** What a step in another app did, from its element's state before and after and whether what's near it changed. */
export function effectOf(action: string, r: Done, was: Near[]): Done["effect"] | undefined {
  if (!r.ok || (!r.before && !r.target)) return undefined
  const a = action === "expand" || action === "collapse" || action === "select" ? action : "click"
  const changed = (r.near ?? []).map((e) => thingText(e)).join("\n") !== was.map((e) => thingText(e)).join("\n")
  const e = stepEffect(a, r.before ?? null, r.target ?? null, changed), s = r.target?.state ?? r.before?.state ?? {}
  // (a plain button: only what's near it is read, so an unchanged neighbourhood isn't proof it did nothing)
  return !e.ok && s.expanded === undefined && s.checked === undefined && s.selected === undefined && r.target ? { ok: true, saw: "nothing near it changed, so look at the screen to be sure" } : e
}

/** Their spoken answer to an offer: no at any no word in it ("please stop", "sure, not that one"), yes only when it's
 *  yes words alone, else neither (an ask of its own). */
const NO = /\b(no|nope|nah|don'?t|do not|not|stop|wait|never ?mind|cancel|hold on|later|não)\b/
const YES = /^((yes|yeah|yep|yup|sure|ok|okay|please|go ahead|go for it|do it|let'?s do it|sounds good|alright|all right|absolutely|of course|thanks|thank you|sim|claro|pode)\s*)+$/
export function answerOf(words: string): boolean | null {
  const w = words.toLowerCase().replace(/[^\p{L}\p{N}' ]+/gu, " ").replace(/\s+/g, " ").trim()
  if (!w || w.split(" ").length > 8) return null
  if (NO.test(w)) return false
  return YES.test(w) ? true : null
}

/** The step the helper is sent, from act's params and the ask's elements (`near`). */
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

/** Elements by id, as act and open answer them. */
export const nearText = (near: Near[] = [], head = "Near it now (act or point by id)") =>
  near.length ? `\n${head}:\n${near.slice(0, 40).map((e) => `  ${thingText(e, { frame: true })}`).join("\n")}` : ""

/** What act answers after a step on the screen. */
export function doneText(r: Done): string {
  if (!r.ok) return r.text ?? `It didn't work (${r.why ?? "no answer"}).`
  if (r.effect && !r.effect.ok) return `It did the step, but ${r.effect.saw}: tell them plainly, or try another way.${nearText(r.near?.slice(0, 20))}`
  const how = r.how === "none" ? " (it already was)" : r.how === "ax" ? " (through Accessibility)" : r.how === "point" ? (r.behind ? " (clicked there, their pointer untouched)" : " (with the pointer)") : r.how === "key" ? " (with the keys)" : ""
  if (r.behind) return `Done in ${r.app ?? "that app"}, behind their window${how}, and read back${r.effect?.ok ? `: ${r.effect.saw}` : ""}.`
  const now = r.app ? ` Now in ${r.app}${r.title ? `, "${r.title}"` : ""}.` : ""
  if (r.moved === false) return `Scrolled${how}, but nothing there moved: it's at its end, or that part doesn't scroll (point at what to scroll).${now}`
  return `Done${how}${r.effect ? `: ${r.effect.saw}` : ""}.${now}${nearText(r.near?.slice(0, 20))}`
}


/** How long a step may take on the helper (typing a long text), past its offer's wait (which the helper says). */
const STEP_MS = 120_000

/** The helpers' take-overs: which helper an ask came from (its steps go there), the steps waiting on each, its offers. */
export function takeovers(send: (ws: WebSocket, m: object) => void, fly: (agent: string, sx: number, sy: number) => void) {
  const waiting = new Map<string, { ws: WebSocket; done: (r: Done) => void; wait: (ms: number) => void }>()
  /** Each helper's offers up, by request id: a spoken yes or no answers one of them (the helper says which). */
  const offering = new Map<WebSocket, Set<string>>()
  const up = (ws: WebSocket) => (offering.get(ws)?.size ?? 0) > 0
  const drop = (ws: WebSocket, id?: string) => { const o = offering.get(ws); if (!o) return; if (id) o.delete(id); else o.clear(); if (!o.size) offering.delete(ws) }
  let from: WebSocket | null = null, n = 0
  return {
    /** A moment came from this helper: its steps go there. A yes or a no while its offer waits answers it (true); any
     *  other ask moves on from it (the offer goes, the ask goes on: act answers so, and its turn reaches the ask). */
    heard(ws: WebSocket, m: Record<string, unknown>): boolean {
      from = ws
      if (!up(ws) || (m.kind !== "ask" && m.kind !== "point")) return false
      const yes = typeof m.text === "string" ? answerOf(m.text) : null
      // (another ask moves on from them all; a yes or no is the one by their pointer's, the helper's to tell)
      if (yes === null) drop(ws)
      send(ws, yes === null ? { t: "takeover-answer", yes: false, asked: true } : { t: "takeover-answer", yes })
      return yes !== null
    },
    /** Its offer is up: a Talk key's press then is its answer, not a barge-in. */
    offering: up,
    /** The helper's own messages: an offer shown, a step done (true: handled). */
    message(ws: WebSocket, m: Record<string, unknown>): boolean {
      // (its offer up, waiting as long as the helper's does: their answer may take a while)
      if (m.t === "takeover-asking") { if (typeof m.id === "string") offering.set(ws, (offering.get(ws) ?? new Set()).add(m.id)); if (typeof m.id === "string" && Number.isFinite(m.ms)) waiting.get(m.id)?.wait(Number(m.ms) + STEP_MS); return true }
      if (m.t === "takeover-at") { if (typeof m.agent === "string" && Number.isFinite(m.sx) && Number.isFinite(m.sy)) fly(m.agent, Number(m.sx), Number(m.sy)); return true }
      if (m.t !== "takeover-done" || typeof m.id !== "string") return false
      drop(ws, m.id)
      const w = waiting.get(m.id)
      if (w?.ws === ws) { waiting.delete(m.id); w.done(m as unknown as Done) }
      return true
    },
    closed(ws: WebSocket) {
      offering.delete(ws)
      if (from === ws) from = null
      for (const [id, w] of waiting) if (w.ws === ws) { waiting.delete(id); w.done({ ok: false, why: "gone", text: "the helper went away (the app quit or restarted)" }) }
    },
    /** Do a step where the last ask came from; answers once it's done, refused, declined or stopped. */
    async act(step: ReturnType<typeof stepOf>, who: { agent: string; tint: string; ask?: string }): Promise<Done> {
      // (the companion's private apps and sites: the helper checks what's there against them before each step)
      const { apps, sites } = (await import("./plugin.ts")).privates()
      return request((id) => ({ t: "takeover", id, agent: who.agent, tint: who.tint, step, apps, sites, ...(who.ask ? { ask: who.ask } : {}) }), STEP_MS)
    },
    /** Ask them (`line` by their pointer, `sub` under it) on the Mac whose helper asked: `ok` once they say yes. */
    confirm: (line: string, sub: string, who: { agent: string; tint: string }) => request((id) => ({ t: "confirm", id, line, sub, agent: who.agent, tint: who.tint }), 15_000),
    /** Open on the Mac whose helper asked what a user could (macOpen): answers the window in front then and its
     *  elements, by id (as an ask's). */
    open: (o: { url?: string; app?: string; path?: string }) => request((id) => ({ t: "open", id, ...o }), 15_000),
    /** The element saying `text` in the window the last ask was over (its Accessibility, whole), by its helper. */
    find: (text: string) => request((id) => ({ t: "find", id, text }), 3000),
    /** Every thing in the window the last ask was over (its Accessibility, in the UI model's shape), by its helper. */
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

/** What `open` opens on the user's Mac rather than in Vaultite: an app (`app`, with what to open in it), an address of
 *  another scheme than the web's (System Settings' panes, mail...), a path outside the vault; null for the vault's. */
export function macOpen(to: string, app: string, vault: string, home: string): { url?: string; app?: string; path?: string } | null {
  const full = to === "~" ? home : to.startsWith("~/") ? `${home}/${to.slice(2)}` : to
  const inVault = full === vault || full.startsWith(`${vault}/`)
  const what: { url?: string; path?: string } | null = !to ? {} : /^[a-z][\w+.-]*:/i.test(to) && !/^(view|file):/i.test(to) ? { url: to } : full.startsWith("/") && !inVault ? { path: full } : null
  if (app) return what ? { app, ...what } : { app }
  return what && (what.url || what.path) && !/^https?:/i.test(what.url ?? "") ? what : null
}

/** Browsers by bundle id: a web page asked for while they're in one opens there, not in Vaultite. */
const BROWSERS = /^(com\.google\.Chrome(\.\w+)?|com\.apple\.Safari(TechnologyPreview)?|org\.mozilla\.\w+|company\.thebrowser\.\w+|com\.brave\.Browser(\.\w+)?|com\.microsoft\.edgemac(\.\w+)?|com\.operasoftware\.Opera\w*|com\.vivaldi\.Vivaldi|app\.zen-browser\.zen|org\.chromium\.Chromium|com\.kagi\.kagimacOS|ai\.perplexity\.comet)$/
export const isBrowser = (bundle: string) => BROWSERS.test(bundle)
