// Add photo (the editing plugin): the system's picker (an image input, several at once) from the palette, Insert ▸
// Photo in the editor's menu and /photo; each image saved in Attachments/ and embedded at the cursor on a line of its
// own, the iPhone camera's "image.jpg" named "Pasted image <YYYYMMDDHHmmss>.jpg", nothing on cancel. On a phone it's at
// the top of the note's … menu and lands at the note's end while reading. Files are set on the input as Playwright's file chooser.
// WRITES a "Qa photo" folder and images in Attachments/: throwaway only.
//   node web/qa/photo.mjs <base url> [out dir]
import { mkdirSync } from "node:fs"
import { palette, qa, until, wait } from "./lib/qa.mjs"
const { args: [B, OUT = "/tmp/photo-shots/"], browser, check, watch, done } = await qa(import.meta.url)
mkdirSync(OUT, { recursive: true })
const json = { "Content-Type": "application/json" }
const enc = encodeURIComponent
const put = (path, text) => fetch(`${B}api/file`, { method: "PUT", headers: { ...json, "X-Vaultite-Client": "app/qa" }, body: JSON.stringify({ path, text }) })
const read = async (path) => (await (await fetch(`${B}api/file?path=${enc(path)}`)).json()).text
const others = async () => (await (await fetch(`${B}api/files`)).json()).others.map((o) => o.path)
const del = (path) => fetch(`${B}api/file?path=${enc(path)}`, { method: "DELETE" })
const DESK = "Qa photo/Desk.md", PHONE = "Qa photo/Phone.md"
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64")
const img = (name, mimeType = "image/png") => ({ name, mimeType, buffer: PNG })

for (const p of [DESK, PHONE]) await del(p)
for (const p of await others()) if (/^Attachments\/(qa-photo|Pasted image \d)/.test(p)) await del(p)
await put(DESK, "Before.\n\nAfter.\n")
await put(PHONE, "A note read on a phone.\n")

const open = async (opts) => watch(await (await browser.newContext({ deviceScaleFactor: 1, ...opts })).newPage())
/** The picker `act` opens, given `files`; what it asked for. */
async function choose(page, act, files) {
  const [chooser] = await Promise.all([page.waitForEvent("filechooser", { timeout: 5000 }), act()])
  const accept = await chooser.element().getAttribute("accept")
  const multiple = chooser.isMultiple()
  await chooser.setFiles(files)
  return { accept, multiple }
}
const inputsLeft = (page) => page.locator("input[type=file]").count()
const editLine = (page, text) => page.locator(".vau-editor .cm-line", { hasText: text }).first()

// ---------- desktop ----------
let page = await open({ viewport: { width: 1280, height: 860 } })
await page.goto(`${B}#file/${enc(DESK)}`); await wait(1500)
await palette(page, "Switch to live preview", 0); await wait(400)
if (await page.getByText("No command matches").count()) { await page.keyboard.press("Escape"); await wait(300) }

await editLine(page, "Before.").click(); await page.keyboard.press("End"); await wait(150)
const asked = await choose(page, () => palette(page, "Add photo", 0), [img("qa-photo-one.png")])
check("Add photo (palette): an image picker, several at once", asked.accept === "image/*" && asked.multiple, asked)
check("embedded at the cursor, on a line of its own", await until(async () => (await read(DESK)).startsWith("Before.\n![[qa-photo-one.png]]\n\nAfter."), 6000), await read(DESK))
check("saved in Attachments/", (await others()).includes("Attachments/qa-photo-one.png"))
check("the picker's input is gone once used", await until(async () => (await inputsLeft(page)) === 0, 6000))

await editLine(page, "After.").click(); await page.keyboard.press("End"); await wait(150)
await choose(page, async () => {
  await editLine(page, "After.").click({ button: "right" }); await wait(250)
  await page.getByRole("menuitem", { name: "Insert" }).click(); await wait(200)
  await page.getByRole("menuitem", { name: "Photo" }).click()
}, [img("image.jpg", "image/jpeg")])
const named = await until(async () => /After\.\n!\[\[(Pasted image \d{14}\.jpg)\]\]\n/.exec(await read(DESK)), 6000)
check("Insert ▸ Photo: the camera's image.jpg is named Pasted image <YYYYMMDDHHmmss>.jpg", !!named, await read(DESK))
if (named) check("  and saved under that name", (await others()).includes(`Attachments/${named[1]}`))
await page.screenshot({ path: `${OUT}photo-desktop.png` })

await put(DESK, "Slash here:\n"); await wait(1200)
await editLine(page, "Slash here:").click(); await page.keyboard.press("End"); await page.keyboard.press("Enter")
await page.keyboard.type("/photo"); await wait(500)
check("/photo is in the slash menu", await page.locator(".cm-tooltip-autocomplete li", { hasText: "Photo" }).count() > 0)
await choose(page, () => page.keyboard.press("Enter"), [img("qa-photo-a.png"), img("qa-photo-b.png")])
check("/photo: two photos, one embed per line", await until(async () => (await read(DESK)).includes("Slash here:\n![[qa-photo-a.png]]\n![[qa-photo-b.png]]"), 6000), await read(DESK))

const before = await read(DESK)
await choose(page, () => palette(page, "Add photo", 0), [])
await wait(800)
check("cancelled: the note is unchanged", await read(DESK) === before)
check("  and the input is gone", await until(async () => (await inputsLeft(page)) === 0, 6000))
await page.context().close()

// ---------- phone ----------
page = await open({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
await page.goto(`${B}#file/${enc(PHONE)}`); await wait(1800)
await page.locator("header").getByRole("button", { name: "More" }).first().click(); await wait(400)
const top = await page.locator("[role=menu]").first().locator(":scope > [role=menuitem]").allTextContents()
check("phone: Add photo at the top of the note's … menu", top.some((t) => t.trim() === "Add photo"), top)
await page.screenshot({ path: `${OUT}photo-phone-menu.png` })
await choose(page, () => page.getByRole("menuitem", { name: "Add photo" }).click(), [img("image.jpg", "image/jpeg")])
check("  reading: the photo goes at the note's end", await until(async () => /^A note read on a phone\.\n!\[\[Pasted image \d{14}[^\]]*\.jpg\]\]\n$/.test(await read(PHONE)), 6000), await read(PHONE))
await wait(800)
await page.screenshot({ path: `${OUT}photo-phone-note.png` })
await page.context().close()
await done()
