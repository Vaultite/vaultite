import fs from "node:fs"
import path from "node:path"
import { z } from "zod"
import type { Item, Vault } from "../../../core/vault.ts"
import { listSnippets, listThemes } from "../../../core/appearance.ts"

export type ObsidianSettings = {
  newFileLocation?: "root" | "current" | "folder"
  newFileFolderPath?: string
  attachmentFolderPath?: string
  useMarkdownLinks?: boolean
  userIgnoreFilters?: string[]
  spellcheck?: boolean
  useTab?: boolean
  tabSize?: number
  autoPairBrackets?: boolean
  autoPairMarkdown?: boolean
  readableLineLength?: boolean
  propertiesInDocument?: "visible" | "hidden" | "source"
  defaultView?: "editing" | "reading"
  editingMode?: "live" | "source"
}

const cache = new WeakMap<Vault, { mtime: number; value: ObsidianSettings | null }>()

export function obsidianSettings(vault: Vault): ObsidianSettings | null {
  const dir = path.join(vault.path, ".obsidian")
  const file = path.join(dir, "app.json")
  let mtime = -1
  try { mtime = fs.statSync(file).mtimeMs } catch {
    try { if (!fs.statSync(dir).isDirectory()) return null } catch { return null }
    return {}
  }
  const hit = cache.get(vault)
  if (hit && hit.mtime === mtime) return hit.value
  let raw: Item = {}
  try { raw = JSON.parse(fs.readFileSync(file, "utf8")) ?? {} } catch { /* half-synced or hand-broken: nothing from it */ }
  const out: ObsidianSettings = {}
  if (["root", "current", "folder"].includes(raw.newFileLocation)) out.newFileLocation = raw.newFileLocation
  if (typeof raw.newFileFolderPath === "string") out.newFileFolderPath = folder(raw.newFileFolderPath)
  if (typeof raw.attachmentFolderPath === "string" && raw.attachmentFolderPath.trim()) out.attachmentFolderPath = raw.attachmentFolderPath.trim()
  if (typeof raw.useMarkdownLinks === "boolean") out.useMarkdownLinks = raw.useMarkdownLinks
  if (Array.isArray(raw.userIgnoreFilters)) out.userIgnoreFilters = raw.userIgnoreFilters.filter((f: unknown): f is string => typeof f === "string" && !!f.trim())
  for (const k of ["spellcheck", "useTab", "autoPairBrackets", "autoPairMarkdown", "readableLineLength"] as const) if (typeof raw[k] === "boolean") out[k] = raw[k]
  if (Number.isInteger(raw.tabSize) && raw.tabSize >= 1 && raw.tabSize <= 8) out.tabSize = raw.tabSize
  if (["visible", "hidden", "source"].includes(raw.propertiesInDocument)) out.propertiesInDocument = raw.propertiesInDocument
  if (raw.defaultViewMode === "source" || raw.defaultViewMode === "preview") out.defaultView = raw.defaultViewMode === "source" ? "editing" : "reading"
  if (typeof raw.livePreview === "boolean") out.editingMode = raw.livePreview ? "live" : "source"
  cache.set(vault, { mtime, value: out })
  return out
}

const folder = (p: string) => p.trim().replace(/^\/+|\/+$/g, "")

const typesCache = new WeakMap<Vault, { mtime: number; value: Item }>()

export function obsidianTypes(vault: Vault): Item {
  const file = path.join(vault.path, ".obsidian", "types.json")
  let mtime = -1
  try { mtime = fs.statSync(file).mtimeMs } catch { return {} }
  const hit = typesCache.get(vault)
  if (hit && hit.mtime === mtime) return hit.value
  let value: Item = {}
  try {
    const t = JSON.parse(fs.readFileSync(file, "utf8"))?.types
    if (t && typeof t === "object" && !Array.isArray(t)) value = t
  } catch { /* half-synced or hand-broken: nothing from it */ }
  typesCache.set(vault, { mtime, value })
  return value
}

const jsonCache = new WeakMap<Vault, Map<string, { mtime: number; value: Item | null }>>()

function obsidianJson(vault: Vault, name: string): Item | null {
  const file = path.join(vault.path, ".obsidian", `${name}.json`)
  let mtime = -1
  try { mtime = fs.statSync(file).mtimeMs } catch { return null }
  let byName = jsonCache.get(vault)
  if (!byName) jsonCache.set(vault, byName = new Map())
  const hit = byName.get(name)
  if (hit && hit.mtime === mtime) return hit.value
  let value: Item | null = null
  try { const d = JSON.parse(fs.readFileSync(file, "utf8")); if (d && typeof d === "object" && !Array.isArray(d)) value = d } catch { /* half-synced or hand-broken */ }
  byName.set(name, { mtime, value })
  return value
}

const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined)
const keys = (o: Item) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined))

export function obsidianDefaults(vault: Vault): Record<string, Item> {
  const app = obsidianSettings(vault)
  if (app === null) return {}
  const out: Record<string, Item> = {}
  const files = keys({ excluded: app.userIgnoreFilters?.length ? app.userIgnoreFilters : undefined, attachmentFolder: app.attachmentFolderPath })
  if (Object.keys(files).length) out.files = files
  const t = obsidianJson(vault, "templates")
  if (t) {
    const set = keys({ folder: text(t.folder) && folder(t.folder), dateFormat: text(t.dateFormat), timeFormat: text(t.timeFormat) })
    if (Object.keys(set).length) out["plugins/templates/data"] = set
  }
  const d = obsidianJson(vault, "daily-notes")
  if (d) {
    // (Obsidian's daily notes go at the top when its folder is unset)
    out.folders = { days: typeof d.folder === "string" ? folder(d.folder) : "" }
    const set = keys({ format: text(d.format), template: text(d.template) && folder(d.template).replace(/\.md$/i, "") })
    if (Object.keys(set).length) out["plugins/daily-notes/data"] = set
  }
  const look = appearance(vault)
  if (Object.keys(look).length) out.appearance = look
  const bound = hotkeys(vault)
  if (Object.keys(bound).length) out.hotkeys = bound
  const pinned = palettePins(vault)
  if (pinned.length) out.palette = { pinned }
  return out
}

export type Bookmark = { path: string; label?: string }
const Mark = z.looseObject({ type: z.string(), path: z.string().trim().min(1).optional(), subpath: z.string().optional(), query: z.string().trim().min(1).optional(),
  url: z.url({ protocol: /^https?$/ }).optional(), title: z.string().optional(), items: z.array(z.unknown()).optional() })
type Mark = z.infer<typeof Mark>
const MarkList = z.array(z.unknown()).catch([]).transform((xs) => xs.flatMap((x) => { const m = Mark.safeParse(x); return m.success ? [m.data] : [] }))
const sub = (m: Mark) => m.subpath?.replace(/^#/, "") ?? ""
const AS_PIN = new Map<string, (m: Mark) => Bookmark | null>([
  ["file", (m) => (m.path ? { path: sub(m) ? `${folder(m.path)}#${sub(m)}` : folder(m.path) } : null)],
  ["folder", (m) => (m.path ? { path: folder(m.path) } : null)],
  ["search", (m) => (m.query ? { path: `search:${m.query}` } : null)],
  ["graph", () => ({ path: "view:graph" })],
  ["url", (m) => (m.url ? { path: `view:web/${m.url}`, label: text(m.title) } : null)],
])

export function obsidianBookmarks(vault: Vault): Bookmark[] {
  const out: Bookmark[] = []
  const walk = (marks: Mark[]) => {
    for (const m of marks) {
      if (m.type === "group") walk(MarkList.parse(m.items ?? []))
      const pin = AS_PIN.get(m.type)?.(m)
      if (pin && !out.some((x) => x.path === pin.path)) out.push(pin)
    }
  }
  walk(MarkList.parse(obsidianJson(vault, "bookmarks")?.items ?? []))
  return out
}

const PalettePins = z.object({ pinned: z.array(z.string().catch("")).catch([]) }).catch({ pinned: [] })
function palettePins(vault: Vault): string[] {
  const p = PalettePins.parse(obsidianJson(vault, "command-palette") ?? {}).pinned
  return [...new Set(p.filter((id) => !!id.trim()).map((id) => OBSIDIAN_COMMANDS[id] ?? id))]
}

export const OBSIDIAN_COMMANDS: Record<string, string> = {
  "command-palette:open": "palette:open", "switcher:open": "switcher:open", "global-search:open": "search:open-tab",
  "app:go-back": "nav:back", "app:go-forward": "nav:forward", "app:toggle-left-sidebar": "sidebar:toggle",
  "app:toggle-right-sidebar": "sidebar:toggle-right", "app:delete-file": "file:delete", "theme:use-dark": "theme:dark",
  "theme:use-light": "theme:light", "markdown:toggle-preview": "view:toggle", "graph:open": "graph:open", "graph:open-local": "graph:local",
  "file-explorer:new-file": "file:new", "file-explorer:reveal-active-file": "file:reveal", "file-explorer:move-file": "file:move",
  "file-explorer:duplicate-file": "file:duplicate", "workspace:edit-file-title": "file:rename", "workspace:copy-path": "file:copy-path",
  "workspace:new-tab": "tab:new", "workspace:close": "tab:close", "workspace:close-others": "tab:close-others",
  "workspace:next-tab": "tab:next", "workspace:previous-tab": "tab:previous", "workspace:goto-last-tab": "tab:goto-last",
  "workspace:undo-close-pane": "tab:reopen", "workspace:toggle-pin": "tab:toggle-pin",
  "workspace:move-to-new-window": "tab:move-to-window", "workspace:open-in-new-window": "tab:open-in-window",
  "workspace:split-vertical": "split:right", "workspace:split-horizontal": "split:down", "workspace:export-pdf": "export-pdf:pdf",
  "editor:focus-top": "split:focus-top", "editor:focus-bottom": "split:focus-bottom", "editor:focus-left": "split:focus-left",
  "editor:focus-right": "split:focus-right", "editor:open-search": "find:open", "editor:open-search-replace": "find:replace",
  "editor:fold-all": "folding:fold-all", "editor:unfold-all": "folding:unfold-all", "editor:toggle-fold": "folding:toggle",
  ...Object.fromEntries(["undo", "redo", "insert-link", "insert-wikilink", "insert-footnote", "toggle-blockquote", "clear-formatting",
    "toggle-bullet-list", "toggle-numbered-list", "toggle-checklist-status", "swap-line-up", "swap-line-down", "delete-paragraph",
    "indent-list", "unindent-list", "set-heading-0"].map((c) => [`editor:${c}`, `editor:${c}`])),
  "daily-notes": "daily-notes:today", "insert-template": "templates:insert", "insert-current-date": "templates:insert-current-date",
  "insert-current-time": "templates:insert-current-time", "note-composer:merge-file": "note-composer:merge-file",
  "note-composer:split-file": "note-composer:extract", "random-note": "random-note:open", "canvas:new-file": "canvas:new",
  "file-recovery:open": "history:open", "slides:start": "slides:start", "zk-prefixer": "unique-note:new",
}
// (Obsidian's Meta is a Mac's ⌘, which it writes as Mod too)
const OBSIDIAN_MODS: Record<string, string> = { Mod: "Mod", Meta: "Mod", Ctrl: "Ctrl", Alt: "Alt", Shift: "Shift" }

function hotkeys(vault: Vault): Record<string, string[]> {
  const h = obsidianJson(vault, "hotkeys")
  if (!h) return {}
  const out: Record<string, string[]> = {}
  for (const [from, to] of Object.entries(OBSIDIAN_COMMANDS)) {
    if (!Array.isArray(h[from])) continue
    const keys = h[from].flatMap((k: Item) => {
      const mods: (string | undefined)[] = Array.isArray(k?.modifiers) ? k.modifiers.map((m: unknown) => OBSIDIAN_MODS[String(m)]) : []
      const key = typeof k?.key === "string" ? (k.key === " " ? "Space" : k.key.length === 1 ? k.key.toUpperCase() : k.key) : ""
      if (!key || mods.some((m) => !m)) return []
      return [[...["Mod", "Ctrl", "Alt", "Shift"].filter((m) => mods.includes(m)), key].join("+")]
    })
    if (keys.length || !h[from].length) out[to] = [...new Set([...out[to] ?? [], ...keys])]
  }
  return out
}

const MODES: Record<string, string> = { obsidian: "dark", moonstone: "light", system: "system" }

function appearance(vault: Vault): Item {
  const a = obsidianJson(vault, "appearance")
  if (!a) return {}
  const theme = text(a.cssTheme), snippets = listSnippets(vault).map((s) => s.name)
  return keys({
    theme: MODES[a.theme],
    scheme: theme && listThemes(vault).some((t) => t.name === theme && !t.problem) ? `theme:${theme}` : undefined,
    snippets: Array.isArray(a.enabledCssSnippets) ? a.enabledCssSnippets.filter((n: unknown) => typeof n === "string" && snippets.includes(n)) : undefined,
    interfaceFont: text(a.interfaceFontFamily), textFont: text(a.textFontFamily), monoFont: text(a.monospaceFontFamily),
  })
}
