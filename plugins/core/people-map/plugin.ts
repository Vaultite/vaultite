/** People map: everyone's pin (the web app's map). Here: its block as text, for AIs (GET /api/render). */
import { bullets, Plugin, section } from "../../../core/plugins.ts"
import { cmp, isArchived, type Item, str } from "../../../core/vault.ts"
import { regionOf } from "./regions.ts"

export const plugin = new Plugin(import.meta.url)

/** Everyone by where they live, grouped like the card (PeoplePlaces.tsx): your place first, then the biggest; then the
 *  people who aren't on the map (no location, or one that wasn't found). */
plugin.block("people-map", (ctx) => {
  const people = plugin.vault.has("people") ? plugin.vault.items("people").filter((p) => !isArchived(p)) : []
  const on = (x: Item) => typeof x?.lat === "number" && typeof x?.lon === "number"
  const me = plugin.vault.has("me") ? plugin.vault.get("me", "me") : null
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
