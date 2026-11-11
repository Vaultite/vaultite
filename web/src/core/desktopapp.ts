// The desktop app wired into this window (core/desktop.ts is the bridge): its menu bar kept told of the commands, what
// it hands over (files, links, updates), files dropped in, and the other vaults.
import { desktop, hasFiles, spellingHeard, type DesktopApi, type MenuSnapshot } from "@/core/desktop"
import { available, commandList, commandName, isCustom, isOn, isSetting, keysOf, onCommandsChanged, runCommandId, runCommandLink } from "@/core/commands"
import { onSwitches } from "@/core/switches"
import { getStore, onStore } from "@/core/data"
import { get, post, upload as uploadFile } from "@/core/http"
import { openFile } from "@/core/files"
import { startFileDrops } from "@/core/filedrop"
import { dismissNotice, notify } from "@/core/notify"
import { recentFiles, subscribeScoped, workspacePins } from "@/core/scope"
import { safeToRestart } from "@/core/unsaved"
import { whenIdle } from "@/lib/utils"

/** Automatic updates: tell the desktop app whether a restart would lose nothing in this page, as that changes. */
let reporting = false
function reportSafety(d: DesktopApi) {
  if (reporting || !d.updates) return
  reporting = true
  let said: boolean | null = null
  const say = () => { const now = safeToRestart(); if (now !== said) { said = now; void d.updates!.safe(now).catch(() => {}) } }
  say()
  setInterval(say, 15_000)
  document.addEventListener("visibilitychange", say)
}

/** Files dropped from the computer into a vault folder ("" = the top level). Returns the vault paths made. */
export async function dropInto(dt: DataTransfer, folder: string, move: boolean): Promise<string[]> {
  const app = desktop
  if (app) {
    const paths = [...dt.files].map((f) => app.pathOf(f)).filter(Boolean)
    return paths.length ? app.copyIn(paths, folder, move) : []
  }
  // A browser: read what was dropped (folders too) and upload it.
  const entries = [...dt.items].map((i) => i.webkitGetAsEntry?.()).filter((e): e is FileSystemEntry => !!e)
  const files = entries.length ? [] : [...dt.files] // (no entries: plain files only)
  const made: string[] = []
  for (const e of [...entries, ...files]) {
    const { path } = await post<{ path: string }>("upload/name", { folder, name: e.name })
    await (e instanceof File ? send(e, path) : upload(e, path))
    made.push(path)
  }
  return made
}

const send = async (file: File, to: string) => { await uploadFile(to, file) }

async function upload(e: FileSystemEntry, to: string): Promise<void> {
  if (e.isFile) {
    return send(await new Promise<File>((ok, fail) => (e as FileSystemFileEntry).file(ok, fail)), to)
  }
  await post("folder", { path: to })
  const reader = (e as FileSystemDirectoryEntry).createReader()
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((ok, fail) => reader.readEntries(ok, fail))
    if (!batch.length) break
    for (const c of batch) if (!c.name.startsWith(".")) await upload(c, `${to}/${c.name}`)
  }
}

/** Open what the desktop app hands this window: a vault path or an allowed outside file. */
const open = (path: string) => openFile(path, { newTab: true })

/** Open a file outside the vault by its absolute path (a notice's Open): the desktop app lets this window have it, as a
 *  file dropped on it, or opens the vault it's in; a browser can't, nor a computer it isn't on, which a toast says. */
export async function openOutside(path: string) {
  const name = path.split(/[\\/]/).pop() || path
  if (!desktop) return void notify(`${name} is outside the vault: the desktop app opens it, on the computer it's on`)
  const mine = await desktop.openOutside([path])
  if (mine.length) mine.forEach(open)
  else notify(`Couldn't open ${name}: it isn't on this computer`)
}

/** The other vaults (for the vault menu's Open entries): the desktop app's, or on the web the server's (/api/vaults),
 *  asked for once the app is idle and again when the window gets the focus (on the web at most once a minute). */
let known: { path: string; name: string }[] = []
export const otherVaults = () => known
type Listed = { current?: string | null; vaults: { path: string; name: string }[] }
const listVaults = (): Promise<Listed> => desktop ? desktop.vaults() : get<Listed>("vaults")
let listed = 0
const refresh = () => {
  if (!desktop && Date.now() - listed < 60_000) return
  listed = Date.now()
  listVaults().then((l) => { known = l.vaults.filter((v) => v.path !== l.current) }, () => { listed = 0 })
}

/** Start listening to the desktop app (once, from main.tsx); in a browser only the vault list. */
export function startDesktop() {
  const app = desktop
  whenIdle(refresh)
  addEventListener("focus", refresh)
  // Files dropped on a note's place go into the note (core/filedrop.ts, heard first). Dropped where nothing takes them:
  // a browser would replace the app with the file, so it's refused there; the desktop app opens it in a tab.
  startFileDrops()
  const outside = (e: DragEvent) => hasFiles(e.dataTransfer) && !(e.target as Element | null)?.closest?.("[data-file-drop]")
  if (!app) {
    addEventListener("dragover", (e) => { if (outside(e) && !e.defaultPrevented) { e.preventDefault(); e.dataTransfer!.dropEffect = "none" } })
    addEventListener("drop", (e) => { if (outside(e) && !e.defaultPrevented) e.preventDefault() })
    return
  }
  // The mouse's back and forward buttons: the tab's Back and Forward, as ⌘⌥← and ⌘⌥→ (a browser walks its own history
  // with them; the desktop app's window has none).
  addEventListener("mouseup", (e) => {
    if (e.button !== 3 && e.button !== 4) return
    e.preventDefault()
    runCommandId(e.button === 3 ? "nav:back" : "nav:forward")
  })
  app.on((m) => {
    if (m.type === "command" && m.id) runCommandId(m.id)
    // A vaultite://command/<id> from another app: tried until the app has that command (just opened, still starting).
    else if (m.type === "link" && m.id) { const id = m.id; let n = 0; const go = () => { if (!runCommandLink(id) && ++n < 40) setTimeout(go, 150) }; go() }
    // A bundle's link (vaultite://bundle/<owner>/<name>): its preview.
    else if (m.type === "link" && m.bundle) void import("@/core/bundles").then((b) => b.openImport(m.bundle!))
    else if (m.type === "open" && m.path) open(m.path)
    // A web link from another app (Vaultite as the Mac's browser).
    else if (m.type === "web" && m.url && /^https?:\/\//i.test(m.url)) { const url = m.url; void import("@/core/links").then((l) => l.openWebLink(url, { newTab: false, fromApp: true })) }
    else if (m.type === "go" && m.path) openFile(m.path)
    else if (m.type === "spelling") spellingHeard({ word: m.word ?? "", suggestions: m.suggestions ?? [] })
    // (a Dev instance's: its worktree's changes, its own words)
    else if (m.type === "update") {
      notify(m.text ?? `A new version of ${m.name ?? "Vaultite"} is ready (${m.version})${m.auto ? ". It restarts into it while you're away" : ""}`,
        { id: "update", duration: Infinity, action: { label: m.label ?? "Restart to update", run: () => app.restartToUpdate() } })
      if (m.auto) reportSafety(app)
    }
    // What the update is doing (checking, building, downloading, restarting): the same toast, staying until it's done.
    else if (m.type === "update-status") {
      if (m.restart) dismissNotice("update") // the Restart to update toast, when it was the menu that restarted
      if (m.text) notify(m.text, { id: "update-status", duration: m.done ? undefined : Infinity })
      else dismissNotice("update-status")
    }
  })
  app.ready().then((paths) => paths.forEach(open))
  if (app.syncMenu) syncMenu(app.syncMenu)
  addEventListener("dragover", (e) => {
    if (!hasFiles(e.dataTransfer)) return
    e.preventDefault()
    if (outside(e)) e.dataTransfer!.dropEffect = "copy"
  }, true)
  addEventListener("drop", (e) => {
    if (!outside(e)) return
    e.preventDefault()
    e.stopPropagation() // not into the editor as text
    const paths = [...e.dataTransfer!.files].map((f) => app.pathOf(f)).filter(Boolean)
    if (paths.length) app.openOutside(paths).then((ps) => ps.forEach(open))
  }, true)
}

/** Keep the menu bar told what this window's commands are (MenuSnapshot, core/desktop.ts): a moment after
 *  anything that may change them, and only when they did. */
function syncMenu(sync: (snap: MenuSnapshot) => Promise<unknown>) {
  let timer = 0, last = ""
  const title = (p: string) => (p.split("/").pop() ?? p).replace(/\.md$/i, "")
  const send = () => {
    timer = 0
    const s = getStore()
    const exists = new Set(s?.files.files.map((f) => f.path) ?? [])
    const pins = workspacePins() ?? ((s as { pinned?: unknown } | null)?.pinned as string[] | undefined) ?? []
    const snap: MenuSnapshot = {
      commands: commandList().map((c) => ({ id: c.id, name: commandName(c), keys: keysOf(c), custom: isCustom(c.id), on: available([c]).length > 0,
        ...(isSetting(c) ? { checked: isOn(c) } : {}) })),
      pinned: (Array.isArray(pins) ? pins : []).filter((p) => exists.has(p)).map((p) => ({ path: p, title: title(p) })),
      recent: recentFiles().filter((p) => exists.has(p)).slice(0, 15).map((p) => ({ path: p, title: title(p) })),
    }
    const json = JSON.stringify(snap)
    if (json === last) return
    last = json
    sync(snap).catch(() => { last = "" })
  }
  // Each time it lists every command: a moment after a change while the window has the focus, else (its menu bar not
  // the one showing) every few seconds at most, and not at all while hidden.
  let due = 0
  const soon = () => {
    if (document.hidden) return
    const ms = document.hasFocus() ? 150 : 5000
    if (timer && due <= Date.now() + ms) return
    clearTimeout(timer)
    due = Date.now() + ms
    timer = window.setTimeout(send, ms)
  }
  document.addEventListener("visibilitychange", soon)
  onCommandsChanged(soon)
  // (a setting's check, and names that follow what's on: Hide left sidebar)
  onSwitches(soon)
  onStore(soon)
  subscribeScoped(soon)
  // (What's available follows the tab, the focus and what was clicked; keys that change it change the tab or the store.)
  for (const ev of ["hashchange", "focus", "pointerup"]) addEventListener(ev, soon, true)
  soon()
}
