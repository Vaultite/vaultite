// People: a file per person, profile in frontmatter, facts, then "## Timeline". The timeline is read leniently and an
// entry the app didn't change is written back exactly as it was; new ones use the canonical form.
import { bullets, daysBetween, HTTPError, Plugin, reply, section } from "../../../core/plugins.ts"
import { entryLine, KINDS, parseEntry } from "../../../core/timeline.ts"
import { cmp, isArchived, type Item, Kind, num, safeName, sortBy, splitTags, str, truthy } from "../../../core/vault.ts"
import { geocoder, type Places } from "./geocode.ts"
import { peopleOps } from "./ops.ts"

export const plugin = new Plugin(import.meta.url)
// Pins are looked up when a place is entered through the app or a map needs one, and kept in the plugin's cache, never
// in the person's file (coordinates someone wrote there by hand win).
const places = geocoder(() => (plugin.readCache({})!.places ?? {}) as Places, (ps) => plugin.writeCache({ ...plugin.readCache({}), places: ps }))
/** A place's pin, [lat, lon] or null: looked up once (Nominatim), then cached. Me uses it for ME.md's place. */
plugin.provide("geocode", places.locate)
/** A place's cached pin without looking it up: [lat, lon], null (not found) or undefined (not looked up yet). */
plugin.provide("geocode:known", places.known)

/** An item with its pin: the file's own coordinates, else the cached lookup of its location (never looked up here). */
export function pinned<T extends Item>(x: T): T {
  if (typeof x.lat === "number" && typeof x.lon === "number") return x
  const ll = truthy(x.location) ? places.known(str(x.location)) : null
  return ll ? { ...x, lat: ll[0], lon: ll[1] } : x
}
plugin.exports.pinned = pinned
// [[Bob]] links to Bob Lee when only one person is called Bob, on the server too (core/links.ts), like the app's links.
// (An archived person's first name counts only when nobody else has it: the resolver sees to that.)
plugin.provide("link-names", (path: string) => {
  const e = plugin.vault.entries.get(path)
  if (e?.kind?.collection !== "people") return null
  return { weak: [path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/i, "").split(" ")[0]] }
})

const RELATIONS = ["partner", "family", "roommate", "friend", "mentor", "contact"]
const TIMELINE = "## Timeline"
const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/
const FIELDS = ["date", "kind", "duration_min", "subject", "notes", "url"] as const

/** The canonical line for an entry (core/timeline.ts, as any file's timeline gets them). */
const line = (i: Item) => entryLine({
  date: i.date, kind: i.kind || "call", duration_min: truthy(i.duration_min) ? Number(i.duration_min) : null,
  subject: truthy(i.subject) ? str(i.subject) : "", notes: truthy(i.notes) ? str(i.notes) : "", url: truthy(i.url) ? str(i.url) : "",
})

/** What an entry says, to tell whether it changed. */
const sig = (i: Item) => JSON.stringify(FIELDS.map((k) => (truthy(i[k]) ? i[k] : null)))

/** The lines under the Timeline heading -> entries. Lines that aren't entries are kept as {_raw: line} so they are
 *  written back where they were; an entry remembers its source lines (_src) to be written back unchanged. */
function parseTimeline(lines: string[]): [Item[], string[]] {
  const out: Item[] = [], problems: string[] = []
  for (const raw of lines) {
    const i: Item | null = parseEntry(raw)
    if (i !== null) {
      i._src = raw
      out.push(i)
      continue
    }
    const last = out.length ? out[out.length - 1] : null
    if (/^[ \t]/.test(raw) && raw.trim() && last !== null && !("_raw" in last)) {
      last.notes = (last.notes + "\n" + raw.trim()).trim()
      last._src += "\n" + raw
      continue
    }
    if (raw.trim()) problems.push(`timeline line not understood: ${[...raw.trim()].slice(0, 70).join("")}`)
    out.push({ _raw: raw })
  }
  for (const i of out) if (!("_raw" in i)) i._sig = sig(i)
  return [out, problems]
}

/** body -> [notes, heading line or "", timeline lines, after]. The timeline is the section under a "Timeline"
 *  heading (any level, any case), up to the next heading of the same or a higher level. */
function splitBody(body: string): [string, string, string[], string] {
  const lines = body.split("\n")
  const at = lines.findIndex((l) => { const m = HEADING.exec(l); return m !== null && m[2].trim().toLowerCase() === "timeline" })
  if (at < 0) return [body.trim(), "", [], ""]
  const level = HEADING.exec(lines[at])![1].length
  let end = lines.findIndex((l, n) => { if (n <= at) return false; const m = HEADING.exec(l); return m !== null && m[1].length <= level })
  if (end < 0) end = lines.length
  const sec = lines.slice(at + 1, end)
  while (sec.length && !sec[0].trim()) sec.shift()
  while (sec.length && !sec[sec.length - 1].trim()) sec.pop()
  return [lines.slice(0, at).join("\n").trim(), lines[at], sec, lines.slice(end).join("\n").trim()]
}

function parse(fm: Item, body: string, stem: string): [Item, string[]] {
  const problems: string[] = []
  const rel = truthy(fm.relation) ? fm.relation : ""
  if (rel && !RELATIONS.includes(rel)) problems.push(`relation \`${str(rel)}\` is not one of ${pyList([...RELATIONS].sort())}`)
  const every = fm.every_days
  if (every !== undefined && every !== null && !((num(every) ?? 0) > 0)) problems.push("every_days must be a whole number of days, 1 or more")
  let coords = fm.coordinates
  if (coords !== undefined && coords !== null && !(Array.isArray(coords) && coords.length === 2 && coords.every((c) => num(c) !== null))) {
    problems.push("coordinates must be [lat, lon]")
    coords = null
  }
  const [notes, heading, sec, after] = splitBody(body)
  const [timeline, bad] = parseTimeline(sec)
  const text = (k: string) => (truthy(fm[k]) ? str(fm[k]) : "")
  const p: Item = {
    name: truthy(fm.name) ? str(fm.name) : stem, relation: rel, every_days: num(every),
    usual: text("usual"), context: text("context"), location: text("location"),
    lat: truthy(coords) ? coords[0] : null, lon: truthy(coords) ? coords[1] : null, moving_to: text("moving_to"),
    tags: splitTags(fm.tags).join(", "), want_to: text("want_to"), contact: text("contact"), aliases: splitTags(fm.aliases),
    sort: num(fm.sort),
    notes, after, timeline, _heading: heading,
  }
  return [p, [...problems, ...bad]]
}

/** Python's way of writing a list in a message: ['a', 'b']. */
const pyList = (xs: string[]) => `[${xs.map((x) => `'${x}'`).join(", ")}]`

/** The real entries of a timeline, with their index in it (the index is the interaction's id). */
function entries(p: Item): [number, Item][] {
  return ((p.timeline ?? []) as Item[]).map((i, n) => [n, i] as [number, Item]).filter(([, i]) => !("_raw" in i))
}

function render(p: Item): [Item, string] {
  const owned: Item = {
    name: safeName(p.name) !== p.name ? p.name : null,
    relation: p.relation, every_days: p.every_days, usual: p.usual,
    context: p.context, location: p.location,
    coordinates: p.lat !== null && p.lat !== undefined ? [p.lat, p.lon] : null,
    moving_to: p.moving_to, tags: splitTags(p.tags), want_to: p.want_to,
    contact: p.contact, aliases: splitTags(p.aliases), sort: p.sort,
  }
  const lines: string[] = []
  for (const i of (p.timeline ?? []) as Item[]) {
    if ("_raw" in i) lines.push(i._raw)
    else if (i._src !== undefined && i._src !== null && i._sig === sig(i)) lines.push(i._src) // untouched: as it was written
    else lines.push(line(i))
  }
  const parts = [str(p.notes).trim()]
  if (lines.length || truthy(p._heading)) parts.push((p._heading || TIMELINE) + (lines.length ? "\n\n" + lines.join("\n") : ""))
  parts.push(str(p.after).trim())
  return [owned, parts.filter(Boolean).join("\n\n")]
}

/** An update. A timeline sent from outside lost the private parts that keep the file as written: unchanged entries get
 *  their source lines back, and non-entry lines go back after the entry they followed. */
function merge(old: Item, patch: Item): Item {
  const neu: Item = { ...old, ...patch }
  const tl = patch.timeline as Item[] | undefined
  if (tl === undefined || tl === null || tl.some((i) => Object.keys(i).some((k) => k.startsWith("_")))) return neu
  const olds = (old.timeline ?? []) as Item[]
  const pool = olds.filter((o) => !("_raw" in o))
  const out: Item[] = []
  const twin = new Map<Item, Item>()
  for (const given of tl) {
    let i: Item = Object.fromEntries(FIELDS.map((k) => [k, given[k] ?? null]))
    const o = pool.find((x) => sig(x) === sig(i))
    if (o !== undefined) {
      pool.splice(pool.indexOf(o), 1)
      i = { ...o, ...i }
      twin.set(o, i)
    }
    out.push(i)
  }
  // Lines that aren't entries, back where they were.
  let last: Item | null = null
  const placed: Item[] = []
  for (const o of olds) {
    if (!("_raw" in o)) {
      last = o
      continue
    }
    const anchor = last !== null ? twin.get(last) : undefined
    let at: number
    if (last === null) at = placed.length
    else if (anchor !== undefined && out.includes(anchor)) {
      at = out.indexOf(anchor) + 1
      while (at < out.length && "_raw" in out[at]) at++
    } else at = out.length
    out.splice(at, 0, o)
    if (last === null) placed.push(o)
  }
  neu.timeline = out
  return neu
}

/** A place entered through the app is looked up (in the background: the pin goes to the cache, not the file). The
 *  coordinates the file had stay unless the place changed without them: they were the old place's. */
export function locate(p: Item, before: Item | null) {
  const moved = before !== null && str(p.location) !== str(before.location)
  if (moved && p.lat === before.lat && p.lon === before.lon) p.lat = p.lon = null
  // (a pin the app showed, sent back whole: not the user's coordinates)
  const ll = truthy(p.location) ? places.known(str(p.location)) : null
  if (ll && (before === null || before.lat === null || before.lat === undefined) && p.lat === ll[0] && p.lon === ll[1]) p.lat = p.lon = null
  if (truthy(p.location) && (before === null || moved)) void places.locate(str(p.location))
}

plugin.kind(new Kind({
  type: "person", collection: "people", folder: "People", titleKey: "name", parse, render, merge,
  prepare(p, before) {
    p.timeline ??= []
    locate(p, before)
    return p
  },
  key: (p) => str(p.name).toLowerCase(),
  blocks: ["person"],
  sections: ["timeline"],
  // `sort` is optional and never written by the app: those who have one first, by it; the rest after them, by name.
  order: (ps) => sortBy(ps, (p) => [p.sort ?? 1e9, p.name]),
}))

const publicPerson = (p: Item) => Object.fromEntries(Object.entries(p).filter(([k]) => !k.startsWith("_") && k !== "timeline"))

plugin.state(() => {
  const ps = plugin.vault.items("people")
  const inter: Item[] = []
  for (const p of ps) {
    entries(p).forEach(([, i], k) => {
      inter.push({ ...Object.fromEntries(FIELDS.map((f) => [f, i[f]])), id: `${p.id}#${k}`, person_id: p.id, source: "vault" })
    })
  }
  return { people: ps.map((p) => pinned(publicPerson(p))), interactions: sortBy(inter, (i) => i.date, true) }
})

function personFor(body: Item) {
  const ref = body.person_id || body.person
  delete body.person_id
  delete body.person
  const p = ref ? plugin.vault.get("people", ref) : null
  if (!p) throw new HTTPError(400, `no person '${ref ?? "None"}' (use their name, as in People/<Name>.md)`)
  return p
}

/** An interaction id ("People/Alice Park#3": its 4th entry, counting only entries) -> [person, timeline index]. */
function splitId(iid: string): [Item, number] {
  const at = iid.lastIndexOf("#")
  const pid = at >= 0 ? iid.slice(0, at) : "", n = at >= 0 ? iid.slice(at + 1) : iid
  const p = plugin.vault.get("people", pid)
  const es = p ? entries(p) : []
  if (!p || !/^\d+$/.test(n) || Number(n) >= es.length) throw new HTTPError(404, `no interaction '${iid}'`)
  return [p, es[Number(n)][0]]
}

/** {"person": "Alice Park", "date": "2026-09-28", "kind": "call", ...}: a line in their timeline, placed by date (newest
 *  first) among the others; every other line of the file stays as it was. */
plugin.route("POST", "interactions", async (req) => {
  const body = { ...req.body }
  let p = personFor(body)
  const i: Item = Object.fromEntries(FIELDS.map((k) => [k, truthy(body[k]) ? body[k] : k === "duration_min" ? null : ""]))
  if (!KINDS.has(i.kind) || !/^\d{4}-\d\d-\d\d$/.test(str(i.date))) {
    throw new HTTPError(400, `need a date (YYYY-MM-DD) and a kind: one of ${pyList([...KINDS].sort())}`)
  }
  const tl = [...p.timeline]
  const es = entries(p)
  let at = es.find(([, x]) => x.date <= i.date)?.[0]
  if (at === undefined) at = (es.length ? es[es.length - 1][0] : -1) + 1 // older than everything: after the last entry
  tl.splice(at, 0, i)
  p = (await plugin.vault.save("people", { timeline: tl }, p.id))!
  return reply(201, { ok: true, person: p.id })
})

plugin.route("PUT", "interactions/*", async (req) => {
  const [p, n] = splitId(req.arg(0))
  const tl = [...p.timeline]
  tl[n] = { ...tl[n], ...Object.fromEntries(Object.entries(req.body).filter(([k]) => (FIELDS as readonly string[]).includes(k))) }
  await plugin.vault.save("people", { timeline: tl }, p.id)
  return { ok: true }
})

plugin.route("DELETE", "interactions/*", async (req) => {
  const [p, n] = splitId(req.arg(0))
  await plugin.vault.save("people", { timeline: [...p.timeline.slice(0, n), ...p.timeline.slice(n + 1)] }, p.id)
  return { ok: true }
})

peopleOps(plugin) // person.timeline-add, people.remember (ops.ts)

/** What a location would be pinned at: /api/geocode?q=Austin, TX (looked up once, then from the cache; the map asks
 *  for the pins it's missing). */
plugin.route("GET", "geocode", async (req) => {
  const ll = await places.locate(req.query.q ?? "")
  return { q: req.query.q ?? "", lat: ll && ll[0], lon: ll && ll[1] }
})

// ---------- blocks as text (GET /api/render) ----------

/** The newest timeline entry that's contact (not a note), or null. */
function lastContact(p: Item): Item | null {
  const touch = entries(p).map(([, i]) => i).filter((i) => i.kind !== "note" && truthy(i.date))
  return touch.reduce<Item | null>((best, i) => (best === null || cmp(i.date, best.date) > 0 ? i : best), null)
}

function since(p: Item, today: string) {
  const last = lastContact(p)
  return last ? daysBetween(last.date, today) : null
}

const ago = (n: number | null) => (n === null ? "never" : n === 0 ? "today" : n === 1 ? "yesterday" : `${n} days ago`)
const active = () => plugin.vault.items("people").filter((p) => !isArchived(p))

plugin.block("person", (ctx) => {
  const p = plugin.vault.items("people").find((x) => x.id + ".md" === ctx.path)
  if (!p) return ""
  const last = lastContact(p)
  return bullets([
    p.context,
    p.location && `Lives in ${p.location}` + (p.moving_to ? `, moving to ${p.moving_to}` : ""),
    p.want_to && `To do: ${p.want_to}`, p.tags && `Tags: ${p.tags}`,
    `Last in touch: ${ago(since(p, ctx.today))}` + (last ? ` (${last.kind}, ${last.date})` : ""),
    p.every_days && `Keep in touch every ${p.every_days} days`, p.contact && `Contact: ${p.contact}`,
  ])
})

/** How often, the way the cards say it (People.tsx): "daily", "every 2 weeks", "every 10 days". */
const often = (n: number) => ({ 1: "daily", 7: "weekly", 14: "every 2 weeks", 30: "monthly", 60: "every 2 months" } as Record<number, string>)[n] ?? `every ${n} days`
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

plugin.block("people-due", (ctx) => {
  const rows: [number, string][] = []
  for (const p of active()) {
    const n = since(p, ctx.today)
    if (p.every_days > 0 && n !== null && n >= p.every_days) {
      const late = n - p.every_days
      ctx.source(p)
      rows.push([late, `${p.name}: ${late ? `${late} days overdue` : "due today"}, last ${ago(n)}, ${often(p.every_days)}`])
    }
  }
  return section("Reach out", bullets(sortBy(rows, (r) => r, true).map(([, r]) => r), "Nobody is overdue."))
})

plugin.block("people-wants", (ctx) =>
  section("Want to reach out", bullets(active().filter((p) => p.want_to).map((p) => {
    ctx.source(p)
    const n = since(p, ctx.today)
    const last = n !== null ? `last in touch ${ago(n)}` : p.relation === "contact" ? "never talked" : ""
    return `${p.name}: ${[p.want_to, p.location].filter(Boolean).join(" · ")}${last ? ` (${last})` : ""}`
  }), "Nobody on the list.")))

plugin.block("people-group", (ctx) => {
  const o = ctx.options
  const rel = (Array.isArray(o.relations) ? o.relations : str(o.relations).split(","))
    .map((r: unknown) => str(r).trim().toLowerCase()).filter(Boolean)
  const ps = active().filter((p) => !rel.length || rel.includes(p.relation))
  if (!ps.length) return ""
  ctx.source(ps)
  // Described like the card: by how you know them, else (the usual groups) relation, usual way and how often.
  const close = rel.some((r: string) => ["partner", "family", "roommate", "friend"].includes(r))
  const about = (p: Item) => str(p.context) || (close
    ? [p.relation !== "friend" && p.relation !== "family" && cap(str(p.relation)), p.usual && cap(str(p.usual)), p.every_days && often(p.every_days)]
      .filter(Boolean).join(" · ")
    : cap(str(p.relation)))
  return section(truthy(o.title) ? str(o.title) : "People",
    bullets(ps.map((p) => `${p.name}${about(p) ? ": " + about(p) : ""} (last in touch ${ago(since(p, ctx.today))})`)))
})

