// Switching layouts loses nothing: a layout and back (Standard, Browser: Workspaces on and off) puts back exactly the
// tabs, tab groups, splits, sizes and focus there were, whether the workspace was unused or had tabs of its own, after
// a reload too, and from the picker. WRITES the vault's settings: throwaway servers only.
//   node web/qa/layoutswitch.mjs <base url>
import { spawnSync } from "node:child_process"
import path from "node:path"
import { ROOT, apiAt, qa, until, wait } from "./lib/qa.mjs"

const { args: [B], browser, check, watch, done } = await qa(import.meta.url)
const api = apiAt(B)

function apply(id) {
  const r = spawnSync(process.execPath, [path.join(ROOT, "bin/vau"), "bundle", "apply", id, "--code"], { encoding: "utf8", env: { ...process.env, VAULTITE_URL: B.replace(/\/$/, "") } })
  if (r.status !== 0) throw new Error(r.stderr || r.stdout)
}

const OLD = Date.now() - 3 * 86_400_000
const p = (id, to, extra = {}) => ({ id, to, seen: OLD, ...extra })
/** Tabs worth losing: two groups (one folded), a split of a split with its own sizes, a name, a pin, focus off the first. */
const MINE = {
  active: "t2",
  groups: [{ id: "g1", name: "Trip", color: "teal" }, { id: "g2", name: "Later", color: "red", collapsed: true }],
  tabs: [
    { id: "t1", group: "g1", root: p("p1", "file:Start here.md"), focus: "p1", pinned: true },
    { id: "t2", group: "g1", focus: "p3", root: { id: "s1", dir: "row", sizes: [0.3, 0.7], kids: [p("p2", "file:Notes/Lisbon trip.md"),
      { id: "s2", dir: "col", sizes: [0.65, 0.35], kids: [p("p3", "file:Notes/How this vault works.md"), p("p4", "view:files")] }] } },
    { id: "t3", group: "g2", root: p("p5", "view:folder/Notes"), focus: "p5", name: "Desk" },
    { id: "t4", root: p("p6", "view:search/lisbon"), focus: "p6" },
  ],
}
const THEIRS = { active: "w2", tabs: [{ id: "w1", root: { id: "q1", to: "file:Start here.md" }, focus: "q1" }, { id: "w2", root: { id: "q2", to: "view:files" }, focus: "q2" }] }

/** What a layout is made of, without what's only for this visit or the archive's stamps. */
const shapeOf = (l) => l && JSON.stringify(l, (k, v) => (["seen", "back", "fwd", "from", "home", "windows"].includes(k) ? undefined
  : v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v))
/** The tabs on screen as this device keeps them: its own, or the workspace's while Workspaces holds them. */
const shown = (page) => page.evaluate(() => {
  const held = localStorage.getItem("vaultite.tabs.workspace")
  return { held: held !== null, tabs: JSON.parse(held ?? localStorage.getItem("vaultite.tabs") ?? "null") }
})
const numbers = (page) => page.locator("[data-workspace-switcher], [data-workspace]").count()

const ctx = await browser.newContext({ viewport: { width: 1280, height: 820 } })
const page = watch(await ctx.newPage(), { label: "layoutswitch" })
const fresh = async () => { await page.goto("about:blank"); await page.goto(B); await until(() => page.locator("[data-status-bar]").count(), 10_000); await wait(1500) }
const holds = (on) => until(async () => (await shown(page)).held === on, 10_000).then(() => wait(1200))

try {
  // ---- Standard, my tabs; Browser turns Workspaces on (its workspace unused); back to Standard ----
  apply("standard")
  await api("DELETE", "workspaces/1")
  // (seeded from a page of the server's that isn't the app, so the app doesn't write its own first tab over them)
  await page.goto(`${B}api/workspaces`)
  await page.evaluate((l) => { localStorage.removeItem("vaultite.tabs.workspace"); localStorage.setItem("vaultite.tabs", JSON.stringify(l)) }, MINE)
  await fresh()
  const before = await shown(page)
  check("seeded: my tabs on screen, Workspaces not holding them", !before.held && shapeOf(before.tabs) === shapeOf(MINE), before)

  apply("browser")
  await holds(true)
  const inBrowser = await shown(page)
  check("Browser: the tabs on screen stay, now the unused workspace's", shapeOf(inBrowser.tabs) === shapeOf(MINE), inBrowser.tabs)
  await until(async () => shapeOf((await api("GET", "workspaces")).workspaces?.[0]?.layout) === shapeOf(MINE), 8000)
  check("Browser: workspace 1 saved them, groups and splits too", shapeOf((await api("GET", "workspaces")).workspaces?.[0]?.layout) === shapeOf(MINE))

  apply("standard")
  await holds(false)
  check("back to Standard: exactly the tabs, groups, splits, sizes and focus before", shapeOf((await shown(page)).tabs) === shapeOf(MINE), (await shown(page)).tabs)
  await fresh()
  check("and after a reload", shapeOf((await shown(page)).tabs) === shapeOf(MINE))

  // ---- the workspace has tabs of its own: Browser shows them, Standard gives mine back, Browser theirs again ----
  await api("PUT", "workspaces/1", { layout: THEIRS })
  apply("browser")
  await holds(true)
  await until(async () => shapeOf((await shown(page)).tabs) === shapeOf(THEIRS), 8000)
  check("Browser over a workspace with tabs: its tabs, not mine", shapeOf((await shown(page)).tabs) === shapeOf(THEIRS), (await shown(page)).tabs)
  check("Browser: workspace 1's tabs weren't overwritten by mine", shapeOf((await api("GET", "workspaces")).workspaces?.[0]?.layout) === shapeOf(THEIRS))
  await fresh()
  check("Browser, reloaded: still the workspace's", shapeOf((await shown(page)).tabs) === shapeOf(THEIRS))
  apply("standard")
  await holds(false)
  check("Standard again: mine, exactly", shapeOf((await shown(page)).tabs) === shapeOf(MINE), (await shown(page)).tabs)
  apply("browser")
  await holds(true)
  await until(async () => shapeOf((await shown(page)).tabs) === shapeOf(THEIRS), 8000)
  check("Browser again: the workspace's, exactly", shapeOf((await shown(page)).tabs) === shapeOf(THEIRS), (await shown(page)).tabs)

  // ---- off while the app was closed: it opens on my tabs, not the workspace's ----
  await page.goto("about:blank")
  apply("standard")
  await fresh()
  await holds(false)
  check("turned off while closed: my tabs when it opens", shapeOf((await shown(page)).tabs) === shapeOf(MINE), (await shown(page)).tabs)

  // ---- from the picker, as the user does it: a click on Browser, then on Standard ----
  await api("DELETE", "workspaces/1")
  await page.goto("about:blank"); await page.goto(`${B}#settings`)
  /** Layout tile `id`, clicked (a narrow pane lists Settings' sections: Appearance opens first). */
  const pick = async (id) => {
    await until(() => page.locator("[data-layout-pick], [data-settings-list]").count(), 8000)
    if (!(await page.locator(`[data-layout-pick=${id}]`).count())) await page.locator("[data-settings-nav=appearance]").first().click()
    await until(() => page.locator(`[data-layout-pick=${id}]`).count(), 8000)
    await page.locator(`[data-layout-pick=${id}]`).first().click()
  }
  await wait(1500)
  await until(() => page.locator("[data-layout-pick], [data-settings-list]").count(), 8000)
  if (!(await page.locator("[data-layout-pick]").count())) { await page.locator("[data-settings-nav=appearance]").first().click(); await wait(800) }
  const set = (await shown(page)).tabs
  await pick("browser")
  await holds(true)
  check("picker, Browser: the same tabs on screen", shapeOf((await shown(page)).tabs) === shapeOf(set), (await shown(page)).tabs)
  check("picker, Browser: Workspaces is on", (await numbers(page)) > 0 || (await api("GET", "workspaces")).workspaces?.[0] != null)
  await pick("standard")
  await holds(false)
  check("picker, back to Standard: exactly as before", shapeOf((await shown(page)).tabs) === shapeOf(set), [(await shown(page)).tabs, set])
} finally {
  apply("standard")
}
await done()
