// Note dates: a plain note the app makes gets `created` and `updated` (plugin.onCreate), and an edit of its text in the
// app moves `updated` in that same write (plugin.onSave). Notes made elsewhere, and the ones a vault had, stay as they are.
import { Plugin } from "../../../core/plugins.ts"
import { isHiddenPath, type Item, nowStamp } from "../../../core/vault.ts"

export const plugin = new Plugin(import.meta.url)

/** The property a setting names: as set (empty: that date is off), else its default. */
const keyOf = (name: "created" | "updated") => {
  const v = plugin.settings()[name]
  return typeof v === "string" ? v.trim() : name
}

/** Which of `keys` a file gets: only a plain note's (no kind owns it, or its type is note), not in a hidden folder or
 *  the templates', not another plugin's format (`kanban-plugin:`), and no key its kind keeps itself (the Notes kind's). */
function ours(path: string, fm: Item, keys: string[]): string[] {
  if (isHiddenPath(path) || Object.keys(fm).some((k) => k.endsWith("-plugin"))) return []
  const kind = plugin.vault.kindFor(path, fm) // (its `type`, wherever it is)
  const type = kind ? kind.type : typeof fm.type === "string" && fm.type.trim() ? fm.type.trim() : null
  if (type !== null && type.toLowerCase() !== "note") return []
  const templates = String(plugin.peer("templates")?.seeded().folder ?? "Templates").replace(/^\/+|\/+$/g, "")
  if (templates && path.startsWith(templates + "/")) return []
  const own = kind?.spec.stamps ?? []
  return keys.filter((k) => k && !own.includes(k))
}

/** The properties the app keeps in plain notes, shown as dates, not edited (Properties); none while it's off. */
plugin.state(() => (plugin.isOff() ? {} : { noteStamps: [keyOf("created"), keyOf("updated")].filter(Boolean) }))
/** The dates it keeps in a file (path, fm): any edit moves them, so they're no one's change (Review leaves them out). */
plugin.provide("note-dates:stamps", (path: string, fm: Item) => ours(path, fm, [keyOf("created"), keyOf("updated")]))

plugin.onCreate((path, fm) => {
  const keys = ours(path, fm, [keyOf("created"), keyOf("updated")])
  if (!keys.length) return
  const now = nowStamp()
  return Object.fromEntries(keys.map((k) => [k, now]))
})

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

// Only a note that has the key (none is added to an old one), only when its text changed (not its properties alone),
// and never over a date the save set itself.
plugin.onSave((path, now, was) => {
  const key = keyOf("updated")
  if (!key || !(key in now.fm) || !ours(path, now.fm, [key]).length) return
  if (now.body.trim() === was.body.trim() || !same(now.fm[key], was.fm[key])) return
  return { [key]: nowStamp() }
})
