// Plugins' settings sheets (components/PluginSettings.tsx) and the Settings page's search, every way to open a sheet,
// 390px. Writes plugins.json, several plugins' settings and a vault plugin (put back / removed): throwaway server only.
//   node web/qa/pluginsettings.mjs <base url> <vault path> [out dir]
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { qa, until, wait } from "./lib/qa.mjs"
import { setAsideWorkspaces, workspaces } from "./lib/wsfiles.mjs"

/** One of the app's own plugins' settings, a part of the Settings section `section` (Files: Search field's). */
async function part(page, section, id) {
  await page.locator(`[data-settings-nav="${section}"]`).click()
  return page.locator(`[data-settings-section="${section}"] [data-settings-member="${id}"] [data-plugin-settings-sheet="${id}"]`)
}


const { args: [B, VAULT, OUT = "/tmp/pluginsettings-shots/"], browser, check, watch, noErrors, done } = await qa(import.meta.url)
mkdirSync(OUT, { recursive: true })
const file = (rel) => `${VAULT}/${rel}`
const json = (rel) => { try { return JSON.parse(readFileSync(file(rel), "utf8")) } catch { return null } }
const keep = (rel) => { const was = existsSync(file(rel)) ? readFileSync(file(rel), "utf8") : null; return () => { if (was === null) rmSync(file(rel), { force: true }); else writeFileSync(file(rel), was) } }
const restore = [keep(".vaultite/plugins.json"), keep(".vaultite/files.json"), keep(".vaultite/plugins/page-preview/data.json"),
  keep(".vaultite/plugins/search/data.json"), keep(".vaultite/plugins/logs/data.json")]
const putBackWs = setAsideWorkspaces(B)
const VP = ".vaultite/plugins/qa-tracker"

async function open(w, h, mobile = false) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, ...(mobile ? { isMobile: true, hasTouch: true } : {}) })
  return { ctx, page: watch(await ctx.newPage(), { label: w }) }
}
const sheet = (page, id) => page.locator(`dialog[open] [data-plugin-settings-sheet="${id}"]`)
/** A plugin's page in Settings, beside the menu (a computer's), and its settings drawn on it. */
const pluginPage = (page, id) => page.locator(`[data-settings-section="plugin:${id}"]`)
const onPage = (page, id) => pluginPage(page, id).locator(`[data-plugin-settings-sheet="${id}"]`)
/** Plugins, in Settings: a plugin's row opens its page there. */
async function openPage(page, id) {
  await go(page, "plugins"); await until(() => page.locator(`[data-plugin-row="${id}"]`).count(), 4000)
  await page.locator(`[data-plugin-row="${id}"]`).click({ force: true })
  await until(() => pluginPage(page, id).count(), 4000)
}
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
      where: { type: "string", folder: true, default: "Runs", label: "Folder", description: "where entries go" },
      dirs: { type: "list", folder: true, label: "Watched folders", description: "folders whose files count" },
    } }, null, 2))
  const plugins = json(".vaultite/plugins.json") ?? {}
  // Workspaces on (off by default): its sheet and its menu's Settings… are tested; Vim off (off by default): an off
  // plugin's settings are found, said off, and its switch is Editor's Vim keys; Logs and Browser on: gears.
  const on = ["qa-tracker", "logs", "web-viewer", "workspaces"]
  writeFileSync(file(".vaultite/plugins.json"), JSON.stringify({ ...plugins, enabled: [...(plugins.enabled ?? []).filter((id) => id !== "vim" && !on.includes(id)), ...on] }, null, 2))
  // (on in plugins.json alone it waits for this machine's yes: core/trust.ts)
  await fetch(`${B.replace(/\/+$/, "")}/api/ops/plugin.allow`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: "qa-tracker" }) })
  await wait(1500)

  // ---------- desktop
  {
    const { ctx, page } = await open(1440, 900)
    await go(page, "settings")
    await until(() => page.locator("[data-settings-list]").count(), 4000)
    const text = await page.locator("main").innerText()
    const nav = await page.locator("[data-settings-nav]").evaluateAll((els) => els.map((e) => e.dataset.settingsNav))
    check("Settings: General, its sections, AI, then Plugins and Get; no Features, no Bundles", (await page.locator("[data-settings-setup]").count()) === 2 &&
      ["general", "appearance", "editor", "files", "hotkeys", "terminal"].every((id, i) => nav[i] === id) && nav.indexOf("plugins") === nav.indexOf("get") - 1 &&
      nav.indexOf("ai") < nav.indexOf("plugins") && !nav.includes("bundles") &&
      !(await page.locator('[data-rail-fold="Features"]').count()) && !nav.some((n) => n.startsWith("plugin:")), nav)
    check("Settings: opens on Appearance", await page.locator('[data-settings-section="appearance"]').count() === 1)
    check("Settings: nothing a plugin adds", !["This workspace", "Pinned pages", "Show hidden files", "Connect an AI", "Vim's keys"].some((t) => text.includes(t)) &&
      !(await page.locator("main [data-workspace-settings], main [data-pinned-settings]").count()), text)
    await shot(page, "1-settings-desktop")
    const tall = await page.evaluate(() => document.querySelector("[data-settings] [data-rail-pane]").scrollHeight)
    await page.locator('[data-settings-nav="files"]').click()
    const members = async (sec) => page.locator(`[data-settings-section="${sec}"] [data-settings-member]`).evaluateAll((els) => els.map((e) => e.dataset.settingsMember))
    const files = await members("files")
    check("Files: the app's own plugins of its kind that have settings, each a part", ["files", "search", "pages", "recent"].every((id) => files.includes(id)), files)
    check("...not one with nothing to set", !files.includes("outline"))
    check("...nor one that can be switched (a gear away on Plugins)", !["web-viewer", "logs", "workspaces"].some((id) => files.includes(id)))
    check("...a long form a row to its sheet (Graph view)", (await page.locator('[data-settings-section="files"] button[data-settings-member="graph"]').count()) === 1)
    await page.locator('[data-settings-nav="general"]').click()
    const general = await members("general")
    check("General: File history and Errors, not Terminal (its own)", general.includes("history") && general.includes("errors") && !general.includes("terminal"), general)
    await page.locator('[data-settings-nav="terminal"]').click()
    check("Terminal: its settings, no title again", (await members("terminal")).includes("terminal") &&
      !(await page.locator('[data-settings-section="terminal"] [data-settings-member="terminal"]').innerText()).startsWith("Terminal"))
    await page.locator('[data-settings-nav="appearance"]').click()

    // Plugins and Get: sections of Settings, beside its menu (nothing in the menu leaves Settings).
    await page.locator('[data-settings-nav="plugins"]').click()
    check("Plugins: a section of Settings, lit in its menu", !!(await until(() => page.locator('main [data-settings-section="plugins"] [data-setup=plugins] [data-plugin-row]').count(), 4000)) &&
      (await page.evaluate(() => location.hash)) === "#settings" && (await page.locator('[data-settings-nav="plugins"]').getAttribute("aria-current")) === "page")
    check("...Plugin updates under the list, not in General", await page.locator('[data-settings-section="plugins"] [data-settings-row="plugin-updates"]').count() === 1)
    await page.locator('[data-settings-nav="get"]').click()
    check("Get: a section too, its categories as chips", !!(await until(() => page.locator('main [data-settings-section="get"] [data-setup=get]').count(), 4000)) &&
      (await page.evaluate(() => location.hash)) === "#settings")
    await go(page, "plugins")
    check("...#plugins (an old tab, a link) is Settings on Plugins", !!(await until(async () => (await page.evaluate(() => location.hash)) === "#settings" &&
      await page.locator('main [data-settings-section="plugins"]').count(), 4000)), await page.evaluate(() => location.hash))
    await shot(page, "1a-your-setup")
    await go(page, "settings")
    await until(() => page.locator("[data-settings-list]").count(), 4000)
    // Settings' search finds Setup's tabs, a page away.
    await page.locator("[data-settings-search] input").fill("plugins")
    await until(() => page.locator('[data-settings-result="plugins"]').count(), 4000)
    check("search: Plugins, on Plugins", (await page.locator('[data-settings-result="plugins"]').innerText()).includes("Plugins"))
    await page.locator('[data-settings-result="plugins"] button').first().click()
    check("...goes to Settings' Plugins", !!(await until(() => page.locator('main [data-settings-section="plugins"] [data-plugin-row]').count(), 4000)))
    await go(page, "settings")
    await until(() => page.locator("[data-settings-list]").count(), 4000)
    await page.locator('[data-settings-nav="appearance"]').click()

    // Search: the app's rows (going to one clears the search and flashes it) and every plugin's settings, its manifest's
    // and its panel's (settingsSearch), even one that's off; one opens its sheet at the setting.
    const find = page.locator("[data-settings-search] input")
    const result = (id) => page.locator(`[data-settings-result="${id}"]`)
    await find.fill("hidden")
    check("search: Show hidden files, in File explorer's panel", !!(await until(() => result("plugin:files:showHidden").count(), 4000)) &&
      (await result("plugin:files:showHidden").innerText()).includes("File explorer") && !(await page.locator("[data-settings-list]").count()) &&
      await page.locator('[data-settings-section="appearance"]').count() === 1)
    await shot(page, "1c-settings-search")
    await result("plugin:files:showHidden").click()
    check("...shows Files beside the list, the setting flashed", !!(await until(() => page.locator('[data-settings-section="files"] [data-plugin-settings-sheet="files"] [data-setting="showHidden"].reveal-flash').count(), 4000)))
    check("...the search kept, the find lit", (await find.inputValue()) === "hidden" && (await result("plugin:files:showHidden").getAttribute("aria-selected")) === "true")
    await find.fill("delay")
    check("search: a manifest's setting (Page preview's)", !!(await until(() => result("plugin:page-preview:delay").count(), 4000)))
    await find.fill("vimrc")
    check("search: an off plugin's panel setting, said off", !!(await until(() => result("plugin:vim:vimrc").count(), 4000)) && (await result("plugin:vim:vimrc").innerText()).includes("(off)"))
    await find.fill("vim")
    check("search: Vim keys, in Editor", !!(await until(() => result("plugin-vim").count(), 4000)) && (await result("plugin-vim").innerText()).includes("Editor"))
    await result("plugin-vim").click()
    const vimRow = page.locator('[data-settings-section="editor"] [data-settings-row="plugin-vim"]')
    check("...shows Editor, the row flashed", !!(await until(() => vimRow.and(page.locator(".reveal-flash")).count(), 4000)) && (await result("plugin-vim").getAttribute("aria-selected")) === "true")
    await vimRow.getByRole("switch").click()
    check("...its switch turns Vim on (plugins.json's enabled), a gear to its settings", !!(await until(() => json(".vaultite/plugins.json")?.enabled?.includes("vim"), 4000)) &&
      !!(await until(() => vimRow.locator("[data-plugin-gear=vim]").count(), 4000)))
    await shot(page, "1d-settings-editor-vim")
    await vimRow.getByRole("switch").click()
    check("...and off", !!(await until(() => !json(".vaultite/plugins.json")?.enabled?.includes("vim"), 4000)))
    await find.fill("line num")
    await until(() => result("line-numbers").count(), 4000)
    check("search: the label's match first", (await page.locator("[data-settings-result]").first().getAttribute("data-settings-result")) === "line-numbers")
    await find.press("Enter")
    check("...Enter goes to it, lit, the row flashed", !!(await until(() => page.locator('[data-settings-row="line-numbers"].reveal-flash').count(), 4000)) &&
      (await result("line-numbers").getAttribute("aria-selected")) === "true")
    await find.fill("font")
    await until(() => page.locator("[data-settings-result]").count(), 4000)
    const second = await page.locator("[data-settings-result]").nth(1).getAttribute("data-settings-result")
    await find.press("ArrowDown"); await find.press("ArrowDown")
    check("...the arrows light the next find", !!(await until(async () => (await result(second).getAttribute("aria-selected")) === "true", 4000)) &&
      !(await page.locator("dialog[open]").count()))
    await find.fill("zzqx")
    check("search: nothing found says so", !!(await until(async () => (await page.locator("main").innerText()).includes("No settings match"), 4000)))
    await find.fill("")
    check("...cleared, the menu is back", !!(await until(() => page.locator("[data-settings-list]").count(), 4000)))

    // Plugins: a row goes to the plugin's page, its settings on it.
    await go(page, "plugins")
    await until(() => page.locator("[data-plugin-row]").count(), 4000)
    check("Plugins: no gears, Vim's not here (its switch is in Editor)", await page.locator("main [data-settings-section=plugins] [data-plugin-gear]").count() === 0 && await page.locator("[data-plugin-row=vim]").count() === 0)
    await page.locator("[data-plugin-row=web-viewer]").scrollIntoViewIfNeeded()
    await shot(page, "2-plugins")
    await openPage(page, "web-viewer")
    check("...a row opens its page in Settings, its settings on it, Plugins still lit", !!(await until(() => onPage(page, "web-viewer").count(), 4000)) &&
      !(await page.locator("dialog[open]").count()) && (await page.locator('[data-settings-nav="plugins"]').getAttribute("aria-current")) === "page")
    await page.locator("[data-settings-crumb=plugins]").click()
    check("...its crumb goes back to Plugins", !!(await until(() => page.locator('main [data-settings-section="plugins"]').count(), 4000)))
    await openPage(page, "ai-import")
    check("...one that's off: its switch, no settings", await pluginPage(page, "ai-import").locator("[data-plugin-switch]").count() === 1 && !(await onPage(page, "ai-import").count()))

    // A generated form: Page preview's sheet (a plugin that can be turned off: a gear away on Plugins).
    await go(page, "settings/plugin-settings/page-preview")
    const s = sheet(page, "page-preview")
    check("form: Page preview's sheet", !!(await until(() => s.count(), 4000)))
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
    const ss = await part(page, "files", "search")
    await until(() => ss.count(), 4000)
    await ss.locator("[data-setting=sort] > button").click(); await wait(200)
    await ss.locator("[data-setting=sort] [role=radio]", { hasText: "Modified time (new to old)" }).click()
    check("form: a long choice unfolds and picks", !!(await until(() => json(".vaultite/plugins/search/data.json")?.sort === "modified", 4000)), json(".vaultite/plugins/search/data.json"))

    // A custom panel: Pinned (through the command palette).
    await page.keyboard.press("ControlOrMeta+p"); await wait(300); await page.keyboard.type("pinned settings"); await wait(300)
    check("palette: \"Open <Name> settings\"", (await page.locator("[role=option]").allInnerTexts()).some((t) => t.includes("Open Pinned settings")), await page.locator("[role=option]").allInnerTexts())
    await page.keyboard.press("Enter")
    await until(() => sheet(page, "pages").count(), 4000)
    check("custom panel: Pinned's pages, there at once", (await sheet(page, "pages").locator("[data-page-row]").count()) >= 2)
    // (its options first: a list that grows mustn't push them out of sight)
    check("custom panel: after the options, Show pinned pages as above the pages", await sheet(page, "pages").locator('[data-setting="show"]').evaluate((el) =>
      !!(el.compareDocumentPosition(el.closest("dialog").querySelector("[data-pinned-settings]")) & Node.DOCUMENT_POSITION_FOLLOWING)).catch(() => false))
    await shot(page, "4-panel-pinned-desktop")
    await closeSheet(page)

    // File explorer: Show hidden files is here (Files); the tree follows.
    await go(page, "settings"); await until(() => page.locator("[data-settings-list]").count(), 4000)
    const fs_ = await part(page, "files", "files")
    await until(() => fs_.count(), 4000)
    await fs_.locator("[data-setting=showHidden] [role=switch]").click()
    check("File explorer: Show hidden files writes files.json", !!(await until(() => json(".vaultite/files.json")?.showHidden === true, 4000)), json(".vaultite/files.json"))
    await shot(page, "5-panel-files-desktop")
    check("...and the tree shows .vaultite", !!(await until(() => page.locator("aside [data-tree-path='.vaultite']").count(), 4000)))
    await fs_.locator("[data-setting=showHidden] [role=switch]").click()
    check("...off again: the key goes", !!(await until(() => !json(".vaultite/files.json")?.showHidden, 4000)), json(".vaultite/files.json"))

    // No form: the file itself (Logs).
    await openPage(page, "logs")
    check("no form: its data.json, drawn", !!(await until(async () => await onPage(page, "logs").locator("[data-settings-json] .json-view").count() >= 1 &&
      (await onPage(page, "logs").innerText()).includes(json(".vaultite/plugins/logs/data.json").areas[0].name), 4000)), await pluginPage(page, "logs").innerText())
    await shot(page, "6-json-logs-desktop")
    await pluginPage(page, "logs").locator("[data-settings-where] [data-settings-open]").click()
    check("...Open: the file in a tab", !!(await until(async () =>
      decodeURIComponent(await page.evaluate(() => location.hash)).includes(".vaultite/plugins/logs/data.json"), 4000)), await page.evaluate(() => location.hash))

    // A vault plugin's declared settings.
    await openPage(page, "qa-tracker")
    const vs = onPage(page, "qa-tracker")
    await until(() => vs.count(), 4000)
    await vs.locator("[data-setting=tags] input").fill("Run, Outdoors"); await vs.locator("[data-setting=tags] input").press("Enter")
    check("vault plugin: its declared settings as a form", !!(await until(() => JSON.stringify(json(`${VP}/data.json`)?.tags) === '["Run","Outdoors"]', 4000)), json(`${VP}/data.json`))

    // A folder setting: the vault's folders, fuzzy, in a palette over the sheet; one typed that isn't there is made.
    const some = readdirSync(VAULT, { withFileTypes: true }).find((d) => d.isDirectory() && !d.name.startsWith("."))?.name ?? ""
    await vs.locator("[data-setting=where] [data-folder-field]").click()
    const pal = page.locator("[role=dialog][aria-label=Folder]")
    check("folder setting: a palette of folders over the sheet", !!(await until(() => pal.count(), 3000)) && await pal.locator("input").evaluate((el) => el === document.activeElement))
    await page.keyboard.type(some.slice(0, 3))
    await until(async () => (await pal.innerText()).includes(some), 2000)
    await page.keyboard.press("Enter")
    check("...picked, it's set", !!(await until(() => json(`${VP}/data.json`)?.where === some, 4000)), [some, json(`${VP}/data.json`)])
    await shot(page, "folder-setting")
    await vs.locator("[data-setting=dirs] [data-folder-add]").click()
    const pal2 = page.locator("[role=dialog][aria-label='Watched folders']")
    await until(() => pal2.count(), 3000)
    await page.keyboard.type("QA made/Deep")
    check("...one typed that isn't there: New folder", !!(await until(async () => (await pal2.innerText()).includes("New folder"), 2000)))
    await page.keyboard.press("Shift+Enter")
    check("...made, and added to the list", !!(await until(() => JSON.stringify(json(`${VP}/data.json`)?.dirs) === '["QA made/Deep"]' && existsSync(file("QA made/Deep")), 4000)), json(`${VP}/data.json`))
    writeFileSync(file(`${VP}/data.json`), JSON.stringify({ ...json(`${VP}/data.json`), where: "Nowhere here" }))
    check("...one set that isn't there says so", !!(await until(async () => (await vs.locator("[data-setting=where]").innerText()).includes("There's no folder Nowhere here"), 4000)))
    await vs.locator("[data-setting=dirs] button[aria-label='Remove QA made/Deep']").click()
    await vs.locator("[data-setting=where] button[aria-label^=Clear]").click()
    check("...removed and cleared", !!(await until(() => { const d = json(`${VP}/data.json`) ?? {}; return d.where === undefined && !d.dirs }, 4000)), json(`${VP}/data.json`))
    rmSync(file("QA made"), { recursive: true, force: true })

    // The plugin's page says where it's kept: a vault plugin's folder (Open shows it in the tree), an app plugin's data.json.
    const vw = pluginPage(page, "qa-tracker").locator("[data-settings-where]").last()
    check("plugin page: a vault plugin's folder", (await vw.innerText()).includes(VP), await vw.innerText())
    await vw.locator("[data-settings-open]").click()
    check("...Open: the folder in the tree", !!(await until(() => page.locator(`[data-tree-path="${VP}"]`).count(), 4000)))
    await openPage(page, "logs")
    check("plugin page: an app plugin's settings file", (await pluginPage(page, "logs").locator("[data-settings-where]").innerText()).includes(".vaultite/plugins/logs/data.json"))

    // Workspaces' page has its settings right there (its own panel); its menu has Settings….
    await go(page, "plugins"); await until(() => page.locator("[data-plugin-row=workspaces]").count(), 4000)
    await page.locator("[data-plugin-row=workspaces]").click({ force: true })
    await until(() => pluginPage(page, "workspaces").count(), 4000)
    const wsSwitch = pluginPage(page, "workspaces").locator("[data-plugin-switch] [role=switch]")
    if ((await wsSwitch.getAttribute("aria-checked")) !== "true") await wsSwitch.click()
    check("plugin page: on, its settings on the page", !!(await until(() => onPage(page, "workspaces").locator("input[aria-label^='Name of workspace']").count(), 4000)))
    await onPage(page, "workspaces").locator("input[aria-label^='Name of workspace']").fill("Writing")
    await onPage(page, "workspaces").locator("input[aria-label^='Name of workspace']").press("Enter")
    check("Workspaces: naming the current one", !!(await until(() => workspaces(B)[0]?.name === "Writing", 4000)))
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
    await until(() => page.locator("[data-settings-list]").count(), 4000)
    await wait(500)
    await page.screenshot({ path: `${OUT}8-settings-phone.png`, fullPage: true })
    const navRow = await page.$eval("[data-settings-nav=appearance]", (e) => { const r = e.getBoundingClientRect(); return { h: Math.round(r.height), text: Math.round(parseFloat(getComputedStyle(e).fontSize) * (parseFloat(getComputedStyle(e.closest("[data-size-up]") ?? e).zoom) || 1)) } })
    check("phone: Settings' rows a finger tall, 16px, as the sidebar's lists", navRow.h >= 40 && navRow.text === 16, navRow)
    await page.locator('[data-settings-setup][data-settings-nav="plugins"]').click()
    check("phone: Plugins goes to its own page", !!(await until(() => page.evaluate(() => location.hash.startsWith("#plugins")), 4000)), await page.evaluate(() => location.hash))
    await until(() => page.locator("[data-setup-tab=plugins]").count(), 4000)
    const tabH = await page.locator("[data-setup-tab=plugins]").evaluate((e) => e.getBoundingClientRect().height)
    check("phone: Setup's tabs are a finger tall", tabH >= 40, tabH)
    await page.screenshot({ path: `${OUT}8a-setup-phone.png`, fullPage: true })
    await page.locator("[data-setup-tab=get]").click()
    check("phone: its Get tab", !!(await until(() => page.evaluate(() => location.hash.startsWith("#get")), 4000)), await page.evaluate(() => location.hash))
    await page.locator("[data-setup-tab=plugins]").click()
    check("phone: its Plugins tab", !!(await until(() => page.evaluate(() => location.hash.startsWith("#plugins")), 4000)), await page.evaluate(() => location.hash))
    check("phone: Plugins has its search and Filter, no menu", !!(await until(() => page.locator("[data-plugins] [data-plugins-search] input").count(), 4000)) &&
      await page.locator("[data-plugins-filter]").count() === 1 && !(await page.locator("[data-rail]").count()))
    await page.screenshot({ path: `${OUT}8b-setup-plugins-phone.png`, fullPage: true })
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
