// Bundles (core/bundles.ts, pages/Bundles.tsx): a new vault starts from Minimal with no offer; an older vault still
// offered them opens on them, and skipping starts from Minimal. The page's cards and previews, Apply (each built-in: the files as previewed, its first
// page, Undo), "Restore previous setup", Save current setup, Export and Import, and 390px. Screenshots.
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
}
const toastWith = (page, text) => page.locator("[data-sonner-toast]", { hasText: text }).first()
/** Open a bundle's card (one under More bundles: unfolded first). */
async function card(page, id) {
  await until(() => page.locator("[data-bundle]").count(), 6000)
  if (!(await page.locator(`[data-bundle="${id}"]`).count())) await page.locator("[data-bundles-more]").click()
  await until(() => page.locator(`[data-bundle="${id}"]`).count(), 6000)
  await page.locator(`[data-bundle="${id}"]`).click()
}
const dismissAll = async (page) => { await page.mouse.move(5, 5); await page.waitForFunction(() => !document.querySelector("[data-sonner-toast]"), null, { timeout: 30_000 }).catch(() => {}); await wait(100) }
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)

// ---------- 1. A new vault: Minimal, then Life OS ----------
{
  const { ctx, page } = await open(1280, 820)
  await go(page, FB)
  check("a new vault opens on Start here, not the bundles", decodeURIComponent(await page.evaluate(() => location.hash)) !== "#bundles"
    && JSON.stringify(settings(FVAULT).pages?.pinned) === '["Start here.md"]' && settings(FVAULT).plugins?.disabled?.includes("people"), settings(FVAULT))
  await shot(page, "new-vault-minimal")
  await go(page, FB, "bundles")
  await until(() => page.locator("[data-bundle]").count(), 6000)
  check("three built-in bundles up front", await page.locator("[data-bundles-app] [data-bundle]").count() === 3, await page.locator("[data-bundles-app] [data-bundle]").count())
  check("the other three under More", await page.locator("[data-bundles-more]").count() === 1 && !(await page.locator("[data-bundles-app-more]").count()))
  await page.locator('[data-bundle="life-os"]').click()
  await until(() => page.locator('dialog[open] [data-bundle-preview="life-os"]').count(), 6000)
  await shot(page, "preview-life-os-new-vault")
  await page.locator("dialog[open] [data-bundle-apply]").click()
  await until(() => toastWith(page, "Applied Life OS").count(), 6000)
  check("applied: a toast with Undo", await toastWith(page, "Applied Life OS").isVisible() && (await toastWith(page, "Applied Life OS").locator("[data-button]").innerText()) === "Undo")
  await until(() => page.evaluate(() => decodeURIComponent(location.hash).includes("Dashboards/Today.md")), 6000)
  check("applied: its first page is shown", decodeURIComponent(await page.evaluate(() => location.hash)).includes("Dashboards/Today.md"), await page.evaluate(() => location.hash))
  const s = settings(FVAULT)
  check("applied: Life OS's pins (its pages kept in .vaultite/pages) and look", s.pages?.pinned?.[0] === ".vaultite/pages/Dashboards/Today.md" && s.appearance?.scheme === "flexoki" && s.plugins?.disabled?.includes("workspaces"), s)
  await wait(1200)
  await shot(page, "after-life-os-new-vault")
  // A vault still offered the bundles (an older app's): it opens on them, and skipping starts from Minimal.
  writeFileSync(`${FVAULT}/.vaultite/bundles/onboarding.json`, "{}\n")
  await go(page, FB)
  await until(() => page.evaluate(() => location.hash === "#bundles"), 6000)
  check("offered: it opens on the bundles, and greets", (await page.locator("main h1").first().innerText()).includes("Welcome"), await page.locator("main h1").first().innerText())
  await until(() => page.locator("[data-bundles-skip]").count(), 6000)
  await page.locator("[data-bundles-skip]").click()
  await until(() => !existsSync(`${FVAULT}/.vaultite/bundles/onboarding.json`), 6000)
  check("Start with Minimal ends the offer", !existsSync(`${FVAULT}/.vaultite/bundles/onboarding.json`))
  const m = settings(FVAULT)
  check("skipped: Minimal's plugins (Claude Code on), and Restore still Life OS's", m.plugins?.disabled?.includes("people") && !m.plugins.disabled.includes("claude-code")
    && json(FVAULT, ".vaultite/bundles/previous.json")?.bundle === "life-os", [m.plugins, json(FVAULT, ".vaultite/bundles/previous.json")?.bundle])
  await until(async () => (await page.locator("main h1").first().innerText()) === "Bundles", 6000)
  check("then the page is just Bundles", (await page.locator("main h1").first().innerText()) === "Bundles")
  await ctx.close()
}

// ---------- 2. Each built-in bundle on a copy of examples/vault ----------
const { ctx, page } = await open(1280, 820)
const original = settings(VAULT)
await go(page, B, "bundles")
await until(() => page.locator("[data-bundle]").count() >= 3, 6000)
check("an existing vault isn't greeted", (await page.locator("main h1").first().innerText()) === "Bundles")
await shot(page, "picker")
const want = {
  "minimal": (s) => !s.pages.pinned.some((p) => p.startsWith("Dashboards/Today")) && s.appearance.fileIcons === false && s.plugins.disabled.includes("people") && s.sidebars.right.includes("backlinks:links") && s.plugins.disabled.includes("workspaces"),
  "pages": (s) => s.pages.pinned[0] === "Dashboards/Home.md" && existsSync(`${VAULT}/Dashboards/Home.md`) && s.appearance.density === "comfortable",
  "life-os": (s) => s.pages.pinned[0] === "Dashboards/Today.md" && s.appearance.scheme === "flexoki",
  "agent-cockpit": (s) => s.pages.pinned[0] === "Dashboards/Agents.md" && s.appearance.scheme === "tokyo-night" && s.sidebars.right.includes("activity:feed"),
  "self-hosted": (s) => s.pages.pinned[0] === "Dashboards/Server.md" && s.sidebars.left.includes("machines:machines") && json(VAULT, ".vaultite/plugins/history/data.json")?.keep_days === 30,
}
for (const id of Object.keys(want)) {
  await go(page, B, "bundles")
  await card(page, id)
  const sheet = page.locator(`dialog[open] [data-bundle-preview="${id}"]`)
  await until(() => sheet.count(), 6000)
  await until(() => page.locator("dialog[open] [data-bundle-apply]").count(), 6000)
  const text = await sheet.innerText()
  check(`${id}: the preview says what changes`, /Plugins|Sidebars|Pinned pages|Look/.test(text), text.slice(0, 200))
  if (id === "agent-cockpit" || id === "pages") await shot(page, `preview-${id}`)
  await page.locator("dialog[open] [data-bundle-apply]").click()
  await until(() => page.locator("[data-sonner-toast]", { hasText: "Applied" }).count(), 6000)
  await until(() => { const s = settings(VAULT); try { return want[id](s) } catch { return false } }, 6000)
  const s = settings(VAULT)
  let ok = false
  try { ok = want[id](s) } catch { /* below */ }
  check(`${id}: applied as the preview said`, ok, s)
  check(`${id}: plugins.json's other keys are left alone`, JSON.stringify(Object.keys(s.plugins).filter((k) => !["disabled", "enabled"].includes(k))) === JSON.stringify(Object.keys(original.plugins ?? {}).filter((k) => !["disabled", "enabled"].includes(k))), s.plugins)
  if (id === "life-os" || id === "agent-cockpit") { await wait(1500); await shot(page, `after-${id}`) }
  await dismissAll(page)
}

// ---------- 3. Undo, and Restore previous setup ----------
{
  const before = JSON.stringify(settings(VAULT))
  await go(page, B, "bundles")
  await card(page, "minimal")
  await until(() => page.locator("dialog[open] [data-bundle-apply]").count(), 6000)
  await page.locator("dialog[open] [data-bundle-apply]").click()
  const t = toastWith(page, "Applied Minimal")
  await until(() => t.count(), 6000)
  await t.locator("[data-button]").click()
  await until(() => JSON.stringify(settings(VAULT)) === before, 6000)
  check("Undo puts every settings file back", JSON.stringify(settings(VAULT)) === before, [JSON.parse(before), settings(VAULT)])
  await dismissAll(page)
  await go(page, B, "bundles")
  await card(page, "pages")
  await until(() => page.locator("dialog[open] [data-bundle-apply]").count(), 6000)
  await page.locator("dialog[open] [data-bundle-apply]").click()
  await until(() => toastWith(page, "Applied Pages and databases").count(), 6000)
  await dismissAll(page)
  await go(page, B, "bundles")
  await until(() => page.locator("[data-bundles-previous]").count(), 6000)
  check("the page offers Restore previous setup", (await page.locator("[data-bundles-previous]").innerText()).includes("Pages and databases"))
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
  await page.locator("[data-bundles-save]").click()
  await until(() => page.locator("dialog[open] [data-bundle-save-form]").count(), 6000)
  await page.locator("dialog[open] [data-bundle-name]").fill("QA desk")
  await shot(page, "save")
  await page.locator("dialog[open] [data-bundle-save]").click()
  await until(() => existsSync(`${VAULT}/.vaultite/bundles/qa-desk/bundle.json`), 6000)
  check("Save current setup writes the bundle", json(VAULT, ".vaultite/bundles/qa-desk/bundle.json")?.name === "QA desk" && !!json(VAULT, ".vaultite/bundles/qa-desk/plugins.json"))
  await until(() => page.locator('[data-bundles-mine] [data-bundle="qa-desk"]').count(), 6000)
  check("it shows under Yours", await page.locator('[data-bundles-mine] [data-bundle="qa-desk"]').count() === 1)
  await page.locator('[data-bundle="qa-desk"]').hover()
  const [dl] = await Promise.all([
    page.waitForEvent("download", { timeout: 8000 }),
    (async () => { await page.locator('[data-bundle="qa-desk"] ~ button').click(); await page.getByText("Export…").click() })(),
  ])
  const path = `${OUT}qa-desk.bundle.json`
  await dl.saveAs(path)
  const exp = JSON.parse(readFileSync(path, "utf8"))
  check("Export downloads one JSON file", dl.suggestedFilename() === "qa-desk.bundle.json" && exp.vaultite === "bundle" && !!exp.files["plugins.json"], dl.suggestedFilename())
  await page.locator("input[type=file]").setInputFiles(path)
  await until(() => existsSync(`${VAULT}/.vaultite/bundles/qa-desk-2/bundle.json`), 6000)
  check("Import adds it under a free id", existsSync(`${VAULT}/.vaultite/bundles/qa-desk-2/bundle.json`))
  await until(() => page.locator('[data-bundle="qa-desk-2"]').count(), 6000)
  check("and it shows", await page.locator('[data-bundle="qa-desk-2"]').count() === 1)
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
  await pp.locator('[data-bundle="agent-cockpit"]').click()
  await until(() => pp.locator("dialog[open] [data-bundle-apply]").count(), 6000)
  check("390px: the preview fits", await pp.evaluate(() => { const d = document.querySelector("dialog[open]"); return d ? d.scrollWidth - d.clientWidth : 0 }) <= 0)
  await shot(pp, "phone-preview")
  await pc.close()
}
await done()
