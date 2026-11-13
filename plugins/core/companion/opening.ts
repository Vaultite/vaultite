import { AsyncLocalStorage } from "node:async_hooks"
import os from "node:os"
import { OpError } from "../../../core/plugins.ts"
import { requestWriter } from "../../../core/vault.ts"
import type { Follow } from "./follows.ts"
import type { Pane } from "../../../core/desktop/places.ts"
import { isBrowser, macOpen, nearText } from "./takeover.ts"
import { LAND_MS } from "./inpanes.ts"
import { plugin } from "./self.ts"
import type { Moment, Note } from "./types.ts"
import { str, ownName } from "./settings.ts"
import { agents, acted, did, key, setAgent, writingAt, wroteAt } from "./state.ts"
import { past, kept } from "./comments.ts"
import { takeover } from "./windows.ts"
import { nearBy } from "./screensocket.ts"
import { allPanes, paneById, privatePane, paneFocus, resolve, followed, sourceOf } from "./windowpanes.ts"
import { cut } from "./edits.ts"
import { session } from "./alwayson.ts"
import { laneOf, lane } from "./lane.ts"
import { AS, PATH, PANE, UI, target, who } from "./args.ts"
import { askOf } from "./wiring.ts"
import { byText } from "./people.ts"

const opening = new AsyncLocalStorage<boolean>()
function companionAsking(): string | null {
  const sid = requestWriter.getStore()?.session
  if (!sid) return null
  if (laneOf?.vault === plugin.vault && lane().id() === sid) return ownName()
  return [...agents.values()].find((a) => session(a.name)?.id === sid)?.name ?? null
}
function shows(p: Pane, path: string) {
  const x = path.replace(/^file:/, "")
  const to = p.to.replace(/^view:web\/@[a-z0-9]{1,24}\//, "view:web/")
  return /^https?:\/\//i.test(x) ? to === `view:web/${x}` || to.startsWith(`view:web/${x.replace(/\/$/, "")}`)
    : x.startsWith("view:") ? p.to === x : p.to === `file:${x}` || p.to === `file:${x}.md` || p.to === `view:folder/${x}`
}
async function openSeen(name: string, path: string, open: () => Promise<unknown>) {
  const was = allPanes().find((p) => shows(p, path) && p.tab)
  acted(name)
  const done = writingAt(name, was ? { ui: `tab:${was.tab}`, pointed: Date.now() } : null)
  let p: Pane | undefined
  try {
    if (was) await new Promise((done) => setTimeout(done, LAND_MS))
    const focused = paneFocus()?.id
    const r = await opening.run(true, open)
    for (const until = Date.now() + 1500; !p && Date.now() < until;) {
      await new Promise((done) => setTimeout(done, 100))
      const f = paneFocus()
      p = allPanes().find((x) => shows(x, path)) ?? (f && f.id !== focused ? f : undefined)
    }
    p ??= paneFocus() ?? undefined
    return { result: r, pane: p?.id }
  } finally {
    const at = p && !privatePane(p) ? p : null
    done(at ? { ...await resolve({ pane: at.id }, name).catch(() => ({ pane: at.id })), pointed: Date.now() } : {})
  }
}
plugin.around("ui.open", async (call, next) => {
  const name = opening.getStore() ? null : companionAsking()
  return name ? (await openSeen(name, String(call.params.path ?? ""), () => next())).result : next()
})
plugin.around("ui.command", async (call, next) => {
  const name = companionAsking(), id = str(call.params.id)
  if (name) acted(name)
  const done = name ? writingAt(name, id ? { ui: `button:${id}`, pointed: Date.now() } : null) : null
  try { return await next() } finally { done?.() }
})
plugin.around("tabs.focus", async (call, next) => {
  const name = companionAsking(), what = str(call.params.what), tab = name && allPanes().find((p) => p.id === what || p.tab === what || shows(p, what))?.tab
  if (name && tab) { wroteAt(name, { ui: `tab:${tab}`, pointed: Date.now() }); await new Promise((done) => setTimeout(done, LAND_MS)) }
  return next()
})
export const openedFor = new Map<string, Moment>()
plugin.op({
  id: "companion.open",
  cli: "companion open",
  summary: "Open what the user asked to see, your cursor flying there: a note, a folder, a view or a web page in their window, or on their Mac an app, a file or folder in its app, any address (a System Settings pane).",
  help: `For what they asked to see: a pinned page, a note, a site; on their Mac, what they could open themselves (an app,
~/Downloads in Finder, a System Settings pane by its address). It answers the pane it opened (a web page's: see and act
work there), or the Mac's window in front and what's in it by id (point, ring and act on those).

  vau companion open Personal/Dashboards/Today.md
  vau companion open https://example.com --split right
  vau companion open https://www.linkedin.com/in/alice-park --container Personal
  vau companion open http://localhost:5173 --in left
  vau companion open "x-apple.systempreferences:com.apple.Keyboard-Settings.extension"
  vau companion open ~/Downloads
  vau companion open --app Calculator`,
  kind: "write",
  lock: false,
  params: { path: { type: "string", description: "a vault path (or as they say it: Today), a folder, a view (view:graph), a web address, any other address (x-apple.systempreferences:..., mailto:...), or a path on their Mac (~/Downloads)" },
    app: { type: "string", description: "an app on their Mac to open (its name, Calculator, or bundle id), with path or the address in it if given" },
    split: { type: "string", enum: ["right", "down"], description: "in a pane beside (right) or below (down)" }, newTab: { type: "boolean", description: "in a new tab" },
    in: { type: "string", description: "the pane to open it in as a new tab, as they name it: where it is (left, top right), this, what it shows (a note, a site, its title's words) or its id" },
    container: { type: "string", description: "a web page's browser container (its own logins), by its name as they say it: Personal, Work, Agents, or none" },
    vaultite: { type: "boolean", description: "a web page in Vaultite even when they asked from their browser (where it opens, a new tab, by default)" }, as: AS },
  args: ["path"],
  run: async (p, ctx) => {
    const name = who(p), path = str(p.path), app = str(p.app), m = askOf(name)
    if (!path && !app) throw new OpError("give a path or an app")
    did(name, "open")
    const browser = /^https?:\/\/\S+$/i.test(path) && !app && p.vaultite !== true && !p.container && !p.in && m?.summoned && m.app && isBrowser(m.app) ? m.app : ""
    const mac = browser ? { url: path, app: browser } : macOpen(path, app, plugin.vault.path, os.homedir())
    if (mac) {
      const r = await takeover.open(mac)
      if (!r.ok) throw new OpError(`it didn't open${mac.app ? ` in ${mac.app}` : ""}: ${r.text ?? r.why ?? "no answer"}${browser ? " (vaultite: true opens it in Vaultite)" : ""}`, 409)
      if (r.near?.length) { nearBy.set(key(name), r.near); if (m) openedFor.set(key(name), m) }
      if (r.frame) { const f = r.frame; void resolve(target({ sx: Math.round(f.x + f.width / 2), sy: Math.round(f.y + Math.min(f.height / 2, 120)) }, true), name).then((t) => setAgent(name, { ...t, pointed: Date.now() }), () => {}) }
      return { path: path || app, pane: null, in: r.app || mac.app || "", title: r.title ?? "", near: r.near ?? [], browser: !!browser }
    }
    const r = await openSeen(name, path, () => ctx.op("ui.open", { path, ...(p.split ? { split: p.split } : {}), ...(p.newTab ? { newTab: true } : {}),
      ...(p.in ? { in: p.in } : {}), ...(p.container ? { container: p.container } : {}) }))
    return { path, pane: r.pane ?? null }
  },
  text: (r) => (r.browser ? `Opened ${r.path} in ${r.in}, a new tab there in front of them.`
    : "in" in r ? `Opened ${r.path} on their Mac${r.in ? `: ${r.in}${r.title ? `, "${r.title}"` : ""} is in front` : ""}.${nearText(r.near, "In it now (point, ring or act by id)")}`
    : `Opened ${r.path}${r.pane ? ` (pane ${r.pane})` : ""}.`),
  did: (p) => ({ action: "ui", text: `Opened ${String(p.path || p.app)}`, paths: [], by: who(p) }),
})

export const followText = (f: Follow) => `${f.id}: ${f.pane ? `pane ${f.pane}` : f.tab ? `tab ${f.tab}` : f.group ? `tab group ${f.group}` : f.ui}${f.title ? ` "${f.title}"` : ""}`
plugin.op({
  id: "companion.follow",
  cli: "companion follow",
  summary: "Follow a pane, a tab, a tab group or a part of the app for this session: what it does comes to you as change moments (a terminal at a command's end or its agent's state, a page at a navigation, a selection or a settled change).",
  help: `Only when they ask you to keep an eye on something now (pointing at it isn't asking). For
longer than this session, offer to keep it as a watch (companion keep). Without a pane, the list.

  vau companion follow --pane t3k2
  vau companion follow --tab tk3j2
  vau companion follow --group s1k2`,
  kind: "write",
  lock: false,
  params: { pane: PANE, tab: { type: "string", description: "a tab (its id: vau tabs): all its panes" }, group: { type: "string", description: "a tab group (its id: vau tabs): all its tabs" }, ui: UI, as: AS },
  run: async (p) => {
    const name = who(p), pane = str(p.pane), tab = str(p.tab), group = str(p.group), ui = str(p.ui)
    if (!pane && !tab && !group && !ui) return { follows: followed.list().filter((f) => key(f.agent) === key(name)) }
    if (tab) {
      const ps = allPanes().filter((x) => x.tab === tab && !privatePane(x))
      if (!ps.length) throw new OpError(`no tab ${tab} in the user's window (vau tabs lists them)`, 404)
      return { follows: [followed.add({ agent: name, tab, title: ps.map((x) => x.title).join(" · ") })] }
    }
    const pn = pane ? paneById(pane) : undefined
    if (pane && !pn) throw new OpError(`no pane ${pane} in the user's window (vau tabs lists them)`, 404)
    if (pn && privatePane(pn)) throw new OpError("that pane is private: the companion never sees it", 403)
    return { follows: [followed.add({ agent: name, ...(pane ? { pane } : group ? { group } : { ui }), title: pn?.title ?? "" })] }
  },
  text: (r) => (r.follows.length ? r.follows.map(followText).join("\n") : "Following nothing."),
})
plugin.op({
  id: "companion.unfollow",
  cli: "companion unfollow",
  summary: "Stop following a pane, a tab, a tab group or a part of the app (by its follow's id, pane, tab, group or ui; none: all yours).",
  kind: "write",
  lock: false,
  params: { id: { type: "string", description: "the follow (f2), or the pane, tab, group or ui id it follows" }, as: AS },
  args: ["id"],
  run: async (p) => ({ stopped: followed.remove(str(p.id) || null, who(p)).length }),
  text: (r) => `Stopped ${r.stopped} follow${r.stopped === 1 ? "" : "s"}.`,
})
plugin.op({
  id: "companion.keep",
  cli: "companion keep",
  summary: "Keep a follow as a watch (a file, checked by the server after this session too): when the user says yes to keeping an eye on it.",
  help: `A watch of the pane's terminal, page or note (or the whole tab group), live or every few minutes, until what it
waits for happens (vau docs watches). The follow ends: the watch tells you instead.

  vau companion keep --pane t3k2 --until "idle" --why "Tell me when the migration finishes"
  vau companion keep --pane t5x1 --every 30m --until Shipped --why "Tell me when it ships"`,
  kind: "write",
  lock: false,
  params: { pane: PANE, group: { type: "string", description: "a tab group (its id)" }, every: { type: "string", default: "live", description: "live, or how often: 5m, 2h, 1d" },
    until: { type: "string", description: "what it waits for (words, or a /regular expression/)" }, why: { type: "string", description: "what to do then, in the user's words" },
    title: { type: "string", description: "its name" }, as: AS },
  run: async (p, ctx) => {
    const pn = str(p.pane) ? paneById(str(p.pane)) : undefined
    const source = str(p.group) ? `group:${str(p.group)}` : pn ? sourceOf(pn) : null
    if (!source) throw new OpError(str(p.pane) ? `pane ${str(p.pane)} shows nothing to watch (a terminal, a page or a note)` : "give `pane` or `group`")
    if (pn && privatePane(pn)) throw new OpError("that pane is private: the companion never sees it", 403)
    const r = await ctx.op("watches.add", { source, every: str(p.every) || "live", ...(str(p.until) ? { until: str(p.until) } : {}), ...(str(p.why) ? { why: str(p.why) } : {}),
      ...(str(p.title) ? { title: str(p.title) } : pn ? { title: `Watch ${pn.title}`.slice(0, 80) } : {}), by: who(p) })
    followed.remove(str(p.group) || str(p.pane))
    return r
  },
  text: (r) => `Kept as a watch: ${r.id}.md (${r.source}).`,
})

plugin.op({
  id: "companion.history",
  cli: "companion history",
  summary: "A note's margin threads: the comments in it now, and those the user dismissed (newest last).",
  kind: "read",
  params: { path: PATH },
  run: async (p) => {
    const path = target(p).path!
    return { path, open: kept(path).filter((n) => n.kind === "comment"), past: past.get(path) ?? [] }
  },
  text: (r) => [`${r.path}: ${r.open.length} open, ${r.past.length} dismissed.`,
    ...[...r.open, ...r.past].map((n: Note) => `- ${n.id}${n.dismissed ? " (dismissed)" : ""} by ${byText(n)} at line ${n.line ?? "?"}: ${cut(n.text ?? "", 80)}${n.replies?.length ? ` (${n.replies.length} replies)` : ""}`)].join("\n"),
})
