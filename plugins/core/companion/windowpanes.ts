import type { IncomingMessage } from "node:http"
import { OpError } from "../../../core/plugins.ts"
import { readText } from "../../../core/vault.ts"
import { follows } from "./follows.ts"
import { type Pane, paneSource, type Target } from "../../../core/desktop/places.ts"
import { pausedNow, calls } from "./windows.ts"
import { plugin } from "./self.ts"
import type { Moment, Boxed } from "./types.ts"
import { str, setting, mode, hidden, privatePage, ownName } from "./settings.ts"
import { agents, said, windows, broadcast, key, live, addMoment } from "./state.ts"
import { drawing, anchorLine } from "./comments.ts"
import { cut } from "./edits.ts"
import { sessionId, isChat } from "./alwayson.ts"

/** Panes as a window says them, checked. */
export function panesFrom(v: unknown[]): Pane[] {
  return v.slice(0, 300).flatMap((x) => {
    const p = (x ?? {}) as Record<string, unknown>
    return typeof p.id === "string" && typeof p.to === "string" ? [{ id: p.id, to: p.to, title: str(p.title).slice(0, 200), ...(str(p.tab) ? { tab: str(p.tab) } : {}), ...(str(p.group) ? { group: str(p.group) } : {}) }] : []
  })
}
/** Every pane the windows show, the latest window's first (an id once). */
export function allPanes(): Pane[] {
  const out = new Map<string, Pane>()
  for (const w of [...windows.values()].sort((a, b) => b.at - a.at)) for (const p of w.panes) if (!out.has(p.id)) out.set(p.id, p)
  return [...out.values()]
}
export const paneById = (id?: string) => (id ? allPanes().find((p) => p.id === id) : undefined)
/** A pane it never sees: a private note's, or a private site's. */
export function privatePane(p: Pane) {
  const x = paneSource(p.to)
  return x.kind === "note" ? hidden(x.path!) : x.kind === "site" ? privatePage(x.url!) : false
}
/** Where the user is when it isn't a note: the focused pane of the window they used last (never a private one). */
export const paneFocus = () => { const w = [...windows.values()].sort((a, b) => b.at - a.at)[0], p = w && paneById(w.pane); return p && !privatePane(p) ? p : null }
/** What the user looks at beyond the note, as a moment's head says it: their pane (a terminal, a page) and, from the
 *  helper, the app in front. Metadata only. */
function awareness() {
  const p = paneFocus(), x = p && paneSource(p.to), front = (plugin.service("screen:front") as (() => { name?: string; title?: string } | null) | null)?.()
  return [x && x.kind !== "note" ? `They're looking at "${p.title}" (pane ${p.id}, ${x.kind === "site" ? `a web page, ${x.url}` : x.kind === "terminal" ? "a terminal" : "a view"}).` : "",
    front?.name ? `The app in front: ${front.name}${front.title ? `, "${front.title}"` : ""}.` : ""].filter(Boolean).join(" ")
}

/** An answer its voice didn't say, as the helper tells it (helper.ts): kept quiet for a call (`detail`: "on a call in
 *  Zoom"), its voice off then, or its voice failing (`detail`: why). */
export type Unheard = { agent: string; asked: number; at: number; why: "call" | "off" | "silent"; detail: string }
const UNHEARD_MS = 10 * 60_000
let unheard: Unheard[] = []
/** The helper's word on an answer: not said aloud (`unheard`), or said after all from its play button (`heard`). */
export function screenUnheard(m: Record<string, unknown>) {
  const agent = str(m.agent).slice(0, 80), asked = Number(m.asked) || 0, now = Date.now()
  unheard = unheard.filter((u) => now - u.at < UNHEARD_MS && !(key(u.agent) === key(agent) && u.asked === asked))
  const why = m.why === "call" || m.why === "off" || m.why === "silent" ? m.why : null
  if (m.t === "unheard" && why) unheard = [...unheard, { agent, asked, at: now, why, detail: str(m.detail).slice(0, 200) } satisfies Unheard].slice(-5)
}
const hhmm = (t: number) => { const d = new Date(t); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}` }
const UNHEARD_WHY = { call: (d: string) => `kept quiet, as they seemed ${d || "on a call"}`, off: () => "your voice was off then", silent: (d: string) => `your voice failed${d ? ` (${d})` : ""}` }
/** Why its voice is silent now, if it is (off, a call, the realtime voice paused), and its last answers that weren't
 *  heard, for every ask's head: asked whether it said anything, it knows rather than guesses. */
export function voiceSilence(o: { off: boolean; call?: string; paused?: { account: string } | null; unheard?: (Pick<Unheard, "at" | "why" | "detail"> & { ask?: string })[] }) {
  if (o.off) return "Your voice is off (its voice setting): answers show as text only."
  const held = (o.unheard ?? []).slice(-2).map((u) => `at ${hhmm(u.at)}${u.ask ? ` (to ${JSON.stringify(cut(u.ask, 60))})` : ""}, ${UNHEARD_WHY[u.why](u.detail)}`)
  return [held.length ? `${held.length > 1 ? "Your last answers weren't" : "Your last answer wasn't"} heard aloud: ${held.join("; ")}. Asked whether you said anything, say so and why, and offer to say it now (or its play button in your box).` : "",
    o.call ? `Your answers aren't said aloud now: they seem ${o.call} (that app has the microphone open), so each shows as text with a play button (its Quiet on calls setting). If they aren't on a call, the Not a call button in your box by their pointer has you speak again until that app lets go of the mic.` : "",
    o.paused ? `Your realtime voice is paused: ${o.paused.account === "quota" ? "the OpenAI account has no credits" : "OpenAI refused its key"}.` : ""].filter(Boolean).join(" ")
}
/** Agent `name`'s answers not heard in the last few minutes, each with its ask's words. */
const unheardOf = (name: string) => unheard.filter((u) => key(u.agent) === key(name) && Date.now() - u.at < UNHEARD_MS)
  .map((u) => ({ ...u, ask: said.find((n) => n.kind === "ask" && n.t === u.asked && key(n.agent ?? "") === key(name))?.text }))
/** A moment's head beyond its asks: where they are (pair only) and why its voice is (or was just) silent (any mode). */
export const headAware = (name: string) => [mode() === "pair" ? awareness() : "",
  voiceSilence({ off: setting("voice") === "off", call: [...calls.values()].at(-1), paused: pausedNow(), unheard: unheardOf(name) })].filter(Boolean).join(" ")

/** The browser tab showing pane `id` (the engine lists the window's tab with each page), or null. */
export type BrowserTab = { tab: number; url: string; title: string; container: string | null; access: string; pane?: string }
async function pageOf(id: string, name = ownName()): Promise<BrowserTab | null> {
  const tabs = await plugin.desktop("agent:tabs", { name, session: "", task: "", summary: "", remote: false }).catch(() => []) as BrowserTab[]
  return tabs.find((t) => t.pane === id) ?? null
}
/** A pane's page as the companion may use it: there, not private, its container letting agents `need` (read, act). */
export async function pageFor(id: string, need: "read" | "act", name?: string) {
  const t = await pageOf(id, name)
  // (a terminal's says what works there: it took a guess at typing into one)
  if (!t) throw new OpError(paneById(id) && paneSource(paneById(id)!.to).kind === "terminal" ? `pane ${id} is a terminal: nothing types in it (see reads it, follow watches it)`
    : `pane ${id} shows no web page in the desktop app (vau tabs lists the panes)`, 404)
  if (privatePage(t.url, t.container)) throw new OpError("that page is private: the companion never sees it (the setting private)", 403)
  if (t.access === "none" || (need === "act" && t.access !== "act")) throw new OpError(`its container lets agents ${t.access === "none" ? "do nothing" : "only read"} there (Agents, in the container menu of the page's bar)`, 403)
  return t
}

/** A place resolved for the window: a pane that shows a note is that note; a page's element to its box (a terminal's
 *  text the window finds on its screen). Private panes refuse. */
export async function resolve(t: Target, name: string): Promise<Target & Boxed> {
  const p = t.pane ? paneById(t.pane) : undefined
  if (t.pane && !p) throw new OpError(`no pane ${t.pane} in the user's window (vau tabs lists them)`, 404)
  // (a note's text, found: its line too, so what's by its cursor is found there)
  if (!p && t.path && t.find && t.line === undefined && !drawing(t.path)) { try { const line = anchorLine(readText(plugin.vault.abs(t.path)), t); if (line) return { ...t, line } } catch { /* not there */ } }
  if (!p) return t
  if (privatePane(p)) throw new OpError("that pane is private: the companion never sees it", 403)
  const x = paneSource(p.to)
  if (x.kind === "note") return { path: x.path, ...(t.line ? { line: t.line } : {}), ...(t.find ? { find: t.find } : {}) }
  if (x.kind === "site" && t.el) {
    const page = await pageFor(p.id, "read", name)
    const b = await plugin.desktop("agent:locate", page.tab, t.el).catch((e) => { throw new OpError((e as Error).message, 409) }) as { x: number; y: number; width: number; height: number; zoom: number }
    return { ...t, box: { x: b.x, y: b.y, w: b.width, h: b.height, zoom: b.zoom } }
  }
  return t
}

/** An ask or a point on a pane or the app's UI (the window says what's there; `extra`: a Talk key's over it, its point and
 *  picture), or a change in UI it follows: a moment. Never a follow: that's only asked for (companion follow). */
export async function paneMoment(m: Record<string, unknown>, req: IncomingMessage | undefined, extra: Partial<Moment> = {}) {
  const ui = str(m.ui).slice(0, 120) || undefined
  // (a tab of one pane is that pane; a split tab is its panes)
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
  if (x?.kind === "note") return void addMoment({ kind: m.kind as "ask", for: agent, path: x.path, line: 1, ...(asked ? { text: asked } : {}), ...(where.summoned ? { summoned: true, ...(where.voice ? { voice: true } : {}) } : {}), ...extra }, req)
  let under = text
  if (x?.kind === "site" && m.x !== undefined) {
    const t = await pageOf(p!.id).catch(() => null)
    if (t && !privatePage(t.url, t.container) && t.access !== "none") under = String((await plugin.desktop("agent:at", t.tab, Number(m.x), Number(m.y)).catch(() => ({})) as { text?: string }).text ?? "") || under
  }
  const said = under?.slice(0, 1200)
  addMoment({ kind: m.kind as "ask", for: agent, ...where, ...(Number(m.row) > 0 ? { row: Number(m.row) } : {}), ...(x?.kind === "site" ? { url: x.url } : {}),
    ...(m.kind === "ask" ? { ...(asked ? { text: asked } : {}), ...(said ? { under: said } : {}) } : said ? { text: said } : {}) }, req)
}

/** What the companion follows now (follows.ts): a change in one is a moment for it. */
export const followed = follows(plugin, {
  panes: allPanes,
  change: (c) => addMoment({ kind: "change", for: c.follow.agent, pane: c.pane, title: c.title, what: c.what, changes: c.changes, ...(c.url ? { url: c.url } : {}) }),
  told: () => broadcast({ t: "follows", follows: followed.list() }),
})
plugin.onUnload(() => followed.stop())
/** A source the watches read, for a pane: its note, terminal or address. */
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
