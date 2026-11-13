// The palette as a text field in the desktop app (askText, components/Chooser.tsx): Rename tab… holds the tab's
// name selected, Enter names it, spaces alone offer nothing, an empty Enter brings the automatic name back; a new
// container is named the same way. WRITES: the throwaway vault only.
//   node web/qa/asktext.mjs <vault copy>   (as root, Electron's helpers refuse to start: run as a user, sandbox off)
import { _electron } from "playwright-core"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { ROOT, qa, until, wait } from "./lib/qa.mjs"

const { args: [VAULT, OUT = "/tmp/asktext-shots/"], check, watch, done } = await qa(import.meta.url, { chrome: false })
fs.mkdirSync(OUT, { recursive: true })
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "vau-asktext-"))
const app = await _electron.launch({
  executablePath: path.join(ROOT, "node_modules/.bin/electron"), args: [ROOT, "--vault", VAULT],
  env: { ...process.env, VAULTITE_QUIET: "1", VAULTITE_USER_DATA: path.join(TMP, "userData"), VAULTITE_LOCAL: path.join(TMP, "local") },
})
try {
  const win = await app.firstWindow()
  watch(win, { console: true, fail: false })
  await win.waitForSelector("[role=tree]", { timeout: 90000 })
  await app.evaluate(({ BaseWindow }) => { const w = BaseWindow.getAllWindows()[0]; w.setBounds({ x: 0, y: 0, width: 1280, height: 800 }); w.focus() })
  await wait(1500)
  const MOD = process.platform === "darwin" ? "Meta" : "Control"
  const palette = async (name) => {
    await win.keyboard.press(`${MOD}+P`); await win.waitForSelector("[role=dialog] input:focus", { timeout: 5000 })
    await win.keyboard.type(name)
    const hit = await until(() => win.locator("[role=option]", { hasText: name }).count(), 3000)
    await win.keyboard.press(hit ? "Enter" : "Escape"); await wait(400)
    return hit > 0
  }
  const field = () => win.evaluate(() => { const i = document.querySelector("[role=dialog] input:focus"); return i ? { value: i.value, selected: i.selectionStart === 0 && i.selectionEnd === i.value.length } : null })
  const options = () => win.locator("[role=dialog] [role=option]").allInnerTexts()
  const tabName = () => win.evaluate(() => document.querySelector("[data-tab-bar] [role=tab][aria-selected=true]")?.textContent?.trim() ?? "")

  await palette("Open settings"); await wait(1200)
  const before = await tabName()
  check("Rename tab… is in the palette", await palette("Rename tab"))
  const f = await field()
  check("...the palette is a field holding the tab's name, selected", !!f && f.value.length > 0 && f.selected, f)
  await win.screenshot({ path: `${OUT}rename-field.png` })
  await win.keyboard.press("Backspace"); await win.keyboard.type("   "); await wait(300)
  check("...spaces alone offer no row", (await options()).length === 0, await options())
  await win.keyboard.press("Control+A"); await win.keyboard.type("Lighthouse notes"); await wait(300)
  const rows = await options()
  check("...typing offers Rename to it", rows.length === 1 && rows[0].includes('Rename to "Lighthouse notes"'), rows)
  await win.screenshot({ path: `${OUT}rename-typed.png` })
  await win.keyboard.press("Enter"); await wait(800)
  check("...Enter renames, the palette closed", !(await win.$("[role=dialog] input")), before)
  check("...the tab takes the name", (await tabName()).includes("Lighthouse notes"), [before, await tabName()])

  check("Rename tab… again", await palette("Rename tab"))
  await win.keyboard.type("Not this"); await win.keyboard.press("Escape"); await wait(500)
  check("...Esc leaves the name as it was", (await tabName()).includes("Lighthouse notes"), await tabName())
  check("Rename tab… once more", await palette("Rename tab"))
  await win.keyboard.press("Backspace"); await wait(200); await win.keyboard.press("Enter"); await wait(600)
  check("...an empty Enter brings the automatic name back", (await tabName()) === before, [before, await tabName()])

  await palette("Sites"); await wait(800)
  const btn = win.locator("[data-web-new-container]").first()
  const opened = (await btn.count()) > 0 && await btn.click().then(() => true, () => false)
  await wait(400)
  check("New container… asks for a name in the palette", opened && !!(await field()), await field())
  if (opened) {
    await win.keyboard.type("Research"); await wait(300)
    const r = await options()
    check("...offers New container “Research”", r.length === 1 && r[0].includes("New container “Research”"), r)
    await win.screenshot({ path: `${OUT}container-typed.png` })
    await win.keyboard.press("Enter"); await wait(800)
    check("...Enter makes it, the palette closed", !(await win.$("[role=dialog] input")))
  }
} finally {
  await app.close().catch(() => {})
  fs.rmSync(TMP, { recursive: true, force: true })
}
await done()
