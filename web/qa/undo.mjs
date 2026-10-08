// Undo around a note's text (FileView's editAround, the editor's history): a property removed with its ×, its value
// changed, its key renamed, one added, a header chip's label and a palette command on the open file each come back
// with ⌘Z (the keyboard beside the text, not in it) and go again with ⇧⌘Z, in one history with the typing; the file on
// disk follows. ⌘Z in a property's field stays the field's own. Screenshots desktop and 390px. WRITES a
// "Qa undo" folder: throwaway server only.
//   node web/qa/undo.mjs <base url> [out dir]
import { mkdirSync } from "node:fs"
import { qa, until, wait } from "./lib/qa.mjs"
const { args: [BASE, OUT = "/tmp/undo-shots/"], browser, check, watch, done } = await qa(import.meta.url)
const B = BASE.replace(/\/+$/, "")
mkdirSync(OUT, { recursive: true })
const json = { "Content-Type": "application/json", "X-Vaultite-Client": "app/desktop" }
const NOTE = "Qa undo/Seed list.md"
const write = (path, text) => fetch(`${B}/api/file`, { method: "PUT", headers: json, body: JSON.stringify({ path, text, base: null }) })
const read = async (path) => (await (await fetch(`${B}/api/file?path=${encodeURIComponent(path)}`)).json()).text
const START = "---\nstatus: draft\nrating: 3\ntags: [Garden]\norigin: human\n---\n\nTomatoes and basil.\n"
await write(NOTE, START)

try {
  for (const [w, h] of [[1280, 860], [390, 844]]) {
    const phone = w < 500
    const tag = phone ? "phone: " : ""
    await write(NOTE, START)
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, ...(phone ? { isMobile: true, hasTouch: true } : {}) })
    const page = watch(await ctx.newPage())
    const view = page.locator(`.file-view[data-path="${NOTE}"]:visible`)
    const props = view.locator("[aria-label=Properties]")
    const keys = () => props.locator("[role=rowheader] input").evaluateAll((els) => els.map((e) => e.value))
    const disk = (re) => until(async () => re.test(await read(NOTE)), 4000)
    // The keyboard beside the text: nothing focused (what a removed row's × leaves).
    const away = () => page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur())
    const undo = async () => { await away(); await page.keyboard.press("ControlOrMeta+z"); await wait(300) }
    const redo = async () => { await away(); await page.keyboard.press("ControlOrMeta+Shift+z"); await wait(300) }
    const palette = async (name) => {
      await page.keyboard.press("ControlOrMeta+p"); await wait(300); await page.keyboard.type(name); await wait(300)
      const none = await page.getByText("No command matches").count()
      await page.keyboard.press(none ? "Escape" : "Enter"); await wait(600)
    }

    await page.goto(`${B}/#file/${encodeURIComponent(NOTE)}`)
    await view.waitFor({ timeout: 15000 }); await wait(1200)
    await palette("Switch to live preview")
    await until(() => props.count())
    if (!(await props.locator("[role=table]").count())) await props.getByRole("button", { name: /Properties/ }).click()
    await until(() => props.locator("[role=table]").count())

    // Removed with its ×: ⌘Z brings it back, ⇧⌘Z takes it again.
    await props.locator("[role=row]").filter({ has: page.locator("input[value=status]") }).hover()
    await props.getByRole("button", { name: "Remove status" }).click()
    check(`${tag}a property removed with its ×`, !(await keys()).includes("status") && await disk(/^(?![\s\S]*status:)/), await keys())
    await undo()
    check(`${tag}⌘Z brings it back, in its place`, (await keys())[0] === "status" && await disk(/^---\nstatus: draft\n/), await keys())
    await page.screenshot({ path: `${OUT}${phone ? "phone" : "desktop"}-undone.png` })
    await redo()
    check(`${tag}⇧⌘Z removes it again`, !(await keys()).includes("status") && await disk(/^(?![\s\S]*status:)/), await keys())
    await undo()
    check(`${tag}⌘Z again: back`, (await keys()).includes("status") && await disk(/status: draft/), await keys())

    // A value changed, a key renamed, one added: each one step.
    const value = props.locator("[role=row]").filter({ has: page.locator("input[value=rating]") }).locator("[role=cell] input")
    await value.fill("5"); await value.press("Enter"); await wait(200)
    check(`${tag}a value changed`, await disk(/rating: 5/), await read(NOTE))
    await page.keyboard.press("ControlOrMeta+z"); await wait(300)
    check(`${tag}⌘Z right after Enter (the field let go): the value back`, await disk(/rating: 3/), await read(NOTE))
    const key = props.locator("[role=rowheader] input").first()
    await key.fill("stage"); await key.press("Enter"); await wait(200)
    check(`${tag}a key renamed`, await disk(/stage: draft/), await read(NOTE))
    await undo()
    check(`${tag}⌘Z: the old key`, await disk(/status: draft/) && (await keys()).includes("status"), await keys())
    await props.getByRole("button", { name: "Add property" }).click()
    await page.keyboard.type("mood"); await page.keyboard.press("Enter"); await wait(200)
    await page.keyboard.type("calm"); await page.keyboard.press("Enter"); await wait(200)
    check(`${tag}a property added, with its value`, await disk(/mood: calm/), await read(NOTE))
    await undo()
    check(`${tag}⌘Z: its value goes`, await disk(/mood: *(''|"")?\n/), await read(NOTE))
    await undo()
    check(`${tag}⌘Z: the property goes`, await disk(/^(?![\s\S]*mood)/), await read(NOTE))

    // ⌘Z in a field is the field's own: typing undone there, the file unchanged.
    await value.click(); await value.press("End"); await page.keyboard.type("9"); await wait(100)
    await page.keyboard.press("ControlOrMeta+z"); await wait(200)
    check(`${tag}⌘Z inside a field undoes its typing only`, await value.inputValue() === "3" && /rating: 3/.test(await read(NOTE)), await value.inputValue())
    await page.keyboard.press("Escape"); await wait(100)

    // One history with the text: typed, then a property removed; ⌘Z takes them back in turn.
    await view.locator(".cm-line", { hasText: "Tomatoes" }).click(); await page.keyboard.press("End"); await page.keyboard.type(" Peppers."); await wait(800)
    await props.locator("[role=row]").filter({ has: page.locator("input[value=tags]") }).hover()
    await props.getByRole("button", { name: "Remove tags" }).click()
    check(`${tag}typed, then a property removed`, await disk(/Peppers\./) && await disk(/^(?![\s\S]*tags:)/), await read(NOTE))
    await undo()
    check(`${tag}⌘Z: the property first, the typing kept`, await disk(/tags: \[Garden\]/) && /Peppers\./.test(await read(NOTE)), await read(NOTE))
    await undo()
    check(`${tag}⌘Z again: the typing`, await disk(/^(?![\s\S]*Peppers)/) && /tags: \[Garden\]/.test(await read(NOTE)), await read(NOTE))

    // A command on the open file (Provenance's label) and a change from disk meanwhile: ⌘Z undoes only its own.
    await palette("Label as written by AI")
    check(`${tag}a palette command labels the open file`, await disk(/origin: ai/), await read(NOTE))
    const now = await read(NOTE)
    await fetch(`${B}/api/file`, { method: "PUT", headers: json, body: JSON.stringify({ path: NOTE, text: now.replace("Tomatoes", "Ripe tomatoes"), base: now }) })
    await until(() => view.locator(".cm-line", { hasText: "Ripe tomatoes" }).count())
    await undo()
    check(`${tag}⌘Z: the label back, the change from disk kept`, await disk(/origin: human/) && /Ripe tomatoes/.test(await read(NOTE)), await read(NOTE))
    await page.screenshot({ path: `${OUT}${phone ? "phone" : "desktop"}-end.png` })

    // The cursor far down a long note, the properties read at the top: ⌘Z shows them, not the cursor's line.
    if (!phone) {
      const long = (await read(NOTE)) + Array.from({ length: 120 }, (_, i) => `\nLine ${i}.\n`).join("")
      await fetch(`${B}/api/file`, { method: "PUT", headers: json, body: JSON.stringify({ path: NOTE, text: long, base: await read(NOTE) }) })
      await until(() => view.locator(".cm-line", { hasText: "Line 0." }).count())
      await view.locator(".cm-line", { hasText: "Line 0." }).click(); await page.keyboard.press("ControlOrMeta+ArrowDown"); await wait(300)
      await page.evaluate(() => { document.getElementById("main-scroll").scrollTop = 0 }); await wait(300)
      await props.locator("[role=row]").filter({ has: page.locator("input[value=rating]") }).hover()
      await props.getByRole("button", { name: "Remove rating" }).click(); await wait(200)
      await undo(); await wait(300)
      const top = await props.evaluate((el) => el.getBoundingClientRect().top)
      check("⌘Z with the cursor far down: the properties stay in sight", top > 0 && top < 400 && await disk(/rating: 3/), top)

    }
    // A note in a sheet (a phone's file opened over a view; a keyboard on an iPad): the same.
    if (phone) {
      await write(NOTE, START)
      await page.goto(`${B}/#view/files/file/${encodeURIComponent(NOTE)}`); await wait(1500)
      const sheet = page.locator(`dialog[open] .file-view[data-path="${NOTE}"]`)
      await sheet.waitFor({ timeout: 10000 })
      const sp = sheet.locator("[aria-label=Properties]")
      if (!(await sp.locator("[role=table]").count())) await sp.getByRole("button", { name: /Properties/ }).click()
      await sp.locator("[role=row]").filter({ has: page.locator("input[value=status]") }).hover()
      await sp.getByRole("button", { name: "Remove status" }).click()
      await disk(/^(?![\s\S]*status:)/)
      await page.keyboard.press("ControlOrMeta+z"); await wait(300)
      check("in a sheet: ⌘Z brings a removed property back", await disk(/status: draft/) && await sheet.count() === 1, await read(NOTE))
    }
    await ctx.close()
  }
} finally {
  await browser.close()
  await fetch(`${B}/api/file?path=${encodeURIComponent("Qa undo")}`, { method: "DELETE" }).catch(() => {})
}
console.log(`\nshots in ${OUT}`)
await done()
