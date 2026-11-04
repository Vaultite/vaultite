// Layouts, choosing (components/LayoutPicker.tsx, pages/Bundles.tsx, components/BundleTrial.tsx): Details' ticks, the
// Changed mark and Reset, each layout's tweaks kept, trying one, and Get's layouts and packs beside its plugins. WRITES
// settings and bundles: throwaway servers started with VAULTITE_PLUGIN_INDEX=<plugin index>, VAULTITE_GITHUB=file://<plugin repos>.
//   node web/qa/bundle-choices.mjs <base url> <vault path> <plugin index> <plugin repos> [out dir]
import { execFileSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { ROOT, qa, until, wait } from "./lib/qa.mjs"
import { gitEnv } from "../../core/gitenv.ts"

const { args: [B, VAULT, INDEX, REPOS, OUT = "/tmp/bundle-choices-shots/"], browser, check, watch, done } = await qa(import.meta.url)
mkdirSync(OUT, { recursive: true })
const json = (rel) => { try { return JSON.parse(readFileSync(`${VAULT}/${rel}`, "utf8")) } catch { return null } }
const api = async (method, path, body) => {
  const r = await fetch(`${B}/api/${path}`, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) })
  return r.json().catch(() => null)
}
const look = () => json(".vaultite/appearance.json") ?? {}
const enabled = () => json(".vaultite/plugins.json")?.enabled ?? []

// ---------- the fixture: a repository with a bundle, and an index listing it ----------
const REPO = `${REPOS}/qa/desk`
const git = (...a) => execFileSync("git", ["-C", REPO, ...a], { encoding: "utf8", env: gitEnv() }).trim()
function commit(scheme) {
  mkdirSync(REPO, { recursive: true })
  writeFileSync(`${REPO}/bundle.json`, JSON.stringify({ name: "Writing desk", description: "Pages for writing.", icon: "pen", tint: "purple" }))
  writeFileSync(`${REPO}/appearance.json`, JSON.stringify({ scheme }))
  if (!existsSync(`${REPO}/.git`)) git("init", "-q")
  git("add", "-A")
  git("-c", "user.name=QA", "-c", "user.email=qa@example.com", "commit", "-q", "-m", scheme)
  return git("rev-parse", "HEAD")
}
function index(desk) {
  const entry = (o) => ({ description: "Made up.", author: "Bob Lee", stars: 3, updated: "2026-10-01T00:00:00Z", topics: ["vaultite-bundle"], runsCode: false, installs: [], ...o })
  writeFileSync(INDEX, JSON.stringify({ format: 1, generated: "2026-10-01T00:00:00Z", plugins: [], blocked: {}, bundles: [
    entry({ name: "Writing desk", description: "Pages for writing.", author: "Alice Park", repo: "qa/desk", commit: desk, stars: 9, icon: "pen", tint: "purple", kind: "look",
      sketch: { scheme: "dracula" } }),
    entry({ name: "Lamps", repo: "boblee/fleet", dir: "bundles/lamps", commit: "c".repeat(40), runsCode: true, installs: [{ id: "tasks", name: "Tasks", source: "Vaultite/plugins/tasks" }], kind: "pack",
      sketch: { panels: { left: ["search:search", "terminal:sessions"], right: ["inbox:inbox"], collapsed: [] }, shape: { glass: "sidebars" }, home: [{ block: "inbox", view: null }] } }),
  ] }))
}
rmSync(`${REPOS}/qa`, { recursive: true, force: true })
mkdirSync(REPOS, { recursive: true })
const c1 = commit("dracula")
index(c1)
await api("GET", "bundles/browse?refresh=1")
// (from Standard, whatever ran before: Zen's every change is one to make)
for (const id of ["desk", "my-zen", "my-days"]) await api("DELETE", `bundles/${id}`)
// (Days: a bundle installing Vaultite's own plugins, as the directory's Life OS)
cpSync(`${ROOT}/tools/fixtures/bundles/days`, `${VAULT}/.vaultite/bundles/days`, { recursive: true })
await api("POST", "bundles/standard/apply", {})
rmSync(`${VAULT}/Guides/How Zen works.md`, { force: true })

async function open(w, h, { mobile = false, dark = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: dark ? "dark" : "light", ...(mobile ? { isMobile: true, hasTouch: true } : {}) })
  return { ctx, page: watch(await ctx.newPage(), { label: `${w}${dark ? " dark" : ""}` }) }
}
const shot = async (page, name) => { await wait(600); await page.screenshot({ path: `${OUT}${name}.png` }) }
async function go(page, h = "settings") {
  await page.goto("about:blank")
  await page.goto(`${B}#${h}`)
  await until(() => page.locator("main").count(), 6000)
  if (h === "settings") {
    // (a narrow pane lists the sections: Appearance opens as a sheet)
    await until(() => page.locator("[data-layout-pick], [data-settings-list]").count(), 8000)
    if (!(await page.locator("[data-settings-section] [data-layout-pick]").count())) await page.locator("[data-settings-nav=appearance]").first().click()
    await until(() => page.locator("[data-layout-pick]").count() >= 3, 8000)
  }
  await wait(600)
}
const sheet = (page) => page.locator("dialog[open]")
/** A tile's menu item. */
async function tileMenu(page, id, item) {
  await page.locator(`[data-layout="${id}"]`).hover()
  await page.locator(`[data-layout-more="${id}"]`).click()
  await page.locator("[role=menu] [role=menuitem]", { hasText: item }).first().click()
}
const menuItems = async (page, id) => {
  await page.locator(`[data-layout="${id}"]`).hover()
  await page.locator(`[data-layout-more="${id}"]`).click()
  const items = await page.locator("[role=menu] [role=menuitem]").allInnerTexts()
  await page.keyboard.press("Escape")
  return items.map((x) => x.trim())
}
/** Details…: what applying it changes, each change ticked. */
async function preview(page, id) {
  await tileMenu(page, id, "Details…")
  await until(() => sheet(page).locator(`[data-bundle-preview="${id}"] [data-change]`).count(), 8000)
}
const changed = (page, id) => page.locator(`[data-layout="${id}"] [data-layout-changed]`)
const current = (page) => page.locator('[data-layout-pick][aria-checked="true"]').evaluateAll((els) => els.map((e) => e.dataset.layoutPick))
const line = (page, id) => sheet(page).locator(`[data-change="${id}"]`)
const checked = async (page, id) => (await line(page, id).getAttribute("aria-checked")) === "true"
const toastWith = (page, text) => page.locator("[data-sonner-toast]", { hasText: text }).first()
const dismissAll = async (page) => { await page.mouse.move(5, 5); await page.waitForFunction(() => !document.querySelector("[data-sonner-toast]"), null, { timeout: 20_000 }).catch(() => {}) }
const overflow = (page) => page.evaluate(() => { const d = document.querySelector("dialog[open]") ?? document.documentElement; return d.scrollWidth - d.clientWidth })

const { ctx, page } = await open(1600, 900)

// ---------- 1. Details' ticks: leave changes out, Apply ----------
{
  await go(page)
  await preview(page, "zen")
  const pic = await sheet(page).locator('[data-bundle-picture] [data-layout-drawing="zen"]').boundingBox()
  check("Zen's Details: its picture is Settings' drawing, at the sheet's width (no screenshot)", !!pic && pic.width > 300 && !(await sheet(page).locator("img").count()), pic)
  const ids = await sheet(page).locator("[data-change]").evaluateAll((els) => els.map((e) => e.dataset.change))
  check("Zen's Details: a tick per change, all on", ids.length > 10 && ids.includes("plugin:glance") && ids.includes("appearance:tabBar") && ids.includes("panels") &&
    (await sheet(page).locator('[data-change][aria-checked="false"]').count()) === 0, ids)
  check("its guide is a line of its own, ticked", await sheet(page).locator('[data-bundle-guide][data-change^="file:"]').count() === 1)
  check("all on: Apply Zen, Try, no Save as", (await sheet(page).locator("[data-bundle-apply]").innerText()).includes("Apply Zen") && await sheet(page).locator("[data-bundle-try]").count() === 1 &&
    !(await sheet(page).locator("[data-bundle-fork]").count()))
  await line(page, "plugin:glance").click()
  await line(page, "appearance:tabBar").click()
  check("unticked, they're off", !(await checked(page, "plugin:glance")) && !(await checked(page, "appearance:tabBar")))
  check("then: Apply, Try, Save as My Zen, and how many are left out", (await sheet(page).locator("[data-bundle-apply]").innerText()).trim() === "Apply" &&
    (await sheet(page).locator("[data-bundle-fork]").innerText()).includes("Save as My Zen") && (await sheet(page).locator("[data-bundle-leaving]").innerText()).includes("Leaving out 2"))
  await shot(page, "sheet-ticks")
  await line(page, "plugin:glance").scrollIntoViewIfNeeded()
  await shot(page, "sheet-ticks-plugins")
  await sheet(page).locator("[data-bundle-apply]").click()
  await until(() => toastWith(page, "Applied Zen").count(), 8000)
  await until(() => look().rails === false, 6000)
  check("applied without them: Zen's rails, but not its tab bar nor Glance", look().rails === false && look().tabBar !== false && !enabled().includes("glance"), [look(), enabled()])
  check("and it's remembered with what it left out", JSON.stringify(json(".vaultite/bundles/applied.json")?.skip?.sort()) === JSON.stringify(["appearance:tabBar", "plugin:glance"]), json(".vaultite/bundles/applied.json"))
  await dismissAll(page)
  await go(page)
  check("its tile is the one in use, not Changed (what it left out doesn't count)", (await current(page)).join() === "zen" && !(await changed(page, "zen").count()), await current(page))
}

// ---------- 2. Changed, Reset, and each layout's tweaks ----------
{
  await api("PATCH", "config/appearance", { density: look().density === "compact" ? "comfortable" : "compact", lineNumbers: true })
  await go(page)
  await until(() => changed(page, "zen").count(), 6000)
  const tip = await changed(page, "zen").getAttribute("data-tip")
  check("changed since: a quiet Changed mark, what differs in its tip", (await changed(page, "zen").innerText()).trim() === "Changed" && /Density/.test(tip) && /Line numbers/.test(tip), tip)
  await page.locator("[data-layout-picker]").screenshot({ path: `${OUT}tile-changed.png` })
  const items = await menuItems(page, "zen")
  check("its menu: Details, Reset, Save as new (a built-in: no Share nor Delete)", items.join() === "Details…,Reset,Save as new…", items)
  check("the others' menus: Details only", (await menuItems(page, "standard")).join() === "Details…")
  await tileMenu(page, "zen", "Reset")
  await until(async () => !(await changed(page, "zen").count()), 8000)
  check("Reset: Zen as it comes, the mark gone", !look().lineNumbers && !(await changed(page, "zen").count()), look())
  await dismissAll(page)
  // Switching away keeps Zen's tweaks; coming back brings them.
  await api("PATCH", "config/appearance", { lineNumbers: true })
  await go(page)
  await until(() => changed(page, "zen").count(), 6000)
  await page.locator('[data-layout-pick="standard"]').click()
  await until(() => toastWith(page, "Applied Standard").count(), 8000)
  await until(() => look().rails !== false, 6000)
  await until(async () => (await current(page)).join() === "standard" && /come back/.test(await changed(page, "zen").getAttribute("data-tip", { timeout: 500 }).catch(() => "") ?? ""), 8000)
  check("switched away: Zen's tile says its changes come back", /come back/.test(await changed(page, "zen").getAttribute("data-tip") ?? ""), await changed(page, "zen").getAttribute("data-tip").catch(() => null))
  await dismissAll(page)
  await page.locator('[data-layout-pick="zen"]').click()
  await until(() => look().rails === false, 8000)
  check("back to Zen: its tweak with it", look().lineNumbers === true, look())
  await dismissAll(page)
  await tileMenu(page, "zen", "Reset")
  await until(() => !look().lineNumbers, 8000)
  check("Reset again: none kept", !look().lineNumbers)
  await dismissAll(page)
}

// ---------- 3. Details' Save as "<Name> (mine)"; an install's plugin goes with it ----------
{
  await go(page)
  await preview(page, "days")
  // (an install not here yet: which ones depends on what this vault has installed)
  const ins = (await sheet(page).locator('[data-change^="install:"]').evaluateAll((els) => els.map((e) => e.dataset.change.slice(8))))
  const ids = await sheet(page).locator("[data-change]").evaluateAll((els) => els.map((e) => e.dataset.change))
  const x = ins.find((id) => ids.includes(`plugin:${id}`)) ?? ins[0], other = ins.find((id) => id !== x)
  // (this vault may have its plugins installed already: then a plugin it turns on is left out instead)
  const left = x ? `install:${x}` : ids.find((id) => id.startsWith("plugin:"))
  check("Days' Details: what it installs or turns on, each a line", !!left, ids)
  await line(page, left).click()
  if (x && ids.includes(`plugin:${x}`)) {
    check("an install left out: its plugin can't be turned on", !(await checked(page, left)) && !(await checked(page, `plugin:${x}`)) &&
      (await line(page, `plugin:${x}`).getAttribute("aria-disabled")) === "true")
    await line(page, `plugin:${x}`).click({ force: true })
    check("and ticking it does nothing", !(await checked(page, `plugin:${x}`)))
  }
  await line(page, left).scrollIntoViewIfNeeded()
  await shot(page, "sheet-install-off")
  await sheet(page).locator("[data-bundle-fork]").click()
  await until(() => sheet(page).locator('[data-bundle-preview="my-days"]').count(), 8000)
  const pj = json(".vaultite/bundles/my-days/plugins.json")
  const without = x ? !pj?.install?.[x] && (!other || !!pj?.install?.[other]) : !(pj?.enabled ?? []).includes(left.slice(7))
  check("Save as My Days: saved without it, and its sheet is open", json(".vaultite/bundles/my-days/bundle.json")?.name === "My Days" && without &&
    await toastWith(page, "Saved My Days").count() === 1, [left, pj])
  await page.keyboard.press("Escape")
  await dismissAll(page)
}

// ---------- 4. Try: the bar, Keep and Revert, after a reload ----------
{
  const before = JSON.stringify(look())
  await go(page)
  await preview(page, "standard")
  await sheet(page).locator("[data-bundle-try]").click()
  await until(() => page.locator("[data-bundle-trial]").count(), 8000)
  check("Try: the bar says what's tried, no Applied toast", (await page.locator("[data-bundle-trial]").innerText()).includes("Trying Standard") && !(await toastWith(page, "Applied").count()) &&
    json(".vaultite/bundles/trial.json")?.bundle === "standard")
  await shot(page, "trial-bar")
  await go(page, "")
  await until(() => page.locator("[data-bundle-trial]").count(), 6000)
  check("reloaded (another page): the bar is still there", await page.locator("[data-bundle-trial]").count() === 1)
  await shot(page, "trial-bar-note")
  await page.locator("[data-bundle-trial-revert]").click()
  await until(async () => !(await page.locator("[data-bundle-trial]").count()), 6000)
  check("Revert: the bar goes, the setup from before", JSON.stringify(look()) === before && !existsSync(`${VAULT}/.vaultite/bundles/trial.json`), [JSON.parse(before), look()])
  await dismissAll(page)
  await go(page)
  await preview(page, "standard")
  await sheet(page).locator("[data-bundle-try]").click()
  await until(() => page.locator("[data-bundle-trial]").count(), 8000)
  await page.locator("[data-bundle-trial-keep]").click()
  await until(async () => !(await page.locator("[data-bundle-trial]").count()), 6000)
  check("Keep: the bar goes, Standard stays", !existsSync(`${VAULT}/.vaultite/bundles/trial.json`) && json(".vaultite/bundles/applied.json")?.bundle === "standard" && look().rails === undefined, look())
  await dismissAll(page)
}

// ---------- 5. Get: the directory's layouts and packs beside its plugins ----------
{
  await go(page, "get")
  const browse = page.locator("[data-bundles-browse]")
  await until(() => browse.locator("[data-listed]").count() >= 2, 8000)
  const listed = await browse.locator("[data-listed]").evaluateAll((els) => els.map((e) => e.dataset.listed))
  check("Get: the directory's bundles, by stars", listed.join() === "qa/desk,boblee/fleet/bundles/lamps", listed)
  check("and its plugins under them, one search for both", await page.locator("[data-setup=get] [data-plugin-browse]").count() === 1 && await page.locator("[data-setup=get] [data-plugins-search]").count() === 1 &&
    await page.locator("[data-setup=get] [data-bundles-import]").count() === 1)
  check("each with its kind by its name, its author (not Vaultite's) under it, one that runs code saying so", /Look\s+by Alice Park/.test(await browse.locator('[data-listed="qa/desk"]').innerText()) &&
    /Installs|Runs code/.test(await browse.locator('[data-listed="boblee/fleet/bundles/lamps"] [data-bundle-runs-code]').innerText()), await browse.locator('[data-listed="qa/desk"]').innerText())
  const art = await browse.locator("[data-listed]").evaluateAll((els) => els.map((e) => ({ img: e.querySelectorAll("img").length, svg: e.querySelector("[data-layout-drawing]"),
    scheme: e.querySelector("[data-layout-drawing]")?.getAttribute("data-scheme"), glass: !!e.querySelector("[data-layout-drawing] rect[fill^='url(']"),
    w: e.querySelector("[data-layout-drawing]")?.getBoundingClientRect().width ?? 0 })).map(({ svg, ...x }) => ({ ...x, drawn: !!svg })))
  check("Get's cards are drawn, never screenshots: the look in its scheme, the pack's glass", art.length === 2 && art.every((x) => x.drawn && !x.img && x.w > 60) &&
    art[0].scheme === "dracula" && !art[0].glass && art[1].glass && !art[1].scheme, art)
  await shot(page, "get")
  const search = page.locator("[data-setup=get] [data-plugins-search] input")
  await search.fill("lamps")
  await until(async () => (await browse.locator("[data-listed]").count()) === 1, 6000)
  check("search", (await browse.locator("[data-listed]").first().getAttribute("data-listed")) === "boblee/fleet/bundles/lamps")
  await search.fill("nothing like it")
  await until(() => browse.locator("[data-bundles-browse-none]").count(), 6000)
  check("no match: a quiet line", await browse.locator("[data-bundles-browse-none]").count() === 1)
  await search.fill("")
  await until(() => browse.locator("[data-listed]").count() >= 2, 6000)
  await browse.locator('[data-listed="qa/desk"]').click()
  await until(() => sheet(page).locator("[data-bundle-incoming-add]").count(), 10_000)
  check("opening one is its import preview, pinned at the listed commit", (await sheet(page).innerText()).includes("From qa/desk") && !(await sheet(page).locator("[data-bundle-update]").count()))
  check("its picture drawn in the scheme it sets", await sheet(page).locator('[data-bundle-picture] [data-layout-drawing][data-scheme="dracula"]').count() === 1 && !(await sheet(page).locator("img").count()))
  await sheet(page).locator("[data-bundle-incoming-add]").click()
  await until(() => json(".vaultite/bundles/desk/bundle.json"), 6000)
  check("added, from that commit", json(".vaultite/bundles/desk/bundle.json")?.from === `qa/desk@${c1}`, json(".vaultite/bundles/desk/bundle.json"))
  await until(() => browse.locator('[data-listed="qa/desk"] [data-listed-imported]').count(), 6000)
  check("its card says Imported", await browse.locator('[data-listed="qa/desk"] [data-listed-imported]').count() === 1)
  await dismissAll(page)
  // A newer commit listed: Update available; its preview says what changed, and replaces the user's copy on their go.
  const c2 = commit("nord")
  index(c2)
  await api("GET", "bundles/browse?refresh=1")
  await go(page, "get")
  await until(() => browse.locator('[data-listed="qa/desk"] [data-listed-update]').count(), 8000)
  check("a newer commit listed: Update available", await browse.locator('[data-listed="qa/desk"] [data-listed-update]').count() === 1)
  await browse.locator('[data-listed="qa/desk"]').click()
  await until(() => sheet(page).locator("[data-bundle-update]").count(), 10_000)
  check("its preview: what's new, and Update", (await sheet(page).locator("[data-bundle-update]").innerText()).includes("appearance.json") &&
    (await sheet(page).locator("[data-bundle-incoming-add]").innerText()).includes("Update Writing desk") && json(".vaultite/bundles/desk/appearance.json")?.scheme === "dracula")
  await shot(page, "get-update")
  await sheet(page).locator("[data-bundle-incoming-add]").click()
  await until(() => json(".vaultite/bundles/desk/appearance.json")?.scheme === "nord", 6000)
  check("Update: replaced, at the new commit", json(".vaultite/bundles/desk/bundle.json")?.from === `qa/desk@${c2}`)
  await until(() => browse.locator('[data-listed="qa/desk"] [data-listed-imported]').count(), 6000)
  check("Imported again", await browse.locator('[data-listed="qa/desk"] [data-listed-imported]').count() === 1)
  await dismissAll(page)
  // (a look, not a layout: it isn't a tile in the picker)
  await go(page)
  check("an imported look isn't in the layout picker", !(await page.locator('[data-layout-pick="desk"]').count()))
  // Unreachable: one quiet line, no error toast.
  await page.route("**/api/bundles/browse*", (r) => r.abort())
  await go(page, "get")
  await until(() => browse.locator("[data-bundles-browse-off]").count(), 6000)
  check("unreachable: a quiet line, no error", await browse.locator("[data-bundles-browse-off]").count() === 1 && !(await page.locator('[data-sonner-toast][data-type="error"]').count()))
  await page.unroute("**/api/bundles/browse*")
  // Slow: skeleton cards, as many as last time, until the directory comes.
  let release
  const held = new Promise((r) => { release = r })
  await page.route("**/api/bundles/browse*", async (r) => { await held; await r.continue() })
  await go(page, "get")
  await until(() => browse.locator("[data-bundles-loading]").count(), 6000)
  const skel = await browse.locator("[data-bundles-loading] > *").count()
  check("slow: skeleton cards, as many as last time", skel === 2, skel)
  await shot(page, "get-loading")
  release()
  await until(() => browse.locator("[data-listed]").count() >= 2, 8000)
  check("then the cards, the skeletons gone", !(await browse.locator("[data-bundles-loading]").count()))
  await page.unroute("**/api/bundles/browse*")
}
await ctx.close()

// ---------- 6. Dark, and 390px ----------
{
  const { ctx: dc, page: dp } = await open(1600, 900, { dark: true })
  await go(dp)
  await dp.locator("[data-layout-picker]").screenshot({ path: `${OUT}dark-picker.png` })
  await go(dp, "get")
  await shot(dp, "dark-get")
  await go(dp)
  await preview(dp, "days")
  await sheet(dp).locator('[data-change^="install:"], [data-change^="plugin:"]').first().click()
  await shot(dp, "dark-sheet-ticks")
  await dp.keyboard.press("Escape")
  await dc.close()
  for (const dark of [false, true]) {
    const { ctx: pc, page: pp } = await open(390, 844, { mobile: true, dark })
    const name = dark ? "phone-dark" : "phone"
    await go(pp, "get")
    check(`${name}: Get fits`, await overflow(pp) <= 0, await overflow(pp))
    await pp.locator("[data-bundles-browse]").scrollIntoViewIfNeeded()
    await shot(pp, `${name}-get`)
    await go(pp, "settings/bundle/zen")
    await until(() => sheet(pp).locator('[data-bundle-preview="zen"] [data-change]').count(), 8000)
    const h = await line(pp, "plugin:glance").evaluate((e) => e.getBoundingClientRect().height)
    check(`${name}: a tick's line is a finger's size`, h >= 44, h)
    await line(pp, "plugin:glance").click()
    check(`${name}: the sheet fits`, await overflow(pp) <= 0, await overflow(pp))
    await shot(pp, `${name}-sheet`)
    if (!dark) {
      await sheet(pp).locator("[data-bundle-try]").click()
      await until(() => pp.locator("[data-bundle-trial]").count(), 8000)
      const bar = await pp.locator("[data-bundle-trial]").boundingBox(), keep = await pp.locator("[data-bundle-trial-keep]").boundingBox()
      check(`${name}: the bar spans the width above the phone's bar, its buttons a finger's size`, bar.width >= 350 && bar.y + bar.height < 844 - 48 && keep.height >= 44, [bar, keep])
      await shot(pp, `${name}-trial`)
      await pp.locator("[data-bundle-trial-revert]").click()
      await until(async () => !(await pp.locator("[data-bundle-trial]").count()), 6000)
    }
    await pc.close()
  }
}
for (const id of ["desk", "my-zen", "my-days", "days"]) await api("DELETE", `bundles/${id}`)
await done()
