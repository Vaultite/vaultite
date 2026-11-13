import { Plugin } from "../../../core/plugins.ts"
import { isHiddenPath, type Item, nowStamp } from "../../../core/vault.ts"

export const plugin = new Plugin(import.meta.url)

const keyOf = (name: "created" | "updated") => {
  const v = plugin.settings()[name]
  return typeof v === "string" ? v.trim() : name
}

function ours(path: string, fm: Item, keys: string[]): string[] {
  if (isHiddenPath(path) || Object.keys(fm).some((k) => k.endsWith("-plugin"))) return []
  const kind = plugin.vault.kindFor(path, fm)
  const type = kind ? kind.type : typeof fm.type === "string" && fm.type.trim() ? fm.type.trim() : null
  if (type !== null && type.toLowerCase() !== "note") return []
  const templates = String(plugin.peer("templates")?.seeded().folder ?? "Templates").replace(/^\/+|\/+$/g, "")
  if (templates && path.startsWith(templates + "/")) return []
  const own = kind?.spec.stamps ?? []
  return keys.filter((k) => k && !own.includes(k))
}

plugin.state(() => (plugin.isOff() ? {} : { noteStamps: [keyOf("created"), keyOf("updated")].filter(Boolean) }))
/** The dates it keeps in a file (path, fm): any edit moves them, so Review leaves them out. */
plugin.provide("note-dates:stamps", (path: string, fm: Item) => ours(path, fm, [keyOf("created"), keyOf("updated")]))

plugin.onCreate((path, fm) => {
  const keys = ours(path, fm, [keyOf("created"), keyOf("updated")])
  if (!keys.length) return
  const now = nowStamp()
  return Object.fromEntries(keys.map((k) => [k, now]))
})

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

plugin.onSave((path, now, was) => {
  const key = keyOf("updated")
  if (!key || !(key in now.fm) || !ours(path, now.fm, [key]).length) return
  if (now.body.trim() === was.body.trim() || !same(now.fm[key], was.fm[key])) return
  return { [key]: nowStamp() }
})
