// Bundles (core/bundles.ts, pages/Bundles.tsx): a new vault starts from Standard with no offer; an older vault still
// offered them opens on them (Standard picked, a line to import one), and skipping starts from Standard. The page's
// cards and previews, Apply (each built-in: the files as previewed, its guide or first page, Undo), "Restore previous setup",
// Save current setup, Share, and Import (the sheet, a file, pasted or dropped on the page: its preview, then Add or
// Apply), and 390px. Screenshots.
// WRITES the vault's settings and bundles: throwaway servers only.
//   node web/qa/bundles.mjs <base url> <vault path> <fresh base url> <fresh vault path> [out dir]
// (the fresh server serves a folder the app had never opened: no .vaultite/ before it started)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { qa, until, wait } from "./lib/qa.mjs"

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
/** A bundle installing Vaultite's own plugins (Life OS: Books; Agents: Cursor...): its ask (none once they're there),
 *  said yes to. */
async function installs(page, first = "Books") {
  const ask = page.locator("dialog[open][data-confirm]", { hasText: `Install ${first}` })
  await until(async () => (await ask.count()) || (await page.locator("[data-sonner-toast]", { hasText: "Applied" }).count()), 6000)
  if (await ask.count()) await ask.locator("[data-confirm-ok]").click()
}
/** Open a bundle's card. */
async function card(page, id) {
  await until(() => page.locator(`[data-bundle="${id}"]`).count(), 6000)
  await notNow(page)
  await page.locator(`[data-bundle="${id}"]`).click()
}
const dismissAll = async (page) => { await page.mouse.move(5, 5); await page.waitForFunction(() => !document.querySelector("[data-sonner-toast]"), null, { timeout: 30_000 }).catch(() => {}); await wait(100) }
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)

// ---------- 1. A new vault: Standard, then Life OS ----------
{
  const { ctx, page } = await open(1280, 820)
  await go(page, FB)
  // (no Start here note unless setup asked for one: core/start.ts writes only .vaultite/)
  check("a new vault opens on Standard, not the bundles: nothing pinned, no note written", decodeURIComponent(await page.evaluate(() => location.hash)) !== "#bundles"
    && JSON.stringify(settings(FVAULT).pages?.pinned) === "[]" && !existsSync(`${FVAULT}/Start here.md`) && !(settings(FVAULT).plugins?.enabled ?? []).includes("people"), settings(FVAULT))
  await shot(page, "new-vault-standard")
  await go(page, FB, "bundles")
  await until(() => page.locator("[data-bundle]").count(), 6000)
  const ids = await page.locator("[data-bundles-app] [data-bundle]").evaluateAll((els) => els.map((e) => e.dataset.bundle))
  check("three built-in bundles, Standard first", ids.join() === "standard,zen,life-os", ids)
  const inUse = await page.locator("[data-bundle]:has([data-bundle-in-use])").evaluateAll((els) => els.map((e) => e.dataset.bundle))
  check("a new vault: Standard's card says In use, the others don't", inUse.join() === "standard", inUse)
  await page.locator('[data-bundle="life-os"]').click()
  await until(() => page.locator('dialog[open] [data-bundle-preview="life-os"]').count(), 6000)
  await shot(page, "preview-life-os-new-vault")
  check("the preview names its guide", await page.locator("dialog[open] [data-bundle-guide]").count() === 1)
  await page.locator("dialog[open] [data-bundle-apply]").click()
  await installs(page)
  // (installing from GitHub can take a while)
  await until(() => toastWith(page, "Applied Life OS").count(), 30_000)
  check("applied: a toast with Undo", await toastWith(page, "Applied Life OS").isVisible() && (await toastWith(page, "Applied Life OS").locator("[data-button]").innerText()) === "Undo")
  await until(() => page.evaluate(() => decodeURIComponent(location.hash).includes("Guides/How Life OS works.md")), 6000)
  check("applied: its guide is shown", decodeURIComponent(await page.evaluate(() => location.hash)).includes("Guides/How Life OS works.md") && existsSync(`${FVAULT}/Guides/How Life OS works.md`), await page.evaluate(() => location.hash))
  const s = settings(FVAULT)
  check("applied: Life OS's pins (its plugins' pages written in Dashboards/) and look", s.pages?.pinned?.[0] === "Dashboards/Today.md" && existsSync(`${FVAULT}/Dashboards/Today.md`) && s.appearance?.scheme === "flexoki" && s.plugins?.enabled?.includes("today"), s)
  await wait(1200)
  await shot(page, "after-life-os-new-vault")
  // A vault still offered the bundles (an older app's): it opens on them, Standard picked, and skipping starts from it.
  writeFileSync(`${FVAULT}/.vaultite/bundles/onboarding.json`, "{}\n")
  await go(page, FB)
  await until(() => page.evaluate(() => location.hash === "#bundles"), 6000)
  check("offered: it opens on the bundles, and greets, without Setup's tabs", (await page.locator("main h1").first().innerText()).includes("Welcome") &&
    !(await page.locator("[data-setup-tab]").count()), await page.locator("main h1").first().innerText())
  await until(() => page.locator("[data-bundles-skip]").count(), 6000)
  check("offered: Standard is picked, and a quiet line imports one", await page.locator('[data-bundle="standard"] [data-bundle-picked]').count() === 1
    && await page.locator("[data-bundles-welcome-import]").count() === 1 && (await page.locator("[data-bundles-skip]").innerText()).includes("Standard"))
  await shot(page, "welcome")
  await page.locator("[data-bundles-skip]").click()
  await until(() => !existsSync(`${FVAULT}/.vaultite/bundles/onboarding.json`), 6000)
  check("Start with Standard ends the offer", !existsSync(`${FVAULT}/.vaultite/bundles/onboarding.json`))
  const m = settings(FVAULT)
  check("skipped: Standard's plugins (Claude Code on), and Restore still Life OS's", !(m.plugins?.enabled ?? []).includes("people") && !m.plugins?.disabled?.includes("claude-code")
    && json(FVAULT, ".vaultite/bundles/previous.json")?.bundle === "life-os", [m.plugins, json(FVAULT, ".vaultite/bundles/previous.json")?.bundle])
  await until(async () => (await page.locator("main h1").first().innerText()) === "Setup", 6000)
  check("then the page is Setup, on its Bundles tab", (await page.locator("main h1").first().innerText()) === "Setup" &&
    (await page.locator("[data-setup-tab=bundles]").getAttribute("aria-checked")) === "true")
  await ctx.close()
}

// ---------- 2. Each built-in bundle on a copy of examples/vault ----------
const { ctx, page } = await open(1280, 820)
const original = settings(VAULT)
await go(page, B, "bundles")
await until(() => page.locator("[data-bundle]").count() >= 3, 6000)
check("an existing vault isn't greeted", (await page.locator("main h1").first().innerText()) === "Setup")
await shot(page, "picker")
// What a built-in brings beyond settings is a mark on its title's row, its tooltip naming the plugins: cards one height.
const cards = await page.locator("[data-bundles-app] [data-bundle]").evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().height)))
check("built-in cards are one height", cards.length >= 3 && new Set(cards).size === 1, cards)
const mark = page.locator('[data-bundle="life-os"] [data-bundle-installs]')
check("Life OS: a mark saying which plugins it installs", await mark.count() === 1 && /^Installs .*Today/.test(await mark.getAttribute("data-tip")), await mark.getAttribute("data-tip").catch(() => null))
const PAGES = "Dashboards/" // (a bundle's pages, and its plugins', go in the vault's pages folder)
const want = {
  "standard": (s) => !s.pages.pinned.some((p) => p.includes("Dashboards/Today")) && s.appearance.fileIcons === false && !(s.plugins.enabled ?? []).includes("people") && s.sidebars.right.includes("backlinks:links"),
  "life-os": (s) => s.pages.pinned[0] === `${PAGES}Today.md` && s.pages.pinned[1] === `${PAGES}Home.md` && existsSync(`${VAULT}/${PAGES}Home.md`) && s.appearance.scheme === "flexoki",
  "zen": (s) => s.appearance.rails === false && s.appearance.tabBar === false && s.appearance.paneTitles === false && s.sidebars.left.includes("tabs:tabs") && s.appearance.snippets?.includes("Floating panes"),
}
for (const id of Object.keys(want)) {
  await go(page, B, "bundles")
  await card(page, id)
  const sheet = page.locator(`dialog[open] [data-bundle-preview="${id}"]`)
  await until(() => sheet.count(), 6000)
  await until(() => page.locator("dialog[open] [data-bundle-apply]").count(), 6000)
  const text = await sheet.innerText()
  check(`${id}: the preview says what changes`, /Plugins|Sidebars|Pinned pages|Look/.test(text), text.slice(0, 200))
  if (id === "zen" || id === "life-os") await shot(page, `preview-${id}`)
  await page.locator("dialog[open] [data-bundle-apply]").click()
  if (id === "life-os") await installs(page)
  await until(() => page.locator("[data-sonner-toast]", { hasText: "Applied" }).count(), 6000)
  await until(() => { const s = settings(VAULT); try { return want[id](s) } catch { return false } }, 6000)
  const s = settings(VAULT)
  let ok = false
  try { ok = want[id](s) } catch { /* below */ }
  check(`${id}: applied as the preview said`, ok, s)
  check(`${id}: plugins.json's other keys are left alone`, JSON.stringify(Object.keys(s.plugins).filter((k) => !["disabled", "enabled"].includes(k))) === JSON.stringify(Object.keys(original.plugins ?? {}).filter((k) => !["disabled", "enabled"].includes(k))), s.plugins)
  if (id === "life-os" || id === "zen") { await wait(1500); await shot(page, `after-${id}`) }
  await dismissAll(page)
}

// ---------- 3. Undo, and Restore previous setup ----------
{
  const before = JSON.stringify(settings(VAULT))
  await go(page, B, "bundles")
  await card(page, "standard")
  await until(() => page.locator("dialog[open] [data-bundle-apply]").count(), 6000)
  await page.locator("dialog[open] [data-bundle-apply]").click()
  const t = toastWith(page, "Applied Standard")
  await until(() => t.count(), 6000)
  await t.locator("[data-button]").click()
  await until(() => JSON.stringify(settings(VAULT)) === before, 6000)
  check("Undo puts every settings file back", JSON.stringify(settings(VAULT)) === before, [JSON.parse(before), settings(VAULT)])
  await dismissAll(page)
  await go(page, B, "bundles")
  await card(page, "life-os")
  await until(() => page.locator("dialog[open] [data-bundle-apply]").count(), 6000)
  await page.locator("dialog[open] [data-bundle-apply]").click()
  await installs(page)
  await until(() => toastWith(page, "Applied Life OS").count(), 6000)
  await dismissAll(page)
  await go(page, B, "bundles")
  await until(() => page.locator("[data-bundles-previous]").count(), 6000)
  check("the page offers Restore previous setup", (await page.locator("[data-bundles-previous]").innerText()).includes("Life OS"))
  await page.locator("[data-bundles-previous] button").click()
  await until(() => JSON.stringify(settings(VAULT)) === before, 6000)
  check("Restore previous setup puts it back", JSON.stringify(settings(VAULT)) === before, settings(VAULT))
  await until(async () => !(await page.locator("[data-bundles-previous]").count()), 6000)
  check("and the line goes", !(await page.locator("[data-bundles-previous]").count()))
  await dismissAll(page)
}

// ---------- 4. Save, export, import ----------
{
  await go(page, B, "bundles")
  check("none of yours: one row's empty state with Save and Import, nothing atop the page", await page.locator("[data-bundles-none] [data-bundles-save]").count() === 1 &&
    await page.locator("[data-bundles-none] [data-bundles-import]").count() === 1 && !(await page.locator("[data-setup] header [data-bundles-save], [data-setup] header [data-bundles-import]").count()))
  await shot(page, "none-yours")
  await page.locator("[data-bundles-save]").click()
  await until(() => page.locator("dialog[open] [data-bundle-save-form]").count(), 6000)
  await page.locator("dialog[open] [data-bundle-name]").fill("QA desk")
  await shot(page, "save")
  await page.locator("dialog[open] [data-bundle-save]").click()
  await until(() => existsSync(`${VAULT}/.vaultite/bundles/qa-desk/bundle.json`), 6000)
  check("Save current setup writes the bundle", json(VAULT, ".vaultite/bundles/qa-desk/bundle.json")?.name === "QA desk" && !!json(VAULT, ".vaultite/bundles/qa-desk/plugins.json"))
  await until(() => page.locator('[data-bundles-mine] [data-bundle="qa-desk"]').count(), 6000)
  check("it shows under Yours, Save current setup after it", await page.locator('[data-bundles-mine] [data-bundle="qa-desk"]').count() === 1 &&
    await page.locator("[data-bundles-mine] > :last-child[data-bundles-save]").count() === 1 && !(await page.locator("[data-bundles-none]").count()))
  // Share: what it sends (the picture off), Save file, Copy and Copy for an agent; then Import, pasted and from a file.
  await page.locator('[data-bundle="qa-desk"]').hover()
  await page.locator('[data-bundle="qa-desk"] ~ button').click()
  await page.getByText("Share…").click()
  await until(() => page.locator("dialog[open] [data-bundle-share-sheet]").count(), 6000)
  await until(() => page.locator("dialog[open] [data-bundle-export]:not([disabled])").count(), 6000)
  await shot(page, "share")
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 8000 }), page.locator("dialog[open] [data-bundle-export]").click()])
  const path = `${OUT}qa-desk.bundle.json`
  await dl.saveAs(path)
  const exp = JSON.parse(readFileSync(path, "utf8"))
  check("Share's Save file downloads one JSON file, without the picture", dl.suggestedFilename() === "qa-desk.bundle.json" && exp.vaultite === "bundle" && !!exp.files["plugins.json"] &&
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
  // Import from the sheet: pasted (inside a message), its preview first, then Add.
  const incoming = "dialog[open] [data-bundle-incoming]"
  await page.locator("[data-bundles-get]").click()
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
  await page.locator("[data-bundles-yours]").click()
  await until(() => page.locator('[data-bundle="qa-desk-2"]').count(), 6000)
  check("and it shows", await page.locator('[data-bundle="qa-desk-2"]').count() === 1)
  await dismissAll(page)
  await page.locator("[data-bundles-get]").click()
  await page.locator("[data-bundles-import]").click()
  await until(() => page.locator("dialog[open] [data-bundle-import-form]").count(), 6000)
  await page.locator("dialog[open] input[type=file]").setInputFiles(path)
  await until(() => page.locator(`${incoming} [data-bundle-incoming-add]`).count(), 6000)
  await page.locator(`${incoming} [data-bundle-incoming-add]`).click()
  await until(() => existsSync(`${VAULT}/.vaultite/bundles/qa-desk-3/bundle.json`), 6000)
  check("Import from a file", existsSync(`${VAULT}/.vaultite/bundles/qa-desk-3/bundle.json`))
  await dismissAll(page)
  // Pasted anywhere on the page (no field focused): straight to its preview; Apply adds it and applies it.
  await page.locator("main h1").first().click()
  await page.evaluate((text) => { const dt = new DataTransfer(); dt.setData("text/plain", text); document.activeElement?.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true })) }, copied)
  await until(() => page.locator(`${incoming} [data-bundle-incoming-apply]`).count(), 6000)
  check("a bundle pasted on the page opens its preview", await page.locator(incoming).count() === 1)
  await page.locator(`${incoming} [data-bundle-incoming-apply]`).click()
  await until(() => json(VAULT, ".vaultite/bundles/previous.json")?.bundle === "qa-desk-4", 6000)
  check("Apply, from the preview: added and applied", existsSync(`${VAULT}/.vaultite/bundles/qa-desk-4/bundle.json`) && json(VAULT, ".vaultite/bundles/previous.json")?.bundle === "qa-desk-4",
    json(VAULT, ".vaultite/bundles/previous.json")?.bundle)
  await dismissAll(page)
  // Dropped on the page: the same.
  await go(page, B, "bundles")
  await until(() => page.locator("[data-bundles-page]").count(), 6000)
  await page.evaluate((text) => {
    const dt = new DataTransfer()
    dt.items.add(new File([text], "shared.bundle.json", { type: "application/json" }))
    const el = document.querySelector("[data-bundles-page]")
    el.dispatchEvent(new DragEvent("dragover", { dataTransfer: dt, bubbles: true, cancelable: true }))
    el.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }))
  }, copied)
  await until(() => page.locator(`${incoming} [data-bundle-incoming-add]`).count(), 6000)
  check("a bundle's file dropped on the page opens its preview", await page.locator(incoming).count() === 1 && !(await page.locator("[data-bundles-drop]").count()))
  await page.keyboard.press("Escape")
  await until(async () => !(await page.locator(incoming).count()), 6000)
  check("closed, nothing was added", !existsSync(`${VAULT}/.vaultite/bundles/qa-desk-5`))
  await dismissAll(page)
  // The command palette has the bundles.
  await page.keyboard.press("ControlOrMeta+p")
  await page.keyboard.type("Choose a bundle")
  await wait(400)
  check("the command palette has Choose a bundle…", (await page.locator("body").innerText()).includes("Choose a bundle…"))
  await page.keyboard.press("Escape")
}
await ctx.close()

// ---------- 5. Phones ----------
{
  const { ctx: pc, page: pp } = await open(390, 844, true)
  await go(pp, B, "bundles")
  await until(() => pp.locator("[data-bundle]").count() >= 3, 6000)
  check("390px: the page fits", await overflow(pp) <= 0, await overflow(pp))
  await shot(pp, "phone-picker")
  await pp.locator('[data-bundle="zen"]').click()
  await until(() => pp.locator("dialog[open] [data-bundle-apply]").count(), 6000)
  check("390px: the preview fits", await pp.evaluate(() => { const d = document.querySelector("dialog[open]"); return d ? d.scrollWidth - d.clientWidth : 0 }) <= 0)
  await shot(pp, "phone-preview")
  await pp.evaluate(() => { location.hash = "#bundles/bundle-share/qa-desk" })
  await until(() => pp.locator("dialog[open] [data-bundle-share-sheet]").count(), 6000)
  check("390px: Share fits", await pp.evaluate(() => { const d = document.querySelector("dialog[open]"); return d ? d.scrollWidth - d.clientWidth : 0 }) <= 0)
  await shot(pp, "phone-share")
  await pc.close()
}
await done()
