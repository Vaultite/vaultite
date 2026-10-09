// People's operations: a timeline line, and a lasting fact kept where it belongs (ME.md or a person's file), finding
// the person as the user says the name (file, alias, a first name only one has), never by a guess.
import { OpError, type Plugin, today } from "../../../core/plugins.ts"
import { timelineKind } from "../../../core/timeline.ts"
import { type Item, str } from "../../../core/vault.ts"

const nameOf = (id: unknown) => String(id).split("/").pop()!
const enc = encodeURIComponent

/** `line` added to a file's text under the heading `heading` (made at the end when there's none; null: the body before
 *  its first ## heading, a person's facts): as a list item when that section is a list, else as a paragraph of its own. */
export function addUnder(textIn: string, heading: string | null, line: string) {
  const lines = textIn.replace(/\n+$/, "").split("\n")
  // The body starts after the frontmatter.
  let at = 0
  if (lines[0] === "---") {
    const end = lines.indexOf("---", 1)
    at = end > 0 ? end + 1 : 0
  }
  let start: number
  if (heading) {
    const h = lines.findIndex((l, i) => i >= at && l.trim().toLowerCase() === heading.toLowerCase())
    if (h < 0) return `${lines.join("\n")}\n\n${heading}\n\n${line.startsWith("- ") ? line : `- ${line}`}\n`
    start = h + 1
  } else start = at
  // Its end: the next heading of the same or a higher level (any ## for a person's body: the timeline).
  const level = heading ? /^#+/.exec(heading)![0].length : 2
  let stop = lines.findIndex((l, i) => i >= start && new RegExp(`^#{1,${level}}\\s`).test(l))
  if (stop < 0) stop = lines.length
  // Its last line with something on it (a block's fence counts: the fact goes after a person's profile block).
  let last = stop - 1
  while (last >= start && !lines[last].trim()) last--
  const asItem = last >= start && /^\s*[-*]\s/.test(lines[last])
  const add = asItem ? [`- ${line.replace(/^- /, "")}`] : last >= start ? ["", line.replace(/^- /, "")] : [line.replace(/^- /, "")]
  const before = lines.slice(0, last + 1)
  const after = lines.slice(last + 1)
  // Keep one blank line between what's added and the heading after it.
  const tail = after.length && after.some((l) => l.trim()) ? ["", ...after.slice(after.findIndex((l) => l.trim()))] : []
  const head = last < start && before.length && before[before.length - 1].trim() ? [...before, ""] : before
  return [...head, ...add, ...tail].join("\n") + "\n"
}

export function peopleOps(plugin: Plugin) {
  /** A person from what the user calls them: [their name (the file's), its vault id]. Throws, listing who it might be,
   *  when it's no one or several. */
  function personNamed(raw: string): [string, string] {
    const name = raw.trim()
    const exact = plugin.vault.get("people", name)
    if (exact) return [nameOf(exact.id), exact.id]
    const people = plugin.vault.items("people")
    const low = name.toLowerCase()
    const names = (p: Item) => [nameOf(p.id), ...(Array.isArray(p.aliases) ? p.aliases : [])].map((x) => String(x).toLowerCase())
    let hits = people.filter((p) => names(p).includes(low))
    if (!hits.length) hits = people.filter((p) => names(p).some((n) => n.split(/\s+/)[0] === low))
    if (hits.length === 1) return [nameOf(hits[0].id), hits[0].id]
    if (hits.length > 1) throw new OpError(`'${name}' could be ${hits.map((p) => nameOf(p.id)).join(" or ")}: ask the user which.`)
    throw new OpError(`No one called '${name}' in People/. Don't guess: ask the user who it is (a new person is a file in People/: vau docs people).`)
  }

  plugin.op({
    id: "person.timeline-add",
    cli: "person timeline",
    mcp: "add_timeline",
    summary: "Add a line to someone's timeline (People/<Name>.md), placed by date: a call, a meeting, a message, or a dated note about them.",
    help: `Any kind but note counts as being in touch: call, hang out, meet, study, text, message and email get icons, and
any other word or two works too (coffee, game night). note is a fact, not contact (something that may change: a new
job, a move). Log notable exchanges, not every chat. The person must exist: their
name as in People/, an alias, or a first name only one person has (else it says who it could be). Every other line of
the file stays as it was.

  vau person timeline "Alice Park" call "Talked about the move" --duration-min 30
  vau person timeline Bob note "Started at Lighthouse" --date 2026-09-01`,
    kind: "write",
    params: {
      person: { type: "string", required: true, description: "their name, as in People/<Name>.md (an alias or a first name only they have works)" },
      kind: { type: "string", required: true, description: "what it was, a word or two: call, hang out, meet, study, text, message, email (these get icons), any other (coffee), or note (a fact, not contact)" },
      text: { type: "string", required: true, description: "what it was about, one line" },
      date: { type: "string", format: "date", description: "YYYY-MM-DD, the user's local date (default today)" },
      subject: { type: "string", description: "an email's subject, or a short headline" },
      duration_min: { type: "number", description: "how long, in minutes" },
      url: { type: "string", description: "a link to it" },
    },
    args: ["person", "kind", "text"],
    action: { on: ["person"], param: "person", from: "name", label: "Add to timeline", icon: "message-square-plus" },
    run: async (p, ctx) => {
      const [name] = personNamed(p.person)
      const date = p.date || today()
      const body: Item = { person: name, date, kind: p.kind, notes: p.text.trim().replace(/\s*\n\s*/g, " ") }
      for (const k of ["subject", "url"]) if (str(p[k]).trim()) body[k] = str(p[k]).trim()
      if (p.duration_min !== undefined) body.duration_min = p.duration_min
      const r = await ctx.api("POST", "interactions", body)
      return { person: name, path: `${r.person}.md`, date, kind: timelineKind(p.kind) ?? p.kind, text: body.notes }
    },
    text: (r) => `Added to ${r.person}'s timeline: ${r.date} · ${r.kind} · ${r.text}`,
  })

  /** The user's own file (the Me plugin's: ME.md, or wherever theirs is), or why there's none. */
  function mePath(): string {
    const file = plugin.service("me:file")?.()
    if (typeof file !== "string") throw new OpError("the Me plugin is off, so the user's own facts have no file: ask them to turn it on, or name the person it's on", 409)
    return file
  }

  plugin.op({
    id: "people.remember",
    cli: "remember",
    mcp: "remember",
    summary: "Keep something lasting the user told you where it belongs: about them or how to work with them in their file (ME.md), or about someone in theirs.",
    help: `A fact about the user goes in their file (the Me plugin's ME.md) under ## About me; a preference for how AIs
should work with them ("prefers concise answers", how they spell a name) under ## How to work with me; a fact about
someone in their file, ending with where it came from. Only durable facts: something that may change is a dated note on their timeline
(person.timeline-add, kind note). If you're not sure who it's about, or it contradicts the vault, don't write it: ask.
The same fact twice is kept once.

  vau remember "Plays the cello."
  vau remember "Prefers short answers." --about preference
  vau remember "Is vegetarian." --about "Bob Lee" --source ChatGPT`,
    kind: "write",
    params: {
      fact: { type: "string", required: true, description: "one short sentence, in the user's words, cleaned up" },
      about: { type: "string", description: "me (default), preference, or a person's name" },
      source: { type: "string", description: "where it came from, for a fact about a person (default: you, the assistant)" },
    },
    args: ["fact"],
    action: { on: ["person"], param: "about", from: "name", label: "Remember something about them", icon: "brain" },
    run: async (p, ctx) => {
      const fact = p.fact.trim().replace(/\s+/g, " ")
      if (!fact) throw new OpError("fact is missing: the fact, one sentence")
      const about = str(p.about).trim() || "me"
      const me = /^(me|user|the user|myself|i)$/i.test(about) ? "## About me"
        : /^(preference|preferences|how to work with me|ai|assistant)$/i.test(about) ? "## How to work with me" : null
      let rel: string, heading: string | null, line: string, person: string | null = null
      if (me) [rel, heading, line] = [mePath(), me, fact]
      else {
        const [name, id] = personNamed(about)
        person = name
        rel = `${id}.md`
        heading = null
        line = `${fact.replace(/\s*\(from [^)]*\)$/, "")} (from ${str(p.source).trim() || ctx.who.label}, ${today()})`
      }
      let base: string, made = false
      try { base = String((await ctx.api("GET", `file?path=${enc(rel)}`)).text ?? "") } catch (e) {
        if (!me) throw e
        // (no file yet: made, so there's nothing to merge with)
        base = "---\ntype: me\n---\n"
        made = true
      }
      if (base.includes(line)) return { path: rel, heading: heading?.slice(3) ?? null, line, person, already: true }
      await ctx.api("PUT", "file", { path: rel, text: addUnder(base, heading, line), ...(made ? {} : { base }) })
      return { path: rel, heading: heading?.slice(3) ?? null, line, person, already: false }
    },
    text: (r) => (r.already ? `${r.path} already says that.` : `Remembered in ${r.path}${r.heading ? ` under ${r.heading}` : ""}: ${r.line}`),
  })
}
