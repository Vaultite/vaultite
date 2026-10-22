// Shields: ads and trackers blocked in every web session (Ghostery's engine, uBlock Origin's lists, rebuilt daily in
// adblock-lists.ts); hiding rules and scriptlets go in through adblock-preload.cjs before a page's own scripts.
import { app, ipcMain, webContents, type IpcMainEvent, type IpcMainInvokeEvent, type OnBeforeRequestListenerDetails, type OnHeadersReceivedListenerDetails, type Session } from "electron"
import { AppWindow } from "../appwindow.ts"
import type { ElectronBlocker } from "@ghostery/adblocker-electron"
import fs from "node:fs"
import path from "node:path"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import { Worker } from "node:worker_threads"
import { eachPage, eachSession, engineLoaded, handle, later, onRequest, tell, type EnginePage } from "./engine.ts"

const PRELOAD = fileURLToPath(new URL("./adblock-preload.cjs", import.meta.url))
const DAY = 24 * 3600_000
/** QA: a folder with filters.txt (and resources.json) built instead of the lists, never kept. */
const LOCAL_LISTS = process.env.VAULTITE_ADBLOCK_LISTS || ""

type Ghostery = typeof import("@ghostery/adblocker-electron")
let lib: Ghostery | null = null
let engine: ElectronBlocker | null = null
// (its name changes with what adblock-lists.ts builds: a kept one built another way is rebuilt, not loaded)
const file = () => path.join(app.getPath("userData"), "adblock", "engine-2.bin")

// ---------- what the user chose (the Browser's settings, handed over by each window) ----------

/** `rules`: the user's hiding rules (one a line), `user` them parsed, once Ghostery is loaded. */
type Choice = { on: boolean; down: Set<string>; rules: string; user: ElectronBlocker | null }
const choices = new Map<number, Choice>()
let lastChoice: Choice = { on: true, down: new Set(), rules: "", user: null }
/** A window's choice; pages outside one (a sign-in popup) follow the last told. */
const choiceOf = (win?: AppWindow | null) => (win && choices.get(win.id)) || lastChoice
/** A window's choice, to change: made the first time it tells one. */
function told(win: AppWindow) {
  let c = choices.get(win.id)
  if (!c) {
    const id = win.id
    win.once("closed", () => choices.delete(id))
    choices.set(id, c = { on: true, down: new Set(), rules: "", user: null })
  }
  return lastChoice = c
}
const parseUser = (c: Choice) => {
  c.user = lib && c.rules ? lib.ElectronBlocker.parse(c.rules, { loadNetworkFilters: false, loadCosmeticFilters: true, loadGenericCosmeticsFilters: true, loadExtendedSelectors: true }) : null
}

/** The site Shields are set for: example.co.uk for www.example.co.uk, the host for an address or localhost. */
function siteOf(url: string) {
  if (!/^https?:/i.test(url) || !lib) return ""
  const r = lib.Request.fromRawDetails({ url })
  return r.domain || r.hostname
}
const upFor = (c: Choice, top: string) => c.on && !!engine && !c.down.has(siteOf(top))

// ---------- pages and what was blocked on each ----------

const pages = new Map<number, EnginePage>() // by their contents' id
const counts = new Map<number, number>()
const telling = new Map<number, ReturnType<typeof setTimeout>>()

eachPage((p) => {
  const wcId = p.wc.id
  pages.set(wcId, p)
  p.wc.on("did-start-navigation", (d) => {
    if (!d.isMainFrame || d.isSameDocument) return
    counts.delete(wcId)
    tellCount(p)
  })
  p.wc.once("destroyed", () => { pages.delete(wcId); counts.delete(wcId); clearTimeout(telling.get(wcId)); telling.delete(wcId) })
})

/** The page's window hears its count, at most every 250 ms. */
function tellCount(p: EnginePage) {
  const wcId = p.wc.id
  if (telling.has(wcId)) return
  telling.set(wcId, setTimeout(() => {
    telling.delete(wcId)
    tell(p.win, { type: "engine:adblock:count", id: p.id, count: counts.get(wcId) ?? 0 })
  }, 250))
}

/** Where a request comes from: the page its frame is in, and the document that asked (a frame's parent, for a frame). */
function originOf(d: OnBeforeRequestListenerDetails | OnHeadersReceivedListenerDetails) {
  const page = d.webContentsId ? pages.get(d.webContentsId) : undefined
  const wc = page?.wc ?? (d.webContentsId ? webContents.fromId(d.webContentsId) : undefined)
  const top = wc && !wc.isDestroyed() ? wc.getURL() : d.referrer
  let frame = ""
  try { frame = (d.resourceType === "subFrame" ? d.frame?.parent?.url : d.frame?.url) ?? "" } catch { /* the frame went */ }
  return { page, top, source: /^https?:/i.test(frame) ? frame : top || d.referrer }
}

function requestOf(d: OnBeforeRequestListenerDetails | OnHeadersReceivedListenerDetails, source: string) {
  const r = lib!.Request.fromRawDetails({ requestId: `${d.id}`, url: d.url, type: (d.resourceType || "other") as never, sourceUrl: source, tabId: d.webContentsId ?? 0 })
  if (r.type === "other") r.guessTypeOfRequest()
  return r
}

function beforeRequest(d: OnBeforeRequestListenerDetails) {
  const e = engine
  if (!e || d.resourceType === "mainFrame" || !/^(https?|wss?):/i.test(d.url)) return
  const o = originOf(d)
  if (!upFor(choiceOf(o.page?.win), o.top)) return
  const { match, redirect } = e.match(requestOf(d, o.source))
  if (!match && !redirect) return
  if (o.page) {
    const wcId = o.page.wc.id
    counts.set(wcId, (counts.get(wcId) ?? 0) + 1)
    tellCount(o.page)
  }
  return redirect ? { redirectURL: redirect.dataUrl } : { cancel: true }
}

/** A filter's `$csp`: added to a page's or frame's own policy. */
function headersReceived(d: OnHeadersReceivedListenerDetails) {
  const e = engine
  if (!e || (d.resourceType !== "mainFrame" && d.resourceType !== "subFrame")) return
  const o = originOf(d)
  const top = d.resourceType === "mainFrame" ? d.url : o.top
  if (!upFor(choiceOf(o.page?.win), top)) return
  const csp = e.getCSPDirectives(requestOf(d, d.resourceType === "mainFrame" ? d.url : o.source))
  if (!csp) return
  const headers = { ...d.responseHeaders }
  const policies = csp.split(";").map((x) => x.trim())
  for (const name of Object.keys(headers)) if (name.toLowerCase() === "content-security-policy") { policies.push(...headers[name]); delete headers[name] }
  return { responseHeaders: { ...headers, "Content-Security-Policy": [policies.join(";")] } }
}

// (the first hooks: index.ts imports Shields before extensions, so what they block no extension sees)
onRequest("onBeforeRequest", beforeRequest)
onRequest("onHeadersReceived", (d) => headersReceived(d as OnHeadersReceivedListenerDetails))
const sessions = new Set<Session>()
eachSession((s) => {
  sessions.add(s)
  s.registerPreloadScript({ type: "frame", filePath: PRELOAD })
})

// ---------- hiding rules and scriptlets, asked by adblock-preload.cjs in each frame ----------

/** What a frame's preload asked from (one of our pages' sessions, its address), whether Shields are up for its page,
 *  and its window's choice. */
function frameOf(e: IpcMainEvent | IpcMainInvokeEvent, url: unknown) {
  if (typeof url !== "string" || !/^https?:/i.test(url) || !sessions.has(e.sender.session) || !lib) return null
  let top = url
  try { if (e.senderFrame?.parent) top = e.senderFrame.top?.url ?? "" } catch { return null }
  const c = choiceOf(pages.get(e.sender.id)?.win)
  const r = lib.Request.fromRawDetails({ url })
  return { at: { url, hostname: r.hostname, domain: r.domain }, up: upFor(c, top), user: c.user }
}
type At = NonNullable<ReturnType<typeof frameOf>>["at"]

/** The user's rules for a frame at `at`: its stylesheet, and the rules a stylesheet can't say. */
function mine(user: ElectronBlocker | null, at: At) {
  const r = user?.getCosmeticsFilters({ ...at, getBaseRules: true, getInjectionRules: false, getRulesFromHostname: true, getRulesFromDOM: false, getExtendedRules: true })
  return { styles: apart(r?.styles ?? ""), extended: r?.extended ?? [] }
}
/** A CSS rule a selector (Ghostery joins them): a typo in one of the user's hides only that one's elements, not all. */
const apart = (css: string) => css.split(/\n\n+/).map((block) => {
  const m = /^([\s\S]*?)\s*\{([\s\S]*)\}\s*$/.exec(block.trim())
  return m ? m[1].split(",\n").map((sel) => `${sel.trim()} {${m[2]}}`).join("\n") : block
}).join("\n")

/** Ghostery's procedural selectors (`:has-text()`, `:upward()`) as one script, for frames that have such rules. */
let selectors = ""
const selectorsLib = () => (selectors ||= fs.readFileSync(path.join(path.dirname(createRequire(import.meta.url).resolve("@ghostery/adblocker-extended-selectors")),
  "../adblocker.umd.min.js"), "utf8"))

// (sync: the preload must have them before the page's first script runs; returnValue answers as it's set, once)
ipcMain.on("vaultite:adblock:frame", (e, url) => {
  const f = frameOf(e, url)
  const r = f?.up ? engine!.getCosmeticsFilters({ ...f.at, getBaseRules: true, getInjectionRules: true, getRulesFromHostname: true,
    getRulesFromDOM: false, getExtendedRules: true }) : null
  const shields = r && r.active !== false ? { styles: r.styles, scripts: r.scripts, extended: r.extended } : null
  const user = f?.user ? mine(f.user, f.at) : null
  e.returnValue = shields || user ? { shields, user, watch: engine?.config.enableMutationObserver !== false,
    lib: shields?.extended.length || user?.extended.length ? selectorsLib() : "" } : null
})
/** Rules for classes, ids and links the frame has (generic ones: `##.ad-banner`): Shields', and the user's apart. */
ipcMain.handle("vaultite:adblock:dom", (e, url, found, only) => {
  const f = frameOf(e, url)
  if (!f || !found || typeof found !== "object") return null
  const list = (x: unknown) => (Array.isArray(x) ? x.filter((v): v is string => typeof v === "string").slice(0, 5000) : [])
  const { classes, ids, hrefs } = found as Record<string, unknown>
  const ask = { ...f.at, classes: list(classes), ids: list(ids), hrefs: list(hrefs), getBaseRules: false, getInjectionRules: false,
    getRulesFromHostname: false, getRulesFromDOM: true, getExtendedRules: false }
  return { shields: f.up && only !== "user" ? engine!.getCosmeticsFilters(ask).styles : "", user: apart(f.user?.getCosmeticsFilters(ask).styles ?? "") }
})

// ---------- the app asks ----------

handle("adblock:settings", (win, x) => {
  const s = (x && typeof x === "object" ? x : {}) as { on?: unknown; down?: unknown }
  const down = Array.isArray(s.down) ? s.down.filter((v): v is string => typeof v === "string").map((v) => v.trim().toLowerCase()) : []
  const c = told(win)
  c.on = s.on !== false
  c.down = new Set(down)
})
/** The user's hiding rules (the blocked elements list's, and the parts of sites hidden with one click): the window's
 *  pages show the change at once, without reloading. */
handle("adblock:rules", (win, rules) => {
  const text = (Array.isArray(rules) ? rules : []).filter((r): r is string => typeof r === "string" && r.length <= 2000 && !/[\n\r]/.test(r))
    .slice(0, 10_000).join("\n")
  const c = told(win)
  if (c.rules === text) return
  c.rules = text
  parseUser(c)
  for (const p of pages.values()) if (p.win === win) restyle(p, c)
})

/** A page's frames told their user rules again. (Rules a stylesheet can't say apply as the page next changes.) */
function restyle(p: EnginePage, c: Choice) {
  if (p.wc.isDestroyed() || !lib) return
  for (const fr of p.wc.mainFrame.framesInSubtree) {
    try {
      if (!/^https?:/i.test(fr.url)) continue
      const r = lib.Request.fromRawDetails({ url: fr.url })
      const m = mine(c.user, { url: fr.url, hostname: r.hostname, domain: r.domain })
      fr.send("vaultite:adblock:user", { ...m, lib: m.extended.length ? selectorsLib() : "" })
    } catch { /* a frame going away */ }
  }
}
/** A page of this window: its site, how many requests were blocked on it, and whether Shields are up there. */
handle("adblock:page", async (win, id) => {
  await engineLoaded()
  const p = [...pages.values()].find((x) => x.id === id && x.win === win)
  if (!p || p.wc.isDestroyed()) return null
  const url = p.wc.getURL(), c = choiceOf(win)
  return { site: siteOf(url), count: counts.get(p.wc.id) ?? 0, on: c.on, up: c.on && !c.down.has(siteOf(url)), ready: !!engine }
})

// ---------- the engine: kept, and rebuilt from the lists in a worker ----------

let building = false
function build() {
  if (building) return
  building = true
  const w = new Worker(new URL("./adblock-lists.ts", import.meta.url), { workerData: { local: LOCAL_LISTS } })
  let ok = false
  w.once("message", (bytes: Uint8Array) => {
    ok = true
    try {
      engine = lib!.ElectronBlocker.deserialize(bytes)
      if (!LOCAL_LISTS) keep(bytes)
    } catch (e) { console.error("vaultite: Shields couldn't load the new lists:", e) }
  })
  w.once("error", (e) => console.error("vaultite: Shields couldn't update their lists:", e))
  w.once("exit", () => {
    building = false
    // (offline, a list's server down: tried again in an hour, the engine had kept on)
    if (!ok) setTimeout(build, 3600_000).unref()
  })
}

function keep(bytes: Uint8Array) {
  const to = file(), tmp = `${to}.tmp`
  fs.promises.mkdir(path.dirname(to), { recursive: true })
    .then(() => fs.promises.writeFile(tmp, bytes)).then(() => fs.promises.rename(tmp, to))
    .catch((e) => console.error("vaultite: Shields couldn't keep their lists:", e))
}

/** The kept engine in (a page's first requests wait for it), and the lists rebuilt when they're a day old. */
async function start() {
  await app.whenReady()
  lib = await import("@ghostery/adblocker-electron")
  for (const c of new Set([lastChoice, ...choices.values()])) parseUser(c)
  if (LOCAL_LISTS) return build()
  let age = Infinity
  try {
    const [bytes, st] = await Promise.all([fs.promises.readFile(file()), fs.promises.stat(file())])
    engine = lib.ElectronBlocker.deserialize(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength))
    age = Date.now() - st.mtimeMs
  } catch { /* none yet, or from another version of the engine: built afresh */ }
  if (age > DAY) build()
  // (checked every few hours: a Mac asleep through the day's timer catches up when it wakes)
  setInterval(() => {
    fs.promises.stat(file()).then((st) => Date.now() - st.mtimeMs > DAY, () => true).then((old) => { if (old) build() })
  }, 3 * 3600_000).unref()
}
later(start)
