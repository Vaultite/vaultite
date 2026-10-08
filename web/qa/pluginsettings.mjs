// Plugins' settings sheets (components/PluginSettings.tsx) and the shorter Settings page: Settings has the app's own
// rows and its search finds the plugins' settings; Plugins' gear (on plugins that are on and have settings) opens the
// sheet; generated forms write only the key changed; custom panels (Pinned, File explorer); a data.json-only plugin
// (Logs); a vault plugin's declared settings; every way to open a sheet; 390px. WRITES plugins.json, files.json,
// page-preview's, search's and workspaces' settings, and a vault plugin (put back / removed): throwaway server only.
//   node web/qa/pluginsettings.mjs <base url> <vault path> [out dir]
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { qa, until, wait } from "./lib/qa.mjs"
import { setAsideWorkspaces, workspaces } from "./lib/wsfiles.mjs"

const { args: [B, VAULT, OUT = "/tmp/pluginsettings-shots/"], browser, check, watch, noErrors, done } = await qa(import.meta.url)
mkdirSync(OUT, { recursive: true })
const file = (rel) => `${VAULT}/${rel}`
const json = (rel) => { try { return JSON.parse(readFileSync(file(rel), "utf8")) } catch { return null } }
const keep = (rel) => { const was = existsSync(file(rel)) ? readFileSync(file(rel), "utf8") : null; return () => { if (was === null) rmSync(file(rel), { force: true }); else writeFileSync(file(rel), was) } }
const restore = [keep(".vaultite/plugins.json"), keep(".vaultite/files.json"), keep(".vaultite/plugins/page-preview/data.json"),
  keep(".vaultite/plugins/search/data.json"), keep(".vaultite/plugins/logs/data.json")]
const putBackWs = setAsideWorkspaces(VAULT)
const VP = ".vaultite/plugins/qa-tracker"

async function open(w, h, mobile = false) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, ...(mobile ? { isMobile: true, hasTouch: true } : {}) })
  return { ctx, page: watch(await ctx.newPage(), { label: w }) }
}
const sheet = (page, id) => page.locator(`dialog[open] [data-plugin-settings-sheet="${id}"]`)
const shot = async (page, name) => { await wait(500); await page.screenshot({ path: `${OUT}${name}.png` }) } // (once a sheet's animation is over)
/** Escape, then wait for the sheet to be gone and its history entries popped (a hash set meanwhile would be undone). */
async function closeSheet(page) {
  for (let i = 0; i < 3 && (await page.locator("dialog[open]").count()); i++) { await page.keyboard.press("Escape"); await wait(400) } // (a sheet over a sheet)
  await until(async () => !(await page.locator("dialog[open]").count()) && !(await page.evaluate(() => location.hash.slice(1).includes("/"))), 4000)
  await wait(400)
}
/** Load a page fresh at an address (on a computer the workspace's tabs, not a hash set by hand, say what's shown), and
 *  wait for the workspace to settle (its tabs are put back just after a load). */
async function go(page, h) {
  await page.goto("about:blank")
  await page.goto(`${B}#${h}`)
  await until(() => page.locator("main").count(), 4000)
  await wait(1500)
}

try {
  // A logs data.json (a plugin without a form: its file is shown) and a vault plugin declaring settings, turned on.
  if (!json(".vaultite/plugins/logs/data.json")) {
    mkdirSync(file(".vaultite/plugins/logs"), { recursive: true })
    writeFileSync(file(".vaultite/plugins/logs/data.json"), JSON.stringify({ areas: [{ slug: "running", name: "Running", weekly_goal: 3 }] }, null, 2) + "\n")
  }
  mkdirSync(file(VP), { recursive: true })
  writeFileSync(file(`${VP}/manifest.json`), JSON.stringify({ id: "qa-tracker", name: "QA tracker", description: "A made-up vault plugin with settings only.",
    settings: {
      goal: { type: "number", default: 3, min: 1, max: 14, label: "Weekly goal", description: "sessions a week" },
      unit: { type: "enum", values: ["km", "mi"], default: "km", label: "Unit", description: "how distances read" },
      tags: { type: "list", label: "Tags", description: "tags each entry gets" },
    } }, null, 2))
  const plugins = json(".vaultite/plugins.json") ?? {}
  // Workspaces on (a vault may have it off, as the sandbox does: da5190b): its sheet and its menu's Settings… are tested;
  // Properties off: an off plugin's settings are found, said off.
  writeFileSync(file(".vaultite/plugins.json"), JSON.stringify({ ...plugins, enabled: [...(plugins.enabled ?? []), "qa-tracker"],
    disabled: [...(plugins.disabled ?? []).filter((id) => id !== "workspaces" && id !== "properties"), "properties"] }, null, 2))
  // (on in plugins.json alone it waits for this machine's yes: core/trust.ts)
  await fetch(`${B.replace(/\/+$/, "")}/api/ops/plugin.allow`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: "qa-tracker" }) })
  await wait(1500)

  // ---------- desktop
  {
    const { ctx, page } = await open(1440, 900)
    await go(page, "settings")
    await until(() => page.locator("[data-plugin-settings-open]").count(), 4000)
    const text = await page.locator("main").innerText()
    check("Settings: Appearance, Hotkeys, Plugins, Vault", ["Appearance", "Hotkeys", "Plugins", "Plugin settings", "Vault"].every((t) => text.includes(t)), text.slice(0, 300))
    check("Settings: nothing a plugin adds", !["This workspace", "Pinned pages", "Show hidden files", "Connect an AI", "Vim's keys"].some((t) => text.includes(t)) &&
      !(await page.locator("main [data-workspace-settings], main [data-pinned-settings]").count()), text)
    await shot(page, "1-settings-desktop")
    const tall = await page.evaluate(() => document.querySelector("main").scrollHeight)
    await page.locator("[data-plugin-settings-open]").click(); await wait(500)
    check("Plugin settings opens a sheet of the plugins that have some", await page.locator("dialog[open] [data-plugin-settings=page-preview]").count() === 1 &&
      await page.locator("dialog[open] [data-plugin-settings=outline]").count() === 0)
    check("...the page doesn't move", tall === await page.evaluate(() => document.querySelector("main").scrollHeight))
    await page.locator("dialog[open] [data-plugin-settings=page-preview]").click()
    check("...a row opens that plugin's sheet", !!(await until(() => sheet(page, "page-preview").count(), 4000)))
    await closeSheet(page)
    await page.locator("[data-settings-plugins]").click()
    check("Plugins opens the Plugins page", !!(await until(() => page.evaluate(() => location.hash.startsWith("#plugins")), 4000)))
    await go(page, "settings")
    await until(() => page.locator("[data-plugin-settings-open]").count(), 4000)

    // Search: the app's rows (going to one clears the search and flashes it) and every plugin's settings, its manifest's
    // and its panel's (settingsSearch), even one that's off; one opens its sheet at the setting.
    const find = page.locator("[data-settings-search] input")
    const result = (id) => page.locator(`[data-settings-result="${id}"]`)
    await find.fill("hidden")
    check("search: Show hidden files, in File explorer's panel", !!(await until(() => result("plugin:files:showHidden").count(), 4000)) &&
      (await result("plugin:files:showHidden").innerText()).includes("File explorer") && !(await page.locator("[data-plugin-settings-open]").count()))
    await shot(page, "1b-settings-search")
    await result("plugin:files:showHidden").click()
    check("...opens its sheet, the setting flashed", !!(await until(() => sheet(page, "files").locator('[data-setting="showHidden"].reveal-flash').count(), 4000)))
    await closeSheet(page)
    check("...the search is kept behind the sheet", (await find.inputValue()) === "hidden")
    await find.fill("delay")
    check("search: a manifest's setting (Page preview's)", !!(await until(() => result("plugin:page-preview:delay").count(), 4000)))
    await find.fill("only on")
    check("search: an off plugin's panel setting, said off", !!(await until(() => result("plugin:properties:only").count(), 4000)) && (await result("plugin:properties:only").innerText()).includes("(off)"))
    await find.fill("line num")
    await until(() => result("line-numbers").count(), 4000)
    check("search: the label's match first", (await page.locator("[data-settings-result]").first().getAttribute("data-settings-result")) === "line-numbers")
    await find.press("Enter")
    check("...Enter goes to it: search cleared, the row flashed", !!(await until(() => page.locator('[data-settings-row="line-numbers"].reveal-flash').count(), 4000)) && (await find.inputValue()) === "")
    await find.fill("zzqx")
    check("search: nothing found says so", !!(await until(async () => (await page.locator("main").innerText()).includes("No settings match"), 4000)))
    await find.fill("")

    // Plugins: gears.
    await go(page, "plugins")
    await until(() => page.locator("[data-plugin-gear]").count(), 4000)
    check("Plugins: a gear on a plugin with settings", await page.locator("[data-plugin-gear=page-preview]").count() === 1 && await page.locator("[data-plugin-gear=pages]").count() === 1)
    check("...none on one with nothing to set", await page.locator("[data-plugin-gear=outline]").count() === 0)
    check("...none on one that's off", await page.locator("[data-plugin-gear=properties]").count() === 0)
    check("...a vault plugin with declared settings has one", await page.locator("[data-plugin-gear=qa-tracker]").count() === 1)
    await page.locator("[data-plugin-row=page-preview]").scrollIntoViewIfNeeded()
    await shot(page, "2-plugins-gears")

    // A generated form: Page preview.
    await page.locator("[data-plugin-gear=page-preview]").click()
    await until(() => sheet(page, "page-preview").count(), 4000)
    const s = sheet(page, "page-preview")
    check("form: the declared settings, labelled", !!(await until(async () => (await s.locator("[data-setting]").count()) === 2 && (await s.innerText()).includes("Show a preview"), 4000)), await s.innerText())
    await s.locator("[role=radio]", { hasText: "Hover" }).click()
    check("form: a choice writes only its key", !!(await until(() => json(".vaultite/plugins/page-preview/data.json")?.trigger === "hover", 4000)), json(".vaultite/plugins/page-preview/data.json"))
    const delay = s.locator("[data-setting=delay] input")
    await delay.fill("99999"); await delay.press("Enter"); await wait(300)
    check("form: out of range says why and isn't saved", (await s.locator("[data-setting=delay]").innerText()).includes("at most 5000") && json(".vaultite/plugins/page-preview/data.json")?.delay === undefined,
      await s.locator("[data-setting=delay]").innerText())
    await delay.fill("300"); await delay.press("Enter")
    check("form: a number is saved", !!(await until(() => json(".vaultite/plugins/page-preview/data.json")?.delay === 300, 4000)), json(".vaultite/plugins/page-preview/data.json"))
    check("form: says where they're kept", (await s.locator("[data-settings-where]").innerText()).includes(".vaultite/plugins/page-preview/data.json"))
    await shot(page, "3-form-page-preview-desktop")
    await s.locator("[role=radio]", { hasText: "Auto" }).click()
    check("form: the default again removes the key", !!(await until(() => { const d = json(".vaultite/plugins/page-preview/data.json"); return d && !("trigger" in d) && d.delay === 300 }, 4000)),
      json(".vaultite/plugins/page-preview/data.json"))
    // A change on disk shows at once.
    writeFileSync(file(".vaultite/plugins/page-preview/data.json"), JSON.stringify({ delay: 750 }) + "\n")
    check("form: follows the file", !!(await until(async () => (await delay.inputValue()) === "750", 4000)), await delay.inputValue())
    await closeSheet(page)

    // A long choice unfolds in place: Search field's sort.
    await page.locator("[data-plugin-gear=search]").click()
    const ss = sheet(page, "search")
    await until(() => ss.count(), 4000)
    await ss.locator("[data-setting=sort] > button").click(); await wait(200)
    await ss.locator("[data-setting=sort] [role=radio]", { hasText: "Modified time (new to old)" }).click()
    check("form: a long choice unfolds and picks", !!(await until(() => json(".vaultite/plugins/search/data.json")?.sort === "modified", 4000)), json(".vaultite/plugins/search/data.json"))
    await closeSheet(page)

    // A custom panel: Pinned (through the command palette).
    await page.keyboard.press("ControlOrMeta+p"); await wait(300); await page.keyboard.type("pinned settings"); await wait(300)
    check("palette: \"Open <Name> settings\"", (await page.locator("[role=option]").allInnerTexts()).some((t) => t.includes("Open Pinned settings")), await page.locator("[role=option]").allInnerTexts())
    await page.keyboard.press("Enter")
    await until(() => sheet(page, "pages").count(), 4000)
    check("custom panel: Pinned's pages, there at once", (await sheet(page, "pages").locator("[data-page-row]").count()) >= 2)
    await shot(page, "4-panel-pinned-desktop")
    await closeSheet(page)

    // File explorer: Show hidden files moved here; the tree follows.
    await go(page, "plugins"); await until(() => page.locator("[data-plugin-gear=files]").count(), 4000)
    await page.locator("[data-plugin-gear=files]").click()
    const fs_ = sheet(page, "files")
    await until(() => fs_.count(), 4000)
    await fs_.locator("[data-setting=showHidden] [role=switch]").click()
    check("File explorer: Show hidden files writes files.json", !!(await until(() => json(".vaultite/files.json")?.showHidden === true, 4000)), json(".vaultite/files.json"))
    await shot(page, "5-panel-files-desktop")
    await closeSheet(page)
    check("...and the tree shows .vaultite", !!(await until(() => page.locator("aside [data-tree-path='.vaultite']").count(), 4000)))
    await page.locator("[data-plugin-gear=files]").click(); await until(() => fs_.count(), 4000)
    await fs_.locator("[data-setting=showHidden] [role=switch]").click()
    check("...off again: the key goes", !!(await until(() => !json(".vaultite/files.json")?.showHidden, 4000)), json(".vaultite/files.json"))
    await closeSheet(page)

    // No form: the file itself (Logs).
    await page.locator("[data-plugin-gear=logs]").click()
    await until(() => sheet(page, "logs").count(), 4000)
    check("no form: its data.json, drawn", !!(await until(async () => await sheet(page, "logs").locator("[data-settings-json] .json-view").count() >= 1 &&
      (await sheet(page, "logs").innerText()).includes("Running"), 4000)), await sheet(page, "logs").innerText())
    await shot(page, "6-json-logs-desktop")
    await sheet(page, "logs").locator("[data-settings-open]").click()
    check("...Open: the file in a tab, the sheet closed", !!(await until(async () => !(await page.locator("dialog[open]").count()) &&
      decodeURIComponent(await page.evaluate(() => location.hash)).includes(".vaultite/plugins/logs/data.json"), 4000)), await page.evaluate(() => location.hash))

    // A vault plugin's declared settings.
    await go(page, "plugins"); await until(() => page.locator("[data-plugin-gear=qa-tracker]").count(), 4000)
    await page.locator("[data-plugin-gear=qa-tracker]").click()
    const vs = sheet(page, "qa-tracker")
    await until(() => vs.count(), 4000)
    await vs.locator("[data-setting=tags] input").fill("Run, Outdoors"); await vs.locator("[data-setting=tags] input").press("Enter")
    check("vault plugin: its declared settings as a form", !!(await until(() => JSON.stringify(json(`${VP}/data.json`)?.tags) === '["Run","Outdoors"]', 4000)), json(`${VP}/data.json`))
    await closeSheet(page)

    // The plugin's own sheet says where it's kept: a vault plugin's folder (Open shows it in the tree), an app plugin's data.json.
    await page.locator("[data-plugin-row=qa-tracker]").click(); await wait(500)
    const vw = page.locator("dialog[open] [data-settings-where]")
    check("plugin sheet: a vault plugin's folder", (await vw.innerText()).includes(VP), await vw.innerText())
    await vw.locator("[data-settings-open]").click()
    check("...Open: the folder in the tree, the sheet closed", !!(await until(async () => !(await page.locator("dialog[open]").count()) &&
      await page.locator(`[data-tree-path="${VP}"]`).count(), 4000)))
    await go(page, "plugins"); await until(() => page.locator("[data-plugin-row=logs]").count(), 4000)
    await page.locator("[data-plugin-row=logs]").click(); await wait(500)
    check("plugin sheet: an app plugin's settings file", (await page.locator("dialog[open] [data-settings-where]").innerText()).includes(".vaultite/plugins/logs/data.json"))
    await closeSheet(page)

    // The plugin's own sheet has a Settings row; Workspaces' menu has Settings….
    await page.locator("[data-plugin-row=workspaces]").click(); await wait(500)
    await page.locator("dialog[open] [data-plugin-settings-open]").click()
    check("plugin sheet: Settings opens its settings, stacked", !!(await until(() => sheet(page, "workspaces").count(), 4000)) &&
      await page.locator("dialog[open] button[aria-label^='Back']").count() === 1)
    await sheet(page, "workspaces").locator("input[aria-label^='Name of workspace']").fill("Writing")
    await sheet(page, "workspaces").locator("input[aria-label^='Name of workspace']").press("Enter")
    check("Workspaces: naming the current one", !!(await until(() => workspaces(VAULT)[0]?.name === "Writing", 4000)))
    await shot(page, "7-panel-workspaces-desktop")
    await closeSheet(page)
    await page.locator("[data-workspace-switcher]").first().click({ button: "right" }); await wait(300)
    const items = await page.locator("[role=menu] button").allInnerTexts()
    check("Workspaces' menu: Settings…", items.some((t) => t.includes("Settings…")), items)
    await page.locator("[role=menu] button", { hasText: "Settings…" }).click()
    check("...opens its sheet", !!(await until(() => sheet(page, "workspaces").count(), 4000)))
    await page.keyboard.press("Escape")
    check("Settings is shorter than it was", tall < 2200, tall)
    await ctx.close()
  }

  // ---------- phone, 390px
  {
    const { ctx, page } = await open(390, 844, true)
    await page.goto(`${B}#settings`)
    await until(() => page.locator("[data-plugin-settings-open]").count(), 4000)
    await wait(500)
    await page.screenshot({ path: `${OUT}8-settings-phone.png`, fullPage: true })
    const wide = () => page.evaluate(() => { const d = document.querySelector("dialog[open]"); if (!d) return null
      return [...d.querySelectorAll("*")].filter((e) => e.getBoundingClientRect().right > innerWidth + 1 && e.getBoundingClientRect().width > 0).map((e) => e.outerHTML.slice(0, 80)) })
    for (const id of ["page-preview", "pages", "search"]) {
      await go(page, `settings/plugin-settings/${id}`)
      await until(() => sheet(page, id).count(), 4000); await wait(800)
      const r = await page.evaluate(() => { const d = document.querySelector("dialog[open]")?.getBoundingClientRect(); return d && { left: d.left, right: d.right, bottom: Math.round(d.bottom) } })
      check(`phone: ${id} is a bottom sheet across the screen`, !!r && r.left === 0 && r.right === 390 && r.bottom === 844, r)
      const over = await wide()
      check(`phone: nothing in ${id}'s sheet is wider than the screen`, over && !over.length, over)
      await shot(page, `9-${id}-phone`)
      await closeSheet(page)
    }
    await ctx.close()
  }
  noErrors()
} finally {
  for (const r of restore) r()
  putBackWs()
  rmSync(file(VP), { recursive: true, force: true })
  await browser.close()
}
await done()
