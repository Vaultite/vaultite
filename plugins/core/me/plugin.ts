import { Plugin } from "../../../core/plugins.ts"
import { type Item, Kind, num } from "../../../core/vault.ts"

export const plugin = new Plugin(import.meta.url)

const path = plugin.settingFile("path", "ME.md")

function locate(me: Item, before: Item | null) {
  const moved = before !== null && (me.location ?? "") !== (before.location ?? "")
  if (moved && me.lat === before.lat && me.lon === before.lon) me.lat = me.lon = null
  const known = plugin.service("geocode:known"), ll = me.location && known ? known(me.location) : null
  if (ll && (before === null || before.lat === null) && me.lat === ll[0] && me.lon === ll[1]) me.lat = me.lon = null
  const geocode = plugin.service("geocode")
  if (me.location && (before === null || moved) && geocode) void geocode(me.location)
  return me
}

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

const file = () => {
  const me = plugin.vault.get("me", "me")
  return me ? `${me.id}.md` : path()
}
plugin.provide("me:file", file)

plugin.state(() => ({ me: pinned(plugin.vault.get("me", "me")) }))
