// Images in a note (live preview): each on its line's first row beside its number, no empty rows around it; its corner
// drags a width written as `|<n>`; its menu (right-click, a finger held on a phone) resets the size and removes the embed; the
// Markdown button shows `![[...]]` with the image kept under it. WRITES a "Qa images" folder: throwaway server only.
//   node web/qa/images.mjs <base url> <vault path> [out dir]
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { apiAt, qa, wait } from "./lib/qa.mjs"
const { args: [B, VAULT, OUT = "/tmp/images-shots/"], browser, check, watch, done } = await qa(import.meta.url)
mkdirSync(OUT, { recursive: true })
const DIR = "Qa images", NOTE = `${VAULT}/${DIR}/Pictures.md`
rmSync(`${VAULT}/${DIR}`, { recursive: true, force: true })
mkdirSync(`${VAULT}/${DIR}`, { recursive: true })
copyFileSync(fileURLToPath(new URL("../public/icon-512.png", import.meta.url)), `${VAULT}/${DIR}/Qa pic.png`)
const body = "---\norigin: ai\n---\n\nBefore.\n\n![[Qa pic.png]]\n\nAfter.\n\nInline ![[Qa pic.png|120]] text.\n\n![alt](Qa%20pic.png)\n"
writeFileSync(NOTE, body)
const api = apiAt(B)
const saved = await api("GET", "config/appearance")
await api("PUT", "config/appearance", { ...saved, lineNumbers: true })
const text = () => readFileSync(NOTE, "utf8")
const waitText = async (want) => { for (let i = 0; i < 30 && !want(text()); i++) await wait(100); return text() }
try {
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 }, colorScheme: "dark" })
  await ctx.addInitScript(() => { localStorage.setItem("vaultite.editMode", "live") })
  const page = watch(await ctx.newPage())
  await page.goto(`${B}#file/${encodeURIComponent(`${DIR}/Pictures.md`)}`)
  await page.waitForSelector(".vau-editor .cm-image-wrap img", { timeout: 10000 })
  await page.waitForFunction(() => [...document.querySelectorAll(".cm-image")].every((i) => i.complete && i.naturalWidth))
  await wait(500)
  // The picture's line: its number beside the picture's top, the line no taller than the picture and its margins.
  const geo = await page.evaluate(() => {
    const line = document.querySelector(".cm-image-wrap").closest(".cm-line"), img = line.querySelector(".cm-image")
    const l = line.getBoundingClientRect(), i = img.getBoundingClientRect()
    const num = [...document.querySelectorAll(".cm-lineNumbers .cm-gutterElement")].find((e) => e.textContent === "3").getBoundingClientRect()
    return { lineH: l.height, imgH: i.height, imgTop: i.top - l.top, numTop: num.top - l.top }
  })
  check("image on its line's first row (no empty row above or below)", geo.imgTop < 8 && geo.lineH - geo.imgH < 12, geo)
  check("its number beside the image's top", geo.numTop >= -2 && geo.numTop < 30, geo)
  await page.screenshot({ path: `${OUT}images.png` })

  // Its corner drags its width.
  const wrap = page.locator(".cm-image-wrap").first()
  await wrap.hover()
  const g = await page.locator(".cm-image-resize").first().boundingBox()
  await page.mouse.move(g.x + 6, g.y + 6); await page.mouse.down()
  await page.mouse.move(g.x - 200, g.y + 6, { steps: 6 }); await page.mouse.up()
  check("dragging its corner writes |width", /!\[\[Qa pic\.png\|\d+\]\]/.test(await waitText((t) => /Qa pic\.png\|\d+\]\]\n\nAfter/.test(t))), text().slice(0, 200))

  // Its menu: reset size, then remove the inline one.
  await page.locator(".cm-image-wrap").first().click({ button: "right" })
  const items = await page.locator("[role=menu] [role=menuitem]").allTextContents()
  check("menu has the image's items", ["Copy image", "Reset size", "Remove embed", "Open in new tab", "Copy path", "Delete image"].every((x) => items.some((i) => i.includes(x))), items)
  await page.getByRole("menuitem", { name: "Reset size" }).click()
  check("Reset size takes |width out", (await waitText((t) => t.includes("\n![[Qa pic.png]]\n"))).includes("\n![[Qa pic.png]]\n"), text().slice(0, 200))
  await page.locator(".cm-image-wrap").nth(1).click({ button: "right" })
  await page.getByRole("menuitem", { name: "Remove embed" }).click()
  check("Remove embed takes the embed out", (await waitText((t) => t.includes("Inline text."))).includes("Inline text."), text())

  // The Markdown button: the source shows, the image stays under it.
  await page.locator(".cm-image-wrap").first().hover()
  await page.locator(".cm-image-tools button[aria-label='Show Markdown']").first().click()
  await wait(300)
  const src = await page.evaluate(() => { const l = document.querySelector(".cm-image-wrap.is-source")?.closest(".cm-line"); return l && { raw: l.querySelector(".cm-wikilink-raw")?.textContent, img: !!l.querySelector(".cm-image") } })
  check("Show Markdown: its source with the image under it", src?.raw === "![[Qa pic.png]]" && src.img, src)
  await page.screenshot({ path: `${OUT}images-source.png` })
  await ctx.close()

  // A phone: a finger held on it opens the same menu.
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, colorScheme: "dark" })
  const p = await phone.newPage()
  await p.goto(`${B}#view/files/file/${encodeURIComponent(`${DIR}/Pictures.md`)}`)
  await p.waitForSelector(".vau-editor .cm-image-wrap", { timeout: 10000 })
  await wait(600)
  const cdp = await phone.newCDPSession(p)
  const b = await p.locator(".cm-image-wrap").first().boundingBox()
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: b.x + b.width / 2, y: b.y + b.height / 2 }] })
  await wait(700)
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] })
  await wait(300)
  check("phone: holding it opens its menu", await p.getByRole("menuitem", { name: "Copy image" }).count() === 1)
  await p.screenshot({ path: `${OUT}images-phone.png` })
  await phone.close()
} finally {
  await browser.close()
  await api("PUT", "config/appearance", saved)
  rmSync(`${VAULT}/${DIR}`, { recursive: true, force: true })
}
await done()
