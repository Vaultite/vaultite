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
