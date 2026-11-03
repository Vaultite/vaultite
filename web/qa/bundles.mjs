// Layouts (core/bundles.ts, components/LayoutPicker.tsx, pages/Bundles.tsx): a new vault's start and its welcome, the
// picker in Settings > Appearance (one click, Undo), Save as new, Share, Import from Get. The fresh server serves a
// folder the app never opened. WRITES settings and bundles: throwaway servers only.
//   node web/qa/bundles.mjs <base url> <vault path> <fresh base url> <fresh vault path> [out dir]
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { ROOT, qa, until, wait } from "./lib/qa.mjs"

const { args: [B, VAULT, FB, FVAULT, OUT = "/tmp/bundles-shots/"], browser, check, watch, done } = await qa(import.meta.url)
mkdirSync(OUT, { recursive: true })
const json = (vault, rel) => { try { return JSON.parse(readFileSync(`${vault}/${rel}`, "utf8")) } catch { return null } }
const settings = (vault) => Object.fromEntries(["plugins", "sidebars", "pages", "appearance"].map((n) => [n, json(vault, `.vaultite/${n}.json`)]))

async function open(w, h, mobile = false) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, acceptDownloads: true, ...(mobile ? { isMobile: true, hasTouch: true } : {}) })
  return { ctx, page: watch(await ctx.newPage(), { label: w }) }
}
const shot = async (page, name) => { await wait(700); await page.screenshot({ path: `${OUT}${name}.png` }) }
async function go(page, base, h) {
  await page.goto("about:blank")
  await page.goto(`${base}${h ? `#${h}` : ""}`)
  await until(() => page.locator("main").count(), 6000)
  await wait(1500)
  await notNow(page)
}
/** A plugin asking to write on its own (core/grants.ts): Not now, so it doesn't cover the page. */
async function notNow(page) {
  for (let i = 0; i < 5 && await page.locator("dialog[open][data-confirm]", { hasText: "wants to write" }).count(); i++) {
    await page.locator("dialog[open][data-confirm] button:not([data-confirm-ok])").first().click()
    await wait(300)
  }
}
const toastWith = (page, text) => page.locator("[data-sonner-toast]", { hasText: text }).first()
/** A bundle installing Vaultite's own plugins (Days, as the directory's Life OS: Books...): its ask (none once they're
 *  there), said yes to. */
async function installs(page, first = "Books") {
  const ask = page.locator("dialog[open][data-confirm]", { hasText: `Install ${first}` })
  await until(async () => (await ask.count()) || (await page.locator("[data-sonner-toast]", { hasText: "Applied" }).count()), 6000)
  if (await ask.count()) await ask.locator("[data-confirm-ok]").click()
}
/** Settings > Appearance, its layouts drawn. */
async function picker(page, base) {
  await go(page, base, "settings")
  // (a narrow pane lists the sections: Appearance opens as a sheet)
  await until(() => page.locator("[data-layout-pick], [data-settings-list]").count(), 8000)
  if (!(await page.locator("[data-settings-section] [data-layout-pick]").count())) await page.locator("[data-settings-nav=appearance]").first().click()
  await until(() => page.locator("[data-layout-pick]").count() >= 3, 8000)
}
const current = (page) => page.locator('[data-layout-pick][aria-checked="true"]').evaluateAll((els) => els.map((e) => e.dataset.layoutPick))
/** A tile's menu item (Details…, Save as new…, Share…). */
async function tileMenu(page, id, item) {
  await notNow(page)
  await page.locator(`[data-layout="${id}"]`).hover()
  await page.locator(`[data-layout-more="${id}"]`).click()
  await page.locator("[role=menu] [role=menuitem]", { hasText: item }).first().click()
}
const dismissAll = async (page) => { await page.mouse.move(5, 5); await page.waitForFunction(() => !document.querySelector("[data-sonner-toast]"), null, { timeout: 30_000 }).catch(() => {}); await wait(100) }
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)

// ---------- 1. A new vault: Standard; a layout picked in Settings; the welcome ----------
{
  const { ctx, page } = await open(1600, 900)
  await go(page, FB)
  // (no Start here note unless setup asked for one: core/start.ts writes only .vaultite/)
  check("a new vault opens on Standard, not the welcome: nothing pinned, no note written", decodeURIComponent(await page.evaluate(() => location.hash)) !== "#welcome"
    && JSON.stringify(settings(FVAULT).pages?.pinned) === "[]" && !existsSync(`${FVAULT}/Start here.md`) && !(settings(FVAULT).plugins?.enabled ?? []).includes("people"), settings(FVAULT))
  await shot(page, "new-vault-standard")
  await picker(page, FB)
  const ids = await page.locator("[data-layout-pick]").evaluateAll((els) => els.map((e) => e.dataset.layoutPick))
  check("Settings > Appearance opens on the layouts: the three built in, Standard first", ids.join() === "standard,zen,browser" &&
    await page.locator("[data-layout-picker]").count() === 1, ids)
  check("a new vault: Standard is the one in use", (await current(page)).join() === "standard", await current(page))
  const drawn = await page.locator("[data-layout-drawing]").evaluateAll((els) => els.map((e) => e.dataset.layoutDrawing))
  check("each built-in its own drawing, its description in its tip", drawn.join() === "standard,zen,browser" &&
    /browser/i.test(await page.locator('[data-layout-pick="browser"]').getAttribute("data-tip")), drawn)
  await shot(page, "picker-new-vault")
  await page.locator('[data-layout-pick="browser"]').click()
  check("a click checks it at once", (await current(page)).join() === "browser")
  await until(() => toastWith(page, "Applied Browser").count(), 10_000)
  check("applied: a toast with Undo, nothing asked (it installs nothing)", await toastWith(page, "Applied Browser").isVisible() && (await toastWith(page, "Applied Browser").locator("[data-button]").innerText()) === "Undo" &&
    !(await page.locator("dialog[open][data-confirm]").count()))
  check("Settings stays in front, its guide added in a tab behind", (await page.evaluate(() => location.hash)).startsWith("#settings") && existsSync(`${FVAULT}/Guides/How Browser works.md`) &&
    (await toastWith(page, "Applied Browser").innerText()).includes("guide"), await page.evaluate(() => location.hash))
  const s = settings(FVAULT)
  check("applied: Browser's panels, plugins, look and new tab", s.sidebars?.left?.join() === "pages:pages,tabs:tabs" && s.sidebars?.right?.join() === "backlinks:links" &&
    ["glance", "web-viewer", "workspaces"].every((id) => s.plugins?.enabled?.includes(id)) && s.appearance?.tabBar === false &&
    json(FVAULT, ".vaultite/newtab.json")?.opens === "switcher" && json(FVAULT, ".vaultite/plugins/tabs/data.json")?.archive_after === "12h", [s, json(FVAULT, ".vaultite/newtab.json")])
  await wait(1200)
  await shot(page, "after-browser-new-vault")
  // A vault still offered a layout (just created): it opens on the welcome, its tiles the built-ins with no menus.
  writeFileSync(`${FVAULT}/.vaultite/bundles/onboarding.json`, "{}\n")
  await go(page, FB)
  await until(() => page.evaluate(() => location.hash === "#welcome"), 6000)
  // (a tab kept drawn behind this one has its own h1, hidden: the shown page's is the visible one)
  check("offered: it opens on the welcome, without Setup's tabs", (await page.locator("main h1:visible").first().innerText()).includes("Welcome") &&
    !(await page.locator("[data-setup-tab]").count()), await page.locator("main h1:visible").first().innerText())
  await until(() => page.locator("[data-bundles-welcome] [data-layout-pick]").count() === 3, 6000)
  check("offered: the three layouts, no menus, a quiet line imports one", !(await page.locator("[data-bundles-welcome] [data-layout-more]").count())
    && await page.locator("[data-bundles-welcome-import]").count() === 1 && await page.locator("[data-bundles-continue]").count() === 1)
  await shot(page, "welcome")
  await page.locator('[data-bundles-welcome] [data-layout-pick="zen"]').click()
  await until(() => settings(FVAULT).appearance?.rails === false, 8000)
  await wait(500)
  check("picked there: applied, nothing opened, the offer ended", (await page.evaluate(() => location.hash)) === "#welcome" && !existsSync(`${FVAULT}/.vaultite/bundles/onboarding.json`),
    await page.evaluate(() => location.hash))
  await page.locator("[data-bundles-continue]").click()
  await until(() => page.evaluate(() => location.hash !== "#welcome"), 6000)
  check("Continue: the welcome goes, Zen stays", (await page.evaluate(() => location.hash)) !== "#welcome" && settings(FVAULT).appearance?.rails === false)
  // Continue without a pick starts from the default, as a new vault does.
  writeFileSync(`${FVAULT}/.vaultite/bundles/onboarding.json`, "{}\n")
  await go(page, FB, "welcome")
  await until(() => page.locator("[data-bundles-continue]").count(), 6000)
  await page.locator("[data-bundles-continue]").click()
  await until(() => !existsSync(`${FVAULT}/.vaultite/bundles/onboarding.json`), 6000)
  const m = settings(FVAULT)
  check("Continue with no pick: Standard's plugins (Claude Code on)", !(m.plugins?.enabled ?? []).includes("workspaces") && !m.plugins?.disabled?.includes("claude-code"), m.plugins)
  await ctx.close()
}

// ---------- 2. Each built-in layout on a copy of examples/vault, and Days, one of the user's installing plugins ----------
cpSync(`${ROOT}/tools/fixtures/bundles/days`, `${VAULT}/.vaultite/bundles/days`, { recursive: true })
const { ctx, page } = await open(1600, 900)
const original = settings(VAULT)
await picker(page, B)
await until(() => page.locator('[data-layout-pick="days"]').count(), 6000)
check("the built-ins, then the user's own", (await page.locator("[data-layout-pick]").evaluateAll((els) => els.map((e) => e.dataset.layoutPick))).slice(0, 4).join() === "standard,zen,browser,days")
check("the user's own drawn from what it sets", await page.locator('[data-layout="days"] [data-layout-drawing="drawn"]').count() === 1)
const tiles = await page.locator("[data-layout]").evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().height)))
check("tiles are one height", tiles.length >= 4 && new Set(tiles).size === 1, tiles)
await shot(page, "picker")
const PAGES = "Dashboards/" // (a bundle's pages, and its plugins', go in the vault's pages folder)
const want = {
  "standard": (s) => !s.pages.pinned.some((p) => p.includes("Dashboards/Today")) && s.appearance.fileIcons === false && !(s.plugins.enabled ?? []).includes("people") && s.sidebars.right.includes("backlinks:links"),
  "days": (s) => s.pages.pinned[0] === `${PAGES}Today.md` && s.pages.pinned[1] === `${PAGES}Home.md` && existsSync(`${VAULT}/${PAGES}Home.md`) && s.appearance.density === "comfortable",
  // (a value that's the app's default is written as no key: paneTitles is off by default)
  "zen": (s) => s.appearance.rails === false && s.appearance.tabBar === false && !s.appearance.paneTitles && s.sidebars.left.includes("tabs:tabs") && s.appearance.snippets?.includes("Floating panes"),
  // (Zen's floating panes go with it; Days' Home, an imported bundle's page, is unpinned)
  "browser": (s) => s.sidebars.left.join() === "pages:pages,tabs:tabs" && !s.appearance.snippets?.length && !s.pages.pinned.includes(`${PAGES}Home.md`),
}
for (const id of Object.keys(want)) {
  await picker(page, B)
  // Details: the preview says what applying it changes (the tile's own click just applies)
  await tileMenu(page, id, "Details…")
  const sheet = page.locator(`dialog[open] [data-bundle-preview="${id}"]`)
  await until(() => sheet.count(), 6000)
  await until(() => page.locator("dialog[open] [data-bundle-apply]").count(), 6000)
  const text = await sheet.innerText()
  check(`${id}: Details says what changes`, /Plugins|Sidebars|Pinned pages|Look/.test(text), text.slice(0, 200))
  if (id !== "standard") await shot(page, `preview-${id}`)
  await page.keyboard.press("Escape")
  await until(async () => !(await sheet.count()), 6000)
  await picker(page, B)
  await page.locator(`[data-layout-pick="${id}"]`).click()
  if (id === "days") await installs(page)
  await until(() => page.locator("[data-sonner-toast]", { hasText: "Applied" }).count(), 8000)
  await until(() => { const s = settings(VAULT); try { return want[id](s) } catch { return false } }, 6000)
  const s = settings(VAULT)
  let ok = false
  try { ok = want[id](s) } catch { /* below */ }
  check(`${id}: applied with one click`, ok, s)
  check(`${id}: plugins.json's other keys are left alone`, JSON.stringify(Object.keys(s.plugins).filter((k) => !["disabled", "enabled"].includes(k))) === JSON.stringify(Object.keys(original.plugins ?? {}).filter((k) => !["disabled", "enabled"].includes(k))), s.plugins)
  if (id !== "standard") { await wait(1500); await shot(page, `after-${id}`) }
  await dismissAll(page)
}

// ---------- 3. Undo, and Restore previous layout ----------
{
  const before = JSON.stringify(settings(VAULT))
  await picker(page, B)
  await page.locator('[data-layout-pick="standard"]').click()
  const t = toastWith(page, "Applied Standard")
  await until(() => t.count(), 6000)
  await t.locator("[data-button]").click()
  await until(() => JSON.stringify(settings(VAULT)) === before, 6000)
  check("Undo puts every settings file back", JSON.stringify(settings(VAULT)) === before, [JSON.parse(before), settings(VAULT)])
  await until(async () => (await current(page)).join() === "browser", 6000)
  check("and the picker's check with it", (await current(page)).join() === "browser", await current(page))
  await dismissAll(page)
  await page.locator('[data-layout-pick="days"]').click()
  await installs(page)
  await until(() => toastWith(page, "Applied Days").count(), 6000)
  await dismissAll(page)
  await page.keyboard.press("ControlOrMeta+p")
  await page.keyboard.type("Restore previous layout")
  await wait(400)
  await page.keyboard.press("Enter")
  await until(() => JSON.stringify(settings(VAULT)) === before, 6000)
  check("the palette's Restore previous layout puts it back", JSON.stringify(settings(VAULT)) === before, settings(VAULT))
  await dismissAll(page)
}

// ---------- 4. Save as new, share, import ----------
await fetch(`${B}api/bundles/days`, { method: "DELETE" }) // (none of the user's from here)
{
  await picker(page, B)
  await tileMenu(page, "browser", "Save as new…")
  const field = page.locator("[data-palette] input[role=combobox]")
  await until(() => field.count(), 6000)
  check("Save as new asks for a name, suggesting one from the layout in use", /^My Browser/.test(await field.inputValue()), await field.inputValue())
  await shot(page, "save-name")
  await field.fill("QA desk")
  await page.keyboard.press("Enter")
  await until(() => existsSync(`${VAULT}/.vaultite/bundles/qa-desk/bundle.json`), 6000)
  check("it writes the layout", json(VAULT, ".vaultite/bundles/qa-desk/bundle.json")?.name === "QA desk" && !!json(VAULT, ".vaultite/bundles/qa-desk/plugins.json"))
  await until(() => page.locator('[data-layout-pick="qa-desk"]').count(), 6000)
  check("its tile comes after the built-ins, the one in use", await page.locator('[data-layout-pick="qa-desk"]').count() === 1 && (await current(page)).join() === "qa-desk", await current(page))
  // Share: what it sends, Save file, Copy and Copy for an agent; then Import from Get, pasted and from a file.
  await tileMenu(page, "qa-desk", "Share…")
  await until(() => page.locator("dialog[open] [data-bundle-share-sheet]").count(), 6000)
  await until(() => page.locator("dialog[open] [data-bundle-export]:not([disabled])").count(), 6000)
  await shot(page, "share")
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 8000 }), page.locator("dialog[open] [data-bundle-export]").click()])
  const path = `${OUT}qa-desk.bundle.json`
  await dl.saveAs(path)
  const exp = JSON.parse(readFileSync(path, "utf8"))
  check("Share's Save file downloads one JSON file, without a picture", dl.suggestedFilename() === "qa-desk.bundle.json" && exp.vaultite === "bundle" && !!exp.files["plugins.json"] &&
    !exp.files["preview.png"], dl.suggestedFilename())
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(B).origin })
  await page.locator("dialog[open] [data-bundle-copy-agent]").click()
  await wait(300)
  const clip = await page.evaluate(() => navigator.clipboard.readText())
  check("Copy for an agent: what to do, then the bundle", /vau bundle import/.test(clip) && /Don't apply it until I say so/.test(clip) && clip.includes('"vaultite": "bundle"'), clip.slice(0, 200))
  await page.locator("dialog[open] [data-bundle-copy]").click()
  await wait(300)
  const copied = await page.evaluate(() => navigator.clipboard.readText())
  check("Copy: the bundle's JSON", JSON.parse(copied).vaultite === "bundle")
  await page.keyboard.press("Escape")
  await until(async () => !(await page.locator("dialog[open] [data-bundle-share-sheet]").count()), 6000)
  await dismissAll(page)
  // Import from Get: pasted (inside a message), its preview first, then Add.
  const incoming = "dialog[open] [data-bundle-incoming]"
  await go(page, B, "get")
  await until(() => page.locator("[data-bundles-import]").count(), 6000)
  await page.locator("[data-bundles-import]").click()
  await until(() => page.locator("dialog[open] [data-bundle-import-text]").count(), 6000)
  await page.locator("dialog[open] [data-bundle-import-text]").fill(`Here it is:\n${copied}`)
  await shot(page, "import")
  await page.locator("dialog[open] [data-bundle-import]").click()
  await until(() => page.locator(`${incoming} [data-bundle-incoming-add]`).count(), 6000)
  check("Import shows its preview first, nothing added yet", !existsSync(`${VAULT}/.vaultite/bundles/qa-desk-2`) && /Plugins|Sidebars|Pinned pages|Look|Applying it changes nothing/.test(await page.locator(incoming).innerText()))
  await shot(page, "import-preview")
  await page.locator(`${incoming} [data-bundle-incoming-add]`).click()
  await until(() => existsSync(`${VAULT}/.vaultite/bundles/qa-desk-2/bundle.json`), 6000)
  check("Add, from the preview, adds it under a free id", existsSync(`${VAULT}/.vaultite/bundles/qa-desk-2/bundle.json`))
  await picker(page, B)
  await until(() => page.locator('[data-layout-pick="qa-desk-2"]').count(), 6000)
  check("and its tile shows in the picker", await page.locator('[data-layout-pick="qa-desk-2"]').count() === 1)
  await dismissAll(page)
  await go(page, B, "get")
  await until(() => page.locator("[data-bundles-import]").count(), 6000)
  await page.locator("[data-bundles-import]").click()
  await until(() => page.locator("dialog[open] [data-bundle-import-form]").count(), 6000)
  await page.locator("dialog[open] input[type=file]").setInputFiles(path)
  await until(() => page.locator(`${incoming} [data-bundle-incoming-add]`).count(), 6000)
  await page.locator(`${incoming} [data-bundle-incoming-add]`).click()
  await until(() => existsSync(`${VAULT}/.vaultite/bundles/qa-desk-3/bundle.json`), 6000)
  check("Import from a file", existsSync(`${VAULT}/.vaultite/bundles/qa-desk-3/bundle.json`))
  await dismissAll(page)
  // Pasted anywhere on Get (no field focused): straight to its preview; Apply adds it and applies it.
  await page.locator("main h1:visible, main [data-bundles-browse] h2").first().click()
  await page.evaluate((text) => { const dt = new DataTransfer(); dt.setData("text/plain", text); document.activeElement?.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true })) }, copied)
  await until(() => page.locator(`${incoming} [data-bundle-incoming-apply]`).count(), 6000)
  check("a bundle pasted on Get opens its preview", await page.locator(incoming).count() === 1)
  await page.locator(`${incoming} [data-bundle-incoming-apply]`).click()
  await until(() => json(VAULT, ".vaultite/bundles/previous.json")?.bundle === "qa-desk-4", 6000)
  check("Apply, from the preview: added and applied", existsSync(`${VAULT}/.vaultite/bundles/qa-desk-4/bundle.json`) && json(VAULT, ".vaultite/bundles/previous.json")?.bundle === "qa-desk-4",
    json(VAULT, ".vaultite/bundles/previous.json")?.bundle)
  await dismissAll(page)
  // Dropped on Get's layouts and packs: the same.
  await go(page, B, "get")
  await until(() => page.locator("[data-bundles-browse]").count(), 6000)
  await page.evaluate((text) => {
    const dt = new DataTransfer()
    dt.items.add(new File([text], "shared.bundle.json", { type: "application/json" }))
    const el = document.querySelector("[data-bundles-browse]")
    el.dispatchEvent(new DragEvent("dragover", { dataTransfer: dt, bubbles: true, cancelable: true }))
    el.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }))
  }, copied)
  await until(() => page.locator(`${incoming} [data-bundle-incoming-add]`).count(), 6000)
  check("a bundle's file dropped on Get opens its preview", await page.locator(incoming).count() === 1 && !(await page.locator("[data-bundles-drop]").count()))
  await page.keyboard.press("Escape")
  await until(async () => !(await page.locator(incoming).count()), 6000)
  check("closed, nothing was added", !existsSync(`${VAULT}/.vaultite/bundles/qa-desk-5`))
  await dismissAll(page)
  // Delete one of the user's, with Undo.
  await picker(page, B)
  await tileMenu(page, "qa-desk-3", "Delete")
  await until(async () => !(await page.locator('[data-layout-pick="qa-desk-3"]').count()), 6000)
  check("Delete: its tile goes, to the trash", !existsSync(`${VAULT}/.vaultite/bundles/qa-desk-3`))
  await toastWith(page, "Deleted").locator("[data-button]").click()
  await until(() => page.locator('[data-layout-pick="qa-desk-3"]').count(), 6000)
  check("Undo brings it back", existsSync(`${VAULT}/.vaultite/bundles/qa-desk-3/bundle.json`))
  await dismissAll(page)
  // The command palette has the layouts.
  await page.keyboard.press("ControlOrMeta+p")
  await page.keyboard.type("Choose a layout")
  await wait(400)
  check("the command palette has Choose a layout…", (await page.locator("[data-palette]").innerText()).includes("Choose a layout…"))
  await page.keyboard.press("Escape")
}
await ctx.close()

// ---------- 5. Phones ----------
{
  const { ctx: pc, page: pp } = await open(390, 844, true)
  await go(pp, B, "settings")
  await pp.locator("[data-settings-nav=appearance]").first().click()
  await until(() => pp.locator("dialog[open] [data-layout-pick]").count() >= 3, 6000)
  check("390px: the picker fits, two across", await pp.evaluate(() => { const d = document.querySelector("dialog[open]"); return d ? d.scrollWidth - d.clientWidth : 0 }) <= 0 &&
    new Set(await pp.locator("dialog[open] [data-layout]").evaluateAll((els) => els.slice(0, 2).map((e) => Math.round(e.getBoundingClientRect().top)))).size === 1)
  const more = await pp.locator('dialog[open] [data-layout-more="zen"]').evaluate((e) => { const r = e.getBoundingClientRect(); return getComputedStyle(e).opacity === "1" && r.width >= 24 })
  check("390px: each tile's ⋯ shows, without hovering", more)
  await shot(pp, "phone-picker")
  await go(pp, B, "settings/bundle/zen")
  await until(() => pp.locator("dialog[open] [data-bundle-apply]").count(), 6000)
  check("390px: Details fits", await pp.evaluate(() => { const d = document.querySelector("dialog[open]"); return d ? d.scrollWidth - d.clientWidth : 0 }) <= 0)
  await shot(pp, "phone-preview")
  await pp.evaluate(() => { location.hash = "#settings/bundle-share/qa-desk" })
  await until(() => pp.locator("dialog[open] [data-bundle-share-sheet]").count(), 6000)
  check("390px: Share fits", await pp.evaluate(() => { const d = document.querySelector("dialog[open]"); return d ? d.scrollWidth - d.clientWidth : 0 }) <= 0)
  await shot(pp, "phone-share")
  await go(pp, B, "get")
  await until(() => pp.locator("[data-bundles-browse]").count(), 6000)
  check("390px: Get fits", await overflow(pp) <= 0, await overflow(pp))
  await shot(pp, "phone-get")
  await pc.close()
}
await done()
