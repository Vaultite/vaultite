import { AppWindow } from "./appwindow.ts"
import { revive } from "./web.ts"
import { background } from "./titlebar.ts"
import { buildMenu, remotes, save, zoom } from "./vaultlist.ts"
import { crashedFor, hangs } from "./errors.ts"
import { guard } from "./guard.ts"
import { quitting } from "./vaultwindow.ts"

export const remoteWins = new Map<string, AppWindow>()
const hostName = (url: string) => new URL(url).hostname.split(".")[0]

export function openRemote(url: string) {
  const open = remoteWins.get(url)
  if (open) return void open.focus()
  let r = remotes.find((x) => x.url === url)
  if (!r) remotes.push((r = { url, name: hostName(url) }))
  r.last = Date.now()
  r.open = true
  save()
  const b = r.bounds, it = r
  const win = new AppWindow({
    width: b?.width ?? 1280, height: b?.height ?? 820, x: b?.x, y: b?.y, minWidth: 800, minHeight: 480, title: r.name,
    backgroundColor: background(), webPreferences: { sandbox: true, contextIsolation: true, spellcheck: true },
  })
  remoteWins.set(url, win)
  const keep = () => { if (!win.isDestroyed() && !win.isFullScreen()) { it.bounds = win.getBounds(); save() } }
  win.on("resize", keep)
  win.on("move", keep)
  win.on("close", () => { if (!quitting) it.open = false; save(true) })
  let retry: ReturnType<typeof setTimeout> | null = null, wait = 5000, failed = false
  const load = () => void win.loadURL(`${url}/`).catch(() => {})
  win.webContents.on("did-start-loading", () => { failed = false })
  win.webContents.on("did-fail-load", (_e, code, _d, _u, main) => {
    if (!main || code === -3 || retry || win.isDestroyed()) return // -3: replaced by another load
    failed = true
    retry = setTimeout(() => { retry = null; if (!win.isDestroyed()) load() }, wait)
    wait = Math.min(wait * 2, 60_000)
  })
  win.webContents.on("did-stop-loading", () => { if (!failed) wait = 5000 })
  win.webContents.on("did-finish-load", () => win.webContents.setZoomFactor(zoom))
  win.on("closed", () => { remoteWins.delete(url); if (retry) clearTimeout(retry); buildMenu() })
  revive(win.webContents, undefined, crashedFor(win, it.name))
  hangs(win, it.name)
  guard(win, url)
  load()
  buildMenu()
}

export async function probe(url: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const r = await fetch(`${url}/manifest.webmanifest`, { signal: AbortSignal.timeout(8000), cache: "no-store" })
    const text = r.ok ? await r.text() : ""
    if (r.ok && text.includes("Vaultite")) return { ok: true }
    return { ok: false, error: r.ok ? "That isn't a Vaultite server" : `It answered ${r.status}` }
  } catch (e) {
    const c = (e as { cause?: { code?: string } }).cause?.code
    return { ok: false, error: (e as Error).name === "TimeoutError" ? "It didn't answer" : c === "ENOTFOUND" ? "No machine has that name" : c === "ECONNREFUSED" ? "Nothing is listening there" : String((e as Error).message) }
  }
}
