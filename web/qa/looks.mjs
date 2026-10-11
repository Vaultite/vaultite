// The look end to end: Change colour scheme in the palette shows the whole app in the selected scheme as the selection
// moves (saved only on Enter, Esc goes back); a new tab draws the page newtab.json names, and Show sections on new tabs
// takes it back; a look bundle (only the look, with a picture) is listed under Looks with its picture.
// WRITES appearance.json, newtab.json and a bundle: throwaway only.
//   node web/qa/looks.mjs <base url> <vault path> [out dir]
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import { qa, until, wait } from "./lib/qa.mjs"
const { args: [B, VAULT, OUT = "/tmp/looks-shots/"], browser, check, watch, done } = await qa(import.meta.url)
mkdirSync(OUT, { recursive: true })

const conf = (name) => path.join(VAULT, `.vaultite/${name}.json`)
const keep = Object.fromEntries(["appearance", "newtab"].map((n) => [n, existsSync(conf(n)) ? readFileSync(conf(n), "utf8") : null]))
const json = (name) => { try { return JSON.parse(readFileSync(conf(name), "utf8")) } catch { return {} } }
const base = B.replace(/\/$/, "")
const MOD = process.platform === "darwin" ? "Meta" : "Control"

try {
  writeFileSync(conf("appearance"), JSON.stringify({ ...json("appearance"), scheme: "gruvbox", theme: "dark" }))
  rmSync(conf("newtab"), { force: true })
  const page = watch(await browser.newPage({ viewport: { width: 1280, height: 800 } }))
  // (a playground asks once whether Activity may write recaps: not now)
  const calm = async () => { const no = page.getByRole("button", { name: "Not now" }); if (await no.count()) await no.first().click() }
  await page.goto(`${base}/`)
  await page.waitForSelector("[aria-label='New tab']", { timeout: 30000 })
  await wait(1500)
  await calm()
  const scheme = () => page.evaluate(() => document.documentElement.dataset.scheme ?? "default")
  const command = async (name) => {
    await page.keyboard.press(`${MOD}+P`)
    await page.waitForSelector("[role=dialog] input, [role=combobox]", { timeout: 5000 })
    await page.keyboard.type(name)
    await wait(300)
    await page.keyboard.press("Enter")
    await wait(400)
  }

  // The scheme picker: moving previews, Esc goes back, Enter saves.
  await command("Change colour scheme")
  check("the picker lists every scheme, the one in use checked", await until(async () => (await page.locator("[role=option]").count()) >= 16))
  await page.keyboard.press("ArrowDown")
  const shown = await until(async () => { const s = await scheme(); return s !== "gruvbox" ? s : null })
  check("moving shows the app in the next scheme", !!shown && shown !== "gruvbox", shown)
  check("nothing is saved while moving", json("appearance").scheme === "gruvbox", json("appearance"))
  await page.screenshot({ path: `${OUT}scheme-preview.png` })
  await page.keyboard.press("Escape")
  check("Esc goes back to the saved scheme", await until(async () => (await scheme()) === "gruvbox"), await scheme())
  await command("Change colour scheme")
  await page.keyboard.press("ArrowDown"); await page.keyboard.press("ArrowDown")
  const picked = await scheme()
  await page.keyboard.press("Enter")
  check("Enter keeps it", await until(() => json("appearance").scheme === picked) && (await scheme()) === picked, [picked, json("appearance").scheme])

  // The new tab's page: a dashboard drawn instead of the sections, live, and back.
  // (one of the vault's dashboards, the first listed; a page that isn't there leaves the sections)
  const dash = await page.evaluate(async () => (await (await fetch("api/state")).json()).files.files.find((f) => f.type === "dashboard"))
  writeFileSync(conf("newtab"), JSON.stringify({ page: dash.path }))
  await wait(1500)
  await calm()
  await page.click("[aria-label='New tab']", { timeout: 5000 })
  const pane = page.locator("[data-pane]:visible").first()
  check("a new tab draws the page", await until(async () => (await pane.locator("[data-newtab-section]").count()) === 0 && (await pane.innerText()).includes(dash.title || path.basename(dash.path, ".md"))), [dash.path, (await pane.innerText()).slice(0, 200)])
  await page.screenshot({ path: `${OUT}newtab-page.png` })
  await command("Show sections on new tabs")
  check("Show sections on new tabs takes the page away", await until(() => !json("newtab").page) && await until(async () => (await pane.locator("[data-newtab-section]").count()) > 0), json("newtab"))

  // A look bundle with a picture, under Looks.
  const png = (await page.screenshot({ clip: { x: 0, y: 0, width: 640, height: 400 } })).toString("base64")
  const saved = await page.evaluate(async (preview) => (await fetch("api/bundles", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "QA look", look: true, preview }) })).json(), png)
  check("a look saves as a look, with its picture", saved.bundle?.look === true && !!saved.bundle?.preview, saved)
  await page.goto("about:blank"); await page.goto(`${base}/#bundles`)
  const card = page.locator("[data-bundles-looks] [data-bundle='qa-look']")
  check("it's under Looks", await until(() => card.count(), 15000))
  check("its card shows the picture", await until(async () => (await card.locator("img").evaluate((i) => i.complete && i.naturalWidth > 0).catch(() => false))), null)
  check("Yours doesn't list it", (await page.locator("[data-bundles-mine] [data-bundle='qa-look']").count()) === 0)
  await page.locator("[data-bundles-looks]").scrollIntoViewIfNeeded()
  await page.screenshot({ path: `${OUT}looks.png` })
  await card.click()
  check("its preview shows the picture", await until(() => page.locator("dialog[open] [data-bundle-picture]").count()))
  await page.screenshot({ path: `${OUT}look-preview.png` })
  await page.evaluate(() => fetch("api/bundles/qa-look", { method: "DELETE" }))
} catch (e) {
  check("ran to the end", false, String(e?.stack ?? e).slice(0, 600))
} finally {
  for (const [n, text] of Object.entries(keep)) { if (text === null) rmSync(conf(n), { force: true }); else writeFileSync(conf(n), text) }
  await done()
}
