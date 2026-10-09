// Me: the user's own file (ME.md, or where the setting `path` says): who they are and how they want AIs to work with
// them. The kind `me`, its place pinned (People's geocoder, when it's on: in its cache, never in the file), and the
// service `me:file` others ask.
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

/** A place entered through the app is looked up in the background (People's geocoder, when it's on, keeps the pin in
 *  its cache); the file's coordinates go only when the place changed without them (they were the old place's). */
function locate(me: Item, before: Item | null) {
  const moved = before !== null && (me.location ?? "") !== (before.location ?? "")
  if (moved && me.lat === before.lat && me.lon === before.lon) me.lat = me.lon = null
  const known = plugin.service("geocode:known"), ll = me.location && known ? known(me.location) : null
  if (ll && (before === null || before.lat === null) && me.lat === ll[0] && me.lon === ll[1]) me.lat = me.lon = null
  const geocode = plugin.service("geocode")
  if (me.location && (before === null || moved) && geocode) void geocode(me.location)
  return me
}

/** The user's place with its pin: the file's coordinates, else People's cached lookup. */
function pinned(me: Item | null) {
  if (!me || typeof me.lat === "number" || !me.location) return me
  const known = plugin.service("geocode:known"), ll = known ? known(me.location) : null
  return ll ? { ...me, lat: ll[0], lon: ll[1] } : me
}
plugin.exports.pinned = pinned

plugin.kind(new Kind({
  type: "me", collection: "me", file: path,
  parse: (fm, body) => {
    const c = fm.coordinates
    const ok = Array.isArray(c) && c.length === 2 && c.every((x) => num(x) !== null)
    return [{ location: fm.location ? String(fm.location) : "", lat: ok ? c[0] : null, lon: ok ? c[1] : null, body }, []]
  },
  render: (me) => [{ location: me.location || "", coordinates: me.lat !== null && me.lat !== undefined ? [me.lat, me.lon] : null }, me.body ?? ""],
  prepare: locate,
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

plugin.state(() => ({ me: pinned(plugin.vault.get("me", "me")) }))
