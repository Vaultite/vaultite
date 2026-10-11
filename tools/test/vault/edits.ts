import type { Any, VaultTest } from "./harness.ts"

export default async ($: VaultTest) => {
  const { api, check, read, write } = $
  // Small edits: hand-written files keep their shape when the app writes to them
  const hand = `---
type: person
relation: friend   # met at the gym
tags: [Climbing]
location: Denver, CO
coordinates: [39.74, -104.99]
sort: 90
custom_key: keep me
---

Likes bouldering.

## Timeline

- 2026-09-27 - text - sent the flight
  and they said they'd pick me up
* 2026-09-20 · Call · 1h 30m · Talked
- 2026-09-10 · coffee chat · Long catch-up
- 2026-09-01 Moved to Denver
Something that isn't an entry

## Gift ideas

- A book about Baltimore
`
  write("People/Hand Made.md", hand)
  let [, s] = await api("GET", "state")
  let mine = s.interactions.filter((i: Any) => i.person_id === "People/Hand Made").sort((a: Any, b: Any) => (a.date < b.date ? 1 : -1))
  check("lenient: every hand-written line reads", JSON.stringify(mine.map((i: Any) => [i.date, i.kind])) ===
    JSON.stringify([["2026-09-27", "text"], ["2026-09-20", "call"], ["2026-09-10", "coffee chat"], ["2026-09-01", "note"]]), mine)
  check("lenient: continuation line joins the entry", mine[0]?.notes === "sent the flight\nand they said they'd pick me up", mine.slice(0, 1))
  check("lenient: 1h 30m is 90 min", mine[1]?.duration_min === 90, mine.slice(1, 2))
  check("lenient: only the stray line is a problem",
    JSON.stringify(s.vault.problems.filter((x: Any) => x.file === "People/Hand Made.md").map((x: Any) => x.problem)) ===
    JSON.stringify(["timeline line not understood: Something that isn't an entry"]), s.vault.problems)
  const hm = s.people.find((x: Any) => x.name === "Hand Made")
  check("sections after the timeline are kept apart", hm.after.startsWith("## Gift ideas") && !hm.notes.includes("Gift"), hm)
  await api("POST", "interactions", { person: "Hand Made", date: "2026-09-28", kind: "call", notes: "New one" })
  let after = read("People/Hand Made.md")
  check("adding an entry changes only that line", after === hand.replace("## Timeline\n\n", "## Timeline\n\n- 2026-09-28 · call · New one\n"), after)
  await api("POST", "interactions", { person: "Hand Made", date: "2026-09-15", kind: "meet", notes: "Middle" })
  check("an older entry goes in date order", read("People/Hand Made.md").includes("* 2026-09-20 · Call · 1h 30m · Talked\n- 2026-09-15 · meet · Middle\n- 2026-09-10"), read("People/Hand Made.md"))
  await api("PUT", "people/Hand Made", { want_to: "Call about the move" })
  let t = read("People/Hand Made.md")
  check("a profile change touches one frontmatter line", t.includes("relation: friend   # met at the gym\n") && t.includes("want_to: Call about the move")
    && t.includes("custom_key: keep me") && t.includes("- 2026-09-27 - text - sent the flight\n  and they said"), t)
  const before = read("People/Hand Made.md")
  await api("PUT", "people/Hand Made", { want_to: "Call about the move" })
  check("saving without a change writes nothing", read("People/Hand Made.md") === before)
  ;[, s] = await api("GET", "state")
  const iid = s.interactions.find((i: Any) => i.person_id === "People/Hand Made" && i.date === "2026-09-10").id
  await api("PUT", `interactions/${encodeURIComponent(iid)}`, { notes: "Long catch-up about climbing" })
  t = read("People/Hand Made.md")
  check("editing one entry rewrites only that line", t.includes("- 2026-09-10 · coffee chat · Long catch-up about climbing\n")
    && t.includes("* 2026-09-20 · Call · 1h 30m · Talked") && t.includes("## Gift ideas\n\n- A book about Baltimore"), t)
  await api("PUT", "people/Hand Made", { notes: "Likes bouldering and tea." })
  t = read("People/Hand Made.md")
  check("editing the notes keeps the rest", t.split("## Gift ideas").length === 2 && t.includes("Likes bouldering and tea.\n\n## Timeline"), t)

  // Any file's timeline, from the app's Add (POST /api/timeline): placed by date, every other line as it was
  const trip = "---\ntags: [Trip]\n---\n\n```\n## Timeline\n```\n\nPlans.\n\n## Timeline\n\n- 2026-09-27 · call · Booked\n  the flights\n* 2026-09-10 · Note · Started\n\n## After\n\nKept.\n"
  write("Trips/Trip.md", trip)
  await api("POST", "timeline", { path: "Trips/Trip.md", date: "2026-09-20", kind: "meet", duration_min: 45, notes: "Planned the route" })
  check("a timeline line goes in date order, after an entry's continuation", read("Trips/Trip.md") ===
    trip.replace("  the flights\n", "  the flights\n- 2026-09-20 · meet · 45 min · Planned the route\n"), read("Trips/Trip.md"))
  await api("POST", "timeline", { path: "Trips/Trip.md", date: "2026-09-27", kind: "text", notes: "Sent the times" })
  check("the newest goes first, above one of the same day", read("Trips/Trip.md").includes("## Timeline\n\n- 2026-09-27 · text · Sent the times\n- 2026-09-27 · call"), read("Trips/Trip.md"))
  await api("POST", "timeline", { path: "Trips/Trip.md", date: "2026-09-01", kind: "note", notes: "First idea" })
  check("the oldest goes last, before the next section", read("Trips/Trip.md").includes("* 2026-09-10 · Note · Started\n- 2026-09-01 · note · First idea\n\n## After"), read("Trips/Trip.md"))
  write("Trips/Empty timeline.md", "Text.\n\n## Timeline\n")
  await api("POST", "timeline", { path: "Trips/Empty timeline.md", date: "2026-09-29", kind: "call" })
  check("an empty timeline gets its first line", read("Trips/Empty timeline.md") === "Text.\n\n## Timeline\n\n- 2026-09-29 · call\n", read("Trips/Empty timeline.md"))
  write("Trips/No timeline.md", "Text.\n")
  await api("POST", "timeline", { path: "Trips/No timeline.md", date: "2026-09-29", kind: "email", notes: "Asked" })
  check("a file without a timeline gets one at its end", read("Trips/No timeline.md") === "Text.\n\n## Timeline\n\n- 2026-09-29 · email · Asked\n", read("Trips/No timeline.md"))
  let [code] = await api("POST", "timeline", { path: "Trips/Trip.md", date: "2026-09-29", kind: "Game  night", notes: "Won" })
  check("a timeline line takes a kind of its own, a word or two", code === 201 || code === 200, code)
  check("...written as one and read back as one", read("Trips/Trip.md").includes("- 2026-09-29 · game night · Won\n") &&
    (await import("../../../core/timeline.ts")).parseEntry("- 2026-09-29 · game night · Won")?.kind === "game night", read("Trips/Trip.md"))
  ;[code] = await api("POST", "timeline", { path: "Trips/Trip.md", date: "2026-09-29", kind: "dance" })
  check("...but not alone (it would read as a note)", code === 400, code)
  ;[code] = await api("POST", "timeline", { path: "Trips/Trip.md", date: "2026-09-29", kind: "a · b", notes: "x" })
  check("a kind that wouldn't read back is refused", code === 400, code)
  ;[code] = await api("POST", "timeline", { path: "Trips/Trip.md", date: "2026-09-29", kind: "note" })
  check("a note line needs its text", code === 400, code)
  await api("POST", "timeline", { path: "People/Hand Made.md", date: "2026-09-29", kind: "call", duration_min: 20 })
  ;[, s] = await api("GET", "state")
  check("a person's timeline line counts as being in touch", s.interactions.some((i: Any) => i.person_id === "People/Hand Made" && i.date === "2026-09-29" && i.duration_min === 20), s.interactions.slice(0, 3))
}
