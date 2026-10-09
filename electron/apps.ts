/** App windows (plugins/core/app-windows): another Mac app's window kept right behind a see-through tab, moved by
 *  electron/appwindows.swift (the Accessibility API, as AeroSpace does); given back when its tab, window or app closes. */
import { app, BrowserWindow, globalShortcut, screen } from "electron"
import { execFile, spawn, type ChildProcess } from "node:child_process"
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const SOURCE = path.join(path.dirname(fileURLToPath(import.meta.url)), "appwindows.swift")
type Rect = { x: number; y: number; width: number; height: number }

let helper: ChildProcess | null = null
let starting: Promise<ChildProcess> | null = null
let next = 1
const waiting = new Map<number, (res: Record<string, unknown>) => void>()
/** Each app window in a tab (by its number): its app, vault window, rect (null: tab hidden), whether it's raised behind
 *  it (only while that window is focused), and `at`, where it stands (the tab's rect and its own frame; null: parked). */
type Shown = { bundle: string; win: BrowserWindow; rect: Rect | null; behind: boolean; at: { rect: Rect; frame: Rect } | null }
const shown = new Map<number, Shown>()
/** While an app tab is shown, the palette from anywhere (the app in front has the keyboard, so the window's keys don't
 *  work); taken from other apps only then. */
const PALETTE = "Control+Command+P"
function hotkey() {
  const want = [...shown.values()].some((s) => s.rect && !s.win.isDestroyed())
  if (want === globalShortcut.isRegistered(PALETTE)) return
  if (!want) return globalShortcut.unregister(PALETTE)
  globalShortcut.register(PALETTE, () => {
    const focused = BrowserWindow.getFocusedWindow()
    const win = focused && [...shown.values()].some((s) => s.win === focused) ? focused : [...shown.values()].find((s) => s.rect)?.win
    if (!win || win.isDestroyed()) return
    app.focus({ steal: true })
    win.show()
    win.focus()
    win.webContents.send("vaultite", { type: "command", id: "palette:open" })
  })
}
/** The windows letting the pointer through to an app (`apps:through`). The page only hears the pointer leave a hole
 *  while it's forwarded, which an inactive app doesn't always get: so the cursor is watched here too, and it's ended. */
const through = new Map<BrowserWindow, boolean>()
let watching: ReturnType<typeof setInterval> | null = null
/** A window's app windows on screen behind it (their tabs' rects on the screen). */
const holesOf = (win: BrowserWindow) => [...shown.values()].filter((s) => s.win === win && s.behind && s.rect).map((s) => onScreen(win, s.rect!).rect)
function setThrough(win: BrowserWindow, on: boolean, tell = false) {
  if (win.isDestroyed()) through.delete(win)
  else {
    if (tell && !on) win.webContents.send("vaultite:apps", { type: "through", on: false })
    if ((through.get(win) ?? false) !== on) { through.set(win, on); win.setIgnoreMouseEvents(on, { forward: true }) }
  }
  const any = [...through.values()].some(Boolean)
  if (any && !watching) watching = setInterval(() => {
    const p = screen.getCursorScreenPoint()
    for (const [w, v] of [...through]) {
      if (v && !holesOf(w).some((r) => p.x >= r.x && p.x < r.x + r.width && p.y >= r.y && p.y < r.y + r.height)) setThrough(w, false, true)
    }
  }, 50)
  else if (!any && watching) { clearInterval(watching); watching = null }
}

/** The helper's binary, compiled from its source the first time (and after it changes). */
async function binary() {
  const src = fs.readFileSync(SOURCE)
  const out = path.join(app.getPath("userData"), "bin", `appwindows-${crypto.createHash("sha1").update(src).digest("hex").slice(0, 12)}`)
  if (fs.existsSync(out)) return out
  fs.mkdirSync(path.dirname(out), { recursive: true })
  // (built beside it, then moved in: a build cut off midway never leaves a binary that's reused)
  const tmp = `${out}.${process.pid}.tmp`
  await new Promise<void>((ok, fail) => execFile("/usr/bin/swiftc", ["-O", SOURCE, "-o", tmp], (e, _o, err) =>
    e ? fail(new Error(`Couldn't build the app windows helper (it needs Xcode's Command Line Tools): ${err || e.message}`)) : ok()))
    .catch((e) => { fs.rmSync(tmp, { force: true }); throw e })
  fs.renameSync(tmp, out)
  return out
}

function start() {
  if (helper && !helper.killed && helper.exitCode === null) return Promise.resolve(helper)
  starting ??= binary().then((bin) => {
    const child = spawn(bin, [], { stdio: ["pipe", "pipe", "inherit"] })
    let buf = ""
    child.stdout!.on("data", (b: Buffer) => {
      buf += b.toString()
      for (let i; (i = buf.indexOf("\n")) >= 0;) {
        const line = buf.slice(0, i)
        buf = buf.slice(i + 1)
        let msg: Record<string, unknown>
        try { msg = JSON.parse(line) } catch { continue }
        if (typeof msg.id === "number") { waiting.get(msg.id)?.(msg); waiting.delete(msg.id) }
        else if (typeof msg.event === "string") heard(msg)
      }
    })
    // (one that couldn't start or whose pipe broke ends as one that exited: its callers answered, the next call starts another)
    child.on("error", () => { if (child.exitCode === null && !child.killed) child.kill(); child.emit("exit") })
    child.stdin!.on("error", () => {})
    child.once("exit", () => {
      if (helper !== child) return
      helper = null
      for (const done of waiting.values()) done({ ok: false, why: "helper" })
      waiting.clear()
      for (const w of [...shown.keys()]) gone(w)
    })
    helper = child
    return child
  }).finally(() => { starting = null })
  return starting
}

const ASK_TIMEOUT = 30_000
async function ask(req: Record<string, unknown>): Promise<Record<string, unknown>> {
  const child = await start()
  const id = next++
  return new Promise((done) => {
    // (an app that doesn't answer the helper holds it: the call gives up rather than wait forever; adopt can take 15 s)
    const timer = setTimeout(() => { if (waiting.delete(id)) done({ ok: false, why: "helper" }) }, ASK_TIMEOUT)
    waiting.set(id, (msg) => { clearTimeout(timer); done(msg) })
    child.stdin!.write(JSON.stringify({ ...req, id }) + "\n")
  })
}

/** An app window closed (or its app quit): its tab says so. */
function gone(wid: number) {
  const s = shown.get(wid)
  shown.delete(wid)
  hotkey()
  if (s && !s.win.isDestroyed()) s.win.webContents.send("vaultite:apps", { type: "gone", wid })
}

/** The helper's news: a window gone or retitled (told its tab's window), or a new one from an app in a tab (told the
 *  window showing that app, the focused one first, which may open it in a tab). */
function heard(m: Record<string, unknown>) {
  const wid = Number(m.wid)
  if (m.event === "gone") return gone(wid)
  const s = shown.get(wid)
  if (m.event === "title" && s && !s.win.isDestroyed()) s.win.webContents.send("vaultite:apps", { type: "title", wid, title: String(m.title ?? "") })
  if (m.event === "here" && s && !s.win.isDestroyed()) s.win.webContents.send("vaultite:apps", { type: "here", wid, here: m.here === true })
  // (its app came in front with it, a link opened in it say, while its tab is hidden: the tab's shown; one held by no tab
  // yet, told every window, whichever has its tab)
  if (m.event === "front" && s && !s.rect && !s.win.isDestroyed() && !s.win.isMinimized()) s.win.webContents.send("vaultite:apps", { type: "front", wid })
  if (m.event === "front" && !s) for (const w of BrowserWindow.getAllWindows()) if (hosts.has(w) && !w.isMinimized()) w.webContents.send("vaultite:apps", { type: "front", wid })
  if (m.event === "window" && !shown.has(wid)) {
    const wins = [...shown.values()].filter((x) => x.bundle === m.bundle && !x.win.isDestroyed()).map((x) => x.win)
    const to = wins.find((w) => w.isFocused()) ?? wins[0]
    to?.webContents.send("vaultite:apps", { type: "window", bundle: String(m.bundle), wid, title: String(m.title ?? "") })
  }
}

/** The page's rect as the screen's: the window's content plus the rect, zoomed as the page is. */
function onScreen(win: BrowserWindow, r: Rect) {
  const c = win.getContentBounds(), z = win.webContents.getZoomFactor()
  return { rect: { x: c.x + r.x * z, y: c.y + r.y * z, width: r.width * z, height: r.height * z }, bound: c }
}

const meets = (a: Rect, b: Rect) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
/** Where a window stands on screen now (it moves with its vault window). */
function standing(s: Shown) {
  const c = s.win.getContentBounds(), f = s.at!.frame
  return { r: { x: c.x + f.x, y: c.y + f.y, width: f.width, height: f.height }, c }
}
/** Whether a window whose tab is hidden can stay where it stands: all of it behind its vault window (which grew no
 *  smaller), none of it behind a tab showing another app (its window may not cover the tab all over). */
function hiddenFits(wid: number, s: Shown) {
  if (!s.at || s.win.isDestroyed()) return false
  const { r, c } = standing(s)
  if (r.x < c.x - 0.5 || r.y < c.y - 0.5 || r.x + r.width > c.x + c.width + 0.5 || r.y + r.height > c.y + c.height + 0.5) return false
  return ![...shown].some(([id, o]) => id !== wid && o.rect && o.behind && !o.win.isDestroyed() && meets(r, onScreen(o.win, o.rect).rect))
}
/** Out of sight: the windows standing where a tab is about to show another app (their tabs hidden, or being hidden: in
 *  one pane, the tab shown may say so before the one leaving does). */
function clear(wid: number, to: Rect) {
  const out: Promise<unknown>[] = []
  for (const [id, s] of shown) if (id !== wid && s.at && !s.win.isDestroyed() && meets(standing(s).r, to)) { s.at = null; out.push(ask({ op: "park", wid: id })) }
  return Promise.all(out)
}

/** A window put over its tab; its tab hidden, left standing (moved along with the vault window) if nothing shows it, as
 *  coming back to it then moves nothing; else, or out of sight, parked. */
async function put(wid: number, win: BrowserWindow, r: Rect | null) {
  const s = shown.get(wid)
  if (!s || win.isMinimized() || !win.isVisible() || !s.behind) { if (s) s.at = null; return ask({ op: "park", wid }) }
  const to = r ?? (hiddenFits(wid, s) ? s.at!.rect : null)
  if (!to) { s.at = null; return ask({ op: "park", wid }) }
  const at = onScreen(win, to)
  if (r) await clear(wid, at.rect)
  const res = await ask({ op: "place", wid, ...at })
  const f = rectOf(res.frame)
  if (res.ok && f && shown.get(wid) === s) s.at = { rect: to, frame: { ...f, x: f.x - at.bound.x, y: f.y - at.bound.y } }
  return res
}

/** Every app window a vault window shows, put again (it moved, came back) or parked (minimized). */
function follow(win: BrowserWindow) {
  for (const [wid, s] of shown) if (s.win === win) void put(wid, win, s.rect)
}

function rectOf(x: unknown): Rect | null {
  const r = x as Rect | null
  return r && [r.x, r.y, r.width, r.height].every((n) => typeof n === "number" && Number.isFinite(n)) && r.width >= 2 && r.height >= 2 ? r : null
}
const isBundle = (x: unknown): x is string => typeof x === "string" && /^[\w.-]+$/.test(x)
const bundleOf = (x: unknown) => { if (!isBundle(x)) throw new Error("expected a bundle id"); return x }
const widOf = (x: unknown) => (Number.isInteger(x) && (x as number) > 0 ? x as number : 0)
/** Stop showing a window in `win`'s tab: no-op if it isn't one of its. */
function drop(win: BrowserWindow, wid: unknown) {
  const id = widOf(wid)
  if (!id || shown.get(id)?.win !== win) return 0
  shown.delete(id)
  hotkey()
  return id
}

export const appHandlers: Record<string, (win: BrowserWindow, ...args: unknown[]) => unknown> = {
  "apps:list": () => ask({ op: "apps" }),
  "apps:trusted": (_win, prompt) => ask({ op: "trusted", prompt: !!prompt }),
  // `wid`: the window the tab had (0: any of the app's not in a tab); it answers the one it shows.
  "apps:show": async (win, bundle, wid, rect) => {
    const b = bundleOf(bundle), want = widOf(wid), r = rectOf(rect)
    if (!hosts.has(win)) return { ok: false, why: "reopen" }
    let id = shown.get(want)?.bundle === b ? want : 0
    const had = id ? shown.get(id) : undefined
    if (!r && had?.win !== win) return { ok: true, wid: want } // (parking one it doesn't show)
    let title: unknown
    if (!had) {
      const res = await ask({ op: "adopt", bundle: b, wid: want, launch: true })
      if (!res.ok) return res
      id = Number(res.wid)
      title = res.title
    }
    // (raised behind it now only if that can't cover anything: the window is focused, or the app is in front anyway)
    const behind = (had?.win === win && had.behind) || (!!r && (win.isFocused() || (await ask({ op: "front" })).bundle === b))
    shown.set(id, { bundle: b, win, rect: r, behind, at: had?.win === win ? had.at : null })
    hotkey()
    const res = await put(id, win, r)
    if (behind && !had?.behind) void ask({ op: "raise", wid: id })
    return { ...res, wid: id, ...(typeof title === "string" ? { title } : {}) }
  },
  // (a link in the app: the window it's in, which the tab asking for it then shows)
  "apps:open": (_win, bundle, url) => {
    if (typeof url !== "string" || !/^https?:\/\//i.test(url)) throw new Error("expected a web address")
    return ask({ op: "open", bundle: bundleOf(bundle), url })
  },
  "apps:release": async (win, wid, keep) => {
    const id = drop(win, wid)
    if (id) await ask({ op: "release", wid: id, keep: !!keep })
  },
  "apps:close": async (win, wid) => {
    const id = drop(win, wid)
    return id ? ask({ op: "close", wid: id }) : { ok: false }
  },
  // (a bundle id that isn't one, PrusaSlicer's "com.prusa3d.slic3r/", is left out, not the whole list refused)
  "apps:icons": (_win, bundles) => ask({ op: "icons", bundles: (Array.isArray(bundles) ? bundles : []).filter(isBundle) }),
  "apps:focus": (win, wid, go, bundle) => {
    // (not before it's behind the window: the app would come forward with its window parked; `go`: to its desktop)
    const id = widOf(wid), s = shown.get(id)
    if (go && (s?.win === win || !s)) return ask({ op: "focus", wid: id, bundle: s?.bundle ?? (typeof bundle === "string" ? bundleOf(bundle) : ""), go: true })
    return s?.win === win && s.behind && s.rect ? ask({ op: "focus", wid: id }) : undefined
  },
  // (refused while no app window is behind a hole: a click there then focuses the window, which puts it there)
  "apps:through": (win, on) => setThrough(win, !!on && holesOf(win).length > 0, !!on),
}

/** Whether the vault has App windows on (off by default: in plugins.json's `enabled`), read as its window opens. */
export function appsOn(vault: string) {
  try {
    const c = JSON.parse(fs.readFileSync(path.join(vault, ".vaultite", "plugins.json"), "utf8"))
    return Array.isArray(c.enabled) && c.enabled.includes("app-windows") && !(Array.isArray(c.disabled) && c.disabled.includes("app-windows"))
  } catch { return false }
}
/** The windows made for app tabs (transparent); another shows none until it's opened again. */
const hosts = new WeakSet<BrowserWindow>()

/** A vault window's app tabs follow it (see the head of this file). */
export function appsWindow(win: BrowserWindow) {
  hosts.add(win)
  const releaseAll = () => {
    for (const [id, s] of [...shown]) if (s.win === win) { shown.delete(id); void ask({ op: "release", wid: id, keep: true }) }
    hotkey()
    setThrough(win, false)
  }
  for (const e of ["move", "resize", "minimize", "restore", "show", "hide"] as const) win.on(e as "move", () => follow(win))
  // In front again: its apps' windows come right behind it (another app's may have come between), those whose tabs are
  // hidden too, so showing one again has it there.
  win.on("focus", () => {
    for (const [id, s] of shown) {
      if (s.win !== win || !(s.rect || s.at)) continue
      const first = !s.behind
      s.behind = true
      void (first ? put(id, win, s.rect) : Promise.resolve()).then(() => ask({ op: "raise", wid: id })).then(() => { if (!win.isDestroyed()) win.moveTop() })
    }
  })
  win.on("closed", () => { releaseAll(); through.delete(win) })
  win.webContents.on("did-start-navigation", (d) => { if (d.isMainFrame && !d.isSameDocument) releaseAll() })
}

/** The app quits: every window back where it was (the helper does it as its stdin ends). */
export function stopApps() {
  globalShortcut.unregister(PALETTE)
  helper?.stdin?.end()
}
