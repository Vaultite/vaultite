// Renaming and moving a note updates the links to it, on disk and in the app: renamed from its title and from the tree,
// moved with Move file to… and by dragging in the tree; [[wikilinks]] (alias, heading, embed), Markdown links (relative,
// from the top, %20 and <angle>), from its folder and another, in notes made in the app and on disk; a note open in
// another pane shows the new text live and keeps it when typed into; the renamed note's tab follows, its backlinks
// resolve; a phone's Move file to… too. WRITES (makes, renames and trashes "Qa links", "Qa far", "Qa archive"): throwaway server only.
//   node web/qa/renamelinks.mjs <base url> <vault path> [out dir]
import fs from "node:fs"
import path from "node:path"
import { SHOTS, apiAt, command, qa, until, viewsAt } from "./lib/qa.mjs"
const { args: [B, VAULT, OUT = SHOTS], browser, check, watch, done } = await qa(import.meta.url)
const api = apiAt(B)
const disk = (p) => { try { return fs.readFileSync(path.join(VAULT, p), "utf8") } catch { return null } }
const enc = (s) => s.replace(/ /g, "%20")
const DIRS = ["Qa links", "Qa far", "Qa archive", "Qa distant"]
for (const p of DIRS) await fetch(`${B}api/file?path=${encodeURIComponent(p)}`, { method: "DELETE" })
// (not "Qa distant": a folder is renamed to it)
for (const p of DIRS.slice(0, 3)) await api("POST", "folder", { path: p })

// The note to rename, and notes linking to it every way: beside it, from another folder, and one written on disk.
let name = "Lighthouse plan", at = `Qa links/${name}.md`
// (its own relative link changes when it moves: its open tab shows that too)
const own = (rel) => `Plans, by [linker](${rel}).\n\n## Goals\n\nShip it.\n`
await api("POST", "file", { path: at, text: own("./Linker.md") })
const linker = "Qa links/Linker.md"
let far = "Qa far/Far.md", onDisk = "Qa far/Disk.md"
const linkerText = (n, dir = "") => `Wiki [[${n}]] alias [[${n}|the plan]] head [[${n}#Goals]] embed ![[${n}]]\n`
  + `Md [rel](${enc(dir + n)}.md) [dot](${enc(dir + n)}.md#Goals) [angle](<${dir}${n}.md>)\n`
// (written as files, not through the API, which adds a note's dates: each file's text is checked whole)
const put = (p, text) => fs.writeFileSync(path.join(VAULT, p), text)
put(linker, linkerText(name).replace("[dot](", "[dot](./"))
put(far, `Far [[${name}]] [up](../Qa%20links/${enc(name)}.md) [top](Qa%20links/${enc(name)}.md) [root](/Qa%20links/${enc(name)}.md)\n`)
put(onDisk, `Disk [[${name}|plan]] and [[Qa links/${name}]]\n`)
await until(async () => (await api("GET", "files")).files.filter((f) => [linker, far, onDisk].includes(f.path)).length === 3, 5000)
const views = viewsAt(B)
await views("source") // (the editor's text as written: live preview hides the brackets)
const filesBefore = await api("GET", "config/files")
await api("PUT", "config/files", { ...filesBefore, fileSort: "name", autoReveal: false })

const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
await ctx.addInitScript(() => { if (!sessionStorage.getItem("qa")) { localStorage.clear(); sessionStorage.setItem("qa", "1") } })
const page = watch(await ctx.newPage(), { console: true })
const shot = (n) => page.screenshot({ path: `${OUT}renamelinks-${n}.png` })
const go = (p) => page.evaluate((h) => { location.hash = h }, `#file/${encodeURIComponent(p)}`)
const panes = () => page.locator("[data-pane-area] > section[data-pane-frame]:not([data-away])")
const shown = (pane) => panes().nth(pane).locator(".file-view:not([data-kept] *) .cm-content").first()
const paneText = (pane) => shown(pane).evaluate((el) => [...el.querySelectorAll(".cm-line")].map((l) => l.textContent).join("\n")).catch(() => "")
const row = (p) => page.locator(`aside [role=tree] div[data-tree-path="${p}"]`).first()
const expanded = (p) => page.locator(`aside [role=tree] div[data-tree-path="${p}"] > [role=treeitem]`).first().getAttribute("aria-expanded")
const unfold = async (p) => { if ((await expanded(p)) !== "true") { await row(p).locator("button").first().click(); await until(async () => (await expanded(p)) === "true", 2000) } }
const backlinks = async (p) => ((await api("GET", `file/linked?path=${encodeURIComponent(p)}`)).linked ?? []).map((l) => l.path).sort()

// The app: one pane on the linking note, a second on the note to rename.
await page.goto(`${B}#file/${encodeURIComponent(linker)}`)
await page.waitForSelector("[data-tab-strip] [data-tab-id]", { timeout: 30000 })
for (let i = 0; i < 8 && (await panes().count()) > 1; i++) await command(page, "Close pane")
await command(page, "Close all other tabs")
await until(async () => (await paneText(0)).includes("[[Lighthouse plan]]"), 8000)
await command(page, "Split right")
await until(async () => (await panes().count()) === 2, 3000)
await go(at)
await until(async () => (await paneText(1)).includes("Ship it."), 5000)

// A note made in the app, linking by typing (closed brackets: the editor pairs them).
await page.locator("aside button[aria-label='New note']").click()
await until(() => page.evaluate(() => document.activeElement?.getAttribute("aria-label") === "File name"), 5000)
await page.keyboard.type("Qa typed link"); await page.keyboard.press("Enter")
const typed = await until(async () => { const h = decodeURIComponent(await page.evaluate(() => location.hash)); return h.endsWith("Qa typed link.md") && h.replace(/^#file\//, "") }, 5000)
check("a new note named in the app", !!typed, await page.evaluate(() => location.hash))
await page.locator("[data-focused] .file-view:not([data-kept] *) .cm-content").first().click()
await page.keyboard.type("Typed [[Lighthouse plan"); await page.keyboard.press("Escape")
await until(() => disk(typed)?.includes("Typed [[Lighthouse plan]]"), 5000)
check("…its link saved as typed", disk(typed)?.includes("Typed [[Lighthouse plan]]"), disk(typed))
await go(at)
await until(async () => (await paneText(1)).includes("Ship it."), 5000)
let linkingFiles = [linker, far, onDisk, typed].sort()
check("set up: every linking note is a backlink", JSON.stringify(await backlinks(at)) === JSON.stringify(linkingFiles), await backlinks(at))

/** After a rename or move to `to`: every link on disk follows, the other pane shows it live, backlinks still resolve. */
async function follows(how, to, want) {
  const was = name
  name = path.basename(to, ".md"); at = to
  const is = (p) => typeof want[p] === "string" ? disk(p) === want[p] : !!disk(p)?.includes(want[p].has)
  const ok = await until(() => Object.keys(want).every(is), 6000)
  check(`${how}: links follow on disk`, ok, Object.fromEntries(Object.keys(want).filter((p) => !is(p)).map((p) => [p, disk(p)])))
  if (was !== name) check(`${how}: the old name is linked nowhere`, linkingFiles.every((p) => !disk(p).includes(`${was}]`) && !disk(p).includes(`${enc(was)}.md`)))
  const live = await until(async () => (await paneText(0)) === want[linker], 5000)
  check(`${how}: the linking note open in another pane shows it, no reload`, live, await paneText(0))
  check(`${how}: backlinks still resolve`, JSON.stringify(await backlinks(to)) === JSON.stringify(linkingFiles), await backlinks(to))
  const tree = (await api("GET", "files")).files
  check(`${how}: nothing is left at the old place`, !tree.some((f) => f.path === `Qa links/${was}.md`) && tree.some((f) => f.path === to))
}

// 1. Rename from the title, in its pane.
const title = panes().nth(1).locator(".file-view:not([data-kept] *) textarea[aria-label='File name']").first()
await title.fill("Lighthouse roadmap"); await title.press("Enter")
await follows("renamed from the title", "Qa links/Lighthouse roadmap.md", {
  [linker]: linkerText("Lighthouse roadmap"),
  [far]: "Far [[Lighthouse roadmap]] [up](../Qa%20links/Lighthouse%20roadmap.md) [top](Qa%20links/Lighthouse%20roadmap.md) [root](/Qa%20links/Lighthouse%20roadmap.md)\n",
  [onDisk]: "Disk [[Lighthouse roadmap|plan]] and [[Qa links/Lighthouse roadmap]]\n",
  [typed]: { has: "Typed [[Lighthouse roadmap]]" },
})
check("…its tab follows", await until(async () => decodeURIComponent(await page.evaluate(() => location.hash)) === `#file/${at}`, 3000)
  && (await panes().nth(1).getAttribute("aria-label")) === "Lighthouse roadmap", await page.evaluate(() => location.hash))
check("…and still shows the note", (await paneText(1)).includes("Ship it."))
await shot("title")

// Typing into the linking note after: its editor saves onto the new links, not the old ones back.
await shown(0).click()
await page.keyboard.press("ControlOrMeta+End"); await page.keyboard.type("Typed after.")
await until(() => disk(linker)?.includes("Typed after."), 5000)
check("typing into the linking note keeps the new links", disk(linker) === `${linkerText("Lighthouse roadmap")}Typed after.`, disk(linker))
await api("PUT", "file", { path: linker, text: linkerText(name), base: disk(linker) })
await until(async () => !(await paneText(0)).includes("Typed after."), 5000)

// 2. Rename from the file tree's menu.
await unfold("Qa links")
await row(at).click({ button: "right" })
await page.locator("[role=menu] button", { hasText: /^Rename/ }).first().click()
const field = page.locator("aside [role=tree] input").first()
await field.waitFor({ timeout: 3000 })
await field.fill("Lighthouse brief"); await field.press("Enter")
await follows("renamed in the tree", "Qa links/Lighthouse brief.md", {
  [linker]: linkerText("Lighthouse brief"),
  [far]: "Far [[Lighthouse brief]] [up](../Qa%20links/Lighthouse%20brief.md) [top](Qa%20links/Lighthouse%20brief.md) [root](/Qa%20links/Lighthouse%20brief.md)\n",
  [onDisk]: "Disk [[Lighthouse brief|plan]] and [[Qa links/Lighthouse brief]]\n",
  [typed]: { has: "Typed [[Lighthouse brief]]" },
})
check("…its tab follows", await until(async () => (await panes().nth(1).getAttribute("aria-label")) === "Lighthouse brief", 3000))
check("…and its title says the new name", await until(async () => (await title.inputValue()) === "Lighthouse brief", 3000), await title.inputValue())

// 3. Move file to…, into another folder: relative links climb out to it.
await row(at).click({ button: "right" })
await page.locator("[role=menu] button", { hasText: "Move file to…" }).click()
const dialog = page.locator('[role=dialog][aria-label="Move to folder"]')
await dialog.waitFor({ timeout: 3000 })
await page.keyboard.type("Qa archive")
await until(async () => (await dialog.locator("[role=option]").first().innerText()).startsWith("Qa archive"), 3000)
await page.keyboard.press("Enter")
await follows("moved with Move file to…", "Qa archive/Lighthouse brief.md", {
  [linker]: linkerText("Lighthouse brief", "../Qa archive/"),
  [far]: "Far [[Lighthouse brief]] [up](../Qa%20archive/Lighthouse%20brief.md) [top](Qa%20archive/Lighthouse%20brief.md) [root](/Qa%20archive/Lighthouse%20brief.md)\n",
  [onDisk]: "Disk [[Lighthouse brief|plan]] and [[Qa archive/Lighthouse brief]]\n",
  [typed]: { has: "Typed [[Lighthouse brief]]" },
})
const crumbs = () => panes().nth(1).locator("nav[aria-label='File path']:visible").first().innerText()
check("…its tab follows", await until(async () => (await crumbs()).includes("Qa archive"), 3000), await crumbs().catch(String))
const ownLive = await until(async () => (await paneText(1)).includes(own("../Qa%20links/Linker.md").trim()), 5000)
check("…its own relative link follows, on disk and in its open tab", disk(at).includes(own("../Qa%20links/Linker.md")) && ownLive, [disk(at), await paneText(1)])
await shot("moved")

// 4. Dragged in the tree into the far note's folder.
await unfold("Qa archive")
const center = async (loc) => { await loc.scrollIntoViewIfNeeded(); const b = await loc.boundingBox(); return [b.x + Math.min(60, b.width / 2), b.y + b.height / 2] }
const [x, y] = await center(row(at))
await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 6, y + 4, { steps: 3 })
await page.mouse.move(...(await center(row("Qa far"))), { steps: 8 })
await until(() => page.evaluate(() => !!document.querySelector("aside .drop-target div[data-tree-path='Qa far']")), 2000)
await page.mouse.up()
await follows("dragged in the tree", "Qa far/Lighthouse brief.md", {
  [linker]: linkerText("Lighthouse brief", "../Qa far/"),
  [far]: "Far [[Lighthouse brief]] [up](Lighthouse%20brief.md) [top](Qa%20far/Lighthouse%20brief.md) [root](/Qa%20far/Lighthouse%20brief.md)\n",
  [onDisk]: "Disk [[Lighthouse brief|plan]] and [[Qa far/Lighthouse brief]]\n",
  [typed]: { has: "Typed [[Lighthouse brief]]" },
})
check("…its tab follows", await until(async () => (await crumbs()).includes("Qa far"), 3000), await crumbs().catch(String))
await shown(1).click()
await page.keyboard.press("ControlOrMeta+End"); await page.keyboard.type("Moved.")
await until(() => disk(at)?.includes("Moved."), 5000)
check("…typed into after, it keeps that link", disk(at).includes(`${own("../Qa%20links/Linker.md")}Moved.`), disk(at))
await shot("dragged")

// 5. The folder the note and two linking notes are in, renamed in the tree: links into it and out of it follow.
await row("Qa far").click({ button: "right" })
await page.locator("[role=menu] button", { hasText: /^Rename/ }).first().click()
await field.waitFor({ timeout: 3000 })
await shot("folder-rename")
await field.fill("Qa distant"); await field.press("Enter")
far = "Qa distant/Far.md"; onDisk = "Qa distant/Disk.md"
linkingFiles = [linker, far, onDisk, typed].sort()
await follows("its folder renamed", "Qa distant/Lighthouse brief.md", {
  [linker]: linkerText("Lighthouse brief", "../Qa distant/"),
  [far]: "Far [[Lighthouse brief]] [up](Lighthouse%20brief.md) [top](Qa%20distant/Lighthouse%20brief.md) [root](/Qa%20distant/Lighthouse%20brief.md)\n",
  [onDisk]: "Disk [[Lighthouse brief|plan]] and [[Qa distant/Lighthouse brief]]\n",
  [typed]: { has: "Typed [[Lighthouse brief]]" },
})
check("…the note's tab follows", await until(async () => (await crumbs()).includes("Qa distant"), 3000), await crumbs().catch(String))
check("…and still shows what was typed", (await paneText(1)).includes("Moved."), await paneText(1))
await ctx.close()

// 6. A phone: Move file to… from a row's … menu; the links follow too.
const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 3 })
const m = watch(await phone.newPage())
await m.goto(`${B}#view/files`)
const mrow = (p) => m.locator(`[role=tree]:visible div[data-tree-path="${p}"]`).first()
await mrow("Qa distant").waitFor({ timeout: 15000 })
if ((await m.locator('[role=tree]:visible li:has(div[data-tree-path="Qa distant"]):not(:has(li div[data-tree-path="Qa distant"]))').first().getAttribute("aria-expanded")) !== "true") await mrow("Qa distant").locator("button").first().tap()
await mrow(at).locator('button[aria-label^="More for"]').tap()
await m.locator("[role=menu] button", { hasText: "Move file to…" }).tap()
const mdialog = m.locator('[role=dialog][aria-label="Move to folder"]')
await mdialog.waitFor({ timeout: 3000 })
await m.keyboard.type("Qa links")
await until(async () => (await mdialog.locator("[role=option]").first().innerText()).startsWith("Qa links"), 3000)
await mdialog.locator("[role=option]").first().tap()
const back = await until(() => disk(linker) === linkerText("Lighthouse brief") && disk(far)?.startsWith("Far [[Lighthouse brief]] [up](../Qa%20links/Lighthouse%20brief.md)"), 6000)
check("phone: moved with Move file to…, links follow", back, [disk(linker), disk(far)])
await m.screenshot({ path: `${OUT}renamelinks-phone.png` })
await phone.close()

for (const p of [...DIRS, typed]) await fetch(`${B}api/file?path=${encodeURIComponent(p)}`, { method: "DELETE" })
await api("PUT", "config/files", filesBefore)
await views(null)
await done()
