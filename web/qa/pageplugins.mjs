// Pinning and dashboards are plugins (Pinned: plugins/core/pages, Dashboards: plugins/core/dashboards), each on and off,
// on a computer and a phone. Both on: a dashboard is a page (its header, a grid of cards), a file opened from it opens
// beside it while a file opened from a pinned note replaces it (pinned isn't a page any more), Pin / Unpin are in the
// tree's menu, the palette and Pinned's settings. Pinned off: no list in the sidebar or the phone's drawer, no Pin anywhere, no
// tiles on a phone's new tab, a new device starts on a new tab, dashboards still pages. Dashboards off: a dashboard
// opens as a Markdown file (its title, its blocks one under another in the editor), files open in its place, and
// /api/render has no subtitle. Both off: nothing breaks. No page errors anywhere. WRITES .vaultite/plugins.json and
// pages.json, and a note in Qa page plugins/ (removed at the end): throwaway server only.
//   node web/qa/pageplugins.mjs <base url> <vault path> [out dir]
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { qa, wait } from "./lib/qa.mjs"

const { args: [B, VAULT, OUT = "/tmp/pageplugins-shots/"], browser, check, watch, done } = await qa(import.meta.url)
mkdirSync(OUT, { recursive: true })
const hash = (p) => `#file/${encodeURIComponent(p)}`
const TODAY = "Dashboards/Today.md"
// Notes of its own, not pinned, to open from the tree (whatever notes the vault has).
const OTHER = "Qa page plugins/A note.md", ANOTHER = "Qa page plugins/Another note.md"
mkdirSync(`${VAULT}/Qa page plugins`, { recursive: true })
writeFileSync(`${VAULT}/${OTHER}`, "# A note\n\nOpened from the tree.\n")
writeFileSync(`${VAULT}/${ANOTHER}`, "# Another note\n\nOpened from a pinned note.\n")
const PINNED = JSON.parse(readFileSync(`${VAULT}/.vaultite/pages.json`, "utf8")).pinned
const isDashboard = (p) => { try { return /^type: dashboard$/m.test(readFileSync(`${VAULT}/${p}`, "utf8").split("\n---")[0]) } catch { return false } }
// A pinned note (not a page): the vault's first pin that isn't a dashboard (the sandbox's "How this vault works").
const NOTE = PINNED.find((p) => p.endsWith(".md") && !isDashboard(p))
const NOTE_NAME = NOTE.split("/").pop().replace(/\.md$/, "")
// A pinned page (a dashboard): the vault's first pin whose file says `type: dashboard` (the sandbox's "Start here").
const PAGE = PINNED.find(isDashboard)
const PAGE_NAME = PAGE.split("/").pop().replace(/\.md$/, "")
const pluginsFile = `${VAULT}/.vaultite/plugins.json`
const pluginsWas = (() => { try { return readFileSync(pluginsFile, "utf8") } catch { return null } })()
/** Turn plugins off (the file the app follows live), then a fresh page load. */
async function setOff(ids) {
  writeFileSync(pluginsFile, JSON.stringify({ disabled: ids }) + "\n")
  await wait(1200)
}
async function desktop() {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = watch(await ctx.newPage())
  return { ctx, page }
}
async function phone() {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  const page = watch(await ctx.newPage(), { label: "phone" })
  return { ctx, page }
}
const tabs = (page) => page.locator("[data-tab-bar] [role=tab]").count()
const treeMenu = async (page, path) => {
  await unfold(page, path)
  await page.locator(`[data-tree-path="${path}"]`).first().click({ button: "right" }); await wait(300)
  const items = await page.locator("[role=menu] button, [role=menu] [role=menuitem]").allInnerTexts()
  await page.keyboard.press("Escape")
  return items.join("|")
}
const palette = async (page, q) => {
  await page.keyboard.press("ControlOrMeta+p"); await wait(300)
  await page.keyboard.type(q); await wait(300)
  const rows = await page.locator("[role=dialog] [role=option], [role=listbox] [role=option]").allInnerTexts()
  await page.keyboard.press("Escape"); await wait(200)
  return rows.join("|")
}
/** A file's folder opened in the tree, if it's folded (a page load starts with folders folded). */
async function unfold(page, path) {
  const folder = path.split("/").slice(0, -1).join("/")
  if (folder && (await page.locator(`[role=tree] li:has(div[data-tree-path="${folder}"]):not(:has(li div[data-tree-path="${folder}"]))`).first().getAttribute("aria-expanded")) !== "true") {
    await page.locator(`div[data-tree-path="${folder}"] button`).first().click(); await wait(300)
  }
}
/** Open a file from the tree (its folder opened first, if it's folded). */
async function fromTree(page, path) {
  await unfold(page, path)
  await page.locator(`div[data-tree-path="${path}"] button`).first().click(); await wait(800)
}
/** A new device joins the first workspace in use (its tabs): with none, it's a first visit. */
const noWorkspaces = async () => { for (const n of [1, 2, 3, 4, 5]) await fetch(`${B}api/workspaces/${n}`, { method: "DELETE" }) }
const isGrid = (page) => page.locator("article.file-view .\\@container .grid").count()
const editors = (page) => page.locator("article.file-view .cm-editor").count()

// ---------- both on ----------
await setOff([])
{
  const { ctx, page } = await desktop()
  await page.goto(`${B}${hash(TODAY)}`); await wait(1500)
  check("on: a dashboard is a grid of cards", (await isGrid(page)) > 0 && !(await editors(page)), await isGrid(page))
  check("on: its header is the page's name", (await page.locator("article.file-view h1").first().innerText()).trim() === "Today")
  await page.screenshot({ path: `${OUT}on-today.png` })
  // A file opened from the dashboard (the tree) opens beside it.
  const n0 = await tabs(page)
  await fromTree(page, OTHER)
  check("on: a file opened from a dashboard opens beside it", (await tabs(page)) === n0 + 1, [n0, await tabs(page)])
  // A pinned note isn't a page: a file opened from it takes its place.
  await page.locator("nav[aria-label=Pages] a", { hasText: NOTE_NAME }).click(); await wait(800)
  const n1 = await tabs(page)
  await fromTree(page, ANOTHER)
  check("on: a file opened from a pinned note takes its place", (await tabs(page)) === n1 && decodeURIComponent(await page.evaluate(() => location.hash)).includes(ANOTHER), [n1, await tabs(page)])
  check("on: the tree's menu has Pin", /(^|\|)Pin(\||$)/.test(await treeMenu(page, OTHER)), await treeMenu(page, OTHER))
  check("on: the tree's menu has Unpin for a pinned file", /(^|\|)Unpin(\||$)/.test(await treeMenu(page, NOTE)), await treeMenu(page, NOTE))
  const cmds = await palette(page, "pin current")
  check("on: the palette has Pin current file", /Pin current file/.test(cmds), cmds)
  const opens = await palette(page, `open ${PAGE_NAME.toLowerCase()}`)
  check("on: the palette opens a pinned page", opens.includes(`Open ${PAGE_NAME}`), opens)
  await page.keyboard.press("ControlOrMeta+o"); await wait(300); await page.keyboard.type(PAGE_NAME.toLowerCase()); await wait(400)
  const found = await page.locator("[role=option]").allInnerTexts()
  check("on: search finds the pinned page as a page", found.some((t) => t.includes(PAGE_NAME) && /Page/.test(t)), found)
  await page.keyboard.press("Escape")
  const settings = await palette(page, "pinned settings")
  check("on: the palette opens Pinned's settings", /Pinned settings/.test(settings), settings)
  await ctx.close()
  await noWorkspaces()
  const fresh = await desktop()
  await fresh.page.goto(B); await wait(1800)
  check("on: a new device starts on the first pinned page", decodeURIComponent(await fresh.page.evaluate(() => location.hash)) === `#file/${PINNED[0]}`, await fresh.page.evaluate(() => location.hash))
  await fresh.ctx.close()
  await noWorkspaces()
  const { ctx: pc, page: m } = await phone()
  await m.goto(B); await wait(1500)
  await m.locator("[data-bar=new]").tap(); await wait(500)
  check("on, phone: a new tab shows the pinned pages as tiles", (await m.locator("[data-new-tab-pages] a").count()) >= 2)
  await m.screenshot({ path: `${OUT}on-phone-new-tab.png`, fullPage: true })
  await pc.close()
}

// ---------- Pinned off ----------
await setOff(["pages"])
{
  const { ctx, page } = await desktop()
  await page.goto(`${B}${hash(TODAY)}`); await wait(1500)
  check("pinned off: no pinned pages in the sidebar", !(await page.locator("nav[aria-label=Pages]").count()))
  check("pinned off: a dashboard is still a page", (await isGrid(page)) > 0)
  check("pinned off: no Pin in the tree's menu", !/(^|\|)Pin(\||$)/.test(await treeMenu(page, OTHER)), await treeMenu(page, OTHER))
  const cmds = await palette(page, "pin current")
  check("pinned off: no Pin in the palette", !/Pin current file/.test(cmds), cmds)
  await page.screenshot({ path: `${OUT}pinned-off-today.png` })
  const settings = await palette(page, "pinned settings")
  check("pinned off: no Pinned settings in the palette", !/Pinned settings/.test(settings), settings)
  await ctx.close()
  await noWorkspaces()
  const fresh = await desktop()
  await fresh.page.goto(B); await wait(1800)
  check("pinned off: a new device starts on a new tab", (await fresh.page.evaluate(() => location.hash)) === "#new", await fresh.page.evaluate(() => location.hash))
  await fresh.page.screenshot({ path: `${OUT}pinned-off-first.png` })
  await fresh.ctx.close()
  await noWorkspaces()
  const { ctx: pc, page: m } = await phone()
  await m.goto(B); await wait(1500)
  check("pinned off, phone: starts on a new tab", (await m.evaluate(() => location.hash)) === "#new", await m.evaluate(() => location.hash))
  check("pinned off, phone: no tiles on a new tab", !(await m.locator("[data-new-tab-pages]").count()))
  await m.screenshot({ path: `${OUT}pinned-off-phone.png`, fullPage: true })
  await m.locator("[data-phone-header] button[aria-label='Open sidebar']").tap(); await wait(500)
  check("pinned off, phone: no pinned pages in the drawer", !(await m.locator("[data-phone-drawer=left] nav[aria-label=Pages]").count()))
  await m.screenshot({ path: `${OUT}pinned-off-drawer.png` })
  await pc.close()
}

// ---------- Dashboards off ----------
await setOff(["dashboards"])
{
  const { ctx, page } = await desktop()
  await page.goto(`${B}${hash(TODAY)}`); await wait(1800)
  check("dashboards off: a dashboard is a Markdown file (the editor draws it)", !(await isGrid(page)) && (await editors(page)) > 0, [await isGrid(page), await editors(page)])
  check("dashboards off: its blocks are drawn one under another", (await page.locator("article.file-view .cm-editor .cm-island, article.file-view .cm-editor [data-block]").count()) > 0)
  check("dashboards off: a pinned dashboard is still pinned", (await page.locator("nav[aria-label=Pages] a", { hasText: PAGE_NAME }).count()) === 1)
  await page.screenshot({ path: `${OUT}dashboards-off-today.png` })
  const n0 = await tabs(page)
  await fromTree(page, OTHER)
  check("dashboards off: a file opened from a dashboard takes its place", (await tabs(page)) === n0, [n0, await tabs(page)])
  await ctx.close()
  const { ctx: pc, page: m } = await phone()
  await m.goto(`${B}${hash(TODAY)}`); await wait(1500)
  check("dashboards off, phone: a dashboard opens as a file", (await m.locator("article.file-view .cm-editor").count()) > 0)
  await m.screenshot({ path: `${OUT}dashboards-off-phone.png`, fullPage: true })
  await pc.close()
  const md = await (await fetch(`${B}api/render?path=${encodeURIComponent(TODAY)}`)).text()
  check("dashboards off: /api/render has no subtitle under the title", /\n# Today\n\n(?!\w+day, )/.test(md), md.slice(0, 160))
}

// ---------- both off ----------
await setOff(["dashboards", "pages"])
{
  const { ctx, page } = await desktop()
  await page.goto(B); await wait(1500)
  await page.goto(`${B}${hash(TODAY)}`); await wait(1500)
  check("both off: a dashboard opens as a file", (await editors(page)) > 0)
  await page.screenshot({ path: `${OUT}both-off.png` })
  await ctx.close()
  const { ctx: pc, page: m } = await phone()
  await m.goto(B); await wait(1500)
  await m.goto(`${B}${hash(TODAY)}`); await wait(1500)
  await m.screenshot({ path: `${OUT}both-off-phone.png`, fullPage: true })
  await pc.close()
}

if (pluginsWas === null) writeFileSync(pluginsFile, "{}\n"); else writeFileSync(pluginsFile, pluginsWas)
rmSync(`${VAULT}/Qa page plugins`, { recursive: true, force: true })
const md = await (await fetch(`${B}api/render?path=${encodeURIComponent(TODAY)}`)).text()
check("on again: /api/render has the subtitle under the title", /\n# Today\n\n\w+day, /.test(md), md.slice(0, 160))
await done()
