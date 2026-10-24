// Bundles, choosing (pages/Bundles.tsx, components/BundleTrial.tsx): a preview's ticks (leaving changes out, Save as
// "<Name> (mine)", an install's plugin going with it), the bundle in use once the setup changes (In use · modified, Save
// changes, Revert), trying one (the bar's Keep and Revert, after a reload too), and Browse (the directory, from a made-up
// index and repository: Imported, Update available and its preview, a search, unreachable). Desktop and 390px, light and
// dark. Screenshots.
// WRITES the vault's settings and bundles, and the fixture folder: throwaway servers only, started with
// VAULTITE_PLUGIN_INDEX=<fixture dir>/index.json VAULTITE_GITHUB=file://<fixture dir>/repos.
//   node web/qa/bundle-choices.mjs <base url> <vault path> <fixture dir> [out dir]
import { execFileSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { ROOT, qa, until, wait } from "./lib/qa.mjs"

const { args: [B, VAULT, FX, OUT = "/tmp/bundle-choices-shots/"], browser, check, watch, done } = await qa(import.meta.url)
mkdirSync(OUT, { recursive: true })
const json = (rel) => { try { return JSON.parse(readFileSync(`${VAULT}/${rel}`, "utf8")) } catch { return null } }
const api = async (method, path, body) => {
  const r = await fetch(`${B}/api/${path}`, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) })
  return r.json().catch(() => null)
}
const look = () => json(".vaultite/appearance.json") ?? {}
const enabled = () => json(".vaultite/plugins.json")?.enabled ?? []

// ---------- the fixture: a repository with a bundle, and an index listing it ----------
const REPO = `${FX}/repos/qa/desk`
const git = (...a) => execFileSync("git", ["-C", REPO, ...a], { encoding: "utf8" }).trim()
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
  writeFileSync(`${FX}/index.json`, JSON.stringify({ format: 1, generated: "2026-10-01T00:00:00Z", plugins: [], blocked: {}, bundles: [
    entry({ name: "Writing desk", description: "Pages for writing.", author: "Alice Park", repo: "qa/desk", commit: desk, stars: 9, icon: "pen", tint: "purple" }),
    entry({ name: "Lamps", repo: "boblee/fleet", dir: "bundles/lamps", commit: "c".repeat(40), runsCode: true, installs: [{ id: "tasks", name: "Tasks", source: "Vaultite/plugins/tasks" }] }),
  ] }))
}
rmSync(`${FX}/repos/qa`, { recursive: true, force: true })
mkdirSync(FX, { recursive: true })
const c1 = commit("dracula")
index(c1)
await api("GET", "bundles/browse?refresh=1")
// (from Standard, whatever ran before: Zen's every change is one to make)
for (const id of ["desk", "zen-mine", "days-mine"]) await api("DELETE", `bundles/${id}`)
// (Days: a bundle installing Vaultite's own plugins, as the directory's Life OS)
cpSync(`${ROOT}/tools/fixtures/bundles/days`, `${VAULT}/.vaultite/bundles/days`, { recursive: true })
await api("POST", "bundles/standard/apply", {})
rmSync(`${VAULT}/Guides/How Zen works.md`, { force: true })

async function open(w, h, { mobile = false, dark = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: dark ? "dark" : "light", ...(mobile ? { isMobile: true, hasTouch: true } : {}) })
  return { ctx, page: watch(await ctx.newPage(), { label: `${w}${dark ? " dark" : ""}` }) }
}
const shot = async (page, name) => { await wait(600); await page.screenshot({ path: `${OUT}${name}.png` }) }
async function go(page, h = "bundles") {
  await page.goto("about:blank")
  await page.goto(`${B}#${h}`)
  await until(() => page.locator("main").count(), 6000)
  await until(() => page.locator("[data-bundle]").count() >= 3, 8000)
  await wait(600)
}
const sheet = (page) => page.locator("dialog[open]")
async function preview(page, id) {
  await page.locator(`[data-bundle="${id}"]`).click()
  await until(() => sheet(page).locator(`[data-bundle-preview="${id}"] [data-change]`).count(), 8000)
}
const line = (page, id) => sheet(page).locator(`[data-change="${id}"]`)
const checked = async (page, id) => (await line(page, id).getAttribute("aria-checked")) === "true"
const toastWith = (page, text) => page.locator("[data-sonner-toast]", { hasText: text }).first()
const dismissAll = async (page) => { await page.mouse.move(5, 5); await page.waitForFunction(() => !document.querySelector("[data-sonner-toast]"), null, { timeout: 20_000 }).catch(() => {}) }
const overflow = (page) => page.evaluate(() => { const d = document.querySelector("dialog[open]") ?? document.documentElement; return d.scrollWidth - d.clientWidth })

const { ctx, page } = await open(1280, 820)

// ---------- 1. Ticks: leave changes out, Apply ----------
{
  await go(page)
  await preview(page, "zen")
  const ids = await sheet(page).locator("[data-change]").evaluateAll((els) => els.map((e) => e.dataset.change))
  check("Zen's preview: a tick per change, all on", ids.length > 10 && ids.includes("plugin:glance") && ids.includes("appearance:scheme") && ids.includes("panels") &&
    (await sheet(page).locator('[data-change][aria-checked="false"]').count()) === 0, ids)
  check("its guide is a line of its own, ticked", await sheet(page).locator('[data-bundle-guide][data-change^="file:"]').count() === 1)
  check("all on: Apply Zen, Try, no Save as", (await sheet(page).locator("[data-bundle-apply]").innerText()).includes("Apply Zen") && await sheet(page).locator("[data-bundle-try]").count() === 1 &&
    !(await sheet(page).locator("[data-bundle-fork]").count()))
  await line(page, "plugin:glance").click()
  await line(page, "appearance:scheme").click()
  check("unticked, they're off", !(await checked(page, "plugin:glance")) && !(await checked(page, "appearance:scheme")))
  check("then: Apply, Try, Save as Zen (mine), and how many are left out", (await sheet(page).locator("[data-bundle-apply]").innerText()).trim() === "Apply" &&
    (await sheet(page).locator("[data-bundle-fork]").innerText()).includes("Save as Zen (mine)") && (await sheet(page).locator("[data-bundle-leaving]").innerText()).includes("Leaving out 2"))
  await shot(page, "sheet-ticks")
  await line(page, "plugin:glance").scrollIntoViewIfNeeded()
  await shot(page, "sheet-ticks-plugins")
  const scheme = look().scheme ?? null
  await sheet(page).locator("[data-bundle-apply]").click()
  await until(() => toastWith(page, "Applied Zen").count(), 8000)
  await until(() => look().rails === false, 6000)
  check("applied without them: Zen's rails, but not its scheme nor Glance", look().rails === false && (look().scheme ?? null) === scheme && !enabled().includes("glance"), [look(), enabled()])
  check("and it's remembered with what it left out", JSON.stringify(json(".vaultite/bundles/applied.json")?.skip?.sort()) === JSON.stringify(["appearance:scheme", "plugin:glance"]), json(".vaultite/bundles/applied.json"))
  await dismissAll(page)
  await go(page)
  check("its card says In use (what it left out doesn't count)", await page.locator('[data-bundle="zen"] [data-bundle-in-use]').count() === 1)
}

// ---------- 2. Drift: In use · modified, Revert, Save changes ----------
{
  await api("PATCH", "config/appearance", { density: look().density === "compact" ? "comfortable" : "compact", tabBar: true })
  await go(page)
  await until(() => page.locator('[data-bundle="zen"] [data-bundle-modified]').count(), 6000)
  const tip = await page.locator('[data-bundle="zen"] [data-bundle-modified]').getAttribute("data-tip")
  check("changed since: In use · modified, what differs in its tip", (await page.locator('[data-bundle="zen"] [data-bundle-modified]').innerText()).includes("In use · modified") &&
    /Density/.test(tip) && /Tab bar/.test(tip), tip)
  await page.locator("[data-bundles-app]").screenshot({ path: `${OUT}card-modified.png` })
  await preview(page, "zen")
  check("its sheet says so: Save as Zen (mine) (a built-in), Revert", await sheet(page).locator("[data-bundle-drift]").count() === 1 &&
    (await sheet(page).locator("[data-bundle-save-changes]").innerText()).includes("Save as Zen (mine)") && await sheet(page).locator("[data-bundle-revert]").count() === 1)
  check("what it left out stays unticked, what differs ticked", !(await checked(page, "plugin:glance")) && await checked(page, "appearance:density") && await checked(page, "appearance:tabBar"))
  await shot(page, "sheet-modified")
  await sheet(page).locator("[data-bundle-revert]").click()
  await until(() => look().tabBar === false, 6000)
  check("Revert: Zen again, still without what it left out", look().tabBar === false && !enabled().includes("glance"), [look(), enabled()])
  await dismissAll(page)
  await go(page)
  await until(() => page.locator('[data-bundle="zen"] [data-bundle-in-use]').count(), 6000)
  check("and it's In use again", await page.locator('[data-bundle="zen"] [data-bundle-in-use]').count() === 1)
  // Save changes on a built-in: a new "Zen (mine)", the one in use.
  await api("PATCH", "config/appearance", { tabBar: true })
  await go(page)
  await until(() => page.locator('[data-bundle="zen"] [data-bundle-modified]').count(), 6000)
  await preview(page, "zen")
  await sheet(page).locator("[data-bundle-save-changes]").click()
  await until(() => json(".vaultite/bundles/zen-mine/bundle.json"), 6000)
  check("Save as Zen (mine): a new bundle with the changes, in use", json(".vaultite/bundles/zen-mine/bundle.json")?.name === "Zen (mine)" &&
    json(".vaultite/bundles/zen-mine/appearance.json")?.tabBar === true && json(".vaultite/bundles/applied.json")?.bundle === "zen-mine", json(".vaultite/bundles/zen-mine/appearance.json"))
  await until(() => page.locator('[data-bundle="zen-mine"] [data-bundle-in-use]').count(), 6000)
  check("its card says In use", await page.locator('[data-bundle="zen-mine"] [data-bundle-in-use]').count() === 1)
  await dismissAll(page)
  // Save changes on the user's own: saved over it.
  await api("PATCH", "config/appearance", { statusBar: true })
  await go(page)
  await until(() => page.locator('[data-bundle="zen-mine"] [data-bundle-modified]').count(), 6000)
  await preview(page, "zen-mine")
  check("the user's own: Save changes", (await sheet(page).locator("[data-bundle-save-changes]").innerText()).trim() === "Save changes")
  await sheet(page).locator("[data-bundle-save-changes]").click()
  await until(() => json(".vaultite/bundles/zen-mine/appearance.json")?.statusBar === true, 6000)
  check("Save changes: saved over it", json(".vaultite/bundles/zen-mine/appearance.json")?.statusBar === true && json(".vaultite/bundles/zen-mine/bundle.json")?.name === "Zen (mine)")
  await until(() => page.locator('[data-bundle="zen-mine"] [data-bundle-in-use]').count(), 6000)
  check("in use again", await page.locator('[data-bundle="zen-mine"] [data-bundle-in-use]').count() === 1)
  await dismissAll(page)
}

// ---------- 3. Save as "<Name> (mine)"; an install's plugin goes with it ----------
{
  await go(page)
  await preview(page, "days")
  await line(page, "install:books").click()
  check("an install left out: its plugin can't be turned on", !(await checked(page, "install:books")) && !(await checked(page, "plugin:books")) &&
    (await line(page, "plugin:books").getAttribute("aria-disabled")) === "true")
  await line(page, "plugin:books").click({ force: true })
  check("and ticking it does nothing", !(await checked(page, "plugin:books")))
  await line(page, "install:books").scrollIntoViewIfNeeded()
  await shot(page, "sheet-install-off")
  await sheet(page).locator("[data-bundle-fork]").click()
  await until(() => sheet(page).locator('[data-bundle-preview="days-mine"]').count(), 8000)
  const pj = json(".vaultite/bundles/days-mine/plugins.json")
  check("Save as Days (mine): saved without Books, and its sheet is open", json(".vaultite/bundles/days-mine/bundle.json")?.name === "Days (mine)" && !pj?.install?.books &&
    !!pj?.install?.today && await toastWith(page, "Saved Days (mine)").count() === 1, pj)
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
  await go(page)
  await until(() => page.locator('[data-bundle="standard"] [data-bundle-trying]').count(), 6000)
  check("its card says Trying", await page.locator('[data-bundle="standard"] [data-bundle-trying]').count() === 1)
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

// ---------- 5. Browse: the directory ----------
{
  await go(page)
  await page.locator("[data-bundles-get]").click()
  const browse = page.locator("[data-bundles-browse]")
  await until(() => browse.locator("[data-listed]").count() >= 2, 8000)
  const listed = await browse.locator("[data-listed]").evaluateAll((els) => els.map((e) => e.dataset.listed))
  check("Browse: the directory's bundles, by stars", listed.join() === "qa/desk,boblee/fleet/bundles/lamps", listed)
  check("each with its author and stars, one that runs code marked", (await browse.locator('[data-listed="qa/desk"]').innerText()).includes("Alice Park") &&
    await browse.locator('[data-listed="boblee/fleet/bundles/lamps"] [data-bundle-runs-code]').count() === 1)
  await page.locator("[data-bundles-search] input").fill("lamps")
  await until(async () => (await browse.locator("[data-listed]").count()) === 1, 6000)
  check("search", (await browse.locator("[data-listed]").first().getAttribute("data-listed")) === "boblee/fleet/bundles/lamps")
  await page.locator("[data-bundles-search] input").fill("nothing like it")
  await until(() => browse.locator("[data-bundles-browse-none]").count(), 6000)
  check("no match: a quiet line", await browse.locator("[data-bundles-browse-none]").count() === 1)
  await page.locator("[data-bundles-search] input").fill("")
  await until(() => browse.locator("[data-listed]").count() >= 2, 6000)
  await browse.locator('[data-listed="qa/desk"]').click()
  await until(() => sheet(page).locator("[data-bundle-incoming-add]").count(), 10_000)
  check("opening one is its import preview, pinned at the listed commit", (await sheet(page).innerText()).includes("From qa/desk") && !(await sheet(page).locator("[data-bundle-update]").count()))
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
  await go(page)
  await page.locator("[data-bundles-get]").click()
  await until(() => browse.locator('[data-listed="qa/desk"] [data-listed-update]').count(), 8000)
  check("a newer commit listed: Update available", await browse.locator('[data-listed="qa/desk"] [data-listed-update]').count() === 1)
  await browse.scrollIntoViewIfNeeded()
  await shot(page, "browse")
  await browse.locator('[data-listed="qa/desk"]').click()
  await until(() => sheet(page).locator("[data-bundle-update]").count(), 10_000)
  check("its preview: what's new, and Update", (await sheet(page).locator("[data-bundle-update]").innerText()).includes("appearance.json") &&
    (await sheet(page).locator("[data-bundle-incoming-add]").innerText()).includes("Update Writing desk") && json(".vaultite/bundles/desk/appearance.json")?.scheme === "dracula")
  await shot(page, "browse-update")
  await sheet(page).locator("[data-bundle-incoming-add]").click()
  await until(() => json(".vaultite/bundles/desk/appearance.json")?.scheme === "nord", 6000)
  check("Update: replaced, at the new commit", json(".vaultite/bundles/desk/bundle.json")?.from === `qa/desk@${c2}`)
  await until(() => browse.locator('[data-listed="qa/desk"] [data-listed-imported]').count(), 6000)
  check("Imported again", await browse.locator('[data-listed="qa/desk"] [data-listed-imported]').count() === 1)
  await dismissAll(page)
  // The user's card's Check for updates goes through the same preview (pasting without one can't replace it).
  await page.locator("[data-bundles-yours]").click()
  await page.locator('[data-bundle="desk"]').hover()
  await page.locator('[data-bundle="desk"] ~ button').click()
  await page.getByText("Check for updates…").click()
  await until(() => sheet(page).locator("[data-bundle-incoming-add]").count(), 10_000)
  check("Check for updates: the import preview, as an update", (await sheet(page).locator("[data-bundle-incoming-add]").innerText()).includes("Update Writing desk"))
  await page.keyboard.press("Escape")
  // Unreachable: one quiet line, no error toast.
  await page.route("**/api/bundles/browse*", (r) => r.abort())
  await go(page)
  await page.locator("[data-bundles-get]").click()
  await until(() => browse.locator("[data-bundles-browse-off]").count(), 6000)
  check("unreachable: a quiet line, no error", await browse.locator("[data-bundles-browse-off]").count() === 1 && !(await page.locator('[data-sonner-toast][data-type="error"]').count()))
  await page.unroute("**/api/bundles/browse*")
}
await ctx.close()

// ---------- 6. Dark, and 390px ----------
{
  const { ctx: dc, page: dp } = await open(1280, 820, { dark: true })
  await go(dp)
  await dp.locator("[data-bundles-get]").click()
  await dp.locator("[data-bundles-browse]").scrollIntoViewIfNeeded()
  await shot(dp, "dark-browse")
  await dp.locator("[data-bundles-yours]").click()
  await preview(dp, "days")
  await line(dp, "install:health").click()
  await shot(dp, "dark-sheet-ticks")
  await dp.keyboard.press("Escape")
  await dc.close()
  for (const dark of [false, true]) {
    const { ctx: pc, page: pp } = await open(390, 844, { mobile: true, dark })
    const name = dark ? "phone-dark" : "phone"
    await go(pp)
    check(`${name}: the page fits`, await overflow(pp) <= 0, await overflow(pp))
    await pp.locator("[data-bundles-get]").click()
    await pp.locator("[data-bundles-browse]").scrollIntoViewIfNeeded()
    await shot(pp, `${name}-browse`)
    await pp.locator("[data-bundles-yours]").click()
    await preview(pp, "zen")
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
for (const id of ["desk", "zen-mine", "days-mine", "days"]) await api("DELETE", `bundles/${id}`)
await done()
