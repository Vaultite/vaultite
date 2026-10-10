// What a plugin is made of (types) and definePlugin. No imports from the registry, so plugin modules can use this
// while the registry (core/plugins.ts) is still loading them.
import type { ComponentType, ReactNode } from "react"
import type { Extension } from "@codemirror/state"
import type { EditorView } from "@codemirror/view"
import type { LucideIcon } from "lucide-react"
import type { Store, VaultMeta } from "@/core/data"
import type { ConfirmOptions } from "@/components/ConfirmDialog"
import type { MenuItem } from "@/components/ContextMenu"
import type { Sidebars } from "../../../core/sidebars.ts"
import type { BlockDecls, SettingDecls } from "../../../core/blocks.ts"
import type { TextSizeKind } from "@/core/textsize"
import type { EditorSettings } from "@/core/editorPrefs"
import type { Disclosures } from "../../../core/pluginmeta.ts"

export type Manifest = {
  id: string; name: string; description: string
  /** Its icon, wherever it's listed (and in the directory before it's installed): a Lucide name ("heart-pulse"), one a
   *  plugin adds ("claude": `icons`), or an SVG file in its folder ("icon.svg", a mark in one colour: drawn in the text's). */
  icon?: string
  /** Can't work without these plugins: off while any of them is off. */
  requires?: string[]
  /** Uses these when they're on (optional). */
  enhances?: string[]
  /** Reads files or runs programs on the server's machine (an agent's, a CLI); it shows on every device through it. */
  runsOnServer?: boolean
  /** Its colour, a named one ("orange", "teal": --orange...): the app makes --<id> of it (--today), which its pages,
   *  files and cards use (`tint: today` in a dashboard) and a colour scheme may set to something else. */
  tint?: string
  /** Its section on the Plugins page and in Settings ("life", "agents": core/categories.ts); none or unknown: Other. */
  category?: string
  /** Every block it draws (`blocks` in its definition), what it shows and its options (core/blocks.ts). The core
   *  checks a block's options against it (a quiet note while editing), fills in its defaults, and lists it for AIs. */
  blocks?: BlockDecls
  /** Its settings (.vaultite/plugins/<id>/data.json), typed like a block's options plus a label each (core/blocks.ts
   *  SettingDecl): its settings sheet draws them as a form, and its docs list them (`vau docs <id>`). */
  settings?: SettingDecls
  /** Off until the user turns it on (plugins.json `enabled`), for a plugin that changes how everything behaves (Vim),
   *  and every built-in that isn't `essential` (bundles turn them on). The server keeps its backend off too (Vault.switchedOff). */
  offByDefault?: boolean
  /** One of the app's own (built-in only): the Plugins page lists it under Built-in. The other built-ins are Vaultite
   *  plugins, first-party extras listed apart and off until turned on (`offByDefault`, or by a bundle). */
  essential?: boolean
  /** Other apps' plugins it stands in for, by app ({"obsidian": ["dataview"]}; "*": it runs any of them). Two opt-in
   *  plugins standing in for the same one are alternatives: turning one on turns the other off. */
  replaces?: Record<string, string[]>
}

export type DetailDef = {
  /** args = the path after the kind, decoded ("person/People%2FAlice%20Park" -> ["People/Alice Park"]). */
  render: (store: Store, args: string[]) => ReactNode
  title: (store: Store, args: string[]) => string
  /** This detail is a file (a person is People/<name>.md): open the file instead (see `files`). */
  file?: (store: Store, args: string[]) => string | null
}
/** What a file view gets: the file's path, its frontmatter (parsed) and body as they are in the editor right now. */
export type FileCtx = { store: Store; path: string; fm: Record<string, unknown>; body: string
  /** Change one frontmatter key (undefined removes it), as typing it would; absent when the file can't be changed. */
  setProperty?: (key: string, value: unknown) => void
  /** Drawn inside an embed (`![[Note]]`): the note embedding it, the nearest one (a query's `this`). */
  host?: string }
/** How a plugin shows its files: the icon in the tree and tabs, and the line above the title. Everything else it
 *  draws in a file is a block the file asks for (see `blocks`), so what you see is in the file. */
export type FileView = {
  /** Which files: by their type ("person": its kind's, or its frontmatter's). `folders`: its usual folders' names
   *  ("People"), only so a plain note isn't made in one (kindFolder): a file there without a type isn't its. */
  types?: string[]; folders?: string[]
  icon?: LucideIcon; tint?: string
  /** The line above the title ("Friend", "Idea"). */
  kicker?: (ctx: FileCtx) => ReactNode
  /** At that line's end, quieter: what matters less than the kicker (when an inbox result came). */
  aside?: (ctx: FileCtx) => ReactNode
  /** It draws these files as pages (see PageView): Dashboards' `type: dashboard`. */
  page?: PageView
}
/** A Markdown file drawn as a page while read (Dashboards); editing it edits its text in live preview. The file is
 *  still the only state: the page comes from its frontmatter and blocks. */
export type PageView = {
  /** Its top, with the page's name: in a tab (`place: "page"`) in place of the file's title, in a sheet under it. */
  header?: (ctx: PageCtx) => ReactNode
  /** The rest of the page. */
  render: (ctx: PageCtx) => ReactNode
}
/** What a page view gets: the file as it is in the editor, the page's name (a tab carries its head's), where it's
 *  drawn, and which plugins are off. */
export type PageCtx = FileCtx & { title: string; place: "page" | "sheet"; disabled: string[] }
/** What a block gets: the file as in the editor now, its text and that text as YAML options with declared defaults.
 *  The core draws the rest alike for every block: plugin off, errors (each block isolated), loading, option notes. */
export type BlockCtx = FileCtx & { text: string; options: Record<string, unknown> }
/** A non-Markdown kind of file it draws by extension (.excalidraw). Its text is the only state: the drawing reports
 *  changes with `onChange`, the core saves and merges them. With its plugin off, the file is plain text. */
export type FileFormat = {
  /** Extensions, lower case, without the dot; a double one works ("excalidraw.md": Excalidraw's drawings in notes). */
  exts: string[]
  icon: LucideIcon; tint?: string
  /** Its text is JSON: saved only while it parses, and its source is highlighted as JSON. */
  json?: boolean
  /** Its source is code rather than Markdown: highlighted as HTML, or plain text. */
  code?: "html" | "text"
  /** Named and listed like a note (an artifact): shown without its extension, pinnable. Its backend says so to the
   *  server with the service `looks:<ext>`. */
  page?: boolean
  /** Editing it is its source ("source": a table, a page that runs): it has reading and source only, and opens in
   *  reading. Otherwise reading and editing (live preview) are its drawing, and it opens editing on desktop. */
  edit?: "source"
  /** How it sits in the file's view: "box" (default) a bordered box, "inline" as tall as it draws, "full" the whole page
   *  read in a tab, "pane" edge to edge in a tab (a canvas). Embedded, box and pane are fixed-height. */
  layout?: "box" | "inline" | "full" | "pane"
  /** What the status bar says instead of words and characters ("12 rows"); null: nothing. */
  status?: (text: string) => string | null
  /** Drawn only from the vault (an artifact runs from the server's copy): a file from outside it is its text. */
  vaultOnly?: boolean
  /** Not text (a workbook): drawn read-only from its
   *  bytes (`ctx.url`), no source or editing. Its backend's `text:<ext>` gets the bytes, for /api/render and search. */
  binary?: boolean
  /** The file drawn, filling the box it's given (as tall as what's left of the pane, or the embed's height). */
  render: (ctx: FormatCtx) => ReactNode
  /** How it looks embedded in another file (a picture of it); `render` with `editable: false` if absent. */
  embed?: (ctx: FormatCtx) => ReactNode
  /** A "box" in its tab, but embedded as tall as it draws (a base's table), not a fixed height (a canvas: 360px);
   *  `|400` still sets one. */
  autoHeight?: boolean
  /** The extension its source is highlighted as ("yaml" for a .base), when it isn't JSON. */
  source?: string
}
export type FormatCtx = { store: Store; path: string
  /** The file's whole text as it is now, frontmatter included (the user's edits, and changes made on disk merged in).
   *  "" for a `binary` format. */
  text: string
  /** A `binary` format's file: the address of its bytes (fetch it; a new one when the file changes). */
  url?: string
  /** Editing (live preview) rather than reading, and the file can be written. */
  editable: boolean
  /** The drawing changed: its new text (the core saves it a moment later). */
  onChange: (text: string) => void
  /** Where it is: its own tab ("page"), the phone's sheet, or embedded in another file. */
  place: "page" | "sheet" | "embed"
  /** Embedded with a height (`![[Spending.html|400]]`): for a format that isn't a "box", which sizes itself otherwise. */
  height?: number
  /** Embedded: what follows its name in the embed (`![[Books.base#Reading]]`: "Reading"), and the file it's in. */
  subpath?: string; host?: string }
/** A kind of entry in a timeline (a `## Timeline` section a file's kind draws: a person's): how its rows look. */
export type TimelineKind = { label: string; icon: LucideIcon; tint?: string }
export type SearchDoc = {
  id: string; title: string; meta: string; kind: string; icon: LucideIcon; tint: string
  /** Where it goes: a detail sheet ("note/…"). */
  detail?: string
  /** Or a file it opens ("Notes/Idea.md"). */
  file?: string
  /** Or a tab it goes to ("view:terminal/k3j2"): the one showing it, else a new one. */
  to?: string
  /** Or what picking it does (a machine: a terminal there); `newTab` when picked with ⌘. */
  run?: (newTab: boolean) => void
  /** What else it's found by (not shown): a note's body, a person's context. A word found here, and not in its title,
   *  shows the part of it around the word instead of `meta`. */
  text: string; recent: number
  /** Ranking boost (pages 12, people 10, notes 8, books 4, logs 0). */
  weight?: number
  /** Archived (the core sets it from its `file`): ranked after everything else. */
  archived?: boolean
  /** In the excluded files (the core sets it from its `file`): ranked after the rest, never suggested. */
  excluded?: boolean
}
/** Something a [[wikilink]] can point to: `names` match exactly (any case), after files' names and paths. An archived
 *  one loses every tie. */
export type LinkTarget = { kind: string; id: string; title: string; detail: string; names: string[]; archived?: boolean
  /** The file it is, when it's one (filled in by the core from `id`, a vault path). Links to it open the file. */
  file?: string }

/** A coding agent it brings (Claude Code, Codex), run by the Terminal plugin in a tab (`view:terminal/<name>-<id>`;
 *  resume-<name>-<session> resumes). How to start it is its backend's service "agent:<name>". */
export type AgentDef = { label: string; icon: LucideIcon; tint?: string
  /** Its program's names, when it runs in a plain terminal ("codex"): that terminal shows as the agent too. */
  process?: string[]
  /** Its accounts, when it has several: a route answering [{id, label}], the one its bare name runs first. The terminal
   *  id then names the account (`<name>_<account>-<id>`), passed to "agent:<name>" as AgentStart.profile. */
  accounts?: string
  /** The view that shows one of its sessions, `view:<session>/<session id>` ("claude-session"): where a click on
   *  something about a session goes when no terminal of the app runs it (the Inbox's events). */
  session?: string }

/** A kind of tab it opens that isn't a file (a terminal), desktop only. The tab's target is `view:<name>` or
 *  `view:<name>/<arg>` (arg: which one, e.g. a terminal session id); open one with openView (the plugin API). */
export type ViewDef = {
  /** Its tab's icon. */
  icon: LucideIcon
  /** Picks its tab's icon per tab (a Claude Code terminal), else `icon`. Its own field, as an icon can be a plain
   *  function too (a brand's mark). */
  iconFor?: (arg: string) => LucideIcon
  /** The tab's label. It may read live data the plugin keeps (a terminal's session name): call `viewsChanged()` (the
   *  plugin API) when that changes, and every tab is drawn again. */
  title: (arg: string) => string
  /** Classes for its tab's icon, after its own (a status: a colour, a pulse), like a sidebar row's `iconClassName`. */
  iconClass?: (arg: string) => string | undefined
  /** Its tab's icon colour (a CSS colour, like a file's tint: a coding agent's own). */
  iconTint?: (arg: string) => string | undefined
  /** A dot on its tab's icon: something wants the user (a coding agent waiting for an answer). */
  iconBadge?: (arg: string) => boolean
  /** The arg is the view's own state (a search's query), changed with `ctx.setArg`: the view isn't drawn afresh when it
   *  changes, and the tab keeps it (it's in the workspace's layout, so it survives a reload and shows on other devices). */
  argState?: boolean
  render: (ctx: ViewCtx) => ReactNode
  /** Draw edge to edge, filling the pane below the tab bar (no path bar, no page margins): a terminal. */
  full?: boolean
  /** Its tab is its own (a terminal): opening anything else from it (a link, the sidebar, Graph view) opens beside it,
   *  never in its place, so it's never navigated away from by accident. */
  keepsTab?: boolean
  /** Items for its tab's right-click menu, after Close and the splits (a terminal's End session). */
  tabMenu?: (arg: string) => (FileMenuItem & { danger?: boolean })[]
  /** The last tab showing it was closed (not moved, not navigated away from: it's still in that tab's history then;
   *  not while another tab has it, here or in another workspace). */
  onClose?: (arg: string) => void
  /** Before its last tabs close: what to ask, or null to close without asking. Only for what closing would lose (a
   *  terminal doesn't ask: its process keeps running); closing from its own ctx never asks. */
  confirmClose?: (args: string[]) => Promise<ConfirmOptions | null> | ConfirmOptions | null
}
export type ViewCtx = { store: Store; arg: string
  /** Its pane is the focused one (keyboard focus goes there). */
  focused: boolean
  /** Close its tab (as if the user did: onClose runs). */
  close: () => void
  /** Change its tab's arg in place (no history entry): `view:search/<query>` as the query is typed (see `argState`). */
  setArg: (arg: string) => void }
export type NewTabCtx = { store: Store; phone: boolean }
/** A section of a blank tab's page (see `newTab` in PluginDef). The page is the app's sections (Buttons sort 10,
 *  Recently opened here 20, Recently changed 30) and the plugins', in .vaultite/newtab.json's order, else by `sort`.
 *  Drawn at the sidebar's sizes (SidebarRow: 13px text, h-7 rows, text at `pl-1.5`, no padding of its own): the page
 *  draws every section a size up as one (`data-size-up`, on phones too). */
export type NewTabSection = {
  /** Its name where the page is changed (the blank tab's right-click menu, `vau newtab`): "Terminals". */
  title: string
  render: (ctx: NewTabCtx) => ReactNode
  /** Its place in the default page (newtab.json unset). */
  sort?: number
  /** Out of the default page until the user shows it. */
  hidden?: boolean
  /** The heading drawn over it: `title` unless set; `false`: none (it draws its own, or needs none: tiles). */
  heading?: string | false
  /** Drawn only on phones, or only on computers. */
  only?: "phone" | "desktop"
}

/** A panel in the desktop sidebar (search, pinned pages, the file tree). The sidebar is only the panels of plugins that
 *  are on: turn a plugin off and its panel goes. */
export type SidebarPanel = {
  /** Its name in the sidebar's right-click menu, where it's shown or hidden ("Terminals"). */
  title: string
  render: (ctx: SidebarCtx) => ReactNode
  /** Its place, top to bottom, in the default setup (a vault without .vaultite/sidebars.json: Search 0, Pinned 10,
   *  Terminals 30, Files 35) and in the sidebar's Panels menu. */
  sort?: number
  /** Not in the sidebar until the user shows it (the sidebar's right-click menu, Panels): left out of the default
   *  setup, and not added when its plugin is turned on (Links, Local graph). */
  hidden?: boolean
  /** In the icon rail it's this one icon, opening the panel beside the rail until a click outside, Escape
   *  or the focused tab changing. Without it, the panel draws its own rail icons with `open: false`, or nothing. */
  flyout?: { icon: ComponentType<{ className?: string; strokeWidth?: number }>; width?: number }
  /** Draws more than a flyout fits or has no height of its own (the file tree, a graph): it gets a fixed, scrolling
   *  height in a flyout (`bounded`), and takes the room other panels leave in the sidebar. */
  tall?: boolean
  /** The heading the sidebar draws over it, its name and the handle to drag it by: `title` unless set ("Pinned").
   *  `false`: it has none (the search field) or draws its own, with buttons (`SidebarHeading`: Files, Terminals). */
  heading?: string | false
  /** Buttons on the heading the sidebar draws, shown on hover (Pinned's: pin the current file). */
  actions?: (ctx: SidebarCtx) => ReactNode
  /** Its own items at the top of its right-click menu, above Open in a tab and Panels ▸ (the File explorer's: show
   *  hidden files). Asked each time the menu opens, so a toggle names what it does now. */
  menu?: () => FileMenuItem[]
  /** Draws an icons-only form with `dock` (Buttons): a phone can draw it in its drawer's dock, at the thumb, instead. */
  dockable?: true
  /** Other names people call it by ("file tree", "explorer"), for `vau panels`; core/appsource.ts reads them from the
   *  source, so keep them a plain list of strings. */
  names?: string[]
  /** The view that shows this panel in a tab, so its heading drags onto a pane and its menu has "Open in a tab". Give
   *  every panel one: without it, it reads as a panel that can't be dragged (`npm run check` says so). */
  view?: string
}
export type SidebarCtx = { store: Store
  /** The sidebar is open; false: it's the icon rail (44px), where a panel shows icons in line with the others, or nothing. */
  open: boolean
  /** Drawn in a flyout beside the rail (a panel with `flyout`), with `open` true. */
  flyout?: boolean
  /** In a box of its own height (a
   *  `tall` panel in a flyout): it scrolls in it. Otherwise it's as tall as what it draws, and the sidebar scrolls. */
  bounded?: boolean
  /** The file in the focused tab ("" when it isn't a file). */
  file: string
  /** The focused tab's target ("file:Notes/Idea.md", "view:terminal/abc", "plugins"). */
  tab: string
  /** This panel's key ("pages:pages"), for its own menu: end it with `panelMenu(panel)` (Panels ▸, Separate from tabs, Move to the other sidebar). */
  panel?: string
  /** Drawn on a phone: a header item at the top of the phone's tab list (iOS sizes, 44px targets), or a panel in the
   *  phone's drawer (the desktop sidebar's panels, drawn a size up, without dragging: components/PhoneDrawer.tsx). */
  phone?: boolean
  /** In a phone drawer's dock (a `dockable` panel, `open` false): 44px icons in a row that wraps, a held one its menu. */
  dock?: boolean }

/** Drawn at the right end of the sidebar's header (Workspaces' numbers); with the sidebar folded, at the top of the
 *  28px icon rail with `open: false`; on phones at the top of the tab list with `phone: true`. */
export type HeaderItem = {
  render: (ctx: SidebarCtx) => ReactNode
  /** Its place, left to right, when several plugins have one. */
  sort?: number
  /** On phones, drawn at the left of the tab list's bottom bar (where the thumb is) rather than its top row. */
  phoneBar?: boolean
}

/** The file a file bar item is drawn for, as in its editor now: `fm` (a change redraws, typing doesn't), `type`, and
 *  `setProperty` to change one key as a small edit (absent when the file can't be changed here). */
export type FileHead = { path: string; fm: Record<string, unknown>; type: string | null; setProperty?: (key: string, value: unknown) => void }
/** The file a status item is drawn for: its head, and its whole text, frontmatter included ("" for a file that isn't
 *  text: an image), as typed (each change redraws it, a moment after the keystroke). */
export type OpenFile = FileHead & { text: string }

/** Drawn in the desktop status bar for the focused file: before its view and counts (Vim's mode), or `after` them
 *  (Token count). Nothing when render answers null. */
export type StatusItem = {
  render: (file: OpenFile) => ReactNode
  /** Its place, left to right, when several plugins have one. */
  sort?: number
  /** After the file's counts, not before its view button. */
  after?: boolean
}

/** Drawn at the start of the desktop status bar whatever is open (routines done today, agents at work, the inbox):
 *  small, a click away from its page. The user picks which (appearance `statusBar`). Nothing when render answers null. */
export type AmbientItem = {
  /** Its name in the bar's menu ("Routines today"). */
  title: string
  render: () => ReactNode
  sort?: number
  /** Off until the user turns it on. */
  hidden?: boolean
}

/** Drawn in a file's header: on desktop in the tab's top bar before the view button (`place: "bar"`), in a sheet and
 *  on phones above the title (`place: "line"`). Nothing when render answers null. */
export type FileBarItem = {
  render: (file: FileHead & { place: "bar" | "line" }) => ReactNode
  /** Its place, left to right, when several plugins have one. */
  sort?: number
}

/** Drawn in a note's page under its properties, above its text (a toolbar, a banner): every Markdown file, in every
 *  mode but source. Nothing when render answers null. */
export type NoteTopItem = {
  render: (file: FileHead) => ReactNode
  /** Its place, top to bottom, when several plugins have one. */
  sort?: number
}

/** A plugin that keeps the sidebars' setup itself (Workspaces), in sidebars.json's
 *  shape: `get` null means sidebars.json applies; call `sidebarsChanged()` when `get`'s answer changes. */
export type SidebarSetup = { get: () => Sidebars | null; set: (next: Sidebars) => void }

/** A workspace as other plugins see it: its number, its name (or "Workspace 2") and the places its tabs show (tab
 *  targets: "view:terminal/abc", "file:Notes/Idea.md"). */
export type WorkspaceInfo = { n: number; label: string; places: string[] }
/** A plugin that keeps workspaces. The rest of the app reads them through web/src/core/scope.ts, never from the plugin;
 *  call `workspaceChanged()` when any answer changes. */
export type WorkspaceHost = {
  /** The current workspace, 1 to 5: there always is one. */
  current: () => number
  /** The workspaces in use, and the current one, in order. */
  list: () => WorkspaceInfo[]
  /** Go to workspace n (an unused one starts blank). */
  switchTo: (n: number) => void
  /** The workspaces to go to, a new one, then the current one's actions (the phone's tab list). */
  menu: () => MenuItem[]
  /** A value kept in the current workspace (its `state`, by key: "files:open"), shared by every device on it. */
  get: (key: string) => unknown
  /** Keep a value in the current workspace (undefined or null: remove it). */
  set: (key: string, value: unknown) => void
  /** The current workspace's pinned pages (vault paths, in order), or null while it has no list of its own: it then
   *  shows the vault's (.vaultite/pages.json, the default new workspaces start with). */
  pinned: () => string[] | null
  /** Pin a page in the current workspace (at the end, or before `before`) or unpin it there. A workspace without a list
   *  of its own starts from `base` (the vault's list as the app has it) and keeps its own from then on. */
  pin: (path: string, on: boolean, before: string | null | undefined, base: string[]) => Promise<unknown>
}

/** An entry in the editor's slash menu: `text` replaces the "/query" ("$|" marks the cursor), or `run` does something
 *  else with the function that types text there. */
export type SlashItem = { id: string; title: string
  /** Its group in the menu ("Blocks", "Templates"). */
  section?: string
  /** Other words it's found by ("h1 title"). */
  keywords?: string
  /** A short hint drawn at the right. */
  detail?: string
  /** It starts a line of its own (a heading, a block): typed after a line break when the "/" isn't at the start. */
  line?: boolean
  text?: string
  run?: (insert: (text: string) => void) => void | Promise<void> }

/** How the vault wants new files placed and links written, when it says so itself (another app's settings in it);
 *  undefined leaves it to the app. The first plugin that's on and answers wins. */
export type Conventions = {
  /** The folder a new note goes in ("" = the top). `from`: the file the user is on ("" for none). */
  newNoteFolder?: (store: Store, from: string) => string | undefined
  /** Links are written as Markdown links (`[Note](Note.md)`), not [[wikilinks]]: [[ suggestions, pasted images. */
  markdownLinks?: (store: Store) => boolean | undefined
  /** The editor's settings the vault sets (spellcheck, indent...), under the app's own editor.json. */
  editor?: (store: Store) => Partial<EditorSettings> | undefined
}
/** Which editor a plugin's editor extensions go into: a note (Markdown, live preview or source), a code file, or other
 *  text (JSON, an artifact's HTML, a CSV's source); `path`: its file, when it's one. */
export type EditorCtx = { kind: "markdown" | "code" | "text"
  /** The file, only in its own view: a canvas card, an embed or a field has none. Its editor holds the file's whole
   *  text, frontmatter too, so positions are the file's (outside source mode the frontmatter is hidden). */
  path?: string
  /** Source mode: the frontmatter shown as text, not as Properties. */
  source?: boolean }
/** CodeMirror extensions it adds to the editor (Vim), before the editor's own keymaps so its keys win. A promise lets
 *  it load only when on; open editors take them in and drop them as it's switched. */
export type EditorExtension = (ctx: EditorCtx) => Extension | Promise<Extension>

/** An item in a file's menu. `section`: "actions" (default, top level: what a file of its kind is for), "navigate",
 *  "more" (the More submenu, where most items belong), or a group of its own. Keep the top level short. */
export type FileMenuItem = { label: string; icon?: LucideIcon; run: () => void; disabled?: boolean; section?: string
  /** Do it to several files at once (core/select.ts: files selected together), saying so once. Offered for a selection
   *  only when every file's menu has this item (same label) with `many`. */
  many?: (paths: string[]) => void
  /** A submenu, as a menu item's (`split`: clicking the row still runs `run`, the rest in its submenu). */
  items?: FileMenuItem[]; split?: boolean; hint?: string }

/** A button a plugin adds to a web page's bar in the Web viewer (its icon, `label` its tooltip), also in its tab's menu. */
export type WebPageAction = { label: string; icon: LucideIcon; run: () => void }

/** An icon a plugin gives a file or folder: `icon` a name (Lucide's, a plugin's, or an emoji), `tint` a colour token
 *  (`green`). */
export type FileIcon = { icon: string; tint?: string }

/** A short mark after a file's name in the file tree (Token count's size over its limit), with its tooltip. */
export type FileMark = { text: string; tip: string; tone?: "red" | "orange" }

/** Classes, attributes and a style for a part of a file tree row. */
export type FileRowPart = { className?: string; attrs?: Record<string, string>; style?: string }
/** What a plugin draws into a file tree row itself (`fileRows`): on the row and its name, and elements before the
 *  name (in place of the row's icon) or after it. Elements are copied into each tree showing the row. */
export type FileRow = { row?: FileRowPart; name?: FileRowPart; before?: Node[]; after?: Node[] }

/** A kind of file it makes, in the New submenu: `make` writes one in `folder` ("" the top) and answers its path, which
 *  opens with its name ready to type. */
export type NewFile = { label: string; icon: LucideIcon; make: (folder: string) => Promise<string> }

/** Something it can do from the command palette (⌘P); `keys` also bind it ("Mod+Shift+T"). */
export type PluginCommand = { id: string; name: string; keys?: string[]; when?: () => boolean; run: () => void
  /** Only on computers (a split, the sidebar: phones have neither). */
  desktop?: boolean
  /** Its icon (a component, or a Lucide name: `mic`; its plugin's when left out) and a shorter name where it's a button
   *  (a blank tab's: core/newtab.ts). After `run` in the source. */
  icon?: ComponentType<{ className?: string; strokeWidth?: number }> | string; label?: string }

/** A row of its settings panel, for the Settings page's search: what it says, and `key`, the row's `data-setting`, to
 *  go to it. */
export type SettingsSearchEntry = { label: string; description?: string; key?: string }

export type PluginDef = {
  /** Icons it adds by name: a file's `icon:` can name them (a dashboard's `icon: claude`), and other plugins draw them
   *  with iconNamed("claude") (the plugin API) without importing it. */
  icons?: Record<string, LucideIcon>
  details?: Record<string, DetailDef>
  /** What the quick switcher and the search tab find by name: its things, from the store. */
  search?: (store: Store) => SearchDoc[]
  /** Things it finds that aren't in the store (running terminals): `docs` is asked whenever search looks, and
   *  `subscribe` says when they change while search is open. */
  searchLive?: { docs: () => SearchDoc[]; subscribe: (changed: () => void) => () => void }
  links?: (store: Store) => LinkTarget[]
  /** Web links clicked in the app: true when it opened one itself (the Web viewer), false to leave it to the browser.
   *  The first plugin that's on and takes it wins. */
  webLink?: (url: string, how: { mod: boolean }) => boolean
  /** Links of another app's scheme clicked in the app (`<app>://open?file=…`, `zotero://…`): true when it took one.
   *  The first plugin that's on and takes it wins; none: the link does nothing. */
  schemeLink?: (url: string, how: { mod: boolean }) => boolean
  /** What the Plugins sheet shows, with made-up data: a render, or the id of the plugin whose dashboards (pages/*.md)
   *  to show (a plugin whose blocks are on Projects previews "projects"). Defaults to its own dashboards. */
  preview?: ((mock: Store) => ReactNode) | string
  /** Made-up data for previews: its keys of the store (what its plugin.ts puts in /api/state), made from the real
   *  store where that's configuration, not personal data (the logs' areas). */
  mock?: (real: Store) => Partial<Store>
  /** Made-up answers for its live routes in previews, by path ("calendar": {events: [...]}). */
  mockLive?: () => Record<string, unknown>
  /** How its files look when opened (see FileView). */
  files?: FileView
  /** Kinds of files it draws, by extension (see FileFormat). */
  formats?: Record<string, FileFormat>
  /** A format for one Markdown file, decided by the file as it opens (a hosted plugin taking a note's leaf:
   *  Kanban's boards); null leaves it to the app. Wins over `formats`; its source view is still the file's text. */
  fileFormat?: (path: string) => FileFormat | null
  /** What it draws where a file has a ```block-<name> fence (YAML options inside). Each is declared in its manifest and
   *  has a text side in plugin.ts, for /api/render: `npm run check` holds the app's plugins to both. */
  blocks?: Record<string, (ctx: BlockCtx) => ReactNode>
  /** Code fences it draws by language (```base). Its backend reads one as text
   *  with the service `fence:<lang>`. */
  fences?: Record<string, (ctx: BlockCtx) => ReactNode>
  /** Kinds of timeline entries it knows ("call": a phone icon), for the `## Timeline` sections kinds draw (a person's). */
  timeline?: Record<string, TimelineKind>
  /** Tabs it can open that aren't files (see ViewDef), by name: `view:<name>`. */
  views?: Record<string, ViewDef>
  /** Coding agents it brings, by name (see AgentDef): the Terminal plugin runs them. */
  agents?: Record<string, AgentDef>
  /** Its commands, listed in the command palette while it's on. */
  commands?: PluginCommand[]
  /** What it adds to every editor (see EditorExtension). */
  editor?: EditorExtension
  /** Its entries in the editor's slash menu (see SlashItem). Every plugin's blocks are offered there already. */
  slash?: (store: Store) => SlashItem[]
  /** Its panels in the desktop sidebar, by name (see SidebarPanel). */
  sidebar?: Record<string, SidebarPanel>
  /** What it draws in the desktop sidebar's header, by name (see HeaderItem). */
  header?: Record<string, HeaderItem>
  /** What it draws in the status bar, by name (see StatusItem). */
  status?: Record<string, StatusItem>
  /** What it draws in the status bar whatever is open, by name (see AmbientItem). */
  ambient?: Record<string, AmbientItem>
  /** What it draws in a file's header, by name (see FileBarItem). */
  fileBar?: Record<string, FileBarItem>
  /** What it draws at the top of a note's page, by name (see NoteTopItem). */
  noteTop?: Record<string, NoteTopItem>
  /** Content with a text size of its own apart from the app's zoom (core/textsize.ts), by id: it gets ⌘+scroll
   *  (`useTextSizeWheel`), commands and a Settings row; the view reads `useTextSize(id)`. */
  textSizes?: Record<string, TextSizeKind>
  /** Names for the first steps of its commands' key sequences, which the keys hint shows while one is under way
   *  (`{"Space F": "Files"}`; steps spelled as in `keys`). */
  keyGroups?: Record<string, string>
  /** Keeps the sidebars' setup itself, instead of sidebars.json (see SidebarSetup). */
  sidebarSetup?: SidebarSetup
  /** Where new files go and how links are written, as the vault says (see Conventions). */
  conventions?: Conventions
  /** The places open in tabs it keeps off screen (other workspaces' tabs), so closing a tab here doesn't end what it
   *  shows (a terminal's shell) while one of those still has it. */
  openElsewhere?: () => string[]
  /** Keeps workspaces (see WorkspaceHost): one plugin at a time, the first that's on. */
  workspace?: WorkspaceHost
  /** Items it adds to a vault file's menu (the tree, the tab, the phone's …), for that file's path; [] for none. */
  fileMenu?: (path: string) => FileMenuItem[]
  /** Items it adds to a text editor's right-click menu (desktop), for that editor (`path`: its file); [] for none. */
  editorMenu?: (ctx: { view: EditorView; path?: string }) => MenuItem[]
  /** Items it adds to a folder's menu in the file tree, for that folder's path; [] for none. */
  folderMenu?: (path: string) => FileMenuItem[]
  /** Buttons it adds to a web page's bar in the Web viewer (see WebPageAction), for the page shown; [] for none. */
  webPageActions?: (page: { url: string; title: string }) => WebPageAction[]
  /** Marks on files in the file tree, by path, from the store (keep it to the few files that need one). */
  fileMarks?: (store: Store) => Record<string, FileMark>
  /** Icons it gives files and folders, by path, from the store, wherever the app draws a file's icon (the tree, tabs,
   *  lists); a file's own `icon:` wins. The first plugin's wins. */
  fileIcons?: (store: Store) => Record<string, FileIcon>
  /** Rows of the file tree it draws into itself, by path (see FileRow); call `fileRowsChanged()` when they change.
   *  Keep a row's object the same while it says the same: only rows whose object changed are drawn again. */
  fileRows?: () => Record<string, FileRow>
  /** Where a device's first tab goes and where a phone with nowhere to be goes: a tab target, or null. The first plugin
   *  that's on and answers wins; with none, a new tab. */
  home?: (store: Store) => string | null
  /** Sections it adds to a blank tab's page, by name ("<plugin id>:<name>", arranged in newtab.json). */
  newTab?: Record<string, NewTabSection>
  /** A row in Settings' Setup panel, for a plugin that's part of setting the app up (Connections). Nothing else of a
   *  plugin is on the Settings page. */
  setup?: { label: string; sub: string; run: () => void }
  /** Its settings sheet, for what a form from its manifest's `settings`
   *  can't say: `SettingRow`s in `Group`s, no `Panel`s. Plugins never add to the Settings page, but for `setup`. */
  settingsPanel?: (ctx: { store: Store }) => ReactNode
  /** What its settingsPanel has, for the Settings page's search (its manifest's `settings` are found by themselves). */
  settingsSearch?: SettingsSearchEntry[]
  /** Kinds of files it makes, in the New submenu after New note in the file tree's menus (see NewFile). */
  newFiles?: NewFile[]
  /** Runs while it's on, drawn nowhere, in every open window and device: listen and draw there (Workspaces keeps tabs in
   *  step), never write on a timer. What must happen once is the server's: plugin.every. Return null. */
  background?: (ctx: { store: Store }) => ReactNode
}

export type Plugin = Omit<Manifest, "blocks" | "settings" | "icon"> & PluginDef & {
  /** Its manifest's icon (Puzzle for none). */
  icon: LucideIcon
  /** Its manifest's `blocks`: what each of its blocks shows and its options (core/blocks.ts). */
  blockDecls: BlockDecls
  /** Its manifest's `settings`: its data.json's keys, typed, which its settings sheet draws as a form. */
  settingsDecls: SettingDecls
  /** core: built-in, shipped with the app (plugins/core/); vault: the vault's own (.vaultite/plugins/<id>/); hosted:
   *  brought at runtime by another plugin, its `host` (hostPlugins). */
  tier: "core" | "vault" | "hosted"
  /** A hosted plugin's host: the plugin that runs it and answers its switch. */
  host?: string
  /** A vault plugin's folder in the vault. */
  folder?: string
  /** What's wrong with a vault plugin (rules it breaks, why it couldn't load or build): it's off then. */
  problems?: string[]
  /** What a vault plugin should fix but runs anyway: a block without its declaration or its text side. */
  warnings?: string[]
  /** A vault plugin's version (its bundle's): a block drawn by an older one starts afresh. */
  version?: string
  /** A vault plugin's dashboards as it ships them (pages/*.md). */
  pages?: { name: string; text: string }[]
  /** A vault plugin's version, author, repo and disclosures, where it came from, and whether this machine lets it run. */
  meta?: VaultMeta
}

export const definePlugin = (def: PluginDef) => def

/** A plugin another plugin runs (a plugin written for another app, run by its host): listed on the Plugins
 *  page in its host's group and drawn like any plugin, while its host answers its switch, its approval and its removal
 *  (PluginHost). */
export type HostedPlugin = PluginDef & { id: string; name: string; icon: LucideIcon; description?: string; category?: string; tint?: string
  version?: string; author?: string
  /** Its home page (the author's or its repository's), shown in its sheet. */
  url?: string
  /** On in its host (its own switch). */
  on: boolean
  /** On, but waiting for this machine's owner to allow its code (Allow in its sheet asks the host): "changed" when
   *  its code changed since it was allowed. */
  waiting?: boolean | "new" | "changed"
  replaces?: Record<string, string[]>
  /** Why it couldn't load: it's off then. */
  problems?: string[]
  /** What it can do beyond the vault, as a vault plugin's manifest says it (shown before it's allowed). */
  disclosures?: Disclosures }
/** What hosts plugins (hostPlugins): its group's name on the Plugins page and the answers to its plugins' buttons. */
export type PluginHost = { title: string
  /** A plugin of it, lower case: in its sheet's kicker and in sentences ("plugin from another app"). */
  kind: string
  /** A line under its group's title. */
  intro?: string
  setOn: (id: string, on: boolean) => unknown
  allow?: (id: string) => unknown
  uninstall?: (id: string) => unknown
  /** Where to find more of its plugins: a source on the Plugins page's Browse. */
  browse?: BrowseSource
  /** What its plugins can do once allowed, said before one first runs ("It runs with the app's full access…"). */
  trust?: string }
/** A source of plugins to install on the Plugins page's Browse (a host's: another app's plugins). */
export type BrowseSource = { title: string
  /** Its sort orders (the first is the default). */
  sorts?: { value: string; label: string }[]
  search: (query: string, sort: string) => Promise<{ available: boolean; entries: BrowseEntry[]; total?: number }>
  install: (id: string) => Promise<unknown>
  /** A line under the list. */
  note?: string }
export type BrowseEntry = { id: string; name: string; author?: string; description?: string; url?: string
  /** A short figure after its name ("1.2M downloads"). */
  stat?: string
  badges?: { text: string; tone?: "green" | "orange" | "red"; tip?: string }[]
  installed: boolean
  /** Its id once installed (a hosted plugin's), to show it among the installed ones. */
  plugin?: string
  /** A plugin here that does its job (Vaultite's Excalidraw for another app's), offered before the original: `use`
   *  installs it if needed and turns it on; `id` shows it among the installed ones. */
  standIn?: { id: string; name: string; on: boolean; use: () => Promise<unknown> } }


/** A detail path with its parts encoded (ids have slashes: "People/Alice Park"). */
export const detailPath = (kind: string, ...args: string[]) => [kind, ...args.map(encodeURIComponent)].join("/")
