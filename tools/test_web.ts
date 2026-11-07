// The web app's logic that needs no browser, on Node (`@/` resolves to web/src; server, page and desktop modules stubbed):
// the property editor writes frontmatter exactly like the server, and the editor's merge.   node tools/test_web.ts
import assert from "node:assert"
import fs from "node:fs"
import { registerHooks } from "node:module"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { check, cpuMs, exit, section, summary, tempDir } from "./test/lib.ts"
const t0 = Date.now()

const ROOT = path.dirname(import.meta.dirname)
const WEB = path.join(ROOT, "web", "src")
const STUBS: Record<string, string> = {
  "@/core/data": "export const put = async () => { throw new Error('no server in tools/test_web.ts') }; export const getStore = () => null",
  "@/core/http": "export const put = async () => { throw new Error('no server in tools/test_web.ts') }",
  "@/core/files": "export const readFile = async () => { throw new Error('no server in tools/test_web.ts') }; export const splitFm = () => ({ fm: '', body: '' })",
  "@/core/prefs": "export const getPrefs = () => ({ disabled: [] })",
  "@/core/appearance": "export const onLook = () => () => {}",
  "@/core/desktop": "export const webPages = null; export const keyboardTakes = () => 0; export const pageTakenSince = () => null",
  "@/core/live": "export const answerUi = (kind, fn) => { (globalThis.__answerUi ??= {})[kind] = fn }",
  "@/core/pagelock": "export const relockScroll = () => {}",
}
// Autosave's server, reads, toasts and connection: the made-up ones its section sets on globalThis.__autosave.
const AUTOSAVE_STUBS: Record<string, string> = {
  "@/core/http": "const f = () => globalThis.__autosave; export const request = (...a) => f().request(...a); export const get = (p) => f().get(p); export const post = async (p, b) => { globalThis.__autosave.posts?.push([p, b]); return {} }; export const put = (p, b) => f().putJson(p, b)",
  "@/core/files": `export const deletedHere = () => false; export const gone = (e) => /^Error: no file /.test(String(e)); export const moveMark = () => 0; export const whereNow = (p) => p
    export const readFile = (p) => globalThis.__autosave.readFile(p); export const stem = (p) => p.replace(/^.*\\//, "").replace(/\\.md$/, "")
    export const splitFm = (t) => { const m = /^---\\n[\\s\\S]*?\\n---\\n/.exec(t); return m ? { fm: m[0], body: t.slice(m[0].length) } : { fm: "", body: t } }`,
  "@/core/live": "export const useVaultChange = () => {}; export const onReconnect = (fn) => { globalThis.__autosave.back.add(fn); return () => globalThis.__autosave.back.delete(fn) }",
  "@/core/notify": "export const errorReason = (e) => e?.message ?? null; export const notify = (text) => { globalThis.__autosave.toasts.push(text) }",
  "@/core/drafts": "export const keepDraft = () => {}; export const dropDraft = () => {}",
}
// Co-typing's socket, editors and app (plugins/core/companion/cotype.ts): the made-up ones on globalThis.__cotype, its
// hold on a note the app's own (core/cosync.ts, as autosave has it).
const COTYPE_STUBS: Record<string, string> = {
  "./live": `const f = () => globalThis.__cotype; export const getState = () => f().state; export const say = (m) => f().say(m)
    export const setPeople = () => {}; export const setRooms = (r) => { f().rooms = r }; export const subscribe = (fn) => { f().subs.add(fn); return () => f().subs.delete(fn) }`,
  "@vaultite": `export { keepLive } from ${JSON.stringify(pathToFileURL(path.join(WEB, "core", "cosync.ts")).href)}
    export { merge3 } from ${JSON.stringify(pathToFileURL(path.join(ROOT, "core", "textedit.ts")).href)}
    export const notify = () => {}; export const settleFile = (p) => globalThis.__cotype.settleFile(p)`,
  "@codemirror/view": "export const ViewPlugin = { define: (create) => ({ create }) }; export const EditorView = { scrollIntoView: () => null }",
  "y-codemirror.next": "export const ySyncAnnotation = {}; export const yCollab = (ytext) => ({ ytext })",
  "./text": `export * from ${JSON.stringify(pathToFileURL(path.join(ROOT, "plugins", "core", "companion", "text.ts")).href)}`,
}
// (plugins import the app as "@vaultite": here, only what their editing commands use)
const shim = path.join(tempDir("vau-shim-"), "vaultite.ts")
fs.writeFileSync(shim, `export { blockPieces, paragraphAt } from ${JSON.stringify(pathToFileURL(path.join(WEB, "core", "highlights.ts")).href)}
export { joinText } from ${JSON.stringify(pathToFileURL(path.join(ROOT, "core", "dictationtext.ts")).href)}`)
registerHooks({
  resolve(spec, context, next) {
    if (spec in COTYPE_STUBS && context.parentURL?.endsWith("/plugins/core/companion/cotype.ts")) return { url: `data:text/javascript,${encodeURIComponent(COTYPE_STUBS[spec])}`, shortCircuit: true }
    if (spec === "@vaultite") return { url: pathToFileURL(shim).href, shortCircuit: true }
    if (spec in AUTOSAVE_STUBS && context.parentURL?.endsWith("/web/src/core/autosave.ts")) return { url: `data:text/javascript,${encodeURIComponent(AUTOSAVE_STUBS[spec])}`, shortCircuit: true }
    if (spec in STUBS) return { url: `data:text/javascript,${encodeURIComponent(STUBS[spec])}`, shortCircuit: true }
    if (spec.startsWith("@/")) {
      const base = path.join(WEB, spec.slice(2))
      const file = [".ts", ".tsx", ""].map((x) => base + x).find((f) => fs.existsSync(f) && fs.statSync(f).isFile())
      if (file) return { url: pathToFileURL(file).href, shortCircuit: true }
    }
    // A relative import without its extension, the way Vite resolves it (core/markdown.ts -> ./richmd).
    if (spec.startsWith(".") && !/\.[a-z]+$/i.test(spec) && context.parentURL?.startsWith(pathToFileURL(WEB).href)) {
      const base = path.resolve(path.dirname(fileURLToPath(context.parentURL)), spec)
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

const tmp = tempDir("vaultite-web-")
const VAULT = path.join(tmp, "vault")
fs.mkdirSync(VAULT)
process.env.VAULTITE_VAULT = VAULT
process.env.VAULTITE_LOCAL = path.join(tmp, "local")
const { loadFm } = await import("../core/frontmatter.ts")
{
  const { linksIn, mapLinks, relativePath, resolvePath } = await import("../core/links.ts")
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

{
  // A save's edit (core/texthash.ts): made on its base, it's the text, whatever the two share or don't.
  const { editOf, applyEdit } = await import("../core/texthash.ts")
  const pairs = [["", ""], ["", "abc"], ["abc", ""], ["aaa", "aa"], ["abcabc", "abc"], ["one two", "one 2 two"], ["x😀y", "x😃y"], ["same", "same"]]
  const bad = pairs.filter(([a, b]) => applyEdit(a, editOf(a, b)) !== b)
  check("save edits: an edit made on its base is the text", !bad.length && editOf("a long line", "a longer line").add === "er", bad)
  check("save edits: one that doesn't fit is none", applyEdit("abc", { at: 2, cut: 5, add: "" }) === null && applyEdit("abc", { at: 1 }) === null)
}

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
  // (its CPU time, which a busy machine doesn't stretch: a quadratic diff takes minutes here)
  const { value: ops, ms: took } = cpuMs(() => diffLines(big, edited))
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
  check("csv: a repeated column name is numbered, both values kept", same(csv.csvRecords("n,Tags,Tags,Tags\nA,x,y,z\n"), [{ n: "A", Tags: "x", "Tags 2": "y", "Tags 3": "z" }]))
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

// ---------- File names from titles: ones every system (Windows too, where a vault may sync) can have ----------
{
  const { safeName } = await import(pathToFileURL(path.join(ROOT, "core", "vault.ts")).href)
  const pairs = [["CON", "CON_"], ["nul.md", "nul.md_"], ["Notes...", "Notes"], ["a: b?", "a - b"], ["Trip. ", "Trip"], ["\u0007Bell", "Bell"],
    ["COM1 plan", "COM1 plan"], ["", "Untitled"]]
  const off = pairs.filter(([t, want]) => safeName(t) !== want)
  check("names: no Windows device name, trailing dot or control character", !off.length, off.map(([t]) => [t, safeName(t)]))
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
  const cells = md.renderMarkdown("| Key | How |\n| :-- | --- |\n| `wide: true` | The block takes the whole row, under the one before it |")
  check("markdown: a short table cell is marked to stay on one line, a long one isn't",
    cells.includes('<th align="left" class="md-cell-short">Key</th>') && cells.includes('<td align="left" class="md-cell-short"><code>wide: true</code></td>') &&
    cells.includes("<td>The block takes"), cells)
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
  const unclosed = cpuMs(() => hl.highlightSpans("==x\n".repeat(20000)))
  check("highlights: unclosed openers are one linear pass", unclosed.value.length === 0 && unclosed.ms < 100, unclosed.ms)
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

// A .csv changed a field at a time (plugins/core/tables/csvedit.ts): the rest of its text as it was.
{
  const ce = await import(pathToFileURL(path.join(ROOT, "plugins", "core", "tables", "csvedit.ts")).href)
  const src = '\ufeffa;b;c\r\n1;"x; y";3\r\n4;5\r\n'
  check("csv: a field changed alone, quoting, separator, BOM and CRLF kept", ce.setCell(src, 1, 1, "x; z") === '\ufeffa;b;c\r\n1;"x; z";3\r\n4;5\r\n'
    && ce.setCell(src, 2, 0, 'say "hi"') === '\ufeffa;b;c\r\n1;"x; y";3\r\n"say ""hi""";5\r\n' && ce.setCell(src, 2, 2, "6") === '\ufeffa;b;c\r\n1;"x; y";3\r\n4;5;6\r\n',
    [ce.setCell(src, 1, 1, "x; z"), ce.setCell(src, 2, 0, 'say "hi"'), ce.setCell(src, 2, 2, "6")])
  check("csv: a row added, after a last line without its break", ce.addRow("a,b\n1,2", 2) === "a,b\n1,2\n,\n" && ce.addRow("a,b\r\n", 2) === "a,b\r\n,\r\n", [ce.addRow("a,b\n1,2", 2), ce.addRow("a,b\r\n", 2)])
}

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
  const g = tt.parseTable("|a|b|c|d|e|\n|-|-|-|-|-|\n|1|2||4|5|\n|x|||y||")!
  const at = (r: number, c: number, dr: number, dc: number) => { const e = tt.edgeFrom(g, { r, c }, dr, dc); return `${e.r},${e.c}` }
  check("tables: ⌘ arrows go to the end of a run of filled cells, from a blank to the next filled, else the edge",
    at(1, 0, 0, 1) === "1,1" && at(1, 1, 0, 1) === "1,3" && at(1, 3, 0, 1) === "1,4" && at(1, 4, 0, 1) === "1,4" && at(2, 1, 0, 1) === "2,3" && at(2, 3, 0, 1) === "2,4"
    && at(0, 0, 1, 0) === "2,0" && at(2, 0, -1, 0) === "0,0" && at(0, 2, 1, 0) === "2,2",
    [at(1, 0, 0, 1), at(1, 1, 0, 1), at(1, 3, 0, 1), at(1, 4, 0, 1), at(2, 1, 0, 1), at(2, 3, 0, 1), at(0, 0, 1, 0), at(2, 0, -1, 0), at(0, 2, 1, 0)])
  const dup = tt.parseTable("|a|b|\n|-|-|\n|1|x|\n|2|y|")!
  tt.duplicateRow(dup, 1); tt.duplicateRow(dup, 0)
  check("tables: a row duplicated under it, never the header", tt.writeTable(dup) === "|a|b|\n|-|-|\n|1|x|\n| 1 | x |\n|2|y|", tt.writeTable(dup))
  const fd = tt.parseTable("|a|b|\n|-|-|\n|1|x|\n|2|y|\n|3|z|")!
  const down = (a: [number, number], h: [number, number]) => { const t = tt.parseTable(tt.writeTable(fd))!; const ok = tt.fillDown(t, { r: a[0], c: a[1] }, { r: h[0], c: h[1] }); return ok ? tt.writeTable(t).split("\n").slice(2).join(";") : "no" }
  check("tables: ⌘D fills down from the selection's top row; one row from the row above, never the header",
    down([1, 0], [3, 0]) === "|1|x|;| 1 | y |;| 1 | z |" && down([3, 1], [3, 1]) === "|1|x|;|2|y|;| 3 | y |" && down([1, 0], [1, 1]) === "no",
    [down([1, 0], [3, 0]), down([3, 1], [3, 1]), down([1, 0], [1, 1])])
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
// Column widths in the separator's dashes, as Pandoc reads them; a table written the usual ways has none.
{
  const long = "x".repeat(90)
  const usual = ["|a|b|\n|---|---|\n|1|2|", "| a | b |\n| --- | :-: |\n| 1 | 2 |", `| Name | Note |\n| ---- | ${"-".repeat(90)} |\n| Pear | ${long} |`,
    `| ${"h".repeat(40)} | ${"k".repeat(40)} |\n|${"-".repeat(42)}|${"-".repeat(42)}|\n| 1 | 2 |`, `|a|\n|${"-".repeat(80)}|\n|1|`]
  for (const src of usual) {
    const t = tt.parseTable(src)!
    check(`tables: no widths, written as it was (${JSON.stringify(src.slice(0, 30))})`, t.widths === null && tt.columnShares(t) === null && tt.writeTable(t) === src, t.widths)
  }
  const sep = `|${"-".repeat(20)}|${"-".repeat(59)}:|`
  const set = tt.parseTable(`| Name | Qty |\n${sep}\n| pear | 10 |`)!
  check("tables: a separator past 72 columns sets the columns' widths", same(set.widths, [20, 60]) && Math.abs(tt.columnShares(set)![0] - 0.25) < 1e-9, set.widths)
  set.rows[1].cells[0] = "Apple"
  check("tables: editing a cell keeps them", tt.writeTable(set).split("\n")[1] === sep, tt.writeTable(set))
  tt.insertColumn(set, 2); set.rows[0].cells[2] = "When"
  const grown = tt.writeTable(set).split("\n")[1]
  check("tables: a new column gets the others' average, alignment kept", /^\|-+\|-+:\|-+\|$/.test(grown) && same(tt.parseTable(tt.writeTable(set))!.widths, [13, 40, 27]), grown)
  tt.moveColumn(set, 0, 2)
  check("tables: a moved column takes its width along", same(tt.parseTable(tt.writeTable(set))!.widths, [40, 27, 13]), tt.writeTable(set))
  tt.setWidths(set, [1, 1, 2])
  const out = tt.writeTable(set)
  check("tables: widths set are written in the separator, scaled to 80 dashes", out.split("\n")[1] === `|${"-".repeat(19)}:|${"-".repeat(20)}|${"-".repeat(40)}|` && same(tt.parseTable(out)!.widths, [20, 20, 40]), out)
  tt.setWidths(set, null)
  check("tables: and back to as wide as their text", tt.writeTable(set).split("\n")[1] === "|--:|---|---|" && tt.parseTable(tt.writeTable(set))!.widths === null, tt.writeTable(set))
  const padded = tt.parseTable("| Name  | Qty |\n| ----- | --- |\n| Apple | 3   |")!
  tt.setWidths(padded, [3, 1])
  check("tables: a padded table given widths keeps its rows as they were", tt.writeTable(padded) === `| Name  | Qty |\n|${"-".repeat(60)}|${"-".repeat(20)}|\n| Apple | 3   |`, tt.writeTable(padded))
  tt.deleteColumn(padded, 1)
  check("tables: one column left has no widths", padded.widths === null && tt.writeTable(padded).split("\n")[1] === "|---|", tt.writeTable(padded))
  // Read as Pandoc reads them: dashes and colons past 72 with the pipes; spaces don't count.
  const spaced = tt.parseTable(`| a | b | c |\n| ${"-".repeat(22)} | ${"-".repeat(22)} | ${"-".repeat(22)} |\n| 1 | 2 | 3 |`)!
  check("tables: a separator long only by its spaces sets no widths", spaced.widths === null, spaced.widths)
  const cjk = "東京".repeat(20), cjkPad = tt.parseTable(`| City | Note |\n| ${"-".repeat(40)} | ${"-".repeat(40)} |\n| ${cjk} | ${"n".repeat(40)} |`)!
  check("tables: padded by a formatter counting a wide character as one column, no widths", cjkPad.widths === null, cjkPad.widths)
  const byHead = tt.parseTable(`| ${"Name ".repeat(8).trim()} | ${"Description ".repeat(3).trim()} |\n| ${"-".repeat(39)} | ${"-".repeat(35)} |\n| a | ${"b".repeat(50)} |`)!
  check("tables: dashes as long as each header, no widths", byHead.widths === null, byHead.widths)
  // Pandoc's own pipe table (writer: floor(share * (72 - cols - 1)) + 2 dashes, its rows too long to pad)
  const pd = tt.parseTable(`| Name | Notes |\n|${"-".repeat(22)}|${"-".repeat(50)}|\n| Pear | ${"word ".repeat(16).trim()} |`)!
  check("tables: a table Pandoc wrote with widths has them", same(pd.widths, [22, 50]), pd.widths)
  // (dashes set that happen to be each column's text as wide: one more, so they still read as set)
  const fits = tt.parseTable(`| ${"x".repeat(40)} | ${"y".repeat(38)} |\n|---|---|\n| 1 | 2 |`)!
  tt.setWidths(fits, [1, 1])
  check("tables: widths that match the text still read as set", same(tt.parseTable(tt.writeTable(fits))!.widths?.length, 2), tt.writeTable(fits))
  // Drawn outside the editor (a dashboard's text, an embed): the same widths, in a box that scrolls.
  const drawnSet = md.renderMarkdown(`| Name | Qty |\n${sep}\n| pear | 10 |\n`), drawnUsual = md.renderMarkdown(usual[1])
  check("tables: Markdown drawn elsewhere draws set widths", drawnSet.startsWith('<div class="md-table-view"><table class="has-widths" style="min-width: ')
    && drawnSet.includes('<colgroup><col style="width: 25.000%"><col style="width: 75.000%"></colgroup>') && drawnSet.includes('<td align="right"'), drawnSet)
  check("tables: and others as they were", drawnUsual.startsWith("<table>\n<thead>") && !drawnUsual.includes("colgroup"), drawnUsual)
  const inList = md.renderMarkdown(`- item\n\n  | Name | Qty |\n  ${sep}\n  | pear | 10 |\n`)
  check("tables: a table in a list item keeps its widths", inList.includes("has-widths"), inList)
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
  check("paste: rows as a Markdown table, pipes and line breaks escaped", tp.markdownTable([["a", "b|c"], ["1", "x\ny"]]) === "| a | b\\|c |\n| --: | --- |\n| 1 | x<br>y |", tp.markdownTable([["a", "b|c"], ["1", "x\ny"]]))
  const page = '<table><tr><th>Name</th><th>Site</th></tr><tr><td><b>Lighthouse </b>keeper</td><td><a href="https://example.com/a(b)">the <em>site</em></a></td></tr><tr><td><s>old</s> <code>x</code></td><td><a href="https://example.com">https://example.com</a></td></tr></table>'
  check("paste: a page's table keeps its emphasis, code and links as Markdown", same(tp.pastedTable("", page), [["Name", "Site"], ["**Lighthouse** keeper", "[the *site*](https://example.com/a%28b%29)"], ["~~old~~ `x`", "https://example.com"]]), tp.pastedTable("", page))
  const boldBody = '<google-sheets-html-origin><table><tr><td style="font-weight:bold;">Name</td><td style="font-weight:bold;">Site</td></tr><tr><td style="font-weight:bold;">Total</td><td><a href="https://example.com">Report</a></td></tr></table>'
  check("paste: a spreadsheet's bold header row as the header, a bold cell and a link below it as Markdown", same(tp.pastedTable("Name\tSite\nTotal\tReport", boldBody), [["Name", "Site"], ["**Total**", "[Report](https://example.com)"]]), tp.pastedTable("Name\tSite\nTotal\tReport", boldBody))
  check("paste: a table's columns of numbers aligned right", tp.markdownTable([["Item", "Qty", "Cost"], ["pear", "10", "$1.50"], ["fig", "", "12%"], ["kiwi", "3", "n/a"]]).split("\n")[1] === "| --- | --: | --- |",
    tp.markdownTable([["Item", "Qty", "Cost"], ["pear", "10", "$1.50"], ["fig", "", "12%"], ["kiwi", "3", "n/a"]]))
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
const styled = md.renderMarkdown('<div style="color: red; posit\\69on:fixed;ins\\65t:0;z-ind\\65x:99999;/**/top:0;left/**/:0;background:u\\72l(https://x.test)">x</div>\n', vopts)
check("markdown: raw HTML's style keeps no declaration written with CSS escapes or comments", styled.includes('<div style="color: red">x</div>'), styled)
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
  // A note typed in (its body long): only the edit of its body travels, the rest of it the same objects.
  const long = structuredClone(st0)
  for (const n of long.notes) n.body = `${n.title}: ${"words of a long note body. ".repeat(80)}`
  const next = structuredClone(long)
  next.notes[3].body = next.notes[3].body.replace("words of", "words typed into")
  next.notes[9] = { ...next.notes[9], id: "Notes/Other", body: next.notes[9].body + "!" }
  const [got, patch] = through(long, next), g = got as typeof long
  check("state patch: a long body edited travels as its edit, another item with its id changed whole", deep(got, next) && !!patch &&
    patch.length < 3000 && patch.includes('"edit":') && patch.includes("Notes/Other") && g.notes[3].tags === long.notes[3].tags, patch?.slice(0, 300))
  let ok = true, cur: unknown = long, seed = 3
  const rnd = (n: number) => (seed = (seed * 1103515245 + 12345) % 2147483648) % n
  for (let round = 0; round < 100 && ok; round++) {
    const nx = structuredClone(cur) as typeof long, n = nx.notes[rnd(nx.notes.length)], at = rnd(n.body.length)
    n.body = n.body.slice(0, at) + "é😀x".slice(0, rnd(4)) + n.body.slice(at + rnd(5))
    const [g2] = through(cur, nx)
    ok = deep(g2, nx)
    cur = g2
  }
  check("state patch: 100 rounds of random edits to long bodies", ok)
  check("state patch: an edit that doesn't fit what the app has throws", (() => { try { sp.applyPatch("abc", { edit: [5, 1, ""] }); return false } catch { return true } })())
}
{
  // A long list (frozen items, as the tree's rows): one changed, one gone, one added, one moved far, exact all the same.
  const old: Readonly<{ path: string; n: number }>[] = Array.from({ length: 6000 }, (_, i) => Object.freeze({ path: `f${i}.md`, n: i }))
  const next = [...old]
  next[100] = Object.freeze({ path: "f100.md", n: -1 })
  next.splice(2000, 1)
  next.splice(3000, 0, Object.freeze({ path: "new.md", n: 0 }))
  next.push(next.splice(10, 1)[0])
  const [got, patch] = through(old, next)
  check("state patch: a long list's changes come out the same, small", deep(got, next) && !!patch && patch.length < 400, patch?.slice(0, 400))
}
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
  check("newtab: unset reads as nulls; lists read leniently", same(nt.readNewTab(undefined), { sections: null, actions: null, icons: null, page: null, opens: null }) &&
    same(nt.readNewTab({ sections: ["core:actions", 3, "core:actions", ""], actions: "file:new", icons: { "file:new": " star ", "palette:open": 3, x: "" }, page: 3 }),
      { sections: ["core:actions"], actions: null, icons: { "file:new": "star" }, page: null, opens: null }) &&
    nt.readNewTab({ page: " Dashboards/Start.md " }).page === "Dashboards/Start.md")
  check("newtab: `opens` is the switcher, a view's tab or unset (the page, its default, and anything else)", nt.readNewTab({ opens: "switcher" }).opens === "switcher" &&
    nt.readNewTab({ opens: " view:web " }).opens === "view:web" && nt.readNewTab({ opens: "page" }).opens === null && nt.readNewTab({ opens: "file:Notes/A.md" }).opens === null &&
    nt.readNewTab({ opens: "Switcher" }).opens === null)
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

// ---------- tabs: tabs hold panes (core/layout.ts; web/src/core/workspace.ts, splits.ts, tabgroups.ts, drop.ts) ----------

{
  // Just enough of a browser for the tabs: the address, its history, a phone's or a computer's width, what's saved.
  let desktop = true
  const g = globalThis as Any
  const mem = new Map<string, string>()
  g.location = { hash: "", search: "", pathname: "/" }
  g.history = { state: null, pushState(st: unknown, _: string, h: string) { this.state = st; g.location.hash = h }, replaceState(st: unknown, _: string, h?: string) { this.state = st; if (h) g.location.hash = h } }
  g.matchMedia = () => ({ matches: desktop })
  g.localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem() {} }
  g.addEventListener = () => {}
  g.requestAnimationFrame = () => 0
  g.document = { addEventListener() {}, activeElement: null, querySelector: () => null, documentElement: { dataset: {} } }
  g.CSS = { escape: (s: string) => s, supports: () => false }
  g.dispatchEvent = () => true
  g.HashChangeEvent = class { type: string; constructor(type: string) { this.type = type } }
  const ws: Any = await web("core/workspace.ts")
  const sp: Any = await web("core/splits.ts")
  const gr: Any = await web("core/tabgroups.ts")
  const dr: Any = await web("core/drop.ts")
  const tev: Any = await web("core/tabevents.ts")
  const lay: Any = await web("../../core/layout.ts")
  const tid = await import("../core/terminalids.ts")
  check("terminal ids: an agent, its account, a resumed session and a machine read back; a shell is none",
    JSON.stringify(tid.parseTerminal("claude_personal-k3j2h1g0@studio")) === JSON.stringify({ agent: "claude", profile: "personal", resume: null, machine: "studio" })
    && tid.parseTerminal(tid.resumeTerminalId("codex", "0199-abc"))?.resume === "0199-abc" && tid.parseTerminal("k3j2h1g0") === null
    && /^claude_work-[a-z0-9]{8}$/.test(tid.newTerminalId(tid.agentIn("claude", "work"))) && tid.agentIn("claude", "No way") === "claude")
  check("tabs: a target's file, and only a vault one's vault path", lay.tabPath("file:a.md") === "a.md" && lay.tabPath("file:/x/b.pdf") === "/x/b.pdf"
    && lay.tabPath("view:terminal/1") === null && lay.vaultPath("file:a.md") === "a.md" && lay.vaultPath("file:/x/b.pdf") === null && lay.vaultPath("new") === null)

  // A pane showing its file (or `to`); a tab of one pane (its id "t" and the pane's); a split tab; splits.
  type Tb = { id: string; root: Any; focus: string; [k: string]: unknown }
  const pane = (id: string, to = `file:${id}.md`): Any => ({ id, to })
  const TP = (p: Any, extra: Props = {}): Tb => ({ id: `t${p.id}`, root: p, focus: p.id, ...extra })
  const T = (id: string, to?: string, extra: Props = {}) => TP(pane(id, to), extra)
  const S = (id: string, root: Any, focus: string, extra: Props = {}): Tb => ({ id, root, focus, ...extra })
  const row = (id: string, kids: Any[], sizes?: number[]) => ({ id, dir: "row", kids, sizes: sizes ?? kids.map(() => 1 / kids.length) })
  const col = (id: string, kids: Any[], sizes?: number[]) => ({ id, dir: "col", kids, sizes: sizes ?? kids.map(() => 1 / kids.length) })
  // (the tabs it takes away are kept elsewhere: not remembered as closed)
  const put = (tabs: Tb[], active: string, extra: Props = {}) => ws.replaceWorkspace({ tabs, active, ...extra }, { kept: true })
  // The list as "a,[b|c]*,d": each tab's panes (files without ".md"), splits in brackets, the tab on screen starred.
  const short = (to: string) => (to.startsWith("file:") ? to.slice(5).replace(/\.md$/, "") : to)
  const desc = (n: Any): string => (n.kids ? `[${n.kids.map(desc).join(n.dir === "row" ? "|" : "/")}]` : short(n.to))
  const tabs = () => ws.here().tabs.map((t: Tb) => desc(t.root) + (t.id === ws.here().active ? "*" : "")).join(",")
  const focus = () => ws.activePane().id
  const shares = (t: Tb = ws.activeTab()) => t.root.sizes?.map((x: number) => x.toFixed(2)).join(",")
  const tree = (n: Any = ws.activeTab().root): string => (n.kids ? `${n.dir}(${n.kids.map((k: Any, i: number) => `${tree(k)}:${n.sizes[i].toFixed(2)}`).join(" ")})` : n.id)
  const a = pane("a"), b = pane("b"), c = pane("c"), d = pane("d")

  // ---- the model: what's saved read back, and from before tabs held panes ----
  const oldLayout = { root: { id: "s0", dir: "row", sizes: [0.6, 0.4], kids: [
    { id: "gL", active: "a", sets: [{ id: "S", name: "Work", color: "blue" }], tabs: [{ id: "a", to: "file:a.md" }, { id: "b", to: "file:b.md", set: "S", pinned: true, name: "Reading" }] },
    { id: "gR", active: "d", tabs: [{ id: "c", to: "file:c.md" }, { id: "d", to: "file:d.md", back: ["file:x.md"], name: "Desk" }] }] }, focus: "gR", zoom: "gR" }
  const mig = lay.clean(oldLayout), split = mig?.tabs.find((t: Tb) => t.id === "ta")
  check("migration: old tab ids are pane ids, each tab's id \"t\" and its first pane's, the split tab where the focused group's shown tab was",
    mig?.tabs.map((t: Tb) => `${t.id}:${desc(t.root)}`).join() === "tb:b,tc:c,ta:[a|d]" && mig.active === "ta", mig)
  check("migration: the split keeps its sizes, the focus and zoom on the focused group's shown tab, history kept",
    split?.root.id === "s0" && split.root.sizes.join() === "0.6,0.4" && split.focus === "d" && split.zoom === "d" && split.root.kids[1].back?.join() === "file:x.md", split)
  const tb = mig?.tabs[0]
  check("migration: pinned, name and tab group (set) carried; the old groups' sets are the list's groups",
    tb?.pinned === true && tb.name === "Reading" && tb.group === "S" && split?.name === "Desk" && same(mig.groups, [{ id: "S", name: "Work", color: "blue" }]), [tb, mig?.groups])
  check("migration: the same on every device, and read again unchanged", same(lay.clean(oldLayout), mig) && same(lay.clean(JSON.parse(JSON.stringify(mig))), mig))
  const oldFloat = lay.clean({ root: { id: "s1", dir: "row", sizes: [0.5, 0.25, 0.25], kids: [{ id: "gA", tabs: [{ id: "a", to: "file:a.md" }], active: "a" },
    { id: "gM", tabs: [{ id: "m", to: "view:terminal/q" }], active: "m", float: { x: 0.5, y: 0.1, w: 0.4, h: 0.5 } }, { id: "gC", tabs: [{ id: "c", to: "file:c.md" }], active: "c" }] }, focus: "gA", zoom: "gM" })
  check("migration: a floating group's shown tab floats in the split tab; a zoom of a group not focused is dropped",
    oldFloat?.tabs.length === 1 && oldFloat.tabs[0].id === "ta" && same(oldFloat.tabs[0].root.kids[1].float, { x: 0.5, y: 0.1, w: 0.4, h: 0.5 }) && oldFloat.tabs[0].focus === "a"
    && !("zoom" in oldFloat.tabs[0]), oldFloat)
  check("migration: an old layout with no tab is none; with an unknown focus, the first group's", lay.clean({ root: { id: "g0", tabs: [], active: "" } }) === null
    && lay.clean({ root: { id: "s0", dir: "row", kids: [{ id: "g1", tabs: [{ id: "a", to: "file:a.md" }], active: "a" }, { id: "g2", tabs: [{ id: "b", to: "file:b.md" }], active: "b" }] }, focus: "gone" })?.tabs[0].focus === "a")
  const dup = lay.clean({ tabs: [T("a"), { ...T("a"), id: "tz" }, { id: "te", root: { kids: [] }, focus: "" }], active: "tz" })
  check("reading: a pane in two tabs stays in the first, a tab with no pane goes, the active one falls back to the first",
    dup?.tabs.map((t: Tb) => t.id).join() === "ta" && dup.active === "ta", dup)

  // What older versions kept on this device (workspace.ts' older()), and its closed tabs, read by a fresh copy of the module.
  let freshN = 0
  const fresh = async (saved: unknown, closed?: unknown, popout = "") => {
    mem.clear(); mem.set("vaultite.tabs", JSON.stringify(saved))
    if (closed) mem.set(`vaultite.tabs.closed${popout ? `.${popout}` : ""}`, JSON.stringify(closed))
    g.location.search = popout ? `?popout=${popout}` : ""
    const m: Any = await import(`${pathToFileURL(path.join(WEB, "core", "workspace.ts")).href}?fresh=${++freshN}`)
    mem.clear(); g.location.search = ""
    return m
  }
  const listOf = (m: Any) => m.here().tabs.map((t: Tb) => desc(t.root) + (t.id === m.here().active ? "*" : "")).join(",")
  const one = await fresh({ tabs: [{ id: "a", to: "file:a.md" }, { id: "b", to: "file:b.md" }], active: "b" })
  check("older saves: one pane's tabs ({tabs, active}) are tabs of one pane each", listOf(one) === "a,b*" && one.here().tabs.map((t: Tb) => t.id).join() === "ta,tb", listOf(one))
  const twoSaved = await fresh({ groups: [{ id: "gL", tabs: [{ id: "a", to: "file:a.md" }], active: "a" }, { id: "gR", tabs: [{ id: "b", to: "file:b.md" }, { id: "c", to: "file:c.md" }], active: "c" }], split: 0.3 })
  check("older saves: a main pane and a right split ({groups, split}) are one split tab at those sizes, the rest tabs of their own",
    listOf(twoSaved) === "[a|c]*,b" && shares(twoSaved.activeTab()) === "0.70,0.30", [listOf(twoSaved), shares(twoSaved.activeTab())])
  const grouped = { tabs: [T("a", undefined, { group: "g" }), T("b", undefined, { group: "g" }), S("tx", row("s0", [c, d]), "d"), T("e")],
    groups: [{ id: "g", name: "Work", color: "blue", collapsed: true }], active: "te" }
  const groupedSaved = await fresh(grouped)
  check("saves: a list with tab groups (its `groups`, not the old {groups, split}) loads back as itself", same(groupedSaved.here(), grouped), groupedSaved.here())
  const rooted = await fresh(oldLayout, [{ tab: { id: "x", to: "file:x.md" }, at: 1, closed: 5 }, { pane: { tabs: [{ id: "y", to: "file:y.md" }, { id: "z", to: "file:z.md" }] }, closed: 6 }])
  check("older saves: a layout of groups in splits migrates; closed tabs and panes of tabs saved then reopen as tabs",
    listOf(rooted) === "b,c,[a|d]*" && rooted.closedTabs().map((r: Any) => `${r.id}:${r.closed}`).join() === "tz:6,ty:6,tx:5", [listOf(rooted), rooted.closedTabs()])
  // A pop-out keeps its own list in the workspace; the main window keeps its own and which pop-outs there are.
  const pop = await fresh({ tabs: [T("a")], active: "ta", windows: [{ id: "w1", tabs: [T("p")], active: "tp" }] }, undefined, "w1")
  const theirs = { tabs: [T("a"), T("b")], active: "tb", windows: [{ id: "w1", tabs: [T("q")], active: "tq" }, { id: "w2", tabs: [T("r")], active: "tr" }] }
  const popMine = pop.mineInto(theirs)
  check("pop-out: its own list is what it shows; saved, it puts that into the workspace, the other windows' as they are",
    listOf(pop) === "p*" && popMine.tabs.map((t: Tb) => t.id).join() === "ta,tb" && popMine.windows.map((w: Any) => `${w.id}:${w.tabs.map((t: Tb) => t.id).join()}`).join() === "w1:tp,w2:tr", popMine)
  put([T("a"), T("c")], "ta", { windows: [{ id: "w1", tabs: [T("p")], active: "tp" }] })
  const mainMine = ws.mineInto(theirs)
  check("pop-out: the main window saving puts its own tabs in, the pop-outs it has with their own lists",
    mainMine.tabs.map((t: Tb) => t.id).join() === "ta,tc" && mainMine.windows.map((w: Any) => `${w.id}:${w.tabs.map((t: Tb) => t.id).join()}`).join() === "w1:tq", mainMine)

  // ---- tabs and panes leaving: what shows next ----
  const L = (ids: string[], active: string, extra: Props = {}) => ({ tabs: ids.map((x) => T(x)), active: `t${active}`, ...extra })
  check("closing: the tab shown, gone, hands over to the nearest after it, else before it; others going leave it shown",
    lay.withoutTabs(L(["a", "b", "c"], "b"), new Set(["tb"])).active === "tc" && lay.withoutTabs(L(["a", "b", "c"], "c"), new Set(["tc"])).active === "tb"
    && lay.withoutTabs(L(["a", "b", "c", "d"], "b"), new Set(["tb", "tc"])).active === "td" && lay.withoutTabs(L(["a", "b", "c"], "a"), new Set(["tc"])).active === "ta"
    && lay.withoutTabs(L(["a"], "a"), new Set(["ta"])) === null)
  // [x] (A: a1 a2) (B folded: b1 b2) c, as Chrome's tab strip picks the next.
  const G = (active: string) => ({ active: `t${active}`, groups: [{ id: "A", name: "", color: "blue" }, { id: "B", name: "", color: "red", collapsed: true }],
    tabs: [T("x", "new"), T("a1", undefined, { group: "A" }), T("a2", undefined, { group: "A" }), T("b1", undefined, { group: "B" }), T("b2", undefined, { group: "B" }), T("c")] })
  const after = (active: string, ...ids: string[]) => lay.withoutTabs(G(active), new Set(ids.map((x) => `t${x}`))).active.slice(1)
  check("closing in a tab group: another of its tabs (after, else before); its last, the nearest outside it, never into a folded group",
    after("a1", "a1") === "a2" && after("a2", "a2") === "a1" && after("a2", "a1", "a2") === "c" && after("c", "c") === "a2", [after("a1", "a1"), after("a2", "a2"), after("a2", "a1", "a2"), after("c", "c")])
  const lastGroup = lay.withoutTabs(G("c"), new Set(["tx", "ta1", "ta2", "tc"]))
  check("closing: with only folded groups left, the nearest, whose group opens", lastGroup.active === "tb2" && !lastGroup.groups[0].collapsed, lastGroup)
  const three = S("tx", row("s", [a, b, c], [0.25, 0.5, 0.25]), "b")
  const left = lay.tabWithout(three, new Set(["b"]))
  check("closing: a pane closed in a split, the focus goes to the pane after it, else before it; the last one gone, the tab is none",
    left?.focus === "c" && desc(left.root) === "[a|c]" && lay.tabWithout({ ...three, focus: "c" }, new Set(["c"]))?.focus === "b"
    && lay.tabWithout(three, new Set(["a", "b", "c"])) === null, left)
  const sub = lay.withoutPanesIn(row("s", [a, col("c2", [b, c]), d], [0.25, 0.5, 0.25]), new Set(["b", "c"]))
  const flGone = lay.withoutPanesIn(row("s", [a, { ...b, float: { x: 0, y: 0, w: 0.5, h: 0.5 } }, c], [0.25, 0.5, 0.25]), new Set(["b"]))
  check("closing: a whole split's panes at once, its room goes to the part before it; a floating one's, nowhere (the tiled ones keep theirs)",
    desc(sub) === "[a|d]" && sub.sizes.join() === "0.75,0.25" && desc(flGone) === "[a|c]" && flGone.sizes.join() === "0.5,0.5", [sub, flGone])
  const lp = lay.withoutPanes({ tabs: [three, T("d")], active: "tx" }, new Set(["a", "b", "c"]))
  check("closing: a tab left with no panes goes, the next shown", lp?.tabs.map((t: Tb) => t.id).join() === "td" && lp.active === "td", lp)

  // ---- a tab's splits, pure (layout.ts) ----
  // [a | [b / c]] with a a quarter wide.
  const grid: Any = row("s", [a, col("c2", [b, c])], [0.25, 0.75])
  const sw = lay.swapped(grid, "a", "c")
  check("panes: swapping two puts each in the other's place, the same objects, the sizes staying with the places",
    desc(sw) === "[c|[b/a]]" && sw.kids[0] === c && sw.sizes.join() === "0.25,0.75" && lay.swapped(grid, "a", "x") === grid, desc(sw))
  const near = (x: number, y: number) => Math.abs(x - y) < 1e-9
  const r1 = lay.nudged(grid, "a", "right", 0.05, 0.1), r2 = lay.nudged(grid, "a", "left", 0.05, 0.1)
  check("panes: resizing moves the divider on that side that way (by a share of the whole), else the one on the other side",
    near(r1.sizes[0], 0.3) && near(r2.sizes[0], 0.2) && near(lay.nudged(grid, "b", "left", 0.05, 0.1).sizes[0], 0.2), [r1.sizes, r2.sizes])
  const r3 = lay.nudged(grid, "b", "bottom", 0.075, 0.1), r4 = lay.nudged(grid, "c", "bottom", 0.075, 0.1)
  check("panes: … in the split it's in, the step a share of the whole (its split is the whole height here); its neighbour's edge too",
    near(r3.kids[1].sizes[0], 0.575) && near(r4.kids[1].sizes[0], 0.575) && near(lay.nudged(grid, "b", "top", 0.075, 0.1).kids[1].sizes[0], 0.425), [r3.kids[1].sizes, r4.kids[1].sizes])
  check("panes: … never past a part's least size, and nothing without a divider that way",
    near(lay.nudged(grid, "a", "left", 0.5, 0.1).sizes[0], 0.1) && lay.nudged(a, "a", "left", 0.05, 0.1) === a && lay.nudged(grid, "a", "top", 0.05, 0.1) === grid)
  const evAll = lay.evenedAll({ ...grid, kids: [grid.kids[0], { ...grid.kids[1], sizes: [0.8, 0.2] }] })
  check("panes: evening them out makes every split's parts equal", evAll.sizes.join() === "0.5,0.5" && evAll.kids[1].sizes.join() === "0.5,0.5", evAll)
  // Zoom (Tab.zoom) and floating panes (Pane.float): out of the tiling, their spot kept for docking back.
  const fl = { x: 0.05, y: 0.1, w: 0.3, h: 0.5 }
  const row3 = (fB?: Any) => row("s0", [pane("a"), { ...pane("b"), ...(fB ? { float: fB } : {}) }, pane("c")], [0.25, 0.5, 0.25])
  const lo = lay.layout(row3(fl)), w2 = (r: Any) => r.w.toFixed(2)
  check("float: out of the tiling, the tiled ones share its room as they shared theirs; one divider between them",
    lo.panes.map((p: Any) => `${p.pane.id}:${w2(p.rect)}`).join() === "a:0.50,c:0.50" && lo.floats[0]?.pane.id === "b" && same(lo.floats[0].rect, fl)
    && lo.dividers.length === 1 && lo.dividers[0].i === 0 && lo.dividers[0].at.toFixed(2) === "0.50", lo)
  const rs = lay.resized(row3(fl), "s0", 0, 0.3, 0.05), ev = lay.evened(rs, "s0")
  check("float: a divider dragged or evened out moves the tiled ones only; it keeps its share for docking",
    lay.layout(rs).panes.map((p: Any) => w2(p.rect)).join() === "0.30,0.70" && rs.sizes[1] === 0.5 && lay.layout(ev).panes.map((p: Any) => w2(p.rect)).join() === "0.50,0.50" && ev.sizes[1] === 0.5,
    [rs.sizes, ev.sizes])
  check("float: docked, back in its spot at its share", same(lay.floated(row3(fl), "b", null), row3()))
  const savedFloat = (f: unknown) => lay.clean({ tabs: [S("tx", row("s0", [pane("a"), { ...pane("b"), float: f }]), "a")], active: "tx" }).tabs[0].root.kids[1].float
  check("float: a saved one is kept inside the workspace; one that isn't a place is dropped",
    same(savedFloat({ x: 0.9, y: -1, w: 0.5, h: 2 }), { x: 0.5, y: 0, w: 0.5, h: 1 }) && savedFloat({ x: "1" }) === undefined)
  check("float: directional focus from it goes to the tiled pane past its edge", lay.neighbourOf(row3({ ...fl, x: 0.1 }), "b", "right")?.id === "c"
    && lay.neighbourOf(row3(fl), "b", "left") === null)
  const st = (root: Any, f: string, zoom?: string) => lay.settledTab({ id: "tx", root, focus: f, ...(zoom ? { zoom } : {}) })
  check("settled: with every pane floating they dock; the focus on one of its panes; a zoom only on the focused pane, tiled, beside others",
    !lay.leaves(st({ ...pane("a"), float: fl }, "a").root).some((p: Any) => p.float) && st(row3(), "gone").focus === "a"
    && st(row3(), "a", "c").zoom === undefined && st(row3(), "a", "a").zoom === "a"
    && st(row3(fl), "b", "b").zoom === undefined && st(pane("a"), "a", "a").zoom === undefined)

  // ---- blank tabs are never left behind ----
  const N = T("n", "new")
  put([T("a"), N], "tn"); ws.go("file:a.md")
  check("tabs: opening what another tab has from a blank tab closes the blank one", tabs() === "a*", tabs())
  put([T("a"), N], "tn"); ws.go("view:terminals", true)
  check("tabs: asked for a new tab from a blank tab, it opens in the blank one", tabs() === "a,view:terminals*", tabs())
  put([T("a"), N], "tn"); ws.go("file:a.md", true)
  check("tabs: asked for a new tab of what another tab has, from a blank tab: that tab, no copy", tabs() === "a*", tabs())
  put([T("a"), T("b")], "tb"); ws.go("file:a.md", true)
  check("tabs: asked for a new tab from a tab with something, it still gets one", tabs() === "a,b,a*", tabs())
  put([T("a"), N], "tn"); g.location.hash = "#file/a.md"; ws.followHash("file/a.md")
  check("tabs: a link from a blank tab to what another tab has closes the blank one", tabs() === "a*", tabs())
  put([T("a"), N], "tn"); ws.selectTab("ta")
  check("tabs: switching away from a blank tab by hand keeps it", tabs() === "a*,new", tabs())
  put([T("a")], "ta"); ws.newTab(); ws.selectTab("ta"); ws.newTab(); ws.newTab()
  check("tabs: New tab never makes a second blank tab", tabs() === "a,new*", tabs())
  put([S("tx", row("s0", [a, pane("n", "new")]), "n")], "tx"); ws.go("file:a.md")
  check("tabs: a split's blank pane stays when what's opened is in the split (the split is the user's)", tabs() === "[a|new]*" && focus() === "a", tabs())
  put([S("tx", row("s0", [a, pane("n", "new")]), "n")], "tx"); ws.go("file:z.md")
  check("tabs: … and takes what's opened from it", tabs() === "[a|z]*" && focus() === "n", tabs())
  put([S("tx", row("s0", [a, pane("n", "new")]), "n")], "tx"); sp.openAt("file:b.md", "n", "center")
  check("tabs: a file dropped into a blank pane's middle takes its place, the blank one not in its history", tabs() === "[a|b]*" && !ws.paneById("n").back?.length, tabs())
  put([S("tx", row("s0", [a, pane("n", "new")]), "n"), T("b")], "tx"); sp.tabIntoPane("tb", "n", "center")
  check("tabs: a tab dropped into a blank pane's middle takes its place, no blank tab back in the list", tabs() === "[a|b]*", tabs())
  put([S("tx", row("s0", [a, pane("n", "new")]), "n"), T("b")], "tx"); sp.paneIntoPane("b", "n", "center")
  check("tabs: a pane dropped into a blank pane's middle takes its place, no blank tab left where it was", tabs() === "[a|b]*", tabs())
  put([T("a"), N], "tn"); ws.openTab("view:web/")
  check("new web page: from a blank tab, in it", tabs() === "a,view:web/*", tabs())
  put([S("tx", row("s0", [a, pane("w", "view:web/")]), "a")], "tx"); ws.openTab("view:web/")
  check("new web page: in a split, one of the focused pane's own tabs, though the split has a blank page", tabs() === "[view:web/|view:web/]*", tabs())

  // ---- what's opened goes to the focused pane; a split stays, and switches away whole ----
  put([S("tx", row("s0", [a, b]), "b"), T("c")], "tx"); ws.go("file:d.md")
  check("split: what's opened goes in the focused pane, the split staying", tabs() === "[a|d]*,c" && focus() === "b" && ws.paneById("b").back?.join() === "file:b.md", tabs())
  ws.setTabKeeper((to: string) => to.startsWith("view:terminal/"))
  put([S("tx", row("s0", [a, pane("q", "view:terminal/q")]), "q"), T("c")], "tx"); ws.go("file:d.md")
  check("split: from a pane that keeps its view (a terminal), in another pane of the split that fits, focused", tabs() === "[d|view:terminal/q]*,c" && focus() === "a", tabs())
  put([S("tx", row("s0", [pane("q", "view:terminal/q"), pane("r", "view:terminal/r")]), "q")], "tx"); ws.go("file:d.md")
  check("split: … none fits, a new tab", tabs() === "[view:terminal/q|view:terminal/r],d*", tabs())
  ws.setTabKeeper(() => false)
  put([S("tx", row("s0", [a, b]), "b"), T("c")], "tx"); ws.selectTab("tc")
  check("split: another tab selected, the split switches away whole, as it was", tabs() === "[a|b],c*" && ws.tabById("tx").focus === "b", tabs())
  ws.go("file:a.md")
  check("split: … opening what one of its panes shows comes back to it, that pane focused", tabs() === "[a|b]*,c" && focus() === "a", tabs())
  put([T("a", undefined, { pinned: true }), T("b")], "ta"); ws.go("file:z.md")
  check("pinned: what's opened from a pinned tab opens in a tab beside it", tabs() === "a,z*,b", tabs())
  put([S("tx", row("s0", [a, b]), "b"), T("c")], "tx"); ws.replaceWorkspace({ tabs: [S("tx", row("s0", [a, b]), "a"), T("c"), T("d")], active: "tc" }, { merge: true })
  check("tabs: the same workspace changed on another device keeps the tab this one shows and its focus", tabs() === "[a|b]*,c,d" && focus() === "b", tabs())

  // ---- Chrome's openers: where a tab opens, and what closing it shows ----
  const tabOfPane = (id: string) => ws.paneTab(id).id
  put([T("a"), T("b")], "ta"); ws.openTab("view:terminal/x", { background: true })
  check("tabs: a tab opened behind goes beside the active one, which stays shown", tabs() === "a*,view:terminal/x,b", tabs())
  // Links opened from a page: behind it in click order after its earlier ones, as Chrome does, till the user moves on.
  put([T("a"), T("b")], "ta"); ws.openTab("file:1.md", { background: true, from: "a" }); ws.openTab("file:2.md", { background: true, from: "a" }); ws.openTab("file:a.md", { background: true, from: "a" })
  check("tabs: links opened behind one tab go after it in the order they were opened, a copy of an open one too", tabs() === "a*,1,2,a,b", tabs())
  ws.selectTab("tb"); ws.selectTab("ta"); ws.openTab("file:3.md", { background: true, from: "a" })
  check("tabs: … once the user showed another tab, the next goes right after it again", tabs() === "a*,3,1,2,a,b", tabs())
  put([T("a"), T("b")], "ta"); const kid = tabOfPane(ws.openTab("file:k.md", { from: "a" }))
  check("tabs: one opened in front from a tab is shown, after it", tabs() === "a,k*,b" && ws.here().active === kid, tabs())
  ws.closeTab(kid)
  check("tabs: … closing it straight away goes back to the tab it came from", ws.here().active === "ta", ws.here().active)
  const kid2 = tabOfPane(ws.openTab("file:k.md", { from: "a" })); ws.selectTab("tb"); ws.selectTab(kid2); ws.closeTab(kid2)
  check("tabs: … but not once another was shown in between: its neighbour, as ever", ws.here().active === "tb", ws.here().active)
  // Chrome's order after closing one of several opened from a tab: the next of them, to the right then the left, then the tab.
  put([T("a"), T("b")], "ta"); const k1 = tabOfPane(ws.openTab("file:1.md", { background: true, from: "a" })), k2 = tabOfPane(ws.openTab("file:2.md", { background: true, from: "a" }))
  const k3 = tabOfPane(ws.openTab("file:3.md", { background: true, from: "a" })); ws.selectTab(k2); ws.closeTab(k2)
  check("tabs: closing one of the tabs a tab opened, come to from it: the next it opened", ws.here().active === k3, ws.here().active)
  ws.closeTab(k3)
  check("tabs: … with none after it, the one before it", ws.here().active === k1, ws.here().active)
  ws.closeTab(k1)
  check("tabs: … and with none left, the tab that opened them", ws.here().active === "ta", ws.here().active)
  put([T("a"), T("b")], "ta"); const k4 = tabOfPane(ws.openTab("file:4.md", { background: true, from: "a" })); ws.openTab("file:5.md", { background: true, from: "a" })
  ws.selectTab("tb"); ws.selectTab(k4); ws.closeTab(k4)
  check("tabs: … come to from another tab, its neighbour to the right, as ever", ws.activePane().to === "file:5.md", ws.activePane())
  ws.selectTab("tb"); ws.closeTab(ws.findOpen("file:5.md").t.id)
  check("tabs: closing one not shown leaves the shown one be", ws.here().active === "tb", ws.here().active)
  put([T("a"), T("b")], "ta"); ws.openTab("file:6.md", { background: true, from: "a" }); const front = tabOfPane(ws.openTab("file:7.md", { from: "a" }))
  check("tabs: one opened in front goes right after its tab, before those opened behind", tabs() === "a,7*,6,b", tabs())
  ws.closeTab(front)
  check("tabs: … and closing it goes back to its tab, not one opened behind (Chrome forgets those)", ws.here().active === "ta", ws.here().active)
  put([T("a"), T("b")], "ta"); const midP = ws.openTab("file:8.md", { from: "a" }), mid = tabOfPane(midP); const leaf = tabOfPane(ws.openTab("file:9.md", { background: true, from: midP })); ws.closeTab(mid)
  check("tabs: closing a tab goes first to the one it opened", ws.here().active === leaf, ws.here().active)
  ws.closeTab(leaf)
  check("tabs: … which is then its opener's: closing it goes back there", ws.here().active === "ta", ws.here().active)

  // ---- a tab dropped on a pane, a pane on a pane, a pane out to a tab of its own ----
  put([T("a"), T("b"), T("c"), T("d")], "ta"); sp.tabIntoPane("tc", "a", "center")
  check("tab into pane: in its middle it takes the pane's place; what was there goes back to the list where the dropped tab was",
    tabs() === "c*,b,a,d" && focus() === "c" && ws.here().tabs[0].id === "ta", tabs())
  put([T("a"), T("b"), T("c")], "ta"); sp.tabIntoPane("tc", "a", "right")
  check("tab into pane: on an edge, a split beside it, the dropped tab's pane focused", tabs() === "[a|c]*,b" && focus() === "c" && shares() === "0.50,0.50", tabs())
  put([S("tx", row("s0", [a, b]), "b"), T("c")], "tc"); sp.tabIntoPane("tx", "c", "bottom")
  check("tab into pane: a split tab dropped brings all its panes, its focus kept", tabs() === "[c/[a|b]]*" && focus() === "b", tabs())
  put([S("tx", row("s0", [a, b]), "b"), T("c", undefined, { group: "G" }), T("d")], "tx", { groups: [{ id: "G", name: "G", color: "blue" }] }); sp.replaceWithTab("tc")
  check("replace with tab (⌥-click): in a split, the tab is one of the focused pane's own, shown, what it showed behind it",
    tabs() === "[a|c]*,d" && focus() === "c" && lay.placesOf(ws.activeTab().root.kids[1]).map((p: Any) => p.id).join() === "b,c" && shares() === "0.50,0.50", tabs())
  put([S("tx", row("s0", [a, b]), "b"), T("n", "new")], "tx")
  check("tab into pane: not onto its own panes, nor a blank tab", !sp.canTabIntoPane("tx", "a", "center") && !sp.canTabIntoPane("tx", "a", "left") && !sp.canTabIntoPane("tn", "a", "left") && sp.canJoin("tn") === false)
  {
    const now = Date.now
    let clock = now()
    Date.now = () => (clock += 1000)
    put([T("a", undefined, { group: "G", pinned: true, name: "Docs" }), T("b"), T("c", undefined, { group: "H" })], "tc",
      { groups: [{ id: "G", name: "G", color: "blue" }, { id: "H", name: "H", color: "red" }] }); ws.selectTab("ta")
    check("tab into its own pane: not in the middle", !sp.canTabIntoPane("ta", "a", "center") && sp.canTabIntoPane("ta", "a", "right"))
    sp.tabIntoPane("ta", "a", "right")
    const t = ws.activeTab()
    check("tab into its own pane's edge: a split, it on that side, the tab shown before it on the other, out of the list",
      tabs() === "[c|a]*,b" && focus() === "a" && t.id === "ta" && t.group === "G" && t.pinned && t.name === "Docs" && !ws.here().groups.some((g: Any) => g.id === "H"), [tabs(), t, ws.here().groups])
    put([T("c"), S("tx", row("s0", [a, b]), "b")], "tx"); ws.selectTab("tc"); Date.now = now; sp.tabIntoPane("tc", "c", "top")
    check("tab into its own pane's edge: … a split shown before it comes whole", tabs() === "[c/[a|b]]*" && focus() === "c", tabs())
    put([T("a")], "ta"); sp.tabIntoPane("ta", "a", "left")
    check("tab into its own pane's edge: … with no other tab, a blank pane, focused", tabs() === "[a|new]*" && ws.activePane().to === "new" && ws.activeTab().id === "ta", tabs())
  }
  put([S("tx", row("s0", [a, b]), "a")], "tx"); sp.paneIntoPane("a", "b", "center")
  check("pane into pane: in its middle the two swap places, the moved one focused", tabs() === "[b|a]*" && focus() === "a", tabs())
  put([S("tx", row("s0", [a, b]), "a"), T("c")], "tx"); sp.paneIntoPane("c", "a", "center")
  check("pane into pane: … across tabs too, each where the other was", tabs() === "[c|b]*,a" && focus() === "c" && ws.here().tabs[1].id === "tc", tabs())
  put([S("tx", row("s0", [a, b]), "a"), T("c")], "tx"); sp.paneIntoPane("c", "b", "bottom")
  check("pane into pane: on an edge it moves beside it; its tab, left with no panes, closes", tabs() === "[a|[b/c]]*" && focus() === "c", tabs())
  put([S("tx", row("s0", [a, b, c]), "b")], "tx"); sp.paneIntoPane("a", "c", "bottom")
  check("pane into pane: … within its own tab", tabs() === "[b|[c/a]]*" && focus() === "a", tabs())
  put([T("a")], "ta")
  check("pane into pane: not onto itself", !sp.canPaneIntoPane("a", "a", "center") && !sp.canPaneIntoPane("a", "a", "left"))
  put([S("tx", row("s0", [a, b]), "a"), T("c")], "tx"); sp.paneToTab("b")
  check("pane to tab: out of its split into a tab of its own, right after its tab, shown", tabs() === "a,b*,c" && !sp.canPaneToTab("a"), tabs())
  put([S("tx", row("s0", [a, b]), "a"), T("c")], "tx"); sp.paneToTab("b", 0)
  check("pane to tab: … or where it's dropped in the list", tabs() === "b*,a,c", tabs())
  put([S("tx", row("s0", [a, c]), "a"), T("b")], "tx"); sp.moveToSplit("right", "tb"); const mid3 = shares(); sp.paneToTab("b")
  check("panes: one made beside another and gone again leaves it its room", mid3 === "0.25,0.25,0.50" && shares(ws.tabById("tx")) === "0.50,0.50", [mid3, shares(ws.tabById("tx"))])
  put([S("tx", row("s0", [a, c], [1 - 2 ** -20, 2 ** -20]), "a")], "tx")
  check("panes: one squeezed too thin to draw (a layout saved so) comes back at an even share", shares() === "0.50,0.50", shares())
  put([S("tx", row("s0", [a, b, c], [0.6, 0.3, 0.1]), "a")], "tx")
  check("panes: a thin one the user dragged to stays", shares() === "0.60,0.30,0.10", shares())
  put([T("q", "view:terminal/q")], "tq"); sp.splitPane("right")
  check("split pane: a file opens again beside it; a terminal isn't doubled, the new pane blank", tabs() === "[view:terminal/q|new]*" && focus() !== "q"
    && (put([T("a")], "ta"), sp.splitPane("bottom"), tabs() === "[a/a]*" && focus() !== "a"), tabs())

  // ---- panes from the keyboard: focus by side, order and last; swap; resize; even out ----
  put([S("tx", row("s0", [a, b, c], [0.3, 0.3, 0.4]), "a")], "tx"); sp.movePane("right")
  check("panes: moving one swaps it with its neighbour that way, keeping the focus", tabs() === "[b|a|c]*" && shares() === "0.30,0.30,0.40" && focus() === "a", tabs())
  sp.focusByOrder(1); const f1 = focus(); sp.focusByOrder(1); const f2 = focus(); sp.focusByOrder(-1)
  check("panes: the next and previous pane go in order, round from the last to the first", f1 === "c" && f2 === "b" && focus() === "c", [f1, f2])
  sp.focusLastPane(); const was = focus(); sp.focusLastPane()
  check("panes: Focus last pane goes back to the one before, and again to where it was", was === "b" && focus() === "c" && sp.hasLastPane(), was)
  sp.focusSide("left"); const fl1 = focus(); sp.focusSide("left")
  check("panes: focus by side goes to the pane that way, none past the edge", fl1 === "a" && focus() === "b" && !sp.hasNeighbour("left") && sp.hasNeighbour("right"), [fl1, focus()])
  put([S("tx", row3(), "a")], "tx"); sp.resize("s0", 0, 0.4, 0.05); const dragged = shares(); sp.evenOut("s0")
  check("panes: a divider dragged moves the two parts beside it; double-clicked, the split's parts are even", dragged === "0.40,0.35,0.25" && shares() === "0.33,0.33,0.33", [dragged, shares()])
  put([S("tx", row("s", [a, col("c2", [b, c], [0.8, 0.2])], [0.25, 0.75]), "a")], "tx"); sp.evenOutAll()
  check("panes: Even out panes evens every split in the tab", shares() === "0.50,0.50" && ws.activeTab().root.kids[1].sizes.join() === "0.5,0.5" && sp.canNudge("right") && (put([T("a")], "ta"), !sp.canNudge("right")), shares())

  // ---- float, dock and zoom in a tab ----
  const floats = () => ws.panes().filter((p: Any) => p.float).map((p: Any) => p.id).join()
  put([S("tx", row3(), "b")], "tx")
  const flat = tree()
  sp.floatPane()
  check("float pane: the focused one floats over where it was, focused, still the tab's", floats() === "b" && focus() === "b"
    && ws.panes().length === 3 && lay.layout(ws.activeTab().root).panes.length === 2 && !sp.canFloat("b") && sp.isFloating(), floats())
  sp.placeFloat("b", { x: 0.6, y: 0.2, w: 0.3, h: 0.4 })
  check("float pane: moved by hand, it stays put; dock pane puts it back as it was", ws.paneById("b").float.x === 0.6 && (sp.dockPane(), floats() === "" && tree() === flat), tree())
  sp.floatPane("b")
  const fb = ws.paneById("b").float
  check("float pane: centred on the right", fb.x + fb.w > 0.9 && Math.abs(fb.y + fb.h / 2 - 0.5) < 1e-9, fb)
  sp.placeFloat("b", { x: 0.02, y: 0.02, w: 0.2, h: 0.2 }); sp.toggleFloat()
  check("dock pane: away from its spot, it docks into the nearest half of the pane under it (near the top: the top half)",
    tree() === "row(col(b:0.50 a:0.50):0.50 c:0.50)" && focus() === "b", tree())
  put([S("tx", row3(), "b")], "tx")
  sp.toggleFloat()
  check("float pane: the same command docks it", sp.isFloating() && (sp.toggleFloat(), !sp.isFloating() && tree() === flat), tree())
  sp.floatPane("b"); ws.setFocusedPane("a"); sp.floatPane("a")
  check("float pane: several at once, but not the last tiled one", floats() === "a,b" && !sp.canFloat("c"), floats())
  ws.closePane("c"); ws.closePane("a")
  check("float pane: the last tiled one closed, a floating one docks", floats() === "" && tree() === "b", tree())
  put([S("tx", row3(fl), "b")], "tx"); sp.paneIntoPane("b", "c", "left")
  check("float pane: dragged onto a pane's edge, it docks there, the other panes as they were", floats() === "" && tree() === "row(a:0.50 b:0.25 c:0.25)", tree())
  put([S("tx", row("s0", [a, { ...b, float: fl }, c, d], [0.2, 0.4, 0.2, 0.2]), "c")], "tx"); ws.closePane("c")
  check("float pane: a tiled one closed beside it leaves its room to the tiled one before", lay.layout(ws.activeTab().root).panes.map((p: Any) => w2(p.rect)).join() === "0.67,0.33",
    lay.layout(ws.activeTab().root).panes)
  put([S("tx", row3(fl), "b")], "tx"); sp.splitPane("right")
  check("float pane: split, it docks first", floats() === "" && lay.layout(ws.activeTab().root).panes.length === 4, tree())
  put([S("tx", row3(), "b")], "tx"); sp.zoomPane()
  check("zoom: the focused pane fills the tab, the others still there", ws.activeTab().zoom === "b" && sp.isZoomed() && ws.panes().length === 3)
  sp.zoomPane()
  check("zoom: again, it's back", !sp.isZoomed())
  sp.zoomPane(); ws.setFocusedPane("a")
  check("zoom: another pane focused, it's back", !sp.isZoomed())
  sp.zoomPane(); sp.splitPane("right")
  check("zoom: a split, it's back", !sp.isZoomed())
  put([S("tx", row3(), "b")], "tx"); sp.zoomPane(); ws.newTabsAt("end", () => ws.openTab("file:z.md"))
  check("zoom: another tab shown, the zoomed one keeps its zoom", !sp.isZoomed() && ws.tabById("tx").zoom === "b" && (ws.selectTab("tx"), sp.isZoomed()))
  sp.openInSplit("file:y.md", "right", false)
  check("zoom: something opened in another pane behind leaves it be", sp.isZoomed() && desc(ws.activeTab().root) === "[a|b|y]", desc(ws.activeTab().root))
  ws.closePane("b")
  check("zoom: closed, it's gone", !sp.isZoomed() && !("zoom" in ws.activeTab()))
  put([S("tx", row3(), "b", { zoom: "b" })], "tx")
  check("zoom: a saved one comes back; one of a pane that isn't focused doesn't", sp.isZoomed() && (put([S("tx", row3(), "a", { zoom: "b" })], "tx"), !sp.isZoomed()))

  // ---- files moving and going: panes follow ----
  while (ws.canReopenTab()) ws.reopenTab()
  const F = (id = "f") => pane(id, "file:Inbox/x.md")
  put([T("a"), TP(F()), T("b")], "tf"); ws.closeFileTabs("Inbox/x.md")
  check("files: a file trashed closes its panes, reopenable", tabs() === "a,b*" && ws.canReopenTab(), tabs())
  put([T("a"), TP(F()), T("b")], "tf"); ws.retarget("Inbox/x.md", "Inbox/.archive/x.md")
  check("files: a file archived or moved stays open where it went, the address too", tabs() === "a,Inbox/.archive/x*,b" && g.location.hash === "#file/Inbox%2F.archive%2Fx.md", [tabs(), g.location.hash])
  put([S("tx", row("s0", [{ ...a, back: ["file:Inbox/x.md"] }, F()]), "a")], "tx"); ws.retarget("Inbox", "Done")
  check("files: a folder moved, the panes of its files follow, and their history", tabs() === "[a|Done/x]*" && ws.paneById("a").back.join() === "file:Done/x.md", tabs())
  put([T("a"), TP(F())], "tf"); ws.closeFileTabs("Inbox")
  check("files: a folder's going closes its files' panes", tabs() === "a*", tabs())
  put([S("tx", row("s0", [{ ...a, back: ["file:q.md", "file:Inbox/x.md", "file:q.md"] }, F()]), "f")], "tx"); ws.dropTabs("Inbox/x.md")
  check("files: deleted, its panes close (the split's others stay), it leaves every history and what ⌘⇧T reopens",
    tabs() === "a*" && ws.paneById("a").back.join() === "file:q.md" && !ws.closedTabs().some((r: Any) => r.tabs.some((t: Tb) => lay.panesOf(t).some((p: Any) => p.to === "file:Inbox/x.md"))), [tabs(), ws.closedTabs()])

  // ---- views hear their panes leave (a web page is its pane's), `last` once its place shows nowhere (a terminal) ----
  const heard: string[] = []
  ws.setTabCloser((to: string, p: string, last: boolean, moved: boolean) => { heard.push(`${to} ${p}${last ? " last" : ""}${moved ? " moved" : ""}`); return false })
  const W = "view:web/https://example.com/"
  put([T("a"), T("w1", W), T("w2", W)], "tw2"); ws.closeTab("tw1", true)
  check("closing: a pane of a place another pane shows is heard, not as the last", heard.join("|") === `${W} w1`, heard)
  heard.length = 0; ws.closeTab("tw2", true)
  check("closing: the last pane of a place is heard as the last", heard.join("|") === `${W} w2 last`, heard)
  heard.length = 0; put([T("a"), T("w1", W), T("w2", W)], "ta"); ws.closeTabs("others", "ta", true)
  check("closing several of a place: each heard, the last once", heard.join("|") === `${W} w1|${W} w2 last`, heard)
  heard.length = 0; put([S("tx", row("s0", [a, pane("w1", W)]), "w1")], "tx"); ws.closePane("w1", true)
  check("closing: a pane of a split heard, the tab staying", heard.join("|") === `${W} w1 last` && tabs() === "a*", heard)
  heard.length = 0; put([T("a"), T("w1", W)], "tw1"); ws.takeOut(["tw1"])
  check("a tab taken out to another window is heard as moved, never as the last", heard.join("|") === `${W} w1 moved`, heard)
  heard.length = 0; put([T("a"), T("w1", W)], "tw1"); ws.closeTab("ta", true)
  check("closing a file's tab tells no view", !heard.length, heard)
  ws.setTabCloser(() => false)

  // ---- ⌘⇧T: closed tabs and panes come back where they were ----
  while (ws.canReopenTab()) ws.reopenTab()
  put([S("tx", row("s0", [a, b, d], [0.6, 0.3, 0.1]), "b")], "tx"); ws.closePane()
  check("close pane: its room goes to the pane before it, the focus to the one after", tree() === "row(a:0.90 d:0.10)" && focus() === "d", tree())
  ws.reopenTab()
  check("close pane: ⌘⇧T brings it back where it sat, at its share, focused", tree() === "row(a:0.60 b:0.30 d:0.10)" && focus() === "b", tree())
  put([S("tx", row("s0", [a, col("s1", [b, c], [0.25, 0.75])], [0.7, 0.3]), "a")], "tx")
  ws.closePane("b"); ws.closePane("a")
  check("close pane: two closed, the splits closing up", tree() === "c", tree())
  ws.reopenTab(); ws.reopenTab()
  check("close pane: reopened in turn, each where it sat", tree() === "row(a:0.70 col(b:0.25 c:0.75):0.30)", tree())
  put([T("a"), T("b")], "ta")
  check("close pane: a tab's only pane is Close tab", !ws.canClosePane() && (ws.closePane(), tabs() === "b*"), tabs())
  put([T("a"), S("tx", row("s0", [b, c]), "c"), T("d")], "tx"); ws.closeTab("tx"); ws.reopenTab()
  check("reopen: a split tab closed comes back whole where it was, its focus kept", tabs() === "a,[b|c]*,d" && focus() === "c", tabs())
  // Search tabs: the tab focused last first; the ones closed lately listed, the latest first, and reopened where they were.
  while (ws.canReopenTab()) ws.reopenTab()
  const now = Date.now
  let clock = now()
  Date.now = () => (clock += 1000)
  put([T("a"), T("b"), T("c")], "ta"); ws.selectTab("tc"); ws.selectTab("tb")
  const recent = () => ws.tabsByRecent().map((t: Tb) => t.id).join()
  check("search tabs: the one on screen first, then each by when it was left", recent() === "tb,tc,ta", recent())
  Date.now = () => clock
  ws.selectTab("ta"); ws.selectTab("tb")
  check("search tabs: … but for one only passed through", recent() === "tb,tc,ta", recent())
  Date.now = now
  ws.closeTab("tc"); ws.closeTab("ta")
  const shut = () => ws.closedTabs().map((r: Any) => r.id).join()
  check("search tabs: closed ones, the latest first", shut() === "ta,tc", shut())
  ws.reopenClosed("tc")
  check("search tabs: one reopened where it was, shown, and off the list", tabs() === "b,c*" && shut() === "ta", [tabs(), shut()])
  put([S("tx", row("s0", [d, pane("e")]), "d")], "tx"); ws.closePane("e")
  check("search tabs: a pane closed from a split is listed as a tab", shut() === "te,ta", shut())
  ws.reopenClosed("te")
  check("search tabs: … and comes back where it sat in its split", tabs() === "[d|e]*" && shut() === "ta", [tabs(), shut()])
  while (ws.canReopenTab()) ws.reopenTab()

  const rn = () => { const l = ws.here(); return l.tabs.map((t: Tb) => { const g = l.groups?.find((x: Any) => x.id === t.group); return desc(t.root) + (g ? `(${g.name})` : "") }).join(",") }
  // What closed together comes back together (Chrome's "N tabs"), each where it was, with its group.
  const G1 = { id: "g1", name: "Trip", color: "teal" }
  put([T("a"), T("b", undefined, { group: "g1" }), T("c", undefined, { group: "g1" }), T("d")], "ta", { groups: [G1] })
  const told: [string, number][] = []
  ws.setClosedTogether((id: string, n: number) => told.push([id, n]))
  ws.closeTabs("others", "ta", true)
  check("several closed: one entry", tabs() === "a*" && shut() === "tb", [tabs(), shut()])
  check("several closed: the app is told once, with the entry Undo reopens and how many", told.join("|") === "tb,3", told)
  ws.reopenClosed("tb")
  check("several closed: Undo (reopenClosed) brings them all back", rn() === "a,b(Trip),c(Trip),d" && !ws.canReopenTab(), rn())
  ws.closeTab("td"); ws.reopenTab()
  check("several closed: one tab closed tells nothing", told.length === 1, told)
  ws.setClosedTogether(() => {}); ws.selectTab("ta")
  ws.closeTabs("others", "ta", true)
  ws.reopenTab()
  check("several closed: one ⌘⇧T brings all back where they were, the tab on screen staying, their group back", rn() === "a,b(Trip),c(Trip),d" && ws.here().active === "ta"
    && !ws.canReopenTab(), [rn(), ws.here().active])
  ws.selectTab("tc"); gr.closeGroup("g1")
  check("close group: the group goes with its tabs", rn() === "a,d" && !ws.here().groups, rn())
  ws.reopenTab()
  check("close group: ⌘⇧T brings the group back, named and coloured, its tab on screen shown", rn() === "a,b(Trip),c(Trip),d" && ws.here().active === "tc", rn())
  put([T("a"), T("b", undefined, { group: "g1" }), T("c")], "tb", { groups: [G1] }); ws.closeTab("tb", true)
  ws.reopenTab()
  check("a group's last tab closed: reopened, the group comes back", rn() === "a,b(Trip),c", rn())
  ws.closeTabIds(["ta", "tb", "tc"], { force: true })
  check("all closed: a blank tab left", tabs() === "new*", tabs())
  ws.reopenTab()
  check("all closed: one ⌘⇧T brings them back, the blank tab making way, the one shown then shown", rn() === "a,b(Trip),c" && ws.here().active === "tb", [rn(), ws.here().active])

  // A pane closed comes back as it was: floating at its place (the tiled ones keeping their sizes), zoomed.
  const flt = { x: 0.5, y: 0.1, w: 0.3, h: 0.4 }
  put([S("tx", row("s0", [a, b, { ...c, float: flt }], [0.25, 0.75, 0.2]), "c")], "tx")
  const tiles = () => lay.layout(ws.activeTab().root).panes.map((x: Any) => `${x.pane.id}:${x.rect.w.toFixed(2)}`).join()
  const tiled0 = tiles()
  ws.closePane("c", true); ws.reopenTab()
  const backP = lay.panesOf(ws.activeTab()).find((p: Any) => p.id === "c")
  check("close pane: a floating one comes back floating where it was, the tiled ones as they were", same(backP?.float, flt) && tiles() === tiled0 && focus() === "c", [backP, tiles(), tiled0])
  put([S("tx", row("s0", [a, b]), "b", { zoom: "b" })], "tx")
  ws.closePane("b", true); ws.reopenTab()
  check("close pane: a zoomed one comes back zoomed", ws.activeTab().zoom === "b" && tree() === "row(a:0.50 b:0.50)", [ws.activeTab(), tree()])

  // Nothing is lost for good: what a list put in place takes away (a layout, another device) is remembered as closed.
  while (ws.canReopenTab()) ws.reopenTab()
  put([T("a"), S("tx", row("s0", [b, c], [0.3, 0.7]), "c", { group: "g1" }), T("d")], "tx", { groups: [G1] })
  ws.replaceWorkspace({ tabs: [T("a")], active: "ta" })
  check("taken away: remembered as one entry", tabs() === "a*" && shut() === "tx", [tabs(), shut()])
  ws.reopenTab()
  check("taken away: ⌘⇧T brings it all back, splits, sizes and group", rn() === "a,[b|c](Trip),d" && shares(ws.here().tabs[1]) === "0.30,0.70", [rn(), shares(ws.here().tabs[1])])
  ws.replaceWorkspace({ tabs: [T("a"), S("tx", c, "c", { group: "g1" }), T("d")], groups: [G1], active: "tx" }, { merge: true })
  check("taken away: a pane of a split another device closed is remembered as a pane", shut() === "tb", shut())
  ws.reopenTab()
  check("… and comes back in its split", tabs() === "a,[b|c]*,d", tabs())
  ws.replaceWorkspace({ tabs: [T("q")], active: "tq" }, { kept: true })
  check("taken away, kept elsewhere (a workspace switched from): nothing remembered", !ws.canReopenTab(), shut())
  ws.setOpenElsewhere((to: string) => to === "file:q.md")
  ws.replaceWorkspace({ tabs: [T("a")], active: "ta" })
  check("taken away, open in another workspace: nothing remembered", !ws.canReopenTab(), shut())
  ws.setOpenElsewhere(() => false)
  ws.replaceWorkspace({ tabs: [pane("r"), pane("a", "file:a.md")].map((p) => TP(p)), active: "tr" })
  check("taken away, open there under another id: nothing remembered", !ws.canReopenTab(), shut())

  // What closes is its workspace's, as its tabs are: ⌘⇧T reopens what closed there.
  let wsNow = 1
  ws.setWorkspaceOf(() => wsNow)
  put([T("a"), T("b")], "tb"); ws.closeTab("tb", true)
  wsNow = 2
  check("workspaces: what closed in another isn't reopened here", !ws.canReopenTab() && shut() === "", shut())
  wsNow = 1
  check("… and is, back there", ws.canReopenTab() && shut() === "tb", shut())
  ws.reopenTab()
  ws.setWorkspaceOf(() => 0)

  // ---- tab groups (tabgroups.ts) ----
  const runs = () => { const l = ws.here(); return l.tabs.map((t: Tb) => { const s = l.groups?.find((x: Any) => x.id === t.group); return desc(t.root) + (s ? `(${s.name || s.color}${s.collapsed ? "-" : ""})` : "") }).join(",") }
  const five = () => put(["a", "b", "c", "d", "e"].map((x) => T(x)), "ta")
  // A phone's tab list (TabSwitcher.tsx): a drop keeping the tab on screen.
  put([T("a"), T("b"), T("c")], "tc"); gr.groupWith("ta", "tc")
  check("phone groups: a tab dropped on another: the two make a tab group where it was", runs() === "b,c(blue),a(blue)" && ws.here().active === "tc", runs())
  put([T("a"), T("b"), T("c")], "ta"); gr.makeGroup(["ta", "tb"]); gr.groupWith("tc", "tb")
  check("phone groups: dropped on a grouped tab, it joins that group", runs() === "a(blue),b(blue),c(blue)", runs())
  put([T("a"), T("b"), T("c"), T("d")], "td"); const g0 = gr.makeGroup(["ta", "tb", "tc"]); sp.placeTabBy("ta", "after", "tc", g0)
  check("phone groups: a tab moved within its open group stays in it", runs() === "b(blue),c(blue),a(blue),d", runs())
  sp.placeTabBy("td", "before", "tb", null)
  check("phone groups: a lone tab placed before a group stays out of it, the tab on screen kept", runs() === "d,b(blue),c(blue),a(blue)" && ws.here().active === "td", runs())
  ws.selectTab("ta"); sp.placeTab("ta", 0, null); ws.selectTab("tb"); sp.keepShown("ta")
  check("phone groups: after a move, the tab on screen kept", ws.here().active === "ta", ws.here().active)
  // Folding the group on screen, and closing in groups, never shows a tab of another folded group while one isn't.
  put(["a", "b", "c", "d", "e"].map((x) => T(x)), "tb")
  const gw = gr.makeGroup(["tb", "tc"], { name: "W" }), gx = gr.makeGroup(["td"], { name: "X", collapsed: true })
  gr.foldGroup(gw)
  check("tab groups: folding the group on screen shows the nearest tab not folded away, past another folded group", runs() === "a,b(W-),c(W-),d(X-),e" && ws.here().active === "te", runs())
  ws.selectTab("tc"); ws.closeTab("tc", true)
  check("tab groups: closing a group's tab shows another of its own", ws.here().active === "tb", runs())
  ws.closeTab("tb", true)
  check("tab groups: closing a group's last tab shows the nearest tab not folded away", runs() === "a,d(X-),e" && ws.here().active === "te" && !!gx, runs())
  five()
  let g1 = gr.makeGroup(["tb", "td"], { name: "Work" })
  check("tab groups: tabs made a group sit together where the first was, with the first unused colour", runs() === "a,b(Work),d(Work),c,e" && gr.allGroups()[0].color === "blue", runs())
  gr.makeGroup(["te"])
  check("tab groups: the next group takes the next colour; no name when the tabs share no folder or site", gr.allGroups()[1].color === "orange" && gr.allGroups()[1].name === "", gr.allGroups())
  const { siteName } = await import("../plugins/core/web-viewer/address.ts")
  gr.setGroupNamer((to: string) => (to.startsWith("view:web/") ? siteName(to.slice(9).replace(/^@[a-z0-9]+\//, "")) : null))
  const of = (...tos: string[]) => tos.map((to) => lay.tabOf(to))
  check("tab groups: a new group's name is the folder its panes' files share, or what their views name it (a site)",
    gr.suggestName([lay.tabOf("file:Projects/Lighthouse/a.md"), S("tx", row("s", [pane("x", "file:Projects/Lighthouse/b.md"), pane("y", "file:Projects/Lighthouse/c.md")]), "x")]) === "Lighthouse"
    && gr.suggestName(of("view:web/https://www.github.com/a", "view:web/@work/https://github.com/b")) === "Github" && gr.suggestName(of("file:a.md", "view:terminal/q")) === "")
  gr.addToGroup(["ta"], g1)
  check("tab groups: a tab added to a group goes to its end", runs() === "b(Work),d(Work),a(Work),c,e(orange)", runs())
  gr.leaveGroup(["td"])
  check("tab groups: a tab taken out of its group goes right after it", runs() === "b(Work),a(Work),d,c,e(orange)", runs())
  sp.placeTab("tc", 1)
  check("tab groups: a tab dragged between two of a group's tabs joins it", runs() === "b(Work),c(Work),a(Work),d,e(orange)", runs())
  sp.placeTab("tc", 5)
  check("tab groups: dragged out past the group's end, it leaves", runs() === "b(Work),a(Work),d,e(orange),c", runs())
  sp.placeTab("ta", 2, null)
  check("tab groups: at the group's end, its own last tab stays in unless the drop says none", runs() === "b(Work),a,d,e(orange),c", runs())
  sp.placeTab("td", 1, g1)
  check("tab groups: a drop just after a group's chip joins it", runs() === "b(Work),d(Work),a,e(orange),c", runs())
  gr.foldGroup(g1)
  check("tab groups: folding the group whose tab isn't on screen leaves the tab shown", runs() === "b(Work-),d(Work-),a,e(orange),c" && ws.here().active === "ta", runs())
  ws.selectTab("tb")
  check("tab groups: showing a tab of a folded group opens it", runs() === "b(Work),d(Work),a,e(orange),c" && ws.here().active === "tb", runs())
  gr.foldGroup(g1)
  check("tab groups: folding the group on screen shows the tab after it", runs() === "b(Work-),d(Work-),a,e(orange),c" && ws.here().active === "ta", runs())
  gr.foldGroup(g1, false)
  gr.moveGroupTo(g1, 5)
  check("tab groups: a whole group dragged moves with its tabs in order", runs() === "a,e(orange),c,b(Work),d(Work)", runs())
  gr.moveGroupTo(g1, 1)
  check("tab groups: a group dropped inside another goes before it, never into it", runs() === "a,b(Work),d(Work),e(orange),c", runs())
  // Where a drop lands among the tabs as drawn (drop.ts), each slot 96px wide and 100px from the last.
  const g2 = gr.allGroups()[1].id
  const laid = (keys: string[]) => keys.map((k, i) => ({ el: { closest: () => null, getBoundingClientRect: () => ({ left: i * 100, right: i * 100 + 96, top: 0, bottom: 28 }) },
    ...(k.startsWith("group:") ? { group: k.slice(6) } : { tab: k }) }))
  const bar = laid(["ta", `group:${g1}`, "tb", "td", `group:${g2}`, "te", "tc"])
  const at = (pos: number, slots = bar) => { const r = dr.slotIn(ws.here(), slots, pos, "x"); return `${r.index}:${r.group === g1 ? "Work" : r.group === g2 ? "orange" : r.group}` }
  check("drops: right after a group's name, or between its tabs, joins it", at(150) === "1:Work" && at(250) === "2:Work", [at(150), at(250)])
  check("drops: over a group's last tab joins its end; just past it, outside it at the same place", at(390) === "3:Work" && at(399) === "3:null", [at(390), at(399)])
  check("drops: before a group's name joins none", at(120) === "1:null", at(120))
  gr.foldGroup(g2)
  const folded = laid(["ta", `group:${g1}`, "tb", "td", `group:${g2}`, "tc"])
  check("drops: on the middle of a folded group's name, into its end; at its sides, beside it", at(448, folded) === "4:orange" && at(405, folded) === "3:null" && at(490, folded) === "4:null",
    [at(448, folded), at(405, folded), at(490, folded)])
  sp.placeTab("tc", 4, g2)
  check("drops: a tab dropped into a folded group is put away there, the tab on screen staying", runs() === "a,b(Work),d(Work),e(orange-),c(orange-)" && ws.here().active === "ta", runs())
  sp.placeTab("tc", 5, null); gr.foldGroup(g2, false)
  // What a list draws while dragging: the tabs as the drop would leave them.
  const sl: Any = await web("core/slide.ts")
  const order = (item: Any, dp: Any) => { const p = dr.previewIn(ws.here(), item, dp); return p && dr.previewOrder(ws.here(), p).map((k: string) => k === `group:${g1}` ? "[Work]" : k === `group:${g2}` ? "[orange]" : k.startsWith("t") ? k.slice(1) : k).join(",") }
  check("drop preview: a tab dragged into a group's end shows there, its name before them",
    order({ from: "tab", tab: "tc" }, { kind: "list", index: 3, group: g1 }) === "a,[Work],b,d,c,[orange],e", order({ from: "tab", tab: "tc" }, { kind: "list", index: 3, group: g1 }))
  check("drop preview: a file from elsewhere makes room where it'd open; a drop on a pane changes nothing in the list",
    order({ from: "tree", to: "file:z.md" }, { kind: "list", index: 1, group: null }) === `a,${sl.INCOMING},[Work],b,d,[orange],e,c`
    && order({ from: "tab", tab: "tc" }, { kind: "pane", pane: "a", zone: "left" }) === null)
  check("drop preview: a whole group dragged moves with its name", order({ from: "group", group: g1 }, { kind: "list", index: 5, group: null }) === "a,[orange],e,c,[Work],b,d",
    order({ from: "group", group: g1 }, { kind: "list", index: 5, group: null }))
  check("drop preview: a pane alone in its tab moves its tab", order({ from: "pane", pane: "c" }, { kind: "list", index: 0, group: null }) === "c,a,[Work],b,d,[orange],e",
    order({ from: "pane", pane: "c" }, { kind: "list", index: 0, group: null }))
  // Every other list reordered by dragging (slide.ts): the order a drop at a slot leaves, which it makes way for.
  const ro = (keys: string[], moving: string[], i: number) => { const r = sl.reorder(keys, moving, i); return `${r.order.join(",")}|${r.before}|${r.same}` }
  check("make way: one dragged down past two lands after them, before the next", ro(["a", "b", "c", "d"], ["a"], 3) === "b,c,a,d|d|false", ro(["a", "b", "c", "d"], ["a"], 3))
  check("make way: over its own place (either side of its middle), nothing changes", ro(["a", "b", "c"], ["b"], 1) === "a,b,c|c|true" && ro(["a", "b", "c"], ["b"], 2) === "a,b,c|c|true")
  check("make way: past the last, the end", ro(["a", "b", "c"], ["a"], 3) === "b,c,a|null|false", ro(["a", "b", "c"], ["a"], 3))
  check("make way: what comes from elsewhere opens one gap there", ro(["a", "b"], ["y", "z"], 1) === `a,${sl.INCOMING},b|b|false`, ro(["a", "b"], ["y", "z"], 1))
  gr.renameGroup(g1, "  Lighthouse "); gr.colorGroup(g1, "teal")
  check("tab groups: renamed (trimmed) and recoloured", gr.allGroups()[0].name === "Lighthouse" && gr.allGroups()[0].color === "teal", gr.allGroups())
  while (ws.canReopenTab()) ws.reopenTab()
  ws.closeTab("te")
  check("tab groups: closing a group's last tab removes the group", runs() === "a,b(Lighthouse),d(Lighthouse),c" && gr.allGroups().length === 1, runs())
  ws.closeTab("td"); ws.reopenTab()
  check("tab groups: a closed tab reopens back in its group", runs() === "a,b(Lighthouse),d(Lighthouse),c", runs())
  ws.reopenTab()
  check("tab groups: one whose group went reopens where it was, its group back (Chrome's)", runs() === "a,b(Lighthouse),d(Lighthouse),e(orange),c" && gr.allGroups().length === 2, runs())
  ws.selectTab("tb"); ws.go("file:z.md", true)
  check("tab groups: a tab opened from a grouped tab joins its group", runs().startsWith("a,b(Lighthouse),z(Lighthouse),") && ws.activeTab().group === g1, runs())
  ws.newTab()
  check("tab groups: a new blank tab from a grouped tab goes after the group, in none", ws.activePane().to === "new" && !ws.activeTab().group
    && ws.here().tabs.findIndex((t: Tb) => lay.isBlankTab(t)) === ws.here().tabs.map((t: Tb) => t.group).lastIndexOf(g1) + 1, runs())
  const savedGroups = JSON.parse(JSON.stringify(ws.getWorkspace())); ws.replaceWorkspace(savedGroups)
  check("tab groups: a layout put back (another device, a reload) keeps them", runs() === "a,b(Lighthouse),z(Lighthouse),d(Lighthouse),new,e(orange),c", runs())
  gr.ungroup(g1)
  check("tab groups: ungrouped, the tabs stay where they were", runs() === "a,b,z,d,new,e(orange),c" && !ws.here().tabs.some((t: Tb) => t.group === g1), runs())
  // Saved and read back: a tab in a group the list hasn't is in none; a group's tabs apart are gathered; a bad colour drops it.
  const read = lay.clean({ active: "ta", tabs: [T("a", undefined, { group: "s" }), T("b"), T("c", undefined, { group: "s" }), T("d", undefined, { group: "gone" })],
    groups: [{ id: "s", name: "Read", color: "green", collapsed: true }, { id: "x", name: "Bad", color: "chartreuse" }] })
  check("tab groups: read back as they must be (together, known groups only, the one on screen open)",
    read.tabs.map((t: Tb) => t.id + (t.group ?? "")).join(",") === "tas,tcs,tb,td" && read.groups.length === 1 && !read.groups[0].collapsed, read)
  // An agent's pages, each in its task's tab group (openInGroup).
  put([T("a"), T("c")], "ta"); const o1 = gr.openInGroup("view:web/https://z.test/", "Agent/other")
  check("agent tabs: the first of a task goes in a new group of its name after the tab on screen, shown",
    runs() === "a,view:web/https://z.test/(Agent/other),c" && ws.here().active === ws.paneTab(o1).id, runs())
  gr.openInGroup("view:web/https://y.test/", "Agent/other")
  check("agent tabs: the next of the task goes to its group's end", runs() === "a,view:web/https://z.test/(Agent/other),view:web/https://y.test/(Agent/other),c", runs())
  put([T("a"), T("c")], "ta"); const o3 = gr.openInGroup("view:web/https://h.test/", "Agent/here", true)
  check("agent tabs: beside, a pane beside the focused one, the focus staying, the tab in a group of its name",
    runs() === "[a|view:web/https://h.test/](Agent/here),c" && focus() === "a" && ws.paneById(o3)?.to === "view:web/https://h.test/", runs())
  // A tab's own name (Rename tab): set, trimmed, kept through a reload, and taken off by an empty one.
  put([T("a"), T("b")], "ta"); ws.nameTab("tb", "  Reading   list ")
  const named = lay.clean(JSON.parse(JSON.stringify(ws.getWorkspace())))
  ws.nameTab("tb", " ")
  const bad = lay.clean({ active: "tn", tabs: [{ ...T("n", "new"), name: 42 }] })
  check("tab names: kept as one line, read back, cleared by an empty name, a bad one dropped", named.tabs[1].name === "Reading list"
    && !("name" in ws.tabById("tb")) && !("name" in bad.tabs[0]), [named.tabs[1], ws.tabById("tb"), bad.tabs[0]])

  // ---- what changed, as events (tabevents.ts): what the companion follows ----
  const evs: string[] = []
  const off = tev.onTabsEvent((e: Any) => { const { type, ...rest } = e; evs.push([type, ...Object.values(rest).map(String)].join(" ")) })
  const said = () => { const s = evs.join("|"); evs.length = 0; return s }
  put([T("a"), T("b")], "ta"); said()
  ws.selectTab("tb")
  check("events: a tab selected: tab-focused and pane-focused, with what was", said() === "tab-focused tb ta|pane-focused b tb a")
  const zp = ws.openTab("file:z.md", { background: true }), zt = ws.paneTab(zp).id
  check("events: a tab opened: tab-opened and pane-opened", said() === `tab-opened ${zt}|pane-opened ${zp} ${zt}`)
  sp.placeTab(zt, 0)
  check("events: a tab dragged: tab-moved with its index, not the ones it shifted", said() === `tab-moved ${zt} 0`)
  ws.goHere("file:y.md")
  check("events: a pane shows another place: pane-changed", said() === "pane-changed b tb file:y.md")
  sp.paneIntoPane(zp, "a", "right")
  const moved = said()
  check("events: a pane moved into another tab: pane-moved from its tab, which closed; that tab and pane focused",
    moved === `tab-closed ${zt}|pane-moved ${zp} ta ${zt}|tab-focused ta tb|pane-focused ${zp} ta b`, moved)
  ws.setFocusedPane("a")
  check("events: a pane clicked: only pane-focused", said() === `pane-focused a ta ${zp}`)
  ws.closePane(zp)
  check("events: a pane closed: pane-closed", said() === `pane-closed ${zp} ta`)
  ws.closeTab("tb")
  check("events: a tab closed: tab-closed and its panes' pane-closed", said() === "tab-closed tb|pane-closed b tb")
  off()
  ws.selectTab("ta")
  check("events: unsubscribed, nothing heard", said() === "")

  // ---- what agents ask (vau tabs) ----
  const ask = (m: Props) => { try { return g.__answerUi.tabs(m) } catch (e) { return { error: (e as Error).message } } }
  put([S("tx", row("s0", [a, b]), "b"), T("c")], "tx")
  check("vau tabs list: each tab with its panes (path, focused), the one on screen; the groups",
    same(ask({ do: "list" }), { tabs: [{ id: "tx", active: true, panes: [{ id: "a", to: "file:a.md", path: "a.md" }, { id: "b", to: "file:b.md", path: "b.md", focused: true }] },
      { id: "tc", panes: [{ id: "c", to: "file:c.md", path: "c.md", focused: true }] }], groups: [] }), ask({ do: "list" }))
  const fc = ask({ do: "focus", what: "c.md" })
  check("vau tabs focus: a pane named by its file shown, focused", same(fc, { tab: "tc", pane: "c" }) && tabs() === "[a|b],c*", fc)
  const spl = ask({ do: "split", pane: "c", side: "bottom", to: "file:z.md" })
  check("vau tabs split: something opened beside a pane, in its tab", spl.tab === "tc" && ws.paneById(spl.pane)?.to === "file:z.md" && tabs() === "[a|b],[c/z]*", [spl, tabs()])
  ask({ do: "swap", pane: "a", with: "c" })
  check("vau tabs swap: two panes in each other's places, across tabs", tabs() === "[c|b],[a/z]*", tabs())
  ask({ do: "move", what: "z.md", at: 0 })
  check("vau tabs move: a pane of a split to a place in the list, a tab of its own", tabs() === "z*,[c|b],a", tabs())
  ask({ do: "move", what: "tc", into: "b", side: "right" })
  check("vau tabs move: a tab into a pane's side", tabs() === "z,[c|b|a]*" && focus() === "a", tabs())
  const grp = ask({ do: "group", tabs: ["z.md"], name: "Later", color: "green" })
  check("vau tabs group: tabs named made a group, its name and colour", grp.group?.name === "Later" && grp.group.color === "green" && grp.group.tabs.length === 1, grp)
  check("vau tabs: errors say what's wrong", ask({ do: "focus", what: "nope.md" }).error === "no open tab or pane is nope.md (vau tabs lists them)"
    && ask({ do: "split", pane: "b", side: "center" }).error === "a split's side is left, right, top or bottom"
    && ask({ do: "split", pane: "b", side: "up" }).error === "a side is left, right, top, bottom or center"
    && ask({ do: "swap", pane: "b", with: "b" }).error === "those are the same pane"
    && ask({ do: "group", tabs: ["b"], color: "chartreuse" }).error?.startsWith("a colour is one of")
    && ask({ do: "group", group: "nope" }).error === "no tab group nope (vau tabs lists them)"
    && ask({ do: "move", what: "z.md" }).error === "say where: `into` a pane (with `side`), or `at` a place in the list"
    && ask({ do: "what" }).error?.startsWith("do is list"), tabs())
  const cl = ask({ do: "close", tabs: ["file:z.md", "file:a.md"] })
  check("vau tabs close: the panes showing those close, a tab with none left too", cl.closed === 2 && tabs() === "[c|b]*", [cl, tabs()])

  // ---- tabs that archive themselves: stamped while on screen (only with archiving on); never one on screen, pinned or
  // that closing would lose; closed with no ⌘⇧T entry, put back where they were; stamps from another device's copy taken ----
  const H = 3600_000, old = Date.now() - 48 * H
  while (ws.canReopenTab()) ws.reopenTab()
  ws.setArchivable((p: Any) => p.to !== "file:keep.md")
  put([T("a"), T("b")], "ta")
  check("archive: off, no pane is stamped", ws.here().tabs.every((t: Tb) => lay.panesOf(t).every((p: Any) => p.seen === undefined)), ws.here().tabs)
  const seen = (p: Any) => ({ ...p, seen: old })
  put([TP(seen(a)), TP(seen(b)), TP(seen(pane("p")), { pinned: true }), TP(seen(pane("k", "file:keep.md"))), T("c")], "ta")
  ws.setArchiveAfter(24 * H)
  const seenOf = (id: string) => ws.paneById(id)?.seen
  check("archive: on, the panes on screen and those never stamped are seen now; the rest keep theirs", seenOf("a") > old && seenOf("c") > old && seenOf("b") === old, ws.here().tabs)
  check("archive: due are the unseen, unpinned, not on screen and archivable", ws.unseenTabs(Date.now() - 24 * H).map((t: Tb) => t.id).join() === "tb")
  put([S("tx", row("s0", [seen(pane("x1")), pane("x2")]), "x1"), T("y")], "ty"); const halfDue = ws.unseenTabs(Date.now() - 24 * H).length
  put([S("tx", row("s0", [seen(pane("x1")), seen(pane("x2"))]), "x1"), T("y")], "ty")
  check("archive: a split tab is due only once each of its panes is", halfDue === 0 && ws.unseenTabs(Date.now() - 24 * H).map((t: Tb) => t.id).join() === "tx")
  put([TP(seen(a)), TP(seen(b)), TP(seen(pane("p")), { pinned: true }), TP(seen(pane("k", "file:keep.md"))), T("c")], "ta")
  const gone = ws.closeToArchive(["tb"])
  check("archive: closed, its place kept, nothing for ⌘⇧T", tabs() === "a*,p,keep,c" && gone[0]?.at === 1 && !ws.canReopenTab(), [tabs(), gone])
  ws.selectTab("tc"); ws.restoreTab(gone[0], false)
  check("archive: put back behind the tab on screen", tabs() === "a,b,p,keep,c*", tabs())
  const soon = Math.floor(Date.now() / 60_000) * 60_000 + 5 * 60_000
  ws.mergeSeen({ tabs: [TP({ ...a, seen: soon }), TP(seen(b))], active: "ta" })
  check("archive: a later stamp from another device's copy is taken, an earlier one isn't", seenOf("a") === soon && seenOf("b") > old)
  const copy = (s: number) => ({ ...ws.getWorkspace(), tabs: ws.here().tabs.map((t: Tb) => (t.id === "tb" ? TP({ ...t.root, seen: s }) : t)) })
  check("archive: a stamp behind the file by over a quarter of the archive time is worth a write, else it rides along",
    ws.seenSince(copy(old)) && !ws.seenSince(copy(Date.now() - H)) && !ws.seenSince(ws.getWorkspace()))
  ws.setArchiveAfter(0)
  check("archive: off, nothing is worth a write", !ws.seenSince(copy(old)))
  // (a layout turning archiving on: nothing goes at once by the stamps of the last time it was on)
  ws.setArchiveAfter(24 * H)
  const dueNow = ws.archivingDue()
  mem.set("vaultite.tabs.archiving", String(Date.now() - 25 * H)); ws.setArchiveAfter(24 * H)
  check("archive: none due till it's been on as long as the setting", !dueNow && ws.archivingDue())
  ws.setArchiveAfter(0)

  // ---- a split's panes with tabs of their own (Pane.stack): places stacked behind what a pane shows ----
  {
    while (ws.canReopenTab()) ws.reopenTab()
    // Each pane of the tab on screen as its places in order, the shown one marked: "a ^x y|b".
    const own = (t: Tb = ws.activeTab()) => lay.panesOf(t).map((p: Any) => lay.placesOf(p).map((x: Any, _: number, all: Any[]) => (x.id === p.id && all.length > 1 ? "^" : "") + short(x.to)).join(" ")).join("|")
    const stk = (p: Any, stack: Any[], stackAt?: number) => ({ ...p, stack, ...(stackAt ? { stackAt } : {}) })
    const x = pane("x"), y = pane("y")
    check("stack: a pane's places in order, the shown one at stackAt; stacked() makes it back from them",
      lay.placesOf(stk(a, [x, y], 1)).map((q: Any) => q.id).join() === "x,a,y" && same(lay.stacked([x, a, y], "a"), stk(a, [x, y], 1)) && same(lay.stacked([a], "a"), a))
    const sx = S("tx", row("s0", [stk(a, [x, y]), b]), "a")
    check("stack: every place of a tab, the pane that has one, whether it's stacked; the tab of a stacked place",
      lay.placesIn(sx).map((q: Any) => q.id).join() === "a,x,y,b" && lay.paneWith(sx.root, "y")?.id === "a" && lay.isStacked(sx.root, "y") && !lay.isStacked(sx.root, "a")
      && lay.tabOfPane({ tabs: [T("q"), sx], active: "tq" }, "x")?.id === "tx" && lay.allPanes({ tabs: [sx], active: "tx" }).length === 4)
    const shownY = lay.showingPlace(sx, "y")
    check("stack: showing a place, what the pane showed goes behind it in its place, the focus following",
      own(shownY) === "a x ^y|b" && shownY.focus === "y" && lay.showingPlace(S("tx", row("s0", [stk(pane("n", "new"), [x]), b]), "n"), "x").root.kids[0].stack === undefined)
    const added = lay.withPlace(sx, "a", pane("z")), behind = lay.withPlace(sx, "a", pane("z"), { show: false, index: 3 })
    check("stack: a place added after one, shown and focused; or behind, at an index", own(added) === "a ^z x y|b" && added.focus === "z" && own(behind) === "^a x y z|b" && behind.focus === "a",
      [own(added), own(behind)])
    const gone1 = lay.tabWithout(sx, new Set(["a"])), gone2 = lay.tabWithout(S("tx", row("s0", [stk(a, [x], 1), b]), "a"), new Set(["a"]))
    check("stack: the shown place closed, the one after it shows (else before), focused; a stacked one closed, nothing moves",
      own(gone1) === "^x y|b" && gone1.focus === "x" && own(gone2) === "x|b" && own(lay.tabWithout(sx, new Set(["y"]))) === "^a x|b", [own(gone1), own(gone2)])
    check("stack: a pane's places all closed, the pane goes", desc(lay.tabWithout(sx, new Set(["a", "x", "y"])).root) === "b")
    const fl2 = { x: 0.5, y: 0.1, w: 0.4, h: 0.5 }
    check("stack: a floating pane's float stays where it is, with what it shows", same(lay.showingPlace(S("tx", row("s0", [{ ...stk(a, [x]), float: fl2 }, b]), "a"), "x").root.kids[0].float, fl2))
    const sp1 = lay.spilled({ tabs: [T("q"), { ...TP(stk(a, [x, y], 1)), group: "g" }], active: "ta" })
    check("stack: a tab of one pane can't hold one: its places are tabs of their own beside it, in its group, the shown one keeping it",
      sp1.tabs.map((t: Tb) => `${t.id}:${desc(t.root)}${t.group ? "@" + t.group : ""}`).join() === "tq:q,tx:x@g,ta:a@g,ty:y@g" && sp1.active === "ta", sp1)
    const read = lay.clean({ tabs: [S("tx", row("s0", [stk(a, [x, { ...y, float: fl2, stack: [c] }, x], 9), b]), "a"), T("x")], active: "tx" })
    check("stack: read back checked: no float or stack of its own, a place twice once, stackAt kept in range; a tab whose places are taken goes",
      own(read.tabs[0]) === "x y ^a|b" && read.tabs.length === 1 && !read.tabs[0].root.kids[0].stack[1].float && !read.tabs[0].root.kids[0].stack[1].stack, read)
    check("stack: a saved tab of one pane with a stack reads as tabs", lay.clean({ tabs: [TP(stk(a, [x]))], active: "ta" }).tabs.map((t: Tb) => desc(t.root)).join() === "a,x")

    // In the app: a split's pane opens its new tabs among its own.
    put([S("tx", row("s0", [a, pane("w", W)]), "a"), T("q")], "tx")
    ws.go("view:links")
    check("stack: in a split, what would open a new tab opens among the focused pane's tabs, shown; nothing new in the list",
      tabs() === "[view:links|view:web/https://example.com/]*,q" && own() === `a ^view:links|${W}`, [tabs(), own()])
    put([S("tx", row("s0", [a, b]), "a"), T("q")], "tx")
    const bg = ws.openTab("file:z.md", { background: true, from: "a" }), bg2 = ws.openTab("file:v.md", { background: true, from: "a" })
    check("stack: opened behind from a pane, it's stacked after it, the next after that one, as Chrome orders them; an agent's (no pane) is a tab in the list",
      own() === "^a z v|b" && ws.paneById(bg).from === "a" && !!bg2 && (ws.openTab("file:m.md", { background: true }), tabs() === "[a|b]*,m,q"), [own(), tabs()])
    ws.newTab()
    const blankId = focus()
    check("stack: ⌘T in a split, a blank tab of the focused pane; again, nothing more", own() === "a ^new z v|b" && (ws.newTab(), own() === "a ^new z v|b"), own())
    ws.go("file:c.md")
    check("stack: what's opened from it fills it", own() === "a ^c z v|b" && focus() === blankId, own())
    ws.selectPane(bg)
    check("stack: a stacked place selected shows in its pane, focused", own() === "a c ^z v|b" && focus() === bg, own())
    ws.go("file:c.md")
    check("stack: going to a place stacked in a pane shows it there", own() === "a ^c z v|b" && tabs() === "[c|b]*,m,q", [own(), tabs()])
    ws.cycleTab(1); const c1 = own(); ws.cycleTab(1); const c2 = own(); ws.cycleTab(1)
    check("stack: next tab goes through the focused pane's tabs, then on to the next tab", c1 === "a c ^z v|b" && c2 === "a c z ^v|b" && ws.activeTab().root.to === "file:m.md", [c1, c2, tabs()])
    ws.selectTab("tx"); ws.selectPane(bg2); ws.closePane()
    check("stack: closing the place shown, the pane's next shows (before it, at its end)", own() === "a c ^z|b" && focus() === bg, own())
    ws.reopenTab()
    check("stack: ⌘⇧T brings it back among them, where it was", own() === "a c z ^v|b" && focus() === bg2, own())
    ws.closePane("a"); ws.closePane(blankId)
    check("stack: a stacked one closed, the shown one stays", own() === "z ^v|b", own())
    ws.closePane(bg2); ws.closePane(bg)
    check("stack: its last place closed, the pane closes", tabs() === "b*,m,q", tabs())
    heard.length = 0
    ws.setTabCloser((_to: string, p: string, last: boolean) => { heard.push(`${p}${last ? " last" : ""}`); return false })
    put([S("tx", row("s0", [stk(pane("w1", W), [pane("w2", "view:web/https://example.net/")]), b]), "b")], "tx"); ws.closeTab("tx", true)
    check("stack: a split tab closed, the pages stacked in it hear it too", heard.join() === "w1 last,w2 last", heard)
    ws.setTabCloser(() => false)
    put([S("tx", row("s0", [stk(a, [x]), b]), "b")], "tx"); ws.closePane("b")
    check("stack: a split closed down to one pane, its tabs become tabs of their own", tabs() === "a*,x", tabs())
    put([S("tx", row("s0", [a, b]), "a"), T("q")], "tx"); sp.tabIntoPane("tq", "b", "center")
    check("stack: a tab dropped on a split's pane (or ⌥-clicked) is one of its tabs, what it showed behind it", tabs() === "[a|q]*" && own() === "a|b ^q" && focus() === "q", [tabs(), own()])
    put([S("tx", row("s0", [stk(a, [x, y]), b]), "a"), T("q")], "tx"); sp.openAt("file:k.md", "b", "center")
    const k = focus()
    check("stack: a file dropped on a split pane's middle opens among its tabs", own() === "^a x y|b ^k", own())
    sp.placeAmong("y", "a", 0)
    check("stack: a place dragged along its pane's list moves, what shows staying", own() === "y ^a x|b ^k", own())
    sp.placeAmong("x", k, 0)
    check("stack: dragged onto another pane's list, it's shown there, focused", own() === "y ^a|^x b k" && focus() === "x", own())
    sp.placeAmong("q", k, 1)
    check("stack: a tab of the list dragged onto a pane's list joins it", own() === "y ^a|x ^q b k" && tabs() === "[a|q]*", [own(), tabs()])
    sp.paneToTab("y")
    check("stack: a place dragged out to the list is a tab of its own, shown", tabs() === "[a|q],y*" && own(ws.tabById("tx")) === "a|x ^q b k", [tabs(), own(ws.tabById("tx"))])
    ws.selectTab("tx"); sp.paneIntoPane("q", "a", "right", true)
    check("stack: a place dragged onto a pane's edge is a pane of its own there, its pane showing its next", tabs() === "[a|q|b]*,y" && own() === "a|q|x ^b k", [tabs(), own()])
    sp.paneIntoPane("b", "a", "left")
    check("stack: a pane dragged by its bar moves with its tabs", own() === "x ^b k|a|q", own())
    ws.retarget("k.md", "Done/k.md")
    check("stack: a file moved, its stacked places follow", own() === "x ^b Done/k|a|q", own())
    check("stack: the place a pane shows onto its own pane: not its middle, nor the edge of one with no other",
      !sp.canPaneIntoPane("b", "b", "center", true) && !sp.canPaneIntoPane("a", "a", "right", true) && !sp.canPaneIntoPane("b", "b", "right") && sp.canPaneIntoPane("b", "b", "right", true))
    sp.paneIntoPane("b", "b", "bottom", true)
    check("stack: the place a pane shows onto its own pane's edge splits off there, its pane showing its next", own() === "x ^Done/k|b|a|q" && tabs() === "[[Done/k/b]|a|q]*,y" && focus() === "b", [own(), tabs()])
  }

  // ---- Workspaces holding the tabs (a layout turning it on and off): this device's own come back as they were ----
  const stub = g.localStorage
  g.localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) }
  put([T("a", undefined, { group: "g1" }), S("tb", row("s0", [b, col("s1", [c, d], [0.7, 0.3])], [0.25, 0.75]), "c", { group: "g1" }), T("e", undefined, { group: "g2" })], "tb",
    { groups: [{ id: "g1", name: "Trip", color: "teal" }, { id: "g2", name: "Later", color: "red", collapsed: true }] })
  const mine = JSON.stringify(ws.getWorkspace())
  const took = ws.tabsInWorkspace(true), again = ws.tabsInWorkspace(true)
  put([T("w")], "tw")
  check("workspaces: held, what's shown is saved apart; this device's own stay as they were", took && !again && mem.get("vaultite.tabs") === mine
    && JSON.parse(mem.get("vaultite.tabs.workspace") ?? "{}").active === "tw", [took, again])
  ws.tabsInWorkspace(false)
  check("workspaces: let go, this device's tabs, groups, splits, sizes and focus come back exactly", same(ws.getWorkspace(), JSON.parse(mine)) && !mem.has("vaultite.tabs.workspace"),
    [ws.getWorkspace(), mine])
  g.localStorage = stub
}

// ---------- Browser: a tab owns its page (electron/webpages.ts) ----------
{
  const wp = await import("../electron/webpages.ts")
  type P = { id: number; win: string; tab: string; profile: string; holds: number; closing: boolean; let: number; orphan?: number; moving?: number; agent?: boolean }
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
  const r4 = page("t10")
  wp.windowReloaded([r4], "w", 1000)
  check("pages: …but an agent's, in a tab in the background, waits on for its tab (its work and its ask go on)",
    !wp.unclaimed([r4], 1000 + wp.RECLAIM_MS, (p) => p === r4).length && r4.orphan === undefined && wp.claim([r4], "w", "t10", "").reuse === r4)
  const m1 = page("t8", { holds: 0 }), m2 = page("t8", { win: "w2", holds: 0 })
  wp.tabMoved([m1], "w", "t8", 1000)
  check("pages: a tab moved to another window takes its page there, live", m1.moving === 1000 && wp.claim([m1], "w2", "t8", "").reuse === m1 && m1.moving === undefined)
  check("pages: …another window's tab of that id doesn't, unless it moved", wp.claim([m2], "w", "t8", "").reuse === null)
  wp.tabMoved([m1], "w", "t8", 2000)
  check("pages: one moved and never taken ends", !wp.unmoved([m1], 2000 + wp.MOVE_MS - 1).length && wp.unmoved([m1], 2000 + wp.MOVE_MS)[0] === m1)
  const mine = page("", { agent: true, holds: 0 })
  check("pages: an agent's in the background stays through a window reload, never orphaned", !wp.windowReloaded([mine], "w", 1000).length && mine.orphan === undefined)
  mine.holds = 1
  check("pages: an agent's peeked and let go of stays; opened as a tab, it's that tab's", !wp.letGo(mine, 2) && (mine.tab = "t9", mine.agent = false, wp.claim([mine], "w", "t9", "").reuse === mine))
  const bg = Array.from({ length: wp.KEEP + 3 }, (_, i) => page(`b${i}`, { holds: 0, let: i }))
  const out = wp.discardable([...bg, page("x"), page("", { agent: true, holds: 0, let: -1 })], (p: P) => p.tab === "b0")
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
  const two = wp.playback()
  wp.media(two, true, false)
  wp.hear(two, true, 0)
  wp.media(two, false, true)
  check("sound: one of two media paused while the other plays on comes back past the linger (audible never dropped)",
    !wp.playing(two, true, 100) && wp.outlasted(two, true) && wp.playing(two, true, wp.LINGER_MS) && two.media)
  const gone = wp.playback()
  wp.hear(gone, true, 0)
  wp.media(gone, false, true)
  check("sound: a pause whose sound faded with the linger stays ended", !wp.outlasted(gone, false) && !wp.playing(gone, false, wp.LINGER_MS))
  const g = wp.playback()
  wp.hear(g, true, 0)
  wp.hear(g, false, 1000)
  check("sound: without media (a game) a quiet stretch still plays, then ends",
    wp.playing(g, false, 1000 + wp.QUIET_MS - 1) && !wp.playing(g, false, 1000 + wp.QUIET_MS))
  wp.hear(g, true, 20_000)
  check("sound: a new sound ends its quiet stretch", wp.playing(g, true, 20_000) && g.quiet === undefined)
}

// ---------- Slides: a note as a deck, read as Advanced Slides reads one (plugins/core/slides/slides.ts) ----------
{
  const { cssFiles, cssPlaces, cssUrls, parseDeck, sizeOf, isTitleSlide, scopeCss, scopeSelector, upcoming, elapsedText, templateNames } = await import("../plugins/core/slides/slides.ts")
  const mds = (body: string, opts = {}) => parseDeck(body, opts).slides.map((s) => s.md)
  const got = mds("# Launch\n\n---\n\n## Why\n- one\n\n----\n```md\n---\nnot a split\n```\n---\n\n---\n![[chart.png]]\n")
  check("slides: split at --- lines, never inside code, empty ones dropped", got.length === 4 && got[0] === "# Launch" && got[2].includes("not a split") && got[3] === "![[chart.png]]", got)
  check("slides: a note without --- is one slide", mds("Just text\n").length === 1)
  check("slides: headings only (and a short line) is a title slide", isTitleSlide("# Launch\nQ3 plan") && !isTitleSlide("# Plan\n- one\n- two") && !isTitleSlide("Text only"))

  const deck = parseDeck("<style>\n.reveal h1 { color: red }\n</style>\n\n# Hi\n\nnotes:\nSay hi.\n\n- and this\n\n---\n# One\n--\n# One, below\nNote: under it\n---\n```\nnote: in code\n```\n")
  const [a, b, c, d] = deck.slides
  check("slides: notes: to the end of the slide are its notes, not on it", a.md === "# Hi" && a.notes === "Say hi.\n\n- and this" && c.notes === "under it" && !d.notes && d.md.includes("note: in code"), deck.slides)
  check("slides: -- makes vertical slides, in their column", deck.slides.length === 4 && b.h === 1 && b.v === 0 && c.h === 1 && c.v === 1 && d.h === 2, deck.slides.map((s) => [s.h, s.v]))
  check("slides: a <style> is the deck's, off its slide", deck.css === ".reveal h1 { color: red }" && !a.md.includes("style"))
  check("slides: a <style> in a %% comment is left out", parseDeck("%%\n<style>h1{}</style>\n%%\n# A").css === "")
  const custom = parseDeck("# A\n\n===\n\n# B\n>>\n# C\n??? said\n", { separator: "^===$", verticalSeparator: "\\n>>\\n", notesSeparator: "\\?\\?\\?" })
  check("slides: frontmatter's separator, verticalSeparator and notesSeparator", custom.slides.length === 3 && custom.slides[2].v === 1 && custom.slides[2].notes === "said", custom.slides)
  check("slides: a bad separator regex is matched as text", mds("a\n(\nb", { separator: "(" }).length === 2)

  const [bgd, frag, lst] = parseDeck('<!-- slide bg="[[pic.png]]" data-background-opacity="0.5" -->\n## Pic\n---\n<!-- .slide: class="big" style="color: red" -->\nFade in <!-- element class="fragment" data-fragment-index="2" -->\n---\n- Always\n+ First\n+ Second\n1) Third\n').slides
  check("slides: <!-- slide bg --> is the slide's background, its data-background-* its look", bgd.bg === "[[pic.png]]" && bgd.bgAttrs.opacity === "0.5" && bgd.md === "## Pic", bgd)
  const codeNote = parseDeck('Short syntax: `![](fas fa-envelope)<!-- .element: color="coral" -->`, as written').slides[0]
  check("slides: an annotation inside inline code is shown, not applied", codeNote.md === 'Short syntax: `![](fas fa-envelope)<!-- .element: color="coral" -->`, as written' && !codeNote.els.length, codeNote)
  const quoteNote = parseDeck('> [!tip] A tip\n> Its text\n<!-- element style="width:40%" -->\n\nAfter').slides[0]
  check("slides: an annotation right under a callout is the callout's, not its last line's", /Its text\n\n<span class="slide-el-0"><\/span>/.test(quoteNote.md) && quoteNote.els[0].style.includes("width:40%"), quoteNote.md)
  check("slides: <!-- .slide: --> gives the slide a class and style", frag.cls === "big" && frag.style === "color: red")
  check("slides: an element annotation is a marker where it was", frag.md === 'Fade in <span class="slide-el-0"></span>' && frag.els[0].cls === "fragment" && frag.els[0].index === 2, frag)
  check("slides: + and 1) list items are fragments, - ones aren't", lst.els.length === 3 && lst.els.every((e) => e.li && e.cls === "fragment") && !lst.md.split("\n")[0].includes("slide-el"), lst)
  const lay = (body: string) => parseDeck(body).slides[0]
  const sp = lay("<split even gap=\"3\">\n\n![[a.png]]\n![[b.png]]\n</split>\n::: block\nC\n:::")
  const [split, block] = sp.boxes as any[]
  check("slides: <split even gap>: a row whose items share it, 3em apart; each image line its own item", split.kind === "split" && split.style.includes("--split-gap: 3em") && split.kids.includes("flex: 1")
    && split.in.length === 1 && split.in[0] === "![[a.png]]\n\n![[b.png]]" && !sp.canvas, sp.boxes)
  check("slides: ::: block is a block box, its Markdown kept (and the slide's md is all of it, in order)", block.kind === "block" && block.cls === "block" && block.in[0] === "C" && sp.md === "![[a.png]]\n\n![[b.png]]\n\nC", sp)
  const lr = lay("<split left=\"2\" right=\"1\">\nA\n\nB\n</split>").boxes![0] as any, wr = lay("<split wrap=\"4\" no-margin>\nA\n</split>").boxes![0] as any
  check("slides: <split left right>: its first and second items' shares; wrap: so many to a row; no-margin: no gaps", JSON.stringify(lr.nth.slice(0, 2)) === '["flex: 2","flex: 1"]'
    && lr.style.includes("--split-gap: 0px") && wr.kids.includes("calc((100% - var(--split-gap) * 3) / 4)") && wr.kids.includes("margin: 0"), { lr, wr })
  const nest = lay("<grid drag=\"40 30\" drop=\"topleft\">\n<split even>\nA\n\nB\n</split>\n</grid>\n<split>\n<split>\nX\n</split>\n</split>")
  check("slides: layouts nest (a split in a grid, a split in a split)", nest.canvas && (nest.boxes![0] as any).in[0].kind === "split" && (nest.boxes![1] as any).in[0].kind === "split" && (nest.boxes![1] as any).in[0].in[0] === "X", nest.boxes)
  // (Advanced Slides' own test decks, test/gridComponent.unit.test.ts, and the styles its snapshots have)
  const place = (drag: string, drop: string) => (lay(`<grid ${drag ? `drag="${drag}" ` : ""}drop="${drop}">\nA\n</grid>`).boxes![0] as any).style.match(/left: [^;]+; top: [^;]+; width: [^;]+; height: [^;]+/)?.[0]
  check("slides: a grid's drop: x y, negative from the right and bottom, px of a 960 x 700 slide, named places; drag its size (50 x 100 when left out)",
    place("60 55", "5 10") === "left: 5%; top: 10%; width: 60%; height: 55%" && place("25 55", "-5 10") === "left: 70%; top: 10%; width: 25%; height: 55%"
    && place("30 30", "-40px 40px") === "left: 65.833%; top: 5.714%; width: 30%; height: 30%" && place("40 40", "-5 -20") === "left: 55%; top: 40%; width: 40%; height: 40%"
    && place("", "right") === "left: 50%; top: 0%; width: 50%; height: 100%" && place("55 50", "topright") === "left: 45%; top: 0%; width: 55%; height: 50%"
    && place("25 20", "center") === "left: 37.5%; top: 40%; width: 25%; height: 20%" && place("80 30", "bottom") === "left: 10%; top: 70%; width: 80%; height: 30%", place("30 30", "-40px 40px"))
  const sized = (parseDeck('<grid drag="480px 270px" drop="960px 540px">\nA\n</grid>', { width: 1920, height: 1080 }).slides[0].boxes![0] as any).style
  check("slides: a deck's width and height are what a drop's px are of", sized.includes("left: 50%; top: 50%; width: 25%; height: 25%"), sized)
  const sz = sizeOf({ width: "1280", height: 720, margin: 0.1, minScale: 0.2, maxScale: 3, center: false }), dz = sizeOf({ width: "wide", margin: 2 })
  check("slides: size and scale from frontmatter, Advanced Slides' size and the app's scale where unset or bad",
    sz.w === 1280 && sz.h === 720 && sz.margin === 0.1 && sz.minScale === 0.2 && sz.maxScale === 3 && !sz.center && dz.w === 960 && dz.h === 700 && dz.margin === undefined && dz.maxScale === undefined && dz.center, [sz, dz])
  const flexOf = (at: string) => (lay(`<grid drag="100 100" drop="0 0" ${at}>\nA\n</grid>`).boxes![0] as any).style.match(/flex-direction: [^;]+; align-items: [^;]+; justify-content: [^;]+/)?.[0]
  check("slides: a grid's flow and align place its items as Advanced Slides does", flexOf("") === "flex-direction: column; align-items: center; justify-content: center"
    && flexOf('flow="row" align="left"') === "flex-direction: row; align-items: center; justify-content: space-evenly" && flexOf('flow="col" align="left"') === "flex-direction: column; align-items: flex-start; justify-content: space-evenly"
    && flexOf('flow="col" align="bottomright"') === "flex-direction: column; align-items: flex-end; justify-content: flex-end" && flexOf('flow="row" align="top"') === "flex-direction: row; align-items: flex-start; justify-content: space-evenly"
    && flexOf('justify-content="space-between"') === "flex-direction: column; align-items: center; justify-content: space-between", flexOf('flow="row" align="top"'))
  const look = lay('<grid drag="30 25" drop="5 15" bg="#B565A7" filter="blur(10px)" rotate="-15" border="4px solid white" pad="0 50px" opacity="0.5" animate="fadeIn slower" frag="2">\nA\n</grid>\n+ One').boxes!
  const lg = look[0] as any
  check("slides: a grid's bg, filter, rotate, border, pad, opacity, animate and frag", lg.bg === "#B565A7" && ["filter: blur(10px)", "transform: rotate(-15deg)", "border: 4px solid white", "padding: 0 50px", "opacity: 0.5"].every((x) => lg.style.includes(x))
    && lg.cls === "fadeIn slower fragment" && lg.index === 2, lg)
  check("slides: a fragment list's items count from 1, beside a grid's frag", lay("+ One\n+ Two").els.map((e) => e.index).join() === "1,2")
  const st = lay("<grid drag=\"100 45\" drop=\"top\" flow=\"row\" align=\"stretch\">\nA\n</grid>").boxes![0] as any
  check("slides: align=\"stretch\" fills the grid with its items", st.cls === "stretch-row" && st.kids.includes("height: 100%; width: 1%"), st)
  const note = lay('### Noise <!-- element drag="55 50" drop="bottomright" bg="rgb(0,0,0)" -->')
  check("slides: an element annotation's drag, drop and bg place it too", note.canvas && note.els[0].bg === "rgb(0,0,0)" && note.els[0].style.includes("left: 45%; top: 50%"), note.els)
  const bl = lay('::: block <!-- element style="background-color: red;" -->\n\nred\n\n::: block <!-- element style="background-color: blue;" -->\n\nblue\n\n:::\n\nred\n\n:::\n\nno color').boxes!
  check("slides: ::: block <!-- element style -->: the block's style, blocks in blocks, what's after outside", (bl[0] as any).style === "background-color: red;" && (bl[0] as any).in[1].style === "background-color: blue;"
    && (bl[0] as any).in[1].in[0] === "blue" && (bl[0] as any).in[2] === "red" && bl[1] === "no color", bl)
  check("slides: layout tags inside code are text", !lay("```\n<split even>\n:::\n```").boxes && !lay("Use `<grid drop=\"center\">` here").boxes)

  const { moveOf } = await import("../plugins/core/slides/slides.ts")
  const tr = parseDeck('# A\n---\n<!-- slide data-transition="zoom" data-transition-speed="fast" data-background-transition="slide" bg="#000" -->\n# B\n--\n<!-- .slide: data-transition="fade-in convex-out" -->\n# C\n---\n<!-- slide data-auto-animate -->\n# T\n---\n<!-- slide data-auto-animate data-auto-animate-duration="2" -->\n# T\n## Sub <!-- element data-id="sub" data-auto-animate-delay="0.5" -->\n---\n<!-- slide data-auto-animate data-auto-animate-restart -->\n# T\n').slides
  check("slides: data-transition, -speed and data-auto-animate are the slide's data", tr[1].data.transition === "zoom" && tr[1].data["transition-speed"] === "fast" && tr[1].bgAttrs.transition === "slide" && tr[3].data["auto-animate"] === "" && !tr[1].md.includes("<!--"), tr[1])
  check("slides: an element annotation's data-* (data-id) are kept", tr[4].els[0]?.data?.id === "sub" && tr[4].els[0]?.data?.["auto-animate-delay"] === "0.5" && !("fragment-index" in (tr[4].els[0]?.data ?? {})), tr[4].els)
  const m01 = moveOf(tr[0], tr[1])
  check("slides: a slide comes in its own way, the one before leaves the deck's (slide), at their speeds", m01.in === "zoom" && m01.out === "slide" && m01.inMs === 400 && m01.outMs === 800 && !m01.vertical && !m01.back && !m01.auto, m01)
  check("slides: a background changing: its data-background-transition, else fade; the same one: none", m01.bg === "slide" && moveOf(tr[1], tr[0]).bg === "fade" && moveOf(tr[3], tr[4]).bg === "none" && moveOf(tr[3], tr[4], { bg: "#fff" }).bg === "none")
  const m12 = moveOf(tr[1], tr[2]), m21 = moveOf(tr[2], tr[1])
  check("slides: down a column is vertical; a pair like fade-in convex-out", m12.vertical && m12.in === "fade" && m12.out === "zoom" && m21.out === "convex" && m21.back && m21.vertical, [m12, m21])
  const fm = { transition: "concave", transitionSpeed: "slow", backgroundTransition: "zoom" }
  check("slides: frontmatter transition, transitionSpeed, backgroundTransition for the deck", moveOf(tr[0], tr[2], fm).in === "fade" && moveOf(tr[2], tr[3], fm).in === "concave" && moveOf(tr[2], tr[3], fm).inMs === 1200 && moveOf(tr[0], tr[1], fm).out === "concave" && moveOf(tr[1], tr[3], fm).bg === "zoom"
    && moveOf(tr[0], tr[3], { transition: "none" }).in === "none" && moveOf(tr[0], tr[3], { transition: "bogus" }).in === "slide")
  const auto = moveOf(tr[3], tr[4])
  check("slides: two data-auto-animate slides auto-animate, without a slide transition (duration in s, ease)", auto.auto?.ms === 2000 && auto.auto.easing === "ease" && auto.auto.unmatched && auto.in === "none" && auto.out === "none", auto)
  check("slides: auto-animate needs both, the same id, no restart on the later one, and autoAnimate not false",
    !moveOf(tr[2], tr[3]).auto && !moveOf(tr[4], tr[5]).auto && !moveOf(tr[5], tr[4]).auto && !!moveOf(tr[4], tr[3]).auto && !moveOf(tr[3], tr[4], { autoAnimate: false }).auto
    && moveOf(tr[3], tr[4], { autoAnimateUnmatched: false }).auto?.unmatched === false && moveOf(tr[4], tr[3], { autoAnimateDuration: 0.5 }).auto?.ms === 500)
  const ids = parseDeck('<!-- slide data-auto-animate data-auto-animate-id="a" -->\n# X\n---\n<!-- slide data-auto-animate data-auto-animate-id="b" -->\n# X\n').slides
  check("slides: different data-auto-animate-ids don't auto-animate", !moveOf(ids[0], ids[1]).auto)

  const tpls: Record<string, string> = {
    "tpl-footer": "<% content %>\n\n<grid drag=\"100 6\" drop=\"bottom\">\n<% footer %>\n</grid>",
    "tpl-opt": "<% content %>\n\n<%? source %>\n<style>.src { color: red }</style>",
    "tpl-outer": "# Outer\n<% content %>", "tpl-inner": "<!-- slide template=\"[[tpl-outer]]\" -->\n## Inner\n<% content %>",
  }
  const tdeck = parseDeck('<!-- slide template="[[tpl-footer]]" bg="red" -->\n# Main\n\n::: footer\n#### Foot\n:::\n\nnote: say it\n---\n<!-- slide template="[[tpl-opt]]" -->\nNo source\n---\n<!-- slide template="[[tpl-inner]]" -->\nText\n---\n<!-- slide template="[[missing]]" -->\nAs is\n', {}, (n) => tpls[n])
  const [t1, t2, t3, t4] = tdeck.slides
  const flat = (md: string) => md.replace(/\n+/g, "\n")
  check("slides: a template draws the slide as its <% content %>, a ::: name block as <% name %>, notes kept the slide's",
    flat(t1.md) === "# Main\n#### Foot" && /"kind":"grid".*Foot/.test(JSON.stringify(t1.boxes)) && t1.notes === "say it" && t1.bg === "red", t1)
  check("slides: a template's unset <%? name %> is left out, its <style> the deck's", t2.md === "No source" && tdeck.css.includes(".src"), [t2.md, tdeck.css])
  check("slides: a template may use a template; a missing one leaves the slide as written", flat(t3.md) === "# Outer\n## Inner\nText" && t4.md === "As is", [t3.md, t4.md])
  const dflt = parseDeck("# A\n---\n<!-- slide template=\"[[tpl-outer]]\" -->\nB\n", { defaultTemplate: "[[tpl-inner]]" }, (n) => tpls[n]).slides
  check("slides: defaultTemplate is every slide's, unless it names its own", flat(dflt[0].md) === "# Outer\n## Inner\n# A" && flat(dflt[1].md) === "# Outer\nB", dflt.map((x) => x.md))
  check("slides: the templates a deck names, defaultTemplate first", JSON.stringify(templateNames('x <!-- slide template="[[a]]" --> <!-- .slide: template="[[b|B]]" -->', { defaultTemplate: "[[c]]" })) === '["c","a","b"]')
  check("slides: the deck's CSS: the page and .reveal are the deck", scopeSelector(":root", "[d]") === "[d]" && scopeSelector(".reveal .slides section h1, .x", "[d]") === "[d] h1, [d] .x"
    && scopeSelector(".reveal.dark p", "[d]") === "[d].dark p" && scopeSelector("html .a", "[d]") === "[d] .a" && scopeSelector(":is(a, b) > c", "[d]") === "[d] :is(a, b) > c")
  const sc = scopeCss("@import url(x.css);\n/* c } */ body { margin: 0 }\n@media (min-width: 1px) { .reveal h2 { color: blue } }\n@font-face { font-family: X; }\n@page { size: A4 }\n.a::after { content: \"}\" }", "[d]")
  check("slides: the deck's CSS stays in the deck (@media scoped, @import and @page dropped)",
    sc.includes("[d] { margin: 0 }") && sc.includes("@media (min-width: 1px) {\n[d] h2 { color: blue }") && sc.includes("@font-face") && !sc.includes("@import") && !sc.includes("A4") && sc.includes('[d] .a::after { content: "}" }'), sc)
  check("slides: css: files (a list or commas) after a theme that's a file or an address; a theme's name isn't one",
    JSON.stringify(cssFiles({ theme: "css/my-theme.css", css: "a.css, [[b.css]]" })) === '["css/my-theme.css","a.css","b.css"]'
    && JSON.stringify(cssFiles({ theme: "night", css: ["x.css", "not css"] })) === '["x.css"]' && cssFiles({ theme: "https://t.example/robot.css" }).length === 1, cssFiles({ theme: "css/my-theme.css", css: "a.css, [[b.css]]" }))
  check("slides: a css: file beside the note, from the root, then in Advanced Slides' folder",
    JSON.stringify(cssPlaces("css/x.css", "Talks/Deck.md")) === '["Talks/css/x.css","css/x.css",".obsidian/plugins/obsidian-advanced-slides/css/x.css"]'
    && JSON.stringify(cssPlaces("../s.css", "A/B/Deck.md").slice(0, 1)) === '["A/s.css"]' && JSON.stringify(cssPlaces("/s.css", "A/Deck.md")) === '["s.css"]', cssPlaces("css/x.css", "Talks/Deck.md"))
  const urls = cssUrls("a { background: url('img/b.png') } b { src: url(https://f.example/x.woff2) } c { mask: url(#m) } d { x: url(data:image/png;base64,AA) }", "Talks/css", (p) => `raw:${p}`)
  check("slides: a stylesheet's relative url()s load from beside it, addresses kept", urls.includes('url("raw:Talks/css/img/b.png")') && urls.includes("url(https://f.example/x.woff2)") && urls.includes("url(#m)") && urls.includes("url(data:image"), urls)

  const up = (at: number, step: number, count: number) => JSON.stringify(upcoming(at, step, count, 3))
  check("slides: the presenter's next: the next fragment, else the next slide (none after the last)", up(0, 0, 2) === '{"at":0,"step":1}'
    && up(0, 2, 2) === '{"at":1,"step":0}' && up(1, Infinity, 1) === '{"at":2,"step":0}' && up(2, 0, 0) === "null" && up(2, 0, 1) === '{"at":2,"step":1}')
  check("slides: the presenter's timer", elapsedText(0) === "0:00" && elapsedText(245_900) === "4:05" && elapsedText(3_845_000) === "1:04:05" && elapsedText(-5) === "0:00")
}

// ---------- Slides themes: reveal's and Advanced Slides' themes in the app's colours (plugins/core/slides/themes.ts) ----------
{
  const { revealTheme, THEME_NAMES } = await import("../plugins/core/slides/themes.ts")
  const all = ["black", "white", "league", "beige", "sky", "night", "serif", "simple", "solarized", "blood", "moon", "dracula", "black-contrast", "white-contrast", "consult", "mattropolis"]
  const th = (n: string) => revealTheme(n)!
  check("slides themes: every reveal and Advanced Slides theme is one", all.every((n) => THEME_NAMES.includes(n) && revealTheme(n)?.name === n) && THEME_NAMES.length === all.length, THEME_NAMES)
  const dark = THEME_NAMES.filter((n) => th(n).tone === "dark")
  check("slides themes: their tone", dark.join() === "black,black-contrast,league,night,moon,blood,dracula,mattropolis", dark)
  check("slides themes: by name in any case, default is black; a CSS file, an unknown name or none keep the app's look", th(" Night ").name === "night" && th("Default").name === "black"
    && [undefined, "", 3, "css/my-theme.css", "https://x.test/robot.css", "constructor", "__proto__"].every((n) => revealTheme(n) === null))
  const KEYS = ["--r-background-color", "--r-main-font", "--r-main-font-size", "--r-main-color", "--r-heading-font", "--r-heading-color", "--r-heading-text-transform", "--r-heading1-size", "--r-heading1-font-weight", "--r-link-color"]
  check("slides themes: each sets reveal's --r-* vars", all.every((n) => KEYS.every((k) => th(n).vars[k])), all.filter((n) => !KEYS.every((k) => th(n).vars[k])))
  const hex = all.filter((n) => Object.values(th(n).vars).some((v) => /#[0-9a-f]{3,8}\b/i.test(v)))
  check("slides themes: colours come from the app's tokens, never hex", !hex.length && all.every((n) => /var\(--/.test(th(n).vars["--r-link-color"]) && /var\(--|^white$/.test(th(n).vars["--r-background-color"])), hex)
  const [black, night, serif, league, dracula, sky] = ["black", "night", "serif", "league", "dracula", "sky"].map(th)
  check("slides themes: black: Source Sans, upper case, semibold, blue links", black.vars["--r-heading-font"].startsWith("'Source Sans Pro'") && black.vars["--r-heading-text-transform"] === "uppercase"
    && black.vars["--r-heading2-font-weight"] === "600" && black.vars["--r-link-color"] === "var(--blue)", black.vars)
  check("slides themes: night: Montserrat, tight, as written, a gold accent", night.vars["--r-heading-font"].startsWith("Montserrat") && night.vars["--r-heading-letter-spacing"] === "-0.03em"
    && night.vars["--r-heading-text-transform"] === "none" && /--orange.*--yellow/.test(night.vars["--r-link-color"]))
  check("slides themes: serif: Palatino for headings and text", /Palatino/.test(serif.vars["--r-heading-font"]) && serif.vars["--r-main-font"] === serif.vars["--r-heading-font"] && serif.vars["--r-heading-text-transform"] === "none")
  check("slides themes: league: League Gothic, its 3D title and glow", league.vars["--r-heading-font"].startsWith("'League Gothic'") && /0 5px 0/.test(league.vars["--r-heading1-text-shadow"]) && !!league.vars["--deck-glow"])
  check("slides themes: dracula: purple headings, pink links, its coloured bold, italics and code", dracula.vars["--r-heading-color"] === "var(--purple)" && dracula.vars["--r-link-color"] === "var(--pink)"
    && dracula.vars["--r-bold-color"] === "var(--orange)" && dracula.vars["--r-inline-code-color"] === "var(--green)")
  check("slides themes: reveal's text and heading sizes (px of a 960-wide slide)", black.vars["--r-main-font-size"] === "42px" && black.vars["--r-heading1-size"] === "2.5em"
    && league.vars["--r-main-font-size"] === "40px" && league.vars["--r-heading1-size"] === "3.77em" && th("consult").vars["--r-main-font-size"] === "16px" && th("mattropolis").vars["--r-main-font-size"] === "24px")
  check("slides themes: sky: rounded headings; consult: smaller text than black", /--font-rounded/.test(sky.vars["--r-heading-font"]) && parseFloat(th("consult").vars["--r-main-font-size"]) < parseFloat(black.vars["--r-main-font-size"]))
}

// ---------- Browser: what's typed in the address bar (plugins/core/web-viewer/address.ts) ----------
{
  const { addressOf, guessedHttps, hostOf, httpFallback, siteName } = await import("../plugins/core/web-viewer/address.ts")
  check("Browser: a group of a site's tabs is named after it, none for this machine", siteName("https://www.github.com/a") === "Github"
    && siteName("https://news.bbc.co.uk/") === "Bbc" && siteName("http://localhost:3000/") === null && siteName("http://192.168.1.2/") === null)
  check("Browser: an address with its scheme as it is", addressOf(" https://example.com/a?b=1#c ") === "https://example.com/a?b=1#c")
  check("Browser: a host gets https", addressOf("example.com/posts") === "https://example.com/posts" && addressOf("sub.example.co.uk") === "https://sub.example.co.uk/")
  check("Browser: this machine and IP addresses get http", addressOf("localhost:3000/x") === "http://localhost:3000/x" && addressOf("127.0.0.1:8080") === "http://127.0.0.1:8080/")
  check("Browser: words are a search", addressOf("open source notes") === "https://duckduckgo.com/?q=open%20source%20notes"
    && addressOf("notes", "https://search.example/?s=%s") === "https://search.example/?s=notes")
  check("Browser: other schemes and nothing are refused", addressOf("file:///etc/hosts") === null && addressOf("javascript:alert(1)") === null && addressOf("  ") === null)
  check("Browser: a name with a port and the local network's names get http", addressOf("nas:5000") === "http://nas:5000/" && addressOf("home-macbook-air-m1:8080/x") === "http://home-macbook-air-m1:8080/x"
    && addressOf("printer.local") === "http://printer.local/" && addressOf("router.lan") === "http://router.lan/" && addressOf("box.home.arpa") === "http://box.home.arpa/" && addressOf("app.test") === "http://app.test/")
  check("Browser: a guessed https falls back to http only when it can't connect", guessedHttps("example.com") && !guessedHttps("https://example.com") && !guessedHttps("open notes") && !guessedHttps("nas:5000")
    && httpFallback("https://example.com/a", "ERR_CONNECTION_REFUSED") === "http://example.com/a" && httpFallback("https://example.com/", "ERR_CERT_AUTHORITY_INVALID") === "http://example.com/"
    && httpFallback("https://example.com/", "ERR_NAME_NOT_RESOLVED") === null)
  check("Browser: a tab's name before the page's title is its site", hostOf("https://www.example.com/a") === "example.com" && hostOf("nonsense") === "nonsense")
}

// ---------- Browser: where a page opens (plugins/core/web-viewer/where.ts) ----------
{
  const { containerNamed, linkChoice, whereIn } = await import("../plugins/core/web-viewer/where.ts")
  const list = [{ id: "personal", name: "Personal" }, { id: "work", name: "Work" }, { id: "agents", name: "PersonalAgents", sites: ["google.com"] }]
  const doc = "https://docs.google.com/document/d/1", at = (container?: string | null, own?: string | null) =>
    whereIn(list, doc, { from: null, fresh: true, chosen: linkChoice(list, container), own }).container
  check("Browser: a container is named by its id or its name in any case", containerNamed(list, "work")?.id === "work" && containerNamed(list, " personalagents ")?.id === "agents"
    && containerNamed(list, "Nope") === null && containerNamed(list, "") === null)
  check("Browser: a link's container beats its site's rule and the workspace's, none (null) too", at("Work") === "work" && at("work", "personal") === "work" && at(null) === null && at(null, "work") === null)
  check("Browser: a container no one is called leaves the link to the site's rule, then the workspace's", at("Nope") === "agents" && at(undefined) === "agents"
    && whereIn(list, "https://example.com/", { from: null, fresh: true, chosen: linkChoice(list, "nope"), own: "personal" }).container === "personal")
}

// ---------- Browser: which container another app's link opens in, and a tab moved mid sign-in (where.ts, core/signin.ts, electron/webpages.ts) ----------
{
  const { byLogins, linkRuleIn, movedFrom, ruleSiteOf } = await import("../plugins/core/web-viewer/where.ts")
  const { signInOf } = await import("../core/signin.ts")
  const { flowOn } = await import("../electron/webpages.ts")
  const auth = "https://accounts.google.com/o/oauth2/v2/auth?client_id=1.apps.example&redirect_uri=https%3A%2F%2Fapi.lighthouse.app%2Fauth%2Fcallback&response_type=code&state=x"
  check("sign-in: an OAuth request, SAML's and OpenID's, by their fields alone; a page with a stray client_id isn't one",
    JSON.stringify(signInOf(auth)) === JSON.stringify({ host: "accounts.google.com", back: "https://api.lighthouse.app/auth/callback" })
    && signInOf("https://login.example.com/saml?SAMLRequest=abc")?.host === "login.example.com"
    && signInOf("https://id.example.org/server?openid.mode=checkid_setup&openid.return_to=https%3A%2F%2Fa.example.com%2F")?.back === "https://a.example.com/"
    && signInOf("https://shop.example.com/item?client_id=7") === null && signInOf("https://api.lighthouse.app/auth/start?lighthouse_state=1") === null
    && signInOf("https://idp.example.com/a?client_id=1&redirect_uri=javascript:alert(1)")?.back === "" && signInOf("not a url") === null)
  const list = [{ id: "personal", name: "Personal" }, { id: "alt", name: "Alternative", sites: ["lighthouse.app"] }, { id: "agents", name: "Agents", sites: ["google.com"] }]
  check("link from an app: a sign-in's rule is the site it signs in to's, before the identity provider's own; else the link's site's",
    linkRuleIn(list, auth) === "alt" && ruleSiteOf(auth) === "lighthouse.app"
    && linkRuleIn(list, "https://accounts.google.com/o/oauth2/v2/auth?client_id=1&redirect_uri=https://other.example.com/cb") === "agents"
    && linkRuleIn(list, "https://docs.lighthouse.app/a") === "alt" && linkRuleIn(list, "https://example.com/") === null && ruleSiteOf("https://www.example.com/a") === "example.com")
  check("link from an app: one set of logins signed in opens there (none, the workspace's, too), several ask in their order, none leaves it to the rules",
    JSON.stringify(byLogins(["alt"])) === JSON.stringify({ open: "alt" }) && JSON.stringify(byLogins([null])) === JSON.stringify({ open: null })
    && JSON.stringify(byLogins([null, "personal", "alt", "alt"])) === JSON.stringify({ ask: [null, "personal", "alt"] }) && JSON.stringify(byLogins([])) === "{}")
  const site = (h: string) => h.split(".").slice(-2).join(".")
  const start = "https://api.lighthouse.app/auth/start?lighthouse_state=1"
  let f = flowOn({ opened: start }, start, false, site)
  f = flowOn(f, auth, false, site)
  check("flow: an app's auth start reaching another site's sign-in by redirects notes its identity provider, its start kept",
    f.opened === start && f.signIn === "google.com", f)
  check("flow: the user pressing in the page before it moves on ends it; a sign-in on its own site isn't another's; no flow stays none",
    JSON.stringify(flowOn(f, "https://accounts.google.com/signin/next", true, site)) === "{}"
    && flowOn({ opened: "https://app.example.com/" }, "https://auth.example.com/authorize?client_id=1&response_type=code", false, site).signIn === undefined
    && JSON.stringify(flowOn({}, auth, false, site)) === "{}")
  check("moved to another container: from where its flow began while the user hasn't moved it on, else where it is",
    movedFrom({ url: "https://accounts.google.com/v3/signin", opened: start }, "x") === start && movedFrom({ url: "https://a.example.com/" }, "x") === "https://a.example.com/"
    && movedFrom({ url: "" }, "https://b.example.com/") === "https://b.example.com/")
}

// ---------- Browser: the bookmarks note (plugins/core/web-viewer/bookmarks.ts) ----------
{
  const { addBookmarks, editBookmark, matchBookmarks, readBookmarks, removeBookmark } = await import("../plugins/core/web-viewer/bookmarks.ts")
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
  const gone = removeBookmark(note, "https://bare.example.com/a")
  check("bookmarks: removed, only its line (its folder stays, a code block's look-alike too)", gone.removed === 1 && gone.body === note.replace("* <https://bare.example.com/a>\n", ""), gone)
  const renamed = editBookmark(note, "https://later.example.com/", { title: "Kept [for] later" })
  check("bookmarks: renamed in its line, its list mark and tick kept", renamed.changed && renamed.body === note.replace("[Done \\] it]", "[Kept \\[for\\] later]"), renamed)
  const moved = editBookmark(note, "https://top.example.com/", { folder: "Reading" })
  check("bookmarks: moved to another folder, under its heading", moved.changed && JSON.stringify(readBookmarks(moved.body).find((b) => b.url === "https://top.example.com/")) === JSON.stringify({ url: "https://top.example.com/", title: "Top", folder: "Reading" })
    && readBookmarks(moved.body).length === 3, moved.body)
  check("bookmarks: an edit of nothing, or of an address not there, changes nothing", !editBookmark(note, "https://top.example.com/", { title: "Top", folder: "" }).changed
    && !editBookmark(note, "https://none.example.com/", { title: "X" }).changed && removeBookmark(note, "https://none.example.com/").removed === 0)
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

// ---------- Dictation: said words joined to what's before them (web/src/core/dictation.ts) ----------
{
  const { joinText } = await import(pathToFileURL(path.join(WEB, "..", "..", "core", "dictationtext.ts")).href)
  check("dictation: a space after a word", joinText("Shopping:", "Remember milk") === " Remember milk")
  check("dictation: none at a line's start or after a space", joinText("", "Hello") === "Hello" && joinText("one ", " two") === "two" && joinText("a\n", "b") === "b")
  check("dictation: none before punctuation, nor after an opening bracket", joinText("word", ", then") === ", then" && joinText("(", "aside") === "aside")
  check("dictation: an engine's leading space (Parakeet's words) taken as a word break", joinText("quick", " brown fox") === " brown fox")
  check("dictation: nothing said, nothing typed", joinText("x", "  ") === "")
  const { replacer } = await import(pathToFileURL(path.join(WEB, "..", "..", "core", "dictationtext.ts")).href)
  const swap = (t: string, lines = ["at Claude: @claude"]) => replacer(lines).reduce((x: string, [re, to]: [RegExp, string]) => x.replace(re, to), t)
  check("dictation: a replacement, whatever its case and spacing", swap("At Claude, can you look?") === "@claude, can you look?" && swap("ask at  claude now") === "ask @claude now")
  check("dictation: whole words only, and never twice", swap("chat Claude") === "chat Claude" && swap("@claude") === "@claude" && swap("at Claudette") === "at Claudette")
  check("dictation: a line without its colon is ignored; $ written as is", swap("at Claude", ["nonsense"]) === "at Claude" && swap("five dollars", ["five dollars: $5"]) === "$5")
}

// ---------- The companion's soft cues (web/src/core/cues.ts): an audio context stood in, nothing plays ----------
{
  const { playCue, cueLength, CUE_PEAK } = await import("../web/src/core/cues.ts")
  type Ev = [string, number, number]
  const param = (log: Ev[], name: string) => ({ setValueAtTime: (v: number, t: number) => log.push([`${name}=`, v, t]), linearRampToValueAtTime: (v: number, t: number) => log.push([`${name}~`, v, t]),
    exponentialRampToValueAtTime: (v: number, t: number) => log.push([`${name}^`, v, t]) })
  const fake = () => {
    const log: Ev[] = [], stops: number[] = []
    return { log, stops, currentTime: 10, destination: {}, createOscillator: () => ({ type: "", frequency: param(log, "f"), connect() {}, start() {}, stop: (t: number) => stops.push(t) }), createGain: () => ({ gain: param(log, "g"), connect() {} }) }
  }
  for (const name of ["listen", "sent", "answer", "missed"] as const) {
    const c = fake()
    playCue(c, name)
    const gains = c.log.filter((e) => e[0].startsWith("g")), peak = Math.max(...gains.map((e) => e[1])), end = Math.max(...c.stops) - 10
    check(`cues: ${name} is soft and short, rising from silence and fading out (no click)`, peak <= CUE_PEAK && peak > 0 && end <= 0.4 && Math.abs(end - cueLength(name) - 0.02) < 0.001 &&
      gains.filter((e) => e[0] === "g=").every((e) => e[1] === 0) && gains.filter((e) => e[0] === "g^").every((e) => e[1] <= 0.001), { peak, end, gains })
  }
}

// ---------- Dictation into a terminal: a paste on one line, never an Enter (plugins/core/dictation/terminal.ts) ----------
{
  const { terminalTarget, oneLine } = await plugin("dictation/terminal.ts")
  /** A terminal stood in: what its line shows before the cursor (the echo of what's sent, once `echo` is on). */
  const term = (bracketed: boolean, line = "> ") => {
    const sent: string[] = [], shown: string[] = []
    const el = Object.assign(new EventTarget(), { isConnected: true })
    const t = { send: (d: string) => { sent.push(d) }, bracketed: () => bracketed, caret: () => ({ rect: null, before: line }), pending: (w: string) => { shown.push(w) } }
    return { el, sent, shown, target: terminalTarget(el, t), echo: (s: string) => { line += s } }
  }
  const a = term(true)
  a.target.pending("Remember to buy")
  a.target.final("Remember to buy milk\nand bread.\r\n")
  check("dictation in a terminal: words not settled drawn by the terminal, at its cursor", a.shown[0] === "Remember to buy", a.shown)
  check("dictation in a terminal: a settled chunk is a bracketed paste when the program asked, with no Enter, its line breaks spaces",
    a.sent.length === 1 && a.sent[0] === "\x1b[200~Remember to buy milk and bread. \x1b[201~" && !/[\r\n]/.test(a.sent[0]), a.sent)
  check("…and the pending words are cleared as it settles", a.shown.at(-1) === "", a.shown)
  a.target.final("Then call Alice.")
  check("dictation in a terminal: the next chunk follows after a space, before its echo is on screen", a.sent[1] === "\x1b[200~Then call Alice.\x1b[201~", a.sent)
  const b = term(false, "$ ls")
  b.target.final("minus la")
  check("dictation in a terminal: a plain paste when the program didn't ask for brackets, a space after what's on the line", b.sent[0] === " minus la", b.sent)
  b.el.dispatchEvent(new Event("keydown"))
  b.echo(" minus la\u2028")
  b.target.final("now")
  check("dictation in a terminal: after a key there, what's on screen is what it follows", b.sent[1] === "now", b.sent)
  b.target.end()
  check("dictation in a terminal: nothing but words goes in (controls, separators)", oneLine("a\tb\x1bc\u2029d\x7fe") === "a b c d e" && oneLine("one\n\n two") === "one two")
  const c = term(true)
  c.target.final("  \n ")
  check("dictation in a terminal: nothing said, nothing sent", !c.sent.length, c.sent)
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

  const cardsCfg = { filters: 'file.inFolder("Books")', views: [{ type: "cards", image: "note.cover", imageFit: "contain", imageAspectRatio: 1.5, cardSize: 240 }] }
  const crecs = [{ ...book, fm: { ...book.fm, cover: ["[[dune.jpg]]", "x"] } }, { ...book, path: "Books/Emma.md", fm: { cover: "#336699" } }, { ...book, path: "Books/Old.md", fm: {} }]
  const cards = run(bases.baseOptions(cardsCfg).opts, crecs, new Date(now))
  check("bases: cards carry each one's picture (a list's first) and the view's look",
    JSON.stringify(cards.groups[0].rows.map((r: Any) => r.image ?? null)) === '["[[dune.jpg]]","#336699",null]' && JSON.stringify(cards.cards) === '{"size":240,"fit":"contain","ratio":1.5}',
    [cards.groups[0].rows.map((r: Any) => r.image), cards.cards])
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
  const grouped = edit.setGroupBy(st, 0, { key: "status", desc: true })
  check("bases: a view grouped by a property, as Obsidian writes it, and ungrouped again",
    grouped === `${st}    groupBy:\n      property: note.status\n      direction: DESC\n` && edit.setGroupBy(grouped, 0, null) === st, grouped)
  check("bases: a limit written, none removes it", edit.setLimit(st, 0, 20.4) === `${st}    limit: 20\n` && edit.setLimit(`${st}    limit: 20\n`, 0, null) === st, edit.setLimit(st, 0, 20.4))
  {
    const q = await import(pathToFileURL(path.join(ROOT, "plugins", "core", "query", "query.ts")).href)
    const res = { columns: [{ key: "file", label: "Name" }, { key: "note", label: "Note" }],
      groups: [{ name: "a", rows: [{ title: "Dune", values: { note: 'a "b", c' } }] }, { name: "b", rows: [{ title: "Emma", values: { note: ["x", "y|z"] } }] }] }
    check("bases: results as CSV, quoted where needed", q.csvText(q.rowsOf(res)) === 'Name,Note\r\nDune,"a ""b"", c"\r\nEmma,"x, y|z"\r\n', q.csvText(q.rowsOf(res)))
    check("bases: results as a Markdown table, files as links", q.markdownRows(q.rowsOf(res, true)) === '| Name | Note |\n| --- | --- |\n| [[Dune]] | a "b", c |\n| [[Emma]] | x, y\\|z |', q.markdownRows(q.rowsOf(res, true)))
  }
  const fx = "formulas:\n  left: pages - read # pages to go\nviews: []\n"
  check("bases: a formula added after the others, one changed in its place (its comment kept), one removed",
    edit.setFormula(fx, "cost", "price * 2") === "formulas:\n  left: pages - read # pages to go\n  cost: price * 2\nviews: []\n"
    && edit.setFormula(fx, "left", "pages - read - 1") === "formulas:\n  left: pages - read - 1 # pages to go\nviews: []\n"
    && edit.setFormula(fx, "left", null) === "views: []\n", [edit.setFormula(fx, "cost", "price * 2"), edit.setFormula(fx, "left", "pages - read - 1"), edit.setFormula(fx, "left", null)])
  const used = "properties:\n  formula.left:\n    displayName: Left\n  note.x: {displayName: X}\nviews:\n  - type: table\n    order: [file.name, formula.left]\n    sort:\n      - property: formula.left\n        direction: ASC\n    summaries:\n      formula.left: Sum\n    groupBy:\n      property: formula.left\n  - type: cards\n    order: [formula.left, x]\n"
  check("bases: a property removed from every view and its display name", edit.removeProperty(used, "formula.left") === "properties:\n  note.x: {displayName: X}\nviews:\n  - type: table\n    order: [file.name]\n  - type: cards\n    order: [x]\n", edit.removeProperty(used, "formula.left"))
  const filtered = edit.setFilters("# top\nfilters: file.inFolder(\"Books\")\nviews:\n  - type: table\n", 0, { and: ['status == "done"', '!file.hasTag("x")'] })
  check("bases: a view's filters written, an expression starting ! quoted", filtered === "# top\nfilters: file.inFolder(\"Books\")\nviews:\n  - type: table\n    filters:\n      and:\n        - status == \"done\"\n        - '!file.hasTag(\"x\")'\n", filtered)
  check("bases: the base's filters removed, the comment above them kept", edit.setFilters("# top\nfilters: x\nviews: []\n", null, undefined) === "# top\nviews: []\n")
  const nested = "filters:\n  or:\n    - file.hasTag(\"a\") # tagged\n    - and:\n        - price > 2\n"
  check("bases: a filter changed keeps the comments of the rest", edit.setFilters(nested, null, { or: ['file.hasTag("a")', { and: ["price > 3"] }] }) === nested.replace("price > 2", "price > 3"),
    edit.setFilters(nested, null, { or: ['file.hasTag("a")', { and: ["price > 3"] }] }))
  const ni = await import(pathToFileURL(path.join(ROOT, "plugins", "core", "query", "newitem.ts")).href)
  const made = ni.newItem({ filters: { and: ['file.inFolder("Books/")', 'type == "book"', { or: ['status == "a"', 'status == "b"'] }] },
    views: [{ type: "table", filters: { and: ["pages == 300", "done == true", 'file.hasTag("#read")', "project == this", 'note["due date"] == "2026-10-01"', "price > 3"] } }] }, 0)
  check("bases: a new file in a view: its folder, the properties and tags every match has", JSON.stringify(made) === JSON.stringify({ folder: "Books",
    props: { type: "book", pages: 300, done: true, "due date": "2026-10-01", tags: ["read"] } }), made)
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
  const setting = { trigger: { type: "enum", values: ["auto", "hover"], default: "auto", preview: true, label: "Show a preview", labels: { auto: "Auto" }, description: "when it shows" },
    delay: { type: "number", default: 500, min: 0, label: "Delay", description: "how long first, in ms" }, file: { type: "string", label: "File", description: "a file" } }
  check("settings: a sound declaration has no problems (a key named like a common block option too)", !B.settingDeclProblems(setting, "m").length, B.settingDeclProblems(setting, "m"))
  const badSettings = B.settingDeclProblems({ a: { type: "boolean", description: "x" }, b: { type: "enum", values: ["x"], labels: { y: "Y" }, label: "B", description: "x" },
    c: { type: "number", default: "five", label: "C", description: "x" }, d: { type: "boolean", required: true, label: "D", description: "x" }, e: "nope",
    f: { type: "number", preview: true, label: "F", description: "x" } }, "m")
  check("settings: a declaration's own problems", ["setting 'a' needs a label", "setting 'b': labels names 'y'", "setting 'c': its default should be a number",
    "setting 'd': a setting is never required", "setting 'e' must be an object", "setting 'f': preview is true, on an enum"].every((w) => badSettings.some((b) => b.includes(w))), badSettings)
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

// ---------- Inbox: a reply's draft lasts until the server has it (plugins/core/inbox/drafts.ts) ----------
{
  const g = globalThis as Any, was = g.localStorage
  const kept = new Map<string, string>()
  g.localStorage = { getItem: (k: string) => kept.get(k) ?? null, setItem: (k: string, v: string) => void kept.set(k, v), removeItem: (k: string) => void kept.delete(k) }
  const d = await import("../plugins/core/inbox/drafts.ts")
  const ok = await d.sendDraft("a", "Yes, go ahead", async () => {
    const during = d.draftOf("a") === "Yes, go ahead" && d.sendingOf("a") === "Yes, go ahead"
    return { during }
  })
  check("reply drafts: kept while sending, cleared once the server has it", !!ok?.during && d.draftOf("a") === "" && d.sendingOf("a") === null, [ok, d.draftOf("a")])
  let failed = false
  await d.sendDraft("b", "Try again later", async () => { throw new Error("offline") }).catch(() => { failed = true })
  check("reply drafts: a failed send keeps its draft", failed && d.draftOf("b") === "Try again later" && d.hasDraft("b") && d.sendingOf("b") === null)
  let posts = 0
  void d.sendDraft("c", "Never answered", () => { posts++; return new Promise(() => {}) })
  await new Promise((r) => setTimeout(r, 10))
  check("reply drafts: a send that never answers keeps its draft (the app killed mid-send finds it)", d.draftOf("c") === "Never answered" && d.sendingOf("c") === "Never answered")
  const again = await d.sendDraft("c", "Never answered", async () => { posts++ })
  check("reply drafts: no second send while one is on its way", again === undefined && posts === 1, posts)
  d.keepDraft("b", "  ")
  check("reply drafts: emptied is no draft", !d.hasDraft("b") && !kept.has("vaultite.reply:b"))
  g.localStorage = was
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

// ---------- A vault's icon is the stone, never lucide's Vault (a safe; CLAUDE.md, UI) ----------
{
  const { execFileSync } = await import("node:child_process"), { gitEnv } = await import("../core/gitenv.ts")
  const hits = (re: string) => { try { return execFileSync("git", ["grep", "-n", "-E", re, "--", "web", "plugins", "electron", ":!*.md"], { encoding: "utf8", env: gitEnv() }).trim() } catch { return "" } }
  const used = [hits(String.raw`import \{[^}]*\bVault\b[^}]*\} from "lucide-react"`), hits(String.raw`<Vault[ /]`), hits(String.raw`icon\("vault"\)`)].filter(Boolean).join("\n")
  check("icons: lucide's Vault is used nowhere (a vault is the stone)", !used, used)
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

// ---------- Zoom steps: a text size in percent or, a terminal's, a point at a time (web/src/core/textsteps.ts) ----------
{
  const { nextTextSize, STEPS }: { nextTextSize(now: number, step: -1 | 1, points?: number): number | undefined; STEPS: number[] } = await web("core/textsteps.ts")
  check("zoom: a note's text steps through STEPS, 10% near 100%", nextTextSize(100, 1) === 110 && nextTextSize(100, -1) === 90 && nextTextSize(150, 1) === 170)
  check("zoom: no step past either end", nextTextSize(STEPS[STEPS.length - 1], 1) === undefined && nextTextSize(STEPS[0], -1) === undefined)
  // (kept in whole percent: each one has to round back to the point it stands for)
  const pts: number[] = []
  for (let at: number | undefined = 100; at !== undefined && pts.length < 40; at = nextTextSize(at, 1, 13)) pts.push(Math.round(13 * at / 100))
  check("zoom: a terminal's text a point at a time, 13 pt to 39 pt", pts.join() === Array.from({ length: 27 }, (_, i) => 13 + i).join(), pts)
  const down: number[] = []
  for (let at: number | undefined = 100; at !== undefined && down.length < 20; at = nextTextSize(at, -1, 13)) down.push(Math.round(13 * at / 100))
  check("zoom: and down to 7 pt, the smallest STEPS allows", down.join() === "13,12,11,10,9,8,7", down)
  check("zoom: from a size set in percent (110%: 14 pt), the next point", Math.round(13 * nextTextSize(110, 1, 13)! / 100) === 15)
}

// ---------- Settings of a few values as palette pickers (web/src/core/choicePicker.ts) ----------
{
  const cp: Any = await web("core/choicePicker.ts")
  let value = "natural", shown: string | null = null
  const toasts: [string, () => void][] = []
  const def = { id: "setting:animation", name: "Animations", options: () => [{ value: "natural", label: "Natural" }, { value: "snappy", label: "Snappy" }, { value: "off", label: "Off" }],
    get: () => value, set: (v: string) => { value = v }, preview: (v: string | null) => { shown = v } }
  const p = cp.choicePicker(def, (text: string, undo: () => void) => toasts.push([text, undo]))
  check("choices: a picker of its values named as Settings names them, the one in use checked",
    p.title === "Animations" && p.placeholder === "Animations…" && p.current === "natural" && p.items.map((i: Any) => i.label).join() === "Natural,Snappy,Off", p)
  p.preview(p.items[2]); const moved = shown; p.preview(null)
  check("choices: moving shows a value for now, saved nowhere; closing goes back", moved === "off" && shown === null && value === "natural", [moved, shown, value])
  p.onPick(p.items[0])
  check("choices: picking the one in use changes nothing, says nothing", value === "natural" && !toasts.length)
  p.onPick(p.items[1])
  check("choices: picking another keeps it, saying so with Undo", value === "snappy" && toasts[0]?.[0] === "Animations: Snappy", toasts)
  toasts[0][1]()
  check("choices: Undo puts back the one before", value === "natural" && cp.choiceLabel(def) === "Natural")
  check("choices: no preview where the setting can't show one", cp.choicePicker({ ...def, preview: undefined }, () => {}).preview === undefined)

  // A plugin's enum (its manifest's), numbers too: the default again takes the key out.
  let data: Record<string, unknown> = {}, over: unknown = "unset"
  const store = { get: () => data, set: (k: Record<string, unknown>) => { data = Object.fromEntries(Object.entries({ ...data, ...k }).filter(([, v]) => v !== null)) }, preview: (k: unknown) => { over = k } }
  const decl = { type: "enum", values: [10, 20, 30], default: 20, label: "Row height", labels: { 10: "Short" }, description: "how tall rows are", preview: true }
  const pc = cp.declChoice({ id: "lists", name: "Lists" }, "height", decl, 20, store)
  check("choices: a plugin's enum, labelled from its manifest, its default in use", pc.id === "setting:lists:height" && pc.get() === "20" && pc.sub() === "How tall rows are"
    && pc.options().map((o: Any) => o.label).join() === "Short,20,30" && pc.plugin.key === "height", [pc.get(), pc.options()])
  pc.set("10"); const set10 = data.height; pc.set("20")
  check("choices: a plugin's value saved as its own type; the default removes the key", set10 === 10 && !("height" in data), [set10, data])
  pc.preview("30"); const prev = JSON.stringify(over); pc.preview(null)
  check("choices: a plugin's enum with preview shows its value for now", prev === '{"height":30}' && over === null, prev)
  data = { height: 99 }
  check("choices: a value the file has that isn't one of them reads as the default", pc.get() === "20", pc.get())
  check("choices: no preview unless the manifest asks", cp.declChoice({ id: "lists", name: "Lists" }, "height", { ...decl, preview: undefined }, 20, store).preview === undefined)
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
  // A manifest's "⌥⌘F" reads as Linux and Windows name the keys there, a Mac's as written.
  const { keysText } = await import("../web/src/core/platform.ts")
  const off = (t: string) => keysText(t, false)
  check("keys in text: off a Mac, Ctrl, Alt and Shift", off("Find (⌘F), and replace (⌥⌘F); ⇧⌘T") === "Find (Ctrl+F), and replace (Ctrl+Alt+F); Ctrl+Shift+T", off("Find (⌘F), and replace (⌥⌘F); ⇧⌘T"))
  check("keys in text: a key bar's labels", off("⇧tab") === "Shift+tab" && off("⌃C") === "Ctrl+C", [off("⇧tab"), off("⌃C")])
  check("keys in text: a key alone, or before -click", off("hold ⌘. ⌘-click, ⌘ held") === "hold Ctrl. Ctrl-click, Ctrl held" && keysText("⌥⌘F", true) === "⌥⌘F", off("hold ⌘. ⌘-click, ⌘ held"))
}

{
  // Every scheme's ten colours (tab groups, workspaces, labels pick from them) tell apart: CIE76 distance at least 10.
  const { COLORS } = await import("../core/colors.ts")
  const lab = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => { const c = parseInt(hex.slice(i, i + 2), 16) / 255; return c > 0.04045 ? ((c + 0.055) / 1.055) ** 2.4 : c / 12.92 })
    const f = (v: number) => (v > 0.008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116)
    const x = f((r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047), y = f(r * 0.2126 + g * 0.7152 + b * 0.0722), z = f((r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883)
    return [116 * y - 16, 500 * (x - y), 200 * (y - z)]
  }
  const files = [path.join(WEB, "index.css"), ...fs.readdirSync(path.join(WEB, "themes")).filter((f) => f.endsWith(".css")).map((f) => path.join(WEB, "themes", f))]
  const alike = files.flatMap((f) => fs.readFileSync(f, "utf8").split(/--red:/).slice(1).flatMap((block, i) => {
    const v = Object.fromEntries(COLORS.map((c) => [c, c === "red" ? /^\s*(#[0-9a-f]{6})/i.exec(block)?.[1] : new RegExp(`--${c}:\\s*(#[0-9a-f]{6})`, "i").exec(block)?.[1]]))
    return COLORS.flatMap((a, j) => COLORS.slice(j + 1).filter((b) => v[a] && v[b] && Math.hypot(...lab(v[a]!).map((x, k) => x - lab(v[b]!)[k])) < 10)
      .map((b) => `${path.basename(f)} #${i + 1}: ${a} ${v[a]} ~ ${b} ${v[b]}`))
  }))
  check("schemes: each one's ten colours tell apart", !alike.length, alike)
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

// ---------- Browser: who's signed in to a site (electron/siteaccounts.ts), on made-up answers ----------
{
  const sa = await import("../electron/siteaccounts.ts")
  const read = (site: string, body: unknown, cookies: Record<string, string> = {}, url = "") => sa.ACCOUNTS[site].read!(body, async (_d, name) => cookies[name] ?? "", url)
  const name = async (...a: Parameters<typeof read>) => { const v = await read(...a); return (typeof v === "string" ? v : v?.account) || null } // (as electron/web.ts askWho: "" names nobody)
  const look = (site: string, v: unknown) => sa.ACCOUNTS[site].look!.read(v)
  const list = '["gaia.l.a.r",[["gaia.l.a",1,"Alice Park","alice.park@example.com","https://lh3.example.com/a.png",1,1,0,null,1,"1001",null,null,null,0,1],' +
    '["gaia.l.a",1,"Lighthouse","studio@example.com","",1,1,0,null,1,"1002",null,null,null,0,1],["gaia.l.a",1,"Old","old@example.com","",1,1,0,null,1,"1003",null,null,null,1,1]]]'
  check("accounts: Google's list, the first signed in, the others beside it, a signed-out one left out",
    JSON.stringify(sa.googleAccounts(list)) === JSON.stringify({ account: "alice.park@example.com", more: ["studio@example.com"], avatar: "https://lh3.example.com/a.png" }), sa.googleAccounts(list))
  const wrapped = `<html><body><script>window.parent.postMessage('${list.replace(/"/g, "\\x22")}', 'https://accounts.google.com')</script></body></html>`
  check("accounts: Google's list inside the page it sometimes answers", sa.googleAccounts(wrapped)?.account === "alice.park@example.com", sa.googleAccounts(wrapped))
  check("accounts: Google, nobody signed in", sa.googleAccounts('["gaia.l.a.r",[]]') === null && sa.googleAccounts("<html>Sign in</html>") === null)
  check("accounts: Reddit's name, its picture's address unescaped",
    JSON.stringify(await read("reddit.com", { data: { name: "alice_park", icon_img: "https://styles.example.com/a.png?s=1&amp;b=2" } })) === JSON.stringify({ account: "u/alice_park", avatar: "https://styles.example.com/a.png?s=1&b=2" }))
  check("accounts: GitHub's login from its page, none signed out",
    (await read("github.com", '<meta name="user-login" content="alicepark">') as { account: string })?.account === "alicepark" && await read("github.com", '<meta name="user-login" content="">') === null)
  const x = '{"users":{"7":{"id_str":"7","screen_name":"someone"},"42":{"id_str":"42","name":"Alice","screen_name":"alicepark","profile_image_url_https":"https:\\/\\/pbs.example.com\\/a.jpg"}}}'
  const xWho = await read("x.com", x, { twid: "u%3D42" }) as { account: string; avatar: string } | null
  check("accounts: X, the user whose id the twid cookie has, not another on the page", xWho?.account === "@alicepark" && xWho.avatar === "https://pbs.example.com/a.jpg", xWho)
  check("accounts: X, no twid cookie: nobody", await read("x.com", x) === null)
  check("accounts: claude.ai's email", await read("claude.ai", { account: { email_address: "alice@example.com" } }) === "alice@example.com")
  check("accounts: X's handle and picture from an open page's sidebar, nothing from a page without it",
    JSON.stringify(sa.xLooked({ handle: "alicepark", avatar: "https://pbs.example.com/a.jpg" })) === JSON.stringify({ account: "@alicepark", avatar: "https://pbs.example.com/a.jpg" }) && sa.xLooked(null) === null && sa.xLooked({ handle: "i/flow/login" }) === null)
  check("accounts: Hacker News's name from its login cookie, none without one",
    await read("ycombinator.com", null, { user: "alicepark&k3yH4sh" }) === "alicepark" && await read("ycombinator.com", null) === null)
  check("accounts: Instagram's handle, none signed out", await name("instagram.com", { form_data: { username: "alice.park" } }) === "@alice.park" && await name("instagram.com", { message: "login_required" }) === null)
  const fb = '<script>{"define":[["CurrentUserInitialData",[],{"ACCOUNT_ID":"4242","USER_ID":"4242","NAME":"Alice Park \\u00c9","SHORT_NAME":"Alice"},270]]}</script>'
  check("accounts: Facebook's name for the user its c_user cookie has, none for another or without it",
    await name("facebook.com", fb, { c_user: "4242" }) === "Alice Park \u00c9" && await name("facebook.com", fb, { c_user: "7" }) === null && await name("facebook.com", fb) === null)
  check("accounts: LinkedIn's handle from the profile /in/me/ took it to, none when it stayed",
    await name("linkedin.com", "", {}, "https://www.linkedin.com/in/alice-park-1a2b/") === "alice-park-1a2b" && await name("linkedin.com", "", {}, "https://www.linkedin.com/in/me/") === null &&
    await name("linkedin.com", "", {}, "https://www.linkedin.com/login") === null)
  check("accounts: Cloudflare's, Cursor's, Apple's and GitLab's emails or names from their own answers",
    await name("cloudflare.com", { success: true, result: { email: "alice@example.com" } }) === "alice@example.com" && await name("cloudflare.com", { success: false, result: null }) === null &&
    await name("cursor.com", { email: "alice@example.com", name: "Alice" }) === "alice@example.com" && await name("apple.com", { user: { fullName: "Alice Park", emailAddress: "alice@example.com" } }) === "alice@example.com" &&
    await name("gitlab.com", { id: 1, username: "alicepark" }) === "alicepark" && await name("gitlab.com", { message: "401 Unauthorized" }) === null)
  check("accounts: Wikipedia's user, none for an IP address signed out",
    await name("wikipedia.org", { query: { userinfo: { id: 12, name: "Alice Park" } } }) === "Alice Park" && await name("wikipedia.org", { query: { userinfo: { id: 0, name: "192.0.2.1", anon: "" } } }) === null)
  check("accounts: Perplexity's email", await name("perplexity.ai", { user: { email: "alice@example.com" } }) === "alice@example.com" && await name("perplexity.ai", {}) === null)
  check("accounts: Slack's email from its workspace's settings page, none at its sign-in page",
    await name("slack.com", '<h2>Email Address</h2><p class="no_bottom_margin">Your email address is <strong>alice@example.com</strong></p>') === "alice@example.com" &&
    await name("slack.com", "<html><title>Sign in to Slack | Slack</title></html>") === null)
  check("accounts: WhatsApp's number off its open app, signed in unnamed without it, out at its QR code",
    JSON.stringify(look("whatsapp.com", { phone: '"5511987654321:12@c.us"' })) === '{"account":"+5511987654321"}' && JSON.stringify(look("whatsapp.com", { phone: "" })) === '{"account":""}' &&
    look("whatsapp.com", { out: true }) === false && sa.phoneOf("12@c.us") === "")
  check("accounts: a rule's answer at a dotted path, only a string", sa.at({ a: { b: " x " } }, "a.b") === "x" && sa.at({ a: { b: 3 } }, "a.b") === "" && sa.at(null, "a.b") === "")
  check("accounts: Google's login covers YouTube and google.<country>, not other sites",
    sa.covers("youtube.com", "youtube.com") && sa.covers("google.*", "google.com.br") && sa.covers("google.*", "google.co.uk") && !sa.covers("google.*", "google.com") && !sa.covers("google.*", "googleapis.com") && !sa.covers("youtube.com", "youtu.be"))
}

// ---------- Browser: passkeys from a phone (electron/browser/hybrid.ts, webauthn.ts) ----------
// Chromium's and a real phone's vectors (via kanidm's webauthn-authenticator-rs), then sign-up and sign-in with a fake phone.
await section("passkeys", async () => {
  const h = await import("../electron/browser/hybrid.ts")
  const w = await import("../electron/browser/webauthn.ts")
  const { encode, decode } = await import("../electron/browser/cbor.ts")
  const { WebSocketServer, default: WebSocket } = await import("ws")
  const crypto = await import("node:crypto")
  const hex = (b: Uint8Array) => Buffer.from(b).toString("hex")
  const QRS = ["FIDO:/162870791865632382552704231438327900152302540348097243854039966655366469794954476199158014113179232779520163209900691930075274801398564434658077048963842109321447142660",
    "FIDO:/089962132878132862898875319509818655951233947060166026934941652203853844930597225184066237811614893181300344014421205790072080843938838513707157859599106109321447142404"]
  check("passkeys: Chrome's and Safari's QR codes read and write back the same", QRS.every((u) => `FIDO:/${h.base10(encode(h.parseQr(u)))}` === u))
  check("passkeys: tunnel servers by number, assigned and derived", JSON.stringify([0, 1, 266, 255, 0xf980].map(h.domainOf))
    === JSON.stringify(["cable.ua5v.com", "cable.auth.com", "cable.wufkweyy3uaxb.com", null, "cable.my4kstlhndi4c.net"]))
  const secret = Buffer.from([1, 254, 166, 247, 196, 128, 116, 147, 220, 37, 111, 158, 172, 247, 86, 201])
  const advert = Buffer.from([2, 125, 132, 237, 96, 118, 181, 94, 36, 124, 131, 15, 130, 149, 94, 77, 18, 110, 127, 67])
  const eid = h.readAdvert(advert, h.eidKey(secret))
  check("passkeys: a phone's real advert decrypts to its tunnel", !!eid && eid.domain === 0 && hex(eid.routingId) === "026555" && hex(eid.nonce) === "8bb5c5c9a44d913a5eb2"
    && h.connectUrl(h.domainOf(eid.domain)!, eid.routingId, h.tunnelId(secret)) === "wss://cable.ua5v.com/cable/connect/026555/367CBBF5F5085DF4098476AFE4B9B1D2", eid)
  const bad = Buffer.from(advert); bad[0] ^= 1
  check("passkeys: an advert for another QR code (or changed) is ignored", h.readAdvert(bad, h.eidKey(secret)) === null && h.readAdvert(advert.subarray(1), h.eidKey(secret)) === null)

  // kanidm's vector: a makeCredential as the tunnel frames it, then sealed with the new nonce layout
  const b = (a: number[]) => Buffer.from(a).toString("base64url")
  const mc = w.prepareCreate({ rp: { id: "webauthn.firstyear.id.au", name: "webauthn.firstyear.id.au" },
    user: { id: b([0xd6, 0xd7, 0xaa, 0x29, 0x8f, 0xe8, 0x4a, 0x6, 0xaa, 0xde, 0xd7, 0xe4, 0x9d, 0x90, 0xa, 0x62]), name: "a", displayName: "a" },
    challenge: b(Array(16).fill(7)), pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
    excludeCredentials: [{ type: "public-key", id: b([0, 1, 2, 3]) }], authenticatorSelection: { residentKey: "discouraged", userVerification: "required" } }, "https://webauthn.firstyear.id.au")
  const frame = Buffer.concat([Buffer.from([1]), mc.command])
  frame.set(Buffer.from("3889285c8c6323950ced074984f9f9463bc1739bb621a9e5f1ee8dd9393ba280", "hex"), 6) // (the vector's client data hash)
  check("passkeys: a makeCredential is CTAP2's canonical CBOR", hex(frame) === "0101a60158203889285c8c6323950ced074984f9f9463bc1739bb621a9e5f1ee8dd9393ba28002a26269647818776562617574686e2e6669727374796561722e69642e6175646e616d657818776562617574686e2e6669727374796561722e69642e617503a362696450d6d7aa298fe84a06aaded7e49d900a62646e616d6561616b646973706c61794e616d6561610482a263616c672664747970656a7075626c69632d6b6579a263616c6739010064747970656a7075626c69632d6b65790581a2626964440001020364747970656a7075626c69632d6b657907a1627576f5", hex(frame))
  const writeKey = Buffer.from("1fba3cce17622c68268d9f75b5a8a3351b517f096fb5e294941af7e3a6a8d6e1", "hex"), readKey = Buffer.from("e34f1aa3747238c04d3bd25e07ef1b35fef359000d755615cd85be27cfc807d1", "hex")
  const sealed = new h.Crypter(readKey, writeKey, "new").encrypt(frame)
  check("passkeys: sealed as Chromium seals it (padding, nonce, key)", hex(sealed) === "5062cf34571e0827a7c0207f7c00184567d613eab0da080ad042d80664c59df7b01a13db17fd277575ccff53b6a34fdb4fbcf832f3d360f8e5a7daee7f265a9253a904d6ebff2f9370d35536d8bf054830aaadffb996b420b2b3170ac80a83796823ed3c284b177c23400ca0124d6a68263d39783cfef0273fdf3bfcfa0a6c33df319b126f6e8290d22c4cd32a7a978856ba2273d1be1c0a291e5ee197416aa0f7a104e4d0ac582b708482326d5ff0f1768c1416d016b1f89242e70e80312fe6b6d4029a40ada374b31e7d66fac3ba7283944b9b60da4b98f67804095fd39cd1d45d75c93d2d86cbfc21616f9f1a576ccf8c862ee185125fc1ed7ed2486e2c5fbfc39c919597dd86c338e7df553d51e8", hex(sealed).slice(0, 40))
  check("passkeys: the other side reads it, guessing the nonce layout", hex(new h.Crypter(writeKey, readKey).decrypt(sealed)) === hex(frame))

  check("passkeys: a page may use its own site's passkeys, never another's or a public suffix's", w.rpIdFor("https://accounts.google.com", "google.com") === "google.com"
    && w.rpIdFor("https://github.com", undefined) === "github.com" && w.rpIdFor("http://localhost:3000", undefined) === "localhost"
    && ["https://evil.com|google.com", "https://x.github.io|github.io", "http://example.com|", "https://10.0.0.1|"].every((c) => {
      const [o, id] = c.split("|"); try { w.rpIdFor(o, id || undefined); return false } catch (e) { return (e as Error).name === "SecurityError" }
    }))

  // A phone: a tunnel server on 127.0.0.1 that's also the phone at its far end, holding one P-256 passkey.
  const server = new WebSocketServer({ port: 0, host: "127.0.0.1", handleProtocols: (p) => (p.has("fido.cable") ? "fido.cable" : false) })
  await new Promise((ok) => server.once("listening", ok))
  const port = (server.address() as { port: number }).port
  const cred = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" }), credId = crypto.randomBytes(16)
  const jwk = cred.publicKey.export({ format: "jwk" }) as { x: string; y: string }
  const cose = encode(new Map<number, unknown>([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x, "base64url")], [-3, Buffer.from(jwk.y, "base64url")]]) as never)
  let paths: string[] = [], phoneSaw: unknown = null
  const phone = (qr: string) => {
    const m = h.parseQr(qr)
    const identity = crypto.ECDH.convertKey(m.get(0) as Uint8Array, "prime256v1", undefined, undefined, "uncompressed") as Buffer
    const s = m.get(1) as Uint8Array, plain = Buffer.alloc(16)
    crypto.randomBytes(10).copy(plain, 1); plain.set([0xab, 0xcd, 0xef], 11); plain.writeUInt16LE(1, 14)
    server.once("connection", (ws, req) => {
      paths.push(req.url ?? "")
      let crypter: InstanceType<typeof h.Crypter> | null = null
      ws.on("message", (data: Buffer) => {
        if (!crypter) {
          const r = h.respond(identity, h.pskOf(s, plain), data)
          crypter = r.crypter
          ws.send(r.response)
          ws.send(crypter.encrypt(encode(new Map([[1, encode(new Map([[1, ["FIDO_2_0"]]]) as never)]]) as never)))
          return
        }
        const msg = crypter.decrypt(data)
        if (msg[0] !== 1) return
        const req2 = decode(msg.subarray(2)) as Map<number, unknown>
        phoneSaw = { cmd: msg[1], keys: [...req2.keys()] }
        const rpId = String(msg[1] === 1 ? (req2.get(2) as Map<string, string>).get("id") : req2.get(1))
        const rpHash = crypto.createHash("sha256").update(rpId).digest()
        let answer: Map<number, unknown>
        if (msg[1] === 1) {
          const att = Buffer.concat([Buffer.alloc(16), Buffer.from([0, credId.length]), credId, cose])
          const authData = Buffer.concat([rpHash, Buffer.from([0x45]), Buffer.alloc(4), att])
          answer = new Map<number, unknown>([[1, "packed"], [2, authData], [3, new Map([["alg", -7]])]])
        } else {
          const authData = Buffer.concat([rpHash, Buffer.from([0x05]), Buffer.from([0, 0, 0, 1])])
          const sig = crypto.sign("sha256", Buffer.concat([authData, req2.get(2) as Uint8Array]), cred.privateKey)
          answer = new Map<number, unknown>([[1, new Map<string, unknown>([["id", credId], ["type", "public-key"]])], [2, authData], [3, sig], [4, new Map([["id", Buffer.from("alice")]])]])
        }
        ws.send(crypter.encrypt(Buffer.concat([Buffer.from([1, 0]), encode(answer as never)])))
      })
    })
    return h.makeAdvert(plain, h.eidKey(s))
  }
  const ask = async (p: ReturnType<typeof w.prepareGet>) => {
    const secret2 = crypto.randomBytes(16), identity = h.newKey()
    const advertFor = phone(h.qrText({ identity: h.publicOf(identity, true), secret: secret2, type: p.type }))
    const states: string[] = []
    const answer = await h.run({ secret: secret2, identity, command: p.command, signal: AbortSignal.timeout(10_000), progress: (s) => states.push(s),
      adverts: (on) => { const t = setTimeout(() => { on(crypto.randomBytes(20)); on(advertFor) }, 20); return () => clearTimeout(t) },
      connect: (url) => new WebSocket(`ws://127.0.0.1:${port}${new URL(url).pathname}`, "fido.cable") })
    return { answer, states, tunnel: hex(h.tunnelId(secret2)).toUpperCase() }
  }
  const origin = "https://shop.example.com", challenge = crypto.randomBytes(32).toString("base64url")
  const made = w.prepareCreate({ rp: { id: "example.com", name: "Lighthouse" }, user: { id: b([1, 2, 3]), name: "alice@example.com", displayName: "Alice Park" },
    challenge, pubKeyCredParams: [{ type: "public-key", alg: -7 }], authenticatorSelection: { residentKey: "required" }, extensions: { credProps: true } }, origin)
  const created = await ask(made)
  const c = w.readCreate(created.answer, made)
  const attObj = decode(Buffer.from(c.response.attestationObject, "base64url")) as Map<string, unknown>
  const cd = JSON.parse(Buffer.from(c.response.clientDataJSON, "base64url").toString())
  check("passkeys: sign-up over the tunnel: the phone's passkey, attestation none, the page's origin", c.id === credId.toString("base64url") && attObj.get("fmt") === "none"
    && cd.type === "webauthn.create" && cd.challenge === challenge && cd.origin === origin && c.clientExtensionResults.credProps?.rk === true
    && paths[0] === `/cable/connect/ABCDEF/${created.tunnel}` && created.states.join() === "scan,connecting,phone", { c, paths, states: created.states })
  const key = crypto.createPublicKey({ key: Buffer.from(c.response.publicKey!, "base64url"), format: "der", type: "spki" })
  const got = w.prepareGet({ challenge, rpId: "example.com", allowCredentials: [{ type: "public-key", id: c.id }] }, origin)
  const signed = w.readGet((await ask(got)).answer, got)
  const data = Buffer.concat([Buffer.from(signed.response.authenticatorData, "base64url"), crypto.createHash("sha256").update(Buffer.from(signed.response.clientDataJSON, "base64url")).digest()])
  check("passkeys: sign-in over the tunnel: the phone's signature verifies with the key from sign-up", crypto.verify("sha256", data, key, Buffer.from(signed.response.signature, "base64url"))
    && signed.response.userHandle === Buffer.from("alice").toString("base64url"), { signed, phoneSaw })
  let none = ""
  try { w.readGet(Buffer.from([0x2e]), got) } catch (e) { none = (e as Error).name }
  check("passkeys: a phone without a passkey for the site: NotAllowedError", none === "NotAllowedError", none)
  let wrong = ""
  try { w.readGet(Buffer.concat([Buffer.from([0]), encode(new Map<number, unknown>([[1, new Map([["id", credId]])], [2, Buffer.concat([crypto.createHash("sha256").update("evil.com").digest(), Buffer.alloc(5)])], [3, Buffer.alloc(8)]]) as never)]), got) } catch (e) { wrong = (e as Error).name }
  check("passkeys: an answer for another site is refused", wrong === "NotAllowedError", wrong)
  server.close()
})

// ---------- Browser: Google's sign-in sees Firefox (electron/browser/googleagent.ts) ----------
await section("google sign-in", async () => {
  const g = await import("../electron/browser/googleagent.ts")
  const mac = g.firefoxAgent("148.0.7778.97", "darwin"), win = g.firefoxAgent("148.0.7778.97", "win32"), linux = g.firefoxAgent("148.0.7778.97", "linux")
  check("google sign-in: a Firefox of Chromium's month on each platform", mac === "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:149.0) Gecko/20100101 Firefox/149.0"
    && win.includes("(Windows NT 10.0; Win64; x64; rv:149.0)") && linux.includes("(X11; Linux x86_64; rv:149.0)"), [mac, win, linux])
  const h = g.asFirefox({ "user-agent": "Mozilla/5.0 Chrome/148", "Sec-CH-UA": '"Chromium";v="148"', "sec-ch-ua-mobile": "?0", "sec-ch-ua-platform": '"macOS"',
    "Sec-CH-UA-Full-Version-List": "x", Cookie: "SID=1", "Sec-Fetch-Mode": "navigate" }, mac)
  check("google sign-in: requests carry Firefox's user agent, no client hints, the rest as they were",
    JSON.stringify(h) === JSON.stringify({ Cookie: "SID=1", "Sec-Fetch-Mode": "navigate", "User-Agent": mac }), h)
  check("google sign-in: only accounts.google.com", g.isSignIn("https://accounts.google.com/v3/signin/identifier") && g.isSignIn("https://accounts.google.com/gsi/iframe")
    && !g.isSignIn("https://mail.google.com/") && !g.isSignIn("https://accounts.google.com.evil.example/") && !g.isSignIn("http://accounts.google.com/"))
})

// ---------- Browser: agents' logins from a KeePass file (electron/browser/keepass.ts, loginform.ts, pagesecrets.ts) ----------
// A made-up agents.kdbx written here; never a real one.
await section("agent logins", async () => {
  const kp = await import("../electron/browser/keepass.ts")
  const { loginForm } = await import("../electron/browser/loginform.ts")
  const { keep, scrub, scrubDeep } = await import("../electron/browser/pagesecrets.ts")
  const { Credentials, Kdbx, ProtectedValue } = await import("kdbxweb")
  const PASSWORD = "correct horse battery staple", SECRET = "Lighthouse-7!pw"
  const db = Kdbx.create(new Credentials(ProtectedValue.fromString(PASSWORD)), "Agents")
  const add = (title: string, fields: Record<string, string>, tags: string[] = [], group = db.getDefaultGroup()) => {
    const e = db.createEntry(group)
    e.fields.set("Title", title)
    for (const [k, v] of Object.entries(fields)) e.fields.set(k, k === "Password" || k === "otp" ? ProtectedValue.fromString(v) : v)
    e.tags = tags
    return e
  }
  add("Lighthouse", { UserName: "alice", Password: SECRET, URL: "https://lighthouse.example.com/login", otp: "otpauth://totp/Lighthouse:alice?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&period=30&digits=6" }, ["agent-free"])
  add("Lighthouse admin", { UserName: "admin", Password: "admin-pw", URL: "lighthouse.example.com" })
  add("Harbor", { UserName: "alice@example.com", Password: "harbor-pw", URL: "https://*.harbor.example.org", KP2A_URL_1: "https://harbor.example.net" })
  const old = add("Old", { UserName: "old", Password: "old-pw", URL: "https://old.example.com" })
  old.times.expires = true
  old.times.expiryTime = new Date(Date.now() - 86400_000)
  const binned = add("Binned", { UserName: "gone", Password: "gone-pw", URL: "https://lighthouse.example.com" })
  db.createRecycleBin()
  db.move(binned, db.getGroup(db.meta.recycleBinUuid!)!)
  const file = new Uint8Array(await db.save())

  const opened = await kp.openDatabase(file, PASSWORD)
  const titles = opened.entries.map((e) => e.title).sort().join()
  check("agent logins: a KeePass file opens with its password, the recycle bin left out", titles === "Harbor,Lighthouse,Lighthouse admin,Old", titles)
  const light = opened.entries.find((e) => e.title === "Lighthouse")!, admin = opened.entries.find((e) => e.title === "Lighthouse admin")!
  check("agent logins: the agent-free tag frees an entry; untagged ones ask the user", light.free && !admin.free)
  check("agent logins: an expired entry says so", opened.entries.find((e) => e.title === "Old")!.expired && !light.expired)
  check("agent logins: entries list no secret (only the fill reads them)", !JSON.stringify(opened.entries).includes(SECRET) && light.otp && !admin.otp)
  const got = opened.secrets(light.id)
  check("agent logins: an entry's secrets, read for the fill", got?.password === SECRET && got.username === "alice" && got.otp !== "steam" && got.otp?.digits === 6, got && { ...got, password: "(hidden)" })
  let wrong = ""
  try { await kp.openDatabase(file, "not it") } catch (e) { wrong = (e as Error).message }
  check("agent logins: a wrong password says so, plainly", /password/i.test(wrong) && !wrong.includes("not it"), wrong)
  let junk = ""
  try { await kp.openDatabase(new TextEncoder().encode("not a database"), PASSWORD) } catch (e) { junk = (e as Error).message }
  check("agent logins: a file that isn't KeePass's says so", /KeePass/.test(junk) && !junk.includes(PASSWORD), junk)

  // Strict matching, as a password manager's: never a lookalike, subdomains only when the entry says so.
  const M: [string, string, boolean][] = [
    ["https://github.com", "https://github.com/login", true],
    ["github.com", "https://github.com/login", true],
    ["https://github.com", "https://www.github.com/", true],
    ["https://github.com", "https://gist.github.com/", false],
    ["https://github.com", "https://github.com.evil.com/", false],
    ["https://github.com", "https://evilgithub.com/", false],
    ["https://github.com", "https://xn--gthub-n4a.com/", false],
    ["https://github.com", "https://github.com@evil.com/", false],
    ["https://github.com", "http://github.com/", false],
    ["http://intranet.example.com", "https://intranet.example.com/", true],
    ["http://intranet.example.com", "http://intranet.example.com/", true],
    ["https://github.com", "https://github.com:8443/", false],
    ["https://github.com:8443", "https://github.com:8443/", true],
    ["https://github.com", "https://github.com./", true],
    ["https://accounts.example.com", "https://accounts.example.com/", true],
    ["https://accounts.example.com", "https://www.accounts.example.com/", false],
    ["https://accounts.example.com", "https://example.com/", false],
    ["https://*.example.com", "https://a.b.example.com/", true],
    ["https://*.example.com", "https://example.com/", true],
    ["https://*.example.com", "https://badexample.com/", false],
    ["https://*.com", "https://example.com/", false],
    ["https://*.co.uk", "https://bank.co.uk/", false],
    ["https://*.github.io", "https://alice.github.io/", false],
    ["https://alice.github.io", "https://alice.github.io/", true],
    ["https://alice.github.io", "https://bob.github.io/", false],
    ["http://127.0.0.1:8080", "http://127.0.0.1:8080/login", true],
    ["http://127.0.0.1:8080", "http://127.0.0.2:8080/login", false],
    ["https://github.com", "file:///etc/passwd", false],
    ["", "https://github.com/", false],
    ["https://github.com", "not a url", false],
  ]
  const bad = M.filter(([e, p, want]) => kp.matchesSite(e, p) !== want)
  check("agent logins: an entry's address matches its own site only (lookalikes, other subdomains, http, ports, public suffixes)", !bad.length, bad)
  const forLight = kp.entriesFor(opened, "https://lighthouse.example.com/login?next=/").map((e) => e.title).sort().join()
  check("agent logins: a page's entries are those naming its site", forLight === "Lighthouse,Lighthouse admin", forLight)
  check("agent logins: additional URLs (KeePassXC's KP2A_URL) match too", kp.entriesFor(opened, "https://harbor.example.net/").length === 1
    && kp.entriesFor(opened, "https://eu.harbor.example.org/").length === 1 && !kp.entriesFor(opened, "https://harbor.example.com/").length)
  const near = kp.nearlyFor(opened, "https://auth.example.com/u/login").map((x) => `${x.entry.title}=${x.url}@${x.domain}`).sort().join()
  check("agent logins: a sign-in on another host of an entry's domain names the entry (for the error to say what to add)",
    near === "Lighthouse admin=lighthouse.example.com@example.com,Lighthouse=https://lighthouse.example.com/login@example.com,Old=https://old.example.com@example.com"
    && !kp.nearlyFor(opened, "https://bob.github.io/").length && !kp.nearlyFor(opened, "http://127.0.0.1/").length, near)

  // RFC 6238's vectors (its SHA-1 key, 8 digits), then the forms KeePassXC and KeePass keep a one-time code in.
  const rfc = { key: Buffer.from("12345678901234567890"), period: 30, digits: 8, algorithm: "sha1" as const }
  const codes = [59, 1111111109, 1234567890, 2000000000].map((s) => kp.totp(rfc, s * 1000))
  check("agent logins: one-time codes as RFC 6238 computes them", codes.join() === "94287082,07081804,89005924,69279037", codes)
  const sha256 = kp.totp({ key: Buffer.from("12345678901234567890123456789012"), period: 30, digits: 8, algorithm: "sha256" }, 59_000)
  check("agent logins: SHA-256 codes too", sha256 === "46119246", sha256)
  const B32 = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"
  const forms = [
    kp.otpOf({ otp: `otpauth://totp/x?secret=${B32}&period=30&digits=8&algorithm=SHA1` }),
    kp.otpOf({ otp: `key=${B32}&step=30&size=8` }),
    kp.otpOf({ "TOTP Seed": B32.toLowerCase().replace(/(.{4})/g, "$1 "), "TOTP Settings": "30;8" }),
    kp.otpOf({ "TimeOtp-Secret-Base32": B32, "TimeOtp-Length": "8" }),
    kp.otpOf({ "TimeOtp-Secret": "12345678901234567890", "TimeOtp-Length": "8" }),
  ]
  const formCodes = forms.map((o) => (o && o !== "steam" ? kp.totp(o, 59_000) : String(o)))
  check("agent logins: codes from otpauth, KeeOtp, KeePassXC's old fields and KeePass's TimeOtp fields", formCodes.every((c) => c === "94287082"), formCodes)
  check("agent logins: Steam's codes are named, not computed wrong", kp.otpOf({ otp: `otpauth://totp/Steam:a?secret=${B32}&encoder=steam` }) === "steam"
    && kp.otpOf({ "TOTP Seed": B32, "TOTP Settings": "30;S" }) === "steam")
  check("agent logins: an entry without a one-time code has none", kp.otpOf({ URL: "https://x.com" }) === null)

  // The page's login form: which inputs get what.
  let n = 0
  const input = (o: Partial<import("../electron/browser/loginform.ts").Input>) => ({ id: ++n, type: "text", hint: "", autocomplete: "", form: 0, visible: true, disabled: false, maxLength: -1, ...o })
  const user = input({ type: "email", hint: "email", form: 1 }), pw = input({ type: "password", hint: "password", form: 1 }), search = input({ hint: "search" })
  const f1 = loginForm([search, user, pw])
  check("agent logins: a sign-in form's username and password", f1.kind === "password" && f1.password?.id === pw.id && f1.username?.id === user.id, f1)
  const f2 = loginForm([input({ type: "password", form: 2 }), input({ type: "password", form: 2 })])
  check("agent logins: two password fields in a form is a sign-up or a change, not a login", f2.kind === "none", f2)
  const f3 = loginForm([input({ type: "password", visible: false }), input({ autocomplete: "username" })])
  check("agent logins: a hidden password field doesn't count; a username-first page fills its username", f3.kind === "username" && !!f3.username, f3)
  const code = input({ autocomplete: "one-time-code", inputMode: "numeric" })
  const f4 = loginForm([search, code])
  check("agent logins: a page asking for a one-time code", f4.kind === "otp" && f4.otp.length === 1 && f4.otp[0].id === code.id, f4)
  const boxes = Array.from({ length: 6 }, () => input({ maxLength: 1, form: 3 }))
  const f5 = loginForm([search, ...boxes])
  check("agent logins: a code split in a box per digit", f5.kind === "otp" && f5.otp.length === 6, f5)
  check("agent logins: a page with no login form has none", loginForm([search, input({ type: "checkbox" })]).kind === "none")

  // Your own sign-ins (electron/browser/userlogins.ts): what one offers to save.
  const { saveOffer } = await import("../electron/browser/loginform.ts")
  const saved = [{ id: "a", username: "alice@example.com", modified: 1 }, { id: "b", username: "Alice@example.com", modified: 5 }, { id: "c", username: "bob", modified: 3 }]
  check("your logins: a sign-in a site has no entry for offers a new one", JSON.stringify(saveOffer([], "alice", null)) === '{"kind":"new"}' && saveOffer(saved, "carol", new Set())?.kind === "new")
  check("your logins: one whose password an entry of that username has offers nothing", saveOffer(saved, "bob", new Set(["c"])) === null)
  check("your logins: a new password for a username offers to update its newest entry (any case)", JSON.stringify(saveOffer(saved, "alice@EXAMPLE.com", new Set())) === '{"kind":"update","id":"b"}')
  check("your logins: another username's password doesn't count", saveOffer(saved, "bob", new Set(["a"]))?.kind === "update")
  check("your logins: locked, an entry of that username might have it: nothing offered", saveOffer(saved, "bob", null) === null && saveOffer(saved, "dan", null)?.kind === "new")
  check("your logins: no username heard: the site's only entry is the one updated, unless it has it", saveOffer([saved[2]], "", new Set())?.kind === "update"
    && saveOffer([saved[2]], "", new Set(["c"])) === null && saveOffer(saved, "", new Set())?.kind === "new" && saveOffer(saved, "", new Set(["a"])) === null)

  // What agents see of a page that holds a filled secret: never the secret, as is or as an address encodes it.
  const s = "p@ss wörd&1!"
  const encoded = [s, encodeURIComponent(s), encodeURIComponent(s).toLowerCase(), new URLSearchParams([["pw", s]]).toString().slice(3), encodeURI(s)]
  const out = scrub(`Shown: ${encoded.join(" | ")} end`, [s])
  check("agent logins: a secret is scrubbed from text, as is and however an address or a form encodes it", out === `Shown: ${encoded.map(() => "•••").join(" | ")} end`, [out, encoded])
  check("agent logins: text without a secret is unchanged", scrub("nothing here", [s]) === "nothing here" && scrub("p@ss", []) === "p@ss")
  keep("482913", 60_000)
  const answer = scrubDeep({ tab: 3, title: "Code 482913", lines: ["a 482913"], png: "iVBORw0K482913AAAA" })
  check("agent logins: an answer's every string is scrubbed, a picture's bytes left whole", answer.title === "Code •••" && answer.lines[0] === "a •••" && answer.png === "iVBORw0K482913AAAA" && answer.tab === 3, answer)
})

// ---------- Browser: your passwords, the user's own KeePass file (electron/browser/kdbxedit.ts) ----------
// A made-up main file with a KeeShare-exported Agents group, as KeePassXC writes it; never a real one.
await section("your passwords", async () => {
  const kp = await import("../electron/browser/keepass.ts")
  const ed = await import("../electron/browser/kdbxedit.ts")
  const { Credentials, Kdbx, ProtectedValue } = await import("kdbxweb")
  const MAIN = "made-up main password", SHARE = "made-up share password"
  const db = Kdbx.create(new Credentials(ProtectedValue.fromString(MAIN)), "Main")
  const agents = db.createGroup(db.getDefaultGroup(), "Agents")
  const b64 = (s: string) => Buffer.from(s).toString("base64")
  const ref = `<?xml version="1.0"?><KeeShare><Type><Export/></Type><Group>${Buffer.from(agents.uuid.bytes).toString("base64")}</Group><Path>${b64("agents.kdbx")}</Path><Password>${b64(SHARE)}</Password><KeepGroups>True</KeepGroups></KeeShare>`
  agents.customData = new Map([["KeeShare/Reference", { value: b64(ref) }]])
  const bank = db.createEntry(db.getDefaultGroup())
  bank.fields.set("Title", "Bank"); bank.fields.set("UserName", "alice"); bank.fields.set("Password", ProtectedValue.fromString("bank-pw"))
  db.createGroup(agents, "Projects")
  let file = new Uint8Array(await db.save())

  let main = await kp.loadKdbx(file, MAIN)
  const shares = ed.sharesOf(main, path.resolve("/made/up/Main.kdbx"))
  check("your passwords: KeePassXC's KeeShare export is found, its path against the file's folder", shares.length === 1 && shares[0].path === path.resolve("/made/up/agents.kdbx") && shares[0].password === SHARE && shares[0].keepGroups, shares.map((s) => s.path))
  const agentsId = shares[0].group, projects = ed.listOf(main, "/f").groups.find((g) => g.name === "Projects")!.id
  const id = ed.applyChange(main, { group: agentsId, title: "Lighthouse", username: "alice", password: "pw-1", urls: ["https://lighthouse.example.com", "https://auth.lighthouse.example.com"], tags: ["agent-free"], notes: "n" })
  const inSub = ed.applyChange(main, { group: projects, title: "Harbor", username: "bob", password: "pw-h", urls: ["harbor.example.org"], tags: [], notes: "" })
  file = new Uint8Array(await main.save())
  main = await kp.loadKdbx(file, MAIN)
  const list = ed.listOf(main, "/f")
  const light = list.entries.find((e) => e.id === id)!
  check("your passwords: a new entry keeps its addresses, tags and group", light.urls.length === 2 && light.free && light.group === agentsId && light.shared, light)
  check("your passwords: entries in the exported group (and its subgroups) are for agents, others aren't", list.entries.find((e) => e.id === inSub)!.shared && !list.entries.find((e) => e.title === "Bank")!.shared)
  check("your passwords: the list has no secret", !JSON.stringify(list).includes("pw-1") && !JSON.stringify(list).includes("bank-pw"))
  ed.applyChange(main, { id, title: "Lighthouse", username: "alice", password: "pw-2", urls: ["https://lighthouse.example.com"], tags: [], notes: "n" })
  const full = ed.fullOf(main, "/f", id)!
  const entry = ed.entryById(main, id)!
  check("your passwords: an edit changes it and keeps the old one in its history", full.password === "pw-2" && !full.free && full.urls.length === 1 && entry.history.length === 1 && kp.fieldsOf(entry.history[0]).Password === "pw-1")

  const out = await kp.openDatabase(new Uint8Array(await ed.exportOf(main, shares[0])), SHARE)
  const ids = out.entries.map((e) => e.id).sort().join()
  check("your passwords: the export is what agents read, with the same entry ids, subgroups too", ids === [id, inSub].sort().join() && out.secrets(id)?.password === "pw-2", out.entries.map((e) => e.title))
  check("your passwords: nothing outside the exported group reaches agents", !out.entries.some((e) => e.title === "Bank"))

  ed.removeEntry(main, inSub)
  const binned = ed.listOf(main, "/f")
  check("your passwords: deleting goes to the recycle bin first", binned.groups.find((g) => g.id === binned.entries.find((e) => e.id === inSub)?.group)?.bin === true)
  ed.removeEntry(main, inSub)
  check("your passwords: deleting from the bin removes it", !ed.listOf(main, "/f").entries.some((e) => e.id === inSub))
  const after = await kp.openDatabase(new Uint8Array(await ed.exportOf(main, shares[0])), SHARE)
  check("your passwords: a deleted entry leaves the export", !after.entries.some((e) => e.id === inSub))
})

// ---------- Browser: the Passwords page's generator (plugins/core/web-viewer/generate.ts) ----------
await section("password generator", async () => {
  const { generatePassword, GEN_DEFAULTS } = await import("../plugins/core/web-viewer/generate.ts")
  const many = Array.from({ length: 200 }, () => generatePassword(GEN_DEFAULTS))
  check("password generator: 20 characters by default, each with a letter, a digit and a symbol",
    many.every((p) => p.length === 20 && /[a-z]/i.test(p) && /\d/.test(p) && /[^a-z\d]/i.test(p)), many.slice(0, 3))
  check("password generator: no two alike", new Set(many).size === many.length)
  const digits = generatePassword({ length: 12, letters: false, digits: true, symbols: false })
  check("password generator: only the kinds asked for", /^\d{12}$/.test(digits), digits)
  check("password generator: the length kept within 8 to 64", generatePassword({ ...GEN_DEFAULTS, length: 3 }).length === 8 && generatePassword({ ...GEN_DEFAULTS, length: 500 }).length === 64)
  check("password generator: none asked for is letters", /^[a-z]+$/i.test(generatePassword({ length: 10, letters: false, digits: false, symbols: false })))
  // (a draw past the last whole multiple of the alphabet is thrown away: 10 digits, 2^32 - 1 is past it)
  const draws = [0xffff_ffff, 7, 0xffff_ffff, 3, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0]
  const fixed = generatePassword({ length: 8, letters: false, digits: true, symbols: false }, (a) => { a[0] = draws.shift()! })
  check("password generator: unbiased, a draw past the last whole multiple is drawn again", fixed === "73123456", fixed)
  const counts = new Map<string, number>()
  for (let i = 0; i < 400; i++) for (const c of generatePassword({ length: 64, letters: false, digits: true, symbols: false })) counts.set(c, (counts.get(c) ?? 0) + 1)
  const n = [...counts.values()]
  check("password generator: every digit about as often", counts.size === 10 && Math.min(...n) / Math.max(...n) > 0.85, Object.fromEntries(counts))
})

// ---------- Browser: a login sealed for another Mac's app (electron/browser/sealed.ts) ----------
await section("sealed logins", async () => {
  const sl = await import("../electron/browser/sealed.ts")
  const m1 = sl.newKeys(), m4 = sl.newKeys()
  const login = { names: ["example.com"], cookies: [{ name: "session", value: "s3cret", domain: ".example.com", path: "/" }], at: 1 }
  const box = sl.seal(m1.pub, login, "vaultite login for c-agents")
  check("sealed: what the servers pass on holds no cookie", !box.includes("s3cret") && !box.includes("session"))
  const opened = sl.open(m1, box, "vaultite login for c-agents")
  check("sealed: the app it's for opens it as it was", JSON.stringify(opened.data) === JSON.stringify(login) && opened.from.length > 20, opened)
  const fails = (f: () => unknown) => { try { f(); return false } catch { return true } }
  check("sealed: another app's key doesn't open it", fails(() => sl.open(m4, box, "vaultite login for c-agents")))
  check("sealed: it doesn't open for another set of logins", fails(() => sl.open(m1, box, "vaultite login for c-work")))
  const b = JSON.parse(box), ct = Buffer.from(b.ct, "base64url")
  ct[0] ^= 1
  check("sealed: a box changed on the way doesn't open", fails(() => sl.open(m1, JSON.stringify({ ...b, ct: ct.toString("base64url") }), "vaultite login for c-agents")))
  check("sealed: each box has a key of its own", JSON.parse(sl.seal(m1.pub, login, "x")).from !== b.from)
  check("sealed: what isn't a box, or a key, is refused", fails(() => sl.open(m1, "{}", "x")) && fails(() => sl.open(m1, "not json", "x")) && fails(() => sl.seal("nope", login, "x")))
})

// ---------- Browser: where agents from outside this machine may go (core/web.ts localUrl, electron/browser/agent.ts) ----------
await section("agents' local addresses", async () => {
  const { localUrl } = await import("../core/web.ts")
  const os = await import("node:os")
  const local = ["http://127.0.0.1:8793", "http://localhost:3000/x", "http://app.localhost", "http://[::1]:8793", "http://[::ffff:127.0.0.1]", "http://0.0.0.0",
    "http://192.168.1.20", "http://10.0.0.5", "http://172.16.0.1", "http://169.254.169.254/latest", "http://[fe80::1]", "http://100.101.102.103",
    "https://m1.tail1234.ts.net", "http://m1", "http://nas.local:5000", `http://${os.hostname()}:8793`, "not an address"]
  check("agents' addresses: this machine, its network and the tailnet are local", local.every(localUrl), local.filter((u) => !localUrl(u)))
  check("agents' addresses: … a public site isn't", !["https://example.com", "http://93.184.216.34", "https://lighthouse.example.org/a?b"].some(localUrl))
})

// ---------- Browser: the user's passkeys approving agents' logins (electron/browser/presence.ts) ----------
// A made-up authenticator here (a P-256 key, as a phone's passkey has), WebAuthn's bytes built by hand.
await section("login approvals", async () => {
  const pr = await import("../electron/browser/presence.ts")
  const { encode } = await import("../electron/browser/cbor.ts")
  const crypto = await import("node:crypto")
  const RP = "m1.example.ts.net", ORIGIN = `https://${RP}:8447`
  const sha = (b: Buffer | string) => crypto.createHash("sha256").update(b).digest()
  const b64u = (b: Uint8Array) => Buffer.from(b).toString("base64url")
  const device = () => {
    const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" })
    const j = publicKey.export({ format: "jwk" })
    const cose = encode(new Map<number, Buffer | number>([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(j.x!, "base64url")], [-3, Buffer.from(j.y!, "base64url")]]))
    return { privateKey, cose, id: crypto.randomBytes(16) }
  }
  const authData = (rp: string, flags: number, counter: number, attested?: { id: Buffer; cose: Buffer }) => {
    const c = Buffer.alloc(4); c.writeUInt32BE(counter)
    const parts: Uint8Array[] = [sha(rp), Buffer.from([flags]), c]
    if (attested) { const n = Buffer.alloc(2); n.writeUInt16BE(attested.id.length); parts.push(Buffer.alloc(16), n, attested.id, attested.cose) }
    return Buffer.concat(parts)
  }
  const client = (type: string, challenge: Buffer, origin = ORIGIN) => Buffer.from(JSON.stringify({ type, challenge: b64u(challenge), origin, crossOrigin: false }))
  const created = (d: ReturnType<typeof device>, challenge: Buffer, o: { rp?: string; flags?: number; origin?: string } = {}) => ({
    clientDataJSON: b64u(client("webauthn.create", challenge, o.origin)),
    attestationObject: b64u(encode(new Map<string, unknown>([["fmt", "none"], ["attStmt", new Map()], ["authData", authData(o.rp ?? RP, o.flags ?? 0x45, 0, d)]]) as never)) })
  const signed = (d: ReturnType<typeof device>, challenge: Buffer, o: { rp?: string; flags?: number; origin?: string; counter?: number; key?: import("node:crypto").KeyObject } = {}) => {
    const ad = authData(o.rp ?? RP, o.flags ?? 0x05, o.counter ?? 0), cd = client("webauthn.get", challenge, o.origin)
    const signature = crypto.sign("sha256", Buffer.concat([ad, sha(cd)]), { key: o.key ?? d.privateKey, dsaEncoding: "der" })
    return { id: b64u(d.id), clientDataJSON: b64u(cd), authenticatorData: b64u(ad), signature: b64u(signature) }
  }
  const fails = (fn: () => unknown) => { try { fn(); return "" } catch (e) { return (e as Error).message || "failed" } }

  const phone = device(), c1 = crypto.randomBytes(32)
  const pk = pr.register(created(phone, c1), c1, "iPhone")
  check("login approvals: a passkey registers, for the page's own site", pk.id === b64u(phone.id) && pk.rpId === RP && pk.origin === ORIGIN && pk.name === "iPhone", pk)
  const refusedReg = {
    "another challenge": fails(() => pr.register(created(phone, c1), crypto.randomBytes(32), "x")),
    "no user verification": fails(() => pr.register(created(phone, c1, { flags: 0x41 }), c1, "x")),
    "another site's hash": fails(() => pr.register(created(phone, c1, { rp: "evil.example" }), c1, "x")),
    "an http page": fails(() => pr.register(created(phone, c1, { origin: `http://${RP}` }), c1, "x")),
  }
  check("login approvals: a registration for another challenge, without Face ID or Touch ID, of another site or over http fails", Object.values(refusedReg).every(Boolean), refusedReg)

  const c2 = crypto.randomBytes(32)
  const ok = pr.verify(signed(phone, c2), [pk], c2)
  check("login approvals: the phone's assertion verifies", ok.passkey.id === pk.id, ok)
  const other = device()
  const refused = {
    "forged (another key)": fails(() => pr.verify(signed(phone, c2, { key: other.privateKey }), [pk], c2)),
    "an unknown passkey": fails(() => pr.verify(signed(other, c2), [pk], c2)),
    "another challenge (replayed)": fails(() => pr.verify(signed(phone, c2), [pk], crypto.randomBytes(32))),
    "no user verification": fails(() => pr.verify(signed(phone, c2, { flags: 0x01 }), [pk], c2)),
    "another site": fails(() => pr.verify(signed(phone, c2, { rp: "evil.example", origin: "https://evil.example" }), [pk], c2)),
    "another origin for its site": fails(() => pr.verify(signed(phone, c2, { origin: "https://evil.example" }), [pk], c2)),
    "its client data changed": fails(() => pr.verify({ ...signed(phone, c2), clientDataJSON: b64u(Buffer.from(JSON.stringify({ type: "webauthn.get", challenge: b64u(c2), origin: ORIGIN, crossOrigin: true }))) }, [pk], c2)),
    "a counter gone back": fails(() => pr.verify(signed(phone, c2, { counter: 3 }), [{ ...pk, counter: 5 }], c2)),
  }
  check("login approvals: forged, unknown, replayed, unverified, other sites', changed or counted-back assertions fail", Object.values(refused).every(Boolean), refused)
  check("login approvals: a counter that goes up is new", pr.verify(signed(phone, c2, { counter: 6 }), [{ ...pk, counter: 5 }], c2).counter === 6)
})

await section("pagers", async () => {
  const { band, fling, stopFor, within }: Any = await web("core/pager.ts")
  const { spring }: Any = await web("core/motion.ts")
  const w = 410
  check("pagers: past an end the give grows less and less, never a page", band(100, w) < 60 && band(400, w) - band(300, w) < band(100, w) && band(5000, w) < w && band(-100, w) === -band(100, w), [band(100, w), band(400, w), band(5000, w)])
  check("pagers: between the ends the track is the finger's", within(-200, -w, w, w) === -200 && within(-500, -w, 0, w) > -w - 60 && within(30, -w, 0, w) < 30, [within(-500, -w, 0, w), within(30, -w, 0, w)])
  check("pagers: a let-go's speed is over its last 100 ms; none once the finger stopped", Math.abs(fling([[0, 0], [100, 50], [150, 100], [180, 130]], 185) - 1) < 1e-9 && fling([[0, 0], [16, 20]], 120) === 0, [fling([[0, 0], [100, 50], [150, 100], [180, 130]], 185), fling([[0, 0], [16, 20]], 120)])
  const stops = [-w, 0, w]
  check("pagers: slow, the page most on screen; a flick goes on its way however short", stopFor(stops, -150, 0) === 0 && stopFor(stops, -230, 0) === -w && stopFor(stops, -20, -0.5) === -w && stopFor(stops, -300, 0.5) === 0 && stopFor([0, w], -40, -2) === 0,
    [stopFor(stops, -150, 0), stopFor(stops, -230, 0), stopFor(stops, -20, -0.5), stopFor(stops, -300, 0.5), stopFor([0, w], -40, -2)])
  const rest = spring(0.34, 1), fast = spring(0.34, 1, 10)
  check("pagers: a spring started at a flick's speed is further along early, and still lands without overshooting", fast.at(0.05) > rest.at(0.05) && Array.from({ length: 60 }, (_, i) => fast.at(i / 100)).every((x) => x <= 1.0001), [rest.at(0.05), fast.at(0.05)])
})

await section("screen drawings", async () => {
  const sm: Any = await import(pathToFileURL(path.join(ROOT, "plugins/core/companion/screenmarks.ts")).href)
  const lay: Any = await web("screendraw/layout.ts")
  const dr: Any = await import(pathToFileURL(path.join(ROOT, "electron/drawing.ts")).href)
  const err = (marks: unknown) => { try { sm.checkMarks(marks); return "" } catch (e) { return (e as Error).message } }
  // ---- the vocabulary, checked
  const ok = sm.checkMarks([{ type: "ring", at: [10, 20, 30, 40], label: "Share", beat: 1 }, { type: "point", at: [5, 6] }, { type: "connect", from: { el: "e12" }, to: { x: 1, y: 2, width: 3, height: 4 } },
    { type: "paper", title: "Plan", grid: true, items: [{ type: "chart", kind: "bar", values: [1, 2] }, { type: "arrow", from: [0, 0], to: [100, 50], label: "then" }] },
    { type: "button", label: "Next", do: { ask: "Go on" } }, { type: "scroll", at: { ui: "tab:t3" } }])
  check("screen drawings: spots read as boxes, el/pane/ui kept; defaults filled (scroll down, a pad's size, a chart's box)",
    JSON.stringify(ok[0].at) === '{"x":10,"y":20,"w":30,"h":40}' && JSON.stringify(ok[1].at) === '{"x":5,"y":6,"w":0,"h":0}' && ok[2].from.el === "e12" && ok[2].to.w === 3 &&
    ok[3].w === 360 && ok[3].items[0].w === 328 && ok[5].dir === "down" && ok[0].beat === 1, ok)
  const bad = {
    type: err([{ type: "circle", at: [1, 2] }]), spot: err([{ type: "ring", at: [1, 2, 3] }]), el: err([{ type: "ring", at: { el: "a b" } }]), url: err([{ type: "open", url: "javascript:alert(1)" }]),
    outside: err([{ type: "paper", items: [{ type: "rect", x: 300, y: 10, w: 100, h: 20 }] }]), labels: err([{ type: "paper", items: [{ type: "chart", kind: "bar", values: [1, 2], labels: ["a"] }] }]),
    action: err([{ type: "button", label: "x", do: { run: "rm" } }]), many: err(Array.from({ length: 41 }, () => ({ type: "check", at: [0, 0] }))), list: err({ type: "ring" }),
  }
  check("screen drawings: what's wrong says which mark and how it's written (no unknown types, scripts, links but http, items off the pad)",
    bad.type.startsWith("marks[0] (circle): type is one of") && bad.spot.includes("[x, y, w, h] or [x, y]") && bad.spot.includes("{\"find\"") && bad.el.includes("at.el: an id") && bad.url.includes("http(s)") &&
    bad.outside.includes("items[0]: x, y, w, h: inside the paper") && bad.labels.includes("one per value") && bad.action.includes("do:") && bad.many.includes("at most 40") && bad.list.includes("a JSON list"), bad)
  check("screen drawings: the app's places a drawing names, to find on screen", sm.appPlaces(ok).join() === "ui:tab:t3")
  // ---- beats, with the words' sentences
  check("screen drawings: words read as sentences (a line's end too)", sm.sentences("Click Share. Then pick who!\nDone").join("|") === "Click Share.|Then pick who!|Done")
  const times = sm.beatTimes("Click Share up here. Then pick who you want in the list.", 2)
  check("screen drawings: each beat starts when the sentence before is read, longer ones later; past the words, a steady pace", times[0] === 0 && times[1] >= 700 && times[2] - times[1] > times[1] && times[2] - times[1] <= 3500, times)
  // ---- paced to the voice: each beat while its sentence is heard
  const cap = "Click **Share** up here. Then pick who you want in the list. Done."
  const heard = sm.heardBeats(cap, [{ text: "Let me look.", at: 500, dur: 600 }, { text: "Click Share up here.", at: 1000, dur: 1400 }, { text: "Then pick who you want in the list.", at: 2600, dur: 2000 }])
  check("screen drawings: the caption's sentences matched in order to those heard (its words, Markdown aside), none for one not said yet",
    JSON.stringify(heard) === '[{"at":1000,"dur":1400},{"at":2600,"dur":2000},null]', heard)
  const paced = sm.pacedBeats(cap, 2, heard, 800), still = sm.pacedBeats(cap, 2, undefined, 0)
  check("screen drawings: heard, a beat starts as its sentence does and spreads over it; not yet heard, as the last one ends; no voice, the reading pace",
    JSON.stringify(paced.times) === "[200,1800,3800]" && JSON.stringify(paced.spread) === "[1400,2000,null]" && JSON.stringify(still.times) === JSON.stringify(sm.beatTimes(cap, 2)) &&
    sm.pacedBeats(cap, 1, [{ at: 0, dur: 500 }, null], 2000).times.join() === "0,0", { paced, still })
  // ---- labels: never over what they name, always on screen
  const rnd = (() => { let a = 7; return () => { a = (a * 16807) % 2147483647; return a / 2147483647 } })(), screen = { x: 0, y: 25, w: 1280, h: 775 }
  const bads: unknown[] = []
  for (let i = 0; i < 400; i++) {
    const w = 10 + rnd() * 400, h = 10 + rnd() * 200, t = { x: rnd() * (1280 - w), y: 25 + rnd() * (775 - h), w, h }, size = { w: 40 + rnd() * 120, h: 22 }
    const taken = [{ x: t.x + t.w + 10, y: t.y - 30, w: 80, h: 22 }], l = lay.labelAt(t, size, screen, taken)
    if (!lay.inside(l, screen) || lay.overlaps(l, t)) bads.push({ t, l })
  }
  check("screen drawings: a label never covers its target and stays on screen (400 random targets, edges and corners)", !bads.length, bads.slice(0, 3))
  const huge = lay.labelAt({ x: 0, y: 25, w: 1280, h: 775 }, { w: 60, h: 22 }, screen)
  check("screen drawings: a target as big as the screen: its label still on screen", lay.inside(huge, screen), huge)
  const corner = lay.labelAt({ x: 1240, y: 26, w: 40, h: 20 }, { w: 90, h: 22 }, screen)
  check("screen drawings: in the top right corner it goes below or left, never off screen", lay.inside(corner, screen) && !lay.overlaps(corner, { x: 1240, y: 26, w: 40, h: 20 }), corner)
  // ---- calm space, a whole drawing placed
  const avoid = [{ x: 100, y: 100, w: 600, h: 300 }], spot = lay.calmSpot({ w: 300, h: 200 }, screen, avoid, { x: 400, y: 250 })
  check("screen drawings: a card goes on calm space nearest where it's wanted, clear of what's marked", lay.inside(spot, screen) && !lay.overlaps(spot, lay.inflate(avoid[0], 24)), spot)
  const d = { id: "d1", agent: "Claude", tint: "orange", t: 0, places: { "el:e1": { x: 1500, y: 300, w: 80, h: 30 } }, marks: sm.checkMarks([
    { type: "ring", at: { el: "e1" }, label: "This one" }, { type: "connect", from: { el: "e1" }, to: [200, 300, 100, 40], label: "goes here" }, { type: "frame", at: [180, 280, 140, 80], label: "Area" },
    { type: "point", at: [1700, 700], label: "There" }, { type: "write", text: "A note on calm space" }, { type: "sticky", text: "Remember" }, { type: "check", at: [600, 600, 40, 20] }]) }
  const one = { width: 1280, height: 800, origin: { x: 0, y: 0 }, home: true, top: 25 }, two = { width: 1280, height: 800, origin: { x: 1280, y: 0 }, home: false, top: 25 }
  const size = (m: Any) => (m.label ? { w: m.label.length * 7 + 18, h: 22 } : null)
  const a = lay.place(d, one, size), b = lay.place(d, two, size)
  const types = (ps: Any[]) => ps.map((p) => p.mark.type).join()
  check("screen drawings: each display draws its marks (a connect on both its ends'), the home one the cards", types(a) === "connect,frame,write,sticky,check" && types(b) === "ring,connect,point", [types(a), types(b)])
  const ring = b.find((p: Any) => p.mark.type === "ring")
  check("screen drawings: a display's marks in its own points", ring.box.x === 220 && ring.box.y === 300, ring.box)
  const all = [...a, ...b], marks = all.filter((p: Any) => p.box && !sm.CARDS.has(p.mark.type)).map((p: Any) => p.box)
  const labelsBad = all.filter((p: Any) => p.label && (!lay.inside(p.label, { x: 0, y: 25, w: 1280, h: 775 }) || (p.mark.type !== "connect" && lay.overlaps(p.label, p.box))))
  check("screen drawings: placed labels stay on screen, off their targets", all.filter((p: Any) => p.label).length === 5 && !labelsBad.length, labelsBad)
  const cards = a.filter((p: Any) => p.card)
  check("screen drawings: placed cards apart, on screen, clear of every mark", cards.length === 2 && !lay.overlaps(cards[0].card, cards[1].card) && cards.every((c: Any) => lay.inside(c.card, { x: 0, y: 25, w: 1280, h: 775 }) && !marks.some((m: Any) => lay.overlaps(c.card, m))), cards.map((c: Any) => c.card))
  const busy = [{ x: 0, y: 25, w: 1280, h: 300 }], roomy = lay.calmSpot({ w: 200, h: 100 }, screen, busy, { x: 600, y: 200 })
  check("screen drawings: a card goes to the emptiest room, not just next to what's on screen", roomy.y >= 325 + 24 + 120, roomy)
  const own = { ...d, places: { "el:b": { x: 600, y: 300, w: 80, h: 30, label: "Share" } }, marks: sm.checkMarks([{ type: "ring", at: { el: "b" }, label: "share" }, { type: "ring", at: { el: "b" }, label: "Send it here" }]) }
  const ownLabels = lay.place(own, one, size).map((p: Any) => !!p.label).join()
  check("screen drawings: a label that only repeats its element's own word is left out", ownLabels === "false,true", ownLabels)
  // ---- frames: side by side a hairline apart, their labels snug at them on one side, never on each other
  const sections = [[8, 40, 274, 36], [8, 76, 274, 120], [8, 196, 274, 300], [8, 496, 274, 101], [8, 597, 274, 255], [8, 852, 274, 45]]
  const sidebar = { ...d, places: {}, marks: sm.checkMarks(sections.map((r, i) => ({ type: "frame", at: r, label: ["Search", "Pinned", "Tabs", "Inbox", "Files", "Vault"][i], beat: i }))) }
  const tall = { width: 1470, height: 956, origin: { x: 0, y: 0 }, home: true, top: 33 }, framed = lay.place(sidebar, tall, size)
  const inkClash = framed.flatMap((p: Any, i: number) => framed.slice(i + 1).filter((q: Any) => lay.overlaps(p.ink, q.ink)).map((q: Any) => [p.mark.label, q.mark.label]))
  const gapTo = (l: Any, f: Any) => Math.hypot(Math.max(0, f.x - (l.x + l.w), l.x - (f.x + f.w)), Math.max(0, f.y - (l.y + l.h), l.y - (f.y + f.h)))
  const loose = framed.filter((p: Any) => !p.label || gapTo(p.label, p.ink) > 3 || lay.overlaps(p.label, p.ink) || !lay.inside(p.label, { x: 0, y: 33, w: 1470, h: 923 }))
  const tagClash = framed.flatMap((p: Any, i: number) => framed.slice(i + 1).filter((q: Any) => lay.overlaps(p.label, q.label)).map((q: Any) => [p.mark.label, q.mark.label]))
  const sides = new Set(framed.map((p: Any) => p.label.x - (p.ink.x + p.ink.w)))
  check("screen drawings: stacked frames (a sidebar's panels) never overlap; each label snug at its frame, on screen, none on another, all on one side",
    !inkClash.length && !loose.length && !tagClash.length && sides.size === 1, { inkClash, loose: loose.map((p: Any) => [p.mark.label, p.label, p.ink]), tagClash, sides: [...sides] })
  const firstThree = lay.place({ ...sidebar, marks: sidebar.marks.slice(0, 3) }, tall, size).map((p: Any) => JSON.stringify(p.label)).join()
  check("screen drawings: the next frame down (a walkthrough's next beat) moves no label before it", firstThree === framed.slice(0, 3).map((p: Any) => JSON.stringify(p.label)).join(), firstThree)
  const guessed = lay.place({ ...d, places: {}, marks: sm.checkMarks([{ type: "frame", at: [100, 100, 200, 100] }, { type: "frame", at: [100, 190, 200, 100] }]) }, one, size)
  check("screen drawings: frames a little over each other (boxes guessed from the picture) are drawn apart too", !lay.overlaps(guessed[0].ink, guessed[1].ink), guessed.map((p: Any) => p.ink))
  const lone = lay.place({ ...d, places: {}, marks: sm.checkMarks([{ type: "frame", at: [400, 300, 200, 100], label: "Chart" }]) }, one, size)[0]
  check("screen drawings: a frame alone is named over its top left, as a design tool names one", lone.label.x === lone.ink.x && lone.label.y + lone.label.h === lone.ink.y - 3, [lone.label, lone.ink])
  // ---- the electron side: which display has the cards; only what the drawing offers runs
  const displays = [{ id: 1, bounds: { x: 0, y: 0, width: 1280, height: 800 } }, { id: 2, bounds: { x: 1280, y: 0, width: 1280, height: 800 } }]
  check("screen drawings: the home display is where its first place is, else the pointer's", dr.homeOf(d, displays, { x: 10, y: 10 }) === 2 && dr.homeOf({ ...d, marks: [{ type: "write", text: "x" }] }, displays, { x: 1300, y: 10 }) === 2, dr.homeOf(d, displays, { x: 10, y: 10 }))
  check("screen drawings: an ask's elements become its places, by id", JSON.stringify(dr.elementPlaces([{ id: "a3", role: "AXButton", label: "Share", frame: { x: 1, y: 2, width: 3, height: 4 } }])) === '{"el:a3":{"x":1,"y":2,"w":3,"h":4,"label":"Share"}}')
  const offer = { ...d, marks: sm.checkMarks([{ type: "copy", text: "abc" }, { type: "button", label: "Go", do: { open: "https://lighthouse.test" } }]) }
  check("screen drawings: a copy or an open runs only when the drawing offers it", dr.offered(offer, { id: "d1", kind: "copy", text: "abc" }) && dr.offered(offer, { id: "d1", kind: "open", url: "https://lighthouse.test" }) &&
    !dr.offered(offer, { id: "d1", kind: "open", url: "https://evil.test" }) && !dr.offered(offer, { id: "d1", kind: "copy", text: "other" }))
  // ---- kept: an .excalidraw scene
  const scene = sm.toExcalidraw(sm.checkMarks([{ type: "paper", title: "Plan", items: [{ type: "rect", x: 10, y: 10, w: 100, h: 50, label: "Idea" }, { type: "arrow", from: [110, 35], to: [200, 35] },
    { type: "chart", kind: "bar", x: 10, y: 100, w: 200, h: 100, values: [1, -2, 3], labels: ["a", "b", "c"] }, { type: "path", points: [[0, 0], [10, 10], [20, 5]] }] },
    { type: "sticky", text: "Remember" }, { type: "ring", at: [10, 10, 20, 20] }]), { tint: "blue" })
  const els = scene.elements, ids = new Set(els.map((e: Any) => e.id))
  const box = els.find((e: Any) => e.type === "rectangle" && e.boundElements), label = box && els.find((e: Any) => e.id === box.boundElements[0].id)
  check("screen drawings: kept as Excalidraw's JSON: unique ids, a shape's label bound both ways, arrows' points relative, its tint as Excalidraw's blue",
    scene.type === "excalidraw" && scene.version === 2 && ids.size === els.length && label?.containerId === box.id && label.text === "Idea" &&
    els.some((e: Any) => e.type === "arrow" && e.endArrowhead === "arrow" && e.points[0][0] === 0 && e.points[1][0] === 90) && els.some((e: Any) => e.strokeColor === "#1971c2") &&
    els.every((e: Any) => Number.isFinite(e.x) && Number.isFinite(e.y) && Number.isFinite(e.width) && e.width >= 0 && e.height >= 0), els.slice(0, 4))
  check("screen drawings: a chart's bars (a negative one below its axis) and labels; the sticky beside the pad; screen marks only with all",
    els.filter((e: Any) => e.type === "rectangle" && e.fillStyle === "hachure").length === 3 && els.filter((e: Any) => e.type === "text" && ["a", "b", "c"].includes(e.text)).length === 3 &&
    els.some((e: Any) => e.type === "rectangle" && e.backgroundColor === "#ffec99" && e.x >= 400) && !els.some((e: Any) => e.type === "ellipse" && e.width === 40), els.length)
  const withMarks = sm.toExcalidraw(sm.checkMarks([{ type: "ring", at: { el: "e1" } }]), { all: true, places: { "el:e1": { x: 10, y: 10, w: 20, h: 20 } } })
  check("screen drawings: with all, the marks too, where the overlay found them; nothing worth keeping, none", withMarks?.elements.some((e: Any) => e.type === "ellipse") && sm.toExcalidraw(sm.checkMarks([{ type: "ring", at: [1, 1] }])) === null)
  // ---- marks anchor to what's meant: words to find, and a guessed pixel snapped to what's there
  const found = sm.checkMarks([{ type: "ring", at: { find: "Morning report" } }, { type: "connect", from: { find: "A" }, to: { el: "a1" } }])
  check("screen drawings: a spot can be words to find; they're the places the screen must find, read back from them",
    found[0].at.find === "Morning report" && sm.findsOf(found).join() === "Morning report,A" && sm.rectOf({ find: "A" }, { "find:A": { x: 1, y: 2, w: 3, h: 4 } })?.w === 3 &&
    /find/.test(err([{ type: "ring", at: { find: "" } }])), found)
  // (the pinned icons: a section 0,120 270x100, an icon in it; they drew a ring round the section)
  const places = { "el:a1": { x: 140, y: 150, w: 30, h: 30 }, "el:a2": { x: 0, y: 120, w: 270, h: 100 }, "el:a3": { x: 400, y: 400, w: 60, h: 20 } }
  const at = (marks: unknown[], drawn: unknown[] = []) => sm.snapMarks(sm.checkMarks(marks), places, drawn).map((m: Any) => m.at)
  const [inRing, onIcon, byButton, alone, likeSection, pointed] = at([{ type: "ring", at: [100, 200] }, { type: "ring", at: [155, 165] }, { type: "frame", at: [395, 410] },
    { type: "ring", at: [900, 900] }, { type: "frame", at: [8, 125, 260, 92] }, { type: "point", at: [150, 170] }], [{ x: 0, y: 101, w: 293, h: 146 }, { x: 145, y: 155, w: 20, h: 20 }])
  check("screen drawings: a ring at a guessed pixel goes round what they drew there (the smallest; round the elements in it), the element it's on or by, else stays; a box like an element's is it; a point is a point",
    JSON.stringify(inRing) === '{"x":0,"y":120,"w":270,"h":100}' && JSON.stringify(onIcon) === '{"x":145,"y":155,"w":20,"h":20}' && byButton.el === "a3" &&
    alone.x === 900 && alone.w === 0 && likeSection.el === "a2" && pointed.x === 150 && at([{ type: "ring", at: [155, 165] }])[0].el === "a1", [inRing, onIcon, byButton, alone, likeSection, pointed])
  // (the sidebar's tab groups, circled: a ring at a pixel in it, or a box much like it, frames the groups, not one of them)
  const groups = { "el:g1": { x: 4, y: 262, w: 90, h: 24 }, "el:g2": { x: 4, y: 290, w: 90, h: 24 }, "el:g3": { x: 4, y: 318, w: 90, h: 24 }, "el:x": { x: 70, y: 290, w: 16, h: 16 } }
  const ink = [{ x: 0, y: 258, w: 97, h: 129 }]
  const [ringed, boxed] = [sm.snapMarks(sm.checkMarks([{ type: "ring", at: [48, 310], label: "Tab groups" }]), groups, ink)[0], sm.snapMarks(sm.checkMarks([{ type: "frame", at: [0, 258, 141, 131] }]), groups, ink)[0]]
  check("screen drawings: what they circled is framed whole, round the things inside it: a ring there is a frame",
    ringed.type === "frame" && ringed.label === "Tab groups" && JSON.stringify(ringed.at) === '{"x":4,"y":262,"w":90,"h":80}' && boxed.type === "frame" && JSON.stringify(boxed.at) === '{"x":4,"y":262,"w":90,"h":80}', [ringed, boxed])
  const spotsFound = [{ x: 100, y: 100, w: 50, h: 20, q: 2 }, { x: 800, y: 100, w: 50, h: 20, q: 2 }, { x: 900, y: 600, w: 50, h: 20, q: 1 }]
  check("screen drawings: of the places words were found, the best match, then the nearest what they drew or pointed at",
    sm.bestFound(spotsFound, [{ x: 820, y: 90, w: 0, h: 0 }])?.x === 800 && sm.bestFound(spotsFound, [{ x: 120, y: 90, w: 0, h: 0 }])?.x === 100 && sm.bestFound(spotsFound)?.x === 100 &&
    sm.bestFound([...spotsFound, { x: 0, y: 0, w: 5, h: 5, q: 3 }], [{ x: 820, y: 90, w: 0, h: 0 }])?.q === 3 && sm.bestFound([]) === null)
  const near = [{ id: "a1", label: "Address and search bar" }, { id: "a2", label: "Send" }, { id: "a3", label: "Send later" }, { id: "a4", label: "New tab" }]
  check("screen drawings: words name the element saying them: the same words first, then the most like them",
    sm.byLabel(near, "send")?.id === "a2" && sm.byLabel(near, "Send later")?.id === "a3" && sm.byLabel(near, "address bar") === null && sm.byLabel(near, "the New tab button")?.id === "a4" && sm.byLabel(near, "") === null)
  const tg: Any = await import(pathToFileURL(path.join(ROOT, "plugins/core/companion/tags.ts")).href)
  const { said, tags } = tg.parseTags('Here [ring "Morning report"] and there [arrow a1 "Send"], with [ring a2 "Share"].')
  check("screen drawings: a mark tag with words alone marks the thing saying them (no label repeating them); an arrow's end can be words",
    said === "Here and there, with." && tags.length === 3 && JSON.stringify(tg.markOf(tags[0])) === '{"type":"ring","at":{"find":"Morning report"}}' &&
      JSON.stringify(tg.markOf(tags[1]).to) === '{"find":"Send"}' && tg.markOf(tags[2]).label === "Share" && tg.markOf(tags[2]).at.el === "a2", [said, tags])
  const long = tg.parseTags(`[frame "The Morning report bug (Bug 2026-11-06 08.49) has a different cause: folded callouts with videos in the editor, where an embed is mounted and dropped 3 ms later. Hand it to its own session?" "Morning report bug"] That one.`), wrong = tg.parseTags("[frame] Here. [ring] There.")
  const streaming = tg.parseTags(`Look [frame "The Morning report bug (Bug 2026-11-06 08.49) has a different cause: folded callouts with videos in the editor, where an embed is mounted and dropped 3 ms later. Hand it to its own session?`)
  check("screen drawings: a tag naming its kind is never said, however long its words (it's a mark) or wrong (dropped), streamed too",
    long.said === "That one." && long.tags.length === 1 && wrong.said === "Here. There." && !wrong.tags.length && streaming.said === "Look", [long, wrong, streaming])
})

// ---------- Autosave (web/src/core/autosave.ts): on a made-up server that merges as core/files.ts PUT does ----------
await section("autosave", async () => {
  const { textHash, applyEdit, editOf } = await import("../core/texthash.ts")
  const P = "Notes/Lighthouse.md"
  // The server: the file, its time, whether it answers, and a gate holding answers (a save on its way)
  const srv = { text: "", mtime: 1, down: false, gate: null as Promise<void> | null, puts: 0 }
  const file = () => ({ path: P, text: srv.text, mtime: srv.mtime, kind: null, problems: [] })
  const res = (status: number, body: unknown) => ({ status, ok: status < 300, statusText: "", json: async () => body })
  const handle = (b: Any) => {
    const cur = srv.text
    let text = b.text
    if (b.edit !== undefined) {
      if (textHash(cur) !== b.baseHash) return res(412, { error: "the file changed on disk: send its base to merge" })
      text = applyEdit(cur, b.edit)
    }
    const sent = text
    if (b.base != null && cur !== b.base && cur !== text) {
      const m = merge.merge3(b.base, text, cur)
      if (m === null) return res(409, { error: "the file changed on disk in the same place", ...file() })
      text = m
    }
    srv.puts++
    // (as Note dates does: a save stamps updated)
    srv.mtime++
    srv.text = text.replace(/^updated: \d+$/m, `updated: ${srv.mtime}`)
    const { text: _, ...rest } = file()
    return res(200, b.lean ? (srv.text === sent ? { ...rest, same: true } : { ...rest, edit: editOf(sent, srv.text) }) : file())
  }
  const fake: Any = (globalThis as Any).__autosave = {
    back: new Set<() => void>(), toasts: [] as string[], posts: [] as [string, Any][],
    async request(_m: string, _p: string, body: Any) {
      if (srv.down) throw new TypeError("Failed to fetch")
      const r = handle(body)
      fake.wrote?.()
      if (srv.gate) await srv.gate
      return r
    },
    async readFile() { return file() },
    async get(p: string) { return p.startsWith("activity") ? { events: [] } : { mtime: srv.mtime, size: srv.text.length } },
    async putJson(_p: string, b: Any) { srv.text = b.text; srv.mtime++; return file() },
  }
  // (the page's events, which the module listens to as a browser's)
  const win = new EventTarget(), doc = Object.assign(new EventTarget(), { visibilityState: "visible" })
  const g = globalThis as Any
  g.addEventListener = win.addEventListener.bind(win); g.removeEventListener = win.removeEventListener.bind(win); g.document = doc
  const as: Any = await web("core/autosave.ts")
  const ticks = async (n = 30) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)) }
  /** An editor on the file as it is now: its text, what autosave said, and how to close it; `inPlace`, it shows a
   *  conflict's clashes in its text (`shown`: them, and how it says how many are left), as editor/conflicts.ts does. */
  const open = (inPlace = false) => {
    let typed = srv.text, shown: Any = null
    const said: Any[] = []
    const conflict = inPlace ? (text: string, clashes: Any[], _who: unknown, left: Any) => { typed = text; shown = { clashes, left }; return true } : undefined
    const saver = as.makeAutosave(P, srv.text, { text: () => typed, apply: (t: string) => { typed = t }, onStatus: (s: Any) => said.push(s), onGone: () => {}, conflict })
    const close = saver.mount()
    return { saver, close, said, get text() { return typed }, get shown() { return shown }, type(t: string) { typed = t; saver.changed() }, set(t: string) { typed = t } }
  }

  {
    srv.text = "---\nupdated: 1\n---\na\nb\n"
    const ed = open()
    ed.type("---\nupdated: 1\n---\na\nb\nc\n")
    srv.text = "---\nupdated: 1\n---\nagent\na\nb\n" // (an agent's line, written as the save goes)
    let open_ = () => {}
    srv.gate = new Promise((r) => { open_ = r })
    void ed.saver.save()
    await ticks()
    ed.close() // (closed before the save's answer, which merged the agent's line in)
    srv.gate = null
    open_()
    await ticks()
    check("autosave: a note closed mid-save keeps the line an agent wrote, and what was typed", srv.text.includes("agent\n") && srv.text.includes("c\n"), srv.text)
    const puts = srv.puts
    ed.saver.changed(); ed.saver.save(); await ticks()
    check("autosave: closed, typing and saving do nothing", srv.puts === puts, srv.puts - puts)
  }
  {
    srv.text = "one\n"
    const ed = open()
    srv.down = true
    ed.type("one\ntwo\n")
    await ed.saver.save()
    check("autosave: a save that can't reach the server says so", ed.said.at(-1)?.kind === "error", ed.said.at(-1))
    srv.down = false
    for (const fn of fake.back) fn()
    await ticks()
    check("autosave: a failed save is sent again when the connection is back, with no keystroke", srv.text === "one\ntwo\n" && ed.said.at(-1)?.kind === "ok", { text: srv.text, said: ed.said.at(-1) })
    srv.down = true
    ed.type("one\ntwo\nthree\n")
    await ed.saver.save()
    srv.down = false
    doc.dispatchEvent(new Event("visibilitychange"))
    await ticks()
    check("autosave: and when the page is shown again", srv.text === "one\ntwo\nthree\n" && ed.said.at(-1)?.kind === "ok", srv.text)
    ed.close()
  }
  {
    srv.text = "v1\n"
    const stale = file()
    const ed = open()
    ed.type("v2\n")
    await ed.saver.save()
    await ed.saver.check(stale) // (the read made as it opened, landing after the save)
    await ticks()
    check("autosave: a read older than the last save doesn't take the note back", ed.text === "v2\n" && srv.text === "v2\n", { text: ed.text, disk: srv.text })
    ed.close()
  }
  {
    srv.text = "a\n"
    const ed = open()
    ed.type("a\nx\n")
    srv.text = "a\nagent\n"
    void ed.saver.check() // (heard while a save is pending: it waits for it)
    ed.type("a\n") // (typed away again: nothing left to save)
    await ed.saver.save()
    await ticks()
    check("autosave: a change heard while a save was pending is merged in even when there was nothing to save", ed.text === "a\nagent\n", ed.text)
    ed.close()
  }
  {
    srv.text = "a\nb\n"
    const ed = open()
    ed.type("a\nb\nc\n")
    srv.text = "agent\na\nb\n"
    let open_ = () => {}
    srv.gate = new Promise((r) => { open_ = r })
    void ed.saver.save()
    await ticks()
    ed.type("a\nb\nc\nd\n") // (typed on as it saved, then closed)
    ed.close()
    srv.gate = null
    open_()
    await ticks()
    check("autosave: closed mid-save after typing on, the agent's line, what was sent and what came after are all kept", srv.text === "agent\na\nb\nc\nd\n", srv.text)
  }
  {
    // A conflict shown in place, then its editor goes (a plugin's page view): settled from the banner, with what was
    // done in that view (a task ticked) saved too, and no agent's edit taken meanwhile.
    srv.text = "a\nb\n- [ ] t\n"
    const ed = open(true)
    ed.type("a\nmine\n- [ ] t\n")
    srv.text = "a\ntheirs\n- [ ] t\n"
    await ed.saver.save()
    await ticks()
    const shown = ed.said.at(-1)
    check("autosave: a conflict in place holds the note against agents' edits", shown?.kind === "conflict" && shown.inline === true && !!as.heldByConflict?.(P), { said: shown, held: as.heldByConflict?.(P) })
    ed.shown.left(1, ed.shown.clashes) // (its editor went, handing back what's left)
    check("autosave: a conflict whose editor went is settled from the banner, not shown in place", ed.said.at(-1)?.kind === "conflict" && ed.said.at(-1).inline === false, ed.said.at(-1))
    ed.saver.reshow() // (an editor drawn again: in place again)
    const again = ed.said.at(-1)?.inline === true
    ed.shown.left(1, ed.shown.clashes)
    ed.type("a\nmine\n- [x] t\n")
    await ticks()
    const held = srv.text
    ed.saver.keep("theirs")
    await ticks()
    check("autosave: shown again by the next editor; without one, Keep theirs saves theirs and what was done meanwhile",
      again && held === "a\ntheirs\n- [ ] t\n" && srv.text === "a\ntheirs\n- [x] t\n" && ed.said.at(-1)?.kind === "ok" && !as.heldByConflict(P), { again, held, disk: srv.text })
    ed.close()
  }
  {
    // Another device's version iCloud kept apart (plugins/core/sync-conflicts), brought in: clean, merged and saved on
    // what's on disk; nothing missing, nothing written; clashing, shown in place, the file untouched till settled.
    const BASE = "one\ntwo\nthree\n", MINE = "one, here\ntwo\nthree\n"
    srv.text = MINE
    let ed = open(true)
    fake.posts.length = 0
    let r = await ed.saver.mergeIn(BASE, "one\ntwo\nthree, there\n", "Mini")
    check("autosave: another device's version that merges cleanly is merged and saved, its text kept in File history first",
      r === "merged" && srv.text === "one, here\ntwo\nthree, there\n" && fake.posts.some(([p, b]: Any) => p === "history/keep" && b.text === "one\ntwo\nthree, there\n"), { r, disk: srv.text, posts: fake.posts })
    let puts = srv.puts
    r = await ed.saver.mergeIn(BASE, BASE, "Mini")
    check("autosave: one with nothing missing here writes nothing", r === "same" && srv.puts === puts, { r, puts: srv.puts - puts })
    ed.close()

    srv.text = MINE
    ed = open(true)
    puts = srv.puts
    const settled = ed.saver.mergeIn(BASE, "one, there\ntwo\nthree\n", "Mini")
    await ticks()
    const held = ed.said.at(-1)
    check("autosave: one that clashes is shown in place as the other device's, nothing written meanwhile",
      held?.kind === "conflict" && held.version === true && held.inline === true && /Mini/.test(held.note ?? "") && ed.shown?.clashes.length === 1 && srv.puts === puts && as.conflictText(held) === "Line 1 differs in the version iCloud kept from Mini.",
      { held, shown: ed.shown, text: held && as.conflictText(held) })
    ed.set("one, there\ntwo\nthree\n") // (Keep theirs, in the editor)
    ed.shown.left(0)
    r = await settled
    check("autosave: settled in place, it's saved on what's on disk", r === "settled" && srv.text === "one, there\ntwo\nthree\n" && ed.said.at(-1)?.kind === "ok", { r, disk: srv.text })
    ed.close()

    srv.text = MINE
    ed = open(true)
    puts = srv.puts
    const kept = ed.saver.mergeIn(null, "one\ntwo, there\nthree\n", "Mini")
    await ticks()
    const each = ed.shown?.clashes.length
    ed.shown.left(1, ed.shown.clashes) // (its editor went)
    ed.saver.keep("mine")
    r = await kept
    check("autosave: with no common version each difference clashes; Keep yours from the banner leaves the file as it is",
      each === 1 && r === "settled" && srv.text === MINE && srv.puts === puts && ed.said.at(-1)?.kind === "ok", { each, r, disk: srv.text, puts: srv.puts - puts })
    ed.close()

    srv.text = MINE
    ed = open(false)
    r = await ed.saver.mergeIn(BASE, "one, there\ntwo\nthree\n", "Mini")
    check("autosave: where it can't be shown in place, it says so and holds nothing", r === "unsaved" && srv.text === MINE && !as.heldByConflict(P) && ed.said.at(-1)?.kind !== "conflict", { r, said: ed.said.at(-1) })
    ed.close()
  }
  {
    const step = as.step ?? (() => ({ to: null, do: [] }))
    const gone = step({ kind: "gone" }, { type: "typed" }, () => false), later = step({ kind: "error", tries: 2, retry: true }, { type: "retry" }, () => false)
    const closing = step({ kind: "saving", typed: false, again: false, recheck: false, tries: 0 }, { type: "close" }, () => false)
    const answered = step(closing.to ?? { kind: "idle" }, { type: "saved" }, () => false)
    check("autosave: gone stays gone; an error retried is a save; a close mid-save waits for its answer, then sends the rest",
      gone.to?.kind === "gone" && !gone.do.length && later.to?.kind === "saving" && later.to.tries === 2 && closing.to?.kind === "closing" && !closing.do.length
      && answered.to.kind === "gone" && answered.do.join() === "flush", { gone, later, closing, answered })
    const heard = step({ kind: "saving", typed: false, again: false, recheck: true, tries: 0 }, { type: "failed", retry: false }, () => false)
    check("autosave: a save failing with a change on disk heard meanwhile reads it (the file moved: its edits offered back)",
      heard.to.kind === "checking" && heard.do.join() === "read", heard)
  }

  // Typed together (plugins/core/companion/cotype.ts) on a made-up room: the server's doc, written to the file when the
  // test says (its turn, a pause after typing), and what's written on disk merged into it.
  const Y = await import("yjs"), { fromBase64, toBase64 } = await import("lib0/buffer")
  const { span } = await plugin("companion/text.ts")
  const co: Any = g.__cotype = { state: { connected: true }, subs: new Set(), rooms: null, settleFile: async () => {}, say: (m: Any) => co.state.connected && room.said(m) }
  const { cotype } = await plugin("companion/cotype.ts")
  const to = (m: Any) => setImmediate(() => co.rooms.heard(m))
  const into = (t: Any, text: string, origin: unknown) => {
    const now = t.toString(), [a, b] = span(now, text)
    t.doc.transact(() => { if (now.length - a - b) t.delete(a, now.length - a - b); if (text.length - a - b) t.insert(a, text.slice(a, text.length - b)) }, origin)
  }
  const room: Any = {
    doc: null, disk: "", others: 0, held: null, lost: false,
    /** On another machine's rooms (bridge.ts): that machine writes its own copy (`host`), never this server's. */
    remote: false, host: "",
    get text() { return room.doc.getText("md") },
    reset(text: string) {
      room.doc?.destroy()
      room.doc = new Y.Doc()
      room.text.insert(0, text)
      room.disk = text
      room.doc.on("update", (u: Uint8Array, origin: unknown) => { if (origin !== "client") to({ t: "y", path: P, u: toBase64(u) }) })
    },
    write() { if (room.remote) room.host = room.text.toString(); else { srv.text = room.text.toString(); srv.mtime++; room.disk = srv.text } },
    reread() { if (srv.text !== room.disk) { into(room.text, merge.merge3(room.disk, room.text.toString(), srv.text) ?? room.text.toString(), "disk"); room.disk = srv.text } },
    /** The other one types, and it's written. */
    other(text: string) { into(room.text, text, "other"); room.write() },
    peers(n: number) { room.others = n; to({ t: "y-peers", path: P, others: n }) },
    said(m: Any) {
      if (m.t === "y-open") {
        room.reread()
        const u = m.bare ? undefined : toBase64(Y.encodeStateAsUpdate(room.doc)), held = room.held
        void (async () => { if (!m.bare) await held; to({ t: "y-state", path: P, u, others: room.others, remote: room.remote || undefined }) })()
      } else if (m.t === "y" && !room.lost) Y.applyUpdate(room.doc, fromBase64(m.u), "client")
      return true
    },
  }
  /** An editor as cotype.ts sees one; bound (yCollab, stubbed), what's typed goes into the doc and it shows the doc. */
  const view = (ed: Any) => {
    let yt: Any = null
    const mirror = () => ed.set(yt.toString())
    const v = {
      dom: { isConnected: true },
      get state() { return { doc: { toString: () => ed.text, get length() { return ed.text.length } } } },
      dispatch(spec: Any) {
        if (spec.changes) {
          const { from, to, insert } = spec.changes, text = ed.text.slice(0, from) + insert + ed.text.slice(to)
          if (yt && !spec.annotations) into(yt, text, null); else ed.set(text)
        }
        const ext = spec.effects?.value?.extension
        if (Array.isArray(ext)) { yt?.unobserve(mirror); yt = ext.find((x: Any) => x?.ytext)?.ytext ?? null; yt?.observe(mirror) }
      },
      type(text: string) { if (yt) into(yt, text, null); else ed.type(text) },
    }
    return v
  }
  /** A note open in an editor that co-types: alone till someone comes. */
  const together = async (text: string) => {
    srv.text = text
    room.reset(text)
    Object.assign(room, { others: 0, remote: false })
    fake.wrote = () => room.reread()
    const ed = open(), v = view(ed), plug = cotype(P)[1].create(v)
    co.settleFile = async () => { await ed.saver.calm(); return ed.saver.disk }
    await ticks()
    return { ed, v, close: () => { plug.destroy(); ed.close() } }
  }

  {
    // Someone comes during a conflict: typed in together only once it's settled, on the text kept. (First: a room
    // closed hands its note back only a while later.)
    const { ed, close } = await together("a\nb\n")
    ed.type("a\nmine\n")
    srv.text = "a\ntheirs\n"
    await ed.saver.save()
    await ticks()
    room.peers(1)
    await ticks()
    const during = ed.text
    ed.saver.keep("mine")
    await ticks()
    room.write()
    check("cotype: someone joining during a conflict waits for it: the text isn't taken over, then what was kept is typed in together",
      during === "a\nmine\n" && ed.text === "a\nmine\n" && srv.text === "a\nmine\n", { during, editor: ed.text, disk: srv.text })
    room.peers(0)
    await ticks()
    close()
  }
  {
    const { ed, v, close } = await together("a\n")
    room.peers(1)
    await ticks()
    v.type("a\nmine\n")
    await ticks()
    room.write()
    room.other("a\nmine\ntheirs\n")
    await ticks()
    v.type("a\nmine\ntheirs\nlast\n") // (still to be written as the other one leaves)
    await ticks()
    room.peers(0)
    await ticks()
    room.write()
    v.type("a\nmine\ntheirs\nlast\nalone\n")
    await ed.saver.save()
    await ticks()
    check("cotype: typed together, then alone, typing on saves on what the server has: no conflict, both sides' text kept",
      srv.text === "a\nmine\ntheirs\nlast\nalone\n" && !ed.said.some((x: Any) => x.kind === "conflict"), { text: srv.text, said: ed.said.map((x: Any) => x.kind) })
    close()
  }
  {
    const { ed, v, close } = await together("a\n")
    v.type("a\nb\n")
    let saved = () => {}, answer = () => {}
    srv.gate = new Promise((r) => { saved = r })
    void ed.saver.save()
    await ticks()
    room.held = new Promise<void>((r) => { answer = r })
    room.peers(1) // (someone came as it saved)
    await ticks()
    srv.gate = null
    saved()
    await ticks()
    v.type("a\nb\nc\n") // (typed as the doc is on its way)
    await ed.saver.save()
    await ticks()
    answer()
    room.held = null
    await ticks()
    room.write()
    check("cotype: joined mid-save, what's typed as the doc comes is in it once", srv.text === "a\nb\nc\n" && ed.text === "a\nb\nc\n", { disk: srv.text, editor: ed.text })
    room.peers(0)
    await ticks()
    close()
  }
  {
    const { ed, v, close } = await together("a\n")
    room.peers(1)
    await ticks()
    v.type("a\nmine\n")
    await ticks()
    room.write()
    room.other("a\nmine\ntheirs\n")
    await ticks()
    room.lost = true // (a phone's stuck tunnel: what's sent from here never gets there)
    v.type("a\nmine\ntheirs\nlost\n")
    await ticks()
    co.state.connected = false
    for (const fn of co.subs) fn()
    await ed.saver.settle()
    await ticks()
    check("cotype: the socket gone, what the server never got is saved, the rest kept, no conflict",
      srv.text === "a\nmine\ntheirs\nlost\n" && !ed.said.some((x: Any) => x.kind === "conflict"), { text: srv.text, said: ed.said.map((x: Any) => x.kind) })
    close()
    room.lost = false
    co.state.connected = true
  }
  {
    // On another machine's rooms: it goes (typed on here alone, saved on this machine), and comes back.
    const { ed, v, close } = await together("a\n")
    fake.wrote = undefined
    room.remote = true
    room.peers(1)
    await ticks()
    v.type("a\nmine\n")
    await ticks()
    room.other("a\nmine\ntheirs\n")
    await ticks()
    room.remote = false // (this server's own room, asked again: no one else in it)
    room.others = 0
    to({ t: "y-gone", path: P })
    await ticks()
    v.type("a\nmine\ntheirs\naway\n")
    await ed.saver.save()
    await ticks()
    const here = srv.text
    room.remote = true
    room.others = 1
    to({ t: "y-state", path: P, u: toBase64(Y.encodeStateAsUpdate(room.doc)), others: 1, remote: true }) // (back)
    await ticks()
    room.write()
    check("cotype: another machine's rooms gone and back, what was typed here meanwhile is saved here, then reaches it once",
      here === "a\nmine\ntheirs\naway\n" && room.host === "a\nmine\ntheirs\naway\n" && !ed.said.some((x: Any) => x.kind === "conflict"),
      { here, there: room.host, said: ed.said.map((x: Any) => x.kind) })
    room.remote = false
    room.peers(0)
    await ticks()
    close()
  }
  delete fake.wrote
  delete g.addEventListener; delete g.removeEventListener; delete g.document; delete g.__autosave; delete g.__cotype
})

await exit(summary("web", t0))
