// Made-up people for plugin previews (Plugins → a plugin).
import { addDays, today, type Store } from "@vaultite"
import type { Interaction, Person } from "./types"

export function mockPeople(): Partial<Store> {
  const d = (n: number) => addDays(today(), -n)
  let sort = 1
  const P = (name: string, relation: string, location: string, lat: number, lon: number, context: string, extra: Partial<Person> = {}): Person => ({
    id: `People/${name}`, name, relation, location, lat, lon, context, every_days: relation === "partner" ? 1 : 14, usual: "", notes: "",
    sort: sort++, tags: "", want_to: "", contact: "", moving_to: "", aliases: [], ...extra,
  })
  const people = [
    P("Alice Rivera", "partner", "Denver, CO", 39.74, -104.99, "Partner"),
    P("Bob Chen", "friend", "San Francisco, CA", 37.77, -122.42, "Friend from college", { want_to: "Want to get dinner" }),
    P("Carol Lee", "friend", "Brooklyn, NY", 40.68, -73.94, "Climbing partner"),
    P("Dave Okafor", "mentor", "Seattle, WA", 47.61, -122.33, "Former manager"),
    P("Erin Nair", "family", "Austin, TX", 30.27, -97.74, "Cousin"),
    P("Frank Martins", "roommate", "Denver, CO", 39.75, -104.98, "Roommate"),
  ]
  const interactions: Interaction[] = ([
    ["Alice Rivera", d(0), "call"], ["Alice Rivera", d(1), "call"], ["Bob Chen", d(20), "hang out"], ["Carol Lee", d(4), "text"],
    ["Dave Okafor", d(30), "call"], ["Frank Martins", d(2), "meet"],
  ] as const).map(([who, date, kind], i) => ({
    id: `People/${who}#${i}`, person_id: `People/${who}`, date, kind, duration_min: null, notes: "", source: "mock", subject: "", url: "",
  }))
  return { people, interactions }
}
