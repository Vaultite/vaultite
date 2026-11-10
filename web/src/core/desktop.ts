// The desktop app's side of the page (`window.vaultite`; null in a browser), not its wiring (core/desktopapp.ts). Every
// focus asks the main process for the keyboard back (`web.take`): Chromium moves it between native views silently.
import type { DictationSource } from "@/core/dictation"
import { openDetail } from "@/core/nav"
import { notify } from "@/core/notify"
import { isMac, showLabel } from "@/core/platform"

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
  /** Set up Vaultite (the first-run window, the vault): again, from the menu or the playground. Older builds don't have it. */
  setup?: () => Promise<unknown>
  /** Whether Set up Vaultite opened this window: its welcome card goes on from the vault (true once). */
  welcome?: () => Promise<boolean>
  /** Claude Code's computer use on for this vault, and Codex's, where they're installed: errors by agent. A Mac's only. */
  computerUse?: () => Promise<Record<string, string>>
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
  /** How this Mac takes updates (automatic, notify, off; `available`: this build updates at all), and, automatic, this
   *  page saying whether a restart would lose nothing now. Older builds don't have it. */
  updates?: { get: () => Promise<{ mode: UpdateMode; available: boolean }>; set: (mode: UpdateMode) => Promise<unknown>; safe: (safe: boolean) => Promise<unknown> }
  /** Whether this computer opens the app at login (a Mac's, Windows'). Older builds don't have it. */
  login?: { get: () => Promise<{ on: boolean }>; set: (on: boolean) => Promise<unknown> }
  /** The interface size (core/zoom.ts): the whole app's zoom, every window's, kept for this computer (vaults.json
   *  `zoom`). `step` answers the size it came to; `on` hears every change. Older builds don't have it. */
  interfaceSize?: { get: () => Promise<number>; step: (step: -1 | 0 | 1) => Promise<number>; on: (fn: (zoom: number) => void) => void }
  /** `spelling`: a right-click the page left to the system, with the misspelled word under it ("" none) and guesses. */
  on: (fn: (msg: { type: string; id?: string; bundle?: string; path?: string; url?: string; version?: string; name?: string; auto?: boolean; text?: string | null; label?: string; done?: boolean; restart?: boolean; word?: string; suggestions?: string[] }) => void) => void
  /** Tell the menu bar this window's commands, pins and recent files (electron/menu.ts). Builds from before it don't
   *  have it. */
  syncMenu?: (snap: MenuSnapshot) => Promise<unknown>
  /** The window as it prints, saved as a PDF where the user picks (a save dialog): its path, or null (cancelled).
   *  Builds of the app from before Export to PDF don't have it. */
  printToPDF?: (name: string) => Promise<string | null>
  revealPdf?: (path: string) => Promise<unknown>
  /** Ask macOS for the microphone (once; later answers come from System Settings): whether it's allowed. */
  microphone?: () => Promise<boolean>
  /** A macOS permission's button (core/permissions.ts' ids, or "vault"; pages use usePermissions): its prompt, the drag
   *  helper, a folder read, or the pane after a no. A Mac's only; builds from before it don't have it. */
  permission?: (id: string) => Promise<unknown>
  /** The Mac's notification: true once it's clicked (the window comes to the front), false when it's dismissed or can't
   *  be shown. Builds of the app from before the Inbox don't have it. */
  notify?: (title: string, body: string) => Promise<boolean>
  /** Another picture in the Dock (a PNG data: URL; null: the app's own again), whether one is set, and an image picked
   *  anywhere on the Mac as a data: URL. Builds from before the Dock icon plugin don't have it. */
  dock?: { set: (png: string | null) => Promise<unknown>; custom: () => Promise<boolean>; pick: () => Promise<string | null> }
  /** Web pages laid over a pane (the Browser's tabs; electron/web.ts). Builds from before it don't have it. */
  web?: WebPages
  /** Other Mac apps' windows behind a pane (App windows' tabs; electron/apps.ts). Builds from before it don't have it. */
  apps?: AppWindows
  /** Dictation from this Mac's microphone (electron/dictation.ts). Builds from before it don't have it. */
  dictation?: DictationSource
  /** macOS's Look up (the dictionary's popover) for the page's selection. Builds from before it don't have it. */
  lookUp?: () => Promise<unknown>
  /** Add a word to the spell checker's dictionary. With it come `spelling` messages (below). */
  learnWord?: (word: string) => Promise<unknown>
  /** The window (or a rectangle of it, in CSS pixels) as a PNG, base64 (`vau dev screenshot`). Builds from before it don't have it. */
  capture?: (rect?: { x: number; y: number; width: number; height: number }) => Promise<{ png: string; width: number; height: number }>
  /** A dragged tab's card (its box in CSS px, where the pointer holds it, its corners) shown following the pointer past
   *  the window's edge, as it looks now; null hides it. Answers whether it shows. Builds from before it don't have it. */
  dragGhost?: (look: { x: number; y: number; width: number; height: number; grab: { x: number; y: number }; radius: number } | null) => Promise<boolean>
  /** Bring another of this vault's windows to the front (`popout`: its id; null: the vault's window), the keyboard
   *  left here unless `focus`. Answers whether it did. Builds from before it don't have it. */
  raiseWindow?: (popout: string | null, focus?: boolean) => Promise<boolean>
  /** Show a Mac window's traffic lights at `at` (CSS px: `x` right of where they sit, centred on the line `mid` down),
   *  or hide them (null); answers how they're drawn. Older builds lack it, show them in place, or answer nothing. */
  lights?: (at: Lights | null) => Promise<LightsFrame | undefined>
  /** A pop-out's bars hidden (Hide window bars): its traffic lights shown only with the pointer at its top, which drags
   *  it. Answers whether the window does it (a Mac's pop-outs; builds from before it don't have it). */
  bare?: (on: boolean) => Promise<boolean>
  /** Keep the window on top of others' (`on`), or ask: answers whether it is. Builds from before it don't have it. */
  onTop?: (on?: boolean) => Promise<boolean>
  /** Ask for the window's sidebars and bars see-through to the desktop, blurred (appearance `translucent`), and hear
   *  whenever that changes. A Mac's and Windows'; builds from before it don't have it. */
  translucent?: { set: (on: boolean) => Promise<Translucency>; on: (fn: (t: Translucency) => void) => void }
}

/** Whether the window is translucent now, and why not while asked (electron/translucency.ts): this computer can't,
 *  Reduce transparency, another app's window in a tab, or a Mac window opened solid (it shows once reopened). */
export type Translucency = { on: boolean; why?: "system" | "reduced" | "apps" | "reopen" }

export type Lights = { x: number; mid: number }
/** How the Mac draws the lights for an `at` (points): the first button `inset` right of `at.x` and centred on `mid`
 *  in a `width`×`height` frame, each a circle `size` across, `pitch` apart; `zoom` the page's. */
export type LightsFrame = { zoom: number; inset: number; width: number; height: number; size: number; pitch: number }

export type UpdateMode = "automatic" | "notify" | "off"


/** What the menu bar shows of a window (electron/menu.ts's MenuSnapshot). */
export type MenuSnapshot = {
  commands: { id: string; name: string; keys: string[]; custom: boolean; on: boolean; checked?: boolean }[]
  pinned: { path: string; title: string }[]
  recent: { path: string; title: string }[]
}

/** Where a web page is (its address), what it's called and what it can do now. */
export type WebPageState = { url: string; title: string; back: boolean; forward: boolean; loading: boolean
  /** Why the page didn't load ("ERR_NAME_NOT_RESOLVED"), until the next load. */
  error?: string
  /** It's playing sound: from its first sound till its media pauses, through quiet scenes; its sound is muted; the app
   *  paused its media (`pause`, till `play` or another page). */
  playing?: boolean; muted?: boolean; paused?: boolean
  /** It's in its player, a window of its own (still its tab's). */
  player?: boolean
  /** Its site's zoom, when it isn't 100% (1.25: 125%). */
  zoom?: number
  /** `error` is a certificate it may go on past (`allow-cert`); its renderer kept crashing (a reload starts it again);
   *  it holds typed, unsent input. Older builds don't say. */
  unsafe?: boolean; crashed?: boolean; typed?: boolean
  /** Its page has painted since it was made (older builds don't say). */
  painted?: boolean
  /** The address it was opened with (or last sent to), while only redirects and the page itself have moved it on since:
   *  moved to another container, it starts there again (a sign-in's first pages set cookies its last ones need). */
  opened?: string
  /** The identity provider's site that flow went to sign in with (google.com): another site's sign-in it reached. */
  signIn?: string }
/** A rectangle of the window, in the page's CSS pixels (getBoundingClientRect's); `radius`, a page's corners' (Electron
 *  rounds all four). */
type WebRect = { x: number; y: number; width: number; height: number; radius?: number }
/** Web pages in the desktop app: native views over this window in sessions of their own (logins apart from the app's),
 *  known by number, each a tab's: hidden while it's in the background, ended with it. Older builds ignore tabs. */
export type WebPages = {
  /** Show tab `tab`'s page over `rect`, or hidden (null): the one it has, else a new one at `url`. No tab (a glance):
   *  a new one, ended when released. Shown again: `focused` when it had the keyboard as it was hidden. */
  open: (url: string, rect: WebRect | null, profile?: string, tab?: string) => Promise<{ id: number; state: WebPageState; focused?: boolean }>
  /** Move it over `rect`, or hide it (null). Shown again: `focused` when it had the keyboard as it was hidden (builds
   *  from before answer nothing). */
  place: (id: number, rect: WebRect | null) => Promise<{ focused?: boolean; shown?: boolean } | undefined | void>
  /** Its tab went to the background (a tab or workspace switch): hidden, kept for the tab's next `open`. */
  release: (id: number) => Promise<unknown>
  /** Tab `tab` closed, left this window or stopped showing a web page: its page ends. `moved`: it went on in another of
   *  this vault's windows, which takes the page, live, as it shows it (older builds end it). */
  close: (tab: string, moved?: boolean) => Promise<unknown>
  /** `back-address`, `forward-address`: where Back or Forward would go. `history`: `{ at, entries: [{ i, url, title }] }`,
   *  `go-to` entry `url` (its i). `allow-cert`, `duplicate`, `pause`, `play`. `zoom-*`: answers `{ host, zoom }`. */
  go: (id: number, action: "back" | "forward" | "reload" | "hard-reload" | "devtools" | "back-address" | "forward-address" | "stop" | "load" | "focus" | "mute"
    | "unmute" | "pip" | "zoom-in" | "zoom-out" | "zoom-reset" | "print" | "history" | "go-to" | "allow-cert" | "source" | "duplicate" | "pause" | "play", url?: string) => Promise<unknown>
  /** Find `text` in the page, answered by `found` events: `next` goes on from the match it's at (`forward` false: back),
   *  else it's a new search; "" stops. Older builds don't have it. */
  find?: (id: number, text: string, o?: { next?: boolean; forward?: boolean; matchCase?: boolean }) => Promise<unknown>
  /** Into its player, a window of its own its main video fills (`fullScreen`: full screen on a Space of its own), or back in its tab
   *  (`on` false). Older builds don't have it. */
  player?: (id: number, on: boolean, fullScreen?: boolean) => Promise<unknown>
  /** Its HTML as rendered now, and where it is. */
  html: (id: number) => Promise<{ url: string; title: string; html: string }>
  /** A picture of it as it's shown now (JPEG; null when it isn't shown). Older builds don't have it. */
  shot?: (id: number) => Promise<Uint8Array | null>
  /** Tab `tab`'s last picture of `url` in `profile` (JPEG, its size in CSS px), shown in its place while its page comes
   *  back (a relaunch, a closed tab reopened); null while its page is there. Older builds don't have it. */
  frame?: (tab: string, url: string, profile: string) => Promise<{ data: Uint8Array; width: number; height: number } | null>
  /** The titles tabs' pages last had, by address: a tab not loaded yet keeps its name. Older builds don't have it. */
  titles?: () => Promise<Record<string, string>>
  /** An address (http, https, mailto) in the system browser. */
  external: (url: string) => Promise<unknown>
  /** The app's shortcuts with ⌘, ⌃ or ⌥ (`modifiedSteps`): pressed in a page, they come back as `key` events. */
  keys: (steps: string[]) => Promise<unknown>
  /** Show a downloaded file in Finder. */
  reveal: (path: string) => Promise<unknown>
  /** This window's pages: on screen in a tab (`shown`) or their tab's in the background. */
  list?: () => Promise<WebPageInfo[]>
  /** The sites a profile keeps cookies for, signed-in ones first, then the latest visited, with the account where the
   *  app knows how to ask. */
  sites?: (profile: string) => Promise<WebSite[]>
  /** Who's signed in to a site in each of these profiles (null: nobody, never used, locked, or no way to ask), each
   *  answering within moments. */
  who?: (site: string, profiles: string[]) => Promise<Record<string, { account: string; more?: string[] } | null>>
  /** Sign out of a site in a profile: its cookies and storage go, its open pages reload. */
  forget?: (profile: string, site: string) => Promise<unknown>
  /** Move a login (its sites' cookies) to another profile, or copy it (`copy`): not ok when the site there names nobody
   *  after (it keeps its login elsewhere), then left as it was. Older builds don't have it. */
  move?: (from: string, to: string, sites: string[], copy: boolean) => Promise<{ ok: boolean; account?: string }>
  /** A login (its sites' cookies) sealed for another Mac's app, by its key, for its profile `to`: only that app opens it
   *  (Machines; the servers pass it on). Older builds don't have it. */
  seal?: (from: string, sites: string[], to: string, key: string) => Promise<string>
  /** Claude Code on the web's sessions in the profiles named, read with their logins once `read` (the user's yes), told
   *  from now on as `cloud` events, news as `session` ones. Older builds take nothing and answer the sessions. */
  cloud?: (want: { profiles: string[]; read: boolean; hidden: string[] }) => Promise<CloudState | CloudSession[]>
  /** A cloud session archived, back from the archive, or renamed (`value`: its new title) on claude.ai. Older builds
   *  don't have it. */
  cloudAct?: (action: "archive" | "unarchive" | "rename", id: string, value?: string | { account: string }) => Promise<{ ok: boolean }>
  /** The window over its pages while something covers one (null: under them): "app" takes the pointer (a menu, a drag),
   *  "through" leaves what lands on a page to it (beside a toast, the mini player), passed on with `pointer`. */
  raise: (how: "app" | "through" | null) => Promise<unknown>
  /** The app's background (#rrggbb): what a new page shows till its first page comes in. Older builds don't have it. */
  look?: (background: string) => Promise<unknown>
  /** The pointer over page `id` while the window lets it through: where in the page (CSS pixels), what it did, the keys
   *  held. */
  pointer: (id: number, m: { type: "mouseMove" | "mouseDown" | "mouseUp" | "mouseLeave" | "mouseWheel"; x: number; y: number
    button?: "left" | "middle" | "right"; clickCount?: number; dx?: number; dy?: number; keys?: ("alt" | "control" | "meta" | "shift")[] }) => Promise<unknown>
  /** Something of the window's was focused: the keyboard comes to the window from a page that has it (its id), if one
   *  does (else null). */
  take?: () => Promise<number | null>
  /** Icons (data URLs) by key: a site's by its host without "www.", a page's own by host and first path segment
   *  ("google.com/maps", only where it differs from its site's); "" for none yet. Older builds don't have it. */
  icons?: (hosts: string[]) => Promise<Record<string, string>>
  /** Ask a feature of the browser engine (electron/browser/: blocking, extensions, history...) by its name. Older
   *  builds don't have it. */
  engine?: (name: string, ...args: unknown[]) => Promise<unknown>
  on: (fn: (msg: WebEvent) => void) => () => void
}
export type WebEvent =
  | { type: "state"; id: number; state: WebPageState }
  /** Page `id` (tab `tab`, logins `profile`) opens `url` in a new tab, a side pane or a glance, in `container` if one was
   *  picked (null: none); `page`: the page made for it, handed to its tab with `engine("web:adopt", page, tab)`. */
  | { type: "open"; id: number; tab: string; url: string; profile: string; how: "background" | "foreground" | "side" | "glance"; container?: string | null; page?: number }
  /** Page `id`'s script opened `url` with nobody clicking: not opened (a popup blocker). */
  | { type: "blocked"; id: number; tab: string; url: string; profile: string }
  /** Tab `tab` closes itself (its page's first load was a download). */
  | { type: "close"; tab: string }
  /** The pointer moved over a page near the window's left or right edge, or just left there (window CSS px). */
  | { type: "pointer"; x: number; y: number }
  /** The pointer is at page `id`'s top edge (`at`; told again while it stays, `now`: it clicked there), or not (`left`:
   *  it left the page there): a hidden page bar slides in. */
  | { type: "top"; id: number; at: boolean; now?: boolean; left?: boolean }
  | { type: "focus"; id: number }
  /** Page `id`'s cursor changed (Electron's name: "pointer", "text"...), shown over it while the window lets the pointer
   *  through. Older builds don't tell it. */
  | { type: "cursor"; id: number; cursor: string }
  | { type: "clip"; id: number }
  | { type: "block"; id: number; x: number; y: number }
  | { type: "address"; id: number }
  /** Its source asked for (⌥⌘U, its menu): a view-source: address for a tab of its own. */
  | { type: "source"; id: number; url: string }
  | { type: "key"; id: number; key: string; code: string; meta: boolean; ctrl: boolean; alt: boolean; shift: boolean }
  /** The mouse's back (-1) or forward (1) button over a page. */
  | { type: "nav"; id: number; dir: -1 | 1 }
  /** What a find found so far: the match it's at (1-based; 0: none), of how many, `final` once it's done counting. */
  | { type: "found"; id: number; request: number; active: number; matches: number; final: boolean }
  | { type: "download"; name: string; path: string; ok: boolean }
  /** An image saved to the vault from a page's menu: its bytes (null: it couldn't be had), its name and type. */
  | { type: "image"; id: number; name: string; mime: string; data: Uint8Array | null; error?: string }
  | { type: "pages" }
  /** An icon came or changed (a data URL; "" when a page's own is its site's again), by its key (`icons`). */
  | { type: "icon"; host: string; icon: string }
  /** A page's notification (its title and body; the page's address and site, and its logins' profile). */
  | { type: "notify"; id: number; profile: string; url: string; site: string; title: string; body: string }
  /** A Claude Code on the web session finished or waits for the user: `url` is the session's page. */
  | { type: "session"; id: number; profile: string; url: string; site: string; kind: "done" | "waiting"; title: string; body: string }
  /** Claude Code on the web's sessions changed (`cloud`); older builds tell only the sessions. */
  | ({ type: "cloud" } & Partial<CloudState> & { sessions: CloudSession[] })
  /** Something a feature of the browser engine tells (electron/browser/engine.ts `tell`): its own `type`. */
  | { type: `engine:${string}`; [k: string]: unknown }
/** A session of Claude Code on the web (electron/cloud.ts, which says what each is): `updated` in ms, `url` its page,
 *  `profile` the logins it was read with, `account` its organization's id; older builds say only these. */
export type CloudSession = { id: string; title: string; state: "running" | "waiting" | "idle"; updated: number; url: string; profile: string; account?: string
  summary?: string; outcome?: "done" | "input" | "review"; unread?: boolean; created?: number
  repos?: { repo: string; branch?: string }[]; origin?: "web" | "cli" | "phone"; remote?: boolean
  pr?: { number: number; url: string; state: "open" | "draft" | "merged" | "closed" } }
/** A claude.ai organization whose sessions are read: its name (a personal one's: its login's email), and the logins
 *  (profiles) it's in. */
export type CloudAccount = { id: string; label: string; profiles: string[] }
/** `signedIn`: a profile named is signed in to claude.ai (from its cookies: nothing asked); the rest once read. `base`:
 *  claude.ai's address (a test's stand-in has its own; older builds don't say). */
export type CloudState = { signedIn: boolean; accounts: CloudAccount[]; sessions: CloudSession[]; base?: string }
export type WebPageInfo = WebPageState & { id: number; profile: string; shown: boolean
  /** The id of the tab it's for ("": none, a glance). Older builds don't say. */
  tab?: string }
export type WebSite = { site: string
  /** Signed in (its login cookie says so), and who as when the site says. Older builds don't say `signed`. */
  signed?: boolean; account?: string
  /** Other accounts signed in beside `account` (Google's), its picture (a data URL). Older builds don't say. */
  more?: string[]; avatar?: string
  /** Other sites the same login signs in to (YouTube and google.<country> with Google), shown as one row. */
  with?: string[]
  /** When a page of it was last visited in these logins (ms). */
  last?: number
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
  /** A web address opened in the app (a browser: in the window it last used, or a new one), answering that window for
   *  a tab to show (`view:app/<bundle>:<wid>`). Older builds don't have it. */
  open?: (bundle: string, url: string) => Promise<{ ok: boolean; why?: AppProblem; wid?: number; title?: string }>
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
/** The desktop app's web pages, or null (a browser, an app build from before the Browser). */
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

/** Settings > Permissions, what macOS lets the app do: null where there's none (a browser, another system, an older
 *  build). The terminal's way there when macOS keeps an agent from the vault. */
export const openPermissions = desktop?.permission ? () => openDetail("settings-section/permissions") : null

/** In the desktop app, the Mac's notification (`title`, a line of `body`): resolves true when the user clicks it (the
 *  window then comes to the front), false when it's dismissed; null in a browser, or an app build without it. */
export const systemNotify = (title: string, body = ""): Promise<boolean> | null =>
  desktop?.notify ? desktop.notify(title, body).catch(() => false) : null

/** The window as a PNG (base64), or null: a browser, or a build without it. */
/** A dragged tab's card going on past the window's edge, over the screen (electron/dragghost.ts): the desktop app's. */
export const floatGhost = desktop?.dragGhost ? (look: Parameters<NonNullable<DesktopApi["dragGhost"]>>[0]) => desktop!.dragGhost!(look).catch(() => false) : null

/** Another of this vault's windows to the front (`popout`: its id; null: the vault's window): the desktop app's. */
export const raiseWindow = desktop?.raiseWindow ? (popout: string | null, focus = false) => desktop!.raiseWindow!(popout, focus).catch(() => false) : null

export const captureWindow = (): Promise<{ png: string; width: number; height: number } | null> =>
  desktop?.capture ? desktop.capture().catch(() => null) : Promise.resolve(null)

/** A Mac window's traffic lights, which the page can hide and move: the desktop app's, not a browser's. */
export const hasLights = isMac && !!desktop?.lights
let frame: LightsFrame | null = null
/** How the window draws its lights, once it has said (builds from before it don't). */
export const lightsFrame = () => frame
/** The Mac window's traffic lights shown at `at` (the sidebar's top row they sit in, which may float over the page),
 *  or hidden (null: a sidebar hidden without its rail); nothing elsewhere. Resolves once the window has them so. */
export const showLights = (at: Lights | null): Promise<void> => isMac && desktop?.lights
  ? desktop.lights(at).then((f) => { if (f && typeof f === "object" && f.zoom > 0) frame = f }, () => {}) : Promise.resolve()

/** The desktop app's window with its bars hidden or back (a pop-out's, Hide window bars): its traffic lights and the strip
 *  that drags it come with the pointer at its top. Nothing in a browser or elsewhere. */
export const bareWindow = (on: boolean) => { void desktop?.bare?.(on).catch(() => false) }

/** The desktop app's Look up and spell checker (the editor's menu): null in a browser or a build without them. */
export const lookUp = desktop?.lookUp && isMac ? desktop.lookUp : null
type Spelled = { word: string; suggestions: string[] }
let waiting: ((s: Spelled | null) => void)[] = []
/** What the desktop app's spell checker said of the word under a right-click (core/desktopapp.ts hears it). */
export const spellingHeard = (s: Spelled | null) => { const w = waiting; waiting = []; w.forEach((f) => f(s)) }
/** The spell checker sees a right-click only once the page leaves it to the system (not prevented): `at` answers
 *  what it said of the word under it (null: nothing came), `learn` adds a word to its dictionary. */
export const spelling = desktop?.learnWord ? {
  at: () => new Promise<Spelled | null>((ok) => { waiting.push(ok); setTimeout(() => ok(null), 300) }),
  learn: desktop.learnWord,
} : null

/** The Dock's icon in the desktop app (electron/main.ts): null in a browser or a build without it. */
export const dockIcon = () => desktop?.dock ?? null

/** Something from outside the vault (an absolute path: /x, Windows' C:/x), opened in the desktop app. */
export const isOutside = (path: string) => /^(\/|[a-z]:[\\/]|\\\\)/i.test(path)

export const hasFiles = (dt: DataTransfer | null) => !!dt && [...dt.types].includes("Files")
