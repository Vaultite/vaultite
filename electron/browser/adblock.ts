// Shields: ads and trackers blocked in every web session (Ghostery's engine, uBlock Origin's lists).
import { app, ipcMain, webContents, type IpcMainEvent, type IpcMainInvokeEvent, type Session } from "electron"
import type { ElectronBlocker } from "@ghostery/adblocker-electron"
import fs from "node:fs"
import path from "node:path"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import { Worker } from "node:worker_threads"
import { FOUND, SHIELDS } from "./pagewire.ts"
import { eachPage, eachSession, engineLoaded, handle, later, onRequest, tell, type EnginePage, type EngineWindow, type RequestDetails, logger } from "./engine.ts"

const log = logger("shields")

const PRELOAD = fileURLToPath(new URL("./adblock-preload.cjs", import.meta.url))
const DAY = 24 * 3600_000
const LOCAL_LISTS = process.env.VAULTITE_ADBLOCK_LISTS || ""

type Ghostery = typeof import("@ghostery/adblocker-electron")
let lib: Ghostery | null = null
let engine: ElectronBlocker | null = null
const file = () => path.join(app.getPath("userData"), "adblock", "engine-2.bin")

type Choice = { on: boolean; down: Set<string>; rules: string; user: ElectronBlocker | null }
const choices = new Map<number, Choice>()
let lastChoice: Choice = { on: true, down: new Set(), rules: "", user: null }
const choiceOf = (win?: EngineWindow | null) => (win && choices.get(win.id)) || lastChoice
function told(win: EngineWindow) {
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

const sites = new Map<string, string>()
function siteOf(url: string) {
  if (!/^https?:/i.test(url) || !lib) return ""
  let site = sites.get(url)
  if (site === undefined) {
    const r = lib.Request.fromRawDetails({ url })
    site = r.domain || r.hostname
    if (sites.size >= 200) sites.clear()
    sites.set(url, site)
  }
  return site
}
const upFor = (c: Choice, top: string) => c.on && !!engine && !c.down.has(siteOf(top))

const pages = new Map<number, EnginePage>()
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

function tellCount(p: EnginePage) {
  const wcId = p.wc.id
  if (telling.has(wcId)) return
  telling.set(wcId, setTimeout(() => {
    telling.delete(wcId)
    tell(p.win, { type: "engine:adblock:count", id: p.id, count: counts.get(wcId) ?? 0 })
  }, 250))
}

function originOf(d: RequestDetails) {
  const page = d.webContentsId ? pages.get(d.webContentsId) : undefined
  const wc = page?.wc ?? (d.webContentsId ? webContents.fromId(d.webContentsId) : undefined)
  return { page, top: wc && !wc.isDestroyed() ? wc.getURL() : d.referrer }
}
function sourceOf(d: RequestDetails, top: string) {
  let frame = ""
  try { frame = (d.resourceType === "subFrame" ? d.frame?.parent?.url : d.frame?.url) ?? "" } catch {}
  return /^https?:/i.test(frame) ? frame : top || d.referrer
}

function requestOf(d: RequestDetails, source: string) {
  const r = lib!.Request.fromRawDetails({ requestId: `${d.id}`, url: d.url, type: d.resourceType || "other", sourceUrl: source, tabId: d.webContentsId ?? 0 })
  if (r.type === "other") r.guessTypeOfRequest()
  return r
}

function beforeRequest(d: RequestDetails) {
  const e = engine
  if (!e || d.resourceType === "mainFrame" || !/^(https?|wss?):/i.test(d.url)) return
  const o = originOf(d)
  if (!upFor(choiceOf(o.page?.win), o.top)) return
  const { match, redirect } = e.match(requestOf(d, sourceOf(d, o.top)))
  if (!match && !redirect) return
  if (o.page) {
    const wcId = o.page.wc.id
    counts.set(wcId, (counts.get(wcId) ?? 0) + 1)
    tellCount(o.page)
  }
  return redirect ? { redirectURL: redirect.dataUrl } : { cancel: true }
}

function headersReceived(d: RequestDetails) {
  const e = engine
  if (!e || (d.resourceType !== "mainFrame" && d.resourceType !== "subFrame")) return
  const o = originOf(d)
  const top = d.resourceType === "mainFrame" ? d.url : o.top
  if (!upFor(choiceOf(o.page?.win), top)) return
  const csp = e.getCSPDirectives(requestOf(d, d.resourceType === "mainFrame" ? d.url : sourceOf(d, o.top)))
  if (!csp) return
  const headers = { ...d.responseHeaders }
  const policies = csp.split(";").map((x) => x.trim())
  for (const name of Object.keys(headers)) if (name.toLowerCase() === "content-security-policy") { policies.push(...headers[name]); delete headers[name] }
  return { responseHeaders: { ...headers, "Content-Security-Policy": [policies.join(";")] } }
}

onRequest("onBeforeRequest", beforeRequest)
onRequest("onHeadersReceived", headersReceived, undefined, ["mainFrame", "subFrame"])
const sessions = new Set<Session>()
eachSession((s) => {
  sessions.add(s)
  s.registerPreloadScript({ type: "frame", filePath: PRELOAD })
})

function frameOf(e: IpcMainEvent | IpcMainInvokeEvent, url: unknown) {
  if (typeof url !== "string" || !/^https?:/i.test(url) || !sessions.has(e.sender.session) || !lib) return null
  let top = url
  try { if (e.senderFrame?.parent) top = e.senderFrame.top?.url ?? "" } catch { return null }
  const c = choiceOf(pages.get(e.sender.id)?.win)
  const r = lib.Request.fromRawDetails({ url })
  return { at: { url, hostname: r.hostname, domain: r.domain }, up: upFor(c, top), user: c.user }
}
type At = NonNullable<ReturnType<typeof frameOf>>["at"]

function mine(user: ElectronBlocker | null, at: At) {
  const r = user?.getCosmeticsFilters({ ...at, getBaseRules: true, getInjectionRules: false, getRulesFromHostname: true, getRulesFromDOM: false, getExtendedRules: true })
  return { styles: apart(r?.styles ?? ""), extended: r?.extended ?? [] }
}
const apart = (css: string) => css.split(/\n\n+/).map((block) => {
  const m = /^([\s\S]*?)\s*\{([\s\S]*)\}\s*$/.exec(block.trim())
  return m ? m[1].split(",\n").map((sel) => `${sel.trim()} {${m[2]}}`).join("\n") : block
}).join("\n")

let selectors = ""
const selectorsLib = () => (selectors ||= fs.readFileSync(path.join(path.dirname(createRequire(import.meta.url).resolve("@ghostery/adblocker-extended-selectors")),
  "../adblocker.umd.min.js"), "utf8"))

// Sync: a frame's preload needs them before the page's own first script runs.
ipcMain.on("vaultite:adblock:frame", (e, url) => {
  const f = frameOf(e, url)
  const r = f?.up ? engine!.getCosmeticsFilters({ ...f.at, getBaseRules: true, getInjectionRules: true, getRulesFromHostname: true,
    getRulesFromDOM: false, getExtendedRules: true }) : null
  const shields = r && r.active !== false ? { styles: r.styles, scripts: r.scripts, extended: r.extended } : null
  const user = f?.user ? mine(f.user, f.at) : null
  e.returnValue = shields || user ? { shields, user, watch: engine?.config.enableMutationObserver !== false,
    lib: shields?.extended.length || user?.extended.length ? selectorsLib() : "" } : null
})
ipcMain.handle("vaultite:adblock:dom", (e, url, found, only) => {
  const f = frameOf(e, url), given = FOUND.safeParse(found)
  if (!f || !given.success) return null
  const ask = { ...f.at, ...given.data, getBaseRules: false, getInjectionRules: false,
    getRulesFromHostname: false, getRulesFromDOM: true, getExtendedRules: false }
  return { shields: f.up && only !== "user" ? engine!.getCosmeticsFilters(ask).styles : "", user: apart(f.user?.getCosmeticsFilters(ask).styles ?? "") }
})

handle("adblock:settings", (win, x) => {
  const s = SHIELDS.parse(x), c = told(win)
  c.on = s.on !== false
  c.down = new Set(s.down)
})
handle("adblock:rules", (win, rules) => {
  const text = (Array.isArray(rules) ? rules : []).filter((r): r is string => typeof r === "string" && r.length <= 2000 && !/[\n\r]/.test(r))
    .slice(0, 10_000).join("\n")
  const c = told(win)
  if (c.rules === text) return
  c.rules = text
  parseUser(c)
  for (const p of pages.values()) if (p.win === win) restyle(p, c)
})

function restyle(p: EnginePage, c: Choice) {
  if (p.wc.isDestroyed() || !lib) return
  for (const fr of p.wc.mainFrame.framesInSubtree) {
    try {
      if (!/^https?:/i.test(fr.url)) continue
      const r = lib.Request.fromRawDetails({ url: fr.url })
      const m = mine(c.user, { url: fr.url, hostname: r.hostname, domain: r.domain })
      fr.send("vaultite:adblock:user", { ...m, lib: m.extended.length ? selectorsLib() : "" })
    } catch {}
  }
}
handle("adblock:page", async (win, id) => {
  await engineLoaded()
  const p = [...pages.values()].find((x) => x.id === id && x.win === win)
  if (!p || p.wc.isDestroyed()) return null
  const url = p.wc.getURL(), c = choiceOf(win)
  return { site: siteOf(url), count: counts.get(p.wc.id) ?? 0, on: c.on, up: c.on && !c.down.has(siteOf(url)), ready: !!engine }
})

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
    } catch (e) { log.error("Shields couldn't load the new lists", e) }
  })
  w.once("error", (e) => log.error("Shields couldn't update their lists", e))
  w.once("exit", () => {
    building = false
    if (!ok) setTimeout(build, 3600_000).unref()
  })
}

function keep(bytes: Uint8Array) {
  const to = file(), tmp = `${to}.tmp`
  fs.promises.mkdir(path.dirname(to), { recursive: true })
    .then(() => fs.promises.writeFile(tmp, bytes)).then(() => fs.promises.rename(tmp, to))
    .catch((e) => log.error("Shields couldn't keep their lists", e))
}

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
  } catch {}
  if (age > DAY) build()
  setInterval(() => {
    fs.promises.stat(file()).then((st) => Date.now() - st.mtimeMs > DAY, () => true).then((old) => { if (old) build() })
  }, 3 * 3600_000).unref()
}
later(start)
