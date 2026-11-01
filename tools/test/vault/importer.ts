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
  const { fromEnml, toMarkdown } = await import("../../../plugins/core/importer/html.ts")
  const { readEnex } = await import("../../../plugins/core/importer/evernote.ts")

  check("importer notion: names without ids", notion.bareName(`Plans ${ID(1)}.md`).name === "Plans.md" && notion.bareName(`Plans ${ID(1)}.md`).id === ID(1) &&
    notion.barePath(`Home ${ID(1)}/Tasks ${ID(2)}_all.csv`) === "Home/Tasks.csv" && notion.bareName("plain.png").id === null)
  check("importer notion: dates", notion.notionDate("October 5, 2026") === "2026-10-05" && notion.notionDate("October 5, 2026 3:04 PM") === "2026-10-05 15:04" &&
    notion.notionDate("Not a date") === null)
  const md = toMarkdown(fromEnml(`<en-note><div><en-todo checked="true"/>Buy flour</div><div><en-todo/>Bake</div><table><tr><td>a</td><td>b</td></tr></table><div style="--en-codeblock:true;"><div>  x = 1</div></div><en-media hash="ab12" type="image/png"/></en-note>`),
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
}
