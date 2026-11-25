//   node web/qa/nickname.mjs <vault copy> [packaged app binary]
// Paths: electron/nicknames.ts, vaultlist.ts, appmenu.ts, core/vaultname.ts, VaultRow.tsx, VaultManager.tsx
import { _electron } from "playwright-core"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { app as appOf } from "./lib/app.mjs"
import { desktopApp, qa, until } from "./lib/qa.mjs"

const { args: [VAULT, BIN], check, watch, noErrors, done } = await qa(import.meta.url, { chrome: false })
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "vau-nickname-")), OUT = path.join(TMP, "shots"), USER = path.join(TMP, "userData")
fs.mkdirSync(OUT)
fs.mkdirSync(USER)
fs.rmSync(path.join(VAULT, ".vaultite", "sandbox.json"), { force: true })
const FOLDER = path.basename(VAULT), FILE = path.join(VAULT, ".vaultite", "vault.json")
const CLOSED = path.join(TMP, "harbour", "Closed vault")
fs.mkdirSync(CLOSED, { recursive: true })
fs.writeFileSync(path.join(USER, "vaults.json"), JSON.stringify({ vaults: [{ path: VAULT, last: 2 }, { path: CLOSED, last: 1 }] }))

const DESKTOP = BIN ? { executablePath: BIN, args: [], env: {} } : await desktopApp()
const app = await _electron.launch({
  executablePath: DESKTOP.executablePath, args: [...DESKTOP.args, "--vault", VAULT],
  env: { ...process.env, ...DESKTOP.env, VAULTITE_QUIET: process.env.SHOW ? "" : "1", VAULTITE_USER_DATA: USER, VAULTITE_LOCAL: path.join(TMP, "local") },
})
const win = await app.firstWindow(), ui = appOf(win)
watch(win, { console: true })
await win.waitForSelector("[role=tree]", { timeout: 60000 })
await ui.idle()
await win.evaluate(() => { window.__loaded = true })
const port = new URL(win.url()).port
const title = () => app.evaluate(({ BaseWindow }, p) => BaseWindow.getAllWindows().find((w) => w.webContents?.getURL().includes(`:${p}/`))?.getTitle(), port)
const inMenu = (p) => app.evaluate(({ Menu }, sub) => {
  const all = (m) => m.items.flatMap((i) => [i, ...(i.submenu ? all(i.submenu) : [])])
  return all(Menu.getApplicationMenu()).find((i) => i.sublabel === sub)?.label
}, p)
const button = win.locator("aside [data-vault-button]")
const field = win.locator("[data-menu-field] input")
const named = (n) => until(async () => (await button.textContent())?.trim() === n && await title() === n && await inMenu(VAULT) === n && await win.title() === `${n} · Vaultite`, 10000)
const all = async () => [await button.textContent(), await title(), await inMenu(VAULT), await win.title()]

check("with no nickname, the folder's name: the sidebar, the window, the app menu, the page", await named(FOLDER), await all())

await ui.menu.context(button)
check("right-clicking the vault button offers Set nickname…, above the sidebar's own items", (await ui.menu.items())[0] === "Set nickname…" && (await ui.menu.items()).length > 1, await ui.menu.items())
await ui.menu.pick("Set nickname…")
await field.waitFor()
check("its field is empty, the folder's name its placeholder, with the keyboard", await field.inputValue() === "" && await field.getAttribute("placeholder") === FOLDER
  && await field.evaluate((el) => el === document.activeElement))
check("…and one line says what it does", /Shown instead of the folder's name; the folder isn't renamed/.test(await win.locator("[data-menu-field]").textContent()))
await win.screenshot({ path: path.join(OUT, "field.png") })
await win.keyboard.type("Never")
await win.keyboard.press("Escape")
await ui.idle()
check("Escape cancels", !fs.existsSync(FILE) && await named(FOLDER), await all())

await button.click()
check("the vault menu says Set nickname…, never Rename", (await ui.menu.items()).includes("Set nickname…") && !(await ui.menu.items()).some((i) => /rename/i.test(i)), await ui.menu.items())
await ui.menu.pick("Set nickname…")
await field.fill("Lighthouse")
await win.keyboard.press("Enter")
check("Enter saves: every name follows, live", await named("Lighthouse"), await all())
check("…into .vaultite/vault.json, the folder as it was", JSON.parse(fs.readFileSync(FILE, "utf8")).name === "Lighthouse" && fs.existsSync(VAULT))

await app.evaluate(({ BaseWindow }, p) => BaseWindow.getAllWindows().find((w) => w.webContents?.getURL().includes(`:${p}/`))?.hide(), port)
fs.writeFileSync(FILE, JSON.stringify({ name: "Beacon" }))
check("changed in its file, the window hidden: its title and the menu follow", await until(async () => await title() === "Beacon" && await inMenu(VAULT) === "Beacon", 15000), [await title(), await inMenu(VAULT)])
await app.evaluate(({ BaseWindow }, p) => BaseWindow.getAllWindows().find((w) => w.webContents?.getURL().includes(`:${p}/`))?.showInactive(), port)
check("…and the page, once shown", await named("Beacon"), await all())

await win.keyboard.press("ControlOrMeta+p")
await win.locator("input[placeholder]").first().fill("nickname")
await win.getByText("Set vault nickname…").click()
await field.waitFor()
check("the command opens the same field, holding the nickname", await field.inputValue() === "Beacon")
await win.keyboard.press("Escape")

await win.evaluate(() => window.vaultite.manageVaults())
const mgr = await until(() => app.windows().find((w) => w.url().endsWith("vaults.html")), 10000)
const row = (p) => mgr.locator(`[data-vault-row="${p}"]`)
const nick = mgr.getByLabel("Nickname", { exact: true })
await row(CLOSED).waitFor()
check("Manage vaults: the nickname, its folder's path under it", /Beacon/.test(await row(VAULT).textContent()) && (await row(VAULT).textContent()).includes(FOLDER), await row(VAULT).textContent())
await row(CLOSED).getByRole("button", { name: "Set nickname for Closed vault" }).click()
check("a click on a name edits it in place", await nick.getAttribute("placeholder") === "Closed vault" && await nick.evaluate((el) => el === document.activeElement))
await mgr.screenshot({ path: path.join(OUT, "manage.png") })
await nick.fill("Harbour notes")
await mgr.keyboard.press("Enter")
check("…a vault that isn't open: its row and the app menu follow", await until(async () => /Harbour notes/.test(await row(CLOSED).textContent()) && await inMenu(CLOSED) === "Harbour notes", 10000), await inMenu(CLOSED))
check("…with its path under it, and nothing opened", (await row(CLOSED).textContent()).includes("Closed vault") && app.windows().filter((w) => w.url().startsWith("http://127")).length === 1)
await until(async () => {
  if (await ui.menu.isOpen()) await ui.menu.close()
  await button.click()
  return (await ui.menu.items()).includes("Open Harbour notes")
}, 10000)
check("…and the other window's vault menu, with no reload", (await ui.menu.items()).includes("Open Harbour notes"), await ui.menu.items())
await ui.menu.close()

await row(VAULT).hover()
await row(VAULT).getByRole("button", { name: "More for Beacon" }).click()
await mgr.getByRole("menuitem", { name: "Set nickname…" }).click()
await nick.waitFor()
check("the row's … menu opens the same field", await nick.inputValue() === "Beacon" && await until(() => nick.evaluate((el) => el === document.activeElement), 3000))
await nick.fill("Never")
await mgr.keyboard.press("Escape")
check("Escape cancels, the window still there", await until(async () => /Beacon/.test(await row(VAULT).textContent()), 3000) && !(await nick.count()) && await title() === "Beacon")
await row(VAULT).getByRole("button", { name: "Set nickname for Beacon" }).click()
await nick.fill("   ")
await mgr.keyboard.press("Enter")
check("a blank field clears it: the folder's name everywhere, live", await named(FOLDER), await all())
check("…its row too, and no name left in the file", await until(async () => !/Beacon/.test(await row(VAULT).textContent()), 5000) && !("name" in JSON.parse(fs.readFileSync(FILE, "utf8"))), fs.readFileSync(FILE, "utf8"))
check("none of it reloaded the page", await win.evaluate(() => window.__loaded === true))

noErrors()
await app.close()
console.log(`\nshots in ${OUT}`)
await done()
