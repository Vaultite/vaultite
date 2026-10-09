// Nothing typed or pasted is lost: edits a closed window didn't get saved come back (Restore), JSON saves as typed
// with a note while it doesn't parse, a paste with text puts the text in (not a picture of it), a [[link]] with
// characters a name can't have makes a note that it then finds, "/" in a link makes folders, and a rename to such a
// name is refused saying why. WRITES a "Qa safe" folder: throwaway server only.
//   node web/qa/savesafe.mjs <base url> <vault path>
import { existsSync, readFileSync, readdirSync, rmSync } from "node:fs"
import { palette, qa, until, wait } from "./lib/qa.mjs"
const { args: [B, VAULT], browser, check, watch, done } = await qa(import.meta.url)
const read = (p) => { try { return readFileSync(`${VAULT}/${p}`, "utf8") } catch { return null } }
const post = (path, text) => fetch(`${B}api/file`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path, text }) })
rmSync(`${VAULT}/Qa safe`, { recursive: true, force: true })
await wait(1500)
// (past what keepalive takes, and what localStorage holds: kept whole all the same)
const big = `---\ntype: note\n---\n\n${"A line of a long note, long enough to pass what keepalive takes.\n".repeat(60_000)}End.\n`
await post("Qa safe/Big.md", big)
await post("Qa safe/settings.json", '{\n  "a": 1\n}\n')
await post("Qa safe/Links.md", "Go to [[Qa colon: test]] and [[Qa safe/Sub/Deep note]].\n\nLinks end.\n")
await post("Qa safe/Paste.md", "Start\n")
await post("Qa safe/Rename me.md", "Hi\n")

const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } })
// (a loaded machine can take a while to draw the first file)
const open = async (page, rel) => {
  await page.goto("about:blank"); await page.goto(`${B}#file/${encodeURIComponent(rel)}`)
  await page.waitForSelector("[data-pane] .cm-content, [data-pane] h1", { timeout: 90_000 }).catch(() => {}); await wait(500)
}
const typeAtEnd = async (page, text) => {
  await page.locator("[data-pane] .cm-content").first().click()
  await page.keyboard.press("ControlOrMeta+End"); await page.keyboard.type(text)
}

// Edits whose save never got out (the server unreachable, then the window closed) come back the next time.
{
  const page = watch(await ctx.newPage(), { label: "unsaved" })
  await open(page, "Qa safe/Big.md")
  await page.route("**/api/file", (r) => (r.request().method() === "PUT" ? r.abort() : r.continue()))
  await typeAtEnd(page, " Typed offline.")
  await wait(1500)
  await page.close({ runBeforeUnload: true })
  check("unsaved: not on disk (the save never got out)", !read("Qa safe/Big.md").includes("Typed offline."))
  const again = watch(await ctx.newPage(), { label: "restore" })
  await open(again, "Qa safe/Big.md")
  const banner = again.locator("[role=alert]", { hasText: "weren't saved" })
  check("unsaved: opened again, it offers them back", await banner.count() === 1)
  await banner.locator("button", { hasText: "Restore them" }).click()
  check("unsaved: restored and saved", !!(await until(() => read("Qa safe/Big.md")?.includes("End.\n Typed offline."), 5000)), read("Qa safe/Big.md")?.slice(-60))
  await again.goto("about:blank"); await open(again, "Qa safe/Big.md")
  check("unsaved: once saved, not offered again", await again.locator("[role=alert]", { hasText: "weren't saved" }).count() === 0)
  await again.close()
}

const page = watch(await ctx.newPage(), { label: "page" })

// JSON saves as typed; while it doesn't parse, a note says so.
await open(page, "Qa safe/settings.json")
await palette(page, "Switch to source mode")
await typeAtEnd(page, "oops")
check("json: saved as typed, invalid", !!(await until(() => read("Qa safe/settings.json")?.endsWith("}\noops"), 4000)), read("Qa safe/settings.json"))
check("json: a note says it isn't valid", !!(await until(async () => (await page.locator("[role=alert]", { hasText: "Invalid JSON" }).count()) === 1, 3000)))
await palette(page, "Switch to live preview") // (the view is the device's: back to drawn links)

// A paste with text (cells from a spreadsheet: their text and a picture of them) puts the text in; a picture alone is
// saved as an attachment.
await open(page, "Qa safe/Paste.md")
await page.locator("[data-pane] .cm-content").first().click(); await page.keyboard.press("ControlOrMeta+End")
const paste = (text) => page.evaluate((text) => {
  const d = new DataTransfer()
  if (text) { d.setData("text/plain", text); d.setData("text/html", `<table><tr><td>${text}</td></tr></table>`) }
  d.items.add(new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], "image.png", { type: "image/png" }))
  document.querySelector("[data-pane] .cm-content").dispatchEvent(new ClipboardEvent("paste", { clipboardData: d, bubbles: true, cancelable: true }))
}, text)
await paste("Lamp oil\t42")
check("paste: text and a picture, the text goes in", !!(await until(() => read("Qa safe/Paste.md")?.includes("Lamp oil\t42"), 4000)), read("Qa safe/Paste.md"))
check("paste: and no picture of it", !read("Qa safe/Paste.md").includes("![["))
await paste("")
check("paste: a picture alone is attached", !!(await until(() => read("Qa safe/Paste.md")?.includes("![["), 4000)), read("Qa safe/Paste.md"))

// A link's name with a colon: the note gets a name it can have, the link's as an alias, so the next click finds it.
await open(page, "Qa safe/Links.md")
const notes = () => readdirSync(VAULT, { recursive: true }).filter((f) => /Qa colon - test/.test(f))
// (the cursor off the link's line, so the link is drawn, not its source)
const follow = async (text) => {
  const pane = page.locator("[data-pane]", { has: page.locator(".cm-line", { hasText: "Links end." }) })
  await pane.locator(".cm-line", { hasText: "Links end." }).click()
  await pane.locator(".cm-wikilink", { hasText: text }).first().click(); await wait(1800)
}
await follow("Qa colon: test")
const made = notes()
check("links: made a note it can name", made.length === 1 && /aliases: \['Qa colon: test'\]/.test(read(made[0]) ?? ""), [made, made[0] && read(made[0])])
await open(page, "Qa safe/Links.md")
await follow("Qa colon: test")
check("links: the next click opens it, no second note", notes().length === 1 && decodeURIComponent(await page.evaluate(() => location.hash)).includes(made[0]), [notes(), await page.evaluate(() => location.hash)])
await open(page, "Qa safe/Links.md")
await follow("Deep note")
check("links: \"/\" makes folders", existsSync(`${VAULT}/Qa safe/Sub/Deep note.md`), readdirSync(`${VAULT}/Qa safe`, { recursive: true }))

// A rename to a name with characters a file can't have is refused, saying which.
await open(page, "Qa safe/Rename me.md")
const title = page.locator("textarea[aria-label='File name']")
await title.fill("Rename: me"); await title.press("Enter"); await wait(1200)
check("rename: refused, saying why", existsSync(`${VAULT}/Qa safe/Rename me.md`) && await page.locator("text=A file name can't have :").count() > 0)
await title.fill("Moved/Rename me"); await title.press("Enter"); await wait(1500)
check("rename: \"/\" moves it into a folder", existsSync(`${VAULT}/Qa safe/Moved/Rename me.md`), readdirSync(`${VAULT}/Qa safe`, { recursive: true }))

await done()
