// Vault plugins: a plugin written into the vault's .vaultite/plugins/<id>/ (the made-up Lighthouse, tools/fixtures/)
// shows on the Plugins page as off, runs nothing until it's turned on there, then its dashboard installs and its block
// draws (its Tailwind classes too); an edit to its files on disk unloads it until it's allowed again (its row says so,
// its sheet names the file changed, its shortcut says why it does nothing; Allow loads it, no reload); with its edits
// let run, editing shows at once; a file breaking the rules unloads it with the reason on the Plugins page; turned
// off, it's gone again. The page's category sections (in order, a vault plugin in its manifest's; a heading folds its
// section like a sidebar panel's, saved in plugins.json's `collapsedCategories`; a search sees through a fold).
// Also a phone-width look at the Plugins page.
// WRITES to the vault (.vaultite/plugins/lighthouse, Keepers/, Dashboards/Lighthouse.md, plugins.json's `enabled` and
// `collapsedCategories`, hotkeys.json; removed at the end): throwaway server only.
//   node web/qa/vaultplugins.mjs <base url> <vault path> [out dir]
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import { SHOTS, qa, until, wait } from "./lib/qa.mjs"
const { args: [B, VAULT, OUT = SHOTS], browser, check, errs, watch, done } = await qa(import.meta.url)
const FIXTURE = new URL("../../tools/fixtures/lighthouse/", import.meta.url).pathname
const DIR = ".vaultite/plugins/lighthouse"
const abs = (p) => `${VAULT}/${p}`
const read = (p) => readFileSync(abs(p), "utf8")
const write = (p, t) => { mkdirSync(dirname(abs(p)), { recursive: true }); writeFileSync(abs(p), t) }
const api = async (p) => { const r = await fetch(`${B}api/${p}`); return [r.status, r.headers.get("content-type")?.includes("json") ? await r.json() : await r.text()] }
const listed = async () => (await api("plugins"))[1].find((p) => p.id === "lighthouse")
const plugins = () => { try { return JSON.parse(read(".vaultite/plugins.json")) } catch { return {} } }
const setEnabled = (on) => { const c = plugins(); c.enabled = (c.enabled ?? []).filter((x) => x !== "lighthouse").concat(on ? ["lighthouse"] : []); write(".vaultite/plugins.json", JSON.stringify(c, null, 2) + "\n") }
const hotkeys = () => { try { return JSON.parse(read(".vaultite/hotkeys.json")) } catch { return {} } }
const setBeamKeys = (keys) => { const h = hotkeys(); if (keys) h["lighthouse:beam"] = keys; else delete h["lighthouse:beam"]; write(".vaultite/hotkeys.json", JSON.stringify(h, null, 2) + "\n") }
const cleanup = () => {
  const c = plugins(); delete c.collapsedCategories; write(".vaultite/plugins.json", JSON.stringify(c, null, 2) + "\n")
  setBeamKeys(null)
  for (const p of [DIR, "Keepers", "Dashboards/Lighthouse.md", ".vaultite/generated/Dashboards/Lighthouse.md"]) rmSync(abs(p), { recursive: true, force: true })
  setEnabled(false)
  const pages = JSON.parse(read(".vaultite/pages.json"))
  pages.pinned = pages.pinned.filter((p) => p !== "Dashboards/Lighthouse.md")
  write(".vaultite/pages.json", JSON.stringify(pages, null, 2) + "\n")
}
cleanup()
// A plugin's new page is pinned unless pages.json says `"pinNew": false` (the sandbox does, da5190b): this tests the
// default, so it lifts that for the run and puts it back at the end.
const pinNew = JSON.parse(read(".vaultite/pages.json")).pinNew
const setPinNew = (v) => {
  const pages = JSON.parse(read(".vaultite/pages.json"))
  if (v === undefined) delete pages.pinNew
  else pages.pinNew = v
  write(".vaultite/pages.json", JSON.stringify(pages, null, 2) + "\n")
}
setPinNew(undefined)
await wait(600)
cpSync(FIXTURE, abs(DIR), { recursive: true })
write("Keepers/Bob Lee.md", "---\ntype: keeper\nshift: night\n---\n\nKeeps the lamp.\n")
await wait(800)

const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
const page = watch(await ctx.newPage(), { console: true, ignore: /WebSocket|ERR_CONNECTION|Failed to load resource/ })
const shot = (name) => page.screenshot({ path: `${OUT}vaultplugins-${name}.png` })
mkdirSync(OUT, { recursive: true })

// ---------- off until turned on ----------
await page.goto(`${B}#plugins`); await wait(1500)
await page.evaluate(() => { window.__qaMarker = 1 })
const marker = () => page.evaluate(() => window.__qaMarker === 1)
const group = page.locator("[data-plugin-group=vault]")
const row = group.locator('[data-plugin-row="lighthouse"]').locator("..")
const sw = page.getByRole("switch", { name: "Lighthouse plugin" })
check("the Plugins page has a Vault plugins group with Lighthouse", await until(async () => (await row.innerText()).includes("Lighthouse"), 8000), await group.innerText().catch(() => ""))
check("the group shows its folder", (await group.innerText()).includes(".vaultite/plugins"), await group.innerText())
check("a new vault plugin is off", await sw.getAttribute("aria-checked") === "false")
let [code] = await api("lighthouse")
check("nothing of it runs while it's off (no route)", code === 404, code)
;[code] = await api("plugins/lighthouse/0/bundle.js")
check("and no bundle", code === 404, code)
await shot("off")

// ---------- category sections ----------
const ORDER = ["navigation", "writing", "life", "health", "agents", "developer", "formats", "system", "other"]
const sections = async (tier) => (await page.locator(`[data-plugin-group=${tier}] [data-plugin-category]`).evaluateAll((els) => els.map((e) => e.dataset.pluginCategory.split(":")[1])))
for (const tier of ["core"]) {
  const got = await sections(tier)
  check(`${tier}: sections in the categories' order`, got.length > 1 && got.every((c, i) => ORDER.includes(c) && (!i || ORDER.indexOf(c) > ORDER.indexOf(got[i - 1]))), got)
}
check("a vault plugin sits in its manifest's category", (await page.locator('[data-plugin-category="vault:life"] [data-plugin-row="lighthouse"]').count()) === 1)
const agents = page.locator('[data-plugin-category="core:agents"]')
const head = agents.locator("[data-panel-handle]")
check("an open section's heading shows no chevron", (await head.locator('[data-fold="open"]').evaluate((el) => getComputedStyle(el).opacity)) === "0")
await head.click()
check("a click folds it: its rows go", await until(async () => (await agents.locator("[data-plugin-row]").count()) === 0, 8000))
check("folded: a chevron after the name", await head.locator('[data-fold="collapsed"]').isVisible())
check("saved in plugins.json's collapsedCategories", await until(async () => (plugins().collapsedCategories ?? []).includes("core:agents"), 8000), plugins().collapsedCategories)
await shot("folded")
await page.getByPlaceholder("Search plugins").fill("codex")
check("a search shows matches in a folded section", await until(async () => (await agents.locator('[data-plugin-row="codex"]').count()) === 1, 8000))
await page.getByPlaceholder("Search plugins").fill("")
check("…and it's folded again after", await until(async () => (await agents.locator("[data-plugin-row]").count()) === 0, 8000))
await head.click()
check("a click opens it again", await until(async () => (await agents.locator("[data-plugin-row]").count()) > 1 && !(plugins().collapsedCategories ?? []).includes("core:agents"), 8000))

// ---------- turned on ----------
await sw.click()
check("turning it on writes plugins.json's enabled", await until(async () => (plugins().enabled ?? []).includes("lighthouse"), 8000))
check("the server loads it and builds its bundle", await until(async () => { const p = await listed(); return p?.loaded && p?.bundle }, 8000))
;[code] = await api("lighthouse")
check("its route answers", code === 200, code)
check("its dashboard was installed", await until(async () => { try { return read("Dashboards/Lighthouse.md").includes("block-lighthouse") } catch { return false } }, 8000))
check("the sidebar has its page", await until(async () => await page.locator('[data-pin="Dashboards/Lighthouse.md"]').count() > 0, 8000))
const offered = () => page.evaluate(() => !!globalThis.__vaultite?.modules?.["@vaultite"]?.offeredCommand("lighthouse:beam"))
check("its command is in the palette once it's on", await until(offered, 8000))
await page.reload()
check("its command is there when the app starts with it on (it loads after the app's)", await until(offered, 8000))
await page.goto(`${B}#file/${encodeURIComponent("Dashboards/Lighthouse.md")}`)
await page.evaluate(() => { window.__qaMarker = 1 })
const beam = page.locator("[data-lighthouse]")
check("its block draws on its page", await until(async () => /^Beam (on|off), 1 keeper$/.test(await beam.first().innerText()), 8000), await beam.first().innerText().catch(() => ""))
const spacing = await beam.first().evaluate((el) => getComputedStyle(el).letterSpacing)
check("its own Tailwind classes work, its md: variant over its plain one (md:tracking-[0.125em] at 15px)", spacing === "1.875px", spacing)
check("one React: its hooks run inside the app's tree", !errs.some((e) => /Invalid hook call|more than one copy of React/.test(e)), errs)
const [, text] = await api(`render?path=${encodeURIComponent("Dashboards/Lighthouse.md")}`)
check("its block as text for AIs (/api/render)", text.includes("## Lighthouse") && text.includes("[[Bob Lee]]: night shift"), text)
check("its docs are among the topics", (await api("docs"))[1].some((t) => t.id === "lighthouse"))
await shot("on")

// ---------- edited on disk: waits to be allowed again (core/trust.ts), then no reload ----------
write(`${DIR}/label.ts`, read(`${DIR}/label.ts`).replace("`Beam ${", "`Light ${"))
check("an edit to its files unloads it until it's allowed again", await until(async () => { const p = await listed(); return !p?.loaded && p?.approval?.state === "changed" }, 8000), await listed())
await page.goto(`${B}#plugins`)
check("its row says it changed and waits", await until(async () => (await row.innerText()).includes("Changed: waiting for you to allow it again"), 8000), await row.innerText().catch(() => ""))
// Its command's shortcut (hotkeys.json) says why it does nothing, instead of nothing.
setBeamKeys(["Mod+Shift+Y"])
const toast = (text) => page.locator("[data-sonner-toast]", { hasText: text })
check("its shortcut says it waits to be allowed", await until(async () => {
  await page.keyboard.press("ControlOrMeta+Shift+KeyY")
  return (await toast("Lighthouse waits for you to allow it on this machine").count()) > 0
}, 8000))
await page.locator('[data-plugin-review="lighthouse"]').click()
const approval = page.locator('dialog[open] [data-plugin-approval="lighthouse"]')
check("its sheet names the file that changed", await until(async () => (await approval.count()) && (await approval.locator("[data-plugin-changed]").innerText()).includes("label.ts"), 8000))
await shot("approval")
await approval.locator('[data-plugin-allow="lighthouse"]').click()
check("allowed, it loads again", await until(async () => { const p = await listed(); return p?.loaded && p?.bundle && !p.approval }, 8000))
// While it's written here its edits may run without asking (the sheet's switch).
await page.locator('dialog[open] [data-plugin-edits="lighthouse"] [role=switch]').click()
check("its edits let run (the sheet's switch)", await until(async () => (await listed())?.edits === true, 8000))
await page.keyboard.press("Escape")
check("allowed, its shortcut runs its command", await until(async () => { await page.keyboard.press("ControlOrMeta+Shift+KeyY"); return (await toast("The beam is on").count()) > 0 }, 8000))
setBeamKeys(null)
await page.goto(`${B}#file/${encodeURIComponent("Dashboards/Lighthouse.md")}`)
await page.evaluate(() => { window.__qaMarker = 1 })
check("the frontend edit shows without a reload", await until(async () => /^Light (on|off)/.test(await beam.first().innerText()), 12000), await beam.first().innerText().catch(() => ""))
write(`${DIR}/label.ts`, read(`${DIR}/label.ts`).replace("`Light ${", "`Lamp ${"))
check("an edit to its frontend shows without a reload",
  await until(async () => /^Lamp (on|off)/.test(await beam.first().innerText()), 12000) && await marker(), await beam.first().innerText().catch(() => ""))
write("Keepers/Alice Park.md", "---\ntype: keeper\nshift: day\n---\n")
check("its kind reads new files (2 keepers)", await until(async () => (await api("lighthouse"))[1].keepers === 2, 8000))
write(`${DIR}/plugin.ts`, read(`${DIR}/plugin.ts`).replace("keepers: plugin.vault.items(\"keepers\").length", "keepers: plugin.vault.items(\"keepers\").length + 10"))
check("an edit to its backend applies on the next request (12 keepers)", await until(async () => (await api("lighthouse"))[1].keepers === 12, 8000))
await shot("edited")

// ---------- a rule broken: refused, with the reason ----------
write(`${DIR}/index.tsx`, `import "@/core/data"\n${read(`${DIR}/index.tsx`)}`)
check("a file breaking the rules unloads it", await until(async () => !(await listed())?.loaded, 8000))
check("and the server says why", ((await listed())?.problems ?? []).some((p) => p.includes("@/core/data")), (await listed())?.problems)
await page.goto(`${B}#plugins`)
check("the Plugins page shows the reason", await until(async () => (await row.innerText()).includes("@/core/data"), 8000), await row.innerText().catch(() => ""))
await shot("problem")
write(`${DIR}/index.tsx`, read(`${DIR}/index.tsx`).replace('import "@/core/data"\n', ""))
check("fixed, it loads again", await until(async () => { const p = await listed(); return p?.loaded && p?.bundle }, 8000))

// ---------- a build error ----------
write(`${DIR}/label.ts`, "export const label = (\n")
check("a frontend that doesn't build says so", await until(async () => ((await listed())?.problems ?? []).some((p) => p.includes("index.tsx couldn't be built")), 8000), (await listed())?.problems)
cpSync(`${FIXTURE}label.ts`, abs(`${DIR}/label.ts`))

// ---------- turned off ----------
await page.goto(`${B}#plugins`)
check("it shows as on", await until(async () => await sw.getAttribute("aria-checked") === "true", 8000))
await sw.click()
check("turned off, it's unloaded", await until(async () => !(await listed())?.loaded, 8000))
;[code] = await api("lighthouse")
check("and its route is gone", code === 404, code)
check("its page leaves the sidebar", await until(async () => await page.locator('[data-pin="Dashboards/Lighthouse.md"]').count() === 0, 8000))

// ---------- phone ----------
const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
const pp = watch(await phone.newPage())
await pp.goto(`${B}#plugins`); await wait(1500)
const vrow = pp.locator('[data-plugin-group=vault] [data-plugin-row="lighthouse"]')
check("phone: the vault group is there", await until(async () => await vrow.count() === 1, 8000))
const overflow = await pp.evaluate(() => document.documentElement.scrollWidth - innerWidth)
check("phone: nothing overflows", overflow <= 0, overflow)
// Tapped as a thumb does: brought clear of the bottom bar first (scrolling only far enough to show it leaves the last
// row under the bar, where nobody taps), and on its icon, where the row's button is what's under the finger (its text
// covers the button's middle and opens the sheet itself).
await vrow.evaluate((e) => e.scrollIntoView({ block: "center" }))
const vbox = await vrow.boundingBox()
await vrow.tap({ position: { x: 24, y: vbox.height / 2 } })
check("phone: its sheet says it's off and runs nothing", await until(async () => (await pp.locator("#sheet-title").count()) > 0 &&
  (await pp.getByText("nothing of it runs").count()) > 0, 8000))
await pp.screenshot({ path: `${OUT}vaultplugins-phone-sheet.png` })

await browser.close()
cleanup()
setPinNew(pinNew)
await done()
