// Files, tabs and the editor: the file tree in the sidebar, opening files in tabs, a person file (profile header and the
// Timeline drawn as a timeline, raw lines when you click in), typing (saved to disk as a small edit), [[links]], new
// note, and on a phone the files tab (view:files) and files opening in tabs (from the tree, People, a [[link]]). WRITES to the vault: throwaway server only.
//   node web/qa/files.mjs <base url> <vault path> [out dir]   (a fresh copy of the vault each run: it renames files)
// Its subjects come from the vault (subjects.mjs): a person with a timeline and a plain paragraph ("person"), another
// one that also has want_to ("other"), a third person file ("third"), a note with links, a note that links to a note
// and a person, and a note to rename. People it can't find are made (People/Qa person*.md).
import { readFileSync } from "node:fs"
import { SHOTS, qa, wait } from "./lib/qa.mjs"
import { pageHash, subjects } from "./subjects.mjs"
const { args: [B, VAULT, OUT = SHOTS], browser } = await qa(import.meta.url)
const read = (p) => readFileSync(`${VAULT}/${p}`, "utf8")
const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
let v = await subjects(B)
const fit = (p) => p.entry && p.plain
if (!v.people.some(fit) || !v.people.some((p) => fit(p) && p.hasWant && p !== v.people.find(fit)) || v.people.length < 3) {
  for (const [name, want] of [["Qa person", ""], ["Qa person two", "want_to: Say hi\n"], ["Qa person three", ""]]) {
    await fetch(`${B}api/file`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: `People/${name}.md`,
      text: `---\ntype: person\nrelation: friend\n${want}---\n\n\`\`\`block-person\n\`\`\`\n\nMet at a meetup.\n\n## Timeline\n\n- 2026-09-20 · call · 20 min · Caught up\n` }) })
  }
  v = await subjects(B)
}
// Notes too (the sandbox has a few): one that links to another note and to a person, and spares (one linked to, to rename).
if (!v.linked || v.state.notes.length < 6) {
  const who = v.people.find(fit) ?? v.people[0]
  for (const [name, body] of [["Qa idea", "An idea worth linking to.\n"], ["Qa linking", `Links to [[Qa idea]] and to [[${who.name}]].\n`],
    ["Qa spare", "A note to rename.\n"], ["Qa pointer", "Points at [[Qa spare]].\n"]]) {
    await fetch(`${B}api/file`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: `Notes/${name}.md`,
      text: `---\ntype: note\n---\n\n${body}` }) })
  }
  v = await subjects(B)
}
const person = v.people.find(fit)
const other = v.people.find((p) => fit(p) && p.hasWant && p !== person)
const third = v.people.find((p) => p !== person && p !== other)
// Notes: one with links (opened from the switcher), one that links to a note and a person (the phone's link), one to rename.
const linking = v.need(v.linked, "a note that links to another note and to a person")
const withLinks = v.state.notes.find((n) => v.links(n.body ?? "").some((l) => l.note || l.person)).id
const linkedTo = new Set(v.state.notes.flatMap((n) => v.links(n.body ?? "").map((l) => l.note?.id)))
const spare = v.state.notes.filter((n) => ![linking.note.id, linking.idea.id, withLinks].includes(n.id))
const rename = v.need(spare.find((n) => linkedTo.has(n.id)) ?? spare[0], "a fourth note (to rename)").id
const topFile = (v.tree.files.find((f) => !f.path.includes("/") && !/^(AGENTS|CLAUDE)\.md$/.test(f.path)) ?? v.tree.files.find((f) => !f.path.includes("/"))).path.replace(/\.md$/, "")
const out = { errs: [] }

// ---------- desktop ----------
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
  const page = await ctx.newPage()
  page.on("pageerror", (e) => out.errs.push(String(e)))
  page.on("console", (m) => m.type() === "error" && out.errs.push(m.text()))
  const shot = (name) => page.screenshot({ path: `${OUT}files-desktop-${name}.png` })
  await page.goto(B); await wait(1500)
  await shot("start")
  out.tree = await page.locator("aside [role=tree]").count()
  // open People, then the person
  // By path: the tree may show a Dashboards/People.md too (the open page's folder is revealed).
  // (each folder down to the person's: People/, or Personal/People/ in a vault organized its own way)
  const dirs = person.path.split("/").slice(0, -1)
  for (let i = 0; i < dirs.length; i++) {
    const next = i + 1 < dirs.length ? dirs.slice(0, i + 2).join("/") : person.path
    if (!(await page.locator(`aside [role=tree] [data-tree-path="${next}"]`).count())) {
      await page.locator(`aside [role=tree] [data-tree-path="${dirs.slice(0, i + 1).join("/")}"] > button`).first().click(); await wait(300)
    }
  }
  await page.locator(`aside [role=tree] [data-tree-path="${person.path}"] > button`).first().click(); await wait(1500)
  out.personHash = await page.evaluate(() => location.hash)
  out.tabs = await page.locator("[role=tablist] [role=tab]").allInnerTexts()
  out.timelineWidget = await page.locator(".cm-block-section").count()
  out.header = await page.locator("article :text('Last in touch')").count()
  await shot("person")
  // click into the timeline: raw lines show
  await page.locator(".cm-block-section").first().click({ position: { x: 300, y: 60 } }); await wait(400)
  out.rawAfterClick = await page.locator(".cm-line", { hasText: person.entry }).count()
  await shot("person-editing-timeline")
  // type at the end of the first paragraph
  const before = read(person.path)
  await page.locator(".cm-line", { hasText: person.plain }).first().click(); await page.keyboard.press("End"); await page.keyboard.type(" Loves hiking.")
  await wait(2200)
  const after = read(person.path)
  out.typedSaved = after.includes(`${person.plain} Loves hiking.`)
  out.onlyThatChanged = after === before.replace(person.plain, `${person.plain} Loves hiking.`)
  // properties open/close
  await page.locator("button", { hasText: /^Properties/ }).first().click(); await wait(300)
  await shot("person-properties")
  // a note with links
  await page.keyboard.press("ControlOrMeta+o"); await wait(300)
  await page.keyboard.type(withLinks.split("/").pop()); await wait(500)
  await page.keyboard.press("Enter"); await wait(1500)
  out.noteHash = await page.evaluate(() => location.hash)
  out.tabs2 = await page.locator("[role=tablist] [role=tab]").allInnerTexts()
  await shot("note")
  out.wikilinks = await page.locator(".cm-wikilink").count()
  // new note from the tree header
  await page.locator("aside button[aria-label='New note']").click(); await wait(1500)
  out.newHash = await page.evaluate(() => location.hash)
  out.titleFocused = await page.evaluate(() => document.activeElement?.getAttribute("aria-label"))
  await page.keyboard.type("QA test note"); await page.keyboard.press("Enter"); await wait(1500)
  out.renamedHash = await page.evaluate(() => location.hash)
  // (in the tab shown: a pane keeps its other tabs drawn but hidden)
  await page.locator("#main-scroll .cm-content").click(); await page.keyboard.type(`Hello [[${person.name.slice(0, 3)}`); await wait(500)
  out.autocomplete = await page.locator(".cm-tooltip-autocomplete li").allInnerTexts()
  await page.keyboard.press("Enter"); await page.keyboard.type(" and **bold**."); await wait(2200)
  await page.locator("#main-scroll article h1, #main-scroll article textarea").first().click(); await wait(400)
  await shot("new-note")
  try { out.newNoteText = read("QA test note.md") } catch (e) { out.newNoteText = String(e) }
  await ctx.close()
}

// ---------- desktop: changes from elsewhere, properties, rename, old links, tabs ----------
{
  const { writeFileSync } = await import("node:fs")
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
  const page = await ctx.newPage()
  page.on("pageerror", (e) => out.errs.push(String(e)))
  const shot = (name) => page.screenshot({ path: `${OUT}files-desktop-${name}.png` })
  await page.goto(`${B}#file/${encodeURIComponent(other.path)}`); await wait(1500)
  // Claude appends a timeline line while the file is open: the editor picks it up, the timeline redraws
  const k = read(other.path)
  writeFileSync(`${VAULT}/${other.path}`, k.replace(/## Timeline\n+/, "## Timeline\n\n- 2026-09-29 · call · 20 min · From Claude while open\n"))
  await wait(6500)
  out.externalShown = await page.locator(".cm-block-section", { hasText: "From Claude while open" }).count()
  // and while typing: both kept
  await page.locator(".cm-line", { hasText: other.plain }).first().click(); await page.keyboard.press("End")
  await page.keyboard.type(" Met at a conference.")
  const k2 = read(other.path)
  writeFileSync(`${VAULT}/${other.path}`, k2.replace("- 2026-09-29 · call", "- 2026-09-29 · meet"))
  await wait(7000)
  const k3 = read(other.path)
  out.bothKept = k3.includes("Met at a conference.") && k3.includes("- 2026-09-29 · meet · 20 min")
  // a property: want_to changes on its own line only
  await page.locator("button", { hasText: /^Properties/ }).first().click(); await wait(300)
  const before = read(other.path)
  const want = page.locator("[role=row]", { has: page.locator("input[value=want_to]") }).locator("[role=cell] input").first()
  await want.fill("Ask about the camp"); await want.press("Enter"); await wait(2000)
  const after = read(other.path)
  out.propertyLine = after === before.replace(/want_to: .*\n/, "want_to: Ask about the camp\n")
  out.headerFollows = await page.locator("article :text('Ask about the camp')").count()
  await shot("other-properties")
  // rename a note from its title: links to it follow, the tab follows
  await page.goto(`${B}#file/${encodeURIComponent(`${rename}.md`)}`); await wait(1500)
  const t = page.locator("textarea[aria-label='File name']")
  await t.fill(`${rename.split("/").pop()} (maybe)`); await t.press("Enter"); await wait(2000)
  out.renameHash = await page.evaluate(() => location.hash)
  out.renameTabs = await page.locator("[role=tablist] [role=tab]").allInnerTexts()
  // a file's sheet address (a phone's, #<tab>/file/<path>) opens its tab
  const notes = await (await fetch(`${B}api/notes`)).json()
  await page.goto(`${B}#new/file/${encodeURIComponent(`${notes[0].id}.md`)}`); await wait(1800)
  out.sheetLinkHash = await page.evaluate(() => location.hash)
  out.sheetLinkSheet = await page.evaluate(() => !!document.querySelector("dialog")?.open)
  // close the active tab
  await page.locator("aside [role=tree] button", { hasText: new RegExp(`^${esc(topFile)}$`) }).first().click({ button: "middle" }); await wait(1200)
  const n = await page.locator("[role=tablist] [role=tab]").count()
  await page.locator("[role=tablist] button[aria-label^=Close]").first().click(); await wait(500)
  out.closedTab = n >= 2 && (await page.locator("[role=tablist] [role=tab]").count()) === n - 1
  // the same line changed on disk and in the editor: a banner asks, nothing is overwritten
  await page.goto(`${B}#file/${encodeURIComponent(third.path)}`); await wait(1500)
  await page.locator("#main-scroll .cm-content").click(); await page.keyboard.press("ControlOrMeta+End"); await page.keyboard.type("Mine.")
  await wait(1500)
  const m = read(third.path)
  writeFileSync(`${VAULT}/${third.path}`, m.replace("Mine.", "Theirs."))
  await page.keyboard.type(" More")
  await wait(7000)
  out.conflictBanner = await page.locator("[role=alert]", { hasText: "changed somewhere else" }).count()
  out.diskKept = read(third.path).includes("Theirs.") && !read(third.path).includes("Mine. More")
  await page.locator("[role=alert] button", { hasText: "Keep mine" }).click(); await wait(1500)
  out.keepMine = read(third.path).includes("Mine. More") && !read(third.path).includes("Theirs.")
  // source mode shows the frontmatter
  await page.goto(`${B}#file/${encodeURIComponent(person.path)}`); await wait(1500)
  // the status bar's view menu (its view button: the bar also has property chips, which open menus too): source mode
  await page.locator("[role=status] button[aria-label^='Current view']").click(); await wait(200)
  await page.locator("[role=menu] button", { hasText: "Source mode" }).click(); await wait(800)
  out.sourceShowsFm = await page.locator(".cm-line", { hasText: /^type: / }).count()
  await shot("source")
  await page.locator("[role=status] button[aria-label^='Current view']").click(); await wait(200)
  await page.locator("[role=menu] button", { hasText: "Live preview" }).click(); await wait(300)
  await ctx.close()
}

// ---------- phone ----------
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  const page = await ctx.newPage()
  page.on("pageerror", (e) => out.errs.push(String(e)))
  const shot = (name) => page.screenshot({ path: `${OUT}files-390-${name}.png` })
  const here = () => page.evaluate(() => ({ hash: decodeURIComponent(location.hash), sheet: !!document.querySelector("dialog")?.open, title: document.querySelector("[data-phone-title]")?.textContent, tabs: Number(document.querySelector("[data-tabs-button]")?.innerText) }))
  await page.goto(`${B}#view/files`); await wait(1500)
  await shot("files")
  // A file from the tree opens in a tab (a file opened from a view goes beside it), not a sheet; Back returns.
  { // (each folder down to it: People/, or Personal/People/)
    const dirs = other.path.split("/").slice(0, -1)
    for (let i = 0; i < dirs.length; i++) {
      const next = i + 1 < dirs.length ? dirs.slice(0, i + 2).join("/") : other.path
      if (!(await page.locator(`main [role=tree] [data-tree-path="${next}"]`).count())) {
        await page.locator(`main [role=tree] [data-tree-path="${dirs.slice(0, i + 1).join("/")}"] > button`).first().tap(); await wait(300)
      }
    }
  }
  const atTree = await here()
  await page.locator(`main [role=tree] [data-tree-path="${other.path}"] > button`).first().tap(); await wait(1500)
  out.phoneTree = await here()
  out.phoneTreeOk = !out.phoneTree.sheet && out.phoneTree.hash === `#file/${other.path}` && out.phoneTree.title === other.path.split("/").pop().replace(/\.md$/, "") && out.phoneTree.tabs === atTree.tabs + 1
  await shot("other")
  await page.goBack(); await wait(700)
  out.phoneTreeBackOk = (await here()).hash === "#view/files"
  await page.goto(`${B}#${await pageHash(B, "People")}`); await wait(1200)
  await page.locator("main button", { hasText: person.name }).first().tap(); await wait(1500)
  out.phonePeople = await here()
  out.phonePeopleOk = !out.phonePeople.sheet && out.phonePeople.hash === `#file/${person.path}`
  await shot("person-from-people")
  // A [[link]] in reading mode opens that file in the same tab (a file replaces a file); Back returns to the note.
  await page.goto(`${B}#file/${encodeURIComponent(`${linking.note.id}.md`)}`); await wait(1800)
  const atNote = await here()
  await page.locator("main .cm-wikilink").first().tap(); await wait(1500)
  out.phoneLink = await here()
  out.phoneLinkOk = !out.phoneLink.sheet && out.phoneLink.hash.startsWith("#file/") && out.phoneLink.hash !== atNote.hash && out.phoneLink.tabs === atNote.tabs
  await shot("link")
  await page.goBack(); await wait(800)
  out.phoneLinkBackOk = (await here()).hash === atNote.hash
  await ctx.close()
}
await browser.close()
console.log(JSON.stringify(out, null, 1))
