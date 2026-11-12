// App windows: another Mac app's window kept right behind a see-through tab (electron/appwindows.swift).
import { app, globalShortcut, screen } from "electron"
import { AppWindow } from "./appwindow.ts"
import { coverTranslucent } from "./translucency.ts"
import { takePointer } from "./quiet.ts"
import { lineHelper } from "./linehelper.ts"
import { appWindowsSwift } from "./swiftbuild.ts"
import fs from "node:fs"
import path from "node:path"

type Rect = { x: number; y: number; width: number; height: number }

type Shown = { bundle: string; win: AppWindow; rect: Rect | null; behind: boolean; at: { rect: Rect; frame: Rect } | null }
const shown = new Map<number, Shown>()
// The app in front has the keyboard, so the window's own keys don't work.
const PALETTE = "Control+Command+P"
function hotkey() {
  const want = [...shown.values()].some((s) => s.rect && !s.win.isDestroyed())
  if (want === globalShortcut.isRegistered(PALETTE)) return
  if (!want) return globalShortcut.unregister(PALETTE)
  globalShortcut.register(PALETTE, () => {
    const focused = AppWindow.getFocusedWindow()
    const win = focused && [...shown.values()].some((s) => s.win === focused) ? focused : [...shown.values()].find((s) => s.rect)?.win
    if (!win || win.isDestroyed()) return
    app.focus({ steal: true })
    win.show()
    win.focus()
    win.webContents.send("vaultite", { type: "command", id: "palette:open" })
  })
}
function changed() {
  hotkey()
  for (const w of AppWindow.getAllWindows()) if (hosts.has(w)) coverTranslucent(w, [...shown.values()].some((s) => s.win === w && !!s.rect))
}
// A page hears the pointer leave a hole only while it's forwarded, which an inactive app doesn't always get.
const through = new Map<AppWindow, boolean>()
let watching: ReturnType<typeof setInterval> | null = null
const holesOf = (win: AppWindow) => [...shown.values()].filter((s) => s.win === win && s.behind && s.rect).map((s) => onScreen(win, s.rect!).rect)
function setThrough(win: AppWindow, on: boolean, tell = false) {
  if (win.isDestroyed()) through.delete(win)
  else {
    if (tell && !on) win.webContents.send("vaultite:apps", { type: "through", on: false })
    if ((through.get(win) ?? false) !== on) { through.set(win, on); takePointer(win, !on) }
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

const helper = lineHelper({ binary: () => appWindowsSwift.binary(path.join(app.getPath("userData"), "bin")), stderr: "inherit", event: heard,
  // (an app that doesn't answer the Accessibility API holds the helper; adopt can take 15 s)
  timeout: { ms: 30_000, why: "helper" },
  exited: () => { for (const w of [...shown.keys()]) gone(w) } })
const ask = (req: Record<string, unknown>) => helper.ask(req)

function gone(wid: number) {
  const s = shown.get(wid)
  shown.delete(wid)
  changed()
  if (s && !s.win.isDestroyed()) s.win.webContents.send("vaultite:apps", { type: "gone", wid })
}

function heard(m: Record<string, unknown>) {
  const wid = Number(m.wid)
  if (m.event === "gone") return gone(wid)
  const s = shown.get(wid)
  if (m.event === "title" && s && !s.win.isDestroyed()) s.win.webContents.send("vaultite:apps", { type: "title", wid, title: String(m.title ?? "") })
  if (m.event === "here" && s && !s.win.isDestroyed()) s.win.webContents.send("vaultite:apps", { type: "here", wid, here: m.here === true })
  if (m.event === "front" && s && !s.rect && !s.win.isDestroyed() && !s.win.isMinimized()) s.win.webContents.send("vaultite:apps", { type: "front", wid })
  if (m.event === "front" && !s) for (const w of AppWindow.getAllWindows()) if (hosts.has(w) && !w.isMinimized()) w.webContents.send("vaultite:apps", { type: "front", wid })
  if (m.event === "window" && !shown.has(wid)) {
    const wins = [...shown.values()].filter((x) => x.bundle === m.bundle && !x.win.isDestroyed()).map((x) => x.win)
    const to = wins.find((w) => w.isFocused()) ?? wins[0]
    to?.webContents.send("vaultite:apps", { type: "window", bundle: String(m.bundle), wid, title: String(m.title ?? "") })
  }
}

function onScreen(win: AppWindow, r: Rect) {
  const c = win.getContentBounds(), z = win.webContents.getZoomFactor()
  return { rect: { x: c.x + r.x * z, y: c.y + r.y * z, width: r.width * z, height: r.height * z }, bound: c }
}

const meets = (a: Rect, b: Rect) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
function standing(s: Shown) {
  const c = s.win.getContentBounds(), f = s.at!.frame
  return { r: { x: c.x + f.x, y: c.y + f.y, width: f.width, height: f.height }, c }
}
function hiddenFits(wid: number, s: Shown) {
  if (!s.at || s.win.isDestroyed()) return false
  const { r, c } = standing(s)
  if (r.x < c.x - 0.5 || r.y < c.y - 0.5 || r.x + r.width > c.x + c.width + 0.5 || r.y + r.height > c.y + c.height + 0.5) return false
  return ![...shown].some(([id, o]) => id !== wid && o.rect && o.behind && !o.win.isDestroyed() && meets(r, onScreen(o.win, o.rect).rect))
}
function clear(wid: number, to: Rect) {
  const out: Promise<unknown>[] = []
  for (const [id, s] of shown) if (id !== wid && s.at && !s.win.isDestroyed() && meets(standing(s).r, to)) { s.at = null; out.push(ask({ op: "park", wid: id })) }
  return Promise.all(out)
}

async function put(wid: number, win: AppWindow, r: Rect | null) {
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

function follow(win: AppWindow) {
  for (const [wid, s] of shown) if (s.win === win) void put(wid, win, s.rect)
}

function rectOf(x: unknown): Rect | null {
  const r = x as Rect | null
  return r && [r.x, r.y, r.width, r.height].every((n) => typeof n === "number" && Number.isFinite(n)) && r.width >= 2 && r.height >= 2 ? r : null
}
const isBundle = (x: unknown): x is string => typeof x === "string" && /^[\w.-]+$/.test(x)
const bundleOf = (x: unknown) => { if (!isBundle(x)) throw new Error("expected a bundle id"); return x }
const widOf = (x: unknown) => (Number.isInteger(x) && (x as number) > 0 ? x as number : 0)
function drop(win: AppWindow, wid: unknown) {
  const id = widOf(wid)
  if (!id || shown.get(id)?.win !== win) return 0
  shown.delete(id)
  changed()
  return id
}

export const appHandlers: Record<string, (win: AppWindow, ...args: unknown[]) => unknown> = {
  "apps:list": () => ask({ op: "apps" }),
  "apps:trusted": (_win, prompt) => ask({ op: "trusted", prompt: !!prompt }),
  "apps:show": async (win, bundle, wid, rect) => {
    const b = bundleOf(bundle), want = widOf(wid), r = rectOf(rect)
    if (!hosts.has(win)) return { ok: false, why: "reopen" }
    let id = shown.get(want)?.bundle === b ? want : 0
    const had = id ? shown.get(id) : undefined
    if (!r && had?.win !== win) return { ok: true, wid: want }
    let title: unknown
    if (!had) {
      const res = await ask({ op: "adopt", bundle: b, wid: want, launch: true })
      if (!res.ok) return res
      id = Number(res.wid)
      title = res.title
    }
    const behind = (had?.win === win && had.behind) || (!!r && (win.isFocused() || (await ask({ op: "front" })).bundle === b))
    shown.set(id, { bundle: b, win, rect: r, behind, at: had?.win === win ? had.at : null })
    changed()
    const res = await put(id, win, r)
    if (behind && !had?.behind) void ask({ op: "raise", wid: id })
    return { ...res, wid: id, ...(typeof title === "string" ? { title } : {}) }
  },
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
  // (a bundle id that isn't one: PrusaSlicer's "com.prusa3d.slic3r/")
  "apps:icons": (_win, bundles) => ask({ op: "icons", bundles: (Array.isArray(bundles) ? bundles : []).filter(isBundle) }),
  "apps:focus": (win, wid, go, bundle) => {
    // (not before it's behind the window: the app would come forward with its window parked)
    const id = widOf(wid), s = shown.get(id)
    if (go && (s?.win === win || !s)) return ask({ op: "focus", wid: id, bundle: s?.bundle ?? (typeof bundle === "string" ? bundleOf(bundle) : ""), go: true })
    return s?.win === win && s.behind && s.rect ? ask({ op: "focus", wid: id }) : undefined
  },
  "apps:through": (win, on) => setThrough(win, !!on && holesOf(win).length > 0, !!on),
}

export function appsOn(vault: string) {
  if (process.platform !== "darwin") return false
  try {
    const c = JSON.parse(fs.readFileSync(path.join(vault, ".vaultite", "plugins.json"), "utf8"))
    return Array.isArray(c.enabled) && c.enabled.includes("app-windows") && !(Array.isArray(c.disabled) && c.disabled.includes("app-windows")) &&
      fs.existsSync(path.join(vault, ".vaultite", "plugins", "app-windows", "manifest.json"))
  } catch { return false }
}
const hosts = new WeakSet<AppWindow>()

export function appsWindow(win: AppWindow) {
  hosts.add(win)
  const releaseAll = () => {
    for (const [id, s] of [...shown]) if (s.win === win) { shown.delete(id); void ask({ op: "release", wid: id, keep: true }) }
    changed()
    setThrough(win, false)
  }
  for (const e of ["move", "resize", "minimize", "restore", "show", "hide"] as const) win.on(e as "move", () => follow(win))
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

export function stopApps() {
  globalShortcut.unregister(PALETTE)
  helper.quit()
}
