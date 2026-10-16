// Review: what AIs changed, file by file. Agents' edits through the API (an MCP app named ChatGPT, Grok Bot; Claude making
// a note) are listed newest first in view:review with who and +/−, the first unfolded to its diff; the status bar's
// count; a changed file's header line opening its review; Keep (with Undo), Revert (the text before back), Archive for
// a new file; one writer's list (view:review/<name>); 390px. Screenshots light and dark. WRITES files in "QA review <run>/",
// appearance.json and Activity's settings, turns Activity on and keeps or reverts what it made: throwaway server only.
//   node web/qa/review.mjs <base url> <vault path> [out dir]
import { mkdirSync, readFileSync, rmSync } from "node:fs"
import { qa, until, wait } from "./lib/qa.mjs"
const { args: [BASE, VAULT, OUT = "/tmp/review-shots/"], browser, check, watch, done } = await qa(import.meta.url)
const B = BASE.replace(/\/+$/, "")
mkdirSync(OUT, { recursive: true })
const text = (rel) => { try { return readFileSync(`${VAULT}/${rel}`, "utf8") } catch { return null } }
const api = (method, p, body, headers = {}) => fetch(`${B}/api/${p}`, { method, headers: { "Content-Type": "application/json", ...headers }, body: body && JSON.stringify(body) }).then((r) => r.json())
const as = (client, agent) => ({ "X-Vaultite-Client": client, ...(agent ? { "X-Vaultite-Agent": agent } : {}) })
const app = as("app/desktop")
const enc = encodeURIComponent
const theme = (t) => api("PATCH", "config/appearance", { theme: t }, app)
const list = async (by) => (await api("POST", "ops/review.list", by ? { by } : {}, as("cli"))).files ?? []

// Activity on (some setups leave it off: the review is off with it), without its day recaps (their write asks first),
// everything before kept, then the agents write.
const plugins = await api("GET", "config/plugins", undefined, app)
await api("PATCH", "config/plugins", { enabled: [...(plugins.enabled ?? []).filter((x) => x !== "activity"), "activity"] }, app)
const recaps = (await api("GET", "config/plugin/activity", undefined, app))?.recaps
await api("PATCH", "config/plugin/activity", { recaps: false }, app)
await wait(1500)
// (a folder of its own each run: what agents did to an earlier run's files of the same names would show again)
const DIR = `QA review ${Date.now().toString(36).slice(-4)}`
const MAYA = `${DIR}/Maya Lopez.md`, TRIP = `${DIR}/Trip to Porto.md`, BOB = `${DIR}/Bob notes.md`
await api("PUT", "file", { path: MAYA, text: "# Maya Lopez\n\nMet at the Lighthouse launch.\nLikes tea.\n\n## Ideas\n\n- A gift for her birthday\n" }, app)
await api("PUT", "file", { path: BOB, text: "# Bob\n\nWorks on the Lighthouse beta.\n" }, app)
await wait(400)
await api("POST", "ops/review.keep", { all: true }, app)
check("nothing to review before the agents write", !(await list()).length, await list())
await api("POST", "ops/file.edit", { path: BOB, old: "Works on the Lighthouse beta.", new: "Works on the Lighthouse beta.\nMoving to Porto in spring." }, as("mcp", "Grok Bot"))
await wait(300)
await api("POST", "ops/file.write", { path: TRIP, text: "# Trip to Porto\n\n- Train on Friday evening\n- Stay near Ribeira\n" }, as("mcp", "Claude"))
await wait(300)
await api("POST", "ops/file.edit", { path: MAYA, old: "Likes tea.", new: "Likes mint tea.\nStarted the cello in September." }, as("mcp", "ChatGPT"))
const seeded = await until(async () => (await list()).length === 3, 5000)
check("three files to review, newest first, each with its writer", seeded && (await list()).map((f) => `${f.path}:${f.by}`).join() === `${MAYA}:ChatGPT,${TRIP}:Claude,${BOB}:Grok Bot`, await list())

async function open(w, h, mobile = false) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, ...(mobile ? { isMobile: true, hasTouch: true } : {}) })
  return { ctx, page: watch(await ctx.newPage(), { label: w }) }
}
// (load fresh: a hash set by hand is undone by the workspace's tabs)
const go = async (page, hash) => {
  await page.goto("about:blank"); await page.goto(`${B}/#${hash}`); await wait(1200)
  // (a plugin's write waiting for the owner's yes, Activity's recaps: not this test's)
  const later = page.locator("dialog[data-confirm] button", { hasText: "Not now" })
  if (await later.count()) { await later.click(); await wait(300) }
}
const card = (page, p) => page.locator(`[data-review-view] [data-review-file="${p}"]:visible`)

// ---------- desktop ----------
{
  const { ctx, page } = await open(1280, 800)
  await go(page, "view/review")
  const view = page.locator("[data-review-view]:visible")
  check("desktop: the view lists the three", await until(async () => (await view.locator("[data-review-file]").count()) === 3))
  const first = card(page, MAYA)
  check("desktop: who, +/− and when on each", /ChatGPT edited · \+2 −1 · just now/.test(await first.innerText()), await first.innerText())
  check("desktop: the base is the text just before, the user's own edits not in it", !(await first.innerText()).includes("Your own edits"), await first.innerText())
  check("desktop: the newest unfolded to its diff, lines added and removed", await until(async () => (await first.locator("[data-diff=add]").count()) === 2 && (await first.locator("[data-diff=del]").count()) === 1))
  check("desktop: a new file says so", /Claude created · new file/.test(await card(page, TRIP).innerText()), await card(page, TRIP).innerText())
  const count = page.locator("[role=status] button[aria-label^='AI changes to review']")
  check("desktop: the status bar counts them", await until(async () => (await count.innerText()).trim() === "3"), await count.count())
  for (const t of ["light", "dark"]) {
    await theme(t); await wait(700)
    await page.screenshot({ path: `${OUT}desktop-${t}-list.png` })
    const sb = await count.boundingBox()
    await page.screenshot({ path: `${OUT}desktop-${t}-status.png`, clip: { x: sb.x - 120, y: sb.y - 6, width: 260, height: sb.height + 12 } })
  }
  await theme("light")

  // Keep, then Undo from the toast.
  await first.locator("[data-review-keep]").click()
  check("desktop: Keep takes it off the list", await until(async () => (await card(page, MAYA).count()) === 0 && !(await list()).some((f) => f.path === MAYA)))
  await page.locator("[data-sonner-toast] button", { hasText: "Undo" }).click()
  check("desktop: Undo brings it back", await until(async () => (await list()).some((f) => f.path === MAYA), 6000))
  // Revert: the text before is back.
  await until(async () => (await card(page, MAYA).count()) === 1)
  if (!(await card(page, MAYA).locator("[data-review-revert]").count())) await card(page, MAYA).locator("button[aria-expanded]").click()
  await card(page, MAYA).locator("[data-review-revert]").click()
  check("desktop: Revert writes the text before back", await until(() => text(MAYA)?.includes("Likes tea.\n") && !text(MAYA).includes("cello")), text(MAYA))
  // A new file: Archive.
  await card(page, TRIP).locator("button[aria-expanded]").click()
  await until(async () => (await card(page, TRIP).locator("[data-review-revert]").count()) === 1)
  check("desktop: a new file's diff is all added, its button Archive", (await card(page, TRIP).locator("[data-diff=del]").count()) === 0 && (await card(page, TRIP).locator("[data-review-revert]").innerText()).trim() === "Archive")
  await card(page, TRIP).locator("[data-review-revert]").click()
  check("desktop: Archive moves it out of the way", await until(() => text(TRIP) === null))
  check("desktop: the count follows", await until(async () => (await count.innerText()).trim() === "1"))

  // A changed file's header: who changed it, opening its review.
  await go(page, `file/${enc(BOB)}`)
  const chip = page.locator(`.file-view[data-path="${BOB}"]:visible [data-review-chip]`)
  check("desktop: the header says who changed it", await until(async () => (await chip.count()) === 1 && /Grok Bot changed this\s*· Review/.test(await chip.innerText())), await chip.count())
  for (const t of ["light", "dark"]) {
    await theme(t); await wait(700)
    const box = await chip.boundingBox()
    await page.screenshot({ path: `${OUT}desktop-${t}-header.png`, clip: { x: Math.max(0, box.x - 420), y: Math.max(0, box.y - 12), width: 700, height: 52 } })
  }
  await theme("light")
  await chip.click()
  const one = page.locator(`[data-review-view="${BOB}"]:visible`)
  check("desktop: it opens that file's review, unfolded", await until(async () => (await one.locator("[data-diff=add]").count()) === 1), await one.count())
  await wait(800)
  await page.screenshot({ path: `${OUT}desktop-light-file.png` })

  // One writer's list: what the Connections page opens.
  await go(page, `view/${enc(`review/${enc("Grok Bot")}`)}`)
  check("desktop: one writer's list", await until(async () => (await page.locator("[data-review-view]:visible [data-review-file]").count()) === 1 && (await page.locator("[data-review-view]:visible").innerText()).includes("What Grok Bot changed")))
  await ctx.close()
}

// ---------- 390 ----------
{
  await api("POST", "ops/file.edit", { path: MAYA, old: "Likes tea.", new: "Likes green tea." }, as("mcp", "ChatGPT"))
  await until(async () => (await list()).length === 2)
  const { ctx, page } = await open(390, 844, true)
  await go(page, "view/review")
  const first = card(page, MAYA)
  check("390: the list, its newest unfolded", await until(async () => (await first.locator("[data-diff=add]").count()) === 1))
  const fit = await page.evaluate(() => {
    const view = [...document.querySelectorAll("[data-review-view]")].find((e) => e.checkVisibility())
    const btns = [...view.querySelectorAll("[data-review-keep], [data-review-revert]")]
    return { wide: document.documentElement.scrollWidth, right: Math.max(...[...view.querySelectorAll("[data-review-file]")].map((e) => e.getBoundingClientRect().right)), h: Math.min(...btns.map((b) => b.getBoundingClientRect().height)) }
  })
  check("390: it fits, 44px buttons, nothing wider than the screen", fit.wide <= 390 && fit.right <= 390 && fit.h >= 44, fit)
  for (const t of ["light", "dark"]) { await theme(t); await wait(700); await page.screenshot({ path: `${OUT}phone-${t}-list.png` }) }
  await theme("light")
  await go(page, `file/${enc(MAYA)}`)
  const chip = page.locator(`[data-review-chip]:visible`)
  check("390: the line above the title says who changed it", await until(async () => (await chip.count()) === 1))
  const box = await chip.boundingBox()
  check("390: a 44px target, on screen", box && box.height >= 44 && box.x + box.width <= 390, box)
  for (const t of ["light", "dark"]) { await theme(t); await wait(700); await page.screenshot({ path: `${OUT}phone-${t}-header.png`, clip: { x: 0, y: 0, width: 390, height: 300 } }) }
  await theme("light")
  await chip.click()
  check("390: it opens the file's review", await until(async () => (await page.locator(`[data-review-view="${MAYA}"]:visible [data-diff]`).count()) > 0))
  await page.screenshot({ path: `${OUT}phone-light-file.png` })
  await ctx.close()
}

await api("POST", "ops/review.keep", { all: true }, app)
await api("PATCH", "config/plugin/activity", { recaps: recaps ?? null }, app)
rmSync(`${VAULT}/${DIR}`, { recursive: true, force: true })
await done()
