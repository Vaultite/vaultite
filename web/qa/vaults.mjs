// The web's Manage vaults (the sheet) and a drop from the computer on the file tree (uploads). Switches the server's
// vault to a new one made in a temporary folder in the home folder, then back, and drops a file in Notes: WRITES,
// throwaway server only (started with its own VAULTITE_LOCAL).
//   node web/qa/vaults.mjs <base url> [out dir]
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { qa, until } from "./lib/qa.mjs"
const { args: [B, OUT = "/tmp/vaults-shots/"], browser, check, watch, done } = await qa(import.meta.url)
fs.mkdirSync(OUT, { recursive: true })
const api = async (p, init) => (await fetch(new URL(`api/${p}`, B), init)).json()
const first = (await api("vault")).path
const parent = fs.mkdtempSync(path.join(os.homedir(), "vau-qa-vaults-"))

const page = watch(await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage())
try {
  await page.goto(B)
  await page.waitForSelector("[role=tree]")
  check("no desktop bits in a browser", await page.evaluate(() => !document.documentElement.hasAttribute("data-electron") && !("vaultite" in window)))

  // A file from the computer dropped on Notes: uploaded there.
  await page.evaluate(() => {
    const row = document.querySelector('[data-tree-path="Notes"]')
    const dt = new DataTransfer()
    dt.items.add(new File(["Dropped in a browser.\n"], "Browser drop.md", { type: "text/markdown" }))
    for (const type of ["dragenter", "dragover", "drop"]) row.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }))
  })
  await page.waitForTimeout(1500)
  const up = await api("file?path=Notes%2FBrowser%20drop.md")
  check("a file dropped on a folder is uploaded there", String(up.text).includes("Dropped in a browser."), up)

  // The vault menu: Manage vaults opens the sheet.
  await page.locator("aside nav[aria-label=App] button[aria-haspopup=menu]").click()
  await page.getByText("Manage vaults").click()
  await page.waitForSelector("text=Open folder as vault")
  check("the sheet is headed Vaults, with the app's mark", await page.locator("#sheet-title").textContent() === "Vaults" && await page.locator("img[src='icon.svg']").count() === 1)
  check("the sheet lists the vault being served", (await page.locator("nav[aria-label=Vaults]").textContent()).includes(path.basename(first)))
  await page.screenshot({ path: path.join(OUT, "sheet.png") })
  await page.getByRole("button", { name: "Open", exact: true }).click()
  await page.waitForSelector("ul[aria-label=Folders] li")
  const names = await page.locator("ul[aria-label=Folders] li").allTextContents()
  check("the folder browser starts at home, without hidden folders", names.some((n) => n.startsWith("vau-qa-vaults-")) && !names.some((n) => n.startsWith(".")), names.slice(0, 8))
  await page.screenshot({ path: path.join(OUT, "browse.png") })

  // Create a vault (through the API the sheet uses): the server serves it, the app reloads on it.
  const r = await api("vaults/create", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ parent, name: "Second" }) })
  check("create: the server serves the new vault", (await api("vault")).path === path.join(parent, "Second") && r.vaults.some((v) => v.path === first), r)
  // A new vault starts from Standard (core/start.ts): only .vaultite/ written (no page until a setup is picked), and
  // no starter content (Start here, agent pointers): that's setup's choice, not the sheet's.
  const second = path.join(parent, "Second")
  const pages = JSON.parse(fs.readFileSync(path.join(second, ".vaultite/pages.json"), "utf8"))
  const pjFile = path.join(second, ".vaultite/plugins.json")
  check("create: Standard, nothing pinned, nothing offered",
    !((fs.existsSync(pjFile) ? JSON.parse(fs.readFileSync(pjFile, "utf8")) : {}).enabled ?? []).includes("people") && JSON.stringify(pages.pinned) === "[]"
    && !fs.existsSync(path.join(second, ".vaultite/bundles/onboarding.json")), pages)
  check("create: only .vaultite/ written, its rules in it", JSON.stringify(fs.readdirSync(second)) === '[".vaultite"]' && fs.existsSync(path.join(second, ".vaultite/AGENTS.md")), fs.readdirSync(second))
  await page.goto(B)
  await page.waitForSelector("[role=tree]")
  check("the app shows the new vault", (await page.locator("aside nav[aria-label=App]").textContent()).includes("Second"))
  // The vault menu lists the other vaults on the web too; back to the first from there.
  // (the list comes once the app is idle, the menu is made as it opens: reopened until it's there)
  const item = page.getByRole("menuitem", { name: `Open ${path.basename(first)}`, exact: true })
  await until(async () => {
    if (await page.getByRole("menu").count()) await page.keyboard.press("Escape")
    await page.locator("aside nav[aria-label=App] button[aria-haspopup=menu]").click()
    return item.waitFor({ timeout: 1000 }).then(() => true, () => false)
  }, 10_000)
  check("the vault menu lists the other vault", await item.count() === 1, await page.getByRole("menuitem").allTextContents())
  await page.screenshot({ path: path.join(OUT, "menu.png") })
  await item.click()
  // (the first is a sandbox: the menu calls it Playground, not by its folder)
  await page.waitForFunction(() => { const t = document.querySelector("aside nav[aria-label=App]")?.textContent; return t && !t.includes("Second") }, null, { timeout: 15000 })
  check("switching back from the sheet", (await api("vault")).path === first)
  check("refused: home itself", (await api("vaults/open", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: os.homedir() }) })).error)
} finally {
  await browser.close()
  if ((await api("vault")).path !== first) await api("vaults/open", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: first }) })
  fs.rmSync(parent, { recursive: true, force: true })
}
await done()
