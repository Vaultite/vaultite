import fs from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { check } from "../lib.ts"
import { type Any, fm, ROOT, same, VAULT } from "./lib.ts"
import { messageOf } from "../../../core/values.ts"

// ---------- reading: the same values as the server ----------

const { loadFm } = await import("../../../core/frontmatter.ts")
{
  const { linksIn, mapLinks, relativePath, resolvePath } = await import("../../../core/links.ts")
  {
    const line = "See [[Alice Park|Alice]], [the site](https://a.b/c) and <https://x.y>, ![[pic.png]] #plan https://z.w/p"
    const got = linksIn(line, 10).map((l) => ({ ...l, target: line.slice(l.target[0] - 10, l.target[1] - 10), text: l.text && line.slice(l.text[0] - 10, l.text[1] - 10) }))
    check("links: linksIn finds each kind of link, with where its target and text are written", JSON.stringify(got.map(({ wiki, url, tag, target, text, embed }) => [wiki ?? url ?? tag, target, text ?? null, !!embed])) ===
      JSON.stringify([["Alice Park", "Alice Park", "Alice", false], ["https://a.b/c", "https://a.b/c", "the site", false], ["https://x.y", "https://x.y", null, false], ["pic.png", "pic.png", null, true], ["plan", "plan", null, false], ["https://z.w/p", "https://z.w/p", null, false]]))
    check("links: linksIn spans start at the line's offset", linksIn("[[a]]", 7)[0].from === 7 && linksIn("[[a]]", 7)[0].to === 12)
  }
  const to = (t: string) => (t === "a" ? "b c" : t === "x/a.png" ? "y/a (1).png" : null)
  check("links: mapLinks keeps headings, aliases, table pipes, anchors and titles; skips URLs and code",
    mapLinks('[[a#H|t]] |[[a\\|t]]| [l](x/a.png "T") [m](<x/a.png#p>) [u](https://a) `[[a]]`', to) ===
    '[[b c#H|t]] |[[b c\\|t]]| [l](y/a%20%281%29.png "T") [m](<y/a (1).png#p>) [u](https://a) `[[a]]`',
    mapLinks('[[a#H|t]] |[[a\\|t]]| [l](x/a.png "T") [m](<x/a.png#p>) [u](https://a) `[[a]]`', to))
  check("links: relative paths", relativePath("A/B", "A/C/d.md") === "../C/d.md" && relativePath("", "a.md") === "a.md" &&
    resolvePath("A/B", "../C/d.md") === "A/C/d.md" && resolvePath("", "../x") === null)
}

const header = `---
type: person
bed: 23:15
wake: 07:15
big: 1e3
ok: yes
y: y
on: off
date: 2026-09-29
at: 2026-09-28T18:00:00Z
octal: 012
tags: [AI, Travel]
sets:
- {type: normal, reps: 10}
note: "\\U0001F35A rice"
empty:
---
`
const r = fm.readProps(header)
const server = loadFm(header.slice(4, -5))
check("frontmatter: the app reads what the server reads", !r.error && same(r.props, server), [r, server])
check("frontmatter: YAML 1.1 like the server (23:15 a number, 07:15 and 1e3 text, yes true)",
  r.props.bed === 1395 && r.props.wake === "07:15" && r.props.big === "1e3" && r.props.ok === true && r.props.y === "y" && r.props.octal === 10, r.props)
check("frontmatter: dates and times read as text", r.props.date === "2026-09-29" && r.props.at === "2026-09-28 18:00:00", r.props)
check("properties: typed numbers stay as written unless they're the number's own text",
  same(["12", "-3.5", "007", "1.50", "1e3", "0x1F", "+1", " ", "x"].map(fm.typedNumber), [12, -3.5, "007", "1.50", "1e3", "0x1F", "+1", null, "x"]))
check("properties: '007' typed as text stays text in the file", fm.setProp("---\na: 1\n---\n", "a", "007") === "---\na: '007'\n---\n",
  fm.setProp("---\na: 1\n---\n", "a", "007"))
check("properties: a datetime keeps its seconds and offset when edited",
  fm.toLocal("2026-09-28 18:00:05") === "2026-09-28T18:00:05" && fm.fromLocal("2026-09-28T19:30:05", "2026-09-28 18:00:05") === "2026-09-28 19:30:05" &&
  fm.fromLocal("2026-09-28T19:30", "2026-09-28T18:00:00+02:00") === "2026-09-28T19:30:00+02:00" &&
  fm.fromLocal("2026-09-29T18:00:05", "2026-09-28 18:00:05.25Z") === "2026-09-29 18:00:05.25Z" &&
  fm.fromLocal("2026-09-28T19:30", "2026-09-28 18:00") === "2026-09-28 19:30" && fm.fromLocal("2026-09-28T19:30", "") === "2026-09-28 19:30",
  [fm.fromLocal("2026-09-28T19:30", "2026-09-28T18:00:00+02:00")])
check("frontmatter: a broken header is an error, not properties", fm.readProps("---\ntags: [a\n---\n").error !== null)
check("frontmatter: a header that isn't key: value lines", fm.readProps("---\n- a\n---\n").error !== null)

// The usual frontmatter is read by hand (loadPlain): the same values as the YAML library, else left to it.
const Y: { loadPlain(t: string): unknown; loadYaml(t: string): unknown } = await import("../../../core/yaml.ts")
const tricky = ["a: 1", "a: 23:15", "a: 07:15", "a: 1e3", "a: 1.5e3", "a: .5", "a: -5", "a: +7", "a: 0x1F", "a: 012", "a: 0b101",
  "a: 1_000", "a: 190:20:30", "a: .inf", "a: -.inf", "a: .nan", "a: yes", "a: No", "a: ON", "a: off", "a: y", "a: n", "a: true",
  "a: ~", "a: null", "a: NULL", "a:", "a:   ", "a: 2026-09-29", "a: 2026-9-9", "a: 2026-09-28 18:00:00", "a: 2026-09-28T18:00:00Z",
  "a: 2026-09-28 18:00:00.5 +02:00", "a: 2026-13-45", "a: text with spaces  ", "a: Austin, TX", "a: https://x.com/a#b",
  "a: C#", "a: a # comment", "a: x: y", "a: x:", "a: Hello [world] {x}", "a: 'it''s'", "a: ''", "a: 'a: b'", "a: 'a # b'",
  "a: \"q\"", "a: \"a: b\"", "a: \"a\\tb\"", "a: \"\\U0001F35A\"", "a: [AI, Travel]", "a: []", "a: [ ]", "a: [1, 2.5, -3, yes, ~]",
  "a: [a, ]", "a: [[x]]", "a: [23:15]", "a: ['x']", "a: [2026-09-29, 2026-09-28 18:00:00]", "a: {x: 1}", "a: &x 1", "a: *x",
  "a: !!str 1", "a: |", "a: >", "a: - x", "a: -x", "a: -", "a: ?x", "a: :x", "a: %x", "a: @x", "a: `x`", "a: x\tb", "on: 1",
  "yes: 1", "null: 1", "__proto__: 1", "<<: 1", "a b: 1", "a-b_c: 1", "_a: 1", "a:1", "a: 1\na: 2", "a: 1\n\n# c\nb: 2",
  "a: 1 # c", "a:\n  b: 1", "a:\n- 1", "  a: 1", "a: 1\n  b", "- a", "a: [x, [y]]", "a: [x # y]", "a: \"x\" y", "a: 'x' y",
  "a: 'x", "a: [x", "a: ]x", "aliases: ['Real: title']", "tags:\n  - a\n  - b", "tags:\n- a\n- 'b c'", "a:\n  -\n  - x", "a:\n  - [x]",
  "a:\n  - x: 1", "a:\n  - x\n - y", "a:\n  -x", "a:\n  - 1\nb: 2", "aliases:\n  - \"Q: x\"", "a:\n  - x # c", "a:\n\n  - x",
  "a:\n  - - x", "a:\n  - yes\n  - 2026-09-29\n  - ~", "a:\n  - x\n  b: 1", "a:\n  - x\n\tb"]
const usual = ["type: person\nrelation: friend   \nevery_days: 30\nlocation: Austin, TX\ncoordinates: [30.27, -97.74]\ntags: [University, AI]",
  "type: note\nkind: idea\nstatus: seed\nid: idea-voice-journal\ncreated: '2026-09-28 18:00:00'\nupdated: 2026-09-28 18:00:00",
  "type: log\narea: climbing\ndate: 2026-09-27\nduration_min: 120\ntitle: Bouldering gym\ntop_grade: V3\nplace: \"Bouldering gym\"",
  "tags:\n  - book\n  - to-read\naliases:\n  - Dune (novel)\ncreated: 2025-03-14\nrating: 4"]
const texts = [...tricky, ...usual]
for (const f of fs.readdirSync(path.join(ROOT, "examples", "vault"), { recursive: true }) as string[]) {
  if (!f.endsWith(".md")) continue
  const m = /^---\n([\s\S]*?)\n---/.exec(fs.readFileSync(path.join(ROOT, "examples", "vault", f), "utf8"))
  if (m) texts.push(m[1])
}
const differ = texts.flatMap((t) => {
  const quick = Y.loadPlain(t)
  if (quick === undefined) return []
  let full: unknown
  try { full = Y.loadYaml(t) } catch (e) { full = `error: ${messageOf(e)}` }
  return same(quick, full) && Object.keys(quick as object).join() === Object.keys(full as object).join() ? [] : [[t, quick, full]]
})
check("yaml: frontmatter read by hand reads as the YAML library reads it", !differ.length, differ)
check("yaml: the usual frontmatter is read by hand", usual.every((t) => Y.loadPlain(t) !== undefined), usual.map((t) => Y.loadPlain(t)))

// ---------- writing: the same bytes as the server after the same change ----------

const { open } = await import("../../../core/app.ts")
const { Text } = await import("../../../core/plugins.ts")
const { publicOf } = await import("../../../core/vault.ts")
const app = await open(VAULT, { start: false })
async function api(method: string, route: string, body?: unknown): Promise<[number, Any]> {
  const parts = route.split("/").filter(Boolean).map(decodeURIComponent)
  const res = await app.run(method, parts, {}, body ?? {})
  return [res.status, res.body instanceof Text ? res.body.text : publicOf(res.body)]
}

const PERSON = `---
type: person
relation: friend   # since university
every_days: 30
context: Met at a design course
want_to: Call about the trip
tags: [University]
sort: 0
---

\`\`\`block-person
\`\`\`

Likes climbing.
`
const rel = "People/Alice Park.md"
let n = 0
/** The server's PUT and the app's setProp on the same file: the same text. `value` null: the value cleared. */
async function sameWrite(what: string, key: string, value: unknown) {
  const p = path.join(VAULT, rel)
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, PERSON)
  const t = Date.now() / 1000 + 2 + n++ // a new mtime, so the index reads it again
  fs.utimesSync(p, t, t)
  const [code] = await api("PUT", "people/Alice Park", { [key]: value === null ? "" : value })
  const byServer = fs.readFileSync(p, "utf8")
  const block = PERSON.slice(0, PERSON.indexOf("---\n\n") + 5)
  const byApp = fm.setProp(block, key, value) + PERSON.slice(block.length)
  check(`frontmatter: ${what}: the app writes what the server writes`, code === 200 && byApp === byServer, { code, byApp, byServer })
}
await sameWrite("a time-like text is quoted (23:15 would read as a number)", "want_to", "23:15")
await sameWrite("07:15 stays plain", "want_to", "07:15")
await sameWrite("a date is written plain", "want_to", "2026-10-01")
await sameWrite("yes is quoted", "context", "yes")
await sameWrite("a number", "every_days", 14)
await sameWrite("a list, inline", "tags", ["University", "AI"])
await sameWrite("a value cleared keeps its key, empty", "context", null)
await sameWrite("text with a colon and a quote", "context", "Met at: Sam's party")

const block = "---\ntype: note   # kept\ntitle: Idea\n---\n\n"
check("frontmatter: a new key goes at the end, other lines untouched",
  fm.setProp(block, "status", "seed") === "---\ntype: note   # kept\ntitle: Idea\nstatus: seed\n---\n\n", fm.setProp(block, "status", "seed"))
check("frontmatter: nothing to remove changes nothing", fm.setProp(block, "nope", undefined) === block)
check("frontmatter: the last key removed leaves no header", fm.setProp("---\na: 1\n---\n", "a", undefined) === "")
check("frontmatter: rename keeps the place and value",
  fm.renameProp("---\na: 1\nb: [x, y]\nc: 3\n---\n", "b", "tags") === "---\na: 1\ntags: [x, y]\nc: 3\n---\n")
check("frontmatter: rename touches only the key's text (its comment, quoting and the lines under it stay)",
  fm.renameProp("---\na: 1\nb: 'x'   # why\nc:\n  - p\n  - q\n---\n", "b", "new key") === "---\na: 1\nnew key: 'x'   # why\nc:\n  - p\n  - q\n---\n"
  && fm.renameProp("---\nc:\n  - p\n---\n", "c", "d") === "---\nd:\n  - p\n---\n", fm.renameProp("---\na: 1\nb: 'x'   # why\n---\n", "b", "new key"))
{
  const { renameKey } = await import(pathToFileURL(path.join(ROOT, "core/textedit.ts")).href)
  const { load } = await import(pathToFileURL(path.join(ROOT, "core/yaml.ts")).href)
  check("textedit: renameKey refuses a name that's taken, and quotes one YAML can't take plain",
    renameKey("a: 1\nb: 2", "a", "b", load) === null && renameKey("a: 1", "a", "x: y", load) === "'x: y': 1" && renameKey("a: 1", "z", "y", load) === null)
}
check("frontmatter: an emoji is written as it is, not escaped", fm.dumpKey("icon", "💡") === "icon: 💡", fm.dumpKey("icon", "💡"))
check("frontmatter: dumpKey writes like the server", fm.dumpKey("bed", "23:15") === "bed: '23:15'" && fm.dumpKey("d", "2026-09-29") === "d: 2026-09-29"
  && fm.dumpKey("n", 20.0) === "n: 20", [fm.dumpKey("bed", "23:15"), fm.dumpKey("d", "2026-09-29")])
