import fs from "node:fs"
import path from "node:path"
import { ARCHIVE_DIR } from "./fileprops.ts"

export type Stat = { ns: bigint; size: number; born: number }
export type Listed = { found: Map<string, Stat>; others: Map<string, Stat>; folders: string[]; away: string[]; linkedOut: boolean; seen: string }
export type Evicted = (abs: string, st: fs.BigIntStats) => boolean
export const CACHES = new Set(["node_modules", "__pycache__"])
export const NOT_SETTINGS = new Set([".vaultite/artifacts", ".vaultite/cache", ".vaultite/generated"])

export const placeholderStat = (st: { blocks: number | bigint; size: number | bigint }) => Number(st.blocks) === 0 && Number(st.size) > 0
export const ms = (ns: bigint) => Number(ns / 1000000n)

const STATS_AT_ONCE = 256
export async function statsOf(paths: (string | null)[]): Promise<(fs.BigIntStats | null | undefined)[]> {
  const out: (fs.BigIntStats | null | undefined)[] = []
  for (let i = 0; i < paths.length; i += STATS_AT_ONCE) {
    out.push(...await Promise.all(paths.slice(i, i + STATS_AT_ONCE).map((p) => (p === null ? null : fs.promises.stat(p, { bigint: true }).catch(() => undefined)))))
  }
  return out
}

/** What the index keeps of a file's stat. */
export function statFrom(st: fs.BigIntStats): Stat {
  const born = st.birthtimeNs > 0n ? st.birthtimeNs : st.ctimeNs < st.mtimeNs ? st.ctimeNs : st.mtimeNs
  return { ns: st.mtimeNs, size: Number(st.size), born: ms(born) }
}

export type Stats = typeof statsOf

export const statsNow: Stats = (paths) => Promise.resolve(paths.map((p) => {
  if (p === null) return null
  try { return fs.statSync(p, { bigint: true, throwIfNoEntry: false }) } catch { return undefined }
}))

export async function listVault(vaultPath: string, evicted: Evicted, statAll = statsOf): Promise<Listed> {
  const away: string[] = []
  let linkedOut = false
  const found = new Map<string, Stat>()
  const others = new Map<string, Stat>()
  const folders: string[] = []
  const stack = [""]
  const root = path.join(vaultPath, "/")
  const linked = new Set<string>()
  const top = await fs.promises.stat(root, { bigint: true }).catch(() => null)
  if (top) linked.add(`${top.dev}:${top.ino}`)
  while (stack.length) {
    const sub = stack.pop()!
    let names: fs.Dirent[]
    try {
      names = await fs.promises.readdir(root + sub, { withFileTypes: true })
    } catch {
      continue
    }
    const listed = names.filter((d) => !((d.name.startsWith(".") && (d.name !== ARCHIVE_DIR || !d.isDirectory())) || d.name.endsWith(".icloud")))
    const stats = await statAll(listed.map((d) => (d.isDirectory() ? null : root + (sub ? `${sub}/${d.name}` : d.name))))
    for (const [i, d] of listed.entries()) {
      const name = d.name, rel = sub ? `${sub}/${name}` : name, st = stats[i]
      if (st === undefined) continue
      if (d.isSymbolicLink()) linkedOut = true
      if (st === null || st.isDirectory()) {
        if (CACHES.has(name)) continue
        if (st) { const key = `${st.dev}:${st.ino}`; if (linked.has(key)) continue; linked.add(key) }
        folders.push(rel)
        stack.push(rel)
        continue
      }
      const stat = statFrom(st)
      if (name.endsWith(".md") && !name.includes(".tmp-")) { found.set(rel, stat); if (evicted(root + rel, st)) away.push(rel) }
      else others.set(rel, stat)
    }
  }
  const seen = await settingsStats(vaultPath, away, evicted, statAll)
  folders.sort()
  return { found, others, folders, away, linkedOut, seen }
}

export async function settingsStats(vaultPath: string, away: string[], evicted: Evicted, statAll = statsOf) {
  const out: string[] = [], abs = (rel: string) => path.join(vaultPath, rel)
  const stack = [".vaultite"]
  while (stack.length) {
    const sub = stack.pop()!
    let names: string[]
    try {
      names = await fs.promises.readdir(abs(sub))
    } catch {
      continue
    }
    const rels = names.map((name) => `${sub}/${name}`).filter((rel, i) => !(NOT_SETTINGS.has(rel) || CACHES.has(names[i]!) || names[i]!.includes(".tmp-")))
    const stats = await statAll(rels.map((rel) => abs(rel)))
    for (const [i, rel] of rels.entries()) {
      const st = stats[i]
      if (!st) continue
      if (st.isDirectory()) { stack.push(rel); continue }
      const gone = evicted(abs(rel), st)
      if (gone) away.push(rel)
      out.push(`${rel}:${st.mtimeNs}:${st.size}${gone ? ":evicted" : ""}`)
    }
  }
  const look = async (dir: string, file: (name: string) => string | null) => {
    try { return (await fs.promises.readdir(abs(`.obsidian/${dir}`))).map(file).filter((f): f is string => f !== null) } catch { return [] }
  }
  const names = ["app.json", "types.json", "daily-notes.json", "templates.json", "appearance.json", "hotkeys.json", "command-palette.json", "bookmarks.json", "themes", "snippets",
    ...await look("themes", (n) => `themes/${n}/theme.css`), ...await look("snippets", (n) => (n.endsWith(".css") ? `snippets/${n}` : null))]
  const stats = await statAll(names.map((name) => abs(`.obsidian/${name}`)))
  for (const [i, name] of names.entries()) { const st = stats[i]; if (st) out.push(`${name}:${st.mtimeNs}:${st.size}`) }
  return out.sort().join("\n")
}
