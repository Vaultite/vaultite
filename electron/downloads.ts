// The browser's downloads: each one's progress told to the app's windows as it goes, cancelled, resumed or tried
// again from them, and the finished ones kept on this Mac (userData web-downloads.json), never the vault.
import { app, shell, type DownloadItem, type Session } from "electron"
import fs from "node:fs"
import path from "node:path"
import { AppWindow } from "./appwindow.ts"
import { writeAtomic } from "./setup.ts"
import { type Download, downloadsFrom } from "./filewire.ts"


const KEPT = 30
/** How often a download's progress is told, at most. */
const TELL_MS = 400
const file = () => path.join(app.getPath("userData"), "web-downloads.json")

let list: Download[] | null = null
const items = new Map<number, { item: DownloadItem; session: Session }>()
let next = 1

function all() {
  if (list) return list
  try { list = downloadsFrom(fs.readFileSync(file(), "utf8")) } catch { list = [] }
  // (one the last run left going ended with it)
  for (const d of list) if (d.state === "progressing" || d.state === "paused") { d.state = "interrupted"; d.resumable = false }
  next = Math.max(0, ...list.map((d) => d.id)) + 1
  return list
}
function save() {
  try { writeAtomic(file(), JSON.stringify(all().filter((d) => d.done))) } catch { /* this run's only */ }
}

/** Every window hears each change (the list is the Mac's); only the page's own window shows its toasts (`here`). */
function tell(d: Download, here: AppWindow | null, event?: "started" | "done") {
  const wins = AppWindow.getAllWindows()
  const toasts = here && !here.isDestroyed() ? here : AppWindow.getFocusedWindow() ?? wins[0]
  for (const w of wins) if (!w.isDestroyed()) w.webContents.send("vaultite:web", { type: "download", download: d, ...(event && w === toasts ? { event } : {}) })
}

/** "name.pdf", else "name 1.pdf"... like Finder, past the names of downloads still writing theirs. */
function freeName(dir: string, name: string) {
  const clean = path.basename(name).replace(/^\.+/, "") || "download"
  const ext = path.extname(clean), stem = ext ? clean.slice(0, -ext.length) : clean
  const writing = new Set(all().filter((d) => !d.done).map((d) => d.path))
  let out = clean, n = 1
  while (fs.existsSync(path.join(dir, out)) || writing.has(path.join(dir, out))) out = `${stem} ${n++}${ext}`
  return out
}

/** A download a page (or the user, Retry) started: saved in Downloads, its progress told as it goes. */
export function track(item: DownloadItem, s: Session, o: { profile: string; win: AppWindow | null; agent: boolean }) {
  const dir = app.getPath("downloads")
  const to = path.join(dir, freeName(dir, item.getFilename() || "download"))
  item.setSavePath(to)
  const d: Download = { id: next++, name: path.basename(to), path: to, url: item.getURL(), profile: o.profile, state: "progressing",
    received: 0, total: item.getTotalBytes(), at: Date.now(), ...(o.agent ? { agent: true } : {}) }
  const l = all()
  l.unshift(d)
  // (the oldest finished ones go first; none still going)
  while (l.length > KEPT) { const i = l.findLastIndex((x) => x.done); if (i < 0) break; l.splice(i, 1) }
  items.set(d.id, { item, session: s })
  const win = o.agent ? null : o.win
  tell(d, win, o.agent ? undefined : "started")
  let told = Date.now()
  item.on("updated", (_e, state) => {
    d.received = item.getReceivedBytes()
    d.total = item.getTotalBytes()
    d.state = state === "interrupted" ? "interrupted" : item.isPaused() ? "paused" : "progressing"
    d.resumable = state === "interrupted" && item.canResume()
    // (broken off, Chromium keeps it for a resume and never says done: it ended, for now)
    if (state === "interrupted") {
      if (d.done) return
      d.done = Date.now()
      save()
      return tell(d, win, o.agent ? undefined : "done")
    }
    delete d.done
    if (Date.now() - told < TELL_MS) return
    told = Date.now()
    tell(d, win)
  })
  item.once("done", (_e, state) => {
    items.delete(d.id)
    d.received = item.getReceivedBytes()
    d.total = item.getTotalBytes() || d.received
    d.state = state
    d.done = Date.now()
    delete d.resumable
    save()
    tell(d, win, o.agent ? undefined : "done")
  })
  return d
}

/** The list, newest first, each finished one checked for its file. */
export function downloads(): Download[] {
  for (const d of all()) if (d.state === "completed") { const gone = !fs.existsSync(d.path); if (gone) d.gone = true; else delete d.gone }
  return all()
}

const sessionOf = new Map<string, Session>()
/** Retry needs a profile's session: websession.ts hands each over as it's made. */
export const downloadSession = (profile: string, s: Session) => { sessionOf.set(profile, s) }

/** What the app asks of one: cancel, pause, resume, retry (anew, or on from where it stopped), open, show, forget. */
export function act(id: number, what: string) {
  const d = all().find((x) => x.id === id)
  if (!d) return false
  const live = items.get(id)?.item
  if (what === "cancel") { live?.cancel(); return true }
  if (what === "pause") { live?.pause(); return true }
  if (what === "resume" && live?.canResume()) { live.resume(); return true }
  if (what === "retry" || what === "resume") {
    const s = sessionOf.get(d.profile)
    if (!s || !/^https?:/i.test(d.url)) return false
    forget(d)
    s.downloadURL(d.url)
    return true
  }
  if (what === "open" || what === "show") {
    if (d.state !== "completed" || !fs.existsSync(d.path)) return false
    if (what === "show") shell.showItemInFolder(d.path)
    else void shell.openPath(d.path)
    return true
  }
  if (what === "forget") { if (live) live.cancel(); forget(d); return true }
  return false
}
function forget(d: Download) {
  const l = all(), i = l.indexOf(d)
  if (i >= 0) l.splice(i, 1)
  save()
  for (const w of AppWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send("vaultite:web", { type: "download", gone: d.id })
}
/** Clear the finished ones from the list (their files stay). */
export function clearDownloads() {
  const l = all()
  for (const d of l.filter((x) => x.done)) forget(d)
}
export const openDownloadsFolder = () => { void shell.openPath(app.getPath("downloads")) }
