// Recording from the palette (plugins/core/audio-recorder, Chrome's fake microphone; a fake transcriber in the server's
// data/config.json): "Start recording audio" with no note open makes a new note with the recording, labelled as the
// user's (origin: human); "Record a voice note for your inbox" shows the bar as a voice note, and Stop sends it to the
// inbox as the iPhone's widget does (Inbox's inbox.voice: from Computer, origin: human), saying so once. Screenshots
// desktop and 390px. WRITES notes, Attachments/, Inbox/ files and <local dir>/config.json (put back): throwaway only.
//   node web/qa/voicenote.mjs <base url> <vault path> <server's VAULTITE_LOCAL> [out dir]
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import os from "node:os"
import { qa, until, wait } from "./lib/qa.mjs"
const { args: [BASE, VAULT, LOCAL, OUT = "/tmp/voicenote-shots/"], browser, check, watch, done } = await qa(import.meta.url, {
  chrome: { args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] },
})
const B = BASE.replace(/\/+$/, "")
mkdirSync(OUT, { recursive: true })

// A transcriber that says what it heard (outside the vault: one in it is never run).
const fake = path.join(os.tmpdir(), "voicenote-qa-transcriber.sh")
writeFileSync(fake, '#!/bin/sh\necho "Water the tomatoes before the heat on Friday."\n', { mode: 0o755 })
const config = path.join(LOCAL, "config.json")
const configWas = existsSync(config) ? readFileSync(config, "utf8") : null
mkdirSync(LOCAL, { recursive: true })
writeFileSync(config, JSON.stringify({ ...(configWas ? JSON.parse(configWas) : {}), "audio-recorder": { command: `${fake} {file}` } }))
const inbox = () => { try { return readdirSync(path.join(VAULT, "Inbox")).filter((f) => f.startsWith("Water the tomatoes")) } catch { return [] } }
const made = []

try {
  for (const [w, h] of [[1280, 820], [390, 844]]) {
    const phone = w < 500, tag = phone ? "phone: " : ""
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, permissions: ["microphone"], ...(phone ? { isMobile: true, hasTouch: true } : {}) })
    const page = watch(await ctx.newPage())
    const palette = async (name) => {
      await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur())
      await page.keyboard.press("ControlOrMeta+p"); await wait(300); await page.keyboard.type(name); await wait(400)
      const hit = await page.locator("#palette-results [role=option]").filter({ hasText: new RegExp(`^${name}`) }).count()
      await page.keyboard.press(hit ? "Enter" : "Escape"); await wait(400)
      return !!hit
    }
    const bar = page.locator("[data-recorder]")
    await page.goto(`${B}/`)
    await page.waitForSelector(phone ? "[data-bar='new']" : "[aria-label='New tab']", { timeout: 30000 }); await wait(1500)
    if (!phone) await page.click("[aria-label='New tab']")
    else await page.click("[data-bar='new']")
    await wait(800)

    if (!phone) {
      // Recorded with no note open: a new note with it, the user's.
      check("Start recording audio is in the palette", await palette("Start recording audio"))
      await until(() => bar.getAttribute("data-recorder").then((s) => s === "recording").catch(() => false), 8000)
      check("the bar says Recording", /Recording/.test(await bar.textContent()), await bar.textContent())
      await wait(1500)
      await page.getByRole("button", { name: "Stop recording" }).click()
      const note = await until(async () => { const f = page.locator(".file-view:visible"); return (await f.count()) ? f.getAttribute("data-path") : null }, 8000)
      if (note) made.push(note)
      const text = note ? await until(() => { try { const t = readFileSync(path.join(VAULT, note), "utf8"); return /Transcript/.test(t) && t } catch { return null } }, 8000) : ""
      check("a recording with no note open: a new note, labelled as yours (origin: human)", /^origin: human$/m.test(text || "") && /!\[\[Recording /.test(text || ""), text)
      const audio = /!\[\[(Recording [^\]]+)\]\]/.exec(text || "")?.[1]
      if (audio) made.push(path.join("Attachments", audio))
      await page.click("[aria-label='New tab']"); await wait(600)
    }

    // A voice note for the inbox: the same as the phone's widget.
    check(`${tag}Record a voice note for your inbox is in the palette`, await palette("Record a voice note for your inbox"))
    await until(() => bar.getAttribute("data-recorder").then((s) => s === "recording").catch(() => false), 8000)
    check(`${tag}the bar says Voice note, with Stop and send`, /Voice note/.test(await bar.textContent()) && await page.getByRole("button", { name: "Stop and send" }).count() === 1, await bar.textContent())
    await page.screenshot({ path: `${OUT}${phone ? "phone" : "desktop"}-recording.png` })
    await wait(1500)
    const before = inbox().length
    await page.getByRole("button", { name: "Stop and send" }).click()
    const sent = await until(() => inbox().length > before && inbox(), 8000)
    const file = sent ? path.join(VAULT, "Inbox", sent.at(-1)) : ""
    const text = file ? readFileSync(file, "utf8") : ""
    check(`${tag}sent to the inbox, the user's own words (origin: human), from this computer or phone`, /^type: inbox$/m.test(text) && /^origin: human$/m.test(text) &&
      new RegExp(`^from: ${phone ? "Phone" : "Computer"}$`, "m").test(text) && /Water the tomatoes/.test(text), text)
    const toasts = await until(async () => { const t = await page.locator("[data-sonner-toast]").filter({ hasText: "In your inbox: Water the tomatoes" }).count(); return t ? t : 0 }, 4000)
    await wait(800)
    check(`${tag}said once (one toast, with Open)`, toasts === 1 && await page.locator("[data-sonner-toast]").filter({ hasText: "In your inbox: Water the tomatoes" }).count() === 1, toasts)
    await page.screenshot({ path: `${OUT}${phone ? "phone" : "desktop"}-sent.png` })
    for (const f of sent || []) rmSync(path.join(VAULT, "Inbox", f), { force: true })
    await ctx.close()
  }
} finally {
  await browser.close()
  if (configWas === null) rmSync(config, { force: true }); else writeFileSync(config, configWas)
  rmSync(fake, { force: true })
  for (const f of made) rmSync(path.join(VAULT, f), { force: true })
}
console.log(`\nshots in ${OUT}`)
await done()
