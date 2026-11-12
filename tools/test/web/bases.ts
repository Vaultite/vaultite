import path from "node:path"
import { pathToFileURL } from "node:url"
import { check } from "../lib.ts"
import { type Any, ROOT, web } from "./lib.ts"

// ---------- Obsidian Bases: the expression language, a .base's views, edits that keep the file ----------
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
