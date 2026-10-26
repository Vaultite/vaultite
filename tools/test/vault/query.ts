import fs from "node:fs"
import path from "node:path"
import type { Any, VaultTest } from "./harness.ts"

export default async ($: VaultTest) => {
  const { VAULT, api, check, read, write } = $
  let code: number
  // The query engine (plugins/core/query/query.ts): /api/query, query.run and bases run on it.
  {
    const { parseWhere, run, QueryError, markdown } = await import("../../../plugins/core/query/query.ts")
    const recs = [
      { path: "Q/Alice Park.md", fm: { type: "qtest", relation: "friend", every_days: 30, tags: ["University", "AI"], with: "[[Bob Lee]]", met: "2026-09-01" }, mtime: 3 },
      { path: "Q/Bob Lee.md", fm: { type: "qtest", relation: "Family", every_days: 7, tags: ["Work"], met: "2025-01-10" }, mtime: 2 },
      { path: "Q/Lighthouse.md", fm: { type: "project", status: "live", every_days: "10" }, mtime: 1 },
      { path: "Other/Lee Park.md", fm: { type: "qtest", relation: "friend", note: "likes Lighthouse" }, mtime: 4 },
    ]
    const names = (o: Any) => run(o, recs).groups.flatMap((g: Any) => g.rows.map((r: Any) => r.title))
    check("query: and binds tighter than or", JSON.stringify(parseWhere("a = 1 or b = 2 and c = 3")) ===
      JSON.stringify({ k: "or", a: { k: "cmp", key: "a", op: "=", value: 1 }, b: { k: "and", a: { k: "cmp", key: "b", op: "=", value: 2 }, b: { k: "cmp", key: "c", op: "=", value: 3 } } }))
    check("query: parentheses and not", JSON.stringify(names({ where: "not (relation = friend or has status)" })) === '["Bob Lee"]', names({ where: "not (relation = friend or has status)" }))
    check("query: text without case, numbers as numbers", JSON.stringify(names({ where: "relation = family or every_days < 9" })) === '["Bob Lee"]'
      && JSON.stringify(names({ where: "every_days >= 10", sort: "every_days" })) === '["Lighthouse","Alice Park"]', names({ where: "every_days >= 10", sort: "every_days" }))
    check("query: quoted text, contains on text and lists, links", JSON.stringify(names({ where: "note contains 'LIGHT' or tags contains ai" })) === '["Alice Park","Lee Park"]'
      && JSON.stringify(names({ where: "with = 'Bob Lee'" })) === '["Alice Park"]', names({ where: "note contains 'LIGHT' or tags contains ai" }))
    check("query: dates compare in order", JSON.stringify(names({ where: "met > 2026-01-01" })) === '["Alice Park"]')
    check("query: from, type, tags and a where map", JSON.stringify(names({ from: "Q/", type: "qtest", tags: ["university"] })) === '["Alice Park"]'
      && JSON.stringify(names({ where: { relation: ["friend", "family"] }, sort: "-file" })) === '["Lee Park","Bob Lee","Alice Park"]')
    const g = run({ type: "qtest", group: "relation", sort: "-every_days", limit: 2, columns: ["file", "folder", "every_days"] }, recs)
    check("query: sort (blanks last), limit, then groups in order", g.total === 3 && g.shown === 2 &&
      JSON.stringify(g.groups.map((x: Any) => [x.name, x.rows.map((r: Any) => r.title)])) === '[["Family",["Bob Lee"]],["friend",["Alice Park"]]]'
      && g.groups[1].rows[0].values.folder === "Q", g.groups)
    // A where runs on Bases' engine (expr.ts) with its own lenient comparisons.
    check("query where: case, a link is its name, a list matches when any value does", JSON.stringify(names({ where: "relation = FRIEND and with = 'bob LEE'" })) === '["Alice Park"]'
      && JSON.stringify(names({ where: "with = '[[Bob Lee|Bob]]'" })) === '["Alice Park"]' && JSON.stringify(names({ where: "tags = ai or tags = work" })) === '["Alice Park","Bob Lee"]'
      && JSON.stringify(names({ where: "type = qtest and tags != work" })) === '["Alice Park","Lee Park"]', names({ where: "type = qtest and tags != work" }))
    check("query where: has, not and parentheses", JSON.stringify(names({ where: "has note or not (has tags)" })) === '["Lee Park","Lighthouse"]'
      && JSON.stringify(names({ where: "not has tags and (status = live or relation = friend)" })) === '["Lee Park","Lighthouse"]', names({ where: "has note or not (has tags)" }))
    const { typedValue } = await import("../../../core/proptypes.ts")
    const types = { of: (k: string) => (k === "met" ? "date" : k === "every_days" ? "number" : null), value: typedValue }
    const typedNames = (o: Any) => run(o, recs, new Date(), { types }).groups.flatMap((g: Any) => g.rows.map((r: Any) => r.title))
    check("query where: typed keys compare dates by time and numbers as numbers", JSON.stringify(names({ where: "met > 'Mar 1, 2025'" })) === "[]"
      && JSON.stringify(typedNames({ where: "met > 'Mar 1, 2025'" })) === '["Alice Park"]' && JSON.stringify(typedNames({ where: "every_days >= 10" })) === '["Alice Park","Lighthouse"]',
    typedNames({ where: "met > 'Mar 1, 2025'" }))
    const self = { path: "P/Here.md", fm: { tags: ["Work", "AI"], relation: "family" }, mtime: 0 }
    const selfNames = (o: Any) => run(o, recs, new Date(), { self }).groups.flatMap((g: Any) => g.rows.map((r: Any) => r.title))
    check("query where: this.<key> is any of its values (none of them, for !=), in a map too", JSON.stringify(selfNames({ where: "tags = this.tags" })) === '["Alice Park","Bob Lee"]'
      && JSON.stringify(selfNames({ where: "tags != this.tags" })) === '["Lee Park","Lighthouse"]' && JSON.stringify(selfNames({ where: { relation: "this.relation" } })) === '["Bob Lee"]',
    selfNames({ where: "tags != this.tags" }))
    let bad = 0
    for (const w of["relation =", "(a = 1", "a = 1 b", "= 3", "a ~ 2", "'open", "a = 1 or", ")", "((((".repeat(20) + "a = 1"]) {
      try { parseWhere(w) } catch (e) { if (e instanceof QueryError) bad++ }
    }
    check("query: garbage is an error, never a crash", bad === 9, bad)
    const many = Array.from({ length: 700 }, (_, i) => ({ path: `M/${String(i).padStart(3, "0")}.md`, fm: { n: i }, mtime: 0 }))
    const all = run({ columns: ["file", "n"] }, many), page = run({ columns: ["file", "n"], limit: 50, offset: 600 }, many)
    check("query: every match without a limit (no cap), a page with limit and offset", all.shown === 700 && all.total === 700 &&
      page.shown === 50 && page.offset === 600 && page.groups[0].rows[0].title === "600" && markdown(page).includes("_601-650 of 700 shown; more: offset 650._"),
    [all.shown, page.shown, page.offset])
    write("Query test/Alice Park.md", "---\ntype: qtest\nrelation: friend\nevery_days: 30\n---\n\nHi.\n")
    write("Query test/Bob Lee.md", "---\ntype: qtest\nrelation: family\nevery_days: 7 # weekly\n---\n")
    write("Query test/View.md", "---\ntags: [Trip]\n---\n\n```base\nfilters:\n  and:\n    - file.inFolder(\"Query test\")\n    - type == \"qtest\"\nviews:\n  - type: table\n    name: Test people\n    order: [file.name, relation, every_days]\n    sort: [{property: every_days, direction: DESC}]\n```\n")
    let qr: Any
    ;[code, qr] = await api("GET", 'query?q={"from":"Query test/","type":"qtest","sort":"every_days"}')
    check("GET /api/query answers rows with paths and values", code === 200 && qr.groups[0].rows.map((r: Any) => r.path).join() === "Query test/Bob Lee.md,Query test/Alice Park.md"
      && qr.groups[0].rows[0].values.relation === "family", qr)
    ;[, qr] = await api("GET", 'query?q={"from":"Query test/"}&self=Query test/View.md')
    const listed = qr.groups.flatMap((g: Any) => g.rows).map((r: Any) => r.path)
    check("query: the file the view is in isn't listed (self)", listed.length === 2 && !listed.includes("Query test/View.md"), listed)
    write("Templates/Qtest person.md", "---\ntype: qtest\nrelation: friend\n---\n")
    ;[, qr] = await api("POST", "query", { type: "qtest" })
    check("query: templates are left out", !qr.groups.flatMap((g: Any) => g.rows).some((r: Any) => r.path.startsWith("Templates/")), qr)
    ;[, qr] = await api("POST", "query", { from: "Templates/", type: "qtest" })
    check("query: unless from names their folder", qr.groups.flatMap((g: Any) => g.rows).some((r: Any) => r.path.startsWith("Templates/")), qr)
    // Sample folders (files.json `samples`): out of queries and bases made elsewhere, in for one made there; no kind.
    write(".vaultite/files.json", JSON.stringify({ samples: ["Examples/"] }))
    write("Examples/Sample pal.md", "---\ntype: qtest\nrelation: friend\n---\n")
    const paths = (r: Any) => r.groups.flatMap((g: Any) => g.rows).map((x: Any) => x.path)
    ;[, qr] = await api("POST", "query", { type: "qtest" })
    const [, inBase] = await api("POST", "query", { base: "filters: 'type == \"qtest\"'\n" })
    write("Examples/Demo.base", "filters: 'type == \"qtest\"'\n")
    const [fhCode, fromHere] = await api("GET", "query?base=Examples/Demo.base")
    check("query: sample folders are out of queries and bases elsewhere, in for one in that folder",
      fhCode === 200 && !paths(qr).includes("Examples/Sample pal.md") && !paths(inBase).includes("Examples/Sample pal.md") && paths(fromHere).includes("Examples/Sample pal.md"), [fhCode, fromHere])
    write("Examples/Sample person.md", "---\ntype: person\nname: Sample person\n---\n")
    const [, ppl] = await api("GET", "state")
    check("query: a sample folder's files are no kind's (not a person)", !(ppl.people ?? []).some((p: Any) => p.name === "Sample person"), ppl.people?.length)
    fs.rmSync(path.join(VAULT, ".vaultite/files.json"))
    await $.removeFolder("Examples")
    write("Query test/Old Pal.md", "---\ntype: qtest\nrelation: friend\narchived: true\n---\n")
    ;[, qr] = await api("POST", "query", { type: "qtest" })
    check("query: archived files are hidden, and how many is said", !qr.groups.flatMap((g: Any) => g.rows).some((r: Any) => r.path === "Query test/Old Pal.md")
      && qr.archivedHidden === 1, qr)
    ;[, qr] = await api("POST", "query", { type: "qtest", archived: true })
    check("...archived: true shows them", qr.groups.flatMap((g: Any) => g.rows).some((r: Any) => r.path === "Query test/Old Pal.md") && !qr.archivedHidden, qr)
    ;[, qr] = await api("POST", "query", { base: "filters: 'type == \"qtest\"'\n" })
    const based = qr.groups.flatMap((g: Any) => g.rows).map((r: Any) => r.path)
    check("a base lists archived files and templates, as in Obsidian", based.includes("Query test/Old Pal.md") && based.includes("Templates/Qtest person.md"), based)
    write("Query test/.archive/Gone Pal.md", "---\ntype: qtest\nrelation: friend\narchived: true\n---\n")
    ;[, qr] = await api("POST", "query", { base: "filters: 'type == \"qtest\"'\n" })
    const inArch = qr.groups.flatMap((g: Any) => g.rows).map((r: Any) => r.path)
    check("...but none in an archive folder: Obsidian never sees hidden folders", !inArch.some((p: string) => p.includes(".archive/")) && inArch.includes("Query test/Old Pal.md"), inArch)
    ;[, qr] = await api("POST", "query", { type: "qtest", archived: true })
    check("...while vau query's archived: true lists them", qr.groups.flatMap((g: Any) => g.rows).some((r: Any) => r.path === "Query test/.archive/Gone Pal.md"), qr)
    ;[, qr] = await api("POST", "query", { base: "filters: 'type == \"qtest\"'\nviews:\n  - type: table\n    archived: true\n" })
    const withArch = qr.groups.flatMap((g: Any) => g.rows).map((r: Any) => r.path)
    ;[, qr] = await api("POST", "query", { base: "filters: 'type == \"qtest\"'\nviews:\n  - type: table\n    archived: only\n" })
    const onlyArch = qr.groups.flatMap((g: Any) => g.rows).map((r: Any) => r.path).sort()
    check("a base view's archived: true lets archive folders in, only: only archived files", withArch.includes("Query test/.archive/Gone Pal.md") && withArch.includes("Query test/Alice Park.md")
      && JSON.stringify(onlyArch) === '["Query test/.archive/Gone Pal.md","Query test/Old Pal.md"]', [withArch, onlyArch])
    fs.rmSync(path.join(VAULT, "Query test/.archive"), { recursive: true })
    fs.rmSync(path.join(VAULT, "Query test/Old Pal.md"))
    ;[code, qr] = await api("POST", "query", { from: "Query test/", where: "relation" })
    check("a bad query is a 400 saying why", code === 400 && /expected/.test(qr.error), qr)
    const [, md] = await api("GET", "render?path=Query test/View.md")
    check("a ```base fence reads as a Markdown table", md.includes("### Test people") && md.includes("| Name | Relation | Every days |")
      && md.indexOf("[[Alice Park]]") < md.indexOf("[[Bob Lee]]") && md.includes("| [[Bob Lee]] | family | 7 |"), md)

    // Boards: a column per value of the group key, the listed ones first (even empty), "No value" last.
    const board = run({ type: "qtest", view: "board", group: "relation", groups: ["mentor", "friend"], columns: ["file", "every_days"] }, recs)
    check("board: listed columns first (empty ones too), the rest after, no value last",
      JSON.stringify(board.groups.map((x: Any) => [x.name, x.value, x.rows.map((r: Any) => r.title)])) ===
        '[["mentor","mentor",[]],["friend","friend",["Alice Park","Lee Park"]],["Family","Family",["Bob Lee"]],[null,null,[]]]'
      && board.group === "relation", board.groups)
    const linked = run({ from: "Q/", view: "board", group: "with" }, recs)
    check("board: a column's value is what its files have (a link stays a link)", linked.groups[0].name === "Bob Lee" && linked.groups[0].value === "[[Bob Lee]]"
      && linked.groups[1].name === null && linked.groups[1].rows.length === 2, linked.groups)
    let why = ""
    try { run({ view: "board" }, recs) } catch (e) { why = (e as Error).message }
    check("board: needs a group", /needs a group/.test(why), why)
    // Calendars: a month, by a date key (default `date`, else `created`), a group per day.
    const cal = run({ view: "calendar", date: "met", month: "2026-09" }, recs)
    check("calendar: the month's files, a group per day", cal.date === "met" && cal.month === "2026-09" && cal.total === 1
      && cal.groups.length === 1 && cal.groups[0].name === "2026-09-01" && cal.groups[0].rows[0].title === "Alice Park", cal)
    const days = run({ view: "calendar" }, [
      { path: "L/Climb.md", fm: { date: "2026-09-27" }, mtime: 1 }, { path: "L/Gym.md", fm: { date: "2026-09-03 07:30" }, mtime: 1 },
      { path: "L/Old.md", fm: { date: "2026-08-30" }, mtime: 1 }, { path: "L/Undated.md", fm: {}, mtime: 1 },
    ], new Date(2026, 8, 15))
    check("calendar: default key date, this month, in order, times kept", days.date === "date" && days.month === "2026-09"
      && JSON.stringify(days.groups.map((x: Any) => [x.name, x.rows.map((r: Any) => r.title)])) === '[["2026-09-03",["Gym"]],["2026-09-27",["Climb"]]]', days.groups)
    why = ""
    try { run({ view: "calendar", month: "2026-13" }, recs) } catch (e) { why = (e as Error).message }
    check("calendar: a bad month says so", /month is YYYY-MM/.test(why), why)

    // As text, and a card moved: the app writes that one key (PUT /api/file with its base) and the board follows.
    write("Query test/Board.md", "---\ntags: [Trip]\n---\n\n```base\nfilters:\n  and:\n    - file.inFolder(\"Query test\")\n    - type == \"qtest\"\nviews:\n  - type: kanban\n    name: Test board\n    groupBy: {property: relation, direction: ASC}\n    groups: [friend, family, mentor]\n    order: [file.name, every_days]\n```\n\n```base\nfilters:\n  and:\n    - file.inFolder(\"Query test\")\n    - type == \"qtest\"\nviews:\n  - type: calendar\n    name: Test calendar\n    date: met\n    month: 2026-09\n```\n")
    write("Query test/Alice Park.md", "---\ntype: qtest\nrelation: friend\nevery_days: 30\nmet: 2026-09-12\n---\n\nHi.\n")
    let [, bmd] = await api("GET", "render?path=Query test/Board.md")
    check("a kanban reads as a section per column (its groups first, even empty), a bullet per file", bmd.includes("### Test board") && bmd.includes("#### friend (1)\n\n- [[Alice Park]] · 30")
      && bmd.includes("#### family (1)\n\n- [[Bob Lee]] · 7") && bmd.includes("#### mentor (0)\n\n_Empty._") && bmd.includes("#### No value (0)")
      && bmd.indexOf("#### friend") < bmd.indexOf("#### family") && bmd.indexOf("#### family") < bmd.indexOf("#### mentor"), bmd)
    check("a calendar reads as its month (the view's), a bullet per file by date", bmd.includes("### Test calendar\n\n#### September 2026\n\n- 2026-09-12 · [[Alice Park]]"), bmd)
    const before = read("Query test/Bob Lee.md")
    ;[code] = await api("PUT", "file", { path: "Query test/Bob Lee.md", text: before.replace("relation: family", "relation: mentor"), base: before })
    ;[, qr] = await api("POST", "query", { from: "Query test/", type: "qtest", view: "board", group: "relation", groups: ["friend", "family", "mentor"] })
    check("a moved card: one line changes (its comment stays), the board has it in its new column", code === 200
      && read("Query test/Bob Lee.md") === "---\ntype: qtest\nrelation: mentor\nevery_days: 7 # weekly\n---\n"
      && JSON.stringify(qr.groups.map((x: Any) => [x.name, x.rows.length])) === '[["friend",1],["family",0],["mentor",1],[null,0]]', qr.groups)
    ;[, bmd] = await api("GET", "render?path=Query test/Board.md")
    check("and reads so", bmd.includes("#### family (0)") && bmd.includes("#### mentor (1)\n\n- [[Bob Lee]] · 7"), bmd)
  }

  // Obsidian Bases: a .base read as text (every view), one view as JSON, embedded with #View (this: the note), a ```base
  // fence in a note with a formula and summaries.
  {
    write("Bases test/Books/Dune.md", "---\nstatus: done\npages: 400\nread: 400\nauthor: '[[Frank Herbert]]'\n---\n")
    write("Bases test/Books/Emma.md", "---\nstatus: reading\npages: 300\nread: 100\n---\n")
    write("Bases test/Frank Herbert.md", "---\nborn: 1920\n---\n")
    write("Bases test/cover.png", "not really a png")
    write("Bases test/Books.base", "filters:\n  and:\n    - file.inFolder(\"Bases test/Books\")\nformulas:\n  left: pages - read\nproperties:\n  formula.left:\n    displayName: Left\n"
      + "views:\n  - type: table\n    name: Reading\n    order: [file.name, status, formula.left]\n    summaries:\n      formula.left: Sum\n"
      + "  - type: list\n    name: Linked here\n    filters: file.hasLink(this)\n  - type: map\n    name: Map\n")
    write("Bases test/All.base", "filters: file.inFolder(\"Bases test\")\nviews:\n  - type: table\n    name: Every file\n    order: [file.name, file.ext]\n")
    write("Bases test/Note.md", "---\ntype: note\n---\n\nSee [[Dune]].\n\n![[Books.base#Linked here]]\n\n```base\nfilters: 'status == \"reading\"'\nviews:\n  - type: table\n    name: Inline\n    order: [file.name, pages]\n```\n\nAfter.\n")
    let [code, md] = await api("GET", "render?path=Bases test/Books.base")
    check("a .base reads as its views, a table each (a formula, its label, the summary row)", code === 200 && md.startsWith("# Books\n\n## Reading\n\n| Name | Status | Left |")
      && md.includes("| [[Emma]] | reading | 200 |") && md.includes("|  |  | **Sum** 200 |") && md.includes("## Linked here") && md.includes("## Map"), md)
    let qr: Any
    ;[code, qr] = await api("GET", "query?base=Bases test/Books.base&view=Reading")
    check("GET /api/query?base=: one view as JSON, with the base's views", code === 200 && qr.title === "Reading" && qr.current === 0
      && JSON.stringify(qr.views) === '[{"name":"Reading","type":"table"},{"name":"Linked here","type":"list"},{"name":"Map","type":"map"}]'
      && qr.groups[0].rows.find((r: Any) => r.title === "Dune").values["formula.left"] === 0 && qr.summaries[0].value === 200, qr)
    ;[, qr] = await api("GET", "query?base=Bases test/All.base")
    check("a base lists every file, attachments too", JSON.stringify(qr.groups[0].rows.map((r: Any) => [r.title, r.values["file.ext"]]).sort())
      === '[["Books.base","base"],["Dune","md"],["Emma","md"],["Frank Herbert","md"],["Note","md"],["cover.png","png"]]', qr.groups[0].rows.map((r: Any) => r.title))
    ;[code] = await api("GET", "query?base=Bases test/Nope.base")
    check("a base that isn't there is a 404", code === 404, code)
    ;[, md] = await api("GET", "render?path=Bases test/Note.md")
    check("![[Books.base#View]] in a note: that view, `this` the note (file.hasLink(this))", md.includes("**Bases test/Books.base#Linked here**\n\n### Linked here")
      && !md.includes("### Reading") && md.includes("### Linked here\n\n_Nothing matches._"), md)
    check("a ```base fence reads as its view", md.includes("### Inline\n\n| Name | Pages |\n| --- | --- |\n| [[Emma]] | 300 |\n\nAfter.") && !md.includes("```base"), md)
    write("Bases test/Books/Dune.md", "---\nstatus: done\npages: 400\nread: 400\n---\n\nMentioned in [[Note]].\n")
    ;[, md] = await api("GET", "render?path=Bases test/Note.md")
    check("this: a file linking to the note is listed", md.includes("### Linked here\n\n| Name |") && md.includes("[[Dune]]"), md)
    ;[code, qr] = await api("POST", "query", { type: "nope", formulas: { x: "1 +" }, columns: ["file", "formula.x"], summaries: { file: "Count" }, filters: "bad(" })
    check("a broken formula or filter is a note, not an error", code === 200 && JSON.stringify(qr.notes) === '["Filter bad( is left out: there\'s no function bad()"]', qr)
    write("Bases test/Query.md", "```base\nfilters: file.inFolder(\"Bases test/Books\")\nformulas:\n  left: pages - read\nviews:\n  - type: table\n    name: Pages\n    order: [file.name, pages, formula.left]\n    summaries: {pages: Sum, formula.left: Average}\n```\n")
    ;[, md] = await api("GET", "render?path=Bases test/Query.md")
    check("a ```base fence: a formula column and summaries", md.includes("| [[Emma]] | 300 | 200 |") && md.includes("|  | **Sum** 700 | **Average** 100 |"), md)
  }
  // (what it wrote goes: in a vault with no other notes, its note would be where a later area's new ones go)
  fs.rmSync(path.join(VAULT, "Templates/Qtest person.md"))
  for (const d of ["Query test", "Bases test"]) await $.removeFolder(d)
}
