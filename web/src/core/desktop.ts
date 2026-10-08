// The desktop app's side of the page (`window.vaultite`; null in a browser). Chromium moves focus between native views
// without telling this page, so every focus here asks the main process for the keyboard back (`web.take`).
import { available, commandList, isCustom, keysOf, onCommandsChanged, runCommandId } from "@/core/commands"
import { getStore, onStore } from "@/core/data"
import { get, post } from "@/core/http"
import { openFile } from "@/core/files"
import { dismissNotice, notify } from "@/core/notify"
import { isMac, showLabel } from "@/core/platform"
import { recentFiles, subscribeScoped, workspacePins } from "@/core/scope"
import { whenIdle } from "@/lib/utils"

export type DesktopApi = {
  desktop: true
  /** The computer the app runs on, as Node names it ("darwin", "linux"). */
  platform?: string
  vaults: () => Promise<{ current?: string | null; home?: string; vaults: { path: string; name: string; open?: boolean; sandbox?: boolean; remote?: boolean }[] }>
  openVault: (path: string) => Promise<unknown>
  createVault: (parent: string, name: string) => Promise<unknown>
  removeVault: (path: string) => Promise<unknown>
  pickFolder: () => Promise<string | null>
  revealVault: (path: string) => Promise<unknown>
  manageVaults: () => Promise<unknown>
  /** Make the sandbox (a made-up vault to try the app in) afresh and open it. Older builds don't have it. */
  openSandbox?: () => Promise<unknown>
  /** Open another machine's Vaultite server (its address, checked first) in a window. Older builds don't have it. */
  connectServer?: (address: string) => Promise<unknown>
  /** Set up Vaultite (the first-run window): again, from the menu or the palette. Older builds don't have it. */
  setup?: () => Promise<unknown>
  /** The full path of a dropped file (Electron's webUtils). */
  pathOf: (file: File) => string
  copyIn: (paths: string[], folder: string, move: boolean) => Promise<string[]>
  /** Files to open: returns the ones this window should open (a vault path or an outside file the server may now read). */
  openOutside: (paths: string[]) => Promise<string[]>
  pickOutside: () => Promise<string[]>
  /** A native dialog on this window, the page waiting for it (Electron's sync dialogs; options as Electron's): "open"
   *  answers the paths or null, "save" a path or null, "message" the button's index. Older builds don't have it. */
  dialogSync?: (kind: "open" | "save" | "message", options: Record<string, unknown>) => unknown
  /** The page is ready: files waiting to open. */
  ready: () => Promise<string[]>
  /** Quit, install the build that's ready and open again. */
  restartToUpdate: () => Promise<unknown>
  /** `spelling`: a right-click the page left to the system, with the misspelled word under it ("" none) and guesses. */
  on: (fn: (msg: { type: string; id?: string; path?: string; version?: string; text?: string | null; done?: boolean; restart?: boolean; word?: string; suggestions?: string[] }) => void) => void
  /** Tell the menu bar this window's commands, pins and recent files (electron/menu.ts). Builds from before it don't
   *  have it. */
  syncMenu?: (snap: MenuSnapshot) => Promise<unknown>
  /** The window as it prints, saved as a PDF where the user picks (a save dialog): its path, or null (cancelled).
   *  Builds of the app from before Export to PDF don't have it. */
  printToPDF?: (name: string) => Promise<string | null>
  revealPdf?: (path: string) => Promise<unknown>
  /** Ask macOS for the microphone (once; later answers come from System Settings): whether it's allowed. */
  microphone?: () => Promise<boolean>
  /** The Mac's notification: true once it's clicked (the window comes to the front), false when it's dismissed or can't
   *  be shown. Builds of the app from before the Inbox don't have it. */
  notify?: (title: string, body: string) => Promise<boolean>
  /** Another picture in the Dock (a PNG data: URL; null: the app's own again), whether one is set, and an image picked
   *  anywhere on the Mac as a data: URL. Builds from before the Dock icon plugin don't have it. */
  dock?: { set: (png: string | null) => Promise<unknown>; custom: () => Promise<boolean>; pick: () => Promise<string | null> }
  /** Web pages laid over a pane (the Web viewer's tabs; electron/web.ts). Builds from before it don't have it. */
  web?: WebPages
  /** Other Mac apps' windows behind a pane (App windows' tabs; electron/apps.ts). Builds from before it don't have it. */
  apps?: AppWindows
  /** macOS's Look up (the dictionary's popover) for the page's selection. Builds from before it don't have it. */
  lookUp?: () => Promise<unknown>
  /** Add a word to the spell checker's dictionary. With it come `spelling` messages (below). */
  learnWord?: (word: string) => Promise<unknown>
  /** The window (or a rectangle of it, in CSS pixels) as a PNG, base64 (`vau dev screenshot`). Builds from before it don't have it. */
  capture?: (rect?: { x: number; y: number; width: number; height: number }) => Promise<{ png: string; width: number; height: number }>
}

/** What the menu bar shows of a window (electron/menu.ts's MenuSnapshot). */
export type MenuSnapshot = {
  commands: { id: string; name: string; keys: string[]; custom: boolean; on: boolean }[]
  pinned: { path: string; title: string }[]
  recent: { path: string; title: string }[]
}

/** Where a web page is (its address), what it's called and what it can do now. */
export type WebPageState = { url: string; title: string; back: boolean; forward: boolean; loading: boolean
  /** Why the page didn't load ("ERR_NAME_NOT_RESOLVED"), until the next load. */
  error?: string }
/** A rectangle of the window, in the page's CSS pixels (getBoundingClientRect's). */
export type WebRect = { x: number; y: number; width: number; height: number }
/** Web pages in the desktop app: native views drawn over this window in sessions of their own (logins kept apart from
 *  the app's), known by number; a released page is kept a while. Older builds ignore profiles. */
export type WebPages = {
  /** Show a page at `url` (one let go of at that address, else a new one) over `rect`, or hidden (null). */
  open: (url: string, rect: WebRect | null, profile?: string) => Promise<{ id: number; state: WebPageState }>
  /** Move it over `rect`, or hide it (null). Shown again: `focused` when it had the keyboard as it was hidden (builds
   *  from before answer nothing). */
  place: (id: number, rect: WebRect | null) => Promise<{ focused?: boolean } | undefined | void>
  /** Its tab went (a tab switch, a workspace switch): hidden, kept a while for `open`. */
  release: (id: number) => Promise<unknown>
  /** The last tab showing this address closed: its page ends. */
  close: (url: string, profile?: string) => Promise<unknown>
  go: (id: number, action: "back" | "forward" | "reload" | "stop" | "load" | "focus", url?: string) => Promise<unknown>
  /** A picture of it as it is (JPEG), to show in its place while something of the app's is drawn over it. */
  snapshot: (id: number) => Promise<Uint8Array | null>
  /** Its HTML as rendered now, and where it is. */
  html: (id: number) => Promise<{ url: string; title: string; html: string }>
  /** An address (http, https, mailto) in the system browser. */
  external: (url: string) => Promise<unknown>
  /** The app's shortcuts with ⌘, ⌃ or ⌥ (`modifiedSteps`): pressed in a page, they come back as `key` events. */
  keys: (steps: string[]) => Promise<unknown>
  /** Show a downloaded file in Finder. */
  reveal: (path: string) => Promise<unknown>
  /** This window's pages: on screen in a tab (`shown`) or kept a while after their tab went. */
  list?: () => Promise<WebPageInfo[]>
  /** The sites a profile keeps cookies for, signed-in ones first, with the account where the app knows how to ask. */
  sites?: (profile: string) => Promise<WebSite[]>
  /** Sign out of a site in a profile: its cookies and storage go, its open pages reload. */
  forget?: (profile: string, site: string) => Promise<unknown>
  /** The addresses of a profile's web tabs: the watched ones (work going on in them, Claude Code's sessions) without a
   *  page get one, hidden, so they're read before their tab is shown. */
  wake?: (urls: string[], profile: string) => Promise<unknown>
  /** Toasts and tooltips floating over a page: each copied into
   *  a layer above the pages, so it shows while the page stays live; `through` passes the pointer on to the page. */
  float?: (rects: (WebRect & { through?: boolean })[]) => Promise<unknown>
  /** Something of the window's was focused: the keyboard comes to the window from a page that has it (its id), if one
   *  does (else null). */
  take?: () => Promise<number | null>
  /** Sites' icons (data URLs) by host without "www.", as pages last told them ("" for none yet). Older builds don't
   *  have it. */
  icons?: (hosts: string[]) => Promise<Record<string, string>>
  on: (fn: (msg: WebEvent) => void) => () => void
}
export type WebEvent =
  | { type: "state"; id: number; state: WebPageState }
  | { type: "open"; id: number; url: string }
  | { type: "focus"; id: number }
  | { type: "clip"; id: number }
  | { type: "address"; id: number }
  | { type: "key"; id: number; key: string; code: string; meta: boolean; ctrl: boolean; alt: boolean; shift: boolean }
  | { type: "download"; name: string; path: string; ok: boolean }
  /** An image saved to the vault from a page's menu: its bytes (null: it couldn't be had), its name and type. */
  | { type: "image"; id: number; name: string; mime: string; data: Uint8Array | null }
  | { type: "pages" }
  /** A site's icon came or changed (a data URL), by host without "www.". */
  | { type: "icon"; host: string; icon: string }
  /** A page's notification (its title and body; the page's address and site, and its logins' profile). */
  | { type: "notify"; id: number; profile: string; url: string; site: string; title: string; body: string }
  /** Work in a page finished or waits for the user (Claude Code on the web's sessions): `url` is the session's. */
  | { type: "session"; id: number; profile: string; url: string; site: string; kind: "done" | "waiting"; title: string; body: string }
export type WebPageInfo = WebPageState & { id: number; profile: string; shown: boolean }
export type WebSite = { site: string; account?: string
  /** No page of it was opened in these logins: its cookies came with other sites' pages (trackers). */
  other?: boolean }

/** A Mac app, by its bundle id. */
export type AppInfo = { bundle: string; name: string; path?: string; pid?: number
  /** A running app's windows on this Space, by number (the main one first). */
  windows?: { wid: number; title: string }[] }
/** Why an app's window couldn't be shown: no Accessibility permission, no such app, no window came, the helper failed,
 *  the window is on another desktop (Space), the app is Vaultite itself. */
export type AppProblem = "trust" | "missing" | "window" | "helper" | "reopen" | "space" | "self"
/** Other Mac apps' windows in the desktop app's tabs (see electron/apps.ts): kept right behind the window, under a
 *  part of the page left see-through. Rects are the page's CSS pixels. */
export type AppWindows = {
  /** Apps running (with a Dock icon) and installed. */
  list: () => Promise<{ running: AppInfo[]; installed: AppInfo[] }>
  /** Whether this app may move other apps' windows (Accessibility); `prompt` asks macOS to ask. */
  trusted: (prompt?: boolean) => Promise<{ trusted: boolean }>
  /** An app's window over `rect` (opening the app if needed), or out of sight (null): `wid` if it's still there, else
   *  one not in a tab (0: any). Answers the window it shows, once it's there. */
  show: (bundle: string, wid: number, rect: WebRect | null) => Promise<{ ok: boolean; why?: AppProblem; wid?: number; title?: string
    /** false: the window is on another desktop (Space), left there. */
    here?: boolean }>
  /** Its tab closed: the window goes back where it was (one the app made for the tab is closed, unless `keep`). */
  release: (wid: number, keep?: boolean) => Promise<unknown>
  /** Close the window as its close button does (the app may ask first); the tab no longer holds it. Older builds don't
   *  have it. */
  close?: (wid: number) => Promise<{ ok: boolean }>
  /** Apps' icons as PNG data URLs, by bundle id ("" for none). Older builds don't have it. */
  icons?: (bundles: string[]) => Promise<{ icons: Record<string, string> }>
  /** The app in front, with the keyboard, that window first; `go` even on another desktop (macOS goes there; the app's
   *  `bundle` when no tab holds the window). */
  focus: (wid: number, go?: boolean, bundle?: string) => Promise<unknown>
  /** Let the pointer through the window to the app behind (over a tab) or not. */
  through: (on: boolean) => Promise<unknown>
  /** Close this vault's window and open it again (App windows turned on since it opened). Older builds don't have it. */
  reopen?: () => Promise<unknown>
  on: (fn: (msg: AppEvent) => void) => () => void
}
/** A shown window closed (or its app quit), was retitled or changed desktop; or an app in a tab made a new window. */
export type AppEvent = { type: "gone"; wid: number } | { type: "title"; wid: number; title: string }
  /** A shown window left the desktop (Space) on screen, or came back. */
  | { type: "here"; wid: number; here: boolean }
  | { type: "window"; bundle: string; wid: number; title: string }
  /** A window came in front with its app (a link opened in it, ⌘Tab) while no tab shows it: a tab that has it is to be
   *  shown. */
  | { type: "front"; wid: number }
  /** The window stopped letting the pointer through (it left the holes, or none has an app behind it). */
  | { type: "through"; on: false }

export const desktop: DesktopApi | null = (window as unknown as { vaultite?: DesktopApi }).vaultite ?? null
/** The desktop app's web pages, or null (a browser, an app build from before the Web viewer). */
export const webPages: WebPages | null = desktop?.web ?? null
/** The desktop app's other apps' windows, or null (a browser, an app build from before App windows). */
export const appWindows: AppWindows | null = desktop?.apps ?? null

let takes = 0, takenFrom: number | null = null
/** How many times the keyboard was taken from a web page (to compare with `pageTakenSince`). */
export const keyboardTakes = () => takes
/** The web page the keyboard was last taken from, if it was taken since `n` (`keyboardTakes()` then). */
export const pageTakenSince = (n: number) => (takes > n ? takenFrom : null)

// (The keyboard goes where the app focuses: the header.)
if (webPages?.take) {
  const take = webPages.take, focus = HTMLElement.prototype.focus
  HTMLElement.prototype.focus = function (this: HTMLElement, options?: FocusOptions) {
    focus.call(this, options)
    if (document.activeElement === this) void take().then((id) => { if (typeof id === "number") { takes++; takenFrom = id } }, () => {})
  }
}

/** In the desktop app: the window, as it prints, saved as a PDF where the user picks (Export to PDF). `undefined` in a
 *  browser (or an app build without it): print instead; null: the user cancelled. */
export async function savePdf(name: string): Promise<string | null | undefined> {
  if (!desktop?.printToPDF) return undefined
  const p = await desktop.printToPDF(name)
  if (p) notify(`Saved ${p.split("/").pop()}`, { action: desktop.revealPdf ? { label: showLabel, run: () => desktop.revealPdf!(p) } : undefined })
  return p
}

/** Before recording: in the desktop app, macOS's permission for the microphone (false: refused). Browsers ask
 *  themselves, so true there. */
export const askMicrophone = async () => (desktop?.microphone ? desktop.microphone().catch(() => true) : true)

/** In the desktop app, the Mac's notification (`title`, a line of `body`): resolves true when the user clicks it (the
 *  window then comes to the front), false when it's dismissed; null in a browser, or an app build without it. */
export const systemNotify = (title: string, body = ""): Promise<boolean> | null =>
  desktop?.notify ? desktop.notify(title, body).catch(() => false) : null

/** The desktop app's Look up and spell checker (the editor's menu): null in a browser or a build without them. */
export const lookUp = desktop?.lookUp && isMac ? desktop.lookUp : null
type Spelled = { word: string; suggestions: string[] }
let waiting: ((s: Spelled | null) => void)[] = []
const spelled = (s: Spelled | null) => { const w = waiting; waiting = []; w.forEach((f) => f(s)) }
/** The spell checker sees a right-click only once the page leaves it to the system (not prevented): `at` answers
 *  what it said of the word under it (null: nothing came), `learn` adds a word to its dictionary. */
export const spelling = desktop?.learnWord ? {
  at: () => new Promise<Spelled | null>((ok) => { waiting.push(ok); setTimeout(() => ok(null), 300) }),
  learn: desktop.learnWord,
} : null

/** The Dock's icon in the desktop app (electron/main.ts): null in a browser or a build without it. */
export const dockIcon = () => desktop?.dock ?? null

/** Something from outside the vault (an absolute path), opened in the desktop app. */
export const isOutside = (path: string) => path.startsWith("/")

export const hasFiles = (dt: DataTransfer | null) => !!dt && [...dt.types].includes("Files")

/** Files dropped from the computer into a vault folder ("" = the top level). Returns the vault paths made. */
export async function dropInto(dt: DataTransfer, folder: string, move: boolean): Promise<string[]> {
  if (desktop) {
    const paths = [...dt.files].map((f) => desktop.pathOf(f)).filter(Boolean)
    return paths.length ? desktop.copyIn(paths, folder, move) : []
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

async function send(file: File, to: string) {
  const bytes = new Uint8Array(await file.arrayBuffer())
  let bin = ""
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  await post("upload", { path: to, data: btoa(bin) })
}

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
  whenIdle(refresh)
  addEventListener("focus", refresh)
  // Files dropped where nothing takes them: a browser would replace the app with the file, so it's refused there; the
  // desktop app opens it in a tab.
  const outside = (e: DragEvent) => hasFiles(e.dataTransfer) && !(e.target as Element | null)?.closest?.("[data-file-drop]")
  if (!desktop) {
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
  desktop.on((m) => {
    if (m.type === "command" && m.id) runCommandId(m.id)
    else if (m.type === "open" && m.path) open(m.path)
    else if (m.type === "go" && m.path) openFile(m.path)
    else if (m.type === "spelling") spelled({ word: m.word ?? "", suggestions: m.suggestions ?? [] })
    else if (m.type === "update")
      notify(`A new version of Vaultite is ready (${m.version})`, { id: "update", duration: Infinity, action: { label: "Restart to update", run: () => desktop.restartToUpdate() } })
    // What the update is doing (checking, building, downloading, restarting): the same toast, staying until it's done.
    else if (m.type === "update-status") {
      if (m.restart) dismissNotice("update") // the Restart to update toast, when it was the menu that restarted
      if (m.text) notify(m.text, { id: "update-status", duration: m.done ? undefined : Infinity })
      else dismissNotice("update-status")
    }
  })
  desktop.ready().then((paths) => paths.forEach(open))
  if (desktop.syncMenu) syncMenu(desktop.syncMenu)
  addEventListener("dragover", (e) => {
    if (!hasFiles(e.dataTransfer)) return
    e.preventDefault()
    if (outside(e)) e.dataTransfer!.dropEffect = "copy"
  }, true)
  addEventListener("drop", (e) => {
    if (!outside(e)) return
    e.preventDefault()
    e.stopPropagation() // not into the editor as text
    const paths = [...e.dataTransfer!.files].map((f) => desktop.pathOf(f)).filter(Boolean)
    if (paths.length) desktop.openOutside(paths).then((ps) => ps.forEach(open))
  }, true)
}

/** Keep the menu bar told what this window's commands are (see the top of this file): a moment after anything that may
 *  change them, and only when they did. */
function syncMenu(sync: (snap: MenuSnapshot) => Promise<unknown>) {
  let timer = 0, last = ""
  const title = (p: string) => (p.split("/").pop() ?? p).replace(/\.md$/i, "")
  const send = () => {
    timer = 0
    const s = getStore()
    const exists = new Set(s?.files.files.map((f) => f.path) ?? [])
    const pins = workspacePins() ?? ((s as { pinned?: unknown } | null)?.pinned as string[] | undefined) ?? []
    const snap: MenuSnapshot = {
      commands: commandList().map((c) => ({ id: c.id, name: c.name, keys: keysOf(c), custom: isCustom(c.id), on: available([c]).length > 0 })),
      pinned: (Array.isArray(pins) ? pins : []).filter((p) => exists.has(p)).map((p) => ({ path: p, title: title(p) })),
      recent: recentFiles().filter((p) => exists.has(p)).map((p) => ({ path: p, title: title(p) })),
    }
    const json = JSON.stringify(snap)
    if (json === last) return
    last = json
    sync(snap).catch(() => { last = "" })
  }
  const soon = () => { if (!timer) timer = window.setTimeout(send, 150) }
  onCommandsChanged(soon)
  onStore(soon)
  subscribeScoped(soon)
  // (What's available follows the tab, the focus and what was clicked; keys that change it change the tab or the store.)
  for (const ev of ["hashchange", "focus", "pointerup"]) addEventListener(ev, soon, true)
  soon()
}
