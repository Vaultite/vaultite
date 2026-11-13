// The left sidebar's mode: Show activity in the sidebar fills it with the feed (live, a row opens its file), its X or
// the command again brings the panels back, and each workspace keeps its own. Turns Activity on and writes files and
// workspaces: throwaway only.
//   node web/qa/sidebarmode.mjs <base url> <vault path> [out dir]
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import { apiAt, command, qa, until, wait, workspaceKey } from "./lib/qa.mjs"
const { args: [B, VAULT, OUT = "/tmp/sidebarmode-shots/"], browser, check, watch, done } = await qa(import.meta.url, { motion: true })
mkdirSync(OUT, { recursive: true })
const api = apiAt(B)

const pluginsFile = path.join(VAULT, ".vaultite/plugins.json")
const pluginsBefore = existsSync(pluginsFile) ? readFileSync(pluginsFile, "utf8") : null
const o = JSON.parse(pluginsBefore ?? "{}")
writeFileSync(pluginsFile, JSON.stringify({ ...o, disabled: (o.disabled ?? []).filter((x) => x !== "activity" && x !== "workspaces"), enabled: [...new Set([...(o.enabled ?? []), "activity", "workspaces"])] }, null, 2) + "\n")
await wait(800)
// Something done, so the feed has rows: a note written through the API.
const NOTE = "Notes/Sidebar mode check.md", NOTE2 = "Notes/Sidebar mode live.md"
await api("PUT", "file", { path: NOTE, text: "# Sidebar mode check\n\nA line.\n" })

const mode = (page) => page.$eval("aside[data-side=left]", (a) => a.querySelector("[data-sidebar-mode]")?.getAttribute("data-sidebar-mode") ?? null)
const shoot = async (dark) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2, colorScheme: dark ? "dark" : "light" })
  const p = watch(await ctx.newPage())
  await p.goto(B)
  await p.waitForSelector("aside [data-sidebar-mode] [data-event]", { timeout: 15000 })
  await wait(600)
  await p.screenshot({ path: `${OUT}mode-${dark ? "dark" : "light"}.png` })
  await p.screenshot({ path: `${OUT}mode-${dark ? "dark" : "light"}-sidebar.png`, clip: { x: 0, y: 0, width: 320, height: 800 } })
  await ctx.close()
}

const page = watch(await browser.newPage({ viewport: { width: 1280, height: 800 } }))
try {
  await page.goto(B)
  await page.waitForSelector("aside[data-side=left]")
  // Workspace 1, the panels to start.
  await page.keyboard.press(workspaceKey(1)); await wait(600)
  if (await mode(page)) await command(page, "Show panels in the sidebar")
  check("starts with the panels", !(await mode(page)) && (await page.$$("aside[data-side=left] [data-panel]")).length > 0)

  check("the palette offers Show activity in the sidebar", await command(page, "Show activity in the sidebar", 600))
  check("the left sidebar is Activity alone", (await until(() => mode(page))) === "activity:feed")
  check("...in place of the panels", !(await page.$("aside[data-side=left] [data-panel]")))
  const fading = (page) => page.$eval("aside[data-side=left] [data-sidebar-body]", (b) => b.hasAttribute("data-mode-fade") && getComputedStyle(b).animationName === "mode-fade")
  check("...fading in as it comes", await fading(page))
  const row = await until(() => page.$(`aside [data-sidebar-mode] [data-event]`), 8000)
  check("its rows are there", !!row)
  check("...under their day", !!(await page.$("aside [data-sidebar-mode] [data-day] h3")))
  check("...at the sidebar's row height", Math.round((await row.boundingBox()).height) === 28, (await row.boundingBox()).height)
  // It fills the sidebar: its list scrolls in a box down to the vault's bar.
  const fill = await page.$eval("aside [data-sidebar-mode]", (m) => ({ mode: m.getBoundingClientRect().bottom, nav: document.querySelector("aside nav[aria-label=App]").getBoundingClientRect().top }))
  check("it fills the sidebar's height", Math.abs(fill.mode - fill.nav) <= 1, fill)
  // Live: a new change comes in on its own (among the app's own: its workspace saves, a row bumped to the top as they repeat).
  await api("PUT", "file", { path: NOTE2, text: "# Live\n" })
  check("live: a new event shows up", !!(await until(() => page.$$eval("aside [data-sidebar-mode] [data-event]", (els) => els.some((e) => e.textContent.includes("Sidebar mode live"))), 9000)))
  // A row opens its file.
  await page.click("aside [data-sidebar-mode] [data-event]:has-text('Sidebar mode live')")
  check("a row opens its file", !!(await until(() => page.evaluate(() => location.hash.includes("Sidebar%20mode%20live") || location.hash.includes("Sidebar mode live")))), await page.evaluate(() => location.hash))
  check("...and the mode stays", (await mode(page)) === "activity:feed")
  // Kept in the workspace: the next one has its panels, this one its mode again.
  await page.keyboard.press(workspaceKey(2)); await wait(900)
  check("workspace 2 has its panels", !(await mode(page)) && (await page.$$("aside[data-side=left] [data-panel]")).length > 0)
  check("...at once: a workspace's own mode doesn't fade", !(await fading(page)))
  await page.keyboard.press(workspaceKey(1)); await wait(900)
  check("back in workspace 1: Activity again", (await until(() => mode(page))) === "activity:feed")
  await page.reload(); await page.waitForSelector("aside[data-side=left]")
  check("...and after a reload", (await until(() => mode(page), 8000)) === "activity:feed")
  check("...drawn at once as the app opens", !(await fading(page)))

  await shoot(false)
  await shoot(true)

  // Folded to the rail it's the panels' icons; open again, the mode.
  await command(page, "Hide left sidebar", 600)
  check("folded: the rail, not the mode", !(await mode(page)))
  // (the panels aren't kept drawn behind it: unfolded, it's the mode that shows)
  check("...with no panels drawn hidden behind it", !(await page.$("aside[data-side=left] [data-sidebar-kept]")))
  await command(page, "Show left sidebar", 600)
  check("open again: the mode", (await until(() => mode(page))) === "activity:feed")

  // The heading's X brings the panels back.
  await page.click("aside [data-sidebar-mode] [data-leave-mode]")
  check("its X shows the panels", !!(await until(async () => !(await mode(page)) && (await page.$$("aside[data-side=left] [data-panel]")).length > 0)))
  check("...fading in too", await fading(page))
  // The command, run again, too (it says what it does now).
  await command(page, "Show activity in the sidebar", 600)
  check("the command again: Activity", (await until(() => mode(page))) === "activity:feed")
  check("...the palette now offers Show panels in the sidebar", await command(page, "Show panels in the sidebar", 600))
  check("...which shows them", !!(await until(async () => !(await mode(page)))))
} finally {
  writeFileSync(pluginsFile, pluginsBefore ?? "{}\n")
  for (const f of [NOTE, NOTE2]) await fetch(`${B}api/file?path=${encodeURIComponent(f)}`, { method: "DELETE" }).catch(() => {})
}
await done()
