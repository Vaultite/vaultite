import { app, BaseWindow, Menu, nativeImage, shell } from "electron"
import { AppWindow } from "./appwindow.ts"
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { menuTemplate } from "./menu.ts"
import { CODE } from "./identity.ts"
import { updateMenuItem } from "./updates.ts"
import { gitEnv } from "../core/gitenv.ts"
import { ICON, MAC, ROOT } from "./mainbase.ts"
import { known, nameOf, remotes, save, setMenuBuilder, setZoom, zoom, ZOOMS } from "./vaultlist.ts"
import { popouts, wins } from "./servers.ts"
import { failedBox } from "./errors.ts"
import { focusedVault, openVault, sandbox, send, showManager } from "./vaultwindow.ts"
import { openRemote, remoteWins } from "./remotewin.ts"
import { showSetup } from "./setupwin.ts"
import { openFiles, pickOutside } from "./fromoutside.ts"

// Never the bundle's icon: changing the bundle breaks its signature and updates.
export const DOCK_ICON = () => path.join(app.getPath("userData"), "dock-icon.png")
export const IMAGE_TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
  webp: "image/webp", svg: "image/svg+xml", avif: "image/avif", bmp: "image/bmp" }
export function applyDockIcon() {
  if (!MAC || !app.dock) return
  if (fs.existsSync(DOCK_ICON())) app.dock.setIcon(DOCK_ICON())
  else if (!app.isPackaged && fs.existsSync(ICON)) app.dock.setIcon(ICON)
  else app.dock.setIcon(nativeImage.createEmpty())
}

function command(id: string) {
  return (_item: unknown, from?: BaseWindow) => {
    const f = from ?? AppWindow.getFocusedWindow()
    const w = [...wins.values()].find((x) => x.win === f)
    if (w) w.win.webContents.send("vaultite", { type: "command", id })
    else if (f instanceof AppWindow && popouts.has(f.webContents)) f.webContents.send("vaultite", { type: "command", id })
    else if (id === "tab:close") f?.close()
    else if (id in ZOOM_STEPS) zoomBy(ZOOM_STEPS[id])
  }
}

export function zoomBy(step: -1 | 0 | 1) {
  const i = ZOOMS.findIndex((z) => z >= zoom - 0.001)
  const to = step === 0 ? 1 : ZOOMS[Math.min(ZOOMS.length - 1, Math.max(0, (i < 0 ? ZOOMS.length - 1 : i) + step))]
  if (to === zoom) return zoom
  setZoom(to)
  const pages = [...[...wins.values()].map((w) => w.win.webContents), ...popouts.keys(), ...[...remoteWins.values()].map((w) => w.webContents)]
  for (const wc of pages) if (!wc.isDestroyed()) { wc.setZoomFactor(zoom); wc.send("vaultite:zoom", zoom) }
  save()
  return zoom
}
const ZOOM_STEPS: Record<string, -1 | 0 | 1> = { "zoom:in": 1, "zoom:out": -1, "zoom:reset": 0, "interface-size:increase": 1, "interface-size:decrease": -1, "interface-size:reset": 0 }

async function openDoc(name: string) {
  const file = path.join(ROOT, name)
  if (!fs.existsSync(file)) return
  const w = focusedVault()
  if (!w) return void openFiles([file], null)
  for (const f of await openFiles([file], w)) send(w, f)
  w.win.focus()
}

const issues = (() => {
  let repo = CODE?.repo ?? ""
  if (!repo) try { repo = execFileSync("git", ["-C", ROOT, "remote", "get-url", "origin"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], env: gitEnv() }).trim() } catch {}
  const m = /github\.com[/:]([^/]+\/[^/]+?)(\.git)?$/.exec(repo)
  return m ? `https://github.com/${m[1]}/issues` : null
})()

let menuShown = ""
function buildMenu() {
  const recent = [...known].sort((a, b) => (b.last ?? 0) - (a.last ?? 0))
  const w = focusedVault()
  const update = updateMenuItem()
  const template = menuTemplate({
    snap: w?.menu ?? null,
    run: command,
    go: (p) => { const f = focusedVault(); if (f?.ready) f.win.webContents.send("vaultite", { type: "go", path: p }) },
    update,
    vaults: [...recent.map((v) => ({ label: nameOf(v.path), sublabel: v.path, type: "checkbox" as const, checked: wins.has(v.path),
      click: () => openVault(v.path).catch((e) => failedBox(`Couldn't open ${nameOf(v.path)}`, e)) })),
      ...remotes.map((r) => ({ label: r.name, sublabel: r.url, type: "checkbox" as const, checked: remoteWins.has(r.url), click: () => openRemote(r.url) }))],
    manageVaults: showManager,
    setup: () => showSetup(),
    pickOutside: () => { void pickOutside(null) },
    openDoc: (name) => { void openDoc(name) },
    issues,
    openExternal: (url) => { void shell.openExternal(url) },
    maximize: () => { const f = AppWindow.getFocusedWindow(); if (f) { if (f.isMaximized()) f.unmaximize(); else f.maximize() } },
    showLogs: () => { fs.mkdirSync(app.getPath("logs"), { recursive: true }); void shell.openPath(app.getPath("logs")) },
    sandbox: () => { sandbox().catch(() => {}) },
    onTop: (_i, from) => {
      const f = from ?? BaseWindow.getFocusedWindow()
      if (f instanceof AppWindow && ([...wins.values()].some((x) => x.win === f) || popouts.has(f.webContents))) f.webContents.send("vaultite", { type: "command", id: "window:on-top" })
      else if (f) void import("./ontop.ts").then((k) => k.setOnTop(f, !f.isAlwaysOnTop()))
    },
  })
  // (The same menu again isn't set: setting it closes one that's open.)
  const key = JSON.stringify([w?.menu ?? null, recent.map((v) => [v.path, wins.has(v.path)]), remotes.map((r) => [r.url, remoteWins.has(r.url)]), update && [update.label, update.enabled]])
  if (key === menuShown && Menu.getApplicationMenu()) return
  menuShown = key
  const menu = Menu.buildFromTemplate(template), top = menu.getMenuItemById("on-top")
  top?.menu?.on("menu-will-show", () => { top.checked = !!BaseWindow.getFocusedWindow()?.isAlwaysOnTop() })
  Menu.setApplicationMenu(menu)
}
setMenuBuilder(buildMenu)
