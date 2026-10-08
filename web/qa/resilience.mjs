// One broken part fails alone, never the app: a vault plugin (the made-up Brittle) whose background, status bar,
// file bar and note-top items and a view's tab title all throw leaves the app drawn (no "Vaultite stopped"), its tab
// named after the view, and its command that fails says so in a toast. Settings of the wrong shape (plugins.json's
// `disabled: null`, appearance.json's `snippets: "x"`) and a workspace's tab that isn't one are dropped. The crash
// screen's Reload with vault plugins off opens the app without them (Brittle's view isn't there), saying so, until
// Turn back on.
// WRITES to the vault (.vaultite/plugins/brittle, plugins.json, appearance.json, the workspaces' files): throwaway
// server only.
//   node web/qa/resilience.mjs <base url> <vault path>
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import { qa, until, wait } from "./lib/qa.mjs"
const { args: [B, VAULT], browser, check, done } = await qa(import.meta.url)
const abs = (p) => `${VAULT}/${p}`
const read = (p) => { try { return readFileSync(abs(p), "utf8") } catch { return "" } }
const write = (p, t) => { mkdirSync(dirname(abs(p)), { recursive: true }); writeFileSync(abs(p), t) }
const json = (p) => { try { return JSON.parse(read(p)) } catch { return {} } }
const was = { plugins: read(".vaultite/plugins.json"), appearance: read(".vaultite/appearance.json") }

write(".vaultite/plugins/brittle/manifest.json", JSON.stringify({ id: "brittle", category: "other", name: "Brittle", description: "A made-up vault plugin whose every part throws.", version: "1.0.0", author: "Alice Park", disclosures: {}, apiVersion: 1 }, null, 2))
write(".vaultite/plugins/brittle/index.tsx", `import { definePlugin } from "@vaultite"
import { Bomb } from "lucide-react"
const boom = (where: string): never => { throw new Error(\`qa: brittle \${where}\`) }
function Background(): null { return boom("background") }
export default definePlugin({
  icon: Bomb,
  background: Background,
  ambient: { always: { title: "Brittle", render: () => boom("ambient") } },
  status: { count: { render: () => boom("status") } },
  fileBar: { mark: { render: () => boom("file bar") } },
  noteTop: { top: { render: () => boom("note top") } },
  views: { brittle: { icon: Bomb, title: () => boom("title"), render: () => <p data-brittle-view>Brittle's view</p> } },
  commands: [{ id: "brittle:break", name: "Break the brittle thing", run: async () => boom("command") }],
})
`)

const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errs = []
page.on("pageerror", (e) => errs.push(String(e)))
const stopped = () => page.$("#vau-boot-error").then((e) => !!e)
const drawn = () => until(async () => !!(await page.$("[role=tree]")) && !(await stopped()), 15000)
const ui = (body) => fetch(`${B}api/ui`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })

try {
  // ---------- a plugin whose every part throws ----------
  await page.goto(`${B}#plugins`)
  const sw = page.getByRole("switch", { name: "Brittle plugin" })
  check("Brittle is listed", await until(async () => (await sw.count()) === 1, 15000))
  await sw.click()
  check("turned on (plugins.json's enabled)", await until(async () => (json(".vaultite/plugins.json").enabled ?? []).includes("brittle"), 8000))
  await wait(2000)
  check("on, the app is still drawn", await drawn(), await page.$eval("#vau-boot-error", (e) => e.innerText).catch(() => ""))
  await page.reload()
  check("reloaded with it on: still drawn (its background, ambient item caught)", await drawn(), await page.$eval("#vau-boot-error", (e) => e.innerText).catch(() => ""))
  await ui({ action: "open", path: "Start here.md" })
  await wait(1500)
  check("a note open (its status, file bar, note-top items caught): still drawn", await drawn())
  await ui({ action: "open", path: "view:brittle", newTab: true })
  check("its view's tab, its title throwing: the view draws", await until(() => page.$("[data-brittle-view]"), 8000))
  check("…the tab named after the view", await until(async () => (await page.$$eval("[role=tab]", (ts) => ts.map((t) => t.textContent.trim()))).includes("brittle"), 5000),
    await page.$$eval("[role=tab]", (ts) => ts.map((t) => t.textContent.trim())))
  await page.keyboard.press("Meta+p")
  await page.keyboard.type("Break the brittle")
  await wait(300)
  await page.keyboard.press("Enter")
  check("its failing command says so in a toast", await until(async () => /Couldn't break the brittle thing: qa: brittle command/.test(await page.locator("[data-sonner-toast]").allInnerTexts().then((t) => t.join("\n"))), 5000),
    await page.locator("[data-sonner-toast]").allInnerTexts())
  check("…and the app's still there", await drawn())

  // ---------- settings of the wrong shape ----------
  write(".vaultite/plugins.json", JSON.stringify({ ...json(".vaultite/plugins.json"), disabled: null, enabled: "brittle" }))
  write(".vaultite/appearance.json", JSON.stringify({ ...json(".vaultite/appearance.json"), snippets: "x", tabBar: "yes" }))
  // (a workspace's tabs: one null, one without an address)
  const wsDir = ".vaultite/plugins/workspaces"
  const files = (() => { try { return readdirSync(abs(wsDir)).filter((f) => f.endsWith(".json")) } catch { return [] } })()
  for (const f of files) {
    const w = json(`${wsDir}/${f}`)
    const groups = (n) => (n && Array.isArray(n.kids) ? n.kids.flatMap(groups) : n && Array.isArray(n.tabs) ? [n] : [])
    for (const g of groups(w.layout?.root ?? w.root ?? w.layout)) g.tabs.push(null, { id: "qa-bad" })
    write(`${wsDir}/${f}`, JSON.stringify(w))
  }
  await wait(1000)
  await page.goto("about:blank")
  await page.goto(B)
  check(`wrong-shaped settings${files.length ? " and bad tabs" : ""}: the app draws`, await drawn(), await page.$eval("#vau-boot-error", (e) => e.innerText).catch(() => ""))

  // ---------- Reload with vault plugins off ----------
  write(".vaultite/plugins.json", JSON.stringify({ ...json(".vaultite/plugins.json"), disabled: [], enabled: ["brittle"] }))
  await wait(1500)
  const brittle = async () => { await ui({ action: "open", path: "view:brittle", newTab: true }); return !!(await until(() => page.$("[data-brittle-view]"), 6000)) }
  check("Brittle on again", await brittle())
  await page.evaluate(() => window.showBootError(new Error("qa: stopped"), "Vaultite stopped", { fresh: true }))
  const off = page.getByRole("button", { name: "Reload with vault plugins off" })
  check("the crash screen offers Reload with vault plugins off", await until(async () => (await off.count()) === 1, 3000))
  await off.click()
  check("…the app opens", await drawn())
  const toast = page.locator("[data-sonner-toast]", { hasText: "Vault plugins are off for now" })
  check("…saying vault plugins are off", await until(async () => (await toast.count()) === 1, 8000))
  check("…and they are (Brittle's view isn't drawn)", !(await brittle()))
  await toast.getByRole("button", { name: "Turn back on" }).click()
  await wait(2500)
  check("Turn back on: no toast, Brittle's view draws again", await drawn() && (await page.locator("[data-sonner-toast]", { hasText: "Vault plugins are off" }).count()) === 0 && await brittle())
  check("no page errors but Brittle's own", errs.every((e) => /qa: brittle/.test(e)), errs.slice(0, 5))
} finally {
  rmSync(abs(".vaultite/plugins/brittle"), { recursive: true, force: true })
  if (was.plugins) write(".vaultite/plugins.json", was.plugins)
  if (was.appearance) write(".vaultite/appearance.json", was.appearance); else rmSync(abs(".vaultite/appearance.json"), { force: true })
  await done()
}
