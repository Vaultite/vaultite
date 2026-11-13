import { app, dialog, ipcMain } from "electron"
import { AppWindow } from "./appwindow.ts"
import fs from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { servedHere } from "./host.ts"
import { sandboxPath } from "./sandbox.ts"
import * as Setup from "./setup.ts"
import { vauEntry } from "../core/appentry.ts"
import { DIST, MAC, PRELOAD, WIN } from "./mainbase.ts"
import { background, chrome } from "./titlebar.ts"
import { buildMenu, find, known, remember, remotes, save, setKnown } from "./vaultlist.ts"
import { booting, serverFor, wins } from "./servers.ts"
import { guard } from "./guard.ts"
import { openVault, sandbox, send, showManager } from "./vaultwindow.ts"
import { folderName, str } from "./handle.ts"

type SetupState = { done?: string }
const SETUP = () => path.join(app.getPath("userData"), "setup.json")
function setupState(): SetupState {
  try { const j = JSON.parse(fs.readFileSync(SETUP(), "utf8")); return j && typeof j === "object" ? j : {} } catch { return {} }
}
const saveSetup = (st: SetupState) => { fs.mkdirSync(path.dirname(SETUP()), { recursive: true }); fs.writeFileSync(SETUP(), JSON.stringify(st, null, 2) + "\n") }
export const firstRun = () => !setupState().done && !known.some((v) => v.path !== sandboxPath()) && !remotes.length

export let setupWin: AppWindow | null = null
const START_HERE = "Start here.md"
let chosen: { path: string; made: boolean; added: boolean } | null = null

export const where = (): Setup.Where => {
  const home = process.env.VAULTITE_SETUP_HOME ? path.resolve(process.env.VAULTITE_SETUP_HOME) : app.getPath("home")
  return {
    home, exe: process.execPath, vau: vauEntry(), userData: app.getPath("userData"),
    env: process.env.VAULTITE_USER_DATA ? { VAULTITE_USER_DATA: app.getPath("userData") } : {},
    ...(process.env.VAULTITE_SETUP_HOME ? {} : { documents: app.getPath("documents") }),
    ...(!process.env.VAULTITE_SETUP_HOME && process.env.CLAUDE_CONFIG_DIR ? { claudeDir: path.resolve(process.env.CLAUDE_CONFIG_DIR) } : {}),
    ...(!process.env.VAULTITE_SETUP_HOME && process.env.CODEX_HOME ? { codexHome: path.resolve(process.env.CODEX_HOME) } : {}),
  }
}
let dirs: string[] | null = null
export const pathDirs = () => (dirs ??= process.env.VAULTITE_SETUP_HOME ? [] : Setup.shellPath(where()))

export function showSetup() {
  if (setupWin && !setupWin.isDestroyed()) return setupWin.focus()
  setupWin = new AppWindow({
    // (useContentSize: a Linux window frame is outside it)
    width: 560, height: 520, useContentSize: true, resizable: false, maximizable: false, fullscreenable: false, show: false, title: "Set up Vaultite",
    ...chrome(), backgroundColor: background(),
    webPreferences: { preload: PRELOAD, sandbox: true, contextIsolation: true },
  })
  void setupWin.ready.then(() => setupWin?.show())
  setupWin.on("closed", () => {
    setupWin = null
    dropChosen()
  })
  guard(setupWin, pathToFileURL(DIST).href)
  setupWin.loadFile(path.join(DIST, "onboarding.html"))
}

function dropChosen() {
  const p = chosen?.path
  if (p && !wins.has(p)) {
    booting.get(p)?.then(([child]) => child.kill(), () => {})
    booting.delete(p)
    if (chosen!.added) { setKnown(known.filter((v) => v.path !== p)); save(); buildMenu() }
  }
  chosen = null
}

export function serverUrl(typed: string) {
  const t = typed.trim()
  try {
    const u = new URL(/^[a-z]+:\/\//i.test(t) ? t : `https://${t}`)
    return /^https?:$/.test(u.protocol) && u.hostname ? u.origin : null
  } catch { return null }
}

function setupHandle(name: string, fn: (...args: never[]) => unknown) {
  ipcMain.handle(name, (e, ...args) => {
    if (!setupWin || e.sender !== setupWin.webContents || !(e.senderFrame?.url ?? "").startsWith(pathToFileURL(DIST).href)) throw new Error("not the setup window")
    return fn(...(args as never[]))
  })
}

setupHandle("setup:info", () => {
  const w = where()
  return { places: Setup.places(w), obsidian: Setup.obsidianVaults(w), vau: Setup.vauStatus(w, pathDirs()), vauHome: Setup.vauHome(w), mac: MAC }
})
setupHandle("setup:pick", async () => {
  const r = await dialog.showOpenDialog(setupWin!, { properties: ["openDirectory", "createDirectory"] })
  return r.canceled ? null : r.filePaths[0] ?? null
})
setupHandle("setup:choose", async (c: { kind: "new"; parent: string; name: string; starter?: boolean } | { kind: "open"; path: string } | null) => {
  dropChosen()
  if (!c) return null
  let p: string, made = false
  if (c.kind === "new") {
    const clean = folderName(c.name)
    if (!clean || clean.startsWith(".")) throw new Error("The vault needs a name")
    p = path.join(str(c.parent), clean)
    if (fs.existsSync(p) && fs.readdirSync(p).some((f) => f !== ".DS_Store")) throw new Error(`${p} already exists and isn't empty`)
    fs.mkdirSync(p, { recursive: true })
    made = true
  } else {
    p = path.resolve(str(c.path))
    if (!fs.statSync(p, { throwIfNoEntry: false })?.isDirectory()) throw new Error(`${p} isn't a folder`)
  }
  chosen = { path: p, made, added: !find(p) }
  const fresh = !fs.existsSync(path.join(p, ".vaultite"))
  const port = (await servedHere(p))?.port ?? (await serverFor(remember(p)))[1]
  const call = async (opId: string, body: object, what: string) => {
    const r = await fetch(`http://127.0.0.1:${port}/api/ops/${opId}`, { method: "POST", headers: { "Content-Type": "application/json", "X-Vaultite-Client": "app/desktop" }, body: JSON.stringify(body) })
    if (!r.ok) console.error(`${what}:`, r.status, await r.text())
  }
  if (fresh) await call("ai.set", { on: "off" }, "AI off until asked")
  if (c.kind === "new" && c.starter) await call("vault.starter", {}, "starter content")
  return chosen
})
setupHandle("setup:vau", async (system: boolean) => {
  const r = Setup.installVau(where())
  if (WIN) dirs = null
  if (system) await Setup.linkSystem(r.path)
  return { did: system ? `Linked /usr/local/bin/vau to ${r.path}` : r.did, vau: Setup.vauStatus(where(), pathDirs()) }
})
setupHandle("setup:sandbox", async () => {
  await sandbox()
  setupWin?.close()
})
setupHandle("setup:finish", async () => {
  saveSetup({ done: new Date().toISOString() })
  dirs = null
  const c = chosen
  chosen = null
  if (c) {
    const w = await openVault(c.path)
    w.welcome = true
    if (c.made && fs.existsSync(path.join(c.path, START_HERE))) send(w, START_HERE)
  } else showManager()
  setupWin?.close()
})
