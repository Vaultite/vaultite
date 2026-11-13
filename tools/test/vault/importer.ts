import fs from "node:fs"
import path from "node:path"
import type { Any, VaultTest } from "./harness.ts"

const ID = (n: number) => String(n).repeat(32).slice(0, 32).replace(/\d/g, (d) => "abcdef0123456789"[+d])
const enc = (p: string) => p.split("/").map(encodeURIComponent).join("/")

export default async ($: VaultTest) => {
  const { VAULT, api, check, exists, read, sleep } = $
  // Importer (plugins/core/importer): Notion's Markdown & CSV zip and Evernote's .enex (made up here) into notes.
  const { zipFiles } = await import("../../../core/zipfile.ts")
  const notion = await import("../../../plugins/core/importer/notion.ts")
  const { fromEnml } = await import("../../../plugins/core/importer/html.ts")
  const { htmlToMarkdown } = await import("../../../core/htmlmd.ts")
  const { readEnex } = await import("../../../plugins/core/importer/evernote.ts")

  check("importer notion: names without ids", notion.bareName(`Plans ${ID(1)}.md`).name === "Plans.md" && notion.bareName(`Plans ${ID(1)}.md`).id === ID(1) &&
    notion.barePath(`Home ${ID(1)}/Tasks ${ID(2)}_all.csv`) === "Home/Tasks.csv" && notion.bareName("plain.png").id === null)
  check("importer notion: dates", notion.notionDate("October 5, 2026") === "2026-10-05" && notion.notionDate("October 5, 2026 3:04 PM") === "2026-10-05 15:04" &&
    notion.notionDate("Not a date") === null)
  const md = htmlToMarkdown(fromEnml(`<en-note><div><en-todo checked="true"/>Buy flour</div><div><en-todo/>Bake</div><table><tr><td>a</td><td>b</td></tr></table><div style="--en-codeblock:true;"><div>  x = 1</div></div><en-media hash="ab12" type="image/png"/></en-note>`),
    (h) => `![[A/${h}.png]]`)
  check("importer evernote: to-dos as tasks, tables, code keeps its spaces, media embedded", md.startsWith("- [x] Buy flour\n- [ ] Bake") && md.includes("| a | b |\n| --- | --- |") &&
    md.includes("```\n  x = 1\n```") && md.includes("![[A/ab12.png]]"), md)

  // A Notion export: a page, its subpage (linked both by path and by notion.so address), an image, a database with a row.
  const home = `Export-1234/Home ${ID(1)}`
  const files: Record<string, string | Buffer> = {
    [`${home}.md`]: `# Home\n\nSee [Trip](${enc(`Home ${ID(1)}/Trip ${ID(2)}.md`)}), [the plan](Home%20${ID(1)}/Plan%20(draft)%20${ID(5)}.md) and [again](https://www.notion.so/Trip-${ID(2)}).\n\n![photo](${enc(`Home ${ID(1)}/beach.png`)})\n\n[Tasks](${enc(`Home ${ID(1)}/Tasks ${ID(3)}.csv`)})\n\n\`[not](a.md)\`\n`,
    [`${home}/Trip ${ID(2)}.md`]: `# Trip\n\nBack to [Home](../${enc(`Home ${ID(1)}.md`)}).\n`,
    [`${home}/Plan (draft) ${ID(5)}.md`]: "# Plan (draft)\n\nUp to [Trip](Trip%20" + ID(2) + ".md).\n",
    "Export-1234/../../../escape.md": "out of the vault?\n",
    [`${home}/beach.png`]: Buffer.from([1, 2, 3]),
    [`${home}/Tasks ${ID(3)}.csv`]: "\ufeffName,Status\nPack,Done\n",
    [`${home}/Tasks ${ID(3)}_all.csv`]: "\ufeffName,Status,Due\nPack,Done,\"October 5, 2026\"\n",
    [`${home}/Tasks ${ID(3)}/Pack ${ID(4)}.md`]: `# Pack\n\nStatus: Done\nDue: October 5, 2026\nTrip: Trip (../${enc(`Trip ${ID(2)}.md`)})\nUrgent: Yes\n\nBring a hat.\n`,
  }
  fs.mkdirSync(path.join(VAULT, "Imports"), { recursive: true })
  fs.writeFileSync(path.join(VAULT, "Imports/notion.zip"), zipFiles({ "Export-1234-Part-1.zip": zipFiles(files) }))
  const runJob = async (body: unknown, q = "") => {
    const [st, job] = await api("POST", `importer${q}`, body)
    if (st !== 202) return { state: "refused", status: st, job }
    for (let i = 0; i < 1500; i++) {
      const [, j] = await api("GET", `importer/jobs/${job.id}`)
      if (j.state === "done" || j.state === "failed") return j
      await sleep(20)
    }
    return { state: "timeout" }
  }
  let j: Any = await runJob({ path: "Imports/notion.zip" }, "?folder=Imported")
  check("importer notion: a zip of parts, every page a note, the image and the database's CSV", j.state === "done" && j.source === "notion" && j.notes === 5 && j.created === 5 && j.files === 2 &&
    exists("Imported/Notion/escape.md") && !fs.existsSync(path.join(VAULT, "../escape.md")) && !fs.existsSync(path.join(VAULT, "Imported/escape.md")) &&
    exists("Imported/Notion/Home.md") && exists("Imported/Notion/Home/Trip.md") && exists("Imported/Notion/Home/beach.png") && exists("Imported/Notion/Home/Tasks/Pack.md"), j)
  const h = read("Imported/Notion/Home.md")
  check("importer notion: links as wikilinks (a notion.so one too), the image embedded, code untouched, the title heading off",
    h.includes("See [[Imported/Notion/Home/Trip|Trip]], [[Imported/Notion/Home/Plan (draft)|the plan]]") && h.includes("[[Imported/Notion/Home/Trip|again]]") && h.includes("![[Imported/Notion/Home/beach.png]]") &&
    h.includes("[[Imported/Notion/Home/Tasks.csv|Tasks]]") && h.includes("`[not](a.md)`") && !h.includes("# Home") && h.includes(`ext_id: notion-${ID(1)}`), h)
  check("importer notion: a link up a folder", read("Imported/Notion/Home/Trip.md").includes("Back to [[Imported/Notion/Home|Home]]."), read("Imported/Notion/Home/Trip.md"))
  check("importer notion: the database's every property, without the BOM", read("Imported/Notion/Home/Tasks.csv") === "Name,Status,Due\nPack,Done,\"October 5, 2026\"\n", read("Imported/Notion/Home/Tasks.csv"))
  const row = read("Imported/Notion/Home/Tasks/Pack.md")
  check("importer notion: a row's properties as frontmatter (a date, a boolean, a relation as a link)", row.startsWith("---\nStatus: Done\nDue: 2026-10-05\nTrip: ['[[Imported/Notion/Home/Trip|Trip]]']\nUrgent: true\n") &&
    row.trimEnd().endsWith("Bring a hat."), row)
  fs.appendFileSync(path.join(VAULT, "Imported/Notion/Home/Trip.md"), "my own edit\n")
  j = await runJob({ path: "Imports/notion.zip" }, "?folder=Imported")
  check("importer notion: importing again adds nothing and keeps edits", j.state === "done" && j.created === 0 && j.unchanged === 5 && j.files === 0 && read("Imported/Notion/Home/Trip.md").endsWith("my own edit\n") && !exists("Imported/Notion/Home/Tasks 1.csv"), j)

  // Evernote: a notebook's .enex, sent as the body.
  const png = Buffer.from([137, 80, 78, 71, 9, 9])
  const hash = (await import("node:crypto")).createHash("md5").update(png).digest("hex")
  const enex = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE en-export SYSTEM "http://xml.evernote.com/pub/evernote-export4.dtd">
<en-export export-date="20261010T100000Z" application="Evernote" version="10">
<note><title>Bread &amp; butter</title><created>20261005T150405Z</created><updated>20261006T080000Z</updated><tag>baking</tag><tag>to try</tag>
<note-attributes><source-url>https://example.com/bread</source-url><author>Alice Park</author></note-attributes>
<content><![CDATA[<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE en-note SYSTEM "http://xml.evernote.com/pub/enml2.dtd"><en-note><div>Mix <b>well</b>.</div><en-media hash="${hash}" type="image/png"/><div><en-todo/>Proof</div></en-note>]]></content>
<resource><data encoding="base64">${png.toString("base64")}</data><mime>image/png</mime><resource-attributes><file-name>dough.png</file-name></resource-attributes></resource>
<resource><data encoding="base64">${Buffer.from("hello").toString("base64")}</data><mime>application/zip</mime><resource-attributes><file-name>extra.zip</file-name></resource-attributes></resource>
</note>
<note><title>Empty</title><content><![CDATA[<en-note></en-note>]]></content></note>
</en-export>`
  const notes = [...readEnex(enex)]
  check("importer evernote: notes read (title decoded, tags, resources by MD5)", notes.length === 2 && notes[0].title === "Bread & butter" && notes[0].tags.join() === "baking,to try" &&
    notes[0].resources[0].hash === hash && notes[0].resources[0].name === "dough.png", notes.map((n) => n.title))
  const [st0, j0] = await api("POST", "importer", {})
  check("importer: a body that's neither a file nor a path is refused", st0 === 400, j0)
  fs.writeFileSync(path.join(VAULT, "Imports/Recipes.enex"), enex)
  j = await runJob({ path: "Imports/Recipes.enex" })
  const bread = "Evernote/Recipes/Bread & butter.md"
  check("importer evernote: a notebook into its folder, attachments beside", j.state === "done" && j.source === "evernote" && j.notes === 2 && j.created === 2 && j.files === 2 &&
    exists(bread) && exists("Evernote/Recipes/Attachments/dough.png") && exists("Evernote/Recipes/Empty.md"), j)
  const b = read(bread)
  check("importer evernote: frontmatter (tags, source, author, dates), the image embedded where it was, a file it never showed linked at the end, the to-do",
    /^---\ntags: \[baking, to-try\]\nsource: https:\/\/example.com\/bread\nauthor: Alice Park\ncreated: '2026-10-0\d \d\d:\d\d:05'\n/.test(b) && b.includes("Mix **well**.\n\n![[Evernote/Recipes/Attachments/dough.png]]\n\n- [ ] Proof") &&
    b.trimEnd().endsWith("[[Evernote/Recipes/Attachments/extra.zip]]") && /ext_id: evernote-[0-9a-f]{16}/.test(b), b)
  j = await runJob({ path: "Imports/Recipes.enex" })
  check("importer evernote: importing again adds nothing", j.state === "done" && j.created === 0 && j.unchanged === 2 && j.files === 0 && !exists("Evernote/Recipes/Attachments/dough 1.png"), j)
  fs.writeFileSync(path.join(VAULT, "Imports/junk.zip"), zipFiles({ "a.txt": "x" }))
  j = await runJob({ path: "Imports/junk.zip" })
  check("importer: a zip of neither says so", j.state === "failed" && /no notes in this zip/.test(j.error), j)
  const [ts, tb] = await api("POST", "ops/importer.run?as=text", { path: "Imports/Recipes.enex", wait: true })
  check("importer op: run and wait, in words", ts === 200 && /^Evernote: 2 notes in Evernote\/: 0 new, 2 imported before/.test(tb), [ts, tb])

  // Google Keep: a Takeout zip, a JSON file per note.
  const { readKeep } = await import("../../../plugins/core/importer/keep.ts")
  const t = 1_790_000_000_000_000
  const shop = { title: "", textContent: "", listContent: [{ text: "Milk", isChecked: true }, { text: "Eggs", isChecked: false }], labels: [{ name: "Errands" }, { name: "to buy" }],
    createdTimestampUsec: t, userEditedTimestampUsec: t + 60_000_000, isArchived: false, isTrashed: false }
  check("importer keep: a checklist note named by its first line, labels as tags", readKeep(shop)?.title === "Untitled" && readKeep(shop)?.body === "- [x] Milk\n- [ ] Eggs" &&
    readKeep({ textContent: "Call the bank\nabout the card" })?.title === "Call the bank" && readKeep({ foo: 1 }) === null)
  fs.writeFileSync(path.join(VAULT, "Imports/takeout.zip"), zipFiles({
    "Takeout/Keep/Shopping.json": JSON.stringify({ ...shop, title: "Shopping" }),
    "Takeout/Keep/Shopping.html": "<html></html>",
    "Takeout/Keep/Idea.json": JSON.stringify({ title: "Idea", textContent: "A garden app.", attachments: [{ filePath: "sketch.png", mimetype: "image/png" }],
      annotations: [{ source: "WEBLINK", title: "Gardens", url: "https://example.com/g" }], isArchived: true, createdTimestampUsec: t }),
    "Takeout/Keep/sketch.png": Buffer.from([1, 2, 3, 4]),
    "Takeout/Keep/Old.json": JSON.stringify({ title: "Old", textContent: "gone", isTrashed: true }),
  }))
  j = await runJob({ path: "Imports/takeout.zip" })
  const shopping = read("Keep/Shopping.md"), idea = read("Keep/Idea.md")
  check("importer keep: notes in Keep/, a trashed one left out, the attachment beside", j.state === "done" && j.source === "keep" && j.notes === 2 && j.created === 2 && j.files === 1 &&
    exists("Keep/Attachments/sketch.png") && !exists("Keep/Old.md"), j)
  check("importer keep: tags, dates, tasks; an archived note archived, its link and picture", shopping.startsWith("---\ntags: [Errands, to-buy]\ncreated: '") && shopping.includes("- [x] Milk\n- [ ] Eggs") &&
    /archived: true/.test(idea) && idea.includes("A garden app.\n\n[Gardens](https://example.com/g)\n\n![[Keep/Attachments/sketch.png]]") && /ext_id: keep-[0-9a-f]{16}/.test(idea), [shopping, idea])
  j = await runJob({ path: "Imports/takeout.zip" })
  check("importer keep: importing again adds nothing", j.state === "done" && j.created === 0 && j.unchanged === 2 && j.files === 0, j)

  // HTML pages: a zip of another app's pages, and one page alone.
  const { pageMarkdown } = await import("../../../plugins/core/importer/importer.ts")
  check("importer html: a page's body as Markdown, its title heading off", await pageMarkdown("<html><head><title>T</title><style>x{}</style></head><body><h1>Trip</h1><p>Go <b>now</b>.</p></body></html>", "Trip") === "Go **now**.")
  fs.writeFileSync(path.join(VAULT, "Imports/Old wiki.zip"), zipFiles({
    "site/index.html": '<html><body><h1>Home</h1><p>See <a href="pages/Garden%20plan.html">the plan</a> and <a href="https://example.com">a site</a>.</p><img src="img/rose.png" alt="Rose"></body></html>',
    "site/pages/Garden plan.html": '<html><body><p>Back <a href="../index.html">home</a>.</p><ul><li>Roses</li><li>Tulips</li></ul></body></html>',
    "site/img/rose.png": Buffer.from([9, 9, 9]),
  }))
  j = await runJob({ path: "Imports/Old wiki.zip" })
  const index = read("Old wiki/site/index.md"), garden = read("Old wiki/site/pages/Garden plan.md")
  check("importer html: a note per page in a folder named as the export, the image beside", j.state === "done" && j.source === "html" && j.notes === 2 && j.created === 2 && j.files === 1 &&
    exists("Old wiki/site/img/rose.png"), j)
  check("importer html: links between pages as wikilinks, web links kept, the image embedded", index.includes("[[Old wiki/site/pages/Garden plan|the plan]]") && index.includes("[a site](https://example.com)") &&
    index.includes("![[Old wiki/site/img/rose.png]]") && garden.includes("Back [[Old wiki/site/index|home]].") && garden.includes("- Roses\n- Tulips") && /^---\next_id: html-[0-9a-f]{16}\n---/.test(index), [index, garden])
  j = await runJob({ path: "Imports/Old wiki.zip" })
  check("importer html: importing again adds nothing", j.state === "done" && j.created === 0 && j.unchanged === 2 && j.files === 0, j)
  fs.writeFileSync(path.join(VAULT, "Imports/Recipe.html"), "<!DOCTYPE html><html><body><h2>Bread</h2><p>Flour, water.</p></body></html>")
  j = await runJob({ path: "Imports/Recipe.html" })
  check("importer html: one page alone", j.state === "done" && j.notes === 1 && read("Recipe/Recipe.md").includes("## Bread\n\nFlour, water."), [j, exists("Recipe/Recipe.md") && read("Recipe/Recipe.md")])

  // Bear: a .bear2bk, a zip of TextBundles.
  const { bearNote } = await import("../../../plugins/core/importer/bear.ts")
  const bn = bearNote("# Groceries\nBuy ::milk:: for #home stuff# and #errands\n```\n::code:: #not this#\n```\n")
  check("importer bear: title from the first heading, highlights, tags with spaces, code left alone", bn.title === "Groceries" &&
    bn.body === "Buy ==milk== for #home-stuff and #errands\n```\n::code:: #not this#\n```", bn)
  const info = (o: Record<string, unknown>) => JSON.stringify({ "net.shinyfrog.bear": { creationDate: "2026-09-01T10:00:00Z", modificationDate: "2026-09-02T10:00:00Z", ...o } })
  fs.writeFileSync(path.join(VAULT, "Imports/Notes.bear2bk"), zipFiles({
    "Bear Notes/Trip.textbundle/text.markdown": "# Trip\nPack light.\n![](assets/map%201.png)\n",
    "Bear Notes/Trip.textbundle/info.json": info({ uniqueIdentifier: "AAA-1" }),
    "Bear Notes/Trip.textbundle/assets/map 1.png": Buffer.from([5, 5, 5]),
    "Bear Notes/Old.textbundle/text.markdown": "# Old\nArchived.\n",
    "Bear Notes/Old.textbundle/info.json": info({ uniqueIdentifier: "AAA-2", archived: 1 }),
    "Bear Notes/Gone.textbundle/text.markdown": "# Gone\n",
    "Bear Notes/Gone.textbundle/info.json": info({ uniqueIdentifier: "AAA-3", trashed: 1 }),
  }))
  j = await runJob({ path: "Imports/Notes.bear2bk" })
  const trip = read("Bear/Trip.md")
  check("importer bear: notes in Bear/, a trashed one left out, an archived one archived, pictures as attachments", j.state === "done" && j.source === "bear" && j.notes === 2 && j.created === 2 && j.files === 1 &&
    !exists("Bear/Gone.md") && /archived: true/.test(read("Bear/Old.md")) && trip.includes("Pack light.\n![[Bear/Attachments/map 1.png]]") && /^---\ncreated: '2026-09-0\d/.test(trip), [j, trip])
  j = await runJob({ path: "Imports/Notes.bear2bk" })
  check("importer bear: importing again adds nothing", j.state === "done" && j.created === 0 && j.unchanged === 2 && j.files === 0, j)

  // CSV: a note per row.
  const { rowNote } = await import("../../../plugins/core/importer/importer.ts")
  const rn = rowNote({ Name: " Fig ", Notes: "Sweet.", Price: "3.5", Stock: "12", Origin: "Turkey", Empty: "", Code: "0012345678901234567", Zip: "02139", Cost: "1.50" })
  check("importer csv: a row as a note (first column its name, Notes its text, numbers as numbers, empties left out)", rn.title === "Fig" && rn.body === "Sweet." &&
    JSON.stringify(rn.fm) === '{"Price":3.5,"Stock":12,"Origin":"Turkey","Code":"0012345678901234567","Zip":"02139","Cost":"1.50"}', rn)
  fs.writeFileSync(path.join(VAULT, "Imports/Books read.csv"), "\ufeffTitle,Author,Year,Notes\nDune,Frank Herbert,1965,Loved it.\n\"Hello, world\",A. Writer,2001,\nDune,Someone Else,2020,\n")
  j = await runJob({ path: "Imports/Books read.csv" })
  check("importer csv: a note per row in a folder named as the file, rows with one name kept apart", j.state === "done" && j.source === "csv" && j.notes === 3 && j.created === 3 &&
    read("Books read/Dune.md").startsWith("---\nAuthor: Frank Herbert\nYear: 1965\next_id: csv-") && read("Books read/Dune.md").trimEnd().endsWith("Loved it.") &&
    exists("Books read/Hello, world.md") && read("Books read/Dune 1.md").includes("Author: Someone Else"), [j, exists("Books read/Dune.md") && read("Books read/Dune.md")])
  j = await runJob({ path: "Imports/Books read.csv" })
  check("importer csv: importing again adds nothing", j.state === "done" && j.created === 0 && j.unchanged === 3, j)

  // Fixes: names that differ only in case, Bear's :: in code-like text, HTML pages with a readme, Keep's renamed pictures.
  check("importer bear: :: between words isn't a highlight", bearNote("# T\nstd::vector::size and ::this::").body === "std::vector::size and ==this==", bearNote("# T\nstd::vector::size and ::this::").body)
  fs.writeFileSync(path.join(VAULT, "Imports/Cases.enex"), `<?xml version="1.0"?><en-export><note><title>Ideas</title><content><![CDATA[<en-note>One</en-note>]]></content></note><note><title>ideas</title><content><![CDATA[<en-note>Two</en-note>]]></content></note></en-export>`)
  j = await runJob({ path: "Imports/Cases.enex" })
  check("importer: two names that differ only in case get two files (one file on a Mac)", j.created === 2 && exists("Evernote/Cases/Ideas.md") && exists("Evernote/Cases/ideas 1.md"), [j, fs.readdirSync(path.join(VAULT, "Evernote/Cases"))])
  fs.writeFileSync(path.join(VAULT, "Imports/Docs.zip"), zipFiles({ "README.md": "# Read me\n", "index.html": "<html><body><p>Hi</p></body></html>" }))
  j = await runJob({ path: "Imports/Docs.zip" })
  check("importer: HTML pages with a readme are HTML pages, not Notion's", j.state === "done" && j.source === "html", j)
  fs.writeFileSync(path.join(VAULT, "Imports/takeout2.zip"), zipFiles({
    "Takeout/Keep/Photo.json": JSON.stringify({ title: "Photo", textContent: "Look", attachments: [{ filePath: "snap.jpeg", mimetype: "image/jpeg" }] }),
    "Takeout/Keep/snap.jpg": Buffer.from([1, 1]),
  }))
  j = await runJob({ path: "Imports/takeout2.zip" })
  check("importer keep: a picture Takeout renamed (.jpeg as .jpg) is still found", j.state === "done" && j.files === 1 && read("Keep/Photo.md").includes("![[Keep/Attachments/snap.jpg]]") && !j.problems.length, [j, exists("Keep/Photo.md") && read("Keep/Photo.md")])
  // Roam: its JSON export.
  const { roamNotes, roamDate } = await import("../../../plugins/core/importer/roam.ts")
  const graph = [
    { title: "October 5th, 2026", "create-time": 1790000000000, children: [{ string: "{{[[TODO]]}} Call [[Alice Park]] about ((r1))", uid: "a1" }, { string: "Read __Dune__ ^^today^^ #[[book club]]", uid: "a2", children: [{ string: "ch. 1-3", uid: "a3" }] }] },
    { title: "Alice Park", children: [{ string: "Plans", heading: 2, uid: "h1", children: [{ string: "the garden plan", uid: "r1" }] }, { string: "Met on [[October 5th, 2026]]", uid: "m1" }] },
  ]
  check("importer roam: daily titles as dates", roamDate("October 5th, 2026") === "2026-10-05" && roamDate("Alice Park") === null)
  const rn2 = roamNotes(graph)
  check("importer roam: blocks as nested lists, TODO a task, refs as their text, tags, italics, highlights, headings, links to daily pages by date",
    rn2[0].name === "2026-10-05" && rn2[0].body === "- [ ] Call [[Alice Park]] about the garden plan\n- Read *Dune* ==today== #book-club\n  - ch. 1-3" &&
    rn2[1].body === "### Plans\n- the garden plan\n- Met on [[2026-10-05|October 5th, 2026]]", rn2)
  fs.writeFileSync(path.join(VAULT, "Imports/roam-graph.json"), JSON.stringify(graph))
  j = await runJob({ path: "Imports/roam-graph.json" })
  check("importer roam: pages in Roam/, a daily page by its date with its title as an alias", j.state === "done" && j.source === "roam" && j.notes === 2 && j.created === 2 &&
    read("Roam/2026-10-05.md").startsWith("---\naliases: ['October 5th, 2026']\ncreated: '") && exists("Roam/Alice Park.md"), [j, exists("Roam/2026-10-05.md") && read("Roam/2026-10-05.md")])
  j = await runJob({ path: "Imports/roam-graph.json" })
  check("importer roam: importing again adds nothing", j.state === "done" && j.created === 0 && j.unchanged === 2, j)
  const odd = roamNotes([{ title: "Projects/Alpha: plan", children: [{ string: "`__init__` and [[x]] in code:\n```\ndef __init__(self): [[1]]\n```", uid: "c1" }] },
    { title: "Ring", children: [{ string: "a ((r2))", uid: "r1" }, { string: "b ((r1))", uid: "r2" }, { string: "on #[[October 5th, 2026]]", uid: "r3" }] }])
  check("importer roam: code left as written, a ring of refs stops, a date tag a link to the day",
    odd[0].body.includes("`__init__` and [[x]] in code:") && odd[0].body.includes("def __init__(self): [[1]]") &&
    odd[1].body.split("\n")[0] === "- a b a ((r2))" && odd[1].body.includes("on [[2026-10-05|October 5th, 2026]]"), odd.map((n) => n.body))
  fs.writeFileSync(path.join(VAULT, "Imports/roam-odd.json"), JSON.stringify([{ title: "Projects/Alpha: plan", children: [{ string: "x", uid: "o1" }] }]))
  j = await runJob({ path: "Imports/roam-odd.json" })
  check("importer roam: a title a file can't be named keeps it as an alias", read("Roam/Projects Alpha - plan.md").startsWith("---\naliases: ['Projects/Alpha: plan']"), exists("Roam/Projects Alpha - plan.md") && read("Roam/Projects Alpha - plan.md"))
}

