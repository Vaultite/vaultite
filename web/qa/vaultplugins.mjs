// Vault plugins (the made-up Lighthouse): off until turned on, unloaded when edited until allowed again or when breaking
// the rules; the Plugins page's categories. WRITES .vaultite/plugins/lighthouse, Keepers/, plugins.json: throwaway only.
//   node web/qa/vaultplugins.mjs <base url> <vault path> [out dir]
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import { SHOTS, pluginsFilter, qa, until, wait } from "./lib/qa.mjs"
import { fileURLToPath } from "node:url"
const { args: [B, VAULT, OUT = SHOTS], browser, check, errs, watch, done } = await qa(import.meta.url)
const FIXTURE = fileURLToPath(new URL("../../tools/fixtures/lighthouse/", import.meta.url))
const DIR = ".vaultite/plugins/lighthouse"
const PAGE = "Dashboards/Lighthouse.md" // (its page, written when it's turned on: core/pages.ts)
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
  setBeamKeys(null)
  for (const p of [DIR, "Keepers", PAGE]) rmSync(abs(p), { recursive: true, force: true })
  setEnabled(false)
  const pages = JSON.parse(read(".vaultite/pages.json"))
  pages.pinned = pages.pinned.filter((p) => p !== PAGE)
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
const row = page.locator('[data-plugin-row="lighthouse"]').locator("..")
const sw = page.getByRole("switch", { name: "Lighthouse plugin" })
check("the Plugins page lists Lighthouse", await until(async () => (await row.innerText()).includes("Lighthouse"), 8000), await row.innerText().catch(() => ""))
check("its row says what it does, under its name", (await row.locator("[data-plugin-blurb]").count()) === 1, await row.innerText())
check("the page shows where your own plugins live", (await page.locator("main").innerText()).includes(".vaultite/plugins"))
check("a new vault plugin is off", await sw.getAttribute("aria-checked") === "false")
let [code] = await api("lighthouse")
check("nothing of it runs while it's off (no route)", code === 404, code)
;[code] = await api("plugins/lighthouse/0/bundle.js")
check("and no bundle", code === 404, code)
await shot("off")

// ---------- category sections ----------
const ORDER = ["navigation", "writing", "life", "health", "ai-apps", "agents", "developer", "formats", "system", "other"]
const sections = () => page.locator("[data-plugin-category]").evaluateAll((els) => els.map((e) => e.dataset.pluginCategory))
const got = await sections()
check("sections in the categories' order", got.length > 1 && got.every((c, i) => ORDER.includes(c) && (!i || ORDER.indexOf(c) > ORDER.indexOf(got[i - 1]))), got)
check("a vault plugin sits in its manifest's category", (await page.locator('[data-plugin-category="life"] [data-plugin-row="lighthouse"]').count()) === 1)
check("nothing folds: no fold chevrons", (await page.locator("main [data-fold]").count()) === 0)
check("no filters, no chips under the search", (await page.locator("[data-plugins-active]").count()) === 0)
await pluginsFilter(page, "In this vault")
check("Filter's In this vault shows only the vault's own", await until(async () => (await page.locator("[data-plugin-row]").evaluateAll((els) => els.map((e) => e.dataset.pluginRow))).join() === "lighthouse", 8000),
  await page.locator("[data-plugin-row]").evaluateAll((els) => els.map((e) => e.dataset.pluginRow)))
check("...its chip says so, with the count", (await page.locator('[data-plugins-chip="source"]').innerText()).includes("In this vault") &&
  (await page.locator("[data-plugins-count]").innerText()) === "1 plugin", await page.locator("[data-plugins-active]").innerText())
await page.locator('[data-plugins-chip="source"]').click()
check("...its chip's x removes it", await until(async () => (await page.locator("[data-plugins-active]").count()) === 0 && (await sections()).length > 1, 4000))
await pluginsFilter(page, "AI apps", { category: true })
check("Filter shows one category", await until(async () => (await sections()).join() === "ai-apps" && (await page.locator('[data-plugin-members~="codex"]').count()) === 1
  && (await page.locator('[data-plugin-row="files"]').count()) === 0, 8000), await sections())
await shot("category")
await page.locator("[data-plugins-search] input").fill("codex")
check("a search inside a category finds its match", await until(async () => (await page.locator('[data-plugin-members~="codex"]').count()) === 1, 8000))
check("…and offers Get plugins for it", (await page.locator("[data-plugins-search-more]").count()) === 1)
await page.locator("[data-plugins-search] input").fill("")
await page.locator("[data-plugins-clear]").click()
check("Clear all shows every category again", await until(async () => (await sections()).length > 1, 8000), await sections())

// ---------- turned on ----------
await sw.click()
check("turning it on writes plugins.json's enabled", await until(async () => (plugins().enabled ?? []).includes("lighthouse"), 8000))
check("the server loads it and builds its bundle", await until(async () => { const p = await listed(); return p?.loaded && p?.bundle }, 8000))
;[code] = await api("lighthouse")
check("its route answers", code === 200, code)
check("turned on, it writes its page", await until(async () => { try { return read(PAGE).includes("block-lighthouse") } catch { return false } }, 8000))
check("the sidebar has its page", await until(async () => await page.locator(`[data-pin="${PAGE}"]`).count() > 0, 8000))
const offered = () => page.evaluate(() => !!globalThis.__vaultite?.modules?.["@vaultite"]?.offeredCommand("lighthouse:beam"))
check("its command is in the palette once it's on", await until(offered, 8000))
await page.reload()
check("its command is there when the app starts with it on (it loads after the app's)", await until(offered, 8000))
await page.goto(`${B}#file/${encodeURIComponent(PAGE)}`)
await page.evaluate(() => { window.__qaMarker = 1 })
const beam = page.locator("[data-lighthouse]")
check("its block draws on its page", await until(async () => /^Beam (on|off), 1 keeper$/.test(await beam.first().innerText()), 8000), await beam.first().innerText().catch(() => ""))
const spacing = await beam.first().evaluate((el) => getComputedStyle(el).letterSpacing)
check("its own Tailwind classes work, its md: variant over its plain one (md:tracking-[0.125em] at 15px)", spacing === "1.875px", spacing)
check("one React: its hooks run inside the app's tree", !errs.some((e) => /Invalid hook call|more than one copy of React/.test(e)), errs)
const [, text] = await api(`render?path=${encodeURIComponent(PAGE)}`)
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
await page.goto(`${B}#file/${encodeURIComponent(PAGE)}`)
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
check("its row says it couldn't start", await until(async () => (await row.innerText()).includes("Couldn't start"), 8000), await row.innerText().catch(() => ""))
await row.locator('[data-plugin-row="lighthouse"]').click()
check("its sheet says why", await until(async () => (await page.locator("[data-plugin-problems]").innerText().catch(() => "")).includes("@/core/data"), 8000))
await shot("problem")
await page.keyboard.press("Escape")
write(`${DIR}/index.tsx`, read(`${DIR}/index.tsx`).replace('import "@/core/data"\n', ""))
check("fixed, it loads again", await until(async () => { const p = await listed(); return p?.loaded && p?.bundle }, 8000))

// ---------- a build error ----------
write(`${DIR}/label.ts`, "export const label = (\n")
check("a frontend that doesn't build says so", await until(async () => ((await listed())?.problems ?? []).some((p) => p.includes("index.tsx couldn't be built")), 8000), (await listed())?.problems)
cpSync(`${FIXTURE}label.ts`, abs(`${DIR}/label.ts`))
check("fixed, it builds again", await until(async () => { const p = await listed(); return p?.loaded && !p.problems.length }, 8000), (await listed())?.problems)

// ---------- code that throws as it starts: said in plain words; what it threw behind Show details, and in Errors ----------
write(`${DIR}/label.ts`, `${read(`${DIR}/label.ts`)}\nconst Base = (globalThis as { NoSuchBase?: new () => object }).NoSuchBase as new () => object\nexport const broken = new (class extends Base {})()\n`)
check("its toast says it couldn't start, not what it threw", await until(async () => (await toast("Lighthouse couldn't start").count()) > 0, 12000) &&
  (await page.getByText("Class extends value").count()) === 0)
await page.goto("about:blank"); await page.goto(`${B}#plugins`)
check("its row says it couldn't start", await until(async () => (await row.innerText()).includes("Couldn't start"), 8000), await row.innerText().catch(() => ""))
await row.locator('[data-plugin-row="lighthouse"]').click()
const problems = page.locator("[data-plugin-problems]")
check("its sheet says it couldn't start and hides what it threw; its switch says it's on (to turn it off)",
  await until(async () => (await problems.innerText().catch(() => "")).includes("Lighthouse couldn't start"), 8000) &&
  !(await problems.innerText()).includes("Class extends") && await page.locator("[data-plugin-switch] [role=switch]").getAttribute("aria-checked") === "true",
  await problems.innerText().catch(() => ""))
await problems.getByRole("button", { name: "Show details" }).click()
check("Show details shows what it threw", (await problems.innerText()).includes("Class extends value"), await problems.innerText())
await shot("threw")
check("and Errors keeps it", await until(async () => ((await api("errors?source=app"))[1].groups ?? []).some((g) => g.kind === "plugin" && /Lighthouse: Class extends/.test(g.message)), 8000))
await page.keyboard.press("Escape")
cpSync(`${FIXTURE}label.ts`, abs(`${DIR}/label.ts`))
check("fixed, it starts again", await until(async () => (await row.innerText()).includes("Couldn't start") === false, 12000), await row.innerText().catch(() => ""))

// ---------- turned off ----------
await page.goto(`${B}#plugins`)
check("it shows as on", await until(async () => await sw.getAttribute("aria-checked") === "true", 8000))
await sw.click()
check("turned off, it's unloaded", await until(async () => !(await listed())?.loaded, 8000))
;[code] = await api("lighthouse")
check("and its route is gone", code === 404, code)
check("its page leaves the sidebar", await until(async () => await page.locator(`[data-pin="${PAGE}"]`).count() === 0, 8000))

// ---------- phone ----------
const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
const pp = watch(await phone.newPage())
await pp.goto(`${B}#plugins`); await wait(1500)
const vrow = pp.locator('[data-plugin-row="lighthouse"]')
check("phone: Lighthouse is listed", await until(async () => await vrow.count() === 1, 8000))
check("phone: a Filter button, no menu", await pp.locator("[data-plugins-filter]").isVisible() && !(await pp.locator("[data-rail]").count()))
check("phone: its byline says it's the vault's own", (await pp.locator('[data-plugin-by="lighthouse"]').innerText()) === "In this vault")
const overflow = await pp.evaluate(() => document.documentElement.scrollWidth - innerWidth)
check("phone: nothing overflows", overflow <= 0, overflow)
// Tapped as a thumb does: clear of the bottom bar, and on its icon (the row's text opens the sheet itself).
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
