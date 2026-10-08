// A machine's menu: in the Machines panel a click opens what it can run (New terminal); a right-click shows the same,
// then the panel's own menu (Open in a tab, Panels, Move, Hide) under a line. In the machines view a right-click shows
// just the machine's. Turns Machines on and lists this server as its one machine (put back after).
//   node web/qa/machinemenu.mjs <base url> <vault path>
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import { qa, until, wait } from "./lib/qa.mjs"
const { args: [B, VAULT], browser, check, watch, done } = await qa(import.meta.url)
const keep = (p) => { const f = path.join(VAULT, p); let t = null; try { t = readFileSync(f, "utf8") } catch { /* none */ } return () => (t === null ? rmSync(f, { force: true }) : writeFileSync(f, t)) }
const restore = [keep(".vaultite/plugins.json"), keep(".vaultite/sidebars.json"), keep(".vaultite/plugins/machines/data.json")]
const plugins = (() => { try { return JSON.parse(readFileSync(path.join(VAULT, ".vaultite/plugins.json"), "utf8")) } catch { return {} } })()
writeFileSync(path.join(VAULT, ".vaultite/plugins.json"), JSON.stringify({ ...plugins, disabled: (plugins.disabled ?? []).filter((p) => p !== "machines"), enabled: [...(plugins.enabled ?? []), "machines"] }))
mkdirSync(path.join(VAULT, ".vaultite/plugins/machines"), { recursive: true })
writeFileSync(path.join(VAULT, ".vaultite/plugins/machines/data.json"), JSON.stringify({ machines: [{ id: "here", label: "Here", url: B.replace(/\/$/, "") }] }))
writeFileSync(path.join(VAULT, ".vaultite/sidebars.json"), JSON.stringify({ left: ["search:search", "machines:machines", "files:files"], right: [] }))

const page = watch(await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage())
const items = () => page.locator("[role=menu] [role^=menuitem]").allTextContents()
const menu = async () => { await until(async () => (await page.locator("[role=menu]").count()) > 0, 4000); return items() }
try {
  await page.goto(B)
  const row = page.locator("[data-machines-panel] [data-machine=here]")
  check("the panel lists the machine", await until(async () => (await row.count()) > 0, 8000))

  await row.click()
  let got = await menu()
  check("a click: New terminal, no panel items", got.includes("New terminal") && !got.some((t) => t.startsWith("Hide")), got)
  await page.keyboard.press("Escape"); await wait(200)

  await row.click({ button: "right" })
  got = await menu()
  const term = got.indexOf("New terminal"), hide = got.findIndex((t) => t.startsWith("Hide"))
  check("a right-click: the machine's items first, then the panel's", term === 0 && hide > term && got.some((t) => t.startsWith("Open Machines")), got)
  check("one menu", (await page.locator("[role=menu]").count()) === 1)
  await page.keyboard.press("Escape"); await wait(200)

  await page.goto(`${B}#view/machines`)
  const card = page.locator("main [data-machine=here], [data-machine=here]:not([data-machines-panel] *)").first()
  check("the view lists it", await until(async () => (await card.count()) > 0, 8000))
  await card.click({ button: "right" })
  got = await menu()
  check("the view's right-click: just the machine's", got.includes("New terminal") && !got.some((t) => t.startsWith("Hide")), got)
} finally {
  await browser.close()
  restore.forEach((f) => f())
}
await done()
