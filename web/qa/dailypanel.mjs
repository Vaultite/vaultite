// The Daily note panel (plugins/core/daily-notes/Day.tsx): shown from the sidebar's More ▸, today's note edited in it
// beside an open note and saved, ‹ › and Today stepping days, a missing day shown without making it and started from
// it, the menu's "Open … note in a tab". WRITES today's note, makes the first missing day after it and shows the panel
// (sidebars.json): throwaway only.
//   node web/qa/dailypanel.mjs <base url> [screenshot]
import { qa, until, wait } from "./lib/qa.mjs"
const { args: [B, SHOT = "/tmp/dailypanel.png"], browser, check, watch, done } = await qa(import.meta.url)
const api = (p) => fetch(new URL(`/api/${p}`, B)).then((r) => r.json())
const text = async (path) => (await api(`file?path=${encodeURIComponent(path)}`)).text ?? ""
const dayOf = (date) => api(`daily-notes/day?date=${date}`)
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
const plus = (date, n) => { const d = new Date(`${date}T12:00:00`); d.setDate(d.getDate() + n); return iso(d) }

const page = watch(await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: "light" }))
const P = "aside[data-side=left] [data-panel='daily-notes:daily']"
const shownDay = () => page.$eval(`${P} [data-daily-panel]`, (e) => e.dataset.dailyPanel).catch(() => null)
const heading = () => page.$eval(`${P} [data-heading]`, (e) => e.dataset.heading).catch(() => null)
const button = async (label) => { await page.hover(`${P} [data-panel-handle]`); await page.click(`${P} [aria-label='${label}']`); await wait(300) }
const menuItems = () => page.$$eval("[role=menu] [role^=menuitem]", (els) => els.map((e) => e.textContent.trim()))
const closeMenus = async () => { while (await page.$("[role=menu]")) { await page.keyboard.press("Escape"); await wait(100) } }

// (hidden again, as a vault starts: an earlier run showed it)
const KEY = "daily-notes:daily", JSON_PUT = { method: "PUT", headers: { "Content-Type": "application/json" } }
const without = (s) => ({ ...s, left: (s.left ?? []).filter((k) => k !== KEY), right: (s.right ?? []).filter((k) => k !== KEY) })
await fetch(new URL("/api/config/sidebars", B), { ...JSON_PUT, body: JSON.stringify(without(await api("config/sidebars"))) })
for (const [i, w] of ((await api("workspaces")).workspaces ?? []).entries()) {
  if (w?.sidebars) await fetch(new URL(`/api/workspaces/${i + 1}`, B), { ...JSON_PUT, body: JSON.stringify({ sidebars: without(w.sidebars) }) })
}

try {
  const note = `${(await api("state")).notes.find((n) => !/journal/i.test(n.id)).id}.md`
  await page.goto(`${B}#file/${encodeURIComponent(note)}`); await page.waitForSelector("[data-pane] .cm-content", { timeout: 20_000 }); await wait(800)

  // ---------- shown from the sidebar's menu (hidden by default) ----------
  check("hidden by default", !(await page.$(P)))
  await page.click("aside[data-side=left] [data-titlebar]", { button: "right" })
  await page.locator("[role=menu]").first().locator(":scope > button", { hasText: /^More$/ }).hover(); await wait(300)
  await page.locator("[role=menu]").nth(1).locator("button", { hasText: "Daily note" }).click()
  await closeMenus()
  check("shown from More ▸", !!(await until(() => page.$(P))))

  // ---------- today's note, edited in place beside the open note ----------
  const today = await until(() => shownDay())
  check("it shows today, headed Today", today === iso(new Date()) && (await heading()) === "Today", [today, await heading()])
  const todayPath = (await dayOf(today)).path
  if (!(await dayOf(today)).exists) await page.click(`${P} [data-daily-start]`)
  await page.waitForSelector(`${P} .cm-content`)
  await page.click(`${P} .cm-content`); await page.keyboard.press("ControlOrMeta+End")
  await page.keyboard.press("Enter"); await page.keyboard.type("Sidebar scratch: ask Alice about the launch")
  check("typed in today's note saves it", !!(await until(async () => (await text(todayPath)).includes("Sidebar scratch: ask Alice"), 6000)))
  check("the open note stays in its tab", decodeURIComponent(await page.evaluate(() => location.hash)).includes(note))

  // ---------- stepping days ----------
  await button("Day before")
  check("Day before: yesterday", (await shownDay()) === plus(today, -1) && (await heading()) === "Yesterday", [await shownDay(), await heading()])
  await button("Day before")
  check("Today shows once off today", !!(await page.$(`${P} [aria-label='Today']`)))
  await button("Today")
  check("Today: back to today, its button gone", (await shownDay()) === today && !(await page.$(`${P} [aria-label='Today']`)))
  await page.reload(); await page.waitForSelector(P)
  await button("Day before")
  await page.reload(); await page.waitForSelector(P)
  check("the day shown is kept over a reload", (await until(() => shownDay())) === plus(today, -1), await shownDay())
  await button("Today")

  // ---------- a missing day: shown, not made, started on asking ----------
  let missing = plus(today, 1), steps = 1
  while ((await dayOf(missing)).exists && steps < 10) { missing = plus(missing, 1); steps++ }
  for (let i = 0; i < steps; i++) await button("Day after")
  check("stepped to a day without a note", (await shownDay()) === missing, await shownDay())
  check("...it says so, with one action", !!(await until(() => page.$(`${P} [data-daily-start]`))) && /^No note for .* yet\. Start it$/.test(await page.textContent(`${P} [data-daily-start]`)), await page.textContent(`${P} [data-daily-start]`).catch(() => null))
  await wait(800)
  check("...and looking didn't make it", !(await dayOf(missing)).exists)
  await page.click(`${P} [data-daily-start]`)
  const made = await until(async () => (await dayOf(missing)).exists && (await page.$(`${P} .cm-focused`)), 6000)
  check("Start it: made where daily notes go, focused to write", !!made)
  const missingPath = (await dayOf(missing)).path
  await page.keyboard.type("Started from the sidebar")
  check("...and what's typed saves in it", !!(await until(async () => (await text(missingPath)).includes("Started from the sidebar"), 6000)))

  // ---------- the menu ----------
  await page.click(`${P} [data-panel-handle]`, { button: "right", position: { x: 12, y: 14 } })
  const items = await menuItems()
  check("its menu: the shown day's note in a tab, the panel in a tab", items.some((t) => /^Open .*'s note in a tab$/.test(t)) && items.includes("Open Daily note in a tab"), items)
  await page.getByRole("menuitem", { name: /'s note in a tab$/ }).click()
  check("...which opens that note's file", !!(await until(async () => decodeURIComponent(await page.evaluate(() => location.hash)).includes(missingPath))), await page.evaluate(() => location.hash))

  // ---------- the look, beside the open note ----------
  await page.goto(`${B}#file/${encodeURIComponent(note)}`); await page.waitForSelector(P); await wait(300)
  await button("Today"); await page.mouse.move(700, 400); await wait(800)
  await page.screenshot({ path: SHOT })
  console.log(`shot: ${SHOT}`)
} catch (e) {
  check("ran to the end", false, String(e))
  await page.screenshot({ path: SHOT.replace(/\.png$/, "-failed.png") })
}
await done()
