// The web app's logic that needs no browser, on Node (`@/` resolves to web/src; server, page and desktop modules stubbed):
// the property editor writes frontmatter exactly like the server, and the editor's merge.   node tools/test_web.ts
import assert from "node:assert"
import fs from "node:fs"
import { registerHooks } from "node:module"
import os from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

const ROOT = path.dirname(import.meta.dirname)
const WEB = path.join(ROOT, "web", "src")
const STUBS: Record<string, string> = {
  "@/core/data": "export const put = async () => { throw new Error('no server in tools/test_web.ts') }",
  "@/core/http": "export const put = async () => { throw new Error('no server in tools/test_web.ts') }",
  "@/core/files": "export const readFile = async () => { throw new Error('no server in tools/test_web.ts') }; export const splitFm = () => ({ fm: '', body: '' })",
  "@/core/prefs": "export const getPrefs = () => ({ disabled: [] })",
  "@/core/desktop": "export const webPages = null; export const keyboardTakes = () => 0; export const pageTakenSince = () => null",
}
registerHooks({
  resolve(spec, context, next) {
    if (spec in STUBS) return { url: `data:text/javascript,${encodeURIComponent(STUBS[spec])}`, shortCircuit: true }
    if (spec.startsWith("@/")) {
      const base = path.join(WEB, spec.slice(2))
      const file = [".ts", ".tsx", ""].map((x) => base + x).find((f) => fs.existsSync(f) && fs.statSync(f).isFile())
      if (file) return { url: pathToFileURL(file).href, shortCircuit: true }
    }
    // A relative import without its extension, the way Vite resolves it (core/markdown.ts -> ./richmd).
    if (spec.startsWith(".") && !/\.[a-z]+$/i.test(spec) && context.parentURL?.startsWith(pathToFileURL(WEB).href)) {
      const base = path.resolve(path.dirname(new URL(context.parentURL).pathname), spec)
      const file = [".ts", ".tsx"].map((x) => base + x).find((f) => fs.existsSync(f))
      if (file) return { url: pathToFileURL(file).href, shortCircuit: true }
    }
    return next(spec, context)
  },
})

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any
type Props = Record<string, unknown>
// The web modules are loaded through the hook above (tsconfig.app.json type-checks them), so they're typed here by hand.
const web = (rel: string) => import(pathToFileURL(path.join(WEB, rel)).href)
const fm: {
  readProps(block: string): { props: Props; error: string | null }
  setProp(block: string, key: string, value: unknown): string
  renameProp(block: string, from: string, to: string): string
  dumpKey(key: string, value: unknown): string
  typedNumber(s: string): number | string | null
  toLocal(v: string): string
  fromLocal(s: string, was: string): string
} = await web("core/frontmatter.ts")
const merge: { merge3(base: string, mine: string, actual: string): string | null; opcodes<T>(a: T[], b: T[]): [string, number, number, number, number][]
  textChanges(a: string, b: string): { from: number; to: number; insert: string }[] } =
  await web("core/merge.ts")

const fails: string[] = []
function check(name: string, ok: unknown, got?: unknown) {
  console.log((ok ? "ok   " : "FAIL ") + name + (ok ? "" : `  -> ${JSON.stringify(got)?.slice(0, 400)}`))
  if (!ok) fails.push(name)
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

// ---------- reading: the same values as the server ----------

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vaultite-web-"))
const VAULT = path.join(tmp, "vault")
fs.mkdirSync(VAULT)
process.env.VAULTITE_VAULT = VAULT
process.env.VAULTITE_LOCAL = path.join(tmp, "local")
const { loadFm } = await import("../core/vault.ts")
{
  const { mapLinks, relativePath, resolvePath } = await import("../core/links.ts")
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
const Y: { loadPlain(t: string): unknown; loadYaml(t: string): unknown } = await import("../core/yaml.ts")
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
  "a: 'x", "a: [x", "a: ]x", "aliases: ['Real: title']"]
const usual = ["type: person\nrelation: friend   \nevery_days: 30\nlocation: Austin, TX\ncoordinates: [30.27, -97.74]\ntags: [University, AI]",
  "type: note\nkind: idea\nstatus: seed\nid: idea-voice-journal\ncreated: '2026-09-28 18:00:00'\nupdated: 2026-09-28 18:00:00",
  "type: log\narea: climbing\ndate: 2026-09-27\nduration_min: 120\ntitle: Bouldering gym\ntop_grade: V3\nplace: \"Bouldering gym\""]
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
  try { full = Y.loadYaml(t) } catch (e) { full = `error: ${(e as Error).message}` }
  return same(quick, full) && Object.keys(quick as object).join() === Object.keys(full as object).join() ? [] : [[t, quick, full]]
})
check("yaml: frontmatter read by hand reads as the YAML library reads it", !differ.length, differ)
check("yaml: the usual frontmatter is read by hand", usual.every((t) => Y.loadPlain(t) !== undefined), usual.map((t) => Y.loadPlain(t)))

// ---------- writing: the same bytes as the server after the same change ----------

const { open } = await import("../core/app.ts")
const { Text } = await import("../core/plugins.ts")
const { publicOf } = await import("../core/vault.ts")
const app = await open(VAULT, { start: false })
async function api(method: string, route: string, body?: unknown): Promise<[number, Any]> {
  const parts = route.split("/").filter(Boolean).map(decodeURIComponent)
  const res = await app.vault.lock(async () => {
    await app.vault.sync()
    return app.run(method, parts, {}, body ?? {})
  })
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

// ---------- the editor's merge (the server's core/textedit.ts) ----------

const base = "a\nb\nc\nd\n"
check("merge: changes on both sides in different lines are both kept", merge.merge3(base, "A\nb\nc\nd\n", "a\nb\nc\nD\n") === "A\nb\nc\nD\n",
  merge.merge3(base, "A\nb\nc\nd\n", "a\nb\nc\nD\n"))
check("merge: the same line changed on both sides is a conflict", merge.merge3(base, "a\nX\nc\nd\n", "a\nY\nc\nd\n") === null)
check("merge: the same change on both sides is kept once", merge.merge3(base, "a\nX\nc\nd\n", "a\nX\nc\nd\n") === "a\nX\nc\nd\n")
check("merge: nothing changed on disk gives mine", merge.merge3(base, "a\nb\nnew\nc\nd\n", base) === "a\nb\nnew\nc\nd\n")
check("merge: opcodes", same(merge.opcodes(["a", "b", "c"], ["a", "x", "c"]), [["equal", 0, 1, 0, 1], ["replace", 1, 2, 1, 2], ["equal", 2, 3, 2, 3]]),
  merge.opcodes(["a", "b", "c"], ["a", "x", "c"]))

// A line diff at any size (File history's): what it says equal is equal, and it rebuilds the other side exactly.
{
  const { diffLines } = await import("../core/linediff.ts")
  const rebuilds = (a: string[], b: string[]) => {
    const out: string[] = []
    let i = 0, j = 0
    for (const [tag, i1, i2, j1, j2] of diffLines(a, b)) {
      if (i1 !== i || j1 !== j) return false
      if (tag === "equal" && a.slice(i1, i2).join("\n") !== b.slice(j1, j2).join("\n")) return false
      for (let k = j1; k < j2; k++) out.push(b[k])
      i = i2; j = j2
    }
    return i === a.length && j === b.length && out.join("\n") === b.join("\n")
  }
  const rnd = (n: number) => Math.floor(Math.random() * n)
  let ok = true
  for (let k = 0; k < 500 && ok; k++) {
    const a = Array.from({ length: rnd(30) }, () => String(rnd(5))), b = a.slice()
    for (let e = rnd(6); e > 0; e--) { const p = rnd(b.length + 1); if (rnd(2)) b.splice(p, 1); else b.splice(p, 0, String(rnd(7))) }
    ok = rebuilds(a, b)
  }
  check("diff: random small edits are told right", ok)
  const big = Array.from({ length: 300_000 }, (_, k) => `line ${k}`), edited = big.slice()
  edited.splice(150_000, 1, "changed"); edited.splice(10, 0, "added")
  const t0 = performance.now(), ops = diffLines(big, edited)
  check("diff: 300k lines, two edits, quickly and exactly", rebuilds(big, edited) && ops.filter((o) => o[0] !== "equal").length === 2 && performance.now() - t0 < 3000,
    [ops.length, performance.now() - t0])
  const x = Array.from({ length: 50_000 }, (_, k) => String(k % 3)), y = x.slice().reverse()
  check("diff: what's too tangled to compare is still right", rebuilds(x, y))
}

// A change on disk shown in the editor: one change per changed run, so a cursor between them stays put.
{
  const apply = (a: string, cs: { from: number; to: number; insert: string }[]) => {
    let out = "", at = 0
    for (const c of cs) { out += a.slice(at, c.from) + c.insert; at = c.to }
    return out + a.slice(at)
  }
  const cases: [string, string][] = [["", "x"], ["x", ""], ["x", "x\ny"], ["x\ny", "x"], ["x\n", "x"], ["a\nb\nc", "b\nc"],
    ["a\n\nb\n", "a\n\nb\nc\n"], ["one\ntwo\nthree\n", "ONE\ntwo\nTHREE\n"], ["a\nb", "a\nb\n\n"], ["\n\n", "\n"]]
  // and random ones
  let seed = 7
  const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n }
  const words = ["a", "b", "", "c d", "e"]
  const text = () => Array.from({ length: rnd(7) }, () => words[rnd(words.length)]).join("\n")
  for (let i = 0; i < 300; i++) cases.push([text(), text()])
  const bad = cases.filter(([a, b]) => {
    const cs = merge.textChanges(a, b)
    const sorted = cs.every((c, k) => c.from <= c.to && (k === 0 || cs[k - 1].to <= c.from))
    return !sorted || apply(a, cs) !== b
  })
  check("merge: a change on disk as the editor's changes gives the new text", !bad.length, bad.slice(0, 3))
  const cs = merge.textChanges("one\ntwo\nthree\n", "ONE\ntwo\nTHREE\n")
  check("merge: two places changed are two changes, the line between untouched", cs.length === 2 && cs[0].to <= 4 && cs[1].from >= 8, cs)
}

// ---------- CSV (core/csv.ts, shared): the separator a spreadsheet used, and how many records ----------
{
  const csv: { parseCsv(t: string): string[][]; csvRecords(t: string): Record<string, string>[] } = await import(pathToFileURL(path.join(ROOT, "core", "csv.ts")).href)
  check("csv: ; and tab separated files read as columns, a ; inside quotes stays", same(csv.parseCsv("a;b\n1;2\n"), [["a", "b"], ["1", "2"]])
    && same(csv.parseCsv("a\tb\n1\t2"), [["a", "b"], ["1", "2"]]) && same(csv.parseCsv('x,y\n"1;2",3\n'), [["x", "y"], ["1;2", "3"]]), csv.parseCsv("a;b\n1;2\n"))
  check("csv: records as parsed (a quoted line break, an empty row)", csv.csvRecords('n,note\r\n"Lee, Sam","a\r\nb"\r\n,,\r\n').length === 1)
}

// ---------- Dates (core/dates.ts, shared): moment's formats, weeks from a chosen day, read back strictly or loosely ----------
{
  const { formatDate: f, parseDate: p } = await import(pathToFileURL(path.join(ROOT, "core", "dates.ts")).href) as typeof import("../core/dates.ts")
  const d = new Date(2027, 0, 2, 15, 4)
  check("dates: formats, ISO weeks and US ones", f(d, "dddd, MMMM Do YYYY [at] h:mm a") === "Saturday, January 2nd 2027 at 3:04 pm"
    && f(d, "GGGG-[W]WW gggg-[W]ww") === "2026-W53 2026-W53" && f(d, "gggg-[W]ww", { start: 0, jan: 1 }) === "2027-W01", f(d, "GGGG-[W]WW gggg-[W]ww"))
  check("dates: a week's name read as its first day; a name the format doesn't write isn't one", p("2027-W01", "gggg-[W]ww", { start: 0, jan: 1 })?.getDate() === 27
    && p("2026-13-01", "YYYY-MM-DD") === null && p("2026-10-06 Notes", "YYYY-MM-DD") === null && p("2026-10-06 Notes", "YYYY-MM-DD", { loose: true })?.getDate() === 6)
}

// ---------- A file's type and archiving (core/fileprops.ts, shared): one rule on both sides ----------
{
  const fp: { effectiveType(kind: string | null | undefined, fm: Props | null): string | null; isArchived(x: object | null | undefined): boolean; setMarks(m: Record<string, unknown>[]): void } =
    await import(pathToFileURL(path.join(ROOT, "core", "fileprops.ts")).href)
  check("type: a kind's type wins; else the frontmatter's; else none", fp.effectiveType("person", { type: "note" }) === "person" &&
    fp.effectiveType(null, { type: "dashboard" }) === "dashboard" && fp.effectiveType(null, { type: 3 }) === null && fp.effectiveType(null, {}) === null)
  check("type: no mark without a plugin that declares it", fp.effectiveType(null, { "kanban-plugin": "board" }) === null)
  fp.setMarks([{ marks: { "kanban-plugin": "kanban" } }])
  check("type: a plugin's mark types a file without one (kanban-plugin: board is kanban)", fp.effectiveType(null, { "kanban-plugin": "board" }) === "kanban" &&
    fp.effectiveType(null, { type: "note", "kanban-plugin": "board" }) === "note" && fp.effectiveType(null, { "kanban-plugin": "" }) === null && fp.effectiveType(null, { "other-plugin": "x" }) === null)
  fp.setMarks([])
  // The file view works it out for the file being edited: its row's type when a kind owns it, else what's typed.
  const row = { kind: "people", type: "person" }
  check("type: the file being edited keeps its kind's type, whatever is typed", fp.effectiveType(row.kind ? row.type : null, { type: "dashboard" }) === "person")
  check("archived: true, yes or a date archive; false, no or nothing don't", fp.isArchived({ archived: true }) && fp.isArchived({ archived: "2026-09-01" }) &&
    !fp.isArchived({ archived: false }) && !fp.isArchived({ archived: "no" }) && !fp.isArchived({}) && !fp.isArchived(undefined))
  // What a file's properties become after Archive and Unarchive (the app's setProperty is setProp on the file's header).
  const head = "---\ntype: note\ntags: [a]  # mine\n---\n"
  const on = fm.setProp(head, "archived", true)
  check("archived: Archive adds one line, Unarchive takes it away", on === "---\ntype: note\ntags: [a]  # mine\narchived: true\n---\n" && fm.setProp(on, "archived", undefined) === head, on)
}

// ---------- Markdown's extras: headings and blocks to go to, tags, comments, highlights, note embeds ----------

// The editor reads a frontmatter of any size as one block (read on until it closes, not only its first MB).
{
  const { frontmatterSyntax } = await web("editor/frontmatter.ts")
  const { parser } = await import("@lezer/markdown")
  const big = `---\nnotes: ${"x".repeat(3 << 20)}\n---\n# After\n`
  const tree = parser.configure([frontmatterSyntax]).parse(big)
  const first = tree.topNode.firstChild
  check("editor: a frontmatter over a few MB is one block", first?.name === "Frontmatter" && first.to === big.indexOf("\n# After"), [first?.name, first?.to])
}

const md: { renderMarkdown(text: string, resolves?: (t: string) => { kind: string } | null): string } = await web("core/markdown.ts")
const formats: { embedOf(line: string): { target: string; height?: number; note?: boolean } | null } = await web("core/formats.ts")
const sec = await import(pathToFileURL(path.join(ROOT, "core", "sections.ts")).href)
const html = md.renderMarkdown("A ==bright== idea #idea/new and `#code`, %%hidden%% text ^b1\n\n%%\nnot shown\n%%\n\n[[Note#Plans]] and [x](Some%20Note.md#Plans) and [[#Top]]\n\n^alone\n",
  (t) => (t.startsWith("Some Note") || t.startsWith("Note") ? { kind: "file" } : null))
check("markdown: ==highlight== is a mark", html.includes("<mark>bright</mark>"), html)
check("markdown: #tags are clickable, not in code", html.includes('<a class="tag" data-tag="idea/new">#idea/new</a>') && html.includes("<code>#code</code>"), html)
check("markdown: comments and block ids are hidden", !html.includes("hidden") && !html.includes("not shown") && !html.includes("^b1") && !html.includes("alone"), html)
check("markdown: a heading link names the heading; same-file and Markdown links to notes are links",
  html.includes('data-wiki="Note#Plans">Note › Plans</a>') && html.includes('data-wiki="Some Note#Plans">x</a>') && html.includes('data-wiki="#Top">Top</a>'), html)
check("embeds: a note, a section, a block, a heading here", same([formats.embedOf("![[Idea]]"), formats.embedOf("![[Idea#Plans]]"), formats.embedOf("![[Idea#^b1]]"), formats.embedOf("![[#Top]]")].map((e) => e?.note),
  [true, true, true, true]) && formats.embedOf("![[photo.png]]") === null && formats.embedOf("![[v1.2 notes]]")?.note === true)
const note = "---\ntags: [a]\n---\n# Top\n\nIntro #intro and `#no` [[X#y]] ^p1\n\n## Plans\n\n- one ^li\n  - under\n- two\n\n```\n# not a heading #no\n```\n\n## After\n"
check("sections: headings (not in code or the frontmatter)", same(sec.headingsOf(note).map((h: Any) => h.text), ["Top", "Plans", "After"]), sec.headingsOf(note))
check("sections: fences close with their own character, at least as long", JSON.stringify(sec.scan("````md\n```js\n```\n````\n~~~\n```\n~~~\n```x").fences)
  === JSON.stringify([{ open: 0, close: 3, info: "md" }, { open: 4, close: 6, info: "" }, { open: 7, close: null, info: "x" }]), sec.scan("````md\n```js\n```\n````").fences)
check("sections: a heading's section", sec.extract(note, "Plans") === "## Plans\n\n- one ^li\n  - under\n- two\n\n```\n# not a heading #no\n```", sec.extract(note, "plans"))
check("sections: a block (its id taken off), a list item with what's under it", sec.extract(note, "^p1") === "Intro #intro and `#no` [[X#y]]" && sec.extract(note, "^li") === "- one\n  - under",
  [sec.extract(note, "^p1"), sec.extract(note, "^li")])
check("sections: tags from the frontmatter and the text", same(sec.tagsOf({ tags: ["a"] }, note), ["a", "intro"]), sec.tagsOf({ tags: ["a"] }, note))
check("sections: nested tags count for their parents", sec.hasTag(["project/lighthouse"], "project") && !sec.hasTag(["projects"], "project"))
check("sections: reading hides comments and ids", sec.stripHidden("a %%x%% b ^id\n%%\ngone\n%%\nc") === "a  b\nc", sec.stripHidden("a %%x%% b ^id\n%%\ngone\n%%\nc"))

// ---------- the store refreshed as a patch (core/statepatch.ts: the server makes it, the app applies it) ----------

const sp = await import("../core/statepatch.ts")
const deep = (a: unknown, b: unknown) => { try { assert.deepStrictEqual(a, b); return true } catch { return false } }
/** now, made from old through a patch as the server sends it: [the result, the patch's JSON]. */
function through(old: unknown, now: unknown): [unknown, string | null] {
  const a = sp.snapshot(old), b = sp.snapshot(now, a)
  const patch = sp.patchOf(a, b)
  return [patch === null ? old : sp.applyPatch(old, JSON.parse(patch)), patch]
}
const st0 = {
  notes: Array.from({ length: 50 }, (_, i) => ({ id: `Notes/N${i}`, title: `N${i}`, body: "x".repeat(40), tags: [] })),
  files: { files: [{ path: "a.md", links: [["b", "line"]] }, { path: "b.md", links: [] }], folders: ["Notes"] },
  config: { plugins: { panels: ["search:search", "files:files"], disabled: [] }, hotkeys: {} },
  workspaces: [{ name: "One", layout: { root: { id: "g0", tabs: [{ id: "t1", to: "new" }], active: "t1" } } }, null],
  me: null, n: 3,
}
{
  const next = structuredClone(st0)
  next.notes[7].body = "changed"
  next.notes.splice(20, 1)
  next.notes.unshift({ id: "Notes/New", title: "New", body: "", tags: [] })
  const [got, patch] = through(st0, next)
  check("state patch: items changed, removed, added come out the same", deep(got, next), got)
  check("state patch: only the changed items travel", !!patch && patch.length < 600 && !patch.includes("N30"), patch)
  const g = got as typeof st0
  check("state patch: what didn't change is the same objects", g.notes[1] === st0.notes[0] && g.files === st0.files && g.config === st0.config
    && g.workspaces === st0.workspaces && g.notes[8] !== st0.notes[7])
}
check("state patch: nothing changed is null", through(st0, structuredClone(st0))[1] === null)
{
  const next = structuredClone(st0)
  next.workspaces[0]!.layout.root.tabs.push({ id: "t2", to: "file:a.md" })
  const [got, patch] = through(st0, next)
  check("state patch: a workspace's tabs, and nothing else", deep(got, next) && !!patch && patch.startsWith('{"keys":{"workspaces":') && (got as typeof st0).notes === st0.notes, patch)
}
{
  const next: Record<string, unknown> = structuredClone(st0)
  delete next.me
  next.added = { x: 1 }
  ;(next.config as typeof st0.config).plugins.panels.reverse()
  const [got, patch] = through(st0, next)
  check("state patch: keys dropped and added, key order kept", deep(got, next) && same(Object.keys(got as object), Object.keys(next)), [patch, Object.keys(got as object)])
}
{
  // Keys in another order than before, keys that are integers, a key named __proto__: exact all the same.
  const old = { a: 1, b: { c: 2 }, "10": "x" }, now = JSON.parse('{"b": {"c": 3}, "a": 1, "2": "y", "__proto__": {"p": 1}}')
  const [got] = through(old, now)
  check("state patch: reordered keys, integer keys and __proto__", deep(got, now) && same(Object.keys(got as object), Object.keys(now)) && Object.getPrototypeOf(got) === Object.prototype, got)
}
{
  // Whole values where a piece changed its kind, and random edits to lists.
  let ok = true
  let seed = 7
  const rnd = (n: number) => (seed = (seed * 1103515245 + 12345) % 2147483648) % n
  let cur: unknown[] = Array.from({ length: 30 }, (_, i) => ({ i }))
  for (let round = 0; round < 200 && ok; round++) {
    const next = [...cur]
    for (let k = rnd(4); k >= 0; k--) {
      const op = rnd(4), at = rnd(next.length + 1)
      if (op === 0) next.splice(at, 0, { i: 1000 + round * 10 + k })
      else if (op === 1 && next.length) next.splice(at % next.length, 1)
      else if (op === 2 && next.length) next[at % next.length] = { i: -round }
      else next.push(next[rnd(next.length)] ?? null)
    }
    const [got] = through(cur, next)
    ok = deep(got, next)
    cur = got as unknown[]
  }
  check("state patch: 200 rounds of random list edits (duplicates too)", ok)
  check("state patch: a list that became an object, and back", deep(through([1, 2], { a: 1 })[0], { a: 1 }) && deep(through({ a: 1 }, [1, 2])[0], [1, 2]))
}
check("state patch: one that doesn't fit what the app has throws (it then loads it all)", (() => {
  try { sp.applyPatch([1, 2], { items: [[0, 5]] }); return false } catch { /* the right answer */ }
  try { sp.applyPatch(null, { keys: { a: { set: 1 } } }); return false } catch { return true }
})())
check("state patch: the JSON from pieces is the value's", deep(JSON.parse(sp.jsonOf(sp.snapshot(st0))), st0))

const tl = await import(pathToFileURL(path.join(ROOT, "core", "timeline.ts")).href)
const lines = "- 2026-09-28 · call · Talked\n  more about it\n\nA line typed here\n- no date · note · x\n- 2026-09-01 · note · Fact"
check("timeline: lines that aren't entries are kept to show (continuation lines aren't)", same(tl.strayLines(lines), ["A line typed here", "- no date · note · x"])
  && tl.parseTimeline(lines).length === 2, tl.strayLines(lines))

// Places plugins fill and the user arranges (core/slots.ts), and a new tab's page (core/newtab.ts).
{
  const sl = await import("../core/slots.ts")
  const nt = await import("../core/newtab.ts")
  check("slots: the default is by sort, without hidden keys", same(sl.defaultOrder([{ key: "b", sort: 20 }, { key: "a", sort: 10 }, { key: "h", sort: 0, hidden: true }, { key: "c" }]), ["a", "b", "c"]))
  check("slots: a key put before another, or at the end", same(sl.placeKey(["a", "b", "c"], "c", "a"), ["c", "a", "b"]) && same(sl.placeKey(["a", "b"], "x", null), ["a", "b", "x"]) && same(sl.placeKey(["a", "b"], "a", "gone"), ["b", "a"]))
  const list = ["a", "b", "c"]
  check("slots: positions to anchors", sl.anchorFor(list, "c", "top") === "a" && sl.anchorFor(list, "a", "bottom") === null && sl.anchorFor(list, "b", "up") === "a" &&
    sl.anchorFor(list, "b", "down") === null && sl.anchorFor(list, "a", "2") === "c" && sl.anchorFor(list, "a", "0") === "b" && sl.anchorFor(list, "x", "2") === "b" && sl.anchorFor(list, "a", "sideways") === undefined)
  check("slots: down from the top lands second", same(sl.placeKey(list, "a", sl.anchorFor(list, "a", "down") ?? null), ["b", "a", "c"]))
  check("newtab: unset reads as nulls; lists read leniently", same(nt.readNewTab(undefined), { sections: null, actions: null, icons: null }) &&
    same(nt.readNewTab({ sections: ["core:actions", 3, "core:actions", ""], actions: "file:new", icons: { "file:new": " star ", "palette:open": 3, x: "" } }),
      { sections: ["core:actions"], actions: null, icons: { "file:new": "star" } }))
  check("newtab: a button's icon set, changed and taken off (none left: unset)", same(nt.withIcon(null, "file:new", "star"), { "file:new": "star" }) &&
    same(nt.withIcon({ "file:new": "star", "palette:open": "x" }, "file:new", ""), { "palette:open": "x" }) && nt.withIcon({ "file:new": "star" }, "file:new", " ") === null)
  const all = [...nt.CORE_SECTIONS, { key: "terminal:sessions", sort: 5, hidden: true }, { key: "pages:tiles", sort: 0 }]
  check("newtab: the default page is by sort, without hidden sections", same(nt.shownSections(nt.readNewTab({}), all), ["pages:tiles", "core:actions", "core:opened", "core:changed"]))
  check("newtab: a saved page is as listed (an empty one too)", same(nt.shownSections(nt.readNewTab({ sections: ["terminal:sessions", "core:actions"] }), all), ["terminal:sessions", "core:actions"]) &&
    same(nt.shownSections(nt.readNewTab({ sections: [] }), all), []))
  check("newtab: the default buttons, else the saved ones", same(nt.shownActions(nt.readNewTab({})), nt.DEFAULT_ACTIONS) && same(nt.shownActions(nt.readNewTab({ actions: ["terminal:claude"] })), ["terminal:claude"]))
}

// The sidebars' panels (core/sidebars.ts, shared with the CLI and Workspaces): read leniently, moves anchored on panels.
{
  const sb = await import("../core/sidebars.ts")
  const s = sb.readSidebars({ left: ["search:search", "pages:pages", 3, "files:files", "pages:pages"], right: ["files:files", "tags:tags"], collapsed: ["pages:pages", "gone:gone"] })!
  check("sidebars: read leniently (not text, repeats and folds of panels not shown go)", JSON.stringify(s) ===
    JSON.stringify({ left: ["search:search", "pages:pages", "files:files"], right: ["tags:tags"], collapsed: ["pages:pages"], heights: {} }), s)
  check("sidebars: unset reads as null; one side is enough", sb.readSidebars({ other: 1 }) === null && sb.readSidebars(undefined) === null &&
    JSON.stringify(sb.readSidebars({ right: ["a"] })) === JSON.stringify({ left: [], right: ["a"], collapsed: [], heights: {} }))
  const tall = sb.readSidebars({ left: ["a", "b"], heights: { a: 180.4, b: -1, gone: 90, c: "x" } })!
  check("sidebars: heights of panels shown, whole pixels", JSON.stringify(tall.heights) === JSON.stringify({ a: 180 }), tall)
  const moved = sb.placePanel(tall, "a", { side: "right", before: null })
  check("sidebars: a height moves with its panel; hidden, it goes", moved.heights.a === 180 && !("a" in sb.withoutPanel(tall, "a").heights), moved)
  check("sidebars: a height set and cleared", sb.setHeight(tall, "b", 99).heights.b === 99 && !("a" in sb.setHeight(tall, "a", null).heights))
  // Heights drawn in proportion to the sidebar's height they were set at (heightsAt).
  const at = sb.setHeight(tall, "b", 100, 800)
  check("sidebars: a height set at a sidebar's height remembers it", at.heightsAt === 800 && at.heights.b === 100 && at.heights.a === 180, at)
  check("sidebars: drawn in proportion on a taller screen", sb.heightIn(at, "b", 1200) === 150 && sb.heightIn(at, "a", 400) === 90 && sb.heightIn(tall, "a", 1200) === 180)
  const again = sb.setHeight(at, "b", 120, 400)
  check("sidebars: set on another screen, the others are put in its terms", again.heightsAt === 400 && again.heights.a === 90 && again.heights.b === 120, again)
  check("sidebars: heightsAt read back, and dropped with no heights", sb.readSidebars({ left: ["a"], heights: { a: 50 }, heightsAt: 700 })!.heightsAt === 700 &&
    !("heightsAt" in sb.readSidebars({ left: ["a"], heightsAt: 700 })!))
  const pins = await import("../core/pins.ts")
  check("pins: placed at the end, before another, moved, unpinned", pins.placePin(["a", "b"], "c", true).join() === "a,b,c" &&
    pins.placePin(["a", "b"], "c", true, "a").join() === "c,a,b" && pins.placePin(["a", "b"], "b", true, "a").join() === "b,a" &&
    pins.placePin(["a", "b"], "a", true).join() === "a,b" && pins.placePin(["a", "b"], "a", false).join() === "b")
  check("pins: follow a moved folder, go with the trash", pins.repinList(["N/a", "N/b", "M"], "N", "O").join() === "O/a,O/b,M" &&
    pins.repinList(["N/a", "M"], "N/a", null).join() === "M")
  check("pins: a heading follows its note, a search stays", pins.repinList(["N/a.md#Plan", "search:N/a.md", "N/a.md"], "N/a.md", "O/b.md").join() === "O/b.md#Plan,search:N/a.md,O/b.md" &&
    pins.repinList(["N/a.md#Plan", "M"], "N", null).join() === "M" && JSON.stringify(pins.pinKind("N/a.md#^id")) === '{"file":"N/a.md","heading":"^id"}',
    pins.repinList(["N/a.md#Plan", "search:N/a.md", "N/a.md"], "N/a.md", "O/b.md"))
  check("sidebars: the default is by sort, without hidden panels", sb.defaultSidebars([{ key: "b", sort: 20 }, { key: "a", sort: 10 }, { key: "h", sort: 0, hidden: true }]).left.join() === "a,b")
  const up = sb.placePanel(s, "files:files", { side: "left", before: "search:search" })
  check("sidebars: moved before another", up.left.join() === "files:files,search:search,pages:pages", up)
  const right = sb.placePanel(s, "pages:pages", { side: "right", before: null })
  check("sidebars: to the other sidebar's end, folded as it was", right.right.join() === "tags:tags,pages:pages" && !right.left.includes("pages:pages") && right.collapsed.includes("pages:pages"), right)
  const self = sb.placePanel(s, "files:files", { side: "left", before: "files:files" })
  check("sidebars: an anchor that's gone (itself) puts it at the end", self.left.join() === "search:search,pages:pages,files:files", self)
  const hid = sb.withoutPanel(s, "pages:pages")
  check("sidebars: hidden, its fold goes too (shown again, it's open)", !hid.left.includes("pages:pages") && !hid.collapsed.length, hid)
  check("sidebars: fold and open", sb.setCollapsed(s, "files:files", true).collapsed.join() === "pages:pages,files:files" && !sb.setCollapsed(s, "pages:pages", false).collapsed.length)
  const many = sb.setHeights(at, { a: 60, b: null }, 400)
  check("sidebars: several heights set at once", many.heights.a === 60 && !("b" in many.heights) && many.heightsAt === 400, many)

  // Laying out panels in their own boxes (fitPanels, dragPanels, heightsAfterDrag): px.
  const search = { content: 32, min: 112 }, pinned = { content: 68, min: 112 }, terms = { content: 68, min: 112 }
  const tree = { content: 1600, min: 112, greedy: true }
  const fit = sb.fitPanels([search, pinned, terms, tree], 700)
  check("fit: panels that draw little keep their whole height, the tree takes the rest", JSON.stringify(fit) === JSON.stringify([32, 68, 68, 532]), fit)
  const small = sb.fitPanels([pinned, { content: 300, min: 112, greedy: true }], 700)
  check("fit: everything fits: each as tall as it draws, the rest empty at the bottom", JSON.stringify(small) === JSON.stringify([68, 300]), small)
  const two = sb.fitPanels([{ content: 216, min: 112 }, tree], 600)
  check("fit: a panel that doesn't fit gets all it draws while the tree keeps half", JSON.stringify(two) === JSON.stringify([216, 384]), two)
  const three = sb.fitPanels([{ content: 430, min: 112 }, { content: 380, min: 112 }, tree], 728)
  check("fit: several that don't fit share half, evenly; the tree the other half", JSON.stringify(three) === JSON.stringify([182, 182, 364]), three)
  const uneven = sb.fitPanels([{ content: 150, min: 112 }, { content: 900, min: 112 }, tree], 800)
  check("fit: one needing less than its share keeps only that", JSON.stringify(uneven) === JSON.stringify([150, 250, 400]), uneven)
  const dragged = sb.fitPanels([{ content: 400, min: 112, height: 300 }, tree], 700)
  check("fit: a saved height kept, the tree takes the rest", JSON.stringify(dragged) === JSON.stringify([300, 400]), dragged)
  const stale = sb.fitPanels([{ content: 68, min: 112, height: 400 }, tree], 700)
  check("fit: a saved height taller than what it draws: clamped (no empty room inside)", JSON.stringify(stale) === JSON.stringify([68, 632]), stale)
  const back = sb.fitPanels([{ content: 300, min: 112, height: 150 }, { content: 200, min: 112 }], 700)
  check("fit: room to spare: one dragged short takes it back", JSON.stringify(back) === JSON.stringify([300, 200]), back)
  const tight = sb.fitPanels([{ content: 400, min: 112, height: 300 }, { content: 400, min: 112, height: 300 }, tree], 400)
  check("fit: short of room: the tree at its least, saved heights give way in proportion", tight[2] === 112 && tight[0] === 144 && tight[1] === 144, tight)
  const tiny = sb.fitPanels([{ content: 400, min: 112 }, tree, { content: 30, min: 112, fixed: true }], 100)
  check("fit: no room at all: all at their least (the sidebar scrolls)", JSON.stringify(tiny) === JSON.stringify([112, 112, 30]), tiny)
  check("fit: whole pixels that add up to the room", sb.fitPanels([{ content: 333, min: 50 }, { content: 333, min: 50 }, { content: 333, min: 50 }], 500).reduce((a, b) => a + b) === 500)

  const ps = [pinned, { content: 400, min: 112 }, tree], start = sb.fitPanels(ps, 700)
  const down = sb.dragPanels(ps, start, 1, 80)
  check("drag: down, the panel above grows and the one below gives", down[1] === start[1] + 80 && down[2] === start[2] - 80 && down[0] === start[0], [start, down])
  const capped = sb.dragPanels(ps, start, 1, 900)
  check("drag: never taller than what it draws", capped[1] === 400 && capped.reduce((a, b) => a + b) === start.reduce((a, b) => a + b), capped)
  const none = sb.dragPanels(ps, start, 0, 50)
  check("drag: a panel that draws little can't grow past it (nor the ones above it)", JSON.stringify(none) === JSON.stringify(start), none)
  const upward = sb.dragPanels(ps, start, 1, -500)
  check("drag: up, it gives down to its least and the tree below grows", upward[1] === 112 && upward[2] === start[2] + start[1] - 112, upward)
  const cascade = sb.dragPanels([{ content: 400, min: 112 }, { content: 300, min: 112 }, tree], [200, 200, 300], 1, -250)
  check("drag: past its least, the next one up gives too", JSON.stringify(cascade) === JSON.stringify([112, 112, 476]), cascade)
  const save = sb.heightsAfterDrag(ps, 700, down)
  check("drag: saves the dragged panel's height, not the tree's (it takes the rest anyway)", save.get(1) === down[1] && !save.has(2) && !save.has(0), [...save])
  const full = sb.heightsAfterDrag([pinned, { content: 400, min: 112, height: 200 }, tree], 700, [68, 400, 232])
  check("drag: dragged out to all it draws: the height it needs", full.get(1) === 400 && !full.has(2), [...full])
}

// ---------- tabs: a blank tab is never left behind (web/src/core/workspace.ts, splits.ts) ----------

{
  // Just enough of a browser for the tabs: the address, its history, a phone's or a computer's width.
  let desktop = true
  const g = globalThis as Any
  g.location = { hash: "" }
  g.history = { state: null, pushState(st: unknown, _: string, h: string) { this.state = st; g.location.hash = h }, replaceState(st: unknown, _: string, h?: string) { this.state = st; if (h) g.location.hash = h } }
  g.matchMedia = () => ({ matches: desktop })
  g.localStorage = { getItem: () => null, setItem() {} }
  g.addEventListener = () => {}
  g.requestAnimationFrame = () => 0
  g.document = { addEventListener() {}, activeElement: null }
  g.dispatchEvent = () => true
  g.HashChangeEvent = class { type: string; constructor(type: string) { this.type = type } }
  const ws: Any = await web("core/workspace.ts")
  const sp: Any = await web("core/splits.ts")
  const lay: Any = await web("core/layout.ts")
  const tid = await import("../core/terminalids.ts")
  check("terminal ids: an agent, its account, a resumed session and a machine read back; a shell is none",
    JSON.stringify(tid.parseTerminal("claude_personal-k3j2h1g0@studio")) === JSON.stringify({ agent: "claude", profile: "personal", resume: null, machine: "studio" })
    && tid.parseTerminal(tid.resumeTerminalId("codex", "0199-abc"))?.resume === "0199-abc" && tid.parseTerminal("k3j2h1g0") === null
    && /^claude_work-[a-z0-9]{8}$/.test(tid.newTerminalId(tid.agentIn("claude", "work"))) && tid.agentIn("claude", "No way") === "claude")
  check("tabs: a target's file, and only a vault one's vault path", lay.tabPath("file:a.md") === "a.md" && lay.tabPath("file:/x/b.pdf") === "/x/b.pdf"
    && lay.tabPath("view:terminal/1") === null && lay.vaultPath("file:a.md") === "a.md" && lay.vaultPath("file:/x/b.pdf") === null && lay.vaultPath("new") === null)
  type T = { id: string; to: string }
  const one = (tabs: T[], active: string) => ws.replaceWorkspace({ root: { id: "g0", tabs, active }, focus: "g0" })
  const two = (left: T[], right: T[], focus: "gL" | "gR") => ws.replaceWorkspace({ root: { id: "s0", dir: "row", sizes: [0.5, 0.5],
    kids: [{ id: "gL", tabs: left, active: left.at(-1)!.id }, { id: "gR", tabs: right, active: right.at(-1)!.id }] }, focus })
  const tabs = () => ws.groups().map((x: Any) => x.tabs.map((t: T) => t.to).join(",") + (x.id === ws.getWorkspace().focus ? " *" : "")).join(" | ")
  const A = { id: "a", to: "file:a.md" }, B = { id: "b", to: "file:b.md" }, N = { id: "n", to: "new" }

  one([A, N], "n"); ws.go("file:a.md")
  check("tabs: opening what another tab has from a blank tab closes the blank one", tabs() === "file:a.md *", tabs())
  one([A, N], "n"); ws.go("view:terminals", true)
  check("tabs: asked for a new tab from a blank tab, it opens in the blank one", tabs() === "file:a.md,view:terminals *", tabs())
  one([A, N], "n"); ws.go("file:a.md", true)
  check("tabs: asked for a new tab of what another tab has, from a blank tab: that tab, no copy", tabs() === "file:a.md *", tabs())
  one([A, B], "b"); ws.go("file:a.md", true)
  check("tabs: asked for a new tab from a tab with something, it still gets one", tabs() === "file:a.md,file:b.md,file:a.md *", tabs())
  one([A, N], "n"); g.location.hash = "#file/a.md"; ws.followHash("file/a.md")
  check("tabs: a link from a blank tab to what another tab has closes the blank one", tabs() === "file:a.md *", tabs())
  one([A, N], "n"); ws.selectTab("a")
  check("tabs: switching away from a blank tab by hand keeps it", tabs() === "file:a.md,new *", tabs())
  one([A], "a"); ws.newTab(); ws.selectTab("a"); ws.newTab(); ws.newTab()
  check("tabs: New tab never makes a second blank tab in a pane", tabs() === "file:a.md,new *" && ws.activeTab().to === "new", tabs())
  two([A], [N], "gR"); ws.go("file:a.md")
  check("tabs: on a computer, a pane's only blank tab stays (the split is the user's)", tabs() === "file:a.md * | new", tabs())
  desktop = false
  two([A], [N], "gR"); ws.go("file:a.md")
  check("tabs: on a phone, a blank tab in another pane closes too", tabs() === "file:a.md *", tabs())
  desktop = true
  one([A, N], "n"); sp.openAt("file:b.md", "g0", 0)
  check("tabs: a file dropped into a bar whose blank tab shows takes its place", tabs() === "file:b.md,file:a.md *", tabs())
  two([A, B], [N], "gL"); sp.moveTabTo("b", "gR", "center")
  check("tabs: a tab moved into a pane whose blank tab shows takes its place", tabs() === "file:a.md | file:b.md *", tabs())
  two([A], [B, N], "gL"); sp.moveGroupTo("gL", "gR", "center")
  check("tabs: a pane moved into one whose blank tab shows takes its place", tabs() === "file:b.md,file:a.md *", tabs())

  const F = { id: "f", to: "file:Inbox/x.md" }
  one([A, F, B], "f"); ws.closeFileTabs("Inbox/x.md")
  check("tabs: a file trashed closes its tabs", tabs() === "file:a.md,file:b.md *" && ws.canReopenTab(), tabs())
  one([A, F, B], "f"); ws.retarget("Inbox/x.md", "Inbox/.archive/x.md")
  check("tabs: a file archived or moved stays open where it went", tabs() === "file:a.md,file:Inbox/.archive/x.md,file:b.md *" && ws.activeTab().to === "file:Inbox/.archive/x.md", tabs())
  one([A, F], "f"); ws.closeFileTabs("Inbox")
  check("tabs: a folder's going closes its files' tabs", tabs() === "file:a.md *", tabs())

  // A phone's tab groups (splits.ts): panes, the tab on screen kept.
  const C = { id: "c", to: "file:c.md" }, D = { id: "d", to: "file:d.md" }
  one([A, B, C], "c"); sp.groupTabs("a", "b")
  check("groups: a tab dropped on another among others: the two make a pane, the tab on screen stays", tabs() === "file:c.md * | file:b.md,file:a.md" && ws.activeTab().id === "c", tabs())
  one([A, B], "b"); sp.groupTabs("a", "b")
  check("groups: two tabs alone in a pane are a group already", tabs() === "file:a.md,file:b.md *", tabs())
  two([A, B], [C], "gR"); sp.groupTabs("c", "a")
  check("groups: the tab on screen moved: its new pane is focused and shows it", tabs() === "file:b.md | file:a.md,file:c.md *" && ws.activeTab().id === "c", tabs())
  two([A, B], [C], "gR"); sp.joinGroup("c", "gL")
  check("groups: a lone tab joins a group, its pane goes", tabs() === "file:a.md,file:b.md,file:c.md *" && ws.activeTab().id === "c", tabs())
  two([A, B, D], [C], "gR"); sp.leaveGroup("b")
  check("groups: a tab leaves its group for a pane of its own", tabs() === "file:a.md,file:d.md | file:b.md | file:c.md *", tabs())
  two([A, B], [C, D], "gL"); sp.ungroup("gR")
  check("groups: ungrouping a pane puts its tabs in the one before it", tabs() === "file:a.md,file:b.md,file:c.md,file:d.md *" && ws.activeTab().id === "b", tabs())
  one([A, B, C], "c"); sp.placeTab("c", "a")
  check("groups: a tab placed before another, the tab on screen kept", tabs() === "file:c.md,file:a.md,file:b.md *" && ws.activeTab().id === "c", tabs())
}

// ---------- Slides: a note split at --- lines (plugins/core/slides/slides.ts) ----------
{
  const { splitSlides, isTitleSlide } = await import("../plugins/core/slides/slides.ts")
  const deck = "# Launch\n\n---\n\n## Why\n- one\n\n----\n```md\n---\nnot a split\n```\n---\n\n---\n![[chart.png]]\n"
  const got = splitSlides(deck)
  check("slides: split at --- lines, never inside code, empty ones dropped", got.length === 4 && got[0] === "# Launch" && got[2].includes("not a split") && got[3] === "![[chart.png]]", got)
  check("slides: a note without --- is one slide", splitSlides("Just text\n").length === 1)
  check("slides: headings only (and a short line) is a title slide", isTitleSlide("# Launch\nQ3 plan") && !isTitleSlide("# Plan\n- one\n- two") && !isTitleSlide("Text only"))
}

// ---------- Web viewer: what's typed in the address bar (plugins/core/web-viewer/address.ts) ----------
{
  const { addressOf, hostOf } = await import("../plugins/core/web-viewer/address.ts")
  check("web viewer: an address with its scheme as it is", addressOf(" https://example.com/a?b=1#c ") === "https://example.com/a?b=1#c")
  check("web viewer: a host gets https", addressOf("example.com/posts") === "https://example.com/posts" && addressOf("sub.example.co.uk") === "https://sub.example.co.uk/")
  check("web viewer: this machine and IP addresses get http", addressOf("localhost:3000/x") === "http://localhost:3000/x" && addressOf("127.0.0.1:8080") === "http://127.0.0.1:8080/")
  check("web viewer: words are a search", addressOf("open source notes") === "https://duckduckgo.com/?q=open%20source%20notes"
    && addressOf("notes", "https://search.example/?s=%s") === "https://search.example/?s=notes")
  check("web viewer: other schemes and nothing are refused", addressOf("file:///etc/hosts") === null && addressOf("javascript:alert(1)") === null && addressOf("  ") === null)
  check("web viewer: a tab's name before the page's title is its site", hostOf("https://www.example.com/a") === "example.com" && hostOf("nonsense") === "nonsense")
}

// ---------- Audio recorder: the transcript under the recording (plugins/core/audio-recorder/transcript.ts) ----------
{
  const t = await import("../plugins/core/audio-recorder/transcript.ts")
  const paras = t.paragraphs([{ start: 0, end: 2, text: " Hello there." }, { start: 2.2, end: 4, text: " Second part." }, { start: 7, end: 9, text: " After a pause." }])
  check("transcript: whisper's segments as paragraphs, split at pauses", paras.length === 2 && paras[0] === "Hello there. Second part." && paras[1] === "After a pause.", paras)
  const note = "Intro\n![[Recording 2026-10-01 14.03.12.webm]]\nAfter it\n"
  const once = t.withTranscript(note, "Attachments/Recording 2026-10-01 14.03.12.webm", paras)
  check("transcript: a folded callout right under the embed, a blank line before the text after it",
    once === "Intro\n![[Recording 2026-10-01 14.03.12.webm]]\n> [!quote]- Transcript\n> Hello there. Second part.\n>\n> After a pause.\n\nAfter it\n", once)
  const twice = t.withTranscript(once, "Attachments/Recording 2026-10-01 14.03.12.webm", ["Again."])
  check("transcript: transcribing again replaces it", twice === "Intro\n![[Recording 2026-10-01 14.03.12.webm]]\n> [!quote]- Transcript\n> Again.\n\nAfter it\n", twice)
  const md = t.withTranscript("![](Attachments/memo%201.m4a)\r\n", "Attachments/memo 1.m4a", ["Hi."])
  check("transcript: a Markdown-link embed too, line endings kept", md === "![](Attachments/memo%201.m4a)\r\n> [!quote]- Transcript\r\n> Hi.\r\n", md)
  const none = t.withTranscript("Text\n", "a/memo.m4a", [])
  check("transcript: a note without the embed gets it at the end, and silence says so", none === "Text\n\n![[memo.m4a]]\n> [!quote]- Transcript\n> (Nothing was heard.)\n", none)
  check("transcript: plain output as paragraphs", JSON.stringify(t.textParagraphs("one\ntwo\n\nthree\n")) === '["one two","three"]')
}

// ---------- Obsidian Bases: the expression language, a .base's views, edits that keep the file ----------
{
  const ex = await import(pathToFileURL(path.join(ROOT, "plugins", "core", "query", "expr.ts")).href)
  const bases = await import(pathToFileURL(path.join(ROOT, "plugins", "core", "query", "bases.ts")).href)
  const edit = await import(pathToFileURL(path.join(ROOT, "plugins", "core", "query", "baseedit.ts")).href)
  const { run } = await import(pathToFileURL(path.join(ROOT, "plugins", "core", "query", "query.ts")).href)
  const now = new Date(2026, 8, 30, 12, 0).getTime()
  const book = { path: "Books/Dune.md", fm: { status: "done", price: 12.5, quantity: 2, author: "[[Frank Herbert]]", finished: "2026-09-10", "due-date": "2026-10-01" },
    mtime: now - 3 * 864e5, tags: ["book", "scifi/classic"], links: () => ["Frank Herbert", "Emma"] }
  const author = { path: "People/Frank Herbert.md", fm: { born: 1920 }, mtime: 1 }
  const env = { resolve: (t: string) => (t.toLowerCase().startsWith("frank") ? author : null), self: author, formula: () => null, backlinks: () => [], now }
  const ev = (src: string, rec: Any = book) => ex.plainOf(ex.evaluate(ex.parse(src), rec, env))
  const cases: [string, unknown][] = [
    ["price * quantity", 25], ['if(price, "$" + price.toFixed(2), "")', "$12.50"], ["note.price + note[\"quantity\"]", 14.5],
    ['file.hasTag("scifi")', true], ['file.hasTag("classic", "book")', true], ['file.inFolder("Books")', true], ['file.inFolder("Boo")', false],
    ["file.name", "Dune.md"], ["file.basename", "Dune"], ["file.ext", "md"], ['file.hasLink("Emma")', true], ["file.hasLink(this)", true],
    ["author == this", true], ['author == link("Frank Herbert")', true], ["author.asFile().properties.born", 1920], ["author.born", 1920],
    ['status != "done" || price > 10', true], ["!(price > 10) && true", false], ["file.mtime > now() - \"1 week\"", true],
    ['finished.format("D MMM YYYY")', "10 Sep 2026"], ['date("2024-12-01") + "1M" + "4h" + "3m"', "2025-01-01 04:03"],
    ["(date(\"2026-09-03\") - date(\"2026-09-01\")) / 86400000", 2], ['finished < "2026-09-11"', true], ["finished.year", 2026],
    ["due-date", "2026-10-01"], ["due - date", null], ['"a:b:c".replace(/:/g, "-")', "a-b-c"], ['"a:b:c".replace(":", "-")', "a-b-c"],
    ['"hello world".title()', "Hello World"], ['"abc".slice(1)', "bc"], ['"a,b,c".split(",", 2)', ["a", "b"]], ["(2.3333).round(2)", 2.33],
    ["[1, 2, 3, 4].filter(value > 2).map(value * 10)", [30, 40]], ["[1, 2, 3].reduce(acc + value, 0)", 6], ['[1, [2, 3]].flat().join("-")', "1-2-3"],
    ["[3, 1, 2].sort().reverse()", [3, 2, 1]], ["[1, 2, 2].unique().length", 2], ['list("x")', ["x"]], ["list(missing)", []], ["max(1, 5, 3)", 5],
    ['number("3.4") * 2', 6.8], ['{"a": 1}.keys()', ["a"]], ['/ab+c/i.matches("xABBCx")', true], ['"x".isType("string")', true],
    ["missing.isEmpty()", true], ["missing.lower()", null], ['"2026-01-05".format("dddd")', "Monday"], ["file.tags.contains(\"#book\")", true],
  ]
  const bad = cases.filter(([src, want]) => { try { return JSON.stringify(ev(src)) !== JSON.stringify(want) } catch { return true } })
  check("bases: expressions as Obsidian evaluates them", !bad.length, bad.map(([src, want]) => { let got; try { got = ev(src) } catch (e) { got = String(e) } return [src, want, got] }))
  let errors = 0
  for (const src of ["foo(1)", "a +", "(a", "'open", "a ? b", "[1, 2", "{a 1}", "1 2"]) { try { ex.parse(src) } catch (e) { if (e instanceof ex.ExprError) errors++ } }
  check("bases: what doesn't parse (or names no function) is an ExprError", errors === 8, errors)
  let runtime = ""
  try { ev("price.nope()") } catch (e) { runtime = (e as Error).message }
  check("bases: a function a value doesn't have says so", runtime === "there's no function nope() on a number", runtime)
  const nums = [3, 1, null, 2, 2], mixed = [true, false, true, "2026-09-01", "2026-09-03", null]
  const sums = ["Sum", "average", "Median", "Min", "Max", "Range", "Empty", "Filled", "Unique", "Count"].map((n) => ex.plainOf(ex.summary(n, nums)))
    .concat(["Checked", "Unchecked", "Earliest", "Latest", "Range"].map((n) => ex.plainOf(ex.summary(n, mixed))))
  check("bases: summaries", JSON.stringify(sums) === '[8,2,2,1,3,2,1,4,3,5,2,1,"2026-09-01","2026-09-03","2 days"]' && ex.summary("nope", nums) === undefined, sums)

  const cfg = {
    filters: { and: ['file.inFolder("Books")', { not: ['status == "dropped"'] }] },
    formulas: { total: "price * quantity", broken: "foo(" },
    properties: { "formula.total": { displayName: "Total" } },
    summaries: { twice: "values.sum() * 2" },
    views: [
      { type: "table", name: "All", order: ["file.name", "formula.total", "note.status"], sort: [{ property: "formula.total", direction: "DESC" }], summaries: { "formula.total": "twice", price: "Average" } },
      { type: "kanban", name: "Board", groupBy: { property: "note.status", direction: "DESC" } },
      { type: "gallery", name: "Gallery", filters: "formula.broken" },
      { type: "kanban" },
    ],
  }
  const recs = [book, { ...book, path: "Books/Emma.md", fm: { status: "reading", price: 8, quantity: 1 } }, { ...book, path: "Books/Old.md", fm: { status: "dropped", price: 1, quantity: 1 } }, author]
  const view = (name?: string) => { const b = bases.baseOptions(cfg, name); const r = run(b.opts, recs, new Date(now)); return { ...r, notes: [...b.notes, ...(r.notes ?? [])] } }
  const all = view()
  check("bases: a view's filters, order (labels), sort by a formula, summaries (a base's own formula)",
    JSON.stringify(all.groups[0].rows.map((r: Any) => [r.title, r.values["formula.total"]])) === '[["Dune",25],["Emma",8]]'
    && JSON.stringify(all.columns.map((c: Any) => c.label)) === '["Name","Total","Status"]'
    && JSON.stringify(all.summaries) === '[{"key":"formula.total","name":"twice","value":66},{"key":"price","name":"Average","value":10.25}]' && !all.notes.length, all)
  const board = view("board")
  check("bases: kanban is a board grouped by its groupBy (direction DESC)", board.view === "board" && JSON.stringify(board.groups.map((g: Any) => g.name)) === '["reading","done",null]', board.groups)
  const gal = view("Gallery")
  check("bases: an unknown layout is a table, a filter on a broken formula matches nothing, each said once", gal.view === "table" && gal.total === 0
    && JSON.stringify(gal.notes) === '["This app draws gallery views as a table","Formula broken isn\'t worked out: there\'s no function foo()"]', gal.notes)
  check("bases: a kanban without groupBy is a table; nameless views get their type's name, numbered",
    view("Board 2").view === "table" && JSON.stringify(bases.viewNames({ views: [{ type: "table" }, { type: "table" }] }).map((v: Any) => v.name)) === '["Table","Table 2"]',
    bases.viewNames(cfg))
  check("bases: a view that isn't there shows the first, with a note", view("Nope").title === "All" && view("Nope").notes[0] === "There's no view named Nope: showing All")

  const text = "# my books\nfilters: file.inFolder(\"Books\")\nviews:\n  - type: table\n    name: All # main\n    order: [file.name, price]\n    rowHeight: tall\n  - type: cards\n    name: Shelf\nextra: {keep: me}\n"
  check("bases: a layout changed is one line", edit.setViewType(text, 1, "kanban") === text.replace("type: cards", "type: kanban"), edit.setViewType(text, 1, "kanban"))
  const added = edit.addView(text, "table", edit.freeViewName(["All", "Shelf"], "All"), 0)
  check("bases: a view added at the end (the columns copied), the rest as it was", added === text.replace("extra:", "  - type: table\n    name: All 2\n    order:\n      - file.name\n      - price\nextra:"), added)
  check("bases: a view removed, or put first", edit.removeView(text, 0) === "# my books\nfilters: file.inFolder(\"Books\")\nviews:\n  - type: cards\n    name: Shelf\nextra: {keep: me}\n"
    && edit.firstView(text, 1).indexOf("name: Shelf") < edit.firstView(text, 1).indexOf("name: All") && edit.removeView("views:\n  - type: table\n", 0) === "views:\n  - type: table\n", edit.removeView(text, 0))
  const fmts = await web("core/formats.ts")
  fmts.setFormatLookup((p: string) => (p.endsWith(".base") ? { ext: "base", page: false } : null))
  fmts.setFenceLookup((lang: string) => lang === "base")
  check("embeds: a base and one of its views; a core file has no #part", JSON.stringify([fmts.embedOf("![[Books.base#Reading|300]]"), fmts.embedOf("![[Books.base]]"), fmts.embedOf("![[x.csv#y]]")])
    === '[{"target":"Books.base#Reading","height":300},{"target":"Books.base"},null]' && JSON.stringify(fmts.embedParts("Books.base#Reading")) === '{"name":"Books.base","sub":"Reading"}',
    [fmts.embedOf("![[Books.base#Reading|300]]"), fmts.embedOf("![[x.csv#y]]")])
  check("fences: a plugin's language is drawn as the block ```lang; others are code", fmts.fenceBlock("base") === "```base" && fmts.fenceBlock("Base x") === "```base"
    && fmts.fenceBlock("js") === null && fmts.fenceBlock("block-query") === null)
  fmts.setFormatLookup(() => null); fmts.setFenceLookup(() => false)
}

// The block contract (core/blocks.ts, shared): options checked against a declaration, defaults filled in.
{
  const B = await import("../core/blocks.ts")
  const decl: import("../core/blocks.ts").BlockDecl = { description: "a made-up card", options: {
    limit: { type: "number", default: 5, min: 1, max: 50, description: "how many" },
    view: { type: "enum", values: ["table", "list"], description: "how it's drawn" },
    archived: { type: ["boolean", "enum"], values: ["only"], description: "archived ones too" },
    areas: { type: ["string", "list"], description: "which" },
    relations: { type: "list", values: ["friend", "family"], description: "who" },
    title: { type: "string", default: "Card", description: "its title" },
    area: { type: "string", required: true, description: "the area" },
    where: { type: "map", description: "a map" },
  } }
  const notes = (o: Record<string, unknown>) => B.optionNotes(decl, o)
  check("blocks: fine options have no notes", !notes({ area: "gym", limit: 3, view: "list", archived: "only", areas: "gym", relations: ["friend"], title: 2026, where: { a: 1 }, wide: true, file: "Logs/" }).length,
    notes({ area: "gym" }))
  check("blocks: an unknown option, and the closest name", notes({ area: "x", limt: 3 })[0] === "unknown option `limt` (did you mean `limit`?)", notes({ area: "x", limt: 3 }))
  check("blocks: an unknown option with nothing close", notes({ area: "x", colour: "red" })[0] === "unknown option `colour`", notes({ area: "x", colour: "red" }))
  check("blocks: a wrong type", notes({ area: "x", limit: "ten" })[0] === "`limit` should be a number, not \"ten\"", notes({ area: "x", limit: "ten" }))
  check("blocks: out of range", notes({ area: "x", limit: 99 })[0] === "`limit` should be at most 50" && notes({ area: "x", limit: 0 })[0] === "`limit` should be at least 1")
  check("blocks: an enum's values", notes({ area: "x", view: "grid" })[0] === "`view` should be one of table, list, not \"grid\"", notes({ area: "x", view: "grid" }))
  check("blocks: true, false or a value", !notes({ area: "x", archived: true }).length && notes({ area: "x", archived: "all" })[0] === "`archived` should be true, false or only, not \"all\"",
    notes({ area: "x", archived: "all" }))
  check("blocks: a list's items", notes({ area: "x", relations: ["friend", "boss"] })[0] === "`relations` takes only friend, family", notes({ area: "x", relations: ["boss"] }))
  check("blocks: a list where a text is wanted", notes({ area: ["x"] })[0] === "`area` should be a text, not [\"x\"]", notes({ area: ["x"] }))
  check("blocks: required", notes({})[0] === "`area` is required" && notes({ area: null }).includes("`area` is required"), notes({}))
  check("blocks: empty values are unset", !B.optionNotes(decl, { area: "x", limit: null }).length)
  check("blocks: no declaration, nothing to check", !B.optionNotes(null, { anything: 1 }).length)
  check("blocks: options that aren't YAML or a map", B.parseOptions("a: [").error?.startsWith("its options aren't YAML") && B.parseOptions("- a").error === "its options should be `key: value` lines"
    && !B.parseOptions("").error && B.parseOptions("a: 1").options.a === 1)
  const r = B.resolveOptions(decl, { title: 2026, limit: null })
  check("blocks: defaults filled in, a number made text where a text is declared", r.limit === 5 && r.title === "2026" && !("view" in r), r)
  check("blocks: the closest name", B.closest("isues", ["issues", "stats"]) === "issues" && B.closest("x", ["issues"]) === null)
  check("blocks: a sound declaration has no problems", !B.declProblems({ card: decl }, "m").length, B.declProblems({ card: decl }, "m"))
  const bad = B.declProblems({ "bad name": { description: "x" }, card: { description: "", options: { wide: { type: "boolean", description: "x" },
    n: { type: "integer", description: "" }, v: { type: "enum", description: "x" }, d: { type: "number", default: "five", description: "x" } } } }, "m")
  check("blocks: a declaration's own problems", ["a block's name is letters", "card' needs a description", "option 'wide': every block takes it",
    "option 'n': type must be one of", "option 'n' needs a description", "option 'v': an enum needs its values", "option 'd': its default should be a number"]
    .every((w) => bad.some((b) => b.includes(w))), bad)
  check("blocks: where its data comes from, declared", !B.declProblems({ card: { ...decl, live: "GitHub's API", reads: ["Finance/Transactions.csv"] } }, "m").length &&
    B.declProblems({ card: { ...decl, live: "two\nlines", reads: "Finance.csv" } }, "m").length === 2)
  check("blocks: the doc for AIs, from the declarations", B.blocksDoc({ card: decl }).startsWith("Block:\n- `card`: a made-up card\n  - `limit` (a number, default 5, 1 to 50): how many"),
    B.blocksDoc({ card: decl }))
  check("blocks: a missing text side reads as the description", B.fallbackText("Fake", decl) === "_(Fake: a made-up card; drawn in the app only)_")

  // A plugin's settings, declared like block options plus a label (core/blocks.ts SettingDecl).
  const setting = { trigger: { type: "enum", values: ["auto", "hover"], default: "auto", label: "Show a preview", labels: { auto: "Auto" }, description: "when it shows" },
    delay: { type: "number", default: 500, min: 0, label: "Delay", description: "how long first, in ms" }, file: { type: "string", label: "File", description: "a file" } }
  check("settings: a sound declaration has no problems (a key named like a common block option too)", !B.settingDeclProblems(setting, "m").length, B.settingDeclProblems(setting, "m"))
  const badSettings = B.settingDeclProblems({ a: { type: "boolean", description: "x" }, b: { type: "enum", values: ["x"], labels: { y: "Y" }, label: "B", description: "x" },
    c: { type: "number", default: "five", label: "C", description: "x" }, d: { type: "boolean", required: true, label: "D", description: "x" }, e: "nope" }, "m")
  check("settings: a declaration's own problems", ["setting 'a' needs a label", "setting 'b': labels names 'y'", "setting 'c': its default should be a number",
    "setting 'd': a setting is never required", "setting 'e' must be an object"].every((w) => badSettings.some((b) => b.includes(w))), badSettings)
  check("settings: not an object", B.settingDeclProblems([], "m")[0]?.includes("settings must be an object") && !B.settingDeclProblems(undefined, "m").length)
  check("settings: read from a manifest", Object.keys(B.settingsOf({ settings: setting })).join() === "trigger,delay,file" && !Object.keys(B.settingsOf({})).length)
  check("settings: the doc for AIs", B.settingsDoc("page-preview", setting as never).startsWith("Settings, `.vaultite/plugins/page-preview/data.json` (each optional; the plugin's settings in the app too):\n- `trigger` (one of auto, hover, default auto): when it shows")
    && B.settingsDoc("x", {}) === "", B.settingsDoc("page-preview", setting as never))

  // The editor's suggestions inside a block's fence (web/src/editor/blockOptions.ts).
  // (CodeMirror's CompletionContext needs a page; the source reads only its state, pos and explicit)
  const { EditorState } = await import("@codemirror/state")
  const { blockOptionSource } = await import("../web/src/editor/blockOptions.ts")
  const source = blockOptionSource((name) => (name === "card" ? decl : null))
  const at = (doc: string, explicit = false) => {
    const pos = doc.indexOf("|"), text = doc.replace("|", "")
    const ctx = { state: EditorState.create({ doc: text }), pos, explicit } as unknown as Parameters<typeof source>[0]
    return source(ctx) as { from: number; options: { label: string }[] } | null
  }
  const keys = at("```block-card\nlimit: 3\nli|\n```")
  check("editor: a block's options suggested at a line's start, not the ones it has", !!keys && keys.options.some((o) => o.label === "view")
    && keys.options.some((o) => o.label === "wide") && !keys.options.some((o) => o.label === "limit"), keys?.options.map((o) => o.label))
  const vals = at("```block-card\nview: |\n```")
  check("editor: an enum's values after its key", vals?.options.map((o) => o.label).join() === "table,list", vals?.options)
  check("editor: true and false with the enum's", at("```block-card\narchived: o|\n```")?.options.map((o) => o.label).join() === "only,true,false")
  check("editor: nothing outside a block, in another fence, or in an undeclared block", !at("text\nli|") && !at("```js\nli|\n```") && !at("```block-other\nli|\n```")
    && !at("```block-card\n```\nli|"))
  check("editor: an empty line only when asked", !at("```block-card\n|\n```") && !!at("```block-card\n|\n```", true))
}

// ---------- Token count's estimate (plugins/core/token-count/estimate.ts) ----------
{
  const { estimateTokens, tokenText } = await import("../plugins/core/token-count/estimate.ts")
  const prose = "The quick brown fox jumps over the lazy dog, then naps in the warm afternoon sun. ".repeat(40)
  const code = "const total = items.reduce((sum, x) => sum + x.price * x.qty, 0);\n  if (total > 100) { apply(discount); }\n".repeat(40)
  const pr = estimateTokens(prose), co = estimateTokens(code)
  check("tokens: prose near characters / 4", pr > prose.length / 5 && pr < prose.length / 3.3, [pr, prose.length])
  check("tokens: code costs more per character than prose", co / code.length > pr / prose.length && co < code.length / 2, [co, code.length])
  check("tokens: CJK about one a character, other scripts more than English", Math.abs(estimateTokens("東京の天気は晴れです") - 12) <= 2
    && estimateTokens("Привет, как дела у тебя сегодня") > estimateTokens("Hello, how are you doing today"), [estimateTokens("東京の天気は晴れです")])
  check("tokens: nothing is nothing", estimateTokens("") === 0 && estimateTokens("word") === 1)
  const big = (prose + code).repeat(200), exact = 200 * (estimateTokens(prose) + estimateTokens(code))
  check("tokens: a big text's, from samples, within 2%", big.length > 1 << 20 && Math.abs(estimateTokens(big) - exact) / exact < 0.02, [estimateTokens(big), exact])
  check("tokens: written short", [1, 840, 1000, 1240, 12_345, 999_499, 1_400_000].map(tokenText).join("|") === "~1 token|~840 tokens|~1k tokens|~1.2k tokens|~12k tokens|~999k tokens|~1.4M tokens",
    [1, 840, 1000, 1240, 12_345, 999_499, 1_400_000].map(tokenText))
}

// ---------- Token count's limits (plugins/core/token-count/limits.ts) ----------
{
  const { importsOf, levelOf, limitsOf, matches, ruleFor } = await import("../plugins/core/token-count/limits.ts")
  const l = limitsOf({ limits: { "Notes/**": 2000, "*.prompt.md": 500, "ME.md": 0 } }, { limit: 10000, limits: { "CLAUDE.md": 3000, ".vaultite/AGENTS.md": 1000, "AGENTS.md": 3000 } })
  check("limits: a name matches in any folder, case and all", matches("CLAUDE.md", "a/b/CLAUDE.md") && !matches("CLAUDE.md", "Dashboards/Claude.md") && matches("*.prompt.md", "x/y.prompt.md"))
  check("limits: a path matches from the vault's top, ** across folders", matches("Notes/**", "Notes/a/b.md") && !matches("Notes/**", "Old/Notes/b.md") && matches(".claude/skills/**/SKILL.md", ".claude/skills/x/SKILL.md"))
  check("limits: a path beats a name, max_tokens beats both, else the limit for any file", ruleFor(".vaultite/AGENTS.md", {}, l).limit === 1000 && ruleFor("AGENTS.md", {}, l).limit === 3000
    && ruleFor("Notes/x.md", { max_tokens: 40000 }, l).by === "max_tokens" && ruleFor("Other.md", null, l).limit === 10000 && ruleFor("ME.md", {}, l).limit === 0)
  check("limits: near at 80%, over past it, none with no limit", levelOf(799, 1000) === "ok" && levelOf(800, 1000) === "near" && levelOf(1001, 1000) === "over" && levelOf(1e9, 0) === "ok")
  check("limits: imports as Claude Code reads them (not in code, not an email, a trailing period off)",
    importsOf("@AGENTS.md\nSee @.vaultite/AGENTS.md.\nMail a@b.com, `@x.md`\n```\n@y.md\n```\n@~/z.md").join() === "AGENTS.md,.vaultite/AGENTS.md,~/z.md",
    importsOf("@AGENTS.md\nSee @.vaultite/AGENTS.md.\nMail a@b.com, `@x.md`\n```\n@y.md\n```\n@~/z.md"))
}

fs.rmSync(tmp, { recursive: true, force: true })
console.log(fails.length ? `\n${fails.length} failed` : "\nall passed")
process.exit(fails.length ? 1 : 0)
