// The web app's logic that needs no browser, on Node (`@/` resolves to web/src; server, page and desktop modules stubbed):
// the property editor writes frontmatter exactly like the server, and the editor's merge.   node tools/test_web.ts
import assert from "node:assert"
import fs from "node:fs"
import { registerHooks } from "node:module"
import os from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { check, summary } from "./test/lib.ts"
const t0 = Date.now()

const ROOT = path.dirname(import.meta.dirname)
const WEB = path.join(ROOT, "web", "src")
const STUBS: Record<string, string> = {
  "@/core/data": "export const put = async () => { throw new Error('no server in tools/test_web.ts') }",
  "@/core/http": "export const put = async () => { throw new Error('no server in tools/test_web.ts') }",
  "@/core/files": "export const readFile = async () => { throw new Error('no server in tools/test_web.ts') }; export const splitFm = () => ({ fm: '', body: '' })",
  "@/core/prefs": "export const getPrefs = () => ({ disabled: [] })",
  "@/core/appearance": "export const onLook = () => () => {}",
  "@/core/desktop": "export const webPages = null; export const keyboardTakes = () => 0; export const pageTakenSince = () => null",
  "@/core/live": "export const answerUi = () => {}",
}
// (plugins import the app as "@vaultite": here, only what their editing commands use)
const shim = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "vau-shim-")), "vaultite.ts")
fs.writeFileSync(shim, `export { blockPieces, paragraphAt } from ${JSON.stringify(pathToFileURL(path.join(WEB, "core", "highlights.ts")).href)}`)
registerHooks({
  resolve(spec, context, next) {
    if (spec === "@vaultite") return { url: pathToFileURL(shim).href, shortCircuit: true }
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

type Any = any
type Props = Record<string, unknown>
// The web modules are loaded through the hook above (tsconfig.app.json type-checks them), so they're typed here by hand.
const web = (rel: string) => import(pathToFileURL(path.join(WEB, rel)).href)
// By URL, untyped: plugin modules import "@vaultite", which only the hook above resolves (the backend's tsc can't)
const plugin = (rel: string) => import(pathToFileURL(path.join(ROOT, "plugins", "core", rel)).href)
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
  textChanges(a: string, b: string): { from: number; to: number; insert: string }[]
  mergeClashes(base: string, mine: string, theirs: string): { text: string; clashes: { at: number; mine: string[]; theirs: string[] }[] } } =
  await web("core/merge.ts")

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

// ---------- reading: the same values as the server ----------

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vaultite-web-"))
const VAULT = path.join(tmp, "vault")
fs.mkdirSync(VAULT)
process.env.VAULTITE_VAULT = VAULT
process.env.VAULTITE_LOCAL = path.join(tmp, "local")
const { loadFm } = await import("../core/frontmatter.ts")
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

// ---------- the editor's merge (the server's core/textedit.ts) ----------

const base = "a\nb\nc\nd\n"
check("merge: changes on both sides in different lines are both kept", merge.merge3(base, "A\nb\nc\nd\n", "a\nb\nc\nD\n") === "A\nb\nc\nD\n",
  merge.merge3(base, "A\nb\nc\nd\n", "a\nb\nc\nD\n"))
check("merge: the same line changed on both sides is a conflict", merge.merge3(base, "a\nX\nc\nd\n", "a\nY\nc\nd\n") === null)
check("merge: the same change on both sides is kept once", merge.merge3(base, "a\nX\nc\nd\n", "a\nX\nc\nd\n") === "a\nX\nc\nd\n")
check("merge: nothing changed on disk gives mine", merge.merge3(base, "a\nb\nnew\nc\nd\n", base) === "a\nb\nnew\nc\nd\n")
// Past a conflict: the rest merged, the clashing lines kept as mine and listed with theirs.
{
  const base6 = "one\ntwo\nthree\nfour\nfive\nsix with a long line"
  const r = merge.mergeClashes(base6, "ONE\ntwo\nthree\nfour\nfive\nsix with a long line I kept typing", "one\ntwo\nthree\nFOUR\nfive\nsix with a lo")
  check("merge: clashes keep mine and merge the rest", r.text === "ONE\ntwo\nthree\nFOUR\nfive\nsix with a long line I kept typing"
    && same(r.clashes, [{ at: 5, mine: ["six with a long line I kept typing"], theirs: ["six with a lo"] }]), r)
  const ins = merge.mergeClashes("a\nb", "a\nmine\nb", "a\ntheirs\nb")
  check("merge: two insertions at one place clash", same(ins.clashes, [{ at: 1, mine: ["mine"], theirs: ["theirs"] }]) && ins.text === "a\nmine\nb", ins)
  const del = merge.mergeClashes("a\nb\nc", "a\nc", "a\nB\nc")
  check("merge: a line deleted here and changed there clashes", same(del.clashes, [{ at: 1, mine: [], theirs: ["B"] }]) && del.text === "a\nc", del)
  check("merge: no clash where merge3 merges", same(merge.mergeClashes(base, "A\nb\nc\nd\n", "a\nb\nc\nD\n"), { text: "A\nb\nc\nD\n", clashes: [] }))
}
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
  const t0 = performance.now(), ops = diffLines(big, edited), took = performance.now() - t0
  // Loose on purpose: a quadratic diff takes minutes here, and a busy machine once took 3.8 s
  check("diff: 300k lines, two edits, quickly and exactly", rebuilds(big, edited) && ops.filter((o) => o[0] !== "equal").length === 2 && took < 10_000,
    [ops.length, took])
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
  check("archived: true or yes archive; a date, false, no or nothing don't", fp.isArchived({ archived: true }) && fp.isArchived({ archived: "yes" }) &&
    !fp.isArchived({ archived: "2026-09-01" }) && !fp.isArchived({ archived: false }) && !fp.isArchived({ archived: "no" }) && !fp.isArchived({}) && !fp.isArchived(undefined))
  // What a file's properties become after Archive and Unarchive (the app's setProperty is setProp on the file's header).
  const head = "---\ntype: note\ntags: [a]  # mine\n---\n"
  const on = fm.setProp(head, "archived", true)
  check("archived: Archive adds one line, Unarchive takes it away", on === "---\ntype: note\ntags: [a]  # mine\narchived: true\n---\n" && fm.setProp(on, "archived", undefined) === head, on)
}

// ---------- Excluded files and the attachment folder (core/fileprops.ts), written as Obsidian writes them ----------
{
  const fp: { excluder(f: unknown): (rel: string) => boolean; attachmentDir(spec: string, from: string): string } =
    await import(pathToFileURL(path.join(ROOT, "core", "fileprops.ts")).href)
  const ex = fp.excluder(["Archive/", "/^Daily\\/\\d{4}-01/", "/(/", 3, " "])
  check("excluded: a path they start with, or a /regex/; a broken one or not text is nothing", ex("Archive/Old.md") && ex("Daily/2026-01-02.md") &&
    !ex("Daily/2026-02-02.md") && !ex("Notes/Archive/Old.md") && !fp.excluder(undefined)("Archive/x.md"))
  check("attachments: / the top, ./ beside the note, ./sub beside it, else that folder", fp.attachmentDir("/", "A/B/N.md") === "" &&
    fp.attachmentDir("./", "A/B/N.md") === "A/B" && fp.attachmentDir("./assets/", "A/N.md") === "A/assets" && fp.attachmentDir("./assets", "N.md") === "assets" &&
    fp.attachmentDir("Files/Pasted/", "A/N.md") === "Files/Pasted")
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

const md: { renderMarkdown(text: string, opts?: { resolves?: (t: string) => { kind: string } | null; asset?: (name: string) => string | null }): string } = await web("core/markdown.ts")
const formats: { embedOf(line: string): { target: string; height?: number; note?: boolean } | null } = await web("core/formats.ts")
const sec = await import(pathToFileURL(path.join(ROOT, "core", "sections.ts")).href)
const html = md.renderMarkdown("A ==bright== idea #idea/new and `#code`, %%hidden%% text ^b1\n\n%%\nnot shown\n%%\n\n[[Note#Plans]] and [x](Some%20Note.md#Plans) and [[#Top]]\n\n^alone\n",
  { resolves: (t) => (t.startsWith("Some Note") || t.startsWith("Note") ? { kind: "file" } : null) })
check("markdown: ==highlight== is a mark", html.includes("<mark>bright</mark>"), html)
{
  // Obsidian's highlight colours (web/src/core/highlights.ts): an emoji first colours it and isn't shown.
  const colored = md.renderMarkdown("==🟢go== ==🟣️two words== ==🔴== ==plain== 🟢 alone")
  check("markdown: ==🟢text== is a green mark, the emoji (and a variation selector after it) not shown",
    colored.includes('<mark class="hl-green">go</mark>') && colored.includes('<mark class="hl-purple">two words</mark>') && colored.includes("<mark>plain</mark>")
    && !/🟢go|🟣/.test(colored) && colored.includes("🟢 alone"), colored)
  const hl: typeof import("../web/src/core/highlights.ts") = await web("core/highlights.ts")
  check("highlights: the colour a highlight starts with, and its emoji's length", hl.highlightColor("🔵sky")?.color === "blue" && hl.highlightColor("🔵sky")?.len === 2
    && hl.highlightColor("🟠\uFE0Fx")?.len === 3 && hl.highlightColor("sky") === null && hl.highlightColor("⚪x") === null)
  check("highlights: previews drop the emoji at a highlight's start only", hl.dropHighlightEmoji("A ==🟢green== and 🟢 ==x== a==🟢") === "A ==green== and 🟢 ==x== a==🟢",
    hl.dropHighlightEmoji("A ==🟢green== and 🟢 ==x== a==🟢"))
  check("highlights: a colour's class", hl.highlightClass("red") === "hl-red" && hl.highlightClass(null) === "" && hl.HIGHLIGHT_COLORS.map((c) => c.name).join() === "red,orange,yellow,green,blue,purple")
  const tt2: typeof import("../web/src/editor/tableText.ts") = await web("editor/tableText.ts")
  check("highlights: a table sorts a coloured highlight by its text", tt2.compareCells("==🔴b==", "a") > 0 && tt2.compareCells("==🟢a==", "b") < 0)
}
{
  // A highlight runs over a paragraph's soft line breaks (as ~~strike~~ does), never over blocks.
  const { EditorState, EditorSelection } = await import("@codemirror/state")
  const hl: typeof import("../web/src/core/highlights.ts") = await web("core/highlights.ts")
  const ed = await plugin("editing/edit.ts")
  const soft = md.renderMarkdown("A ==two\nlines== here\n\n- ==a\n- b==\n\n%%a\nb%% c\n\nz == y == x")
  check("markdown: a highlight runs over a soft line break, not over list items or a blank line",
    soft.includes("<mark>two<br>lines</mark>") && !soft.includes("<mark>a") && soft.includes("==a") && soft.includes("<p> c</p>") && soft.includes("z == y == x"), soft)
  const doc = (text: string) => EditorState.create({ doc: text }).doc
  const para = (text: string, at: number) => { const d = doc(text), p = hl.paragraphAt(d, at); return d.sliceString(p.from, p.to) }
  check("paragraphs: soft-wrapped lines are one, a blank line, list item, heading or table row ends it",
    para("a\nb\n\nc", 0) === "a\nb" && para("a\nb\n- c\n- d", 0) === "a\nb" && para("a\nb\n- c\n  e\n- d", 6) === "- c\n  e" &&
    para("# T\na\nb", 6) === "a\nb" && para("a\n| x | y |\n| 1 | 2 |", 0) === "a" && para("> a\n> b\nc", 0) === "> a\n> b\nc" && para("p\n> q", 0) === "p")
  const at = (text: string, from: number, to = from) => hl.highlightAt(EditorState.create({ doc: text }), from, to)
  check("highlights: one found over a soft break, from any line of it; none across blocks",
    at("==a\nb==", 5)?.to === 7 && at("x ==a\nb\nc== y", 6)?.from === 2 && at("==a\n\nb==", 1) === null && at("- ==a\n- b==", 3) === null)
  const run = (text: string, sel: [number, number], f: (v: any) => unknown) => {
    let state = EditorState.create({ doc: text, selection: EditorSelection.single(...sel), extensions: [EditorState.allowMultipleSelections.of(true)] })
    const v = { get state() { return state }, dispatch: (tr: any) => { state = state.update(tr).state } }
    f(v)
    return state.doc.toString()
  }
  const all = (t: string) => [0, t.length] as [number, number]
  const t1 = "one\ntwo\n\nthree\n- four\n- five"
  check("highlight toolbar: a selection over blocks is wrapped block by block", run(t1, all(t1), hl.colorHighlight(null)) === "==one\ntwo==\n\n==three==\n- ==four==\n- ==five==")
  check("highlight toolbar: inside a soft-wrapped paragraph one highlight spans its lines", run("one\ntwo", all("one\ntwo"), hl.colorHighlight(null)) === "==one\ntwo==")
  check("highlight toolbar: a colour changes a highlight over a soft break", run("==a\nb==", [1, 2], hl.colorHighlight("green")) === "==🟢a\nb==")
  check("mark toggle: a selection over blocks, bold and comment, block by block", run(t1, all(t1), ed.toggleMark("**")) === "**one\ntwo**\n\n**three**\n- **four**\n- **five**" &&
    run("a\n\nb", all("a\n\nb"), ed.toggleMark("%%")) === "%%a%%\n\n%%b%%")
  const marked = "==one\ntwo==\n\n==three==\n- ==four==\n- ==five=="
  check("mark toggle: off again over blocks; the selection stays on the text", run(marked, all(marked), ed.toggleMark("==")) === t1)
  check("mark toggle: only the unmarked blocks get marks when some are", run("==a==\n\nb", all("==a==\n\nb"), ed.toggleMark("==")) === "==a==\n\n==b==")
  check("mark toggle: a selection inside one paragraph is one mark", run("one\ntwo", all("one\ntwo"), ed.toggleMark("==")) === "==one\ntwo==")
  // ---- blocks that take no mark, selections that cover them ----
  const sel = (t: string) => run(t, all(t), ed.toggleMark("**")), col = (t: string) => run(t, all(t), hl.colorHighlight(null))
  const fence = "para\n\n```js\nlet a = 1\n```\n\n---\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n$$\nx = 1\n$$\n\n> [!note] Title\n> body\n\nlast"
  const wrapped = "**para**\n\n```js\nlet a = 1\n```\n\n---\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n$$\nx = 1\n$$\n\n> [!note] Title\n> **body**\n\n**last**"
  check("mark toggle: fences, code, rules, tables, math and callout heads are left out", sel(fence) === wrapped, sel(fence))
  check("highlight toolbar: the same blocks are left out", col(fence) === wrapped.replaceAll("**", "=="), col(fence))
  check("mark toggle: a triple-click over list items marks the text, not the bullets", sel("- a\n- b") === "- **a**\n- **b**" && sel("- [-] a\n- [x] b") === "- [-] **a**\n- [x] **b**" && sel("> q\n> r") === "> **q\n> r**")
  check("mark toggle: one item selected whole is marked on its text", sel("- a") === "- **a**" && sel("## Title") === "## **Title**")
  check("mark toggle: only code selected changes nothing", sel("```\ncode\n```") === "```\ncode\n```" && sel("a\n\n---") === "**a**\n\n---")
  {
    // the selection stays on the text after colouring several blocks
    let state = EditorState.create({ doc: "one\n\ntwo", selection: EditorSelection.single(0, 8) })
    hl.colorHighlight(null)({ get state() { return state }, dispatch: (tr: any) => { state = state.update(tr).state } } as any)
    const m = state.selection.main
    check("highlight toolbar: after colouring blocks the selection is on the text, inside the marks", state.doc.toString() === "==one==\n\n==two==" && m.from === 2 && m.to === 14, [state.doc.toString(), m.from, m.to])
  }
  check("clear formatting: marks across list items or headings aren't joined", run("**a\n- b**", all("**a\n- b**"), ed.clearFormatting) === "**a\n- b**" && run("- **a** and ==b==", all("- **a** and ==b=="), ed.clearFormatting) === "- a and b")
  const pa = (t: string, n = 0) => para(t, n)
  check("paragraphs: end at math, HTML, footnote definitions, a callout head, a quote's change, a table header, a setext underline",
    pa("a\n$$\nx\n$$") === "a" && pa("a\n<div>\nb") === "a" && pa("a\n[^1]: note") === "a" && pa("a\n> [!note] T\n> b") === "a" && pa("> a\n>> b") === "> a" &&
    pa("p\nh1 | h2\n--|--\nx | y") === "p" && pa("p\nh1 | h2\n--|--\nx | y", 3) === "h1 | h2" && pa("Title\n=====") === "Title" && pa("> a\nb") === "> a\nb")
  check("highlights: the colour list is offered for an opening == and not for a closing one", hl.closesHighlight("==a\nb") && !hl.closesHighlight("a == b ") && !hl.closesHighlight("a") && hl.closesHighlight("x ==y z") && !hl.closesHighlight("==a== b "))
  check("highlights: unclosed openers are one linear pass", (() => { const t0 = Date.now(); const r = hl.highlightSpans("==x\n".repeat(20000)); return r.length === 0 && Date.now() - t0 < 100 })())
  check("highlights: spans and comments over a paragraph's text", JSON.stringify(hl.highlightSpans("a ==b\nc== d ==e==")) === '[{"index":2,"length":7,"inner":"b\\nc"},{"index":12,"length":5,"inner":"e"}]'
    && JSON.stringify(hl.commentSpans("x %%a\nb%% y %%")) === "[[2,9]]")
  check("clear formatting: strips a mark over a soft break, not across a blank line",
    run("==a\nb==", all("==a\nb=="), ed.clearFormatting) === "a\nb")
}
check("markdown: #tags are clickable, not in code", html.includes('<a class="tag" data-tag="idea/new">#idea/new</a>') && html.includes("<code>#code</code>"), html)
check("markdown: comments and block ids are hidden", !html.includes("hidden") && !html.includes("not shown") && !html.includes("^b1") && !html.includes("alone"), html)
check("markdown: a heading link names the heading; same-file and Markdown links to notes are links",
  html.includes('data-wiki="Note#Plans">Note › Plans</a>') && html.includes('data-wiki="Some Note#Plans">x</a>') && html.includes('data-wiki="#Top">Top</a>'), html)
// As in Obsidian: every Markdown link is a link, vault images show anywhere, `![[Note]]` mid-line embeds, raw HTML is drawn sanitized.
const vopts = { resolves: (t: string) => (/^(Note|files\/a\.pdf|photo\.png|Idea)/.test(t) ? { kind: "file" } : null), asset: (n: string) => (/photo\.png$/.test(n) ? "/api/raw?path=Img/photo.png" : null) }
const links = md.renderMarkdown("[a](Note) [b](files/a.pdf) [c](obsidian://open?vault=x) [d](zotero://select/items/1) [e](tel:+15551234) [f](file:///Users/x/a.pdf) [g](javascript:alert(1)) [h](https://example.com)", vopts)
check("markdown: a link with no extension, a relative file and any app's scheme are links; javascript: isn't",
  links.includes('data-wiki="Note">a</a>') && links.includes('data-wiki="files/a.pdf">b</a>') && links.includes('data-url="obsidian://open?vault=x">c</a>') &&
  links.includes('data-url="zotero://select/items/1">d</a>') && links.includes('data-url="tel:+15551234">e</a>') && links.includes('data-url="file:///Users/x/a.pdf">f</a>') &&
  !links.includes("javascript") && links.includes('href="https://example.com" target="_blank"'), links)
const broken = md.renderMarkdown("Vaultite\nLighthouse\n\nNext")
check("markdown: a line break is a break, as the editor shows it", broken.includes("Vaultite<br>Lighthouse") && broken.includes("<p>Next</p>"), broken)

// Tables edited cell by cell (editor/tables.ts) rewrite only what changed, in the table's own style.
const tt: typeof import("../web/src/editor/tableText.ts") = await web("editor/tableText.ts")
{
  const src = "|a|b|\n|---|:-:|\n| 1 | x \\| y |\n|2|"
  const t = tt.parseTable(src)!
  check("tables: cells split at unescaped pipes, short rows filled", t.rows[1].cells.join(",") === "1,x \\| y" && t.rows[2].cells.join(",") === "2," && t.align.join() === ",center")
  check("tables: unchanged, written as it was", tt.writeTable(t) === src, tt.writeTable(t))
  t.rows[2].cells[1] = tt.escape("a|b")
  const out = tt.writeTable(t).split("\n")
  check("tables: only the changed row is rewritten, its pipe escaped", out[0] === "|a|b|" && out[2] === "| 1 | x \\| y |" && out[3] === "| 2 | a\\|b |", out.join("\n"))
  t.align.push(""); t.rows.forEach((r) => r.cells.push(""))
  check("tables: a new column gets its own separator", tt.writeTable(t).split("\n")[1] === "|---|:-:|---|", tt.writeTable(t))
  const ragged = tt.parseTable("|a|\n|-|\n|1|2|")!
  ragged.rows[1].cells[0] = "3"
  check("tables: a row wider than its header keeps its extra cells as cells change", tt.writeTable(ragged) === "|a|\n|-|\n| 3 | 2 |", tt.writeTable(ragged))
  tt.widen(ragged); tt.insertRow(ragged, 2)
  check("tables: a change to its shape makes them columns, the header's empty", tt.writeTable(ragged) === "| a |  |\n|---|---|\n| 3 | 2 |\n|  |  |", tt.writeTable(ragged))
  const padded = tt.parseTable("  | Name  | Qty |\n  | ----- | --- |\n  | Apple | 3   |")!
  padded.rows[1].cells[0] = "Pineapple"
  check("tables: a padded table stays lined up, indented as it was", tt.writeTable(padded) === "  | Name      | Qty |\n  | --------- | --- |\n  | Pineapple | 3   |", tt.writeTable(padded))
  check("tables: a line break in a cell is <br>", tt.escape("a\nb") === "a<br>b" && tt.unescape("x\\|y") === "x|y")
}
{
  const t = tt.parseTable("| Name | Qty | When |\n| --- | --: | --- |\n| pear | 10 | 2026-03-01 |\n| Apple | 9 | 2025-12-31 |\n|  | 1,200 |  |\n| banana | 2.5 | 2026-01-15 |")!
  const col = (c: number) => t.rows.slice(1).map((r) => r.cells[c]).join(",")
  tt.sortRows(t, 1)
  check("tables: sorting by a column orders numbers as numbers, the header first", t.rows[0].cells[0] === "Name" && col(1) === "2.5,9,10,1,200", col(1))
  tt.sortRows(t, 0)
  check("tables: text sorts ignoring case, empty cells last", col(0) === "Apple,banana,pear,", col(0))
  tt.sortRows(t, 2, true)
  check("tables: dates sort as dates, descending too, empty still last", col(2) === "2026-03-01,2026-01-15,2025-12-31,", col(2))
  const out = tt.writeTable(t).split("\n")
  check("tables: a sort moves rows as they were written, alignment kept", out[1] === "| --- | --: | --- |" && out[2] === "| pear | 10 | 2026-03-01 |" && out[5] === "|  | 1,200 |  |", out.join("\n"))
  check("tables: numbers before words in the same column compare as text", tt.compareCells("10", "9") > 0 && tt.compareCells("**b**", "a") > 0 && tt.compareCells("[[Zed]]", "Abe") > 0)
  tt.moveRow(t, 1, 3); tt.moveRow(t, 2, 0)
  check("tables: a row moves among the body rows, never above the header", col(0) === "banana,Apple,pear," && t.rows[0].cells[0] === "Name", col(0))
  tt.moveColumn(t, 1, 0)
  check("tables: a column moves with its alignment", t.rows[0].cells.join() === "Qty,Name,When" && tt.writeTable(t).split("\n")[1] === "|--:|---|---|", tt.writeTable(t))
  tt.fillCells(t, { r: 4, c: 1 }, [["x|y", "a\nb", "new"], ["z"]])
  check("tables: cells pasted past its edges add rows and columns, pipes and line breaks escaped",
    t.align.length === 4 && t.rows.length === 6 && t.rows[4].cells.join() === "1,200,x\\|y,a<br>b,new" && t.rows[5].cells.join() === ",z,,", tt.writeTable(t))
  tt.clearCells(t, { r: 5, c: 1 }, { r: 4, c: 2 })
  check("tables: clearing empties a range of cells", t.rows[4].cells.join() === "1,200,,,new" && t.rows[5].cells.join() === ",,,", t.rows[4].cells.join())
  const wide = tt.parseTable("| 名前 | 数  |\n| ---- | --- |\n| 東京 | 1   |")!
  check("tables: a padded table lines up by display width (CJK is two)", wide.padded && tt.width("東京") === 4 && tt.width("ab") === 2)
  tt.insertRow(wide, 1)
  check("tables: padded, a new row is padded too", tt.writeTable(wide) === "| 名前 | 数  |\n| ---- | --- |\n|      |     |\n| 東京 | 1   |", tt.writeTable(wide))
  check("tables: the cell a column of a line is in", tt.cellAt("| a | b \\| c | d |", 2) === 0 && tt.cellAt("| a | b \\| c | d |", 10) === 1 && tt.cellAt("a | b", 4) === 1)
}
// Cells on the clipboard (editor/tablePaste.ts): a spreadsheet's, a page's table or CSV in; tab-separated and HTML out.
{
  const tp: typeof import("../web/src/editor/tablePaste.ts") = await web("editor/tablePaste.ts")
  const sheets = '<meta charset="utf-8"><google-sheets-html-origin><style type="text/css"><!--td {border: 1px solid #cccccc;}--></style><table xmlns="http://www.w3.org/1999/xhtml" border="1"><colgroup><col width="100"/></colgroup><tbody><tr><td>Name</td><td>Note</td></tr><tr><td>Alice &amp; co</td><td>two<br/>lines</td></tr></tbody></table>'
  check("paste: a spreadsheet's HTML table", same(tp.htmlTable(sheets), [["Name", "Note"], ["Alice & co", "two\nlines"]]), tp.htmlTable(sheets))
  check("paste: not a page with a table somewhere in it", tp.htmlTable("<p>Intro</p><table><tr><td>a</td><td>b</td></tr></table>") === null)
  check("paste: a cell spanning columns keeps the rest under their headings", same(tp.htmlTable("<table><tr><th>a</th><th>b</th><th>c</th></tr><tr><td colspan=2>x</td><td>y</td></tr></table>"), [["a", "b", "c"], ["x", "", "y"]]))
  check("paste: tab-separated, quoted cells hold tabs, line breaks and quotes", same(tp.delimited('a\t"b\tc"\n"two\nlines"\t"say ""hi"""\n', "\t"), [["a", "b\tc"], ["two\nlines", 'say "hi"']]))
  check("paste: into a cell, a spreadsheet's cells", same(tp.clipCells("a\tb\n1\t2", sheets), [["a", "b"], ["1", "2"]]) && same(tp.clipCells("a\tb"), [["a", "b"]]))
  check("paste: into a cell, CSV lines", same(tp.clipCells("name,qty\npear,\"1,5\""), [["name", "qty"], ["pear", "1,5"]]))
  check("paste: into a cell, a line or a paragraph is text", tp.clipCells("Hello, world") === null && tp.clipCells("one\ntwo") === null && tp.clipCells("x", "<table><tr><td>x</td></tr></table>") === null)
  check("paste: the app's own copy keeps its Markdown (its text), not what its HTML drew", same(tp.clipCells("**a**\n[[B]]", "<table><tr><td><strong>a</strong></td></tr><tr><td><a>B</a></td></tr></table>"), [["**a**"], ["[[B]]"]]))
  check("paste: in the text, lines with the same tabs are a table", same(tp.pastedTable("a\tb\n1\t2"), [["a", "b"], ["1", "2"]]))
  check("paste: in the text, not one line, uneven tabs, tab-indented code, or one column",
    tp.pastedTable("a\tb") === null && tp.pastedTable("a\tb\n1\t2\t3") === null && tp.pastedTable("\tfoo()\n\tbar()") === null && tp.pastedTable("x", "<table><tr><td>a</td></tr><tr><td>b</td></tr></table>") === null)
  check("paste: in the text, a page's table", same(tp.pastedTable("", sheets), [["Name", "Note"], ["Alice & co", "two\nlines"]]))
  check("paste: rows as a Markdown table, pipes and line breaks escaped", tp.markdownTable([["a", "b|c"], ["1", "x\ny"]]) === "| a | b\\|c |\n| --- | --- |\n| 1 | x<br>y |", tp.markdownTable([["a", "b|c"], ["1", "x\ny"]]))
  check("copy: cells as tab-separated text, quoted where they must be", tp.tsvText([["a", "b\tc"], ["x\ny", 'say "hi"']]) === 'a\t"b\tc"\n"x\ny"\t"say ""hi"""')
}
const imgs = md.renderMarkdown("Before ![[photo.png|300]] and ![alt|200](../Img/photo.png) and ![[Idea]] after\n", vopts)
check("markdown: vault images show (with widths), and an embed mid-line is drawn in its place",
  imgs.includes('<img src="/api/raw?path=Img/photo.png" alt="photo.png" width="300"') && imgs.includes('alt="alt" width="200"') &&
  imgs.includes('<span class="md-embed" data-md-embed="Idea"><a class="wikilink" data-wiki="Idea" data-wiki-embed>Idea</a></span>'), imgs)
const raw = md.renderMarkdown('Line<br>two H<sub>2</sub>O x<sup>2</sup> <kbd>Cmd</kbd> <span style="color: red; position: fixed" onclick="x()">red</span>\n\n<details><summary>More</summary>\n\nInside\n\n</details>\n\n<script>alert(1)</script>\n\n<img src="photo.png" onerror="x()" width="50"> <a href="Idea">idea</a> <a href="javascript:x()">bad</a> <iframe src="https://x.test" onload="x()" allowfullscreen></iframe> <iframe src="http://x.test"></iframe> <custom>tag</custom>\n\n<span class="mine" id="a1">styled</span> <a class="mine" href="Idea">mine</a>\n', vopts)
check("markdown: raw HTML is drawn sanitized: safe tags and attributes (class, id), links, vault images, https frames sandboxed; no scripts or handlers",
  raw.includes("Line<br>two") && raw.includes("<sub>2</sub>") && raw.includes("<sup>2</sup>") && raw.includes("<kbd>Cmd</kbd>") && raw.includes('<span style="color: red">red</span>') &&
  raw.includes("<details><summary>More</summary>") && !raw.includes("alert") && !raw.includes("onclick") && !raw.includes("onerror") && !raw.includes("position") &&
  raw.includes('<img src="/api/raw?path=Img/photo.png" width="50" loading="lazy">') && raw.includes('data-wiki="Idea">idea</a>') && raw.includes("<a>bad</a>") &&
  raw.includes('<iframe src="https://x.test" allowfullscreen="" sandbox="allow-scripts allow-same-origin allow-presentation"') && !raw.includes("http://x.test") &&
  raw.split("</iframe>").length === 2 && raw.includes("&#60;custom&#62;tag&#60;/custom&#62;") && raw.includes('<span id="a1" class="mine">styled</span>') &&
  raw.includes('<a class="mine wikilink" data-wiki="Idea">mine</a>'), raw)
check("embeds: a note, a section, a block, a heading here", same([formats.embedOf("![[Idea]]"), formats.embedOf("![[Idea#Plans]]"), formats.embedOf("![[Idea#^b1]]"), formats.embedOf("![[#Top]]")].map((e) => e?.note),
  [true, true, true, true]) && formats.embedOf("![[photo.png]]") === null && formats.embedOf("![[v1.2 notes]]")?.note === true)
const note = "---\ntags: [a]\n---\n# Top\n\nIntro #intro and `#no` [[X#y]] ^p1\n\n## Plans\n\n- one ^li\n  - under\n- two\n\n```\n# not a heading #no\n```\n\n## After\n"
check("sections: headings (not in code or the frontmatter)", same(sec.headingsOf(note).map((h: Any) => h.text), ["Top", "Plans", "After"]), sec.headingsOf(note))
check("sections: fences close with their own character, at least as long", JSON.stringify(sec.scan("````md\n```js\n```\n````\n~~~\n```\n~~~\n```x").fences)
  === JSON.stringify([{ open: 0, close: 3, info: "md" }, { open: 4, close: 6, info: "" }, { open: 7, close: null, info: "x" }]), sec.scan("````md\n```js\n```\n````").fences)
check("sections: a heading's section", sec.extract(note, "Plans") === "## Plans\n\n- one ^li\n  - under\n- two\n\n```\n# not a heading #no\n```", sec.extract(note, "plans"))
check("sections: a block (its id taken off), a list item with what's under it", sec.extract(note, "^p1") === "Intro #intro and `#no` [[X#y]]" && sec.extract(note, "^li") === "- one\n  - under",
  [sec.extract(note, "^p1"), sec.extract(note, "^li")])
{
  // A section edited alone (FileEditor's `section`): its lines out and back in, the file around them as it was.
  const day = "---\ntype: day\n---\n## Plan\n\n- [ ] a\n### Later\nb\n\n## Notes\nhi\n"
  const p = sec.sectionParts(day, "plan")
  check("sections: a section's lines to edit alone, back in unchanged", p.part === "- [ ] a\n### Later\nb" && sec.joinSection(p, p.part) === day &&
    sec.joinSection(p, "- [x] a") === "---\ntype: day\n---\n## Plan\n\n- [x] a\n\n## Notes\nhi\n", [p, sec.joinSection(p, "- [x] a")])
  const empty = ["## Plan\n\n## Notes\n", "## Plan\n## Notes", "## Plan"].map((t) => { const q = sec.sectionParts(t, "Plan"); return [q.gap && sec.joinSection(q, "") === t, sec.joinSection(q, "- [ ] x")] })
  check("sections: lines written in an empty section get lines of their own", same(empty, [[true, "## Plan\n- [ ] x\n\n## Notes\n"], [true, "## Plan\n- [ ] x\n\n## Notes"], [true, "## Plan\n- [ ] x\n"]]) &&
    sec.sectionParts(day, "Lunch") === null, empty)
}
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
  check("newtab: unset reads as nulls; lists read leniently", same(nt.readNewTab(undefined), { sections: null, actions: null, icons: null, page: null }) &&
    same(nt.readNewTab({ sections: ["core:actions", 3, "core:actions", ""], actions: "file:new", icons: { "file:new": " star ", "palette:open": 3, x: "" }, page: 3 }),
      { sections: ["core:actions"], actions: null, icons: { "file:new": "star" }, page: null }) &&
    nt.readNewTab({ page: " Dashboards/Start.md " }).page === "Dashboards/Start.md")
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
  check("pins: placed at the end, before another, moved, kept before itself, unpinned", pins.placePin(["a", "b"], "c", true).join() === "a,b,c" &&
    pins.placePin(["a", "b"], "c", true, "a").join() === "c,a,b" && pins.placePin(["a", "b"], "b", true, "a").join() === "b,a" &&
    pins.placePin(["a", "b"], "a", true).join() === "a,b" && pins.placePin(["a", "b"], "a", false).join() === "b" &&
    pins.placePin(["a", "b"], "a", true, "a").join() === "a,b")
  check("pins: follow a moved folder, go with the trash", pins.repinList(["N/a", "N/b", "M"], "N", "O").join() === "O/a,O/b,M" &&
    pins.repinList(["N/a", "M"], "N/a", null).join() === "M")
  check("pins: a heading follows its note, a search stays", pins.repinList(["N/a.md#Plan", "search:N/a.md", "N/a.md"], "N/a.md", "O/b.md").join() === "O/b.md#Plan,search:N/a.md,O/b.md" &&
    pins.repinList(["N/a.md#Plan", "M"], "N", null).join() === "M" && JSON.stringify(pins.pinKind("N/a.md#^id")) === '{"file":"N/a.md","heading":"^id"}' &&
    JSON.stringify(pins.pinKind("view:terminal/resume-claude-a.md#x")) === '{"view":"view:terminal/resume-claude-a.md#x"}' && pins.repinList(["view:terminal/resume-claude-1"], "view:terminal", "x").join() === "view:terminal/resume-claude-1",
    pins.repinList(["N/a.md#Plan", "search:N/a.md", "N/a.md"], "N/a.md", "O/b.md"))
  check("pins: a pinned folder is a path; it follows its move and its parent's, and goes with the trash",
    JSON.stringify(pins.pinKind("Projects/Lighthouse")) === '{"file":"Projects/Lighthouse"}' &&
    pins.repinList(["Projects/Lighthouse", "Projects/Lighthouse/a.mp4", "Projects"], "Projects/Lighthouse", "Archive/Lighthouse").join() === "Archive/Lighthouse,Archive/Lighthouse/a.mp4,Projects" &&
    pins.repinList(["Projects/Lighthouse"], "Projects", "Work").join() === "Work/Lighthouse" && pins.repinList(["Projects/Lighthouse", "M"], "Projects/Lighthouse", null).join() === "M" &&
    pins.repinList(["Projects/Lighthouse2"], "Projects/Lighthouse", "X").join() === "Projects/Lighthouse2")
  check("sidebars: the default is by sort, without hidden panels", sb.defaultSidebars([{ key: "b", sort: 20 }, { key: "a", sort: 10 }, { key: "h", sort: 0, hidden: true }]).left.join() === "a,b")
  const sided = sb.defaultSidebars([{ key: "b", sort: 20 }, { key: "c", sort: 5, side: "right" }, { key: "a", sort: 10 }])
  check("sidebars: a panel that starts on the right is there by default", sided.left.join() === "a,b" && sided.right.join() === "c", sided)
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

  // A view hears each tab of its that goes (a web page is its tab's), and `last` once its place shows nowhere (a terminal).
  const heard: string[] = []
  ws.setTabCloser((to: string, tab: string, last: boolean) => heard.push(`${to} ${tab}${last ? " last" : ""}`))
  const W1 = { id: "w1", to: "view:web/https://example.com/" }, W2 = { id: "w2", to: "view:web/https://example.com/" }
  one([A, W1, W2], "w2"); ws.closeTab("w1", true)
  check("closing: a tab of a place another tab shows is heard, not as the last", heard.join("|") === "view:web/https://example.com/ w1", heard)
  heard.length = 0; ws.closeTab("w2", true)
  check("closing: the last tab of a place is heard as the last", heard.join("|") === "view:web/https://example.com/ w2 last", heard)
  heard.length = 0; one([A, W1, W2], "a"); ws.closeTabs("others", "a", true)
  check("closing several of a place: each heard, the last once", heard.join("|") === "view:web/https://example.com/ w1|view:web/https://example.com/ w2 last", heard)
  heard.length = 0; one([A, W1], "w1"); ws.takeOut(["w1"])
  check("a tab taken out to another window is heard, never as the last", heard.join("|") === "view:web/https://example.com/ w1", heard)
  heard.length = 0; one([A, W1], "w1"); ws.closeTab("a", true)
  check("closing a file's tab tells no view", !heard.length, heard)
  ws.setTabCloser(() => {})

  // Tab groups (core/tabsets.ts: a pane's runs of tabs, TabSet in layout.ts).
  const ts: Any = await web("core/tabsets.ts")
  const E = { id: "e", to: "file:e.md" }
  const pane = () => ws.groups()[0]
  const runs = () => ws.groups().map((x: Any) => x.tabs.map((t: Any) => {
    const st = x.sets?.find((y: Any) => y.id === t.set)
    return t.id + (st ? `(${st.name || st.color}${st.collapsed ? "-" : ""})` : "")
  }).join(",")).join(" | ")
  one([A, B, C, D, E], "a")
  let s1 = ts.makeSet(["b", "d"], { name: "Work" })
  check("tab groups: tabs made a group sit together where the first was, with the first unused colour", runs() === "a,b(Work),d(Work),c,e" && pane().sets[0].color === "blue", runs())
  ts.makeSet(["e"])
  check("tab groups: the next group takes the next colour; no name when the tabs share no folder or site", pane().sets[1].color === "orange" && pane().sets[1].name === "", pane().sets)
  check("tab groups: a new group's name is the folder its files share, or their site", ts.suggestName([{ id: "x", to: "file:Projects/Lighthouse/a.md" }, { id: "y", to: "file:Projects/Lighthouse/b.md" }]) === "Lighthouse"
    && ts.suggestName([{ id: "x", to: "view:web/https://www.github.com/a" }, { id: "y", to: "view:web/@work/https://github.com/b" }]) === "Github"
    && ts.suggestName([{ id: "x", to: "file:a.md" }, { id: "y", to: "view:terminal/q" }]) === "")
  ts.addToSet(["a"], s1)
  check("tab groups: a tab added to a group goes to its end", runs() === "b(Work),d(Work),a(Work),c,e(orange)", runs())
  ts.leaveSet(["d"])
  check("tab groups: a tab taken out of its group goes right after it", runs() === "b(Work),a(Work),d,c,e(orange)", runs())
  sp.moveTabTo("c", "g0", 1)
  check("tab groups: a tab dragged between two of a group's tabs joins it", runs() === "b(Work),c(Work),a(Work),d,e(orange)", runs())
  sp.moveTabTo("c", "g0", 5)
  check("tab groups: dragged out past the group's end, it leaves", runs() === "b(Work),a(Work),d,e(orange),c", runs())
  sp.moveTabTo("a", "g0", 2, null)
  check("tab groups: at the group's end, its own last tab stays in unless the drop says none", runs() === "b(Work),a,d,e(orange),c", runs())
  sp.moveTabTo("d", "g0", 1, s1)
  check("tab groups: a drop just after a group's chip joins it", runs() === "b(Work),d(Work),a,e(orange),c", runs())
  ts.foldSet(s1)
  check("tab groups: folding the group whose tab isn't on screen leaves the tab shown", runs() === "b(Work-),d(Work-),a,e(orange),c" && ws.activeTab().id === "a", runs())
  ws.selectTab("b")
  check("tab groups: showing a tab of a folded group opens it", runs() === "b(Work),d(Work),a,e(orange),c" && ws.activeTab().id === "b", runs())
  ts.foldSet(s1)
  check("tab groups: folding the group on screen shows the tab after it", runs() === "b(Work-),d(Work-),a,e(orange),c" && ws.activeTab().id === "a", runs())
  ts.foldSet(s1, false)
  ts.moveSetTo(s1, "g0", 5)
  check("tab groups: a whole group dragged moves with its tabs in order", runs() === "a,e(orange),c,b(Work),d(Work)", runs())
  ts.moveSetTo(s1, "g0", 1)
  check("tab groups: a group dropped inside another goes before it, never into it", runs() === "a,b(Work),d(Work),e(orange),c", runs())
  ts.renameSet(s1, "  Lighthouse "); ts.colorSet(s1, "teal")
  check("tab groups: renamed (trimmed) and recoloured", pane().sets[0].name === "Lighthouse" && pane().sets[0].color === "teal", pane().sets)
  ws.closeTab("e")
  check("tab groups: closing a group's last tab removes the group", runs() === "a,b(Lighthouse),d(Lighthouse),c" && pane().sets.length === 1, runs())
  ws.closeTab("d"); ws.reopenTab()
  check("tab groups: a closed tab reopens back in its group", runs() === "a,b(Lighthouse),d(Lighthouse),c", runs())
  ws.reopenTab()
  check("tab groups: one whose group went reopens where it was, in none", runs() === "a,b(Lighthouse),d(Lighthouse),e,c" && pane().sets.length === 1, runs())
  ws.selectTab("b"); ws.go("file:z.md", true)
  check("tab groups: a tab opened from a grouped tab joins its group", runs().startsWith("a,b(Lighthouse),") && ws.activeTab().set === s1, runs())
  ws.newTab()
  check("tab groups: a new blank tab from a grouped tab goes after the group, in none", ws.activeTab().to === "new" && !ws.activeTab().set
    && pane().tabs.findIndex((t: Any) => t.to === "new") === pane().tabs.map((t: Any) => t.set).lastIndexOf(s1) + 1, runs())
  ts.ungroupSet(s1)
  check("tab groups: ungrouped, the tabs stay where they were", !pane().sets && !pane().tabs.some((t: Any) => t.set), runs())
  // Saved and read back: a tab in a group the pane hasn't is in none; a group's tabs apart are gathered; a bad colour drops it.
  const read = lay.clean({ id: "g0", active: "a", tabs: [{ id: "a", to: "file:a.md", set: "s" }, { id: "b", to: "file:b.md" }, { id: "c", to: "file:c.md", set: "s" }, { id: "d", to: "file:d.md", set: "gone" }],
    sets: [{ id: "s", name: "Read", color: "green", collapsed: true }, { id: "x", name: "Bad", color: "chartreuse" }] })
  check("tab groups: read back as they must be (together, known groups only, the one on screen open)",
    read.tabs.map((t: Any) => t.id + (t.set ?? "")).join(",") === "as,cs,b,d" && read.sets.length === 1 && !read.sets[0].collapsed, read)
  two([A, B], [C, D], "gL"); s1 = ts.makeSet(["a", "c"], { name: "Both" })
  check("tab groups: tabs from two panes grouped go to the first's pane", runs() === "a(Both),c(Both),b | d", runs())
  ts.moveSetTo(s1, "gR", "right")
  check("tab groups: a group dragged to a pane's edge is a pane of its own", runs() === "b | d | a(Both),c(Both)", runs())
  sp.moveTabTo("d", ws.groups()[2].id, "center")
  check("tab groups: a tab moved into another pane's middle joins no group", runs() === "b | a(Both),c(Both),d", runs())
  const saved = JSON.parse(JSON.stringify(ws.getWorkspace())); ws.replaceWorkspace(saved)
  check("tab groups: a layout put back (another device, a reload) keeps them", runs() === "b | a(Both),c(Both),d", runs())
}

// ---------- Browser: a tab owns its page (electron/webpages.ts) ----------
{
  const wp = await import("../electron/webpages.ts")
  type P = { id: number; win: string; tab: string; profile: string; holds: number; closing: boolean; let: number; orphan?: number }
  let n = 0
  const page = (tab: string, o: Partial<P> = {}): P => ({ id: ++n, win: "w", tab, profile: "", holds: 1, closing: false, let: 0, ...o })
  const a = page("t1"), b = page("t2")
  check("pages: a tab shown again gets its own page, never another tab's at the same address",
    wp.claim([a, b], "w", "t1", "").reuse === a && wp.claim([a, b], "w", "t3", "").reuse === null && wp.claim([a, b], "w2", "t1", "").reuse === null)
  const moved = wp.claim([a], "w", "t1", "c-work")
  check("pages: a tab moved to another container gets a new page, its old one ends", moved.reuse === null && moved.end[0] === a, moved)
  check("pages: no tab (a glance) never reuses one", wp.claim([page("")], "w", "", "").reuse === null)
  const c = page("t1")
  c.holds = 2
  check("pages: let go of by a view while another still shows it, it stays shown", !wp.letGo(c, 5) && c.holds === 1)
  check("pages: hidden with its tab in the background, it's kept", !wp.letGo(c, 6) && c.holds === 0 && c.let === 6)
  check("pages: a glance's ends when let go of", wp.letGo(page(""), 1))
  const shown = page("t4"), hidden = page("t5", { holds: 0 })
  check("pages: a background tab closing ends its page at once", wp.tabGone([shown, hidden], "w", "t5")[0] === hidden)
  check("pages: a shown tab closing ends its page as it's let go of", !wp.tabGone([shown], "w", "t4").length && shown.closing && wp.letGo(shown, 1)
    && wp.claim([shown], "w", "t4", "").reuse === null)
  const r1 = page("t6"), r2 = page(""), r3 = page("t7", { closing: true })
  const ended = wp.windowReloaded([r1, r2, r3], "w", 1000)
  check("pages: a window reloading: tabs' pages wait to be taken back, the rest end", ended.length === 2 && r1.orphan === 1000 && r1.holds === 0, ended)
  check("pages: one not taken back in time ends", !wp.unclaimed([r1], 1000 + wp.RECLAIM_MS - 1).length && wp.unclaimed([r1], 1000 + wp.RECLAIM_MS)[0] === r1)
  const bg = Array.from({ length: wp.KEEP + 3 }, (_, i) => page(`b${i}`, { holds: 0, let: i }))
  const out = wp.discardable([...bg, page("x")], (p: P) => p.tab === "b0")
  check("pages: short of memory, the longest in the background are discarded, never shown or playing ones",
    out.map((p: P) => p.tab).join() === "b2,b1", out.map((p: P) => p.tab))

  // A page's sound as its tab shows it: through a quiet scene till its media pauses.
  const v = wp.playback()
  wp.media(v, true, false)
  check("sound: media playing before any sound isn't playing (a silent autoplay)", !wp.playing(v, false, 0))
  wp.hear(v, true, 1000)
  wp.hear(v, false, 2000)
  check("sound: a video in a quiet scene still plays, past a minute's silence not (a muted hero video after a ping)",
    wp.playing(v, false, 2000 + wp.QUIET_MS * 3) && !wp.playing(v, false, 2000 + wp.MEDIA_QUIET_MS))
  wp.media(v, false, true)
  check("sound: its pause ends it at once, though Chromium's audible lingers", !wp.playing(v, true, 2100))
  wp.media(v, true, true)
  check("sound: playing again while audible plays at once (an ad, then the video)", wp.playing(v, true, 3000))
  const g = wp.playback()
  wp.hear(g, true, 0)
  wp.hear(g, false, 1000)
  check("sound: without media (a game) a quiet stretch still plays, then ends",
    wp.playing(g, false, 1000 + wp.QUIET_MS - 1) && !wp.playing(g, false, 1000 + wp.QUIET_MS))
  wp.hear(g, true, 20_000)
  check("sound: a new sound ends its quiet stretch", wp.playing(g, true, 20_000) && g.quiet === undefined)
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

// ---------- Browser: what's typed in the address bar (plugins/core/web-viewer/address.ts) ----------
{
  const { addressOf, hostOf } = await import("../plugins/core/web-viewer/address.ts")
  check("Browser: an address with its scheme as it is", addressOf(" https://example.com/a?b=1#c ") === "https://example.com/a?b=1#c")
  check("Browser: a host gets https", addressOf("example.com/posts") === "https://example.com/posts" && addressOf("sub.example.co.uk") === "https://sub.example.co.uk/")
  check("Browser: this machine and IP addresses get http", addressOf("localhost:3000/x") === "http://localhost:3000/x" && addressOf("127.0.0.1:8080") === "http://127.0.0.1:8080/")
  check("Browser: words are a search", addressOf("open source notes") === "https://duckduckgo.com/?q=open%20source%20notes"
    && addressOf("notes", "https://search.example/?s=%s") === "https://search.example/?s=notes")
  check("Browser: other schemes and nothing are refused", addressOf("file:///etc/hosts") === null && addressOf("javascript:alert(1)") === null && addressOf("  ") === null)
  check("Browser: a tab's name before the page's title is its site", hostOf("https://www.example.com/a") === "example.com" && hostOf("nonsense") === "nonsense")
}

// ---------- Browser: the bookmarks note (plugins/core/web-viewer/bookmarks.ts) ----------
{
  const { addBookmarks, matchBookmarks, readBookmarks } = await import("../plugins/core/web-viewer/bookmarks.ts")
  const note = "# Links\n\n- [Top](https://top.example.com/)\n\n## Reading\n* <https://bare.example.com/a>\n\n```\n## Not a folder\n- [No](https://no.example.com/)\n```\n\n### Later\n- [x] [Done \\] it](https://later.example.com/)\n"
  const read = readBookmarks(note)
  check("bookmarks: links by their folders (a # title isn't one), a code block's ignored", JSON.stringify(read.map((b) => [b.folder, b.title, b.url])) === JSON.stringify([
    ["", "Top", "https://top.example.com/"], ["Reading", "", "https://bare.example.com/a"], ["Reading/Later", "Done ] it", "https://later.example.com/"]]), read)
  const added = addBookmarks(note, [{ url: "https://top.example.com/", title: "Again", folder: "" }, { url: "https://new.example.com/", title: "New", folder: "Reading/Later" },
    { url: "https://deep.example.com/", title: "Deep", folder: "Reading/Later/Deeper" }, { url: "javascript:alert(1)", title: "Bad", folder: "" }])
  check("bookmarks: added under their folders, a missing one made, nothing changed, no repeats", added.added === 2
    && added.body.includes("[x] [Done \\] it](https://later.example.com/)\n- [New](https://new.example.com/)\n\n#### Deeper\n- [Deep](https://deep.example.com/)\n")
    && added.body.startsWith(note.slice(0, -1)), added)
  check("bookmarks: matched by title and address", matchBookmarks(read, "later")[0]?.url === "https://later.example.com/" && !matchBookmarks(read, "nothing").length)
}

// ---------- Browser: the blocked elements note (plugins/core/web-viewer/elements.ts) ----------
{
  const { addRule, makeRule, readRules, removeRule } = await import("../plugins/core/web-viewer/elements.ts")
  const note = "Things I hid.\n\n## youtube.com\n\n- `youtube.com##ytd-reel-shelf-renderer` Shorts\n- youtube.com##ytd-comments#comments\n\n## Notes\n\nA paragraph.\n\n```\nexample.com##.ad\n```\n"
  check("blocked elements: rules as list items, bare or in backticks (words after them a note), a pasted block's too; headings aren't",
    JSON.stringify(readRules(note).map((r) => [r.site, r.selector])) === JSON.stringify([["youtube.com", "ytd-reel-shelf-renderer"], ["youtube.com", "ytd-comments#comments"], ["example.com", ".ad"]]), readRules(note))
  const a = addRule(note, makeRule("#related", "https://www.youtube.com/watch")!)
  check("blocked elements: a rule added under its site's heading, after its last, nothing else changed", a.added
    && a.body.includes("- youtube.com##ytd-comments#comments\n- `youtube.com###related`\n\n## Notes"), a.body)
  const b = addRule(a.body, makeRule("news.example.com,~old.news.example.com##div[class*=\"promo\"]")!)
  check("blocked elements: a new site gets its heading at the end; a rule there already isn't added again",
    b.body.endsWith("```\n\n## news.example.com\n\n- `news.example.com,~old.news.example.com##div[class*=\"promo\"]`\n") && !addRule(b.body, makeRule("youtube.com##ytd-reel-shelf-renderer")!).added, b.body)
  const c = removeRule(b.body, "news.example.com,~old.news.example.com##div[class*=\"promo\"]")
  check("blocked elements: a rule removed takes its heading when nothing's left under it", c.removed && c.body === a.body, c.body)
  const d = removeRule(c.body, "youtube.com##ytd-comments#comments")
  check("blocked elements: … and leaves it with others", d.body.includes("## youtube.com\n\n- `youtube.com##ytd-reel-shelf-renderer` Shorts\n- `youtube.com###related`\n"), d.body)
  check("blocked elements: what isn't a rule isn't made one", makeRule("a\nb") === null && makeRule(".x", "not a site!") === null && makeRule("## heading") === null)
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
  // The table's state, as Obsidian writes it: sort, order, columnSize, display names, summaries, filters.
  const st = "# books\nviews:\n  - type: table\n    name: All # main\n    order: [file.name, price] # cols\n    sort:\n      - property: price # first\n        direction: ASC\n    columnSize:\n      note.price: 120\n      note.price: 200\n    x-plugin: {keep: me}\n"
  const sorted = edit.setSort(st, 0, [{ key: "price", desc: true }, { key: "file", desc: false }])
  check("bases: a header's sort written as Obsidian's, its comment kept, a new key Obsidian's way",
    sorted === st.replace("direction: ASC\n", "direction: DESC\n      - property: file.name\n        direction: ASC\n"), sorted)
  check("bases: no sort removes the key", !edit.setSort(st, 0, []).includes("sort:") && edit.setSort(st, 0, []).includes("x-plugin: {keep: me}"), edit.setSort(st, 0, []))
  const ordered = edit.setOrder(st, 0, ["price", "file", "status"])
  check("bases: columns reordered in their own style and spelling, a new one as note.x", ordered === st.replace("order: [file.name, price]", "order: [price, file.name, note.status]"), ordered)
  const sized = edit.setColumnSize(st, 0, "price", 251.6)
  check("bases: a column's width once (Obsidian's duplicate key gone), the rest kept", sized === st.replace("      note.price: 120\n      note.price: 200\n", "      note.price: 252\n"), sized)
  check("bases: a new width makes columnSize; none removes it", edit.setColumnSize("views:\n  - type: table\n", 0, "formula.left", 90) === "views:\n  - type: table\n    columnSize:\n      formula.left: 90\n"
    && !edit.setColumnSize(sized, 0, "price", null).includes("columnSize"), edit.setColumnSize(sized, 0, "price", null))
  const named = edit.setDisplayName(st, "price", "Cost")
  check("bases: a display name in properties, removed again with nothing left behind",
    named === `${st}properties:\n  price:\n    displayName: Cost\n` && edit.setDisplayName(named, "price", "") === st, named)
  check("bases: a summary for a column", edit.setSummary(st, 0, "price", "Sum").endsWith("    x-plugin: {keep: me}\n    summaries:\n      price: Sum\n"), edit.setSummary(st, 0, "price", "Sum"))
  const filtered = edit.setFilters("# top\nfilters: file.inFolder(\"Books\")\nviews:\n  - type: table\n", 0, { and: ['status == "done"', '!file.hasTag("x")'] })
  check("bases: a view's filters written, an expression starting ! quoted", filtered === "# top\nfilters: file.inFolder(\"Books\")\nviews:\n  - type: table\n    filters:\n      and:\n        - status == \"done\"\n        - '!file.hasTag(\"x\")'\n", filtered)
  check("bases: the base's filters removed, the comment above them kept", edit.setFilters("# top\nfilters: x\nviews: []\n", null, undefined) === "# top\nviews: []\n")
  const nested = "filters:\n  or:\n    - file.hasTag(\"a\") # tagged\n    - and:\n        - price > 2\n"
  check("bases: a filter changed keeps the comments of the rest", edit.setFilters(nested, null, { or: ['file.hasTag("a")', { and: ["price > 3"] }] }) === nested.replace("price > 2", "price > 3"),
    edit.setFilters(nested, null, { or: ['file.hasTag("a")', { and: ["price > 3"] }] }))
  const fl = await import(pathToFileURL(path.join(ROOT, "plugins", "core", "query", "filters.ts")).href)
  const conds = ['status == "done"', "price > 10", '!file.inFolder("A/B")', 'note["due date"] >= date("2026-01-01")', '!tags.contains("ai")', "status.isEmpty()"]
  check("bases: filter expressions read as conditions and written back the same", conds.every((s) => { const c = fl.condOf(s); return c && fl.exprOf({ ...c, src: undefined }) === s }),
    conds.map((s) => fl.condOf(s)))
  const tree = fl.treeOf({ or: ['file.hasTag("tag")', { and: ['file.hasTag("book")', "weird((("] }, { not: ["a"] }, { foo: 1 }] })
  check("bases: a filter tree's groups, what can't be read kept as text or as it was",
    tree.kind === "or" && tree.items[1].items[1].t === "raw" && tree.items[3].t === "other" && JSON.stringify(fl.valueOf(tree)) === '{"or":["file.hasTag(\\"tag\\")",{"and":["file.hasTag(\\"book\\")","weird((("]},{"not":["a"]},{"foo":1}]}'
    && fl.valueOf(fl.treeOf(undefined)) === undefined && fl.exprOf({ t: "cond", prop: "due", op: "<", value: "2026-10-01" }) === 'due < date("2026-10-01")', fl.valueOf(tree))
  const fmts = await web("core/formats.ts")
  fmts.setFormatLookup((p: string) => (p.endsWith(".base") ? { ext: "base", page: false } : null))
  fmts.setFenceLookup((lang: string) => lang === "base")
  check("embeds: a base and one of its views; a core file has no #part", JSON.stringify([fmts.embedOf("![[Books.base#Reading|300]]"), fmts.embedOf("![[Books.base]]"), fmts.embedOf("![[x.csv#y]]")])
    === '[{"target":"Books.base#Reading","height":300},{"target":"Books.base"},null]' && JSON.stringify(fmts.embedParts("Books.base#Reading")) === '{"name":"Books.base","sub":"Reading"}',
    [fmts.embedOf("![[Books.base#Reading|300]]"), fmts.embedOf("![[x.csv#y]]")])
  check("fences: a plugin's language is drawn as the block ```lang; others are code", fmts.fenceBlock("base") === "```base" && fmts.fenceBlock("Base x") === "```base"
    && fmts.fenceBlock("js") === null && fmts.fenceBlock("block-person") === null)
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

  // A note's indent is its own when it has one, as VS Code does (web/src/editor/languages.ts); the setting otherwise.
  const { ownIndent } = await import("../web/src/editor/languages.ts")
  check("editor: a note indented with 2 spaces keeps 2", ownIndent("- a\n  - b\n    - c\n", true) === "  ")
  check("editor: a note indented with tabs keeps tabs", ownIndent("- a\n\t- b\n", true) === "\t")
  check("editor: a note with no indented line has none of its own", ownIndent("# A\n\n- a\n- b\n", true) === null)
  check("editor: a note's frontmatter and code blocks don't count", ownIndent("---\ntags:\n  - x\n---\n- a\n```js\n    f()\n```\n", true) === null
    && ownIndent("---\ntags:\n  - x\n---\n- a\n\t- b\n", true) === "\t")
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

// ---------- Clear formatting (plugins/core/editing/edit.ts) ----------
{
  const { EditorState, EditorSelection } = await import("@codemirror/state")
  const { clearFormatting } = await plugin("editing/edit.ts")
  const clear = (doc: string, from: number, to: number) => {
    const view = { state: EditorState.create({ doc, selection: EditorSelection.range(from, to) }), dispatch(tr: import("@codemirror/state").TransactionSpec) { this.state = this.state.update(tr).state } }
    clearFormatting(view as never)
    return view.state.doc.toString()
  }
  const line = "**alpha** ==beta== `x`"
  check("clear formatting: a whole line's marks", clear(line, 0, line.length) === "alpha beta x", clear(line, 0, line.length))
  check("clear formatting: a selection stopping at hidden marks (live preview's Home and End) takes them in",
    clear(line, 2, line.length - 1) === "alpha beta x", clear(line, 2, line.length - 1))
  check("clear formatting: a word in its marks; a lone * stays", clear("a **b** c", 4, 5) === "a b c" && clear("2*3 x", 2, 3) === "2*3 x", [clear("a **b** c", 4, 5), clear("2*3 x", 2, 3)])
}

// ---------- Highlight colours in the editor (web/src/core/highlights.ts, web/src/editor/highlights.ts) ----------
{
  const { EditorState, EditorSelection } = await import("@codemirror/state")
  const hl: typeof import("../web/src/core/highlights.ts") = await web("core/highlights.ts")
  const { clearFormatting } = await plugin("editing/edit.ts")
  type View = { state: import("@codemirror/state").EditorState; dispatch(tr: import("@codemirror/state").TransactionSpec): void; focus(): void }
  // "|" is the cursor, "[...]" a selection.
  const view = (doc: string): View => {
    const a = doc.indexOf("["), c = doc.indexOf("|")
    const text = doc.replace(/[[\]|]/g, "")
    const sel = c >= 0 ? EditorSelection.cursor(c) : EditorSelection.range(a, doc.indexOf("]") - 1)
    return { state: EditorState.create({ doc: text, selection: sel }), dispatch(tr) { this.state = this.state.update(tr).state }, focus() {} }
  }
  const shown = (v: View) => {
    const { from, to } = v.state.selection.main, t = v.state.doc.toString()
    return from === to ? t.slice(0, from) + "|" + t.slice(from) : `${t.slice(0, from)}[${t.slice(from, to)}]${t.slice(to)}`
  }
  const act = (doc: string, fn: (v: never) => unknown) => { const v = view(doc); fn(v as never); return shown(v) }
  const at = view("a ==🟢be|ta== c")
  const h = hl.highlightAt(at.state, at.state.selection.main.head)
  check("editor highlights: the one at the cursor, its marks and colour", h?.from === 2 && h.to === 12 && h.color === "green" && h.len === 2, h)
  check("editor highlights: none outside", hl.highlightAt(view("a| ==x==").state, 1) === null)
  check("editor highlights: recolour keeps the cursor in the text", act("a ==🟢be|ta== c", hl.colorHighlight("red")) === "a ==🔴be|ta== c", act("a ==🟢be|ta== c", hl.colorHighlight("red")))
  check("editor highlights: Default takes the emoji out", act("a ==🟢be|ta== c", hl.colorHighlight(null)) === "a ==be|ta== c" && act("a ==be|ta== c", hl.colorHighlight("blue")) === "a ==🔵be|ta== c")
  check("editor highlights: a selection highlighted in a colour, still selected", act("a [word] c", hl.colorHighlight("orange")) === "a ==🟠[word]== c", act("a [word] c", hl.colorHighlight("orange")))
  check("editor highlights: the word at the cursor; nowhere, the cursor between new marks", act("a wo|rd c", hl.colorHighlight("green")) === "a ==🟢wo|rd== c"
    && act("a | c", hl.colorHighlight("green")) === "a ==🟢|== c", [act("a wo|rd c", hl.colorHighlight("green")), act("a | c", hl.colorHighlight("green"))])
  const un = view("a ==🟣be|ta== c")
  check("editor highlights: toggling a coloured one off takes its colour too", hl.unhighlight(un as never) && shown(un) === "a be|ta c" && !hl.unhighlight(view("a ==be|ta== c") as never), shown(un))
  const { highlightIcon, highlightItems }: { highlightIcon(c: string | null, now?: boolean): unknown; highlightItems(view: never, at?: number): { label: string; icon?: unknown; run(): void }[] } = await web("core/highlightMenu.ts")
  const items = highlightItems(view("a ==🔵x|== c") as never)
  check("editor highlights: the menu's colours, the one there ringed", items.map((i) => i.label).join() === "Default,Red,Orange,Yellow,Green,Blue,Purple"
    && items.filter((i) => i.icon === highlightIcon(i.label === "Default" ? null : i.label.toLowerCase(), true)).map((i) => i.label).join() === "Blue", items.map((i) => i.label))
  const sw = view("a ==🔵x|== c")
  const swatch = highlightItems(sw as never, 2)
  swatch.find((i) => i.label === "Yellow")!.run()
  check("editor highlights: the swatch's menu recolours its highlight", shown(sw) === "a ==🟡x|== c", shown(sw))
  swatch.find((i) => i.label === "Remove highlight")!.run()
  check("editor highlights: and Remove highlight takes it out", shown(sw) === "a x| c", shown(sw))
  const clear = (doc: string) => act(doc, (v: never) => clearFormatting(v, hl.HIGHLIGHT_EMOJI))
  check("clear formatting: a coloured highlight's emoji goes with its marks (selected, at the cursor, or from where its marks hide)",
    clear("[==🟢beta== x]") === "[beta x]" && clear("a ==🟢be|ta== c") === "a [beta] c" && clear("==🟢[beta]==") === "[beta]", [clear("[==🟢beta== x]"), clear("a ==🟢be|ta== c"), clear("==🟢[beta]==")])

  // Typing == suggests the colours (CodeMirror's CompletionContext needs a page; the source reads its state and pos).
  const { highlightSource }: { highlightSource(ctx: never): unknown } = await web("editor/highlights.ts")
  const { markdown } = await import("@codemirror/lang-markdown")
  const suggest = (doc: string) => {
    const pos = doc.indexOf("|"), text = doc.replace("|", "")
    const state = EditorState.create({ doc: text, extensions: [markdown()] })
    const ctx = { state, pos, explicit: false, matchBefore(re: RegExp) {
      const l = state.doc.lineAt(pos), t = l.text.slice(0, pos - l.from), m = new RegExp(`(?:${re.source})$`, re.flags).exec(t)
      return m ? { from: l.from + m.index, to: pos, text: m[0] } : null
    } } as never
    return highlightSource(ctx) as { from: number; options: import("@codemirror/autocomplete").Completion[] } | null
  }
  const offered = suggest("A ==|")
  check("editor highlights: == suggests the six colours", offered?.options.map((o) => o.label).join() === "Red,Orange,Yellow,Green,Blue,Purple" && offered.from === 4, offered?.options.map((o) => o.label))
  check("editor highlights: narrowed by a name typed after it", suggest("A ==gr|")?.options.map((o) => o.label).join() === "Green" && suggest("A ==text|") === null)
  check("editor highlights: not for a closing ==, a === or in code", suggest("A ==text==|") === null && suggest("a ===|") === null && suggest("`a ==|`") === null)
  const pick = (doc: string) => {
    const r = suggest(doc)!, v = view(doc)
    const apply = r.options.find((o) => o.label === "Green")!.apply as (v: never, c: unknown, from: number, to: number) => void
    apply(v as never, null, r.from, v.state.selection.main.head)
    return shown(v)
  }
  check("editor highlights: a pick goes in with the closing == after the cursor, or alone before text", pick("A ==|") === "A ==🟢|==" && pick("A ==|word") === "A ==🟢|word",
    [pick("A ==|"), pick("A ==|word")])
}

// ---------- Shortcodes: :fire: and :LiCalendar: while typing (plugins/core/shortcodes) ----------
{
  const c = await import("../plugins/core/shortcodes/codes.ts")
  const { gemoji } = await import("gemoji")
  // (by a name in a variable: the server's type check doesn't follow them into the web's modules)
  const LUCIDE = "lucide-react/dist/esm/icons/index.mjs", EDITOR = "../plugins/core/shortcodes/editor.ts"
  const lucide = Object.keys(await import(LUCIDE)).sort()
  const names = (typed: string, recent: string[] = []) => c.matches(typed, gemoji, lucide, recent, 5).map((f) => f.kind === "emoji" ? f.emoji : `icon:${f.name}`)
  check("shortcodes: :fir finds 🔥 first, then icons", names("fir")[0] === "🔥" && names("fir").includes("icon:flame") === false && names("fire").some((n) => n.startsWith("icon:")), names("fir"))
  check("shortcodes: :icon-cal and Iconize's :LiCal are only icons", names("icon-cal").every((n) => n.startsWith("icon:")) && names("icon-cal")[0] === "icon:calendar"
    && names("LiCal")[0] === "icon:calendar", [names("icon-cal"), names("LiCal")])
  check("shortcodes: a recently used match comes first", names("sm")[0] !== "😏" && names("sm", ["😏"])[0] === "😏", [names("sm"), names("sm", ["😏"])])
  check("shortcodes: icons written as Iconize writes them", c.iconCode("CalendarDays") === ":LiCalendarDays:" && c.kebab("ArrowUp01") === "arrow-up-01"
    && [..."a :LiCalendar: b :Lifoo: `:LiSun:`".matchAll(c.ICON_CODE)].map((m) => m[1]).join() === "Calendar,Sun")
  check("shortcodes: typing starts after a space or a line's start, not in a time or a URL", c.TYPING.test("a :fi") && c.TYPING.test(":+1") && !c.TYPING.test("10:30")
    && !c.TYPING.test("https://x") && !c.TYPING.test("a:fi") && !c.TYPING.test("a :f"))
  check("shortcodes: a whole code closed", c.CLOSED.exec("so :fire:")?.[1] === "fire" && !c.CLOSED.test("10:30:") && !c.CLOSED.test("a::"))
  check("shortcodes: remembered latest first, once", c.remember(["a", "b"], "b").join() === "b,a")
  // Icons are drawn from each Lucide component's own drawing (editor.ts iconSvg reads it the same way).
  const comp = (await import(LUCIDE) as Record<string, { render(p: object, r: null): { props: { icon: { node: unknown[] } } } }>).Calendar
  check("shortcodes: a Lucide component gives its drawing", Array.isArray(comp.render({}, null).props.icon.node) && comp.render({}, null).props.icon.node.length > 0)

  // The suggestions in a note, and a pick put in.
  const { iconName, suggest }: { iconName(n: string): string | null; suggest(ctx: never, on: object): Promise<{ from: number; options: import("@codemirror/autocomplete").Completion[] } | null> | { from: number; options: import("@codemirror/autocomplete").Completion[] } | null } = await import(EDITOR)
  const { EditorState } = await import("@codemirror/state")
  const { markdown } = await import("@codemirror/lang-markdown")
  const ask = async (doc: string, on = {}) => {
    const pos = doc.indexOf("|"), text = doc.replace("|", "")
    const state = EditorState.create({ doc: text, extensions: [markdown()] })
    const ctx = { state, pos, explicit: false, matchBefore(re: RegExp) {
      const l = state.doc.lineAt(pos), t = l.text.slice(0, pos - l.from), m = new RegExp(`(?:${re.source})$`, re.flags).exec(t)
      return m ? { from: l.from + m.index, to: pos, text: m[0] } : null
    } } as never
    const r = await suggest(ctx, on)
    if (!r) return null
    const view = { state, dispatch(tr: import("@codemirror/state").TransactionSpec) { this.state = this.state.update(tr).state } }
    const first = r.options[0].apply as (v: never, c: unknown, from: number, to: number) => void
    first(view as never, null, r.from, pos)
    return { labels: r.options.map((o) => o.label), picked: view.state.doc.toString() }
  }
  const fi = await ask("Hot :fir|")
  check("shortcodes: :fir suggests :fire: and picking it puts 🔥 in", fi?.labels[0] === ":fire:" && fi.picked === "Hot 🔥", fi)
  const cal = await ask("Due :icon-calendar|")
  check("shortcodes: picking an icon writes :LiCalendar:", cal?.picked === "Due :LiCalendar:", cal)
  check("shortcodes: an icon's old name or another case still draws it (Iconize's Obsidian may know older names)",
    iconName("Smile") === "FaceSlightlySmiling" && iconName("calendardays") === "CalendarDays" && iconName("NoSuchIcon") === null, [iconName("Smile"), iconName("calendardays")])
  check("shortcodes: none in code or the frontmatter, nor for a namespace switched off", await ask("`a :fi|`") === null && await ask("---\nx: :fi|\n---\n") === null
    && await ask("a :icon-cal|", { icons: false }) === null && (await ask("a :fir|", { emoji: false }))?.labels.every((l) => !l.startsWith(":")) === true)
}

// ---------- Fuzzy matching (web/src/core/fuzzy.ts): the palette, the quick switcher and the pickers ----------
{
  const { fuzzy, hasWords }: { fuzzy(q: string, s: string): { score: number; marks: number[] } | null; hasWords(q: string, s: string): boolean } = await web("core/fuzzy.ts")
  const shown = (q: string, s: string) => { const m = fuzzy(q, s); return m ? m.marks.map((i) => s[i]).join("") : null }
  const rank = (q: string, list: string[]) => list.filter((s) => fuzzy(q, s)).sort((a, b) => fuzzy(q, b)!.score - fuzzy(q, a)!.score)
  check("fuzzy: words in any order ('settings graph' finds Open graph view settings), each marked",
    shown("settings graph", "Open graph view settings") === "graphsettings", shown("settings graph", "Open graph view settings"))
  check("fuzzy: parts of words, in any order, as typed or by letters", shown("sett gra", "Open graph view settings") === "grasett"
    && shown("vw grph", "Open graph view settings") === "grphvw" && fuzzy("settings graph", "Open settings") === null && fuzzy("graph zzz", "Open graph view") === null,
    [shown("sett gra", "Open graph view settings"), shown("vw grph", "Open graph view settings")])
  const cmds = ["Open graph view settings", "Open settings", "Graph settings", "Open local graph", "Toggle line numbers"]
  check("fuzzy: the phrase as typed first, then words in order, then out of order",
    rank("graph settings", ["Settings for the graph", "Graph view settings", "Graph settings"]).join("|") === "Graph settings|Graph view settings|Settings for the graph",
    rank("graph settings", ["Settings for the graph", "Graph view settings", "Graph settings"]))
  check("fuzzy: every word as typed beats one matched only by its letters",
    rank("open graph", ["Open grand map path", "Open local graph"]).join("|") === "Open local graph|Open grand map path", rank("open graph", ["Open grand map path", "Open local graph"]))
  check("fuzzy: the typed order scores more than the same words reversed, on the same name",
    fuzzy("graph settings", cmds[0])!.score > fuzzy("settings graph", cmds[0])!.score)
  check("fuzzy: one word as before (a run at a word start, else letters in order)",
    JSON.stringify(fuzzy("graph", "Open graph view")) === JSON.stringify({ score: 158.5, marks: [5, 6, 7, 8, 9] })
    && JSON.stringify(fuzzy("ogv", "Open graph view")?.marks) === "[0,5,11]" && fuzzy("xyz", "Open graph view") === null
    && rank("graph", cmds).join("|") === "Graph settings|Open local graph|Open graph view settings", [fuzzy("graph", "Open graph view"), rank("graph", cmds)])
  check("fuzzy: a word marked at a word's start when it's in one ('set': settings, not reset)", shown("set", "Reset settings") === "set" && fuzzy("set", "Reset settings")!.marks[0] === 6)
  check("fuzzy: nothing typed matches everything, unmarked", JSON.stringify(fuzzy("  ", "Anything")) === JSON.stringify({ score: 0, marks: [] }))
  check("has words: every word as typed, any order", hasWords("tabs alice", "Alice Park\nOpen tabs") && !hasWords("tabs bob", "Alice Park\nOpen tabs"))
}

{
  // A :has() on the whole page (:root, html, body) is checked again on every DOM change anywhere: typing in a note
  // recalculated 4x the styles with two of them. Which sidebar is there is an attribute App.tsx sets instead.
  const css = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory()
    ? (e.name === "node_modules" ? [] : css(path.join(d, e.name))) : e.name.endsWith(".css") ? [path.join(d, e.name)] : [])
  const pagewide = [WEB, path.join(ROOT, "plugins")].flatMap(css).flatMap((f) =>
    [...fs.readFileSync(f, "utf8").matchAll(/(?:^|[\s,{}(])(?::root|html|body)(?:\[[^\]]*\]|:not\((?!:has)[^)]*\))*:(?:not\(:)?has\(/gm)].map((m) => `${path.relative(ROOT, f)}: ${m[0].trim()}`))
  check("styles: no :has() on the whole page (:root, html, body)", !pagewide.length, pagewide)
}

{
  const { plainError } = await import("../core/plainerror.ts")
  const said = (e: unknown) => plainError(e).reason
  const http = (status: number, message: string) => Object.assign(new Error(message), { status })
  check("errors: an exception's text is never the reason, and is a bug kept in Errors",
    [new TypeError("Class extends value undefined is not a constructor or null"), new Error("Cannot read properties of undefined (reading 'x')"),
      http(500, "x.map is not a function"), http(400, "Cannot read properties of undefined (reading 'enabled')"), new Error("the server stopped (exit 1)\nat start (server.ts:3:1)"), "", null]
      .every((e) => said(e) === null && plainError(e).bug))
  check("errors: the details keep the exact text", plainError(new TypeError("Class extends value undefined")).detail.includes("TypeError: Class extends value undefined"))
  check("errors: a system call's code and a lost connection read as what to do, not bugs",
    said(new Error("EACCES: permission denied, open '/a/b'")) === "Vaultite isn't allowed to open it" && said(Object.assign(new Error("x"), { code: "ENOSPC" })) === "the disk is full" &&
    said(new TypeError("Failed to fetch")) === "the server didn't answer" && !plainError(new TypeError("Load failed")).bug)
  check("errors: the server's refusals and the app's own messages are shown as written",
    said(http(409, "A file called Plan already exists.")) === "A file called Plan already exists" && said(http(400, "path: a vault file, like {folder}/{name}.md")) !== null && said(new Error("That isn't a web address")) === "That isn't a web address" &&
    said("Error invoking remote method 'setup:create': Error: The vault needs a name") === "The vault needs a name")
}

fs.rmSync(tmp, { recursive: true, force: true })
process.exit(summary("web", t0))
