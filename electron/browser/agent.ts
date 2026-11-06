// Agents in the browser, asked by the vault's server (plugins/core/web-viewer/plugin.ts): a page's accessibility tree with
// refs, real input on them over the DevTools protocol (no page scripts), scripts of those in a sandbox; access checked here.
import { app, type WebContents } from "electron"
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { allPages, appWindows, busyWhen, cdp, eachPage, eachSession, engineBusy, handle, holdPage, keepPage, localUrl, mayOpen, onRequest, openInBackground, setAgentOwned, setAgentActing, tell, type EngineWindow, type EnginePage } from "./engine.ts"
import { docOf, exposed, filling, heldNear, markRan, scrub, scrubDeep, wasFilled } from "./pagesecrets.ts"
import { changes, mainLines } from "./axlines.ts"

/** A step's small picture, for the replay's filmstrip (agentruns.ts reads them). */
export const THUMB_WIDTH = 320

type Access = "none" | "read" | "act"
/** By profile; a profile not named is none. `home`: where an agent's new tab opens unless it names a container. */
let access = new Map<string, Access>()
let home = ""
/** Pages the user paused agents in (the bar's Stop), till they resume. */
const paused = new Set<number>()
/** Who opened each agent's page (the others are the user's). */
const owners = new Map<number, By>()
/** Pages an agent asked the user to do something in (sign in, a check), till they say it's done; and who waits on it. */
const asks = new Map<number, { by: string; reason: string }>()
/** Agents' pages the user took over (Take over in its tab, or input from the live view): theirs, agents paused there,
 *  till they give it back (Give back, Resume, its tab closed). */
const taken = new Set<number>()

// ---------- held: an agent's page is the agent's alone till the user takes it over ----------

/** An agent holds its own page while the user hasn't taken it over nor been asked to do something there: its tab shows
 *  a picture of it (web.ts never places it), so nothing the user does lands mid-act, and it keeps the agent's size. */
const held = (id: number) => owners.has(id) && !taken.has(id) && !asks.has(id)
holdPage(held)
/** The size an agent's page is laid out at while held, wherever it's shown: the layout it snapshots is the one it acts
 *  in (a tab's size, a window resizing or a site's zoom would move its elements between a snapshot and a click). */
const VIEWPORT = { width: 1280, height: 800 }
const pinned = new WeakMap<WebContents, boolean>()
/** Page `p` as whether it's held says: its size pinned or let go, placed again, its window told. */
function hold(p: EnginePage, again = false) {
  if (p.wc.isDestroyed()) return
  // (pinned too when taken over in the background, from the live view: no tab of the user's to fit)
  const on = held(p.id) || (owners.has(p.id) && !p.tab())
  // (a page never pinned, the user's, is left as it is)
  if (again || (pinned.get(p.wc) ?? false) !== on) {
    pinned.set(p.wc, on)
    // (and its zoom its own, at 100%: Chromium shares a site's zoom among its pages, so the user zooming their own tab of
    // a doc would lay the agent's copy out anew; let go, it takes the site's zoom again at its next load)
    p.wc.setZoomMode(on ? "isolated" : "default")
    if (on) p.wc.setZoomFactor(1)
    void (on ? cdp(p.wc, "Emulation.setDeviceMetricsOverride", { ...VIEWPORT, deviceScaleFactor: 0, mobile: false })
      : cdp(p.wc, "Emulation.clearDeviceMetricsOverride")).catch(() => pinned.delete(p.wc))
  }
  p.refit()
  changed(p.win)
}
const holdId = (id: number) => { for (const p of allPages()) if (p.id === id) hold(p) }
// (a renderer that came back, or a load in a new one, gets the size again)
eachPage((p) => p.wc.on("did-navigate", () => { if (pinned.get(p.wc)) hold(p, true) }))
/** The user takes page `id` over (agents paused there, the page itself in its tab, at its tab's size), or gives it back. */
export function setTaken(id: number, on: boolean) {
  if (!owners.has(id)) return
  if (on) { taken.add(id); paused.add(id) } else { taken.delete(id); paused.delete(id) }
  holdId(id)
}
const helpWaits = new Map<number, Set<() => void>>()

const accessOf = (p: EnginePage): Access => (!mayOpen(p.profile) ? "none" : access.get(p.profile) ?? "none")
const levels: Record<Access, number> = { none: 0, read: 1, act: 2 }

/** The page `tab` if agents (`who`, when it says) may `need` there, else why not. */
export function pageFor(tab: unknown, need: "read" | "act", who?: By): EnginePage {
  const p = allPages().find((x) => x.id === Number(tab))
  if (!p || p.wc.isDestroyed()) throw new Error(`no tab ${String(tab)}: \`vau browser tabs\` lists them`)
  const a = accessOf(p)
  if (levels[a] < levels[need]) {
    throw new Error(a === "none"
      ? "agents may not use this tab: its container doesn't let them (Agents, in the container menu of the page's bar)"
      : "agents may only read this tab: its container lets them read, not act")
  }
  if (need === "act" && taken.has(p.id)) throw new Error("the user took this page over and is using it: wait till they give it back (it shows as paused in `vau browser tabs` till then)")
  if (need === "act" && paused.has(p.id)) throw new Error("the user paused agents in this tab")
  if (need === "act" && filling.has(p.id)) throw new Error("the app is filling a login in this tab: try again in a moment")
  // (an extension's own page, Focus's blocked page and its ask for time among them, is the user's alone)
  if (!/^https?:/i.test(p.wc.getURL() || p.url)) throw new Error("agents use web pages only, not an extension's or the app's")
  if (who?.remote && localUrl(p.wc.getURL() || p.url)) throw new Error(OUTSIDE)
  used.set(p.id, Date.now())
  void p.wake()
  if (need === "act") void trackRequests(p)
  return p
}

/** When agents last used each page: one in the background unused a while rests (draws nothing) till they're back. */
const used = new Map<number, number>()
const REST_MS = 60_000
setInterval(() => {
  const old = Date.now() - REST_MS
  for (const p of allPages()) if (!p.resting() && (used.get(p.id) ?? 0) < old && !watched.has(p.id) && !asks.has(p.id)) p.rest()
}, 15_000).unref()

// ---------- snapshots ----------

type AXValue = { value?: unknown }
type AXNode = { nodeId: string; ignored?: boolean; role?: AXValue; name?: AXValue; value?: AXValue; childIds?: string[]; backendDOMNodeId?: number
  properties?: { name: string; value: AXValue }[] }
const INTERACTIVE = new Set(["button", "link", "textbox", "searchbox", "combobox", "checkbox", "radio", "switch", "slider", "spinbutton", "menuitem",
  "menuitemcheckbox", "menuitemradio", "option", "tab", "treeitem", "listbox"])
const SKIP = new Set(["none", "generic", "InlineTextBox", "LineBreak", "presentation", "LayoutTable", "LayoutTableRow", "LayoutTableCell", "MenuListPopup"])
/** Each page's refs: an element keeps its ref while its document lasts, so refs stay good from one snapshot to the next
 *  and a diff shows only what changed. Never reused in a page: a new document's go on from the last one's. */
type Refs = { byRef: Map<string, number>; byNode: Map<number, string>; n: number
  /** What each ref was in the last snapshot (its role and name): a list that reuses its rows (Gmail, Slack) can put
   *  another item in the same element, and an act by the old ref would land on it. */
  what: Map<string, { role: string; name: string }> }
const refs = new WeakMap<WebContents, Refs>()
const refsOf = (wc: WebContents) => {
  let r = refs.get(wc)
  if (!r) refs.set(wc, (r = { byRef: new Map(), byNode: new Map(), n: 0, what: new Map() }))
  return r
}
/** Each page's tree as an agent last saw it, and which document it was (docOf): what act's diff is against. */
const seen = new WeakMap<WebContents, { lines: string[]; doc: number }>()
eachPage((p) => p.wc.on("did-navigate", () => {
  const r = refs.get(p.wc)
  r?.byRef.clear()
  r?.byNode.clear()
  r?.what.clear()
}))
const MAX_SNAPSHOT = 60_000
const MAX_TREE = 1_000_000

/** The page's accessibility tree, a line per node shown, its controls with refs; short, as each line costs agents tokens
 *  (no text a name already says, no empty wrappers, a row of simple parts on one line, a long list's first options). */
async function tree(p: EnginePage, again = true): Promise<string[]> {
  const doc = docOf(p.wc)
  await cdp(p.wc, "Accessibility.enable")
  const { nodes } = await cdp<{ nodes: AXNode[] }>(p.wc, "Accessibility.getFullAXTree")
  // (it went to another page as it was read: the old page's controls would take the new one's refs)
  if (docOf(p.wc) !== doc) { if (again) return tree(p, false); throw new Error("the page kept changing as it was read: take a snapshot again in a moment") }
  const byId = new Map(nodes.map((n) => [n.nodeId, n]))
  const kids = new Set(nodes.flatMap((n) => n.childIds ?? []))
  const root = nodes.find((n) => !kids.has(n.nodeId)) ?? nodes[0]
  const r = refsOf(p.wc)
  let size = 0
  const text = (v: AXValue | undefined) => (typeof v?.value === "string" ? v.value : v?.value == null ? "" : String(v.value)).replace(/\s+/g, " ").trim()
  const pad = (depth: number) => "  ".repeat(depth)
  /** Its lines, at `depth`; `said`: the name of the nearest line above, whose text needn't come again (any text, inside a
   *  control: its name says what it is). */
  const walk = (node: AXNode | undefined, depth: number, said: string | true): string[] => {
    if (!node || size > MAX_TREE) return []
    const role = text(node.role), name = text(node.name).slice(0, 200)
    // (a field the app filled a secret into: its value, and the text inside it, never shown)
    const filled = !!node.backendDOMNodeId && wasFilled(p.wc, node.backendDOMNodeId)
    const shown = !node.ignored && !SKIP.has(role) && !(role === "StaticText" && !name)
    const under = (d: number, s: string | true) => (filled ? [] : (node.childIds ?? []).flatMap((c) => walk(byId.get(c), d, s)))
    if (!shown) return under(depth, said)
    if (role === "StaticText") {
      if (said === true || (said && said.includes(name))) return []
      const line = scrub(`${pad(depth)}- text "${name.replace(/"/g, "'")}"`)
      size += line.length + 1
      return [line]
    }
    const props = Object.fromEntries((node.properties ?? []).map((x) => [x.name, x.value?.value]))
    let line = `${pad(depth)}- ${role}${name ? ` "${name.replace(/"/g, "'")}"` : ""}`
    const id = node.backendDOMNodeId
    let info = !!name
    if ((INTERACTIVE.has(role) || (props.focusable === true && !!name)) && id) {
      let ref = r.byNode.get(id)
      if (!ref) { ref = `e${++r.n}`; r.byNode.set(id, ref); r.byRef.set(ref, id) }
      r.what.set(ref, { role, name })
      line += ` [ref=${ref}]`
      info = true
    }
    // (a password field's dots say its length: never)
    const value = filled || /^[•●*]+$/.test(text(node.value)) ? (text(node.value) ? "•••" : "") : text(node.value)
    if (value && value !== name) { line += `: ${value.slice(0, 200)}`; info = true }
    for (const k of ["checked", "pressed", "expanded", "selected", "disabled"]) if (props[k] === true || props[k] === "true" || props[k] === "mixed") { line += ` [${k}]`; info = true }
    const control = INTERACTIVE.has(role) && !!name && !/^(textbox|searchbox|combobox|listbox)$/.test(role)
    let below = under(depth + 1, control ? true : name && role !== "RootWebArea" ? name : said)
    const top = (l: string) => l.startsWith(`${pad(depth + 1)}- `)
    // (a list's options past the first few: one line saying how many, the chosen ones kept)
    const options = below.filter((l) => top(l) && /^\s*- option\b/.test(l))
    if (options.length > 15) {
      let shownOptions = 0
      below = below.filter((l) => !(top(l) && /^\s*- option\b/.test(l)) || /\[selected\]/.test(l) || shownOptions++ < 10)
      below.push(`${pad(depth + 1)}- … ${options.length - below.filter((l) => top(l) && /^\s*- option\b/.test(l)).length} more options`)
    }
    const tops = below.filter(top)
    // (an empty wrapper says nothing; one holding a single thing, or a part named as the one thing in it, a cell holding
    // its link, gives its place to it)
    if (!info && !below.length) return []
    if (tops.length === 1 && (!info || (!line.includes("[ref=") && name && new RegExp(`^\\s*- \\S+ "${name.replace(/"/g, "'").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`).test(tops[0])))) {
      return below.map((l) => l.slice(2))
    }
    // (a row or a list's item of simple parts, a line: its parts side by side)
    if (!info && tops.length > 1 && tops.length <= 12 && tops.length === below.length) {
      const parts = below.map((l) => l.trim().replace(/^- (?:text|cell|gridcell|paragraph|StaticText) (?=")/, "").replace(/^- /, ""))
      const joined = `${pad(depth)}- ${role}: ${parts.join(" | ")}`
      if (joined.length < 500) return [joined]
    }
    line = scrub(line)
    size += line.length + 1
    return [line, ...below]
  }
  const lines = walk(root, 0, "")
  seen.set(p.wc, { lines, doc: docOf(p.wc) })
  return lines
}

const cut = (lines: string[], max = MAX_SNAPSHOT) => {
  let size = 0
  const at = lines.findIndex((l) => (size += l.length + 1) > max)
  return at < 0 ? lines.join("\n") : `${lines.slice(0, at).join("\n")}\n… (cut short: \`vau browser read\` gives the page's text)`
}
export async function snapshot(p: EnginePage) {
  const lines = await tree(p)
  return { tab: p.id, url: scrub(p.wc.getURL()), title: scrub(p.wc.getTitle()), snapshot: cut(lines) }
}

/** Each agent page's data requests under way (fetch, XHR), by id, with when each began and its answer began: a page
 *  draws what they bring, so settling waits for them. Over the DevTools protocol, in agents' pages only. */
type Request = { at: number; answered?: number }
const loading = new WeakMap<WebContents, Map<string, Request>>()
/** When each agent page last began going to another document (its main frame's): a navigation an act set off late; and
 *  when it last came to one. */
const navigated = new WeakMap<WebContents, number>()
const arrived = new WeakMap<WebContents, number>()
/** Each page's tracking as it starts: an act waits for it, so its first one sees the page's requests too. */
const tracking = new WeakMap<WebContents, Promise<void>>()
function trackRequests(p: EnginePage) {
  const was = tracking.get(p.wc)
  if (was) return was
  const t = startTracking(p)
  tracking.set(p.wc, t)
  return t
}
async function startTracking(p: EnginePage) {
  const live = new Map<string, Request>()
  loading.set(p.wc, live)
  const heard = (_e: unknown, method: string, params: { requestId?: string; type?: string }) => {
    if (method === "Network.requestWillBeSent" && (params.type === "XHR" || params.type === "Fetch")) live.set(String(params.requestId), { at: Date.now() })
    else if (method === "Network.responseReceived") { const r = live.get(String(params.requestId)); if (r) r.answered = Date.now() }
    else if (method === "Network.loadingFinished" || method === "Network.loadingFailed") live.delete(String(params.requestId))
  }
  // (an iframe's or an in-page navigation leaves the page's requests running: only a new document ends them)
  const went = (e: { isMainFrame: boolean; isSameDocument: boolean }) => { if (e.isMainFrame && !e.isSameDocument) { live.clear(); navigated.set(p.wc, Date.now()) } }
  const came = () => arrived.set(p.wc, Date.now())
  const off = () => { p.wc.debugger.off("message", heard); p.wc.off("did-start-navigation", went); p.wc.off("did-navigate", came); loading.delete(p.wc); tracking.delete(p.wc) }
  p.wc.debugger.on("message", heard)
  p.wc.on("did-start-navigation", went)
  p.wc.on("did-navigate", came)
  try { await cdp(p.wc, "Network.enable", { maxTotalBufferSize: 0, maxResourceBufferSize: 0 }); p.wc.debugger.once("detach", off) } catch { off() }
}
/** How long an answer may take to come whole once it began: one still coming after is a stream (events, a long poll). */
const STREAM_MS = 1000
/** Data requests that began since `since` (or a second before) and haven't ended: long-lived ones (a mail app's open
 *  channel) never hold anything, nor a stream. */
const fetching = (p: EnginePage, since: number, now = Date.now()) => [...(loading.get(p.wc)?.values() ?? [])]
  .some((r) => r.at >= since - 1000 && now - r.at < 10_000 && (r.answered === undefined || now - r.answered < STREAM_MS))
/** Until the page's DOM is still a moment (300 ms) with no data request it began under way, `cap` at most, so an answer
 *  sees what the action drew. */
async function quiet(p: EnginePage, since = Date.now(), cap = 2000) {
  const until = Date.now() + cap
  for (;;) {
    const left = until - Date.now()
    if (left <= 0 || p.wc.isDestroyed()) return
    // (bounded here too: a document that goes away mid-wait may never answer)
    let bound: ReturnType<typeof setTimeout> | undefined
    await Promise.race([new Promise((r) => { bound = setTimeout(r, left + 250) }), p.wc.executeJavaScriptInIsolatedWorld(1014, [{ code: `new Promise((done) => {
      let t = setTimeout(end, 300)
      const cap = setTimeout(end, ${Math.max(300, left)}), o = new MutationObserver(() => { clearTimeout(t); t = setTimeout(end, 300) })
      function end() { o.disconnect(); clearTimeout(t); clearTimeout(cap); done(true) }
      const how = { subtree: true, childList: true, attributes: true, characterData: true }
      // (a web component's open shadow roots change apart from the document: watched each)
      const roots = [document]
      for (let i = 0; i < roots.length && roots.length < 500; i++) for (const el of roots[i].querySelectorAll("*")) if (el.shadowRoot) roots.push(el.shadowRoot)
      for (const r of roots) o.observe(r, how)
    })` }]).catch(() => {})])
    clearTimeout(bound)
    if (!fetching(p, since)) return
    while (fetching(p, since) && Date.now() < until) await new Promise((r) => setTimeout(r, 50))
  }
}

/** How many changed lines an act answers: summary (30), none (0, no diff taken) or a number. */
const diffLimit = (d: unknown) => (d === "none" ? 0 : /^\d+$/.test(String(d ?? "")) ? Math.min(1000, Number(d)) : 30)
const cutTo = (all: string[], limit: number) => ({ lines: all.slice(0, limit), more: Math.max(0, all.length - limit) })
/** A new page's first lines, its content's (summary: 50; none; or a number). */
const pageLines = (lines: string[], d: unknown) => ({ page: true, ...cutTo(mainLines(lines), d === undefined || d === null || d === "summary" ? 50 : diffLimit(d)) })

// ---------- downloads, by page: where each landed (the app saves them in Downloads, web.ts) ----------

type Download = { name: string; path: string; state: "progressing" | "completed" | "cancelled" | "interrupted"; at: number }
const downloads = new WeakMap<WebContents, Download[]>()
eachSession((s) => {
  s.on("will-download", (_e, item, wc) => {
    if (!wc) return
    const d: Download = { name: item.getFilename(), path: "", state: "progressing", at: Date.now() }
    downloads.set(wc, [...(downloads.get(wc) ?? []), d].slice(-20))
    item.once("done", (_ev, state) => { d.path = item.getSavePath(); d.state = state })
  })
})
const shownDownload = (d: Download) => ({ name: d.name, state: d.state, ...(d.path ? { path: d.path } : {}) })

// ---------- files given to a page's file input: kept a day in userData, never the vault ----------

const UPLOADS = () => path.join(app.getPath("userData"), "agent-uploads")
const MAX_UPLOAD = 50 << 20
function uploadFiles(files: unknown): string[] {
  const list = Array.isArray(files) ? files as { name?: unknown; data?: unknown }[] : []
  if (!list.length) throw new Error("upload needs files")
  const dir = path.join(UPLOADS(), crypto.randomUUID())
  fs.mkdirSync(dir, { recursive: true })
  let size = 0
  return list.map((f, i) => {
    const data = Buffer.from(String(f?.data ?? ""), "base64")
    if ((size += data.length) > MAX_UPLOAD) throw new Error("upload takes 50 MB at most")
    const name = path.basename(String(f?.name ?? "")).replace(/^\.+/, "") || `file-${i + 1}`
    const file = path.join(dir, name)
    fs.writeFileSync(file, data)
    return file
  })
}

// ---------- acting, with real input ----------

async function nodeOf(p: EnginePage, ref: unknown) {
  const r = refsOf(p.wc), id = r.byRef.get(String(ref))
  if (!id) throw new Error(`no ref ${String(ref)} on this tab's page: take a snapshot (\`vau browser snapshot ${p.id}\`)`)
  const was = r.what.get(String(ref))
  if (was) {
    const { nodes } = await cdp<{ nodes: AXNode[] }>(p.wc, "Accessibility.getPartialAXTree", { backendNodeId: id, fetchRelatives: false }).catch(() => ({ nodes: [] as AXNode[] }))
    const n = nodes.find((x) => x.backendDOMNodeId === id) ?? nodes[0]
    const name = String(n?.name?.value ?? "").replace(/\s+/g, " ").trim().slice(0, 200), role = String(n?.role?.value ?? "")
    if (n && (role !== was.role || name !== was.name)) throw new Error(`ref ${String(ref)} is now ${role} "${scrub(name)}", not the ${was.role} "${scrub(was.name)}" it was: take a new snapshot`)
  }
  try { await cdp(p.wc, "DOM.scrollIntoViewIfNeeded", { backendNodeId: id }) } catch { throw new Error(`ref ${String(ref)} is gone from the page: take a new snapshot`) }
  const { model } = await cdp<{ model: { content: number[] } }>(p.wc, "DOM.getBoxModel", { backendNodeId: id })
  const q = model.content
  return { id, x: (q[0] + q[2] + q[4] + q[6]) / 4, y: (q[1] + q[3] + q[5] + q[7]) / 4 }
}
/** What the element knows of itself (its kind, whether it's checked), read without running the page's code. */
async function describe(p: EnginePage, id: number) {
  const { node } = await cdp<{ node: { nodeName: string; attributes?: string[] } }>(p.wc, "DOM.describeNode", { backendNodeId: id })
  const attrs: Record<string, string> = {}
  for (let i = 0; i + 1 < (node.attributes ?? []).length; i += 2) attrs[node.attributes![i]] = node.attributes![i + 1]
  return { tag: node.nodeName.toLowerCase(), attrs }
}

// ---------- the agent's pointer: where it acts, its name, and a faint frame round the page while it's at work ----------

/** Where each page's pointer last was, so a new document's starts there. */
const pointers = new WeakMap<WebContents, { x: number; y: number }>()
/** Pages someone watches live (live.ts): the pointer gets there before the agent acts, as on a page on screen. */
const watched = new Set<number>()
export const setWatched = (id: number, on: boolean) => { if (on) watched.add(id); else watched.delete(id) }
export const GLIDE_MS = 320
/** The agent's pointer to x, y (null: where it is, the page lit as at work), `clicked` with a ring; once there when the
 *  page is seen (on screen or watched live), so the act follows it. */
async function pointTo(p: EnginePage, who: string, x: number | null, y: number | null, clicked = false) {
  const from = pointers.get(p.wc) ?? { x: 160, y: 120 }
  if (x !== null && y !== null) pointers.set(p.wc, { x, y })
  const args = [x === null ? null : Math.round(x), y === null ? null : Math.round(y), from, who || "Agent", clicked].map((v) => JSON.stringify(v)).join(", ")
  const { POINTER } = await import("./agentrun.ts")
  await p.wc.executeJavaScriptInIsolatedWorld(1010, [{ code: `(${POINTER})(${args})` }]).catch(() => {})
  if (x !== null && (p.visible() || watched.has(p.id))) await new Promise((r) => setTimeout(r, GLIDE_MS))
}
/** Who's acting in each page now (`actIn` sets it), for the pointer's name. */
const actor = new WeakMap<WebContents, string>()

/** An agent's input to page `p`, only while it's still theirs: the user taking it over (or pausing agents) mid-act stops
 *  it there, so a fill's select-all and Backspace never land on what they type. */
function ours(p: EnginePage) {
  if (taken.has(p.id) || paused.has(p.id)) throw new Error("the user took this page over (or paused agents in it) mid-act: stopped there")
}
const input = (p: EnginePage, method: string, params: Record<string, unknown>) => { ours(p); return cdp(p.wc, method, params) }
const pressMine = (p: EnginePage, combo: string) => { ours(p); return press(p, combo) }
async function click(p: EnginePage, x: number, y: number, count = 1) {
  await pointTo(p, actor.get(p.wc) ?? "", x, y, true)
  await input(p, "Input.dispatchMouseEvent", { type: "mouseMoved", x, y })
  for (let i = 1; i <= count; i++) {
    await input(p, "Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: i })
    await input(p, "Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: i })
  }
}

const KEYS: Record<string, { code: string; key: string; vk: number; text?: string }> = {
  enter: { code: "Enter", key: "Enter", vk: 13, text: "\r" }, tab: { code: "Tab", key: "Tab", vk: 9 }, escape: { code: "Escape", key: "Escape", vk: 27 },
  backspace: { code: "Backspace", key: "Backspace", vk: 8 }, delete: { code: "Delete", key: "Delete", vk: 46 }, space: { code: "Space", key: " ", vk: 32, text: " " },
  arrowup: { code: "ArrowUp", key: "ArrowUp", vk: 38 }, arrowdown: { code: "ArrowDown", key: "ArrowDown", vk: 40 },
  arrowleft: { code: "ArrowLeft", key: "ArrowLeft", vk: 37 }, arrowright: { code: "ArrowRight", key: "ArrowRight", vk: 39 },
  home: { code: "Home", key: "Home", vk: 36 }, end: { code: "End", key: "End", vk: 35 }, pageup: { code: "PageUp", key: "PageUp", vk: 33 },
  pagedown: { code: "PageDown", key: "PageDown", vk: 34 },
}
/** A Mac's editing keys, which a page takes only as Chromium's editing commands (a key event alone selects nothing): by
 *  modifiers in order, then the key. Never copy, cut or paste: those would reach the user's clipboard. */
const MAC_COMMANDS: Record<string, string> = {
  "meta+a": "selectAll", "meta+z": "undo", "meta+shift+z": "redo",
  "meta+arrowleft": "moveToBeginningOfLine", "meta+arrowright": "moveToEndOfLine", "meta+arrowup": "moveToBeginningOfDocument", "meta+arrowdown": "moveToEndOfDocument",
  "meta+shift+arrowleft": "moveToBeginningOfLineAndModifySelection", "meta+shift+arrowright": "moveToEndOfLineAndModifySelection",
  "meta+shift+arrowup": "moveToBeginningOfDocumentAndModifySelection", "meta+shift+arrowdown": "moveToEndOfDocumentAndModifySelection",
  "alt+arrowleft": "moveWordLeft", "alt+arrowright": "moveWordRight", "alt+shift+arrowleft": "moveWordLeftAndModifySelection", "alt+shift+arrowright": "moveWordRightAndModifySelection",
  "meta+backspace": "deleteToBeginningOfLine", "alt+backspace": "deleteWordBackward", "alt+delete": "deleteWordForward",
  "shift+arrowleft": "moveLeftAndModifySelection", "shift+arrowright": "moveRightAndModifySelection", "shift+arrowup": "moveUpAndModifySelection", "shift+arrowdown": "moveDownAndModifySelection",
  "shift+home": "moveToBeginningOfLineAndModifySelection", "shift+end": "moveToEndOfLineAndModifySelection",
}
/** Copying and cutting: never where a filled secret could be selected (a revealed password). */
const COPY = /^(?:(?:meta|cmd|control|ctrl)\+(?:shift\+)?[cx]|(?:control|ctrl|shift)\+(?:insert|delete))$/i
/** A key with modifiers ("Enter", "Meta+a", "Shift+Tab"). */
export async function press(p: EnginePage, combo: string) {
  const parts = combo.split("+").map((x) => x.trim()).filter(Boolean)
  const last = parts.pop() ?? ""
  const mods = parts.map((m) => m.toLowerCase())
  const modifiers = (mods.includes("alt") ? 1 : 0) | (mods.includes("control") || mods.includes("ctrl") ? 2 : 0) | (mods.includes("meta") || mods.includes("cmd") ? 4 : 0) | (mods.includes("shift") ? 8 : 0)
  const k = KEYS[last.toLowerCase()] ?? (last.length === 1
    ? { code: /[a-z]/i.test(last) ? `Key${last.toUpperCase()}` : /\d/.test(last) ? `Digit${last}` : "", key: last, vk: last.toUpperCase().charCodeAt(0), text: last }
    : null)
  if (!k) throw new Error(`no key "${last}": Enter, Tab, Escape, Backspace, Delete, Space, arrows, Home, End, PageUp, PageDown or one character`)
  const text = modifiers & ~8 ? undefined : k.text
  const command = process.platform === "darwin" ? MAC_COMMANDS[[...new Set(mods.map((m) => (m === "cmd" ? "meta" : m === "ctrl" ? "control" : m)))].sort().concat(last.toLowerCase()).join("+")] : undefined
  await cdp(p.wc, "Input.dispatchKeyEvent", { type: text ? "keyDown" : "rawKeyDown", key: k.key, code: k.code, windowsVirtualKeyCode: k.vk, modifiers, ...(text ? { text, unmodifiedText: text } : {}),
    ...(command ? { commands: [command] } : {}) })
  await cdp(p.wc, "Input.dispatchKeyEvent", { type: "keyUp", key: k.key, code: k.code, windowsVirtualKeyCode: k.vk, modifiers })
}

/** Till page `p` stops loading (its frames too) or ends, `until` at most: as its events tell, not looked at every so
 *  often (that cost a navigation 50 ms on average). */
const loaded = (p: EnginePage, until: number) => waitWhile(p, () => p.wc.isLoading(), ["did-stop-loading"], until)
/** While `going` holds for page `p` (and it lives), `until` at most, looked at again as one of `events` comes (and every
 *  half second all the same, should one never come). */
async function waitWhile(p: EnginePage, going: () => boolean, events: string[], until: number) {
  const wc = p.wc
  while (!wc.isDestroyed() && going() && Date.now() < until) {
    await new Promise<void>((done) => {
      const end = () => { clearTimeout(t); for (const e of [...events, "destroyed"]) wc.off(e as "destroyed", end); done() }
      const t = setTimeout(end, Math.max(0, Math.min(until - Date.now(), 500)))
      for (const e of [...events, "destroyed"]) wc.once(e as "destroyed", end)
    })
  }
}

/** After an action: a moment for what it started (a navigation, a menu, a download) to settle. */
/** The acts that can set off a navigation a moment after (a link's click, Enter in a form). */
const LATE = new Set(["click", "dblclick", "press", "select", "check", "uncheck"])
/** How long after an act a navigation it set off may still begin. */
const SETTLE_MS = 400
export async function settle(p: EnginePage, was: string, since = Date.now(), late = true) {
  const until = Date.now() + 8000, soon = Date.now() + (late ? SETTLE_MS : 0)
  // (a page that goes elsewhere a moment after the click, from its script, is waited for: not just one already loading)
  await waitWhile(p, () => !p.wc.isLoading() && (navigated.get(p.wc) ?? 0) < since, ["did-start-loading", "did-start-navigation"], soon)
  await loaded(p, until)
  const started = () => (downloads.get(p.wc) ?? []).filter((d) => d.at >= since)
  // (a navigation that came to no page is likely a download, which Chromium tells a moment after its load stopped)
  const began = navigated.get(p.wc) ?? 0
  if (began >= since && (arrived.get(p.wc) ?? 0) < began) for (const end = Date.now() + 500; Date.now() < end && !started().length;) await new Promise((r) => setTimeout(r, 20))
  const short = Date.now() + 5000
  while (Date.now() < short && started().some((d) => d.state === "progressing")) await new Promise((r) => setTimeout(r, 100))
  const url = p.wc.isDestroyed() ? "" : p.wc.getURL()
  const got = started()
  return { tab: p.id, url: scrub(url), title: p.wc.isDestroyed() ? "" : scrub(p.wc.getTitle()), navigated: url !== was, ...(got.length ? { downloads: got.map(shownDownload) } : {}) }
}

type Field = { ref: string; value: string; name?: string }
export type Act = { action: string; ref?: string; name?: string; role?: string; at?: { x: number; y: number }; value?: string; html?: string; key?: string; direction?: string; files?: unknown; fields?: Field[]; diff?: unknown }

/** The ref of the control named `name` (an exact name first, then one that has it), of `role` if given, from the page as
 *  it is now; else why not, with the names it has that come close. */
export async function refFor(p: EnginePage, name: string, role?: string) {
  const want = name.trim().toLowerCase(), r = String(role ?? "").trim()
  const all = (await tree(p)).flatMap((l) => [...l.matchAll(/(?:^\s*- |: | \| )(\S+) "([^"]*)"[^|]*?\[ref=(e\d+)\]/g)])
  const hits = all.filter((m) => !r || m[1] === r)
  const hit = hits.find((m) => m[2].toLowerCase() === want) ?? hits.find((m) => m[2].toLowerCase().includes(want))
  if (hit) return hit[3]
  const words = want.split(/\W+/).filter((w) => w.length > 2)
  const near = (r ? hits : all).filter((m) => words.some((w) => m[2].toLowerCase().includes(w))).slice(0, 8)
  throw new Error(`no ${r || "control"} named "${name}" on the page${near.length ? `; close: ${near.map((m) => `${m[1]} "${m[2]}" [${m[3]}]`).join(", ")}` : `: take a snapshot (\`vau browser snapshot ${p.id}\`)`}`)
}
/** The action with its targets found: a control by its name (else text the page shows, by where it's drawn), and a
 *  form's fields by their names. */
async function named(p: EnginePage, a: Act): Promise<Act> {
  const out = { ...a }
  if (!out.ref && out.name) {
    // (a role that's no control's, text or a heading, is text the page shows)
    if (out.role && !INTERACTIVE.has(out.role)) delete out.role
    try { out.ref = await refFor(p, out.name, out.role) } catch (e) {
      const { TEXT_AT } = await import("./agentrun.ts")
      const at = out.role ? null : await p.wc.executeJavaScriptInIsolatedWorld(1017, [{ code: TEXT_AT(out.name) }]).catch(() => null) as { x: number; y: number } | null
      if (!at) throw e
      out.at = at
    }
  }
  if (out.fields) out.fields = await Promise.all(out.fields.map(async (f) => (f.ref ? f : { ...f, ref: await refFor(p, f.name ?? "") })))
  return out
}
/** Where an action lands: its control (scrolled into view), or the point of the text it named. */
const targetOf = async (p: EnginePage, a: Act, need: (v: unknown, what: string) => unknown) => (a.at && !a.ref ? { id: 0, ...a.at } : nodeOf(p, need(a.ref, "a ref or a name")))
/** One action, with real input, not waiting for what it started. */
async function step(p: EnginePage, a: Act) {
  const need = (v: unknown, what: string) => { if (v === undefined || v === null || v === "") throw new Error(`${a.action} needs ${what}`); return v }
  switch (a.action) {
    case "click": case "dblclick": case "hover": {
      const n = await targetOf(p, a, need)
      if (a.action === "hover") { await pointTo(p, actor.get(p.wc) ?? "", n.x, n.y); await input(p, "Input.dispatchMouseEvent", { type: "mouseMoved", x: n.x, y: n.y }) }
      else await click(p, n.x, n.y, a.action === "dblclick" ? 2 : 1)
      break
    }
    case "fill": case "type": {
      // (type with no control: where the caret is, as a person typing on)
      if (a.action === "type" && !a.ref && !a.at) { await pointTo(p, actor.get(p.wc) ?? "", null, null); if (a.value) await input(p, "Input.insertText", { text: String(a.value) }); break }
      const n = await targetOf(p, a, need)
      await click(p, n.x, n.y)
      if (n.id) await cdp(p.wc, "DOM.focus", { backendNodeId: n.id }).catch(() => {})
      // (fill: what's there goes first, as a person selecting it all would)
      if (a.action === "fill") { await pressMine(p, process.platform === "darwin" ? "Meta+a" : "Control+a"); await pressMine(p, "Backspace") }
      if (a.value) await input(p, "Input.insertText", { text: String(a.value) })
      break
    }
    case "press": {
      const key = String(need(a.key ?? a.value, "a key")).replace(/\s+/g, "")
      if (COPY.test(key) && heldNear(p)) throw new Error("no copying in a page the app filled a login in")
      if (a.ref) { const n = await nodeOf(p, a.ref); await pointTo(p, actor.get(p.wc) ?? "", n.x, n.y); await cdp(p.wc, "DOM.focus", { backendNodeId: n.id }).catch(() => {}) }
      else await pointTo(p, actor.get(p.wc) ?? "", null, null)
      await pressMine(p, key)
      break
    }
    case "check": case "uncheck": {
      const n = await nodeOf(p, need(a.ref, "a ref"))
      const { nodes } = await cdp<{ nodes: AXNode[] }>(p.wc, "Accessibility.getPartialAXTree", { backendNodeId: n.id, fetchRelatives: false })
      const checked = nodes[0]?.properties?.find((x) => x.name === "checked")?.value?.value
      if ((checked === true || checked === "true") !== (a.action === "check")) await click(p, n.x, n.y)
      break
    }
    case "select": {
      // A list's option, picked as a person would: the list focused and the option's name typed (a Mac opens a list on
      // an arrow key, and typing picks without opening it).
      const n = await nodeOf(p, need(a.ref, "a ref"))
      const want = String(need(a.value, "a value"))
      const d = await describe(p, n.id)
      if (d.tag !== "select") throw new Error("select is for a list (a <select>): click the option instead")
      await pointTo(p, actor.get(p.wc) ?? "", n.x, n.y, true)
      type DomNode = { nodeName: string; nodeValue?: string; children?: DomNode[] }
      const { node } = await cdp<{ node: DomNode }>(p.wc, "DOM.describeNode", { backendNodeId: n.id, depth: -1 })
      const textOf = (x: DomNode): string => (x.nodeValue ?? "") + (x.children ?? []).map(textOf).join("")
      const all = (x: DomNode): DomNode[] => [x, ...(x.children ?? []).flatMap(all)]
      const options = all(node).filter((x) => x.nodeName === "OPTION").map((x) => textOf(x).replace(/\s+/g, " ").trim())
      const at = options.findIndex((o) => o === want || o.trim() === want.trim())
      if (at < 0) throw new Error(`no option "${want}" there: ${options.slice(0, 20).join(", ")}`)
      await cdp(p.wc, "DOM.focus", { backendNodeId: n.id })
      // (picked at once, one input and change as a person's pick makes: typing its name would pick the options on the
      // way, each a change, which a page acting on change takes)
      const { object } = await cdp<{ object: { objectId: string } }>(p.wc, "DOM.resolveNode", { backendNodeId: n.id })
      await cdp(p.wc, "Runtime.callFunctionOn", { objectId: object.objectId, arguments: [{ value: at }], functionDeclaration: `function (i) {
        if (this.selectedIndex === i) return
        this.selectedIndex = i
        this.dispatchEvent(new Event("input", { bubbles: true })); this.dispatchEvent(new Event("change", { bubbles: true })) }` })
      await cdp(p.wc, "Runtime.releaseObject", { objectId: object.objectId }).catch(() => {})
      break
    }
    case "upload": {
      // (into a file input as a person's pick would: Chromium gives the page the files, no dialog)
      const n = await nodeOf(p, need(a.ref, "a ref"))
      const d = await describe(p, n.id)
      if (d.tag !== "input" || d.attrs.type !== "file") throw new Error("upload is for a file input (<input type=file>): its ref, from the snapshot")
      await pointTo(p, actor.get(p.wc) ?? "", n.x, n.y, true)
      await cdp(p.wc, "DOM.setFileInputFiles", { backendNodeId: n.id, files: uploadFiles(a.files) })
      break
    }
    case "paste": {
      // (as a person pasting would, without the user's clipboard: a paste event carrying the text, and its HTML when
      // given, which editors like Google Docs take with its formatting; a field that ignores it gets the text typed)
      const text = String(need(a.value, "a value"))
      if (a.ref || a.at) { const n = await targetOf(p, a, need); await click(p, n.x, n.y); if (n.id) await cdp(p.wc, "DOM.focus", { backendNodeId: n.id }).catch(() => {}) }
      else await pointTo(p, actor.get(p.wc) ?? "", null, null)
      const code = `(() => { const dt = new DataTransfer(); dt.setData("text/plain", ${JSON.stringify(text)})
        ${a.html ? `dt.setData("text/html", ${JSON.stringify(String(a.html))})` : ""}
        let t = document.activeElement
        for (let i = 0; i < 5 && t; i++) { if (t.shadowRoot && t.shadowRoot.activeElement) t = t.shadowRoot.activeElement; else if (t.tagName === "IFRAME") { try { t = t.contentDocument.activeElement } catch { break } } else break }
        const e = new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true, composed: true })
        ;(t || document.body).dispatchEvent(e)
        return e.defaultPrevented })()`
      if (!await p.wc.executeJavaScriptInIsolatedWorld(1016, [{ code }]).catch(() => false)) await input(p, "Input.insertText", { text })
      break
    }
    case "scroll": {
      const n = a.ref ? await nodeOf(p, a.ref) : null
      const dy = { up: -600, down: 600 }[String(a.direction ?? a.value ?? "down")] ?? 600
      await pointTo(p, actor.get(p.wc) ?? "", n?.x ?? null, n?.y ?? null)
      await input(p, "Input.dispatchMouseEvent", { type: "mouseWheel", x: n?.x ?? 400, y: n?.y ?? 300, deltaX: 0, deltaY: dy })
      break
    }
    default: throw new Error(`no action "${a.action}": click, dblclick, hover, fill, type, paste, press, check, uncheck, select, upload or scroll`)
  }
}

/** A form's fields, each as its control takes it: typed into a text field, picked in a list, checked or unchecked (true or
 *  false). Every ref is checked first, so a wrong one fills nothing. */
async function fillForm(p: EnginePage, fields: Field[]) {
  const ids = fields.map((f) => {
    const id = refsOf(p.wc).byRef.get(f.ref)
    if (!id) throw new Error(`no ref ${f.ref} on this tab's page: take a snapshot (\`vau browser snapshot ${p.id}\`)`)
    return id
  })
  for (const [i, f] of fields.entries()) {
    const d = await describe(p, ids[i]), type = (d.attrs.type ?? "").toLowerCase(), role = d.attrs.role ?? ""
    if (d.tag === "input" && type === "file") throw new Error(`${f.ref} is a file input: upload into it (action upload)`)
    if (d.tag === "select") await step(p, { action: "select", ref: f.ref, value: f.value })
    else if ((d.tag === "input" && (type === "checkbox" || type === "radio")) || ["checkbox", "radio", "switch"].includes(role)) {
      await step(p, { action: /^(true|yes|on|1|checked)$/i.test(f.value.trim()) ? "check" : "uncheck", ref: f.ref })
    } else await step(p, { action: "fill", ref: f.ref, value: f.value })
  }
}

/** The fields given (a list of { ref, value }), checked. */
const fieldsOf = (x: unknown): Field[] => {
  if (!Array.isArray(x) || !x.length) throw new Error("fields: a list of { ref, value }")
  return x.slice(0, 200).map((f: { ref?: unknown; name?: unknown; value?: unknown }) => {
    if (!f || typeof f !== "object" || !(String(f.ref ?? "").trim() || String((f as { name?: unknown }).name ?? "").trim())) throw new Error("fields: each needs a ref (e12) or its control's name, and its value")
    return { ref: String(f.ref ?? "").trim(), name: String((f as { name?: unknown }).name ?? "").trim() || undefined, value: typeof f.value === "string" ? f.value : f.value == null ? "" : String(f.value) }
  })
}

/** The pages an act on `p` opened (a link to a new tab, a popup), once they've loaded a moment: the agent's own. */
async function openedBy(p: EnginePage, had: Set<number>) {
  const opened = allPages().filter((x) => !had.has(x.id) && x.opener === p.id && !x.wc.isDestroyed())
  if (!opened.length) return {}
  const until = Date.now() + 5000
  while (Date.now() < until && opened.some((x) => !x.wc.isDestroyed() && x.wc.isLoading())) await new Promise((r) => setTimeout(r, 100))
  return { opened: opened.filter((x) => !x.wc.isDestroyed()).map((x) => ({ tab: x.id, url: scrub(x.wc.getURL() || x.url), title: scrub(x.wc.getTitle()) })) }
}
/** An action (or a whole form, `fields`) settled: where the tab is, what it downloaded, and what changed on the page since
 *  the agent last saw it (`diff`: lines, or the new page's when it went to another; none takes no tree). */
async function act(p: EnginePage, a: Act) {
  // (a resting page's input went nowhere till it woke; its first act's requests weren't seen)
  await Promise.all([p.wake(), tracking.get(p.wc)])
  const limit = diffLimit(a.diff)
  if (limit && !seen.has(p.wc)) await tree(p)
  const before = seen.get(p.wc), was = p.wc.getURL(), since = Date.now(), had = new Set(allPages().map((x) => x.id)), doc = docOf(p.wc)
  if (a.fields) await fillForm(p, fieldsOf(a.fields)); else await step(p, a)
  // (the page's stillness is watched while a navigation the act may set off is waited for, not after it)
  const still = limit ? quiet(p, since, 2000) : null
  const r = { ...await settle(p, was, since, a.fields ? false : LATE.has(a.action)), ...await openedBy(p, had) }
  if (!limit || p.wc.isDestroyed()) {
    // (no diff: still till what the action fetched has come, so the next step finds the page it drew)
    const until = Date.now() + 3000
    if (fetching(p, since)) { while (fetching(p, since) && Date.now() < until) await new Promise((r) => setTimeout(r, 50)); await new Promise((r) => setTimeout(r, 150)) }
    return r
  }
  // (another document: its own stillness, once loaded)
  if (r.navigated || docOf(p.wc) !== doc) await quiet(p, since, 4000); else await still
  const lines = await tree(p).catch(() => null)
  if (!lines) return r
  const page = !before || before.doc !== docOf(p.wc)
  return { ...r, navigated: r.navigated || page, diff: page ? pageLines(lines, a.diff) : { page: false, ...cutTo(changes(before.lines, lines), limit) } }
}

// ---------- what agents did, kept for replay (this Mac's userData, never the vault) ----------

const RUNS = () => path.join(app.getPath("userData"), "agent-runs")
const KEEP_DAYS = 14
/** Who asked: the agent's name, its session (the op's caller), the task it named and what it said it's doing (`summary`,
 *  given on open), a run each a day. */
export type By = { name?: string; session?: string; task?: string; summary?: string; remote?: boolean }
const runOf = (by: By) => `${new Date().toISOString().slice(0, 10)}-${[by.session || by.name || "agent", by.task].filter(Boolean).join("-").replace(/[^\w.-]+/g, "_").slice(0, 80)}`
/** An agent's tabs' group in the window, Neo's way: "<agent>/<task>". */
const groupOf = (by: By) => [by.name || "Agent", by.task].filter(Boolean).join("/")
const sameAgent = (a: By, b: By) => (a.name ?? "") === (b.name ?? "") && (a.session ?? "") === (b.session ?? "") && (!b.task || a.task === b.task)
/** Each page's last step, for the live list: who, in which run, and what. */
const latest = new Map<number, { by: By; run: string; t: number; step: Record<string, unknown> }>()
/** Live: a page an agent opened, or did something in this last while. */
const LIVE_MS = 120_000

export async function record(p: EnginePage, asked: By, step: Record<string, unknown>) {
  // (a step not naming its task is the one the tab was opened for)
  const owner = owners.get(p.id)
  const by = { ...asked, task: asked.task || owner?.task, summary: asked.summary || (owner && sameAgent(owner, asked) ? owner.summary : undefined) }
  const run = runOf(by), t = Date.now()
  // (how long the call took: since it said what it's doing, when it said so after the page's last step)
  const d = doing.get(p.id), ms = d && d.at >= (latest.get(p.id)?.t ?? 0) && d.at <= t ? t - d.at : undefined
  latest.set(p.id, { by, run, t, step })
  changed(p.win)
  lastStep = t
  try {
    const dir = path.join(RUNS(), run)
    fs.mkdirSync(dir, { recursive: true })
    let shot = ""
    // (no picture of a page showing a filled secret: the runs are files on this Mac; an agent's page out of sight draws on)
    if (!p.wc.isDestroyed() && !await exposed(p)) {
      await p.wake()
      const img = await p.wc.capturePage(undefined, { stayHidden: true }).catch(() => null)
      if (img && !img.isEmpty()) {
        shot = `${t}.jpg`
        const { width } = img.getSize()
        fs.writeFileSync(path.join(dir, shot), (width > 1200 ? img.resize({ width: 1200 }) : img).toJPEG(70))
        // (the replay's filmstrip draws hundreds of these at once)
        fs.mkdirSync(path.join(dir, "thumbs"), { recursive: true })
        fs.writeFileSync(path.join(dir, "thumbs", shot), img.resize({ width: THUMB_WIDTH, quality: "good" }).toJPEG(72))
      }
    }
    fs.appendFileSync(path.join(dir, "steps.jsonl"), scrub(JSON.stringify({ t, tab: p.id, by: by.name ?? "", ...(by.task ? { task: by.task } : {}),
      ...(by.summary ? { summary: by.summary } : {}), url: p.wc.getURL(), title: p.wc.getTitle(), ...(ms !== undefined ? { ms } : {}), ...step, ...(shot ? { shot } : {}) })) + "\n")
  } catch (e) { console.error("vaultite: an agent's step wasn't kept:", e) }
}
setTimeout(() => {
  try {
    const old = Date.now() - KEEP_DAYS * 86400_000
    for (const d of fs.readdirSync(RUNS())) {
      const day = Date.parse(d.slice(0, 10))
      if (Number.isFinite(day) && day < old) fs.rmSync(path.join(RUNS(), d), { recursive: true, force: true })
    }
  } catch { /* none yet */ }
}, 60_000).unref()

/** What an agent is doing in each page now, and since when (the pages' list says it). */
const doing = new Map<number, { what: string; at: number; by?: By }>()
/** An agent is at work in a page: who and what, for the pages' list and its pointer. */
export const acting = (p: EnginePage, by: By, what: string) => {
  actor.set(p.wc, by.name || "Agent")
  doing.set(p.id, { what, at: Date.now(), by })
  changed(p.win)
}
/** Who opens what page `id` opens now: its agent, or one that acted in it a moment ago (a click on a link to a new tab). */
const openerOf = (id: number) => owners.get(id) ?? (Date.now() - (doing.get(id)?.at ?? 0) < 5000 ? doing.get(id)?.by : undefined)
setAgentActing((id) => !!openerOf(id))
setAgentOwned((id) => owners.has(id) && !taken.has(id))
// What an agent opened from a page (a link to a new tab, a sign-in popup) is that agent's page too, in the background.
eachPage((p) => {
  const by = p.opener === undefined || p.tab() ? undefined : openerOf(p.opener)
  if (!by) return
  owners.set(p.id, by)
  used.set(p.id, Date.now())
  actor.set(p.wc, by.name || "Agent")
  doing.set(p.id, { what: `Opening ${hostOf(p.url)}`, at: Date.now(), by })
  // (held once the contents window.open made are set up: CDP on them mid-creation crashes the app)
  setImmediate(() => hold(p))
})

// ---------- the pages agents are at work in, told to their window as they change (its corner card, tabs) ----------

type Shown = { id: number; tab: string; url: string; title: string; profile: string; by: string; task: string; summary: string; group: string
  what: string; at: number | null; own: boolean; paused: boolean; asking: string | null; held: boolean; taken: boolean }
const atWork = (p: EnginePage, now = Date.now()) => owners.has(p.id) || (latest.get(p.id)?.t ?? 0) > now - LIVE_MS
function pagesOf(win: EngineWindow): Shown[] {
  return allPages().filter((p) => p.win === win && !p.wc.isDestroyed() && atWork(p)).map((p) => {
    const by = owners.get(p.id) ?? latest.get(p.id)?.by ?? {}, d = doing.get(p.id)
    return { id: p.id, tab: p.tab(), url: scrub(p.wc.getURL() || p.url), title: scrub(p.wc.getTitle()), profile: p.profile, by: by.name || "An agent",
      task: by.task ?? "", summary: by.summary ?? "", group: groupOf(by), what: d?.what ?? "", at: d?.at ?? null, own: owners.has(p.id), paused: paused.has(p.id),
      asking: asks.get(p.id)?.reason ?? null, held: held(p.id), taken: taken.has(p.id) }
  })
}
const soon = new Map<EngineWindow, ReturnType<typeof setTimeout>>()
/** The window's list changed: told it a moment later, once for a burst. */
function changed(win: EngineWindow) {
  if (soon.has(win)) return
  soon.set(win, setTimeout(() => { soon.delete(win); tell(win, { type: "engine:agent:pages", pages: pagesOf(win) }) }, 120))
}
// (a page's title and address show in the list as they change)
eachPage((p) => { for (const ev of ["did-navigate", "page-title-updated"] as const) p.wc.on(ev as "did-navigate", () => { if (atWork(p)) changed(p.win) }) })
handle("agents:pages", (win) => pagesOf(win))

/** An element's name for the log ("Sign in"), from its ref. */
async function nameOf(p: EnginePage, ref: unknown) {
  const id = refsOf(p.wc).byRef.get(String(ref))
  if (!id) return ""
  try {
    const { nodes } = await cdp<{ nodes: AXNode[] }>(p.wc, "Accessibility.getPartialAXTree", { backendNodeId: id, fetchRelatives: false })
    const v = nodes[0]?.name?.value
    return typeof v === "string" ? v.slice(0, 80) : ""
  } catch { return "" }
}
/** What the log keeps of a field: its name, never what's typed into a password field. */
async function logged(p: EnginePage, ref: string | undefined, value: unknown) {
  const id = ref ? refsOf(p.wc).byRef.get(ref) : undefined
  const secret = id ? await describe(p, id).then((d) => d.attrs.type === "password", () => false) : false
  return { name: ref ? await nameOf(p, ref) : "", value: secret ? "•••" : value }
}

// ---------- the calls, the server's and a run's alike ----------

export const byOf = (x: unknown): By => {
  if (!x || typeof x !== "object") return {}
  const s = (k: keyof By, n = 80) => String((x as By)[k] ?? "").replace(/\s+/g, " ").trim().slice(0, n) || undefined
  return { name: s("name"), session: s("session"), task: s("task"), summary: s("summary", 300), ...((x as By).remote === true ? { remote: true } : {}) }
}

const DOING: Record<string, string> = { click: "Clicking", dblclick: "Double-clicking", hover: "Pointing at", fill: "Filling", type: "Typing in", paste: "Pasting into",
  press: "Pressing", check: "Checking", uncheck: "Unchecking", select: "Picking in", upload: "Uploading into", scroll: "Scrolling" }
export async function actIn(p: EnginePage, given: Act, who: By) {
  const a = await named(p, given.fields ? { ...given, fields: fieldsOf(given.fields) } : given)
  if (a.fields) {
    const fields = fieldsOf(a.fields)
    const kept = await Promise.all(fields.map(async (f) => ({ ref: f.ref, ...(await logged(p, f.ref, f.value)) })))
    acting(p, who, `Filling ${fields.length === 1 ? "a field" : `${fields.length} fields`}`)
    const r = await act(p, { ...a, action: "fill", fields })
    void record(p, who, { action: "form", fields: kept })
    return r
  }
  const files = a.action === "upload" && Array.isArray(a.files) ? (a.files as { name?: unknown }[]).map((f) => String(f?.name ?? "")).join(", ") : ""
  const kept = await logged(p, a.ref, files || (a.action === "paste" ? String(a.value ?? "").slice(0, 300) : a.value ?? a.key ?? a.direction))
  if (!kept.name && a.name) kept.name = a.name
  acting(p, who, `${DOING[a.action] ?? a.action}${kept.name ? ` “${kept.name}”` : ""}`)
  const r = await act(p, a)
  void record(p, who, { action: a.action, ref: a.ref, ...kept })
  return r
}

/** A page's text: its main part only with `main`; a Google doc, sheet or slides as its export (Markdown, the sheet shown
 *  as CSV, text), which its canvas never shows whole, with the page's own logins. */
const READ = (main: boolean) => `(async () => {
  const g = /^https:\\/\\/docs\\.google\\.com\\/(document|spreadsheets|presentation)\\/d\\/([\\w-]+)/.exec(location.href)
  if (g) {
    const as = { document: "md", spreadsheets: "csv", presentation: "txt" }[g[1]], gid = g[1] === "spreadsheets" ? (/[#&?]gid=(\\d+)/.exec(location.href) || [])[1] : ""
    try {
      const r = await fetch("/" + g[1] + "/d/" + g[2] + "/export?format=" + as + (gid ? "&gid=" + gid : ""), { credentials: "include" })
      if (r.ok && !/text\\/html/.test(r.headers.get("content-type") || "")) return { url: location.href, title: document.title, text: await r.text(), as }
    } catch {}
  }
  const root = (${main} && document.querySelector("main, [role=main]")) || document.body
  return { url: location.href, title: document.title, text: root ? root.innerText : "" }
})()`
export async function readIn(p: EnginePage, main = false) {
  const r = await p.wc.executeJavaScriptInIsolatedWorld(1011, [{ code: READ(main) }]) as { url: string; title: string; text: string; as?: string }
  const text = scrub(r.text)
  return { tab: p.id, url: scrub(r.url), title: scrub(r.title), ...(r.as ? { as: r.as } : {}), text: text.length > 200_000 ? `${text.slice(0, 200_000)}\n… (cut short)` : text }
}

export type Wait = { text?: string; url?: string; download?: boolean; helped?: boolean }
export async function waitIn(p: EnginePage, w: Wait, ms: unknown) {
  const wait = Math.min(w.helped ? 600_000 : 60_000, Math.max(100, Number(ms) || 10_000)), until = Date.now() + wait
  // (the text is looked for here, in what the page shows scrubbed: never an oracle for a filled secret)
  const shows = async () => !w.text || scrub(String(await p.wc.executeJavaScriptInIsolatedWorld(1012, [{ code: "document.body ? document.body.innerText : ''" }]).catch(() => ""))).includes(String(w.text))
  const last = () => (downloads.get(p.wc) ?? []).at(-1)
  if (w.helped && asks.has(p.id)) {
    // (the user's Done ends it at once, not at the next look)
    await new Promise<void>((done) => {
      const set = helpWaits.get(p.id) ?? new Set()
      helpWaits.set(p.id, set)
      const end = () => { clearTimeout(timer); set.delete(end); done() }
      const timer = setTimeout(end, wait)
      set.add(end)
    })
    if (asks.has(p.id)) throw new Error(`waited ${Math.round(wait / 1000)} s: the user hasn't said it's done yet (they still see what you asked): wait again`)
  }
  for (;;) {
    const d = last()
    const ok = (!w.url || scrub(p.wc.getURL()).includes(String(w.url))) && (!w.download || (!!d && d.state !== "progressing")) && !p.wc.isLoading() && await shows()
    if (ok) return { tab: p.id, url: scrub(p.wc.getURL()), title: scrub(p.wc.getTitle()), ...(w.download && d ? { download: shownDownload(d) } : {}) }
    if (Date.now() > until) {
      throw new Error(`waited ${Math.round(wait / 1000)} s: ${w.text ? `no "${w.text}"` : w.url ? `not at ${w.url}` : w.download ? (d ? `${d.name} is still downloading` : "nothing downloaded in this tab") : "still loading"}`)
    }
    await new Promise((r) => setTimeout(r, 200))
  }
}

// ---------- agents from outside this machine (an app on the internet, a guest through another machine) ----------

// (the app's own page on loopback is its owner's, a terminal a click away; and a router's or a NAS's are the network's)
export const OUTSIDE = "agents from outside this machine don't use its addresses or its network's (localhost, the LAN, the tailnet)"
/** A page such an agent opened, or acted in a moment ago (a click on a link, a script sending it on). */
const fromOutside = (id: number) => {
  const d = doing.get(id)
  return !!owners.get(id)?.remote || (!!d?.by?.remote && Date.now() - d.at < 5000)
}
const address = (ip: string) => `http://${ip.includes(":") ? `[${ip}]` : ip}/`
// Where those pages go, their redirects and frames too: never a local address, by its name or by what DNS answers for it.
onRequest("onBeforeRequest", (d, s) => {
  const p = d.webContentsId === undefined ? undefined : allPages().find((x) => !x.wc.isDestroyed() && x.wc.id === d.webContentsId)
  if (!p || !fromOutside(p.id) || !/^https?:/i.test(d.url)) return
  if (localUrl(d.url)) return { cancel: true }
  return s.resolveHost(new URL(d.url).hostname).then((found) => found.endpoints.length && !found.endpoints.some((e) => localUrl(address(e.address))) ? undefined : { cancel: true },
    () => ({ cancel: true }))
}, undefined, ["mainFrame", "subFrame"])

export const hostOf = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, "") } catch { return u } }
/** A page just loaded: once its content settled (a client-rendered page draws after its load), its first lines, unless
 *  `lines` is none (a run's go, which snapshots when it wants). */
async function firstLines(p: EnginePage, lines: unknown, since = Date.now()) {
  if (lines === "none" || p.wc.isDestroyed()) return {}
  await quiet(p, since, 4000)
  const all = await tree(p).catch(() => null)
  return all ? { diff: pageLines(all, lines) } : {}
}
export async function navigateIn(p: EnginePage, to: unknown, who: By, lines: unknown = "none") {
  const was = p.wc.getURL(), t = String(to ?? ""), since = Date.now()
  if (!["back", "forward", "reload"].includes(t) && !/^https?:\/\//i.test(t)) throw new Error("an http(s) address, back, forward or reload")
  if (who.remote && /^https?:/i.test(t) && localUrl(t)) throw new Error(OUTSIDE)
  acting(p, who, t === "back" ? "Going back" : t === "forward" ? "Going forward" : t === "reload" ? "Reloading" : `Opening ${hostOf(t)}`)
  const h = p.wc.navigationHistory
  if (t === "back") { if (h.canGoBack()) h.goBack() } else if (t === "forward") { if (h.canGoForward()) h.goForward() }
  else if (t === "reload") p.wc.reload()
  else void p.wc.loadURL(t).catch(() => {})
  const r = await settle(p, was)
  void record(p, who, { action: "navigate", value: t })
  return { ...r, ...await firstLines(p, lines, since) }
}

/** The page's web pages, each with whose it is: an agent's (`by`, and `mine` for the one asking) or the user's. */
const listOf = (asking: By) => allPages().filter((p) => !p.wc.isDestroyed() && /^https?:/i.test(p.wc.getURL() || p.url)).map((p) => {
  const owner = owners.get(p.id)
  return {
    tab: p.id, url: p.wc.getURL() || p.url, title: p.wc.getTitle(), container: p.profile.startsWith("c-") ? p.profile.slice(2) : null, ...(p.tab() ? { pane: p.tab() } : {}),
    access: accessOf(p), shown: p.visible(), by: owner ? groupOf(owner) : null, mine: !!owner && sameAgent(owner, asking),
    ...(owner?.summary ? { summary: owner.summary } : {}),
    ...(paused.has(p.id) ? { paused: true } : {}), ...(taken.has(p.id) ? { taken: true } : {}), ...(asks.has(p.id) ? { asking: asks.get(p.id)!.reason } : {}),
  }
})

// ---------- the app's ----------

// What agents may do in each profile, and where their tabs open.
handle("agents:access", (_win, map, where) => {
  const next = new Map<string, Access>()
  if (map && typeof map === "object") for (const [k, v] of Object.entries(map)) if (/^[a-z0-9-]{1,32}$/.test(k) && (v === "read" || v === "act")) next.set(k, v)
  access = next
  home = typeof where === "string" && next.get(where) === "act" ? where : [...next].find(([, v]) => v === "act")?.[0] ?? ""
})
// The user did what an agent asked (the bar's Done, or the live view's), or the tab closed.
export function helped(id: number) {
  if (!asks.delete(id)) return
  holdId(id) // (done: the agent's again)
  for (const p of allPages()) if (p.id === id) { tell(p.win, { type: "engine:agent:help", id, on: false }); changed(p.win) }
  for (const done of helpWaits.get(id) ?? []) done()
  helpWaits.delete(id)
}
handle("agents:helped", (_win, id) => helped(Number(id)))
/** Agents paused in page `id` (the bar's Stop, or the live view's), or let go on. */
export function setPaused(id: number, on: boolean) {
  if (!on && taken.has(id)) return setTaken(id, false) // (agents resumed: the page is theirs again)
  if (on) paused.add(id); else paused.delete(id)
  for (const p of allPages()) if (p.id === id) changed(p.win)
}
handle("agents:pause", (_win, id, on) => setPaused(Number(id), !!on))
handle("agents:take", (win, id, on) => { const p = agentPage(win, id); if (!owners.has(p.id)) throw new Error("that page is the user's already"); setTaken(p.id, !!on) })
/** An agent's page the user picked: into the app's tab `tab` (Open as tab), back to the background (""), or ended. */
function agentPage(win: EngineWindow, id: unknown) {
  const p = allPages().find((x) => x.id === Number(id) && x.win === win)
  if (!p || p.wc.isDestroyed() || !atWork(p)) throw new Error("that page is gone")
  return p
}
handle("agents:own", (win, id, tab) => {
  const p = agentPage(win, id), to = typeof tab === "string" && /^[\w-]{1,64}$/.test(tab) ? tab : ""
  if (to ? !!p.tab() : !owners.has(p.id)) throw new Error(to ? "that page is a tab already" : "only an agent's own page goes to the background")
  p.own(to)
  // (back in the background, out of the user's hands: the agent's again)
  if (!to && taken.has(p.id)) setTaken(p.id, false); else hold(p)
})
handle("agents:end", (win, id) => {
  const p = agentPage(win, id)
  if (!owners.has(p.id)) throw new Error("that page is the user's")
  p.close()
})
/** The task page `id` was opened for by an agent ("" for the user's). */
export const taskOf = (id: number) => owners.get(id)?.task ?? ""
/** Whose page `id` is (an agent's, else the user's), whether agents are paused in it and what one asked the user there. */
export const agentState = (id: number) => ({ by: owners.get(id) ?? null, paused: paused.has(id), ask: asks.get(id) ?? null })
/** Each page's last small picture (agents:live). */
const shots = new WeakMap<WebContents, string>()
// The pages agents are at work in now, each with a small picture of it as it is.
handle("agents:live", async () => {
  const now = Date.now()
  const live = allPages().filter((p) => !p.wc.isDestroyed() && (owners.has(p.id) || (latest.get(p.id)?.t ?? 0) > now - LIVE_MS))
  return Promise.all(live.map(async (p) => {
    const last = latest.get(p.id), by = last?.by ?? owners.get(p.id) ?? {}
    // (a resting page's last picture: it hasn't changed, and waking it to look would keep it from resting)
    const img = p.resting() ? null : await p.wc.capturePage(undefined, { stayHidden: true }).catch(() => null)
    if (img && !img.isEmpty()) shots.set(p.wc, `data:image/jpeg;base64,${img.resize({ width: 640 }).toJPEG(65).toString("base64")}`)
    return {
      tab: p.id, appTab: p.tab(), by: by.name ?? "", task: by.task ?? "", summary: by.summary ?? "", url: p.wc.getURL(), title: p.wc.getTitle(),
      run: last?.run ?? null, at: last?.t ?? null, step: last?.step ?? null, paused: paused.has(p.id), asking: asks.get(p.id)?.reason ?? null,
      shot: shots.get(p.wc) ?? null,
    }
  }))
})

// ---------- busy: an update's restart waits till agents are done ----------

/** Agent calls under way (a `run` script among them), and when an agent last did something in a page. */
let inFlight = 0
let lastStep = 0
/** An agent that acted this recently is likely mid-task, between calls. */
const BUSY_MS = 10 * 60_000
keepPage((id) => owners.has(id) || asks.has(id))
// (an ask can wait for days: it holds only the app's restart, which would lose it)
busyWhen(() => asks.size ? "a page waits on the user for an agent" : null, true)
busyWhen(() => inFlight ? "an agent's call is under way"
  : Date.now() - lastStep < BUSY_MS ? "an agent acted in a page in the last 10 minutes" : null)
/** An agent call, counted while it runs. What it answers, or fails with, never has a secret the app filled. */
export const serve = (name: `agent:${string}`, fn: Parameters<typeof handle>[1]) => handle(name, async (...a) => {
  inFlight++
  try { return scrubDeep(await fn(...a)) } catch (e) { const why = scrub((e as Error).message ?? String(e)); failed(name, a, why); throw new Error(why) } finally { inFlight-- }
})
/** A call on a page that failed, kept with the agent's steps (a replay shows where it went wrong, and why). */
function failed(name: string, a: unknown[], why: string) {
  const p = allPages().find((x) => x.id === Number(a[1]))
  if (!p || p.wc.isDestroyed()) return
  const last = a[a.length - 1]
  const asked = last && typeof last === "object" && !Array.isArray(last) && ("name" in last || "session" in last) ? byOf(last) : {}
  const by = { ...(owners.get(p.id) ?? {}), ...asked }
  // (in the run the page's steps are in, else the asking agent's; nobody named, none)
  const run = latest.get(p.id)?.run ?? (by.name || by.session ? runOf(by) : "")
  if (!run) return
  try {
    const dir = path.join(RUNS(), run)
    fs.mkdirSync(dir, { recursive: true })
    fs.appendFileSync(path.join(dir, "steps.jsonl"), scrub(JSON.stringify({ t: Date.now(), tab: p.id, by: by.name ?? "", ...(by.task ? { task: by.task } : {}),
      url: p.wc.getURL(), title: p.wc.getTitle(), action: name.slice("agent:".length), failed: why.slice(0, 500) })) + "\n")
  } catch { /* not kept */ }
}

// ---------- the server's (its agents', checked here whatever the server says) ----------

handle("agent:busy", (_win, of) => { const why = engineBusy(of === "server" ? "server" : "app"); return { busy: !!why, why } })

serve("agent:tabs", (_win, by) => listOf(byOf(by)))
serve("agent:open", async (win, url, container, by, lines) => {
  const u = String(url ?? "")
  if (!/^https?:\/\//i.test(u)) throw new Error("only http and https addresses")
  if (byOf(by).remote && localUrl(u)) throw new Error(OUTSIDE)
  const profile = container ? `c-${String(container)}` : home
  if (!profile) throw new Error("no container lets agents act: set one's Agents to Act (the container menu in a page's bar)")
  if (access.get(profile) !== "act" || !mayOpen(profile)) throw new Error(`agents may not act in ${container ? `the container ${String(container)}` : "that container"}`)
  // (in the background of the vault's window: no tab of the user's; they see it in the status bar's agents, and open it
  // as a tab if they want)
  const who = byOf(by), p = await openInBackground(win, u, profile), since = Date.now()
  void trackRequests(p)
  owners.set(p.id, who)
  used.set(p.id, Date.now())
  actor.set(p.wc, who.name || "Agent")
  doing.set(p.id, { what: `Opening ${hostOf(u)}`, at: Date.now() })
  hold(p)
  await loaded(p, Date.now() + 20_000)
  void record(p, who, { action: "open", value: u })
  return { tab: p.id, url: p.wc.getURL(), title: p.wc.getTitle(), ...await firstLines(p, lines, since) }
})
serve("agent:snapshot", (_win, tab) => snapshot(pageFor(tab, "read")))
serve("agent:read", (_win, tab, main) => readIn(pageFor(tab, "read"), main === true))
// (the companion in the user's own tab: where an element is, to point at it; what they selected; what's under a point)
serve("agent:locate", async (_win, tab, ref) => {
  const p = pageFor(tab, "read"), n = await nodeOf(p, ref)
  const { model } = await cdp<{ model: { border: number[]; width: number; height: number } }>(p.wc, "DOM.getBoxModel", { backendNodeId: n.id })
  return { tab: p.id, x: model.border[0], y: model.border[1], width: model.width, height: model.height, zoom: p.wc.getZoomFactor() }
})
serve("agent:selection", async (_win, tab) => {
  const p = pageFor(tab, "read")
  const text = String(await p.wc.executeJavaScriptInIsolatedWorld(1011, [{ code: "String(getSelection() || '')" }]).catch(() => "") ?? "")
  return { tab: p.id, url: p.wc.getURL(), selection: text.slice(0, 4000) }
})
serve("agent:at", async (_win, tab, x, y) => {
  const p = pageFor(tab, "read"), at = [Number(x) || 0, Number(y) || 0].map(Math.round)
  const code = `(() => { let e = document.elementFromPoint(${at[0]}, ${at[1]}); while (e && e.parentElement && (e.innerText || "").trim().length < 12) e = e.parentElement; return e ? (e.innerText || "").trim().slice(0, 600) : "" })()`
  const text = String(await p.wc.executeJavaScriptInIsolatedWorld(1011, [{ code }]).catch(() => "") ?? "")
  return { tab: p.id, url: p.wc.getURL(), text }
})
serve("agent:close", async (_win, tab) => {
  const p = allPages().find((x) => x.id === Number(tab))
  if (!p || p.wc.isDestroyed()) throw new Error(`no tab ${String(tab)}: \`vau browser tabs\` lists them`)
  if (!owners.has(p.id)) throw new Error("this tab is the user's: agents close only the tabs agents opened")
  // (its tab closes too; closing only the tab would send the page back to the background)
  if (p.tab()) tell(p.win, { type: "engine:agent:close", id: p.id, tab: p.tab() })
  const gone = p.wc.isDestroyed() ? Promise.resolve() : new Promise<void>((done) => {
    const t = setTimeout(done, 5000)
    p.wc.once("destroyed", () => { clearTimeout(t); done() })
  })
  p.close()
  await gone
  if (!p.wc.isDestroyed()) throw new Error("the tab didn't close: is the vault's window open?")
  return { tab: p.id }
})
/** At most this wide, so a picture costs an agent less (a Retina page is twice the size). */
const SHOT_WIDTH = 1280
/** No picture of a page showing a secret the app filled (a revealed password, a one-time code in its field). */
async function unexposed(p: EnginePage) {
  await p.wake()
  if (await exposed(p)) throw new Error("the page shows a secret the app filled (a password shown, a one-time code): no picture of it now")
  return p
}
serve("agent:screenshot", async (_win, tab) => {
  const p = await unexposed(pageFor(tab, "read"))
  // (a tab in the background is drawn for it, and stays hidden)
  const img = await p.wc.capturePage(undefined, { stayHidden: true })
  if (img.isEmpty()) throw new Error("the page drew nothing yet")
  const { width } = img.getSize()
  return { tab: p.id, png: (width > SHOT_WIDTH ? img.resize({ width: SHOT_WIDTH }) : img).toPNG().toString("base64") }
})
serve("agent:pdf", async (_win, tab, by) => {
  const p = await unexposed(pageFor(tab, "read"))
  const pdf = await p.wc.printToPDF({ printBackground: true })
  if (pdf.length > 50 << 20) throw new Error("the page makes a PDF over 50 MB")
  void record(p, byOf(by), { action: "pdf" })
  return { tab: p.id, url: p.wc.getURL(), title: p.wc.getTitle(), pdf: pdf.toString("base64") }
})
/** Whether a password field the page's code (and so an agent's script) can reach has a value. */
const PASSWORD_GIVEN = `(() => { const any = (root) => [...root.querySelectorAll("*")].some((el) => (el.tagName === "INPUT" && el.type === "password" && el.value)
  || (el.shadowRoot && any(el.shadowRoot)) || ((el.tagName === "IFRAME" || el.tagName === "FRAME") && (() => { try { return !!el.contentDocument && any(el.contentDocument) } catch { return false } })()))
  return any(document) })()`
serve("agent:evaluate", async (_win, tab, expression, by) => {
  const who = byOf(by), p = pageFor(tab, "act", who)
  const code = String(expression ?? "")
  if (!code.trim()) throw new Error("evaluate needs an expression")
  // Never where it could read a password: one the app filled (its code could also stay, listening, so a page it ran in
  // gets no login till it loads again: pagesecrets.ts), or one in a field now.
  const held = heldNear(p)
  if (held) throw new Error(`evaluate is off in this page: ${held}`)
  if (p.wc.isLoadingMainFrame()) throw new Error("the page is loading: wait for it (browser wait), then evaluate")
  markRan(p)
  if (await p.wc.executeJavaScriptInIsolatedWorld(1015, [{ code: PASSWORD_GIVEN }]).catch(() => true)) {
    throw new Error("evaluate is off in this page: a password field in it has something typed in it")
  }
  acting(p, who, "Running a script")
  // A world of its own: the DOM, never the page's scripts or their variables (nor they the agent's).
  const value = await Promise.race([p.wc.executeJavaScriptInIsolatedWorld(1013, [{ code }]),
    new Promise((_r, fail) => setTimeout(() => fail(new Error("the expression took over 30 s")), 30_000))])
  void record(p, who, { action: "evaluate", value: code.slice(0, 500) })
  let json = JSON.stringify(value ?? null) ?? "null"
  if (json.length > 100_000) json = `${json.slice(0, 100_000)}… (cut short)`
  return { tab: p.id, url: p.wc.getURL(), title: p.wc.getTitle(), value: json }
})
serve("agent:help", (_win, tab, reason, by) => {
  const p = pageFor(tab, "read", byOf(by))
  const why = String(reason ?? "").replace(/\s+/g, " ").trim().slice(0, 300)
  if (!why) throw new Error("say what the user should do (sign in, solve the check)")
  const who = byOf(by)
  asks.set(p.id, { by: who.name || "An agent", reason: why })
  hold(p) // (the page itself, the user's to use, till they're done)
  // (a page in the background opens as a tab, in the agent's tab group, where the user can do it)
  const mine = owners.get(p.id) ?? who
  tell(p.win, { type: "engine:agent:help", id: p.id, tab: p.tab(), by: who.name || "An agent", reason: why, on: true, url: p.wc.getURL() || p.url,
    profile: p.profile, group: groupOf(mine) })
  changed(p.win)
  void record(p, who, { action: "help", value: why })
  return { tab: p.id, url: p.wc.getURL(), title: p.wc.getTitle() }
})
serve("agent:wait", (_win, tab, what, ms) => waitIn(pageFor(tab, "read"), (what && typeof what === "object" ? what : {}) as Wait, ms))
serve("agent:navigate", (_win, tab, to, by, lines) => navigateIn(pageFor(tab, "act", byOf(by)), to, byOf(by), lines ?? "summary"))
// (any tab, whatever its container lets agents do: it moves the page to a window, nothing in it is read or done)
serve("agent:player", (_win, tab, on, fullScreen) => {
  const p = allPages().find((x) => x.id === Number(tab))
  if (!p || p.wc.isDestroyed()) throw new Error(`no tab ${String(tab)}: \`vau browser tabs\` lists them`)
  if (!/^https?:/i.test(p.wc.getURL() || p.url)) throw new Error("only a web page opens as a player")
  p.player(on !== false, fullScreen === true)
  return { tab: p.id, url: p.wc.getURL(), title: p.wc.getTitle() }
})
serve("agent:act", (_win, tab, a, by) => actIn(pageFor(tab, "act", byOf(by)), (a && typeof a === "object" ? a : {}) as Act, byOf(by)))

// A page that ends isn't paused, anyone's, live or asking any more.
eachPage((p) => p.wc.once("destroyed", () => {
  const was = atWork(p)
  helped(p.id)
  paused.delete(p.id); taken.delete(p.id); owners.delete(p.id); latest.delete(p.id); doing.delete(p.id); watched.delete(p.id); used.delete(p.id)
  if (was && appWindows().includes(p.win)) changed(p.win)
}))
// Files given to file inputs, a day on.
setTimeout(() => {
  try {
    for (const d of fs.readdirSync(UPLOADS())) {
      const at = path.join(UPLOADS(), d)
      if (Date.now() - fs.statSync(at).mtimeMs > 86400_000) fs.rmSync(at, { recursive: true, force: true })
    }
  } catch { /* none yet */ }
}, 60_000).unref()
