import { app, nativeTheme, screen, WebContentsView } from "electron"
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { z } from "zod"
import type { AppWindow } from "./appwindow.ts"

const IDLE_MS = 1500, LONGEST_MS = 8000, FADE_MS = 140, SIZE_SLACK = 48
const THEME_KNOWN_AT_LAUNCH = process.platform !== "linux"
const Meta = z.object({ width: z.number(), height: z.number(), scale: z.number(), dark: z.boolean(), version: z.string() })
type Meta = z.infer<typeof Meta>
const shown = new WeakMap<AppWindow, () => void>()
const drawn = new WeakSet<AppWindow>()
const settled = new WeakMap<AppWindow, () => void>()

const folder = () => path.join(app.getPath("userData"), "last-screen")
const fileOf = (vault: string, ext: "jpg" | "html" | "json") => path.join(folder(), `${crypto.createHash("sha1").update(path.resolve(vault)).digest("hex").slice(0, 16)}.${ext}`)
const scaleOf = (win: AppWindow) => screen.getDisplayMatching(win.getBounds()).scaleFactor
const sizeOf = (win: AppWindow) => { const [width, height] = win.getContentSize(); return { width, height } }

function stillLike(win: AppWindow, m: Meta) {
  const { width, height } = sizeOf(win)
  const near = Math.abs(m.width - width) <= SIZE_SLACK && Math.abs(m.height - height) <= SIZE_SLACK
  const theme = !THEME_KNOWN_AT_LAUNCH || m.dark === nativeTheme.shouldUseDarkColors
  return near && theme && m.version === app.getVersion() && m.scale === scaleOf(win)
}

function readMeta(vault: string) {
  try { return Meta.parse(JSON.parse(fs.readFileSync(fileOf(vault, "json"), "utf8"))) } catch { return null }
}

const page = (m: Meta, picture: string) => `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;overflow:hidden;cursor:progress}` +
  `html{transition:opacity ${FADE_MS}ms ease-out}img{display:block;width:${m.width}px;height:${m.height}px;user-select:none}</style>` +
  `<img src="${path.basename(picture)}?${Date.now()}" alt="" draggable="false">`

export function showLastScreen(win: AppWindow, vault: string): Promise<boolean> {
  const m = readMeta(vault)
  if (!m || !stillLike(win, m) || !fs.existsSync(fileOf(vault, "html"))) return Promise.resolve(false)
  const view = new WebContentsView({ webPreferences: { sandbox: true, contextIsolation: true, javascript: false, spellcheck: false } })
  view.setBackgroundColor("#00000000")
  const fit = () => { const { width, height } = sizeOf(win); view.setBounds({ x: 0, y: 0, width, height }) }
  fit()
  win.contentView.addChildView(view)
  win.contentView.on("bounds-changed", fit)
  let gone = false
  const remove = () => {
    if (gone) return
    gone = true
    shown.delete(win)
    if (win.isDestroyed()) return
    win.contentView.off("bounds-changed", fit)
    win.contentView.removeChildView(view)
    view.webContents.close()
  }
  const fade = () => { void view.webContents.insertCSS("html{opacity:0}").catch(() => {}); setTimeout(remove, FADE_MS + 20) }
  shown.set(win, fade)
  const themed = () => { if (nativeTheme.shouldUseDarkColors !== m.dark) fade() }
  nativeTheme.on("updated", themed)
  view.webContents.once("destroyed", () => nativeTheme.off("updated", themed))
  setTimeout(fade, LONGEST_MS)
  win.webContents.once("did-fail-load", fade)
  win.webContents.once("render-process-gone", fade)
  return view.webContents.loadFile(fileOf(vault, "html")).then(() => !gone, () => { remove(); return false })
}

export function pageDrawn(win: AppWindow) {
  drawn.add(win)
  shown.get(win)?.()
  settled.get(win)?.()
}

async function keep(win: AppWindow, vault: string) {
  const image = await win.webContents.capturePage()
  if (image.isEmpty() || win.isDestroyed()) return
  const m: Meta = { ...sizeOf(win), scale: scaleOf(win), dark: nativeTheme.shouldUseDarkColors, version: app.getVersion() }
  await fs.promises.mkdir(folder(), { recursive: true })
  const put = async (file: string, data: string | Buffer) => { const at = `${file}.${process.pid}`; await fs.promises.writeFile(at, data); await fs.promises.rename(at, file) }
  await put(fileOf(vault, "jpg"), image.toJPEG(88))
  await put(fileOf(vault, "html"), page(m, fileOf(vault, "jpg")))
  await put(fileOf(vault, "json"), JSON.stringify(m))
}

export function keepLastScreen(win: AppWindow, vault: string) {
  let timer: ReturnType<typeof setTimeout> | null = null, busy = false
  const take = () => {
    if (timer) clearTimeout(timer)
    timer = null
    if (busy || win.isDestroyed() || !drawn.has(win) || shown.has(win) || !win.isVisible() || win.isMinimized()) return
    busy = true
    keep(win, vault).catch(() => {}).finally(() => { busy = false })
  }
  const soon = () => { if (timer) clearTimeout(timer); timer = setTimeout(take, IDLE_MS) }
  settled.set(win, soon)
  win.webContents.on("input-event", soon)
  win.webContents.on("did-start-navigation", (e) => { if (e.isMainFrame && !e.isSameDocument) drawn.delete(win) })
  win.on("blur", take)
  win.on("resize", soon)
  win.on("closed", () => { if (timer) clearTimeout(timer) })
}
