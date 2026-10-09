// The .obsidian/app.json keys that mean the same thing here (formats: AGENTS.md), only those it sets, and its types.json;
// nothing is ever written to .obsidian/. Their changes count in the vault's settingsVersion, so /api/state follows.
import fs from "node:fs"
import path from "node:path"
import type { Item, Vault } from "../../../core/vault.ts"

export type ObsidianSettings = {
  newFileLocation?: "root" | "current" | "folder"
  newFileFolderPath?: string
  attachmentFolderPath?: string
  useMarkdownLinks?: boolean
  userIgnoreFilters?: string[]
  /** The editor's (web/src/core/editorPrefs.ts reads them under the app's own editor.json). */
  spellcheck?: boolean
  useTab?: boolean
  tabSize?: number
  autoPairBrackets?: boolean
  autoPairMarkdown?: boolean
  readableLineLength?: boolean
  propertiesInDocument?: "visible" | "hidden" | "source"
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
  cache.set(vault, { mtime, value: out })
  return out
}

const folder = (p: string) => p.trim().replace(/^\/+|\/+$/g, "")

const typesCache = new WeakMap<Vault, { mtime: number; value: Item }>()

/** .obsidian/types.json's `types` as written ({"due": "date", "cssclasses": "multitext"}), {} without one; the core
 *  reads the names (core/proptypes.ts). */
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

/** A .obsidian/<name>.json as an object, null when there's none or it doesn't parse. */
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

/** What the vault's .obsidian/ settings make the defaults of the app's own, by settings file (core/plugins.ts
 *  settingDefaults): excluded files and the attachment folder (app.json), the templates folder and formats
 *  (templates.json), daily notes' folder, name format and template (daily-notes.json). Only keys they set. */
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
    if (Object.keys(set).length) out["plugins/today/data"] = set
  }
  return out
}
