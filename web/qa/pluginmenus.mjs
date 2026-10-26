// A plugin's file menu items (the made-up vault plugin Qa stamp) show wherever that file's menu does, a phone's held
// finger too. Writes Qa plugin menus/ and .vaultite/plugins/qa-stamp, turned on: throwaway server only.
//   node web/qa/pluginmenus.mjs <base url> <vault path> [out dir]
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import { crc32, deflateSync } from "node:zlib"
import { SHOTS, qa, until, wait } from "./lib/qa.mjs"
const { args: [B, VAULT, OUT = SHOTS], browser, check, watch, done } = await qa(import.meta.url)
const DIR = "Qa plugin menus", PIC = `${DIR}/Qa pic.png`, enc = encodeURIComponent
const abs = (p) => `${VAULT}/${p}`
const write = (p, t) => { mkdirSync(dirname(abs(p)), { recursive: true }); writeFileSync(abs(p), t) }
const plugins = () => { try { return JSON.parse(readFileSync(abs(".vaultite/plugins.json"), "utf8")) } catch { return {} } }

/** A 160×100 PNG of one colour. */
function png(w = 160, h = 100) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type), data])))
    return Buffer.concat([len, Buffer.from(type), data, crc])
  }
  const head = Buffer.alloc(13); head.writeUInt32BE(w, 0); head.writeUInt32BE(h, 4); head[8] = 8; head[9] = 2
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3, Buffer.from([90, 140, 220]))])
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", head), chunk("IDAT", deflateSync(Buffer.concat(Array(h).fill(row)))), chunk("IEND", Buffer.alloc(0))])
}

rmSync(abs(DIR), { recursive: true, force: true })
write(PIC, png())
write(`${DIR}/Qa inner.md`, "---\norigin: ai\n---\n\nInner text.\n\n![[Qa pic.png]]\n")
write(`${DIR}/Embeds.md`, "---\norigin: ai\n---\n\nTop line.\n\n![[Qa pic.png]]\n\n![[Qa inner]]\n\nBottom line.\n")
write(`${DIR}/Board.canvas`, JSON.stringify({ nodes: [{ id: "p1", type: "file", file: PIC, x: 0, y: 0, width: 320, height: 200 }], edges: [] }, null, "\t"))
write(`${DIR}/Results.base`, `filters:\n  and:\n    - file.inFolder("${DIR}")\nviews:\n  - type: table\n    name: All\n`)
write(".vaultite/plugins/qa-stamp/manifest.json", JSON.stringify({ id: "qa-stamp", category: "other", name: "Qa stamp", icon: "stamp", description: "A made-up vault plugin with file menu items.", version: "1.0.0", author: "Alice Park", disclosures: {}, apiVersion: 1 }, null, 2))
write(".vaultite/plugins/qa-stamp/index.tsx", `import { definePlugin, notify } from "@vaultite"
import { Stamp } from "lucide-react"
export default definePlugin({
  fileMenu: (path) => [
    { label: "Stamp it", icon: Stamp, section: "stamp", run: () => notify(\`Stamped \${path}\`) },
    ...(/\\.png$/i.test(path) ? [{ label: "Use as stamp", section: "more", run: () => notify(\`Stamp from \${path}\`) }] : []),
  ],
})
`)

try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await ctx.addInitScript(() => { try { localStorage.setItem("vaultite.editMode", "live") } catch { /* not the app's frame */ } })
  const page = watch(await ctx.newPage())
  const items = () => page.locator("[role=menu] [role=menuitem]").allTextContents()
  const close = async () => { await page.keyboard.press("Escape"); await wait(150) }
  const menuOn = async (loc, what) => {
    await loc.click({ button: "right" })
    const got = await until(async () => { const t = await items(); return t.length && t }, 3000) || []
    await page.screenshot({ path: `${OUT}pluginmenus-${what}.png` })
    return got
  }
  const has = (got, want) => want.every((x) => got.some((i) => i.startsWith(x)))
  const show = async (hash, sel) => { await page.goto("about:blank"); await page.goto(`${B}#${hash}`); await page.waitForSelector(sel, { timeout: 15000 }); await wait(400) }

  await page.goto(`${B}#plugins`)
  const sw = page.getByRole("switch", { name: "Qa stamp plugin" })
  check("Qa stamp is listed", await until(async () => (await sw.count()) === 1, 15000))
  if ((await sw.getAttribute("aria-checked")) !== "true") await sw.click()
  check("…and on", await until(async () => (plugins().enabled ?? []).includes("qa-stamp"), 8000), plugins().enabled)
  await wait(1500)

  // The image in its own tab: the image's right-click has the plugin's items, More ▸ the image's.
  await show(`file/${enc(PIC)}`, "[data-pane] .file-view img")
  let got = await menuOn(page.locator("[data-pane] .file-view img").first(), "image-tab")
  check("image in its tab: its own items and the plugin's", has(got, ["Copy image", "Download", "Move file to…", "Stamp it", "Copy path", "Delete"]), got)
  await page.getByRole("menuitem", { name: "More" }).hover(); await wait(300)
  check("…More ▸ has the plugin's image item", has(await items(), ["Use as stamp"]), await items())
  await page.getByRole("menuitem", { name: "Use as stamp" }).click()
  check("…which runs", await until(async () => (await page.locator("[data-sonner-toast]", { hasText: `Stamp from ${PIC}` }).count()) > 0, 4000))
  // Its tab's menu: in More file actions ▸ (the tab menu's short shape).
  got = await menuOn(page.locator("[role=tab][aria-selected=true]").first(), "tab")
  await page.getByRole("menuitem", { name: "More file actions" }).hover(); await wait(300)
  check("its tab: More file actions ▸ has the plugin's item", has(await items(), ["Stamp it"]), await items())
  await close()
  // The tree's row (revealed from the image's menu).
  await menuOn(page.locator("[data-pane] .file-view img").first(), "reveal")
  await page.getByRole("menuitem", { name: "Reveal in file tree" }).click()
  const treeRow = page.locator(`aside [data-tree-path="${PIC}"]`).first()
  check("Reveal in file tree shows its row", await until(async () => (await treeRow.count()) > 0, 5000))
  got = await menuOn(treeRow, "tree")
  check("tree row: the plugin's item", has(got, ["Stamp it"]), got)
  await close()

  // An embed in a note (the editor), and an image in an embedded note's text.
  await show(`file/${enc(`${DIR}/Embeds.md`)}`, "[data-pane] .vau-editor img.cm-image")
  got = await menuOn(page.locator("[data-pane] .vau-editor img.cm-image").first(), "embed")
  check("embed: the embed's items, the file's and the plugin's", has(got, ["Copy image", "Remove embed", "Open in new tab", "Stamp it", "Delete image"]), got)
  await close()
  const nested = page.locator("[data-pane] .note-embed-body img").first()
  if (await until(async () => (await nested.count()) > 0, 5000)) {
    got = await menuOn(nested, "nested")
    check("image in an embedded note's text: its menu, the plugin's item", has(got, ["Copy image", "Stamp it"]) && !got.includes("Remove embed"), got)
    await close()
  } else check("the embedded note draws its image", false)

  // A canvas card.
  await show(`file/${enc(`${DIR}/Board.canvas`)}`, "[data-pane] [data-canvas-node='p1']")
  got = await menuOn(page.locator("[data-pane] [data-canvas-node='p1']").first(), "canvas")
  check("canvas card: the card's items, then the file's and the plugin's", has(got, ["Open in new tab", "Zoom to selection", "Stamp it", "Delete image"]), got)
  await close()

  // A base's result.
  await show(`file/${enc(`${DIR}/Results.base`)}`, "[data-pane] [data-query-row]")
  got = await menuOn(page.locator("[data-pane] [data-query-row]").first(), "base")
  check("base result: Open in new tab, the file's menu and the plugin's item", has(got, ["Open in new tab", "Copy path", "Stamp it"]), got)
  await close()

  // A new tab's recent files.
  await page.click("[aria-label='New tab']")
  const recent = page.locator("[data-pane] [data-recent]").first()
  if (await until(async () => (await recent.count()) > 0, 5000)) {
    got = await menuOn(recent, "newtab")
    check("new tab's recent file: its menu and the plugin's item", has(got, ["Open in new tab", "Stamp it"]), got)
    await close()
  } else check("a new tab lists recent files", false)
  await ctx.close()

  // A phone: a finger held on the image (its tab, its embed), and the header's … menu.
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  await phone.addInitScript(() => { try { localStorage.setItem("vaultite.editMode", "live") } catch { /* not the app's frame */ } })
  const p = watch(await phone.newPage())
  const cdp = await phone.newCDPSession(p)
  const hold = async (loc, what) => {
    const b = await loc.boundingBox()
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: b.x + b.width / 2, y: b.y + b.height / 2 }] })
    await wait(700)
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] })
    await wait(300)
    await p.screenshot({ path: `${OUT}pluginmenus-phone-${what}.png` })
    return p.locator("[role=menu] [role=menuitem]").allTextContents()
  }
  const pshow = async (hash, sel) => { await p.goto("about:blank"); await p.goto(`${B}#${hash}`); await p.waitForSelector(sel, { timeout: 15000 }); await wait(600) }
  await pshow(`file/${enc(PIC)}`, ".file-view img")
  got = await hold(p.locator(".file-view img").first(), "image")
  check("phone: a finger held on the image has the plugin's item", has(got, ["Stamp it", "Download"]), got)
  check("…and no Reveal in file tree", !got.includes("Reveal in file tree"), got)
  await p.keyboard.press("Escape"); await wait(300)
  await p.locator("button[aria-label=More]").first().click(); await wait(300)
  got = await p.locator("[role=menu] [role=menuitem]").allTextContents()
  check("phone: the header's … menu has it too", has(got, ["Stamp it"]), got)
  await p.keyboard.press("Escape"); await wait(300)
  await pshow(`file/${enc(`${DIR}/Embeds.md`)}`, ".vau-editor img.cm-image")
  got = await hold(p.locator(".vau-editor img.cm-image").first(), "embed")
  check("phone: a finger held on an embed has the plugin's item", has(got, ["Stamp it", "Remove embed"]), got)
  await phone.close()
} finally {
  await browser.close()
  rmSync(abs(DIR), { recursive: true, force: true })
  rmSync(abs(".vaultite/plugins/qa-stamp"), { recursive: true, force: true })
  const c = plugins(); if (c.enabled) { c.enabled = c.enabled.filter((x) => x !== "qa-stamp"); write(".vaultite/plugins.json", JSON.stringify(c, null, 2) + "\n") }
}
await done()
