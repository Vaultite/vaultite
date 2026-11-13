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
import { panesShowing } from "@/core/workspace"
import { whenIdle } from "@/lib/utils"
import { elementOf } from "@/core/dom"
import { strings } from "../../../core/values.ts"

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

export async function dropInto(dt: DataTransfer, folder: string, move: boolean): Promise<string[]> {
  const app = desktop
  if (app) {
    const paths = [...dt.files].map((f) => app.pathOf(f)).filter(Boolean)
    return paths.length ? app.copyIn(paths, folder, move) : []
  }
  const entries = [...dt.items].map((i) => i.webkitGetAsEntry?.()).filter((e): e is FileSystemEntry => !!e)
  const files = entries.length ? [] : [...dt.files]
  const made: string[] = []
  for (const e of [...entries, ...files]) {
    const { path } = await post<{ path: string }>("upload/name", { folder, name: e.name })
    await (e instanceof File ? send(e, path) : upload(e, path))
    made.push(path)
  }
  return made
}

const send = async (file: File, to: string) => { await uploadFile(to, file) }

const isFileEntry = (e: FileSystemEntry): e is FileSystemFileEntry => e.isFile
const isFolderEntry = (e: FileSystemEntry): e is FileSystemDirectoryEntry => e.isDirectory

async function upload(e: FileSystemEntry, to: string): Promise<void> {
  if (isFileEntry(e)) {
    return send(await new Promise<File>((ok, fail) => e.file(ok, fail)), to)
  }
  if (!isFolderEntry(e)) return
  await post("folder", { path: to })
  const reader = e.createReader()
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((ok, fail) => reader.readEntries(ok, fail))
    if (!batch.length) break
    for (const c of batch) if (!c.name.startsWith(".")) await upload(c, `${to}/${c.name}`)
  }
}

const open = (path: string) => openFile(path, { newTab: !panesShowing(`file:${path}`).length })

/** Open a file outside the vault by its absolute path (a notice's Open): the desktop app lets this window have it, as a
 *  file dropped on it, or opens the vault it's in; a browser can't, nor a computer it isn't on, which a toast says. */
export async function openOutside(path: string) {
  const name = path.split(/[\\/]/).pop() || path
  if (!desktop) return void notify(`${name} is outside the vault: the desktop app opens it, on the computer it's on`)
  const mine = await desktop.openOutside([path])
  if (mine.length) mine.forEach(open)
  else notify(`Couldn't open ${name}: it isn't on this computer`)
}

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

export function startDesktop() {
  const app = desktop
  whenIdle(refresh)
  addEventListener("focus", refresh)
  startFileDrops()
  const outside = (e: DragEvent) => hasFiles(e.dataTransfer) && !elementOf(e.target)?.closest("[data-file-drop]")
  // A browser replaces the page with a file dropped where nothing takes it.
  if (!app) {
    addEventListener("dragover", (e) => { if (outside(e) && !e.defaultPrevented) { e.preventDefault(); e.dataTransfer!.dropEffect = "none" } })
    addEventListener("drop", (e) => { if (outside(e) && !e.defaultPrevented) e.preventDefault() })
    return
  }
  addEventListener("mouseup", (e) => {
    if (e.button !== 3 && e.button !== 4) return
    e.preventDefault()
    runCommandId(e.button === 3 ? "nav:back" : "nav:forward")
  })
  app.on((m) => {
    if (m.type === "command" && m.id) runCommandId(m.id)
    else if (m.type === "link" && m.id) { const id = m.id; let n = 0; const go = () => { if (!runCommandLink(id) && ++n < 40) setTimeout(go, 150) }; go() }
    else if (m.type === "link" && m.bundle) void import("@/core/bundles").then((b) => b.openImport(m.bundle!))
    else if (m.type === "open" && m.path) open(m.path)
    else if (m.type === "web" && m.url && /^https?:\/\//i.test(m.url)) { const url = m.url; void import("@/core/links").then((l) => l.openWebLink(url, { newTab: false, fromApp: true })) }
    else if (m.type === "go" && m.path) openFile(m.path)
    else if (m.type === "spelling") spellingHeard({ word: m.word ?? "", suggestions: m.suggestions ?? [] })
    else if (m.type === "update") {
      notify(m.text ?? `A new version of ${m.name ?? "Vaultite"} is ready (${m.version})${m.auto ? ". It restarts into it while you're away" : ""}`,
        { id: "update", duration: Infinity, action: { label: m.label ?? "Restart to update", run: () => app.restartToUpdate() } })
      if (m.auto) reportSafety(app)
    }
    else if (m.type === "update-status") {
      if (m.restart) dismissNotice("update")
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
    e.stopPropagation()
    const paths = [...e.dataTransfer!.files].map((f) => app.pathOf(f)).filter(Boolean)
    if (paths.length) app.openOutside(paths).then((ps) => ps.forEach(open))
  }, true)
}

function syncMenu(sync: (snap: MenuSnapshot) => Promise<unknown>) {
  let timer = 0, last = ""
  const title = (p: string) => (p.split("/").pop() ?? p).replace(/\.md$/i, "")
  const send = () => {
    timer = 0
    const s = getStore()
    const exists = new Set(s?.files.files.map((f) => f.path) ?? [])
    const pins = workspacePins() ?? (s && "pinned" in s ? s.pinned : undefined) ?? []
    const snap: MenuSnapshot = {
      commands: commandList().map((c) => ({ id: c.id, name: commandName(c), keys: keysOf(c), custom: isCustom(c.id), on: available([c]).length > 0,
        ...(isSetting(c) ? { checked: isOn(c) } : {}) })),
      pinned: (Array.isArray(pins) ? strings(pins) : []).filter((p) => exists.has(p)).map((p) => ({ path: p, title: title(p) })),
      recent: recentFiles().filter((p) => exists.has(p)).slice(0, 15).map((p) => ({ path: p, title: title(p) })),
    }
    const json = JSON.stringify(snap)
    if (json === last) return
    last = json
    sync(snap).catch(() => { last = "" })
  }
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
  onSwitches(soon)
  onStore(soon)
  subscribeScoped(soon)
  for (const ev of ["hashchange", "focus", "pointerup"]) addEventListener(ev, soon, true)
  soon()
}
