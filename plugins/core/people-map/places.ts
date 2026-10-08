// Where people are (relation colours, initials, the user's place, grouping into places), shared with the lazy map
// chunk, so it stays free of map code.
import type { Store } from "@vaultite"
import type { Person } from "@plugins/core/people/types"
import { regionOf } from "./regions.ts"

/** Apple system colours per relation (pins, avatars, legend). */
export const RELATIONS: { id: string; label: string; color: string }[] = [
  { id: "partner", label: "Partner", color: "var(--pink)" },
  { id: "family", label: "Family", color: "var(--orange)" },
  { id: "roommate", label: "Roommate", color: "var(--green)" },
  { id: "friend", label: "Friends", color: "var(--teal)" },
  { id: "mentor", label: "Mentors", color: "var(--purple)" },
  { id: "contact", label: "Contacts", color: "var(--gray)" },
]
export const colorOf = (relation: string) => RELATIONS.find((r) => r.id === relation)?.color ?? "var(--gray)"
export const YOU_COLOR = "var(--blue)"

export function initials(name: string) {
  const w = name.trim().split(/\s+/).filter(Boolean)
  if (!w.length) return "?"
  return (w.length > 1 ? w[0][0] + w[w.length - 1][0] : w[0].slice(0, 2)).toUpperCase()
}
export const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name

/** The user's own place: snapshot `me` = {"location": "Denver, CO", "lat": .., "lon": ..}. */
export type Me = { location: string; lat: number; lon: number }
export function meOf(s: Store): Me | null {
  const d = s.me
  return d && typeof d.lat === "number" && typeof d.lon === "number" ? { location: d.location, lat: d.lat, lon: d.lon } : null
}

export const located = (p: Person): p is Person & { lat: number; lon: number } => p.lat != null && p.lon != null

export { km, regionOf } from "./regions.ts"

export type Place = { name: string; people: (Person & { lat: number; lon: number })[]; me: boolean; home: boolean }

/** People grouped by place: yours first, then the biggest groups. */
export function placesOf(people: Person[], me: Me | null): Place[] {
  const by = new Map<string, Place>()
  const get = (name: string) => by.get(name) ?? by.set(name, { name, people: [], me: false, home: false }).get(name)!
  if (me) Object.assign(get(regionOf(me.lat, me.lon, me.location)), { me: true, home: true })
  for (const p of people.filter(located)) get(regionOf(p.lat, p.lon, p.location)).people.push(p)
  return [...by.values()].sort((a, b) => +b.home - +a.home || b.people.length - a.people.length || a.name.localeCompare(b.name))
}
