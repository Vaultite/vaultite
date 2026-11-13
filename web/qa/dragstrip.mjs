// The desktop app's drag strip, in Chrome with data-electron set: nothing clickable in its top 40px without no-drag.
// Turns Workspaces on (plugins.json put back): throwaway server.
//   node web/qa/dragstrip.mjs <base url>
// Paths: index.css
import { execFileSync } from "node:child_process"
import path from "node:path"
import { qa, wait } from "./lib/qa.mjs"
const { args: [B], browser, check, watch, done } = await qa(import.meta.url)

const pluginsBefore = await (await fetch(`${B}api/config/plugins`)).json()
execFileSync(process.execPath, [path.resolve(import.meta.dirname, "../../bin/vau"), "--url", B, "plugin", "on", "workspaces"], { encoding: "utf8" })
const putBack = () => fetch(`${B}api/config/plugins`, { method: "PUT", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ disabled: pluginsBefore.disabled ?? [], enabled: pluginsBefore.enabled ?? [] }) })

const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
const page = watch(await ctx.newPage())
await page.goto(B)
const SWITCHER = "aside [data-workspace-switcher]"
await page.waitForSelector(SWITCHER)
await page.evaluate(() => document.documentElement.setAttribute("data-electron", ""))
await wait(200)

const STRIP = 40
const swallowed = () => page.evaluate((STRIP) => {
  const reg = (e) => getComputedStyle(e).webkitAppRegion
  const drags = [...document.querySelectorAll("*")].filter((e) => reg(e) === "drag" && reg(e.parentElement) !== "drag").map((e) => e.getBoundingClientRect())
  const over = (r) => drags.some((d) => r.left < d.right && r.right > d.left && r.top < Math.min(d.bottom, STRIP) && r.bottom > d.top)
  return [...document.querySelectorAll("button, a[href], input, [role=menuitem], [role=menuitemcheckbox], [role=option], [role=separator], [data-workspace]")]
    .filter((e) => { const r = e.getBoundingClientRect(); return r.width && r.height && r.top < STRIP && reg(e) !== "no-drag" && over(r) })
    .map((e) => `${e.getAttribute("role") || e.tagName.toLowerCase()} "${(e.getAttribute("aria-label") || e.textContent || "").trim().slice(0, 30)}"`)
}, STRIP)
const esc = async () => { for (let i = 0; i < 3; i++) { await page.keyboard.press("Escape"); await wait(100) } }
const at = async (sel) => { const r = await page.locator(sel).first().boundingBox(); return { x: r.x + 5, y: r.y + 5 } }

check("the strip is there (sidebar header, tab bar)", (await page.evaluate(() => [...document.querySelectorAll("[data-titlebar], [data-top] > [data-tab-bar] > div:first-child")]
  .filter((e) => getComputedStyle(e).webkitAppRegion === "drag").length)) >= 2)
check("nothing open: all clickable", !(await swallowed()).length, await swallowed())
let p = await at(SWITCHER)
await page.mouse.click(p.x, p.y, { button: "right" }); await wait(250)
check("the switcher's menu (Rename in the strip): all clickable", !(await swallowed()).length, await swallowed()); await esc()
await page.mouse.click(p.x, p.y); await wait(250)
check("the workspace list: all clickable", !(await swallowed()).length, await swallowed()); await esc()
p = await at("[data-top] [role=tab]")
await page.mouse.click(p.x, p.y, { button: "right" }); await wait(250)
check("a tab's menu: all clickable", !(await swallowed()).length, await swallowed()); await esc()
await page.keyboard.press("ControlOrMeta+p"); await wait(300)
check("the palette (its backdrop): all clickable", !(await swallowed()).length, await swallowed()); await esc()
await page.keyboard.press("ControlOrMeta+\\"); await wait(400)
p = await at(SWITCHER)
await page.mouse.click(p.x, p.y); await wait(250)
check("rail: the workspace list and the sidebar's edge: all clickable", !(await swallowed()).length, await swallowed()); await esc()
await page.mouse.click(p.x, p.y, { button: "right" }); await wait(250)
check("rail: the switcher's menu: all clickable", !(await swallowed()).length, await swallowed()); await esc()
await page.keyboard.press("ControlOrMeta+\\"); await wait(400)
check("the strip still drags the window", (await page.evaluate(() => [...document.querySelectorAll("[data-titlebar], [data-top] > [data-tab-bar] > div:first-child")]
  .every((e) => getComputedStyle(e).webkitAppRegion === "drag"))))

await browser.close()
await putBack()
await done()
