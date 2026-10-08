// Me: the user's own file (ME.md, or where the setting `path` says): who they are and how they want AIs to work with
// them. The kind `me`, its place geocoded (People's geocoder, when it's on), and the service `me:file` others ask.
import { Plugin } from "../../../core/plugins.ts"
import { type Item, Kind, num } from "../../../core/vault.ts"

export const plugin = new Plugin(import.meta.url)

/** The setting's path, cleaned: from the vault's top, ending in .md (ME.md when unset or unusable). */
export function settingPath(v: unknown) {
  const p = typeof v === "string" ? v.trim().replace(/^\/+/, "") : ""
  if (!p || p.split("/").some((x) => x === ".." || x.startsWith("."))) return "ME.md"
  return /\.md$/i.test(p) ? p : `${p}.md`
}
const path = () => settingPath(plugin.settings().path)

/** A new place without new coordinates: geocoded (with a plugin's geocoder, if one that's on offers it: People). */
async function locate(me: Item, before: Item | null): Promise<Item | null> {
  const geocode = plugin.service("geocode")
  const moved = before !== null && me.location !== before.location && me.lat === before.lat
  if (me.location && (me.lat === null || me.lat === undefined || moved) && geocode) {
    const ll = await geocode(me.location)
    if (ll) return { ...me, lat: ll[0], lon: ll[1] }
  }
  return null
}

plugin.kind(new Kind({
  type: "me", collection: "me", file: path,
  parse: (fm, body) => {
    const c = fm.coordinates
    const ok = Array.isArray(c) && c.length === 2 && c.every((x) => num(x) !== null)
    return [{ location: fm.location ? String(fm.location) : "", lat: ok ? c[0] : null, lon: ok ? c[1] : null, body }, []]
  },
  render: (me) => [{ location: me.location || "", coordinates: me.lat !== null && me.lat !== undefined ? [me.lat, me.lon] : null }, me.body ?? ""],
  fill: locate,
  prepare: async (me, before) => (await locate(me, before)) ?? me,
}))

/** The user's file: where it is (the setting's path, or the one file of type me wherever it moved), else where it
 *  would be made. */
const file = () => {
  const me = plugin.vault.get("me", "me")
  return me ? `${me.id}.md` : path()
}
plugin.provide("me:file", file)

// Moved through the app (the file, or a folder it's in): the setting follows, so what agents are told stays right.
plugin.onMove((from, to) => {
  const at = path()
  if (to === null || (at !== from && !at.startsWith(`${from}/`))) return
  const next = { ...plugin.settings() }, moved = to + at.slice(from.length)
  if (moved.toLowerCase() === "me.md") delete next.path
  else next.path = moved
  plugin.saveSettings(Object.keys(next).length ? next : null)
})

plugin.state(() => ({ me: plugin.vault.get("me", "me") }))
