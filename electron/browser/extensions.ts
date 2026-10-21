// Chrome extensions in web pages: each installed one (extstore.ts) loaded into every web session, the APIs Electron
// lacks from extapi.ts, popups over the page. The app asks `ext:*`; it's told engine:ext:changed, :open, :show, :close.
import { app, BrowserWindow, dialog, session, WebContentsView, type Session } from "electron"
import { allPages, eachPage, eachSession, handle, opens, tell, type EnginePage } from "./engine.ts"
import { actionsChanged, buttonOf, closeNatives, closeOffscreen, emit, expect, forgetActions, popupOf, popups, setFront, tabMade, unlisten, setSessions, watchCookies, watchPage, watchWindow,
  watchWorkers } from "./extapi.ts"
import * as store from "./extstore.ts"
import { applyPolicy, problems, watchPolicy } from "./extpolicy.ts"
import { read as readSettings, write as writeSettings } from "./extsettings.ts"
import { partitionOf } from "../web.ts"
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const PRELOAD = path.join(path.dirname(fileURLToPath(import.meta.url)), "extensions.preload.cjs")
const sessions = new Map<Session, string>()
setSessions(sessions)
/** Each session's extensions loading, settled once they're in (a page made before reloads then: see eachPage). */
const ready = new WeakMap<Session, { done: boolean; promise: Promise<unknown> }>()
const started = new Set<string>()
/** What couldn't be loaded, by id: said in the Extensions view. */
const failed = new Map<string, string>()
/** This Mac's policy being applied (extpolicy.ts), and whether it was yet this run. */
let policy: Promise<void> | null = null, enforced = false

async function loadInto(s: Session, x: store.Installed) {
  try {
    if (s.extensions.getExtension(x.id)) s.extensions.removeExtension(x.id)
    const life = store.lifecycle(sessions.get(s) ?? "", x)
    // (onStartup once a run: not again when it's turned off and on)
    if (life !== "startup") expect(s, x.id, "runtime.onInstalled", [life])
    else if (!started.has(`${sessions.get(s)} ${x.id}`)) expect(s, x.id, "runtime.onStartup", [])
    started.add(`${sessions.get(s)} ${x.id}`)
    await s.extensions.loadExtension(store.dirOf(x))
    failed.delete(x.id)
  } catch (e) {
    failed.set(x.id, (e as Error).message)
    console.error(`vaultite: couldn't load the extension ${x.name}:`, e)
  }
}
function unloadFrom(s: Session, id: string) {
  if (s.extensions.getExtension(id)) s.extensions.removeExtension(id)
  unlisten(s, id)
  closeNatives(s, id)
  closeOffscreen(s, id)
}

/** A session's extensions in, once: from eachSession, or earlier at launch for the sessions that had them before. */
function setUp(s: Session, profile: string) {
  if (ready.has(s)) return
  firstPolicy()
  sessions.set(s, profile)
  s.registerPreloadScript({ id: "vaultite-extensions-frame", type: "frame", filePath: PRELOAD })
  s.registerPreloadScript({ id: "vaultite-extensions-worker", type: "service-worker", filePath: PRELOAD })
  watchWorkers(s)
  watchCookies(s)
  const r = { done: false, promise: Promise.resolve() as Promise<unknown> }
  ready.set(s, r)
  r.promise = Promise.all(store.installed().filter((x) => x.on).map((x) => loadInto(s, x))).finally(() => { r.done = true })
}

eachSession((s, profile) => {
  setUp(s, profile)
  // (its partition, so the next launch loads its extensions before the window restores its pages)
  if (s.isPersistent() && s.storagePath) store.partitionSeen(profile, `persist:${path.basename(s.storagePath)}`)
})
void app.whenReady().then(() => {
  firstPolicy()
  if (!store.installed().some((x) => x.on)) return
  for (const [profile, partition] of Object.entries(store.load().partitions)) setUp(session.fromPartition(partition), profile)
})

eachPage((p) => {
  watchPage(p)
  watchWindow(p.win)
  tabMade(p)
  // Made while its session's extensions were still loading (a session new since launch): its content scripts missed
  // it, and an extension's own page its APIs.
  const r = ready.get(p.wc.session)
  if (r && !r.done && store.installed().some((x) => x.on)) {
    void r.promise.then(() => { if (!p.wc.isDestroyed() && /^(https?|chrome-extension):/.test(p.wc.getURL())) p.wc.reload() })
  }
})

// The extensions' own pages (options, a help page they open) show in web tabs like any.
opens((u) => {
  const id = /^chrome-extension:\/\/([a-p]{32})\//.exec(u)?.[1]
  return !!id && !!store.get(id)?.on
})

const changed = () => {
  actionsChanged()
  for (const w of BrowserWindow.getAllWindows()) tell(w, { type: "engine:ext:changed" })
}

async function turn(x: store.Installed, on: boolean) {
  for (const s of sessions.keys()) {
    if (on) await loadInto(s, x)
    else unloadFrom(s, x.id)
  }
  if (!on) forgetActions(x.id)
}

/** This Mac's policy applied (one run at a time), what it installed or turned on loaded in every session. The first
 *  run starts at once: its folders are installed before the sessions load. */
function enforce() {
  const go = async () => { for (const x of await applyPolicy()) await turn(x, true); changed() }
  policy = (policy ? policy.then(go) : go()).catch((e) => console.error("vaultite: couldn't apply the managed extensions:", e))
  return policy
}
function firstPolicy() {
  if (enforced) return
  enforced = true
  void enforce()
  watchPolicy(() => void enforce())
}

/** An installed (or updated) extension in every session. */
async function added(x: store.Installed) {
  if (x.on) await turn(x, true)
  changed()
  return { id: x.id, name: x.name }
}

/** `x`'s settings as another browser's profile has them, in every session here (that profile is all of them) and the
 *  default one a first page makes: where it's loaded, it starts again with them. */
async function bringSettings(x: store.Installed, from: store.Source) {
  const dir = store.dirOf(x), settings = await readSettings(from, x.id, dir)
  const partitions = [partitionOf(""), ...Object.values(store.load().partitions)]
  const all = new Set([...sessions.keys(), ...partitions.map((p) => session.fromPartition(p))])
  for (const s of all) {
    const had = !!s.extensions.getExtension(x.id)
    if (had) unloadFrom(s, x.id)
    try { await writeSettings(s, x.id, dir, settings) } finally { if (had) await loadInto(s, x) }
  }
}
const sourceOf = (id: string, browser: unknown, profile: unknown) => {
  const src = store.sources(id).find((s) => s.browser === browser && s.profile === profile)
  if (!src) throw new Error(`${typeof browser === "string" ? browser : "that browser"} doesn't have its settings`)
  return src
}

/** A Web Store link or id → the id. */
function idOf(input: unknown) {
  const s = typeof input === "string" ? input.trim() : ""
  return /(?:^|[/=])([a-p]{32})(?:$|[/?#&])/.exec(s)?.[1] ?? ""
}

function listed() {
  return store.installed().map((x) => {
    const dir = store.dirOf(x), m = store.manifestOf(dir)
    return {
      id: x.id, name: x.name, version: x.version, on: x.on, pinned: x.pinned, from: x.from, managed: !!x.managed,
      description: store.said(dir, m.description).slice(0, 300), icon: store.imageOf(dir, m.icons, 48),
      options: !!(m.options_ui?.page ?? m.options_page), mv2: m.manifest_version === 2, error: failed.get(x.id) ?? "",
      settingsFrom: store.sources(x.id).map(({ browser, profile, name }) => ({ browser, profile, name })),
    }
  }).sort((a, b) => a.name.localeCompare(b.name))
}

const pageById = (win: BrowserWindow, id: unknown) => allPages().find((p) => p.id === Number(id) && p.win === win)
const known = (id: unknown) => { const x = typeof id === "string" ? store.get(id) : undefined; if (!x) throw new Error("no such extension"); return x }

handle("ext:list", () => listed())
/** What this Mac's policy names that couldn't be added. */
handle("ext:policy", () => ({ problems }))
/** The buttons a page's bar shows: the extensions that are on, as they are for that page. */
handle("ext:bar", (win, pageId) => {
  const p = pageById(win, pageId)
  if (!p) return []
  return store.installed().filter((x) => x.on).map((x) => buttonOf(x, p.wc.session, p.wc.id)).sort((a, b) => a.name.localeCompare(b.name))
})
handle("ext:install", async (_win, input) => {
  const id = idOf(input)
  if (!id) throw new Error("that isn't a Chrome Web Store link or an extension's id")
  return added(await store.fromStore(id))
})
/** A folder or a .crx file the user picks. */
handle("ext:add-file", async (win) => {
  const r = await dialog.showOpenDialog(win, { title: "Add an extension", buttonLabel: "Add", message: "An extension's folder, or a .crx file",
    properties: ["openFile", "openDirectory"], filters: [{ name: "Extensions", extensions: ["crx"] }] })
  const f = r.filePaths[0]
  if (r.canceled || !f) return null
  return added(fs.statSync(f).isDirectory() ? store.fromFolder(f) : store.fromCrx(fs.readFileSync(f), undefined, "folder"))
})
handle("ext:others", () => store.others().map(({ dir: _dir, ...x }) => x))
/** One of another browser's: from the Web Store when it still has it (so it updates), else that browser's copy; with
 *  its settings from that profile, before it first runs (so it starts as it is there, signed in). */
handle("ext:import", async (_win, id) => {
  const found = store.others().find((x) => x.id === id)
  if (!found) throw new Error("that browser doesn't have it any more")
  let x: store.Installed
  try { x = await store.fromStore(found.id) } catch (e) {
    if (!(e instanceof store.NotOffered)) console.error("vaultite: the Web Store didn't give an extension, copied instead:", e)
    x = store.fromFolder(found.dir)
  }
  const from = store.sources(x.id).find((s) => found.dir.startsWith(s.dir + path.sep))
  let settings = false
  if (from) {
    try { await bringSettings(x, from); settings = true } catch (e) { console.error(`vaultite: couldn't bring ${x.name}'s settings from ${found.browser}:`, e) }
  }
  return { ...await added(x), settings }
})
/** An installed one's settings replaced by another browser's profile's. */
handle("ext:settings-from", async (_win, id, browser, profile) => {
  const x = known(id), from = sourceOf(x.id, browser, profile)
  await bringSettings(x, from)
  changed()
  return { name: x.name, browser: from.browser }
})
handle("ext:on", async (_win, id, on) => {
  const x = store.change(known(id).id, { on: !!on })
  await turn(x, !!on)
  changed()
})
handle("ext:pin", (_win, id, pinned) => { store.change(known(id).id, { pinned: !!pinned }); changed() })
handle("ext:remove", (_win, id) => {
  const x = known(id)
  if (x.managed) throw new store.Managed()
  for (const s of sessions.keys()) unloadFrom(s, x.id)
  forgetActions(x.id)
  store.remove(x.id)
  failed.delete(x.id)
  changed()
})
handle("ext:options", (win, id) => {
  const x = known(id), m = store.manifestOf(store.dirOf(x)), page = m.options_ui?.page ?? m.options_page
  if (page) tell(win, { type: "engine:ext:open", url: new URL(page, `chrome-extension://${x.id}/`).href, active: true })
})
handle("ext:update", async () => {
  await enforce()
  const done = await store.update()
  for (const x of done) await added(x)
  return done.length
})
/** Its button clicked on a page: its popup under the button (`rect`, in the window's CSS pixels), or its onClicked. */
handle("ext:click", (win, pageId, id, rect) => {
  const p = pageById(win, pageId), x = known(id)
  if (!p || !x.on) return
  setFront(p)
  const url = popupOf(x, p.wc.session, p.wc.id)
  if (!url) { emit(p.wc.session, "action.onClicked", [tabOfPage(p)], x.id); return }
  togglePopup(p, x, url, rect as Rect)
})

const tabOfPage = (p: EnginePage) => ({ id: p.wc.id, windowId: p.win.id, url: p.wc.getURL(), title: p.wc.getTitle(), active: true, index: 0, pinned: false, highlighted: true, incognito: false })

// ---------- popups ----------

type Rect = { x: number; y: number; width: number; height: number }
type Popup = { view: WebContentsView; win: BrowserWindow; ext: string; page: EnginePage }
let popup: Popup | null = null
/** The last one closed (a click on its own button closes it first: it isn't opened again). */
let closed = { ext: "", at: 0 }

function closePopup() {
  const p = popup
  if (!p) return
  popup = null
  closed = { ext: p.ext, at: Date.now() }
  popups.delete(p.view.webContents.id)
  if (!p.win.isDestroyed()) { p.win.contentView.removeChildView(p.view); tell(p.win, { type: "engine:ext:popup", ext: p.ext, open: false }) }
  if (!p.view.webContents.isDestroyed()) p.view.webContents.close()
}

/** Tells a popup's size (its content's widest line, then its height at that width) whenever it changes. */
const sizer = (mark: string) => `(() => {
  const de = document.documentElement
  let last = ""
  const measure = () => {
    const was = de.style.width
    de.style.width = "max-content"
    const w = Math.ceil(de.getBoundingClientRect().width)
    de.style.width = was
    const h = Math.ceil(Math.max(de.scrollHeight, document.body ? document.body.scrollHeight : 0))
    const now = JSON.stringify([w, h])
    if (now !== last) { last = now; console.debug(${JSON.stringify(mark)} + now) }
  }
  const ro = new ResizeObserver(() => measure())
  ro.observe(de)
  if (document.body) ro.observe(document.body)
  measure()
  addEventListener("load", measure)
})()`

function togglePopup(page: EnginePage, x: store.Installed, url: string, at: Rect) {
  if (popup?.ext === x.id && popup.page === page) return closePopup()
  if (closed.ext === x.id && Date.now() - closed.at < 400) return
  closePopup()
  const win = page.win, z = win.webContents.getZoomFactor()
  const view = new WebContentsView({ webPreferences: { session: page.wc.session, sandbox: true, contextIsolation: true, nodeIntegration: false, nodeIntegrationInSubFrames: true } })
  const wc = view.webContents
  popup = { view, win, ext: x.id, page }
  popups.set(wc.id, page)
  view.setBackgroundColor("#ffffff")
  view.setBorderRadius(8)
  view.setVisible(false)
  win.contentView.addChildView(view)
  // Right-aligned under its button, as Chrome's; Chrome's limits (25 to 800 × 600), and the window's.
  const place = (w: number, h: number) => {
    const [ww, wh] = win.getContentSize()
    const width = Math.min(Math.max(25, w), 800, ww - 16), height = Math.min(Math.max(25, h), 600, wh - Math.round((at.y + at.height) * z) - 12)
    const right = Math.round((at.x + at.width) * z)
    view.setBounds({ x: Math.max(8, Math.min(right - width, ww - width - 8)), y: Math.round((at.y + at.height) * z) + 4, width, height })
  }
  // Its size is its content's, told as it changes (measured in a world of our own: Electron's preferred-size event
  // doesn't come for every view).
  const mark = `__vaultite_popup_size__${crypto.randomUUID()}:`
  view.setBounds({ x: 0, y: 0, width: 800, height: 600 })
  wc.on("dom-ready", () => void wc.executeJavaScriptInIsolatedWorld(1004, [{ code: sizer(mark) }]).catch(() => {}))
  wc.on("console-message", (e) => {
    if (!e.message.startsWith(mark) || popup?.view !== view) return
    const [w, h] = JSON.parse(e.message.slice(mark.length)) as [number, number]
    place(w, h)
    if (!view.getVisible()) { view.setVisible(true); wc.focus() }
  })
  // (one whose page never says: shown anyway, at a common size)
  setTimeout(() => { if (popup?.view === view && !view.getVisible()) { place(360, 400); view.setVisible(true); wc.focus() } }, 3000)
  wc.on("blur", () => { if (popup?.view === view) closePopup() })
  wc.on("destroyed", () => { if (popup?.view === view) closePopup() })
  wc.on("before-input-event", (e, i) => { if (i.type === "keyDown" && i.key === "Escape") { e.preventDefault(); closePopup() } })
  // Links out of it open in a tab, and it closes, as in Chrome.
  wc.setWindowOpenHandler(({ url: to }) => {
    if (/^(https?|chrome-extension):/.test(to)) tell(win, { type: "engine:ext:open", url: to, active: true, profile: sessions.get(page.wc.session) ?? "" })
    return { action: "deny" }
  })
  wc.on("will-navigate", (e) => {
    if (e.url.startsWith(`chrome-extension://${x.id}/`)) return
    e.preventDefault()
    if (/^https?:/.test(e.url)) tell(win, { type: "engine:ext:open", url: e.url, active: true, profile: sessions.get(page.wc.session) ?? "" })
  })
  const gone = () => { if (popup?.view === view) closePopup() }
  win.once("resize", gone)
  win.once("move", gone)
  tell(win, { type: "engine:ext:popup", ext: x.id, open: true })
  void wc.loadURL(url).catch(() => closePopup())
}

// ---------- updates: looked for about daily ----------

const DAY = 24 * 3600_000
async function updateNow() {
  await enforce()
  try {
    const done = await store.update()
    for (const x of done) await added(x)
  } catch (e) { console.error("vaultite: couldn't look for extensions' updates:", e) }
}
void app.whenReady().then(() => {
  const tick = () => { if (Date.now() - store.load().checked > DAY - 3600_000) void updateNow() }
  setTimeout(tick, 60_000).unref()
  setInterval(tick, 3 * 3600_000).unref()
})
