import type { IncomingMessage } from "node:http"
import { z } from "zod"
import type { Message } from "./rooms.ts"
import { OpError } from "../../../core/plugins.ts"
import { follows } from "./follows.ts"
import { type Pane, paneSource, type Target } from "../../../core/desktop/places.ts"
import { pausedNow, calls } from "./screensocket.ts"
import { plugin } from "./self.ts"
import type { Moment, Boxed } from "./types.ts"
import { str, setting, mode, hidden, privatePage, ownName } from "./settings.ts"
import { agents, said, windows, broadcast, key, live } from "./state.ts"
import { addMoment } from "./intake.ts"
import { drawing, anchorLine } from "./comments.ts"
import { cut, vaultText } from "./edits.ts"
import { messageOf } from "./errors.ts"
import { sessionId, isChat } from "./alwayson.ts"

const PaneIn = z.looseObject({ id: z.string(), to: z.string() })
const Front = z.object({ name: z.string().optional(), title: z.string().optional() })
const UnheardIn = z.object({ t: z.unknown(), agent: z.unknown(), asked: z.unknown(), detail: z.unknown(), why: z.enum(["call", "off", "silent"]).nullable().catch(null) })
const BrowserTab = z.object({ tab: z.number(), url: z.string(), title: z.string(), container: z.string().nullable(), access: z.string(), pane: z.string().optional() })
export type BrowserTab = z.infer<typeof BrowserTab>
const Located = z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number(), zoom: z.number() })
const PaneMomentIn = z.looseObject({ kind: z.enum(["ask", "point", "change"]) })
const PageText = z.object({ text: z.unknown() })

export function panesFrom(v: unknown[]): Pane[] {
  return v.slice(0, 300).flatMap((x) => {
    const p = PaneIn.safeParse(x).data
    return p ? [{ id: p.id, to: p.to, title: str(p.title).slice(0, 200), ...(str(p.tab) ? { tab: str(p.tab) } : {}), ...(str(p.group) ? { group: str(p.group) } : {}) }] : []
  })
}
export function allPanes(): Pane[] {
  const out = new Map<string, Pane>()
  for (const w of [...windows.values()].sort((a, b) => b.at - a.at)) for (const p of w.panes) if (!out.has(p.id)) out.set(p.id, p)
  return [...out.values()]
}
export const paneById = (id?: string) => (id ? allPanes().find((p) => p.id === id) : undefined)
export function privatePane(p: Pane) {
  const x = paneSource(p.to)
  return x.kind === "note" ? hidden(x.path!) : x.kind === "site" ? privatePage(x.url!) : false
}
export const paneFocus = () => { const w = [...windows.values()].sort((a, b) => b.at - a.at)[0], p = w && paneById(w.pane); return p && !privatePane(p) ? p : null }
function awareness() {
  const p = paneFocus(), x = p && paneSource(p.to), front = Front.safeParse(plugin.service("screen:front")?.()).data
  return [x && x.kind !== "note" ? `They're looking at "${p.title}" (pane ${p.id}, ${x.kind === "site" ? `a web page, ${x.url}` : x.kind === "terminal" ? "a terminal" : "a view"}).` : "",
    front?.name ? `The app in front: ${front.name}${front.title ? `, "${front.title}"` : ""}.` : ""].filter(Boolean).join(" ")
}

export type Unheard = { agent: string; asked: number; at: number; why: "call" | "off" | "silent"; detail: string }
const UNHEARD_MS = 10 * 60_000
let unheard: Unheard[] = []
export function screenUnheard(msg: Message) {
  const m = UnheardIn.safeParse(msg).data
  if (!m) return
  const agent = str(m.agent).slice(0, 80), asked = Number(m.asked) || 0, now = Date.now()
  unheard = unheard.filter((u) => now - u.at < UNHEARD_MS && !(key(u.agent) === key(agent) && u.asked === asked))
  const why = m.why
  if (m.t === "unheard" && why) unheard = [...unheard, { agent, asked, at: now, why, detail: str(m.detail).slice(0, 200) } satisfies Unheard].slice(-5)
}
const hhmm = (t: number) => { const d = new Date(t); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}` }
const UNHEARD_WHY = { call: (d: string) => `kept quiet, as they seemed ${d || "on a call"}`, off: () => "your voice was off then", silent: (d: string) => `your voice failed${d ? ` (${d})` : ""}` }
export function voiceSilence(o: { off: boolean; call?: string; paused?: { account: string } | null; unheard?: (Pick<Unheard, "at" | "why" | "detail"> & { ask?: string })[] }) {
  if (o.off) return "Your voice is off (its voice setting): answers show as text only."
  const held = (o.unheard ?? []).slice(-2).map((u) => `at ${hhmm(u.at)}${u.ask ? ` (to ${JSON.stringify(cut(u.ask, 60))})` : ""}, ${UNHEARD_WHY[u.why](u.detail)}`)
  return [held.length ? `${held.length > 1 ? "Your last answers weren't" : "Your last answer wasn't"} heard aloud: ${held.join("; ")}. Asked whether you said anything, say so and why, and offer to say it now (or its play button in your box).` : "",
    o.call ? `Your answers aren't said aloud now: they seem ${o.call} (that app has the microphone open), so each shows as text with a play button (its Quiet on calls setting). If they aren't on a call, the Not a call button in your box by their pointer has you speak again until that app lets go of the mic.` : "",
    o.paused ? `Your realtime voice is paused: ${o.paused.account === "quota" ? "the OpenAI account has no credits" : "OpenAI refused its key"}.` : ""].filter(Boolean).join(" ")
}
const unheardOf = (name: string) => unheard.filter((u) => key(u.agent) === key(name) && Date.now() - u.at < UNHEARD_MS)
  .map((u) => ({ ...u, ask: said.find((n) => n.kind === "ask" && n.t === u.asked && key(n.agent ?? "") === key(name))?.text }))
export const headAware = (name: string) => [mode() === "pair" ? awareness() : "",
  voiceSilence({ off: setting("voice") === "off", call: [...calls.values()].at(-1), paused: pausedNow(), unheard: unheardOf(name) })].filter(Boolean).join(" ")

async function pageOf(id: string, name = ownName()): Promise<BrowserTab | null> {
  const tabs = z.array(BrowserTab).safeParse(await plugin.desktop("agent:tabs", { name, session: "", task: "", summary: "", remote: false }).catch(() => [])).data ?? []
  return tabs.find((t) => t.pane === id) ?? null
}
export async function pageFor(id: string, need: "read" | "act", name?: string) {
  const t = await pageOf(id, name)
  if (!t) throw new OpError(paneById(id) && paneSource(paneById(id)!.to).kind === "terminal" ? `pane ${id} is a terminal: nothing types in it (see reads it, follow watches it)`
    : `pane ${id} shows no web page in the desktop app (vau tabs lists the panes)`, 404)
  if (privatePage(t.url, t.container)) throw new OpError("that page is private: the companion never sees it (the setting private)", 403)
  if (t.access === "none" || (need === "act" && t.access !== "act")) throw new OpError(`its container lets agents ${t.access === "none" ? "do nothing" : "only read"} there (Agents, in the container menu of the page's bar)`, 403)
  return t
}

export async function resolve(t: Target, name: string): Promise<Target & Boxed> {
  const p = t.pane ? paneById(t.pane) : undefined
  if (t.pane && !p) throw new OpError(`no pane ${t.pane} in the user's window (vau tabs lists them)`, 404)
  if (!p && t.path && t.find && t.line === undefined && !drawing(t.path)) { const text = vaultText(t.path), line = text === null ? null : anchorLine(text, t); if (line) return { ...t, line } }
  if (!p) return t
  if (privatePane(p)) throw new OpError("that pane is private: the companion never sees it", 403)
  const x = paneSource(p.to)
  if (x.kind === "note") return { path: x.path, ...(t.line ? { line: t.line } : {}), ...(t.find ? { find: t.find } : {}) }
  if (x.kind === "site" && t.el) {
    const page = await pageFor(p.id, "read", name)
    const b = Located.parse(await plugin.desktop("agent:locate", page.tab, t.el).catch((e) => { throw new OpError(messageOf(e), 409) }))
    return { ...t, box: { x: b.x, y: b.y, w: b.width, h: b.height, zoom: b.zoom } }
  }
  return t
}

export async function paneMoment(msg: Partial<Message>, req: IncomingMessage | undefined, extra: Partial<Moment> = {}) {
  const m = PaneMomentIn.safeParse(msg).data
  if (!m) return
  const ui = str(m.ui).slice(0, 120) || undefined
  const tabId = /^tab:(.+)$/.exec(ui ?? "")?.[1], inTab = tabId ? allPanes().filter((x) => x.tab === tabId) : []
  const pane = str(m.pane) || /^pane:(.+)$/.exec(ui ?? "")?.[1] || (inTab.length === 1 ? inTab[0].id : undefined), p = paneById(pane)
  const tab = !pane && inTab.length > 1 ? tabId : undefined
  if (p && privatePane(p)) return
  if (tab && inTab.every(privatePane)) return
  const agent = str(m.agent) || undefined, title = (p?.title || (tab ? inTab.filter((x) => !privatePane(x)).map((x) => x.title).join(" · ") : "") || str(m.title)).slice(0, 200) || undefined
  const asked = m.kind === "ask" ? str(m.text).slice(0, 4000) || undefined : undefined
  const text = (m.kind === "ask" ? str(m.under) : str(m.text)).slice(0, 4000) || undefined
  const where = { ...(pane ? { pane } : {}), ...(ui && !pane ? { ui } : {}), ...(title ? { title } : {}), ...(m.summoned === true && m.kind !== "change" ? { summoned: true, ...(m.voice === true ? { voice: true } : {}) } : {}), ...extra }
  if (m.kind === "change") {
    if (!followed.list().some((f) => f.ui === ui)) return
    return void addMoment({ kind: "change", for: agent, ...where, what: "it changed", changes: Array.isArray(m.changes) ? m.changes.map(String).slice(0, 30) : [] })
  }
  const x = p && paneSource(p.to)
  if (x?.kind === "note") return void addMoment({ kind: m.kind, for: agent, path: x.path, line: 1, ...(asked ? { text: asked } : {}), ...(where.summoned ? { summoned: true, ...(where.voice ? { voice: true } : {}) } : {}), ...extra }, req)
  let under = text
  if (x?.kind === "site" && m.x !== undefined) {
    const t = await pageOf(p!.id).catch(() => null)
    if (t && !privatePage(t.url, t.container) && t.access !== "none") under = String(PageText.safeParse(await plugin.desktop("agent:at", t.tab, Number(m.x), Number(m.y)).catch(() => ({}))).data?.text ?? "") || under
  }
  const said = under?.slice(0, 1200)
  addMoment({ kind: m.kind, for: agent, ...where, ...(Number(m.row) > 0 ? { row: Number(m.row) } : {}), ...(x?.kind === "site" ? { url: x.url } : {}),
    ...(m.kind === "ask" ? { ...(asked ? { text: asked } : {}), ...(said ? { under: said } : {}) } : said ? { text: said } : {}) }, req)
}

export const followed = follows(plugin, {
  panes: allPanes,
  change: (c) => addMoment({ kind: "change", for: c.follow.agent, pane: c.pane, title: c.title, what: c.what, changes: c.changes, ...(c.url ? { url: c.url } : {}) }),
  told: () => broadcast({ t: "follows", follows: followed.list() }),
})
plugin.onUnload(() => followed.stop())
export const sourceOf = (p: Pane) => { const x = paneSource(p.to); return x.kind === "note" ? `note:${x.path}` : x.kind === "terminal" ? `terminal:${x.terminal}` : x.kind === "site" ? `site:${x.url}` : null }
/** The panes the windows show (but private ones): each one's id, title, tab group and what it shows (note:, terminal:, site:). */
plugin.provide("companion:panes", () => allPanes().filter((p) => !privatePane(p)).map((p) => ({ id: p.id, title: p.title, ...(p.group ? { group: p.group } : {}), source: sourceOf(p) })))
/** Whether a web page (its address, its container) is private: the companion never sees it, nor do watches. */
plugin.provide("companion:private", (url: string, container: string | null) => privatePage(url, container))
/** Whether a note is private (the setting's folders, or companion: private in it). */
plugin.provide("companion:hidden", (path: string) => hidden(path))
/** Its names, for dictation to expect (@claude, "ask Ada"). */
plugin.provide("dictation:terms", () => [...new Set([ownName(), ...[...agents.values()].map((a) => a.name)])].filter(Boolean))
/** A watch's hit: a moment for the companion while it runs (true), else the watches' inbox (false). */
plugin.provide("companion:watch", (h: { id: string; title: string; why: string; done: boolean; changes: string[]; url?: string }) => {
  const name = ownName()
  if (mode() === "off" || !(live(name) || isChat(sessionId(name)))) return false
  return !!addMoment({ kind: "watch", for: name, item: h.id, title: h.title, ...(h.why ? { text: h.why } : {}), what: h.done ? "what it waited for happened (the watch ended)" : "it changed", changes: h.changes.slice(0, 30), ...(h.url ? { url: h.url } : {}) })
})
