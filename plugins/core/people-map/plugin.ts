import { bullets, Plugin, section } from "../../../core/plugins.ts"
import { cmp, isArchived, type Item, str } from "../../../core/vault.ts"
import { regionOf } from "./regions.ts"

export const plugin = new Plugin(import.meta.url)

plugin.block("people-map", (ctx) => {
  const pinned = (x: Item) => (plugin.peer("people")?.exports.pinned(x) ?? x) as Item
  const people = plugin.vault.has("people") ? plugin.vault.items("people").filter((p) => !isArchived(p)).map(pinned) : []
  const on = (x: Item) => typeof x?.lat === "number" && typeof x?.lon === "number"
  const raw = plugin.vault.has("me") ? plugin.vault.get("me", "me") : null, me = raw && pinned(raw)
  ctx.source(me, people)
  const home = me && on(me) ? regionOf(me.lat, me.lon, str(me.location)) : null
  const places = new Map<string, string[]>(home ? [[home, ["you"]]] : [])
  for (const p of people.filter(on)) {
    const where = regionOf(p.lat, p.lon, str(p.location))
    places.set(where, [...(places.get(where) ?? []), p.name])
  }
  const size = (names: string[]) => names.filter((n) => n !== "you").length
  const rows = [...places].sort(([a, x], [b, y]) => +(b === home) - +(a === home) || size(y) - size(x) || cmp(a, b))
    .map(([where, names]) => `${where}: ${names.join(", ")}`)
  const off = people.filter((p) => !on(p)).map((p) => (p.location ? `${p.name} (${p.location}, not found)` : p.name))
  if (off.length) rows.push(`Not on the map: ${off.join(", ")}`)
  return section("By place", bullets(rows, "Nobody has a location yet."))
})
