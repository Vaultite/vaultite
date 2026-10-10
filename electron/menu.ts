// The Mac's menu bar: the focused window's commands as its page tells them (`MenuSnapshot`), never copies of them;
// only keys the page left reach an accelerator. Icons: lucide's, rendered by tools/menu_icons.ts. electron/CLAUDE.md.
import { nativeImage, type MenuItemConstructorOptions, type NativeImage } from "electron"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const ICONS = path.join(path.dirname(fileURLToPath(import.meta.url)), "menu-icons")
const MAC = process.platform === "darwin"
/** The command key in accelerators: ⌘ on a Mac, Ctrl elsewhere (Electron's Cmd is the Super key on Linux). */
const MOD = MAC ? "Cmd" : "Ctrl"

/** What a vault window tells the menu (web/src/core/desktop.ts). */
export type MenuSnapshot = {
  /** Its commands now: keys in effect (`custom`: set in hotkeys.json, so none means none), `on`: available now. */
  commands: { id: string; name: string; keys: string[]; custom?: boolean; on: boolean }[]
  /** The current workspace's pinned pages and its files opened lately (vault paths, with a title). */
  pinned: { path: string; title: string }[]
  recent: { path: string; title: string }[]
}

export type MenuContext = {
  /** The focused vault window's snapshot (null: none, or not told yet). */
  snap: MenuSnapshot | null
  /** Run a command in the focused vault window. */
  run: (id: string) => MenuItemConstructorOptions["click"]
  /** Open a vault file in the focused vault window's current tab. */
  go: (path: string) => void
  /** The App menu's update item, if this build updates itself. */
  update: MenuItemConstructorOptions | null
  vaults: MenuItemConstructorOptions[]
  manageVaults: () => void
  /** Set up Vaultite (the first-run window, again). */
  setup: () => void
  pickOutside: () => void
  zoom: (step: -1 | 0 | 1) => () => void
  /** Help: one of the app's own documents (README.md, CHANGELOG.md) in a tab. */
  openDoc: (name: string) => void
  /** Help: the repo's issues page, when the app knows its repo. */
  issues: string | null
  openExternal: (url: string) => void
  showLogs: () => void
  /** Window ▸ Maximize (off a Mac, whose Zoom is a role): the focused window maximized, or back. */
  maximize: () => void
  /** Help ▸ Open the playground (the sandbox), when the app has one. */
  sandbox?: () => void
}

// ---------- icons ----------
const icons = new Map<string, NativeImage | null>()
function icon(name: string | undefined) {
  // Template images are a Mac's: GTK menus draw them black, unseen on a dark theme, and don't tint them.
  if (!name || !MAC) return undefined
  if (!icons.has(name)) {
    const file = path.join(ICONS, `${name}.png`)
    let img: NativeImage | null = null
    if (fs.existsSync(file)) {
      img = nativeImage.createFromPath(file) // (picks up <name>@2x.png)
      img.setTemplateImage(true)
      if (img.isEmpty()) img = null
    }
    icons.set(name, img)
  }
  return icons.get(name) ?? undefined
}

// ---------- keys ----------
const KEY: Record<string, string> = {
  ArrowLeft: "Left", ArrowRight: "Right", ArrowUp: "Up", ArrowDown: "Down", Enter: "Return", Escape: "Esc", Space: "Space",
  Backspace: "Backspace", Delete: "Delete", Tab: "Tab", Home: "Home", End: "End", PageUp: "PageUp", PageDown: "PageDown",
  "+": "Plus",
}
/** A command's keys ("Mod+Shift+\\") as an Electron accelerator ("Cmd+Shift+\\", "Ctrl+Shift+\\" off a Mac), or null: a sequence, a plain key,
 *  or a key Electron can't name. */
export function accelerator(keys: string): string | null {
  const k = keys.trim()
  if (!k || /\s/.test(k)) return null
  const parts = k.split(/\+(?!$)/)
  const key = parts.pop()!
  const mods = new Set(parts.map((m) => m.toLowerCase()))
  if (![...mods].some((m) => /^(mod|cmd|command|meta|ctrl|control|alt|option|opt)$/.test(m))) return null
  const name = KEY[key] ?? (key.length === 1 ? key.toUpperCase() : /^F\d{1,2}$/.test(key) ? key : null)
  if (!name) return null
  const out: string[] = []
  if (mods.has("mod") || mods.has("cmd") || mods.has("command") || mods.has("meta")) out.push(MOD)
  if ((mods.has("ctrl") || mods.has("control")) && !out.includes("Ctrl")) out.push("Ctrl")
  if (mods.has("alt") || mods.has("option") || mods.has("opt")) out.push("Alt")
  if (mods.has("shift")) out.push("Shift")
  return [...out, name].join("+")
}
/** The system's own items' keys (Edit's, the App menu's, zoom, full screen, reload, dev tools): never a command's. */
const SYSTEM_KEYS = new Set(MAC
  ? ["Cmd+Q", "Cmd+H", "Cmd+Alt+H", "Cmd+M", "Cmd+Z", "Cmd+Shift+Z", "Cmd+X", "Cmd+C", "Cmd+V", "Cmd+Alt+Shift+V", "Cmd+A",
    "Cmd+0", "Cmd+=", "Cmd+Plus", "Cmd+-", "Cmd+Ctrl+F", "Cmd+R", "Cmd+Shift+R", "Cmd+Alt+I", "Cmd+Shift+W", "Cmd+,"]
  : ["Ctrl+Q", "Ctrl+Z", "Ctrl+Shift+Z", "Ctrl+Y", "Ctrl+X", "Ctrl+C", "Ctrl+V", "Ctrl+Shift+V", "Ctrl+A", "Ctrl+0", "Ctrl+=",
    "Ctrl+Plus", "Ctrl+-", "F11", "Ctrl+R", "Ctrl+Shift+R", "Ctrl+Shift+I", "Ctrl+Shift+W", "Ctrl+,"])

// ---------- the menu ----------
export function menuTemplate(ctx: MenuContext): MenuItemConstructorOptions[] {
  const { snap } = ctx
  const byId = new Map((snap?.commands ?? []).map((c) => [c.id, c]))
  const used = new Set(SYSTEM_KEYS)

  /** An item running command `id`: hidden while it doesn't exist (its plugin is off) unless `always` (then greyed,
   *  with its default key), greyed while unavailable. `key`: its accelerator when the command has none. */
  const cmd = (id: string, label: string, ico?: string, o: { key?: string; always?: boolean } = {}): MenuItemConstructorOptions | null => {
    const c = byId.get(id)
    if (!c && !(o.always && CORE.has(id))) return null
    const keys = c && (c.custom || c.keys.length) ? c.keys : o.key ? [o.key] : []
    let accel: string | undefined
    for (const k of keys) {
      const a = accelerator(k)
      if (a && !used.has(a)) { accel = a; used.add(a); break }
    }
    return { label, icon: icon(ico), accelerator: accel, enabled: !!c?.on, click: ctx.run(id) }
  }
  /** The commands whose ids match, as items labelled by their names. */
  const all = (re: RegExp, ico?: string) => (snap?.commands ?? []).filter((c) => re.test(c.id)).map((c) => cmd(c.id, c.name, ico))
  /** A radio item for a setting command: the one whose command isn't available is the setting in effect. */
  const radio = (id: string, label: string) => {
    const c = byId.get(id)
    return c ? { label, type: "radio" as const, checked: !c.on, click: ctx.run(id) } : null
  }
  const sep: MenuItemConstructorOptions = { type: "separator" }
  /** A menu's items without the hidden ones, and without separators doubled or at either end. */
  const items = (...xs: (MenuItemConstructorOptions | null | false | undefined)[]) => {
    const out: MenuItemConstructorOptions[] = []
    for (const x of xs) {
      if (!x) continue
      if (x.type === "separator" && (!out.length || out[out.length - 1].type === "separator")) continue
      out.push(x)
    }
    while (out.length && out[out.length - 1].type === "separator") out.pop()
    return out
  }
  const sub = (label: string, ico: string | undefined, xs: MenuItemConstructorOptions[]) => (xs.length ? { label, icon: icon(ico), submenu: xs } : null)
  const files = (list: { path: string; title: string }[], ico: string) =>
    list.map((f) => ({ label: f.title, sublabel: f.path, icon: icon(ico), click: () => ctx.go(f.path) }))

  const settings = () => [
    cmd("page:settings", "Settings…", "settings", { key: "Mod+,", always: true }),
    cmd("hotkeys:open", "Hotkeys", "keyboard", { always: true }),
    cmd("page:plugins", "Plugins", "puzzle", { always: true }),
    cmd("bundles:choose", "Bundles", "package", { always: true }),
    { label: "Set up Vaultite", icon: icon("circle-play"), click: ctx.setup },
  ]

  return ([
    // A Mac's App menu; elsewhere its items are File's (settings, quit) and Help's (about, updates), as Linux apps have them.
    MAC && { role: "appMenu", submenu: items(
      { role: "about" },
      ctx.update && { ...ctx.update, icon: icon("refresh-cw") },
      sep,
      ...settings(),
      sep, { role: "services" }, sep, { role: "hide" }, { role: "hideOthers" }, { role: "unhide" }, sep, { role: "quit" },
    ) },
    { label: "File", submenu: items(
      cmd("file:new", "New note", "file-plus", { key: "Mod+N", always: true }),
      cmd("templates:new", "New note from template", "file-stack"),
      cmd("canvas:new", "New canvas", "layout-dashboard"),
      cmd("query:new-base", "New base", "table"),
      cmd("tab:new", "New tab", "square-plus", { key: "Mod+T", always: true }),
      cmd("tab:reopen", "Reopen closed tab", "rotate-ccw", { key: "Mod+Shift+T", always: true }),
      sep,
      cmd("terminal:open", "New terminal", "square-terminal"),
      cmd("terminal:claude", "New Claude Code session", "bot"),
      sep,
      cmd("switcher:open", "Open quick switcher", "search", { key: "Mod+O", always: true }),
      { label: "Open file from outside the vault…", icon: icon("folder-open"), click: ctx.pickOutside },
      { label: "Open vault", icon: icon("vault"), submenu: ctx.vaults.length ? ctx.vaults : [{ label: "No vaults yet", enabled: false }] },
      { label: "Manage vaults", icon: icon("library"), click: ctx.manageVaults },
      sep,
      cmd("file:rename", "Rename", "pencil", { always: true }),
      cmd("file:duplicate", "Duplicate", "copy", { always: true }),
      cmd("file:move", "Move to folder…", "folder-input"),
      cmd("file:pin", "Pin to sidebar", "pin"),
      cmd("file:unpin", "Unpin from sidebar", "pin-off"),
      cmd("file:reveal-finder", MAC ? "Reveal in Finder" : "Show in folder", "folder-search", { always: true }),
      cmd("file:reveal", "Reveal in file tree", "list-tree"),
      cmd("history:open", "Version history", "history"),
      sep,
      cmd("export-pdf:pdf", "Export to PDF…", "file-down"),
      cmd("export-pdf:print", "Print…", "printer"),
      sep,
      cmd("tab:close", "Close tab", "x", { key: "Mod+W", always: true }),
      cmd("tab:close-others", "Close other tabs", undefined, { always: true }),
      { label: "Close window", accelerator: `Shift+${MOD}+W`, role: "close" },
      !MAC && sep, ...(MAC ? [] : settings()),
      !MAC && sep, !MAC && { role: "quit", accelerator: "Ctrl+Q" },
    ) },
    { label: "Edit", submenu: items(
      { role: "undo" }, { role: "redo" }, sep,
      { role: "cut" }, { role: "copy" }, { role: "paste" },
      { role: "pasteAndMatchStyle", label: "Paste as plain text" },
      { role: "delete" }, { role: "selectAll" },
      sep,
      cmd("find:open", "Find in note", "search", { always: true }),
      cmd("find:replace", "Find and replace", "replace", { always: true }),
      cmd("search:open-tab", "Search the vault", "text-search"),
      sep,
      cmd("templates:insert", "Insert template", "file-stack"),
      cmd("file:copy-link", "Copy link to note", "link", { always: true }),
      cmd("file:copy-path", "Copy file path", "clipboard-copy", { always: true }),
      sub("Folding", "chevrons-down-up", items(
        cmd("folding:toggle", "Fold or unfold line"),
        cmd("folding:fold-all", "Fold all"),
        cmd("folding:unfold-all", "Unfold all"),
      )),
      sub("Origin", "bot", items(
        cmd("provenance:choose", "Label…"),
        cmd("provenance:human", "Written by you"),
        cmd("provenance:reviewed", "Reviewed"),
        cmd("provenance:mixed", "Written by you and AI"),
        cmd("provenance:ai", "Written by AI"),
        cmd("provenance:clear", "Remove the label"),
      )),
      sep,
      MAC && { label: "Speech", submenu: [{ role: "startSpeaking" }, { role: "stopSpeaking" }] },
    ) },
    { label: "View", submenu: items(
      cmd("palette:open", "Command palette", "command", { key: "Mod+P", always: true }),
      sep,
      cmd("sidebar:toggle", "Toggle left sidebar", "panel-left", { key: "Mod+\\", always: true }),
      cmd("sidebar:toggle-right", "Toggle right sidebar", "panel-right", { always: true }),
      cmd("view:toggle", "Toggle reading view", "book-open", { key: "Mod+E", always: true }),
      cmd("editor:toggle-line-numbers", "Toggle line numbers", "list-ordered", { always: true }),
      sep,
      cmd("graph:open", "Graph view", "waypoints"),
      cmd("graph:local", "Local graph", "git-fork"),
      cmd("slides:start", "Start presentation", "presentation"),
      sep,
      cmd("split:right", "Split right", "columns-2", { always: true }),
      cmd("split:down", "Split down", "rows-2", { always: true }),
      sep,
      sub("Appearance", "palette", items(
        radio("theme:light", "Light"), radio("theme:dark", "Dark"), radio("theme:system", "Match the system"),
        sep,
        radio("scheme:default", "Default colours"), radio("scheme:gruvbox", "Gruvbox"),
        cmd("scheme:choose", "More colour schemes…"),
        sep,
        cmd("density:toggle", "Toggle comfortable density"),
        cmd("file-icons:toggle", "Toggle file icons"),
      )),
      sub("Text size", "type", items(...all(/^text-size:/))),
      sep,
      { label: "Actual size", icon: icon("scan"), accelerator: `${MOD}+0`, click: ctx.zoom(0) },
      // ⌘= and ⌘+ (⇧⌘=, and the keypad's) both zoom in: Electron's zoomIn role only listens to ⌘+.
      { label: "Zoom in", icon: icon("zoom-in"), accelerator: `${MOD}+=`, click: ctx.zoom(1) },
      { label: "Zoom in", accelerator: `${MOD}+Plus`, click: ctx.zoom(1), visible: false, acceleratorWorksWhenHidden: true },
      { label: "Zoom in", accelerator: `${MOD}+numadd`, click: ctx.zoom(1), visible: false, acceleratorWorksWhenHidden: true },
      { label: "Zoom out", icon: icon("zoom-out"), accelerator: `${MOD}+-`, click: ctx.zoom(-1) },
      { label: "Zoom out", accelerator: `${MOD}+numsub`, click: ctx.zoom(-1), visible: false, acceleratorWorksWhenHidden: true },
      sep,
      { role: "togglefullscreen" },
      { label: "Developer", icon: icon("code"), submenu: items(
        { role: "reload" }, { role: "forceReload" }, { role: "toggleDevTools" },
        sep,
        cmd("vault:reload", "Reload the vault", "refresh-cw", { always: true }),
      ) },
    ) },
    { label: "Go", submenu: items(
      cmd("nav:back", "Back", "arrow-left", { always: true }),
      cmd("nav:forward", "Forward", "arrow-right", { always: true }),
      sep,
      cmd("today:daily-note", "Today's daily note", "calendar"),
      cmd("inbox:open", "Inbox", "inbox"),
      cmd("activity:open", "Activity", "activity"),
      cmd("web:open", "Web page…", "globe"),
      sep,
      sub("Pinned", "pin", files(snap?.pinned ?? [], "file-text")),
      sub("Recent files", "clock", files(snap?.recent ?? [], "file-text")),
    ) },
    { label: "Window", role: "window", submenu: items(
      { role: "minimize" }, MAC ? { role: "zoom" } : { label: "Maximize", click: ctx.maximize },
      sep,
      cmd("tab:next", "Next tab", "chevron-right", { key: "Ctrl+Tab", always: true }),
      cmd("tab:previous", "Previous tab", "chevron-left", { key: "Ctrl+Shift+Tab", always: true }),
      cmd("tab:toggle-pin", "Pin or unpin tab", "pin", { always: true }),
      cmd("tab:toggle-stacked", "Stack or unstack tabs", "layers", { always: true }),
      cmd("split:move-right", "Move tab to new split right"),
      cmd("split:move-down", "Move tab to new split down"),
      sep,
      cmd("workspace:next", "Next workspace", "layers"),
      cmd("workspace:previous", "Previous workspace", "layers"),
      MAC && sep,
      MAC && { role: "front" },
    ) },
    { label: "Help", role: "help", submenu: items(
      !MAC && { role: "about" },
      !MAC && ctx.update,
      !MAC && sep,
      { label: "Vaultite help", icon: icon("circle-help"), click: () => ctx.openDoc("README.md") },
      { label: "Release notes", icon: icon("scroll-text"), click: () => ctx.openDoc("CHANGELOG.md") },
      cmd("hotkeys:open", "Keyboard shortcuts", "keyboard", { always: true }),
      !!ctx.sandbox && { label: "Open the playground", icon: icon("flask-conical"), click: ctx.sandbox! },
      sep,
      !!ctx.issues && { label: "Report an issue", icon: icon("bug"), click: () => ctx.openExternal(ctx.issues!) },
      { label: "Show logs", icon: icon("file-terminal"), click: ctx.showLogs },
    ) },
  ] as (MenuItemConstructorOptions | false)[]).filter((x): x is MenuItemConstructorOptions => !!x)
}

/** Commands every vault window has (App.tsx's own, and the file's while one is open): shown greyed while unavailable. */
const CORE = new Set(["page:settings", "page:plugins", "hotkeys:open", "bundles:choose", "file:new", "tab:new", "switcher:open",
  "file:rename", "file:duplicate", "file:reveal-finder", "tab:close", "tab:close-others", "tab:reopen", "find:open", "find:replace",
  "file:copy-link", "file:copy-path", "palette:open", "sidebar:toggle", "sidebar:toggle-right", "view:toggle",
  "editor:toggle-line-numbers", "split:right", "split:down", "vault:reload", "nav:back", "nav:forward", "tab:next", "tab:previous",
  "tab:toggle-pin", "tab:toggle-stacked"])
