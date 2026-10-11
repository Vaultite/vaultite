import fs from "node:fs"
import path from "node:path"
import type { Any, VaultTest } from "./harness.ts"

export default async ($: VaultTest) => {
  const { VAULT, api, check, exists, read, write } = $
  const { same } = $.vars
  // Property types (core/proptypes.ts): .vaultite/types.json, Obsidian's under it; the editor's notes, render, the ops,
  // and database views sorting by them.
  {
    const pt = await import("../../../core/proptypes.ts")
    const read1 = pt.readTypes({ types: { Due: "Date", tags: "tags", css: "multitext", bad: "colour", n: 3 } })
    check("types: read leniently (any case, Obsidian's multitext a list, unknown ones left out)", same(read1, { Due: "date", tags: "tags", css: "list" }), read1)
    check("types: a key's in any case, tags and aliases implied, else none", pt.typeOf(read1, "due") === "date" && pt.typeOf({}, "aliases") === "aliases" && pt.typeOf({ tags: "list" }, "tags") === "list" && pt.typeOf(read1, "x") === null)
    check("types: a value that isn't of its type says so, empty ones are fine", pt.typeProblem("date", "next week") === "is a date (YYYY-MM-DD), not 'next week'"
      && pt.typeProblem("number", "4") === "is a number, not '4' (written without quotes)" && pt.typeProblem("date", "2026-09-01") === null && pt.typeProblem("number", null) === null
      && pt.typeProblem("list", "a") !== null && pt.typeProblem("tags", "a b") === null && pt.typeProblem("checkbox", "yes") !== null && pt.typeProblem("datetime", "2026-09-01 18:00") === null)
    check("types: values as their type compares them", pt.typedValue("number", "10") === 10 && pt.typedValue("date", "Oct 3, 2026") === new Date(2026, 9, 3).getTime()
      && pt.typedValue("checkbox", "yes") === true && pt.typedValue("number", "n/a") === null && pt.typedValue("list", "x") === undefined)

    fs.rmSync(path.join(VAULT, ".vaultite/types.json"), { force: true })
    write("Types test/A.md", "---\ndue: Oct 3, 2026\nrating: 4\nversion: '1.10'\n---\n")
    write("Types test/B.md", "---\ndue: 2026-09-30\nrating: '12'\nversion: '1.9'\n---\n")
    write("Types test/C.md", "---\ndue: next week\nrating: 7\nversion: '1.2'\n---\n")
    const sortBy = async (key: string) => (await api("POST", "query", { from: "Types test/", sort: key }))[1].groups[0].rows.map((r: Any) => r.title).join()
    check("types: without one, values sort by how they look", await sortBy("due") === "B,C,A" && await sortBy("version") === "A,C,B", [await sortBy("due"), await sortBy("version")])
    let [code, r] = await api("POST", "ops/property.type", { key: "due", type: "date" })
    check("property.type: writes that one key into .vaultite/types.json", code === 200 && read(".vaultite/types.json").includes('"due": "date"') && r.type === "date", [code, r])
    await api("POST", "ops/property.type", { key: "version", type: "text" })
    await api("POST", "ops/property.type", { key: "tags", type: "tags" })
    check("property.type: a type every vault has anyway isn't written", same(JSON.parse(read(".vaultite/types.json")), { types: { due: "date", version: "text" } }), read(".vaultite/types.json"))
    check("types: dates sort by time (one that isn't a date last), text as text (1.10 after 1.9)", await sortBy("due") === "B,A,C" && await sortBy("version") === "C,B,A", [await sortBy("due"), await sortBy("version")])
    ;[, r] = await api("POST", "query", { from: "Types test/", where: "due < 2026-10-15", columns: ["file", "due"] })
    check("types: a where compares dates by time, and the answer says its keys' types", r.groups[0].rows.map((x: Any) => x.title).join() === "A,B" && same(r.types, { due: "date" }), r)
    let [, md] = await api("GET", "render?path=Types test/C.md")
    check("types: render notes a value that isn't of its type", md.includes("_(properties: `due` is a date (YYYY-MM-DD), not 'next week')_"), md)
    ;[, md] = await api("POST", "ops/property.types?as=text", { check: true })
    check("property.types: the types, and with check the values that aren't", md.includes("due      date") && md.includes("- Types test/A.md: `due` is a date (YYYY-MM-DD), not 'Oct 3, 2026'")
      && md.includes("- Types test/C.md:"), md)
    let [, st] = await api("GET", "state")
    check("state: the property types, and which the vault's file has", same(st.propertyTypes, { types: { due: "date", version: "text" }, own: ["due", "version"] }), st.propertyTypes)

    write(".obsidian/types.json", JSON.stringify({ types: { score: "number", due: "datetime", cssclasses: "multitext" } }))
    const obsBefore = read(".obsidian/types.json")
    ;[, st] = await api("GET", "state")
    check("types: Obsidian's types.json under the vault's own", same(st.propertyTypes.types, { score: "number", due: "date", cssclasses: "list", version: "text" }), st.propertyTypes)
    await api("POST", "ops/property.type", { key: "score", type: "number" })
    check("property.type: Obsidian's type again writes nothing", !read(".vaultite/types.json").includes("score") && read(".obsidian/types.json") === obsBefore, read(".vaultite/types.json"))
    await api("POST", "ops/property.type", { key: "due", type: "none" })
    ;[, r] = await api("POST", "ops/property.types", {})
    check("property.type none: back to Obsidian's, .obsidian/ never written", r.types.find((t: Any) => t.key === "due")?.type === "datetime" && r.types.find((t: Any) => t.key === "due")?.from === "other"
      && read(".obsidian/types.json") === obsBefore, r.types)
    ;[code] = await api("POST", "ops/property.type", { key: "due", type: "colour" })
    check("property.type: an unknown type is a 400", code === 400, code)
    await api("POST", "ops/property.type", { key: "version", type: "none" })
    check("property.type: the last one gone, so is the file", !exists(".vaultite/types.json"))
    fs.rmSync(path.join(VAULT, ".obsidian/types.json"), { force: true })
    fs.rmSync(path.join(VAULT, ".vaultite/types.json"), { force: true })
    fs.rmSync(path.join(VAULT, "Types test"), { recursive: true, force: true })
  }

  // `this` in database views: the note a view is drawn in, or the one embedding it (the nearest), alike in the block's
  // text, /api/query and the where's words.
  {
    const { run } = await import("../../../plugins/core/query/query.ts")
    const here = { path: "P/Lighthouse.md", fm: { status: "live" }, mtime: 1, links: () => [] }
    const recs = [
      { path: "N/A.md", fm: { project: "[[Lighthouse]]", status: "live" }, mtime: 1, links: () => ["Lighthouse"] },
      { path: "N/B.md", fm: { project: "[[P/Lighthouse|LH]]", status: "idea" }, mtime: 1, links: () => [] },
      { path: "N/C.md", fm: { status: "live" }, mtime: 1, links: () => ["P/Lighthouse#Goals"] },
    ]
    const names = (o: Any, self: Any = here) => run(o, recs, new Date(), { self }).groups.flatMap((g: Any) => g.rows.map((x: Any) => x.title)).join()
    check("this: a property naming the note (by name, path or with other text)", names({ where: "project = this" }) === "A,B" && names({ where: "project != this" }) === "C"
      && names({ where: { project: "this" } }) === "A,B", names({ where: "project = this" }))
    check("this: file.links contains this (what links to it), this.<key> its value", names({ where: "file.links contains this" }) === "A,C" && names({ where: "status = this.status" }) === "A,C"
      && names({ where: "status = 'this'" }) === "", names({ where: "file.links contains this" }))
    const none = run({ where: "project = this" }, recs)
    check("this: none there, it matches nothing and says so", none.total === 0 && /`this` is the note the view is in/.test(none.notes?.[0] ?? ""), none)

    write("This test/Beacon.md", "---\nstatus: live\n---\n\n![[Related]]\n")
    write("This test/Related.md", "```block-query\ntitle: Linked here\nfrom: This test/\nwhere: \"file.links contains this\"\n```\n\n```base\nfilters: file.hasLink(this)\nviews:\n  - type: list\n    name: Base here\n```\n")
    write("This test/Note.md", "See [[Beacon]].\n")
    write("This test/Other.md", "---\nstatus: live\n---\n\nAbout [[Related]].\n")
    let [, md] = await api("GET", "render?path=This test/Beacon.md")
    const quoted = md.slice(md.indexOf("> [[Related]]"))
    check("this: embedded, a block's text is about the note embedding it", quoted.includes("## Linked here") && /> \| \[\[Note\]\] \|/.test(quoted) && !quoted.includes("[[Other]]"), md)
    check("this: embedded, a ```base fence's too", /### Base here\n>\n> \| Name \|\n> \| --- \|\n> \| \[\[Note\]\] \|/.test(quoted), quoted)
    ;[, md] = await api("GET", "render?path=This test/Related.md")
    check("this: not embedded, the note it's in", md.includes("[[Other]]") && !md.includes("[[Note]]"), md)
    let [code, r] = await api("GET", 'query?q={"from":"This test/","where":"file.links contains this"}&self=This test/Related.md&this=This test/Beacon.md')
    check("this: /api/query's this, as the app asks for an embedded block", code === 200 && r.groups[0].rows.map((x: Any) => x.title).join() === "Note", r)
    ;[code, r] = await api("POST", "ops/query.run", { where: "status = this.status", from: ["This test/"], this: "Beacon" })
    check("query.run: this (the note itself not listed)", code === 200 && r.groups[0].rows.map((x: Any) => x.title).join() === "Other", r)
    fs.rmSync(path.join(VAULT, "This test"), { recursive: true, force: true })
  }
}
