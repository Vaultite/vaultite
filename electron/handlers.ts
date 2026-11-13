import { app, dialog, ipcMain, nativeImage, Notification, shell, systemPreferences } from "electron"
import { AppWindow } from "./appwindow.ts"
import fs from "node:fs"
import path from "node:path"
import type { MenuSnapshot } from "./menu.ts"
import { stripKit, webHandlers } from "./web.ts"
import { modeChanged, pageSafe, restartToUpdate, updatable, UPDATE_MODES, windowReady, type UpdateMode } from "./updates.ts"
import { appHandlers } from "./apps.ts"
import { dictationHandlers } from "./dictation.ts"
import { setTranslucent } from "./translucency.ts"
import { hideGhost, showGhost, type GhostLook } from "./dragghost.ts"
import { sandboxPath } from "./sandbox.ts"
import { plainText } from "../core/plainerror.ts"
import * as Setup from "./setup.ts"
import { strings } from "../core/values.ts"
import { MAC, WIN } from "./mainbase.ts"
import { applyLights, bare, BUTTONS, CONTROLS_HEIGHT, LIGHTS, setLights } from "./titlebar.ts"
import { buildMenu, find, helperPrefs, known, nameOf, remotes, save, setHelperPrefs, setKnown, setRemotes, setUpdates, updates, zoom } from "./vaultlist.ts"
import { macPermissions, popouts, wins } from "./servers.ts"
import { shellReady } from "./errors.ts"
import { focusedVault, manager, openVault, sandbox, showManager, waiting } from "./vaultwindow.ts"
import { openRemote, probe, remoteWins } from "./remotewin.ts"
import { folderName, handle, str, who } from "./handle.ts"
import { pathDirs, serverUrl, showSetup, where } from "./setupwin.ts"
import { copyIn, openFiles, pickOutside } from "./fromoutside.ts"
import { applyDockIcon, DOCK_ICON, IMAGE_TYPES, zoomBy } from "./appmenu.ts"
import { logger } from "../core/log.ts"

const log = logger("desktop")

handle("vaults:list", (w) => ({
  current: w?.vault.path ?? null, home: app.getPath("home"),
  vaults: [...known].sort((a, b) => (b.last ?? 0) - (a.last ?? 0))
    .map((v) => ({ path: v.path, name: nameOf(v.path), open: wins.has(v.path), ...(v.path === sandboxPath() ? { sandbox: true } : {}) }))
    .concat(remotes.map((r) => ({ path: r.url, name: r.name, open: remoteWins.has(r.url), remote: true }))),
}))
handle("vaults:open", async (_w, p: string) => {
  if (remotes.some((r) => r.url === p)) return openRemote(p)
  await openVault(str(p))
  for (const f of waiting.splice(0)) await openFiles([f], null)
})
handle("vaults:create", async (_w, parent: string, name: string) => {
  const clean = folderName(name)
  if (!clean || clean.startsWith(".")) throw new Error("the vault needs a name")
  const p = path.join(str(parent), clean)
  if (fs.existsSync(p) && fs.readdirSync(p).length) throw new Error(`${p} already exists and isn't empty`)
  fs.mkdirSync(p, { recursive: true })
  await openVault(p)
})
handle("vaults:sandbox", async () => { await sandbox() })
handle("vaults:connect", async (_w, typed: string) => {
  const url = serverUrl(str(typed))
  if (!url) throw new Error("That isn't a web address")
  const r = await probe(url)
  if (!r.ok) throw new Error(`${r.error}. Is it on, and is Tailscale on here?`)
  openRemote(url)
})
handle("vaults:remove", (_w, p: string) => {
  setKnown(known.filter((v) => v.path !== str(p)))
  setRemotes(remotes.filter((r) => r.url !== p))
  save()
  buildMenu()
})
handle("vaults:pick", async (w) => {
  const opts = { properties: ["openDirectory", "createDirectory"] as ("openDirectory" | "createDirectory")[] }
  const parent = w?.win ?? manager
  const r = parent ? await dialog.showOpenDialog(parent, opts) : await dialog.showOpenDialog(opts)
  return r.canceled ? null : r.filePaths[0] ?? null
})
handle("vaults:reveal", (_w, p: string) => { if (find(str(p))) shell.showItemInFolder(p) })
handle("vaults:manage", () => showManager())
handle("app:setup", () => showSetup())
handle("app:welcome", (w) => {
  if (!w?.welcome) return false
  w.welcome = false
  return true
})
handle("app:computer-use", async (w) => {
  if (!w || !MAC) return {}
  const at = where(), vault = w.vault.path, failed: Record<string, string> = {}
  for (const h of Setup.harnesses(at, pathDirs(), vault)) {
    if (!h.path || h.extra?.kind !== "computer-use" || h.extra.state !== "off") continue
    try { await (h.id === "codex" ? Setup.setCodexComputerUse(at, h.path) : Setup.setClaudeComputerUse(at, vault)) } catch (e) { failed[h.id] = plainText(e, "Couldn't turn on computer use") }
  }
  return failed
})
handle("files:copy-in", (w, paths: string[], folder: string, move: boolean) => {
  if (!w) throw new Error("no vault here")
  return copyIn(w, strings(paths), str(folder), !!move)
})
handle("files:open", (w, paths: string[]) => openFiles(strings(paths), w))
handle("files:pick", async (w) => pickOutside(w))
const DIALOG_KEYS = ["title", "defaultPath", "buttonLabel", "filters", "properties", "message", "detail", "nameFieldLabel", "showsTagField", "buttons", "type", "defaultId", "cancelId", "checkboxLabel", "noLink"]
ipcMain.on("dialog:sync", (e, kind: unknown, options: unknown) => {
  try {
    const w = who(e)
    const o = Object.fromEntries(Object.entries(options && typeof options === "object" ? options : {}).filter(([k]) => DIALOG_KEYS.includes(k)))
    const parent = w?.win ?? AppWindow.fromWebContents(e.sender)
    if (!parent) throw new Error("no window")
    e.returnValue = kind === "open" ? dialog.showOpenDialogSync(parent, o) ?? null
      : kind === "save" ? dialog.showSaveDialogSync(parent, o) || null
        : kind === "message" ? dialog.showMessageBoxSync(parent, { message: "", ...o }) : null
  } catch { e.returnValue = null }
})
handle("app:ready", (w) => {
  if (!w) return []
  w.ready = true
  windowReady(w)
  shellReady(w)
  return w.queue.splice(0)
})
handle("app:update-restart", () => restartToUpdate(true))
handle("app:updates", () => ({ mode: updates, available: updatable() }))
handle("app:updates-set", (_w, mode: UpdateMode) => {
  if (!UPDATE_MODES.includes(mode) || mode === updates) return
  setUpdates(mode)
  save()
  modeChanged()
})
handle("app:login", () => ({ on: app.getLoginItemSettings().openAtLogin }))
handle("app:login-set", (_w, on: boolean) => {
  if (typeof on !== "boolean") return
  if (app.getLoginItemSettings().openAtLogin !== on) app.setLoginItemSettings({ openAtLogin: on })
  setHelperPrefs({ ...helperPrefs, login: on })
  save()
})
ipcMain.handle("app:update-safe", (e, safe: boolean) => {
  if (!who(e)) return
  pageSafe(e.sender, safe === true)
})
handle("menu:sync", (w, snap: MenuSnapshot) => {
  if (!w || !snap || !Array.isArray(snap.commands)) return
  const list = <T,>(x: unknown, ok: (v: T) => boolean): T[] => (Array.isArray(x) ? (x as T[]).filter(ok) : [])
  w.menu = {
    commands: list<MenuSnapshot["commands"][number]>(snap.commands, (c) => typeof c?.id === "string" && typeof c.name === "string" && Array.isArray(c.keys))
      .map((c) => ({ id: c.id, name: c.name, keys: c.keys.filter((k) => typeof k === "string"), custom: !!c.custom, on: !!c.on })),
    pinned: list<{ path: string; title: string }>(snap.pinned, (f) => typeof f?.path === "string" && typeof f.title === "string").slice(0, 40),
    recent: list<{ path: string; title: string }>(snap.recent, (f) => typeof f?.path === "string" && typeof f.title === "string").slice(0, 15),
  }
  if (focusedVault() === w) buildMenu()
})
handle("print:pdf", async (w, name: string) => {
  if (!w) throw new Error("no vault here")
  const file = `${str(name).replace(/[/\\:*?"<>|]/g, " ").trim() || "Untitled"}.pdf`
  const r = await dialog.showSaveDialog(w.win, { defaultPath: path.join(app.getPath("downloads"), file), filters: [{ name: "PDF", extensions: ["pdf"] }] })
  if (r.canceled || !r.filePath) return null
  const letter = ["US", "CA", "MX", "PH"].includes(app.getLocaleCountryCode())
  const pdf = await w.win.webContents.printToPDF({ printBackground: true, pageSize: letter ? "Letter" : "A4", preferCSSPageSize: true })
  fs.writeFileSync(r.filePath, pdf)
  return r.filePath
})
// macOS asks once whether Vaultite may use the microphone; the page's getUserMedia works only after.
handle("media:microphone", async () => !MAC || systemPreferences.askForMediaAccess("microphone"))
handle("app:permission", (_w, id: string) => { if (MAC) return macPermissions().then((p) => p.permissionAct(str(id))) })
handle("print:reveal", (_w, p: string) => { if (str(p).endsWith(".pdf")) shell.showItemInFolder(p) })
// A Notification nothing refers to is collected, and its click lost.
const shown = new Set<Notification>()
handle("dock:set", (_w, png: string | null) => {
  if (png === null) fs.rmSync(DOCK_ICON(), { force: true })
  else {
    const img = nativeImage.createFromDataURL(str(png))
    if (img.isEmpty()) throw new Error("not an image")
    fs.writeFileSync(DOCK_ICON(), img.toPNG())
  }
  applyDockIcon()
})
handle("dock:custom", () => fs.existsSync(DOCK_ICON()))
handle("dock:pick", async (w) => {
  const opts = { properties: ["openFile"] as "openFile"[], filters: [{ name: "Images", extensions: Object.keys(IMAGE_TYPES) }] }
  const r = w ? await dialog.showOpenDialog(w.win, opts) : await dialog.showOpenDialog(opts)
  const file = r.canceled ? null : r.filePaths[0]
  const type = file && IMAGE_TYPES[path.extname(file).slice(1).toLowerCase()]
  return file && type ? `data:${type};base64,${fs.readFileSync(file).toString("base64")}` : null
})
ipcMain.handle("text:look-up", (e) => { who(e); e.sender.showDefinitionForSelection() })
ipcMain.handle("text:learn", (e, word: string) => { who(e); e.sender.session.addWordToSpellCheckerDictionary(str(word)) })
ipcMain.handle("window:lights", (e, at: boolean | { x: number; mid: number } | null) => {
  who(e)
  const w = AppWindow.fromWebContents(e.sender)
  if (!MAC || !w) return
  if (at && typeof at === "object" && Number.isFinite(at.x) && Number.isFinite(at.mid)) {
    const z = e.sender.getZoomFactor()
    setLights(w, { x: Math.round(LIGHTS.x + at.x * z), y: Math.round(at.mid * z - BUTTONS.height / 2) })
  } else if (at) w.setWindowButtonVisibility(true)
  else setLights(w, null)
  const v = [...wins.values()].find((x) => x.win === w)?.vault
  if (v && !!v.lightsOff !== !at) { if (at) delete v.lightsOff; else v.lightsOff = true; save() }
  return { zoom: e.sender.getZoomFactor(), inset: LIGHTS.x, ...BUTTONS }
})
ipcMain.handle("window:bare", async (e, on: unknown) => {
  who(e)
  const w = AppWindow.fromWebContents(e.sender)
  if (!MAC || !w || !popouts.has(e.sender)) return false
  const k = await stripKit()
  if (on !== true) { k.noStrip(w); bare.delete(w) }
  else if (!k.hasStrip(w)) {
    bare.set(w, k)
    const run = (id: string) => () => { if (!w.isDestroyed()) w.webContents.send("vaultite", { type: "command", id }) }
    k.topStrip(w, () => applyLights(w), { page: w.webContents, pin: run("window:on-top"),
      menu: () => [{ label: "Show window bars", click: run("window:bars") }, { label: "Keep window on top", type: "checkbox", checked: w.isAlwaysOnTop(), click: run("window:on-top") }] })
  }
  applyLights(w)
  return on === true
})
ipcMain.handle("window:on-top", async (e, on: unknown) => {
  who(e)
  const w = AppWindow.fromWebContents(e.sender)
  if (w && typeof on === "boolean") (await import("./ontop.ts")).setOnTop(w, on)
  return !!w?.isAlwaysOnTop()
})
ipcMain.handle("window:raise", (e, popout: unknown, focus: unknown) => {
  const w = who(e), pages = w ? [w.win.webContents, ...[...popouts].filter(([, of]) => of === w).map(([wc]) => wc)] : []
  return import("./raise.ts").then((m) => m.raise(pages, popout, focus === true))
})
ipcMain.handle("window:translucent", (e, on: unknown) => {
  who(e)
  const w = AppWindow.fromWebContents(e.sender)
  return w ? setTranslucent(w, on === true) : { on: false }
})
const CONTROLS_WIDTH = 138 // (three caption buttons of 46 DIP)
ipcMain.handle("window:controls", (e, o: { color?: unknown; symbol?: unknown; height?: unknown }) => {
  who(e)
  const w = AppWindow.fromWebContents(e.sender)
  if (!WIN || !w || !o || typeof o !== "object") return null
  const z = e.sender.getZoomFactor()
  const color = (x: unknown) => (typeof x === "string" && /^#[0-9a-f]{6}$/i.test(x) ? x : undefined)
  const height = typeof o.height === "number" && Number.isFinite(o.height) ? Math.round(Math.min(64, Math.max(28, o.height * z))) : CONTROLS_HEIGHT
  w.setTitleBarOverlay({ color: color(o.color), symbolColor: color(o.symbol), height })
  return { width: Math.ceil(CONTROLS_WIDTH / z) }
})
ipcMain.handle("page:capture", async (e, rect?: { x: number; y: number; width: number; height: number }) => {
  who(e)
  const r = rect && [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) && rect.width >= 1 && rect.height >= 1
    ? { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) } : undefined
  let img = await e.sender.capturePage(r)
  while (img.toPNG().length > 20 << 20 && img.getSize().width > 200) img = img.resize({ width: Math.round(img.getSize().width / 2) })
  return { png: img.toPNG().toString("base64"), ...img.getSize() }
})

ipcMain.handle("drag:ghost", (e, look: GhostLook | null) => {
  who(e)
  const n = (x: unknown) => typeof x === "number" && Number.isFinite(x)
  if (look && [look.x, look.y, look.width, look.height, look.radius, look.grab?.x, look.grab?.y].every(n)) return showGhost(e.sender, look)
  hideGhost()
  return false
})

handle("app:notify", (w, title: string, body: string) => new Promise<boolean>((resolve) => {
  if (!w || !Notification.isSupported()) return resolve(false)
  const n = new Notification({ title: str(title).slice(0, 120), body: typeof body === "string" ? body.slice(0, 300) : "" })
  const done = (clicked: boolean) => { shown.delete(n); resolve(clicked) }
  n.on("click", () => {
    if (w.win.isMinimized()) w.win.restore()
    w.win.show()
    w.win.focus()
    app.focus({ steal: true })
    done(true)
  })
  n.on("close", () => done(false))
  n.on("failed", () => done(false))
  shown.add(n)
  n.show()
}))
handle("apps:reopen", (w) => {
  if (!w) throw new Error("no vault here")
  const p = w.vault.path, server = w.server
  w.ending = true
  const gone = new Promise<void>((ok) => { if (!server || server.exitCode !== null || server.signalCode) ok(); else server.once("exit", () => ok()) })
  w.win.once("closed", () => void gone.then(() => openVault(p)).catch((e) => log.error("the vault didn't open again", e, { path: p })))
  w.win.close()
})
for (const [name, fn] of Object.entries({ ...webHandlers, ...appHandlers, ...(MAC ? dictationHandlers : {}) })) {
  ipcMain.handle(name, (e, ...args) => {
    const w = who(e), win = AppWindow.fromWebContents(e.sender)
    if (!w || !win) throw new Error("no vault here")
    return fn(win, ...args)
  })
}
handle("window:zoom", () => zoom)
handle("window:zoom-step", (_w, step: unknown) => zoomBy(step === 1 || step === -1 ? step : 0))
