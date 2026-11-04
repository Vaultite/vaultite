// Pinned folders and files that aren't notes (plugins/core/pages): pinned, opened in place, kept open after a reload,
// revealed and unpinned. WRITES "Qa pins" and pages.json: throwaway server only.
//   node web/qa/folderpins.mjs <base url> [out dir]
import { SHOTS, apiAt, qa, until, wait } from "./lib/qa.mjs"
const { args: [B, OUT = SHOTS], browser, check, watch, done } = await qa(import.meta.url)
const api = apiAt(B, { "X-Vaultite-Client": "app/qa" })

const D = "Qa pins/Trips"
await fetch(`${B}api/file?path=${encodeURIComponent("Qa pins")}`, { method: "DELETE" })
await api("POST", "folder", { path: "Qa pins" })
await api("POST", "folder", { path: D })
await api("POST", "folder", { path: `${D}/Lisbon` })
await api("POST", "file", { path: `${D}/Packing.md`, text: "Socks.\n" })
await api("POST", "file", { path: `${D}/Lisbon/Food.md`, text: "Pasteis.\n" })
await fetch(`${B}api/upload?path=${encodeURIComponent(`${D}/Voice note.m4a`)}`, { method: "POST", body: new Uint8Array([0, 0, 0, 0]) }).catch(() => {})
const pins = async () => (await api("GET", "config/pages")).pinned ?? []

const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
await ctx.addInitScript(() => { if (!sessionStorage.getItem("qa")) { localStorage.clear(); sessionStorage.setItem("qa", "1") } })
const page = watch(await ctx.newPage(), { console: true })
await page.goto(B); await wait(1500)
const tree = page.locator("aside [role=tree][aria-label=Files]").first()
// The folder's menu in the tree: Pin.
await tree.locator(`div[data-tree-path="Qa pins"] button`).first().click(); await wait(300)
await tree.locator(`div[data-tree-path="${D}"]`).click({ button: "right" })
await page.click("[role=menu] >> text=Pin")
check("Pin from a folder's menu", await until(async () => (await pins()).includes(D)), await pins())

const row = page.locator(`aside [data-pin="${D}"]`)
check("a row in Pinned", await until(async () => (await row.count()) === 1))
check("named by its folders, dimmed, then its name", /Qa pins \/ Trips/.test(await row.innerText()) &&
  await row.locator(".text-muted-foreground", { hasText: "Qa pins /" }).count() === 1, await row.innerText())
const sub = page.locator(`aside [data-pin-tree="${D}"]`)
check("closed at first", await sub.count() === 0 && await row.getAttribute("aria-expanded") === "false")
const hashWas = await page.evaluate(() => location.hash)
await row.click()
check("a click opens it in place, going nowhere", await until(async () => (await sub.count()) === 1) && await page.evaluate(() => location.hash) === hashWas)
check("its folders first, then its files", await until(async () => (await sub.locator("[data-tree-path]").evaluateAll((els) => els.map((e) => e.dataset.treePath))).join() ===
  [`${D}/Lisbon`, `${D}/Packing.md`, `${D}/Voice note.m4a`].join()), await sub.locator("[data-tree-path]").evaluateAll((els) => els.map((e) => e.dataset.treePath)))
await sub.locator(`div[data-tree-path="${D}/Lisbon"] button`).first().click()
check("a folder in it opens", await until(async () => (await sub.locator(`[data-tree-path="${D}/Lisbon/Food.md"]`).count()) === 1))
await sub.locator(`div[data-tree-path="${D}/Packing.md"] button`).first().click()
check("a file in it opens", await until(() => page.evaluate(() => decodeURIComponent(location.hash).includes("Packing.md"))))
await page.screenshot({ path: `${OUT}/folderpins.png` })

await page.reload(); await wait(1500)
check("still open after a reload", await until(async () => (await sub.count()) === 1 && (await sub.locator(`[data-tree-path="${D}/Lisbon/Food.md"]`).count()) === 1))
await row.click()
check("a click closes it", await until(async () => (await sub.count()) === 0))

// Dragged as a tab is: onto a pane's edge it splits there, onto the tab bar it's a tab, each drawn while held.
const glide = async ([x0, y0], [x1, y1], steps = 12) => { for (let i = 1; i <= steps; i++) { await page.mouse.move(x0 + (x1 - x0) * i / steps, y0 + (y1 - y0) * i / steps); await wait(16) } }
const folderShown = () => page.locator(`[data-pane-body] [data-folder-page="${D}"]:visible`).count()
async function dragRow(to, held) {
  const r = await row.boundingBox(), from = [r.x + 30, r.y + r.height / 2]
  await page.mouse.move(...from); await page.mouse.down()
  await glide(from, [from[0] + 10, from[1] + 6], 2); await glide([from[0] + 10, from[1] + 6], to); await wait(250)
  const drawn = await held()
  await page.mouse.up(); await wait(600)
  return drawn
}
const pane = await page.locator("[data-pane-body]").first().boundingBox()
check("dragged to a pane's right edge: the split it makes is drawn", await dragRow([pane.x + pane.width - 25, pane.y + pane.height / 2],
  () => page.locator("[data-drop-zone=right]").count().then((n) => n === 1)))
check("let go: its page opens in a split there", await until(async () => (await page.locator("[data-pane-body]").count()) === 2 && (await folderShown()) === 1))
const tabs = () => page.locator("[data-tab-strip] [role=tab]").count()
const tabsWere = await tabs(), strip = await page.locator("[data-tab-strip]").first().boundingBox()
check("dragged onto the tab bar: the tabs make way for it", await dragRow([strip.x + strip.width / 2, strip.y + strip.height / 2],
  () => page.evaluate(() => !!document.querySelector("[data-tab-strip] [data-slide=incoming]"))))
check("let go: a tab of its own", await until(async () => (await tabs()) === tabsWere + 1 && (await page.locator("[role=tab][aria-selected=true]").first().innerText()).trim() === "Trips"), [tabsWere, await tabs()])
await page.screenshot({ path: `${OUT}/folderpins-dragged.png` })

// A recording pinned shows, with its extension.
await api("POST", "pins", { path: `${D}/Voice note.m4a`, pinned: true })
const media = page.locator(`aside [data-pin="${D}/Voice note.m4a"]`)
check("a pinned recording shows, named with its extension", await until(async () => (await media.count()) === 1 && /Voice note\.m4a/.test(await media.innerText())))

// Its menu: Reveal in file tree, Unpin.
await row.click({ button: "right" })
await page.click("[role=menu] >> text=Reveal in file tree")
check("Reveal in file tree opens it there", await until(async () => (await tree.locator(`div[data-tree-path="${D}/Packing.md"]`).count()) === 1))
await row.click({ button: "right" })
await page.click("[role=menu] >> text=Unpin")
check("Unpin from its menu", await until(async () => !(await pins()).includes(D)), await pins())
await api("POST", "pins", { path: `${D}/Voice note.m4a`, pinned: false })
await fetch(`${B}api/file?path=${encodeURIComponent("Qa pins")}`, { method: "DELETE" })
await done()
