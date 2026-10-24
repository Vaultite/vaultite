// Workspaces as spaces (plugins/core/workspaces): a workspace's menu sets its icon (the picker leading with common ones;
// shown for its number, in its tint),
// its colour (the sidebars take a little of it, light and dark, and lose it again) and its Browser container (the
// Browser's own, listed); its settings show all three; a two-finger swipe over the sidebar goes to the next and back,
// an up-and-down one doesn't, and the tabs there show at once; the list lights only the focused row, a check on the current one, a long name whole on hover; the phone's tab list
// shows the icon, and its menu each workspace's mark. WRITES plugins.json and the workspaces' files (put
// back): throwaway only.   node web/qa/spaces.mjs <base url> <vault path>
import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import path from "node:path"
import { qa, until, wait } from "./lib/qa.mjs"
import { setAsideWorkspaces, workspaces, wsDir } from "./lib/wsfiles.mjs"
const { args: [B, VAULT], browser, check, watch, done } = await qa(import.meta.url)

const PLUGINS = path.join(VAULT, ".vaultite/plugins.json")
const pluginsBefore = readFileSync(PLUGINS, "utf8")
const putBack = setAsideWorkspaces(VAULT)
writeFileSync(PLUGINS, JSON.stringify({ ...JSON.parse(pluginsBefore), enabled: [...(JSON.parse(pluginsBefore).enabled ?? []), "workspaces"] }, null, 2) + "\n")
mkdirSync(wsDir(VAULT), { recursive: true })
writeFileSync(path.join(wsDir(VAULT), "1.json"), JSON.stringify({ name: "Writing" }) + "\n")
writeFileSync(path.join(wsDir(VAULT), "2.json"), JSON.stringify({ name: "Reading" }) + "\n")
const LONG = "Research for the quarterly planning offsite in Lisbon"
writeFileSync(path.join(wsDir(VAULT), "3.json"), JSON.stringify({ name: LONG }) + "\n")

const SWITCHER = "aside [data-workspace-switcher]"
/** A CSS colour as the screen draws it (sRGB 0-255), in the page. */
const drawn = (page, css) => page.evaluate((c) => { const x = document.createElement("canvas").getContext("2d"); x.fillStyle = c; x.fillRect(0, 0, 1, 1); return [...x.getImageData(0, 0, 1, 1).data].slice(0, 3) }, css)
const far = (a, b) => Math.max(...a.map((x, i) => Math.abs(x - b[i])))

try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: "light" })
  const page = watch(await ctx.newPage(), { console: true, ignore: /favicon|Failed to load resource|WebSocket/ })
  await page.goto(B)
  await page.waitForSelector(SWITCHER, { timeout: 30000 })
  const lit = () => page.$eval(SWITCHER, (e) => e.getAttribute("data-workspace-switcher"))
  const bg = async () => drawn(page, await page.$eval("aside[data-side=left]", (e) => getComputedStyle(e).backgroundColor))
  const pick = async (...names) => {
    await page.click(SWITCHER, { button: "right" })
    for (const [i, name] of names.entries()) {
      const row = page.locator("[role=menu] [role^=menuitem]", { hasText: new RegExp(`^${name}`) }).last()
      if (i < names.length - 1) { await row.hover(); await wait(300) } else await row.click()
    }
    await wait(500)
  }
  const plain = await bg()

  // The icon: from the picker, shown for its number.
  await pick("Change icon")
  await page.waitForSelector("[role=dialog] input", { timeout: 5000 })
  const offered = await until(async () => { const t = await page.$$eval("[role=dialog] [role=option]", (els) => els.map((e) => e.textContent.trim())); return t.length > 40 && t }, 5000)
  check("Change icon: the app's common icons first, not the alphabet's start", offered?.[0] === "activity" && offered.slice(0, 40).includes("dumbbell") && !offered.slice(0, 40).includes("a-arrow-down"), offered?.slice(0, 6))
  await page.keyboard.type("book-open"); await wait(500); await page.keyboard.press("Enter")
  await until(() => workspaces(VAULT)[0]?.icon, 5000)
  check("Change icon: kept in its file", workspaces(VAULT)[0]?.icon === "book-open", workspaces(VAULT)[0])
  check("… and shown for its number", await until(() => page.$(`${SWITCHER} [data-workspace-icon=book-open]`), 3000))

  // The list: like a menu, the highlight follows the keyboard and a check marks the one that's on.
  await page.click(SWITCHER); await page.keyboard.press("ArrowDown"); await wait(200)
  const listed = await page.$$eval("[data-workspace-list] [data-workspace]", (els) => els.map((e) => ({ on: e.getAttribute("aria-pressed") === "true", check: !!e.querySelector("svg.lucide-check"), bg: getComputedStyle(e).backgroundColor, focus: e === document.activeElement })))
  check("the list: only the focused row is lit, a check on the current one", listed[0]?.on && listed[0].check && !listed[1].check && listed[1].focus && listed[0].bg !== listed[1].bg && /, 0\)$|transparent/.test(listed[0].bg), listed)
  await page.hover("[data-workspace-list] [data-workspace='3']"); await wait(900)
  check("… a name cut off shows whole on hover", await page.evaluate(() => document.querySelector(".tooltip")?.textContent) === LONG)
  await page.keyboard.press("Escape"); await wait(200)

  // The colour: the sidebars take a little of it, light and dark, and lose it with No colour.
  await pick("Colour", "Teal")
  await until(() => workspaces(VAULT)[0]?.tint === "teal", 5000)
  const teal = await bg()
  check("Colour: kept, and the sidebar takes a little of it (light)", workspaces(VAULT)[0]?.tint === "teal" && far(teal, plain) >= 3 && far(teal, plain) <= 40, { plain, teal })
  const icon = await page.$eval(`${SWITCHER} [data-workspace-icon] svg`, (e) => getComputedStyle(e).color)
  const tealIs = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--teal").trim())
  check("… the icon in it", far(await drawn(page, icon), await drawn(page, tealIs)) <= 2, [icon, tealIs])
  await page.emulateMedia({ colorScheme: "dark" }); await wait(400)
  const dark = await bg()
  const darkPlain = await drawn(page, await page.evaluate(() => { const r = document.documentElement, v = r.style.getPropertyValue("--space-tint"); r.style.removeProperty("--space-tint"); const c = getComputedStyle(document.querySelector("aside[data-side=left]")).backgroundColor; r.style.setProperty("--space-tint", v); return c }))
  check("… quiet in dark too: tinted, still dark", far(dark, darkPlain) >= 3 && far(dark, darkPlain) <= 30 && Math.max(...dark) < 70, { dark, darkPlain })
  await page.emulateMedia({ colorScheme: "light" }); await wait(300)

  // The container: the Browser's, listed; the menu's row says which.
  await page.click(SWITCHER, { button: "right" })
  await page.locator("[role=menu] [role^=menuitem]", { hasText: /^Container/ }).hover(); await wait(300)
  const boxes = await page.locator("[role=menu]").last().locator("[role^=menuitem]").allInnerTexts()
  check("Container: the Browser's containers to pick from", ["No container", "Personal", "Work"].every((b) => boxes.some((x) => x.startsWith(b))), boxes)
  await page.locator("[role=menu]").last().locator("[role^=menuitem]", { hasText: /^Work/ }).click()
  await until(() => workspaces(VAULT)[0]?.container === "work", 5000)
  check("… kept in its file", workspaces(VAULT)[0]?.container === "work", workspaces(VAULT)[0])
  await page.click(SWITCHER, { button: "right" })
  check("… and named in the menu", (await page.locator("[role=menu] [role^=menuitem]", { hasText: /^Container/ }).innerText()).includes("Work"))
  await page.keyboard.press("Escape")

  // Its settings: the three, as they are.
  await pick("Settings")
  await page.waitForSelector("[data-workspace-settings]", { timeout: 8000 })
  const rows = await page.$$eval("[data-workspace-settings] [data-setting]", (els) => els.map((e) => e.getAttribute("data-setting")))
  check("Settings: icon, colour and container rows", ["icon", "tint", "container"].every((r) => rows.includes(r)) && (await page.innerText("[data-workspace-container]")) === "Work"
    && (await page.innerText("[data-workspace-tint]")).includes("Teal"), rows)
  await page.keyboard.press("Escape"); await until(async () => !(await page.$("[data-workspace-settings]")), 3000); await wait(300)

  // A two-finger swipe over the sidebar: to the next workspace and back; up and down scrolls, never switches.
  // (one event a swipe's worth: on a busy machine, a swipe's many small ones arrive too far apart to add up)
  await page.mouse.move(120, 420)
  await page.mouse.wheel(100, 4)
  check("a swipe sideways over the sidebar goes to the next workspace", await until(async () => (await lit()) === "2", 3000), await lit())
  // (a whole workspace put in place just shows: only tabs the user opens grow in)
  const tabW = () => page.$$eval("section[aria-label=Pane] [role=tab]", (els) => els.map((e) => Math.round(e.getBoundingClientRect().width)))
  const first = await tabW(); await wait(400)
  check("… its tabs show at once, none growing in", JSON.stringify(first) === JSON.stringify(await tabW()), [first, await tabW()])
  check("… where the sidebars lose the colour (it has none)", far(await bg(), plain) <= 1, [await bg(), plain])
  await wait(500)
  await page.mouse.wheel(-100, 4)
  check("… and back", await until(async () => (await lit()) === "1", 3000), await lit())
  await wait(500)
  await page.mouse.wheel(20, 200)
  await wait(400)
  check("an up-and-down swipe doesn't switch", (await lit()) === "1", await lit())
  await ctx.close()

  // The phone: the tab list's title shows the icon.
  const pctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true })
  const P = watch(await pctx.newPage(), { console: true, ignore: /favicon|Failed to load resource|WebSocket/ })
  await P.goto(B)
  await P.waitForSelector("[data-tabs-button]", { timeout: 30000 })
  await P.click("[data-tabs-button]")
  check("phone: the tab list's title shows the workspace's icon", await until(() => P.$("[data-tabs-workspace] [data-tabs-workspace-icon]"), 5000))
  await P.click("[data-tabs-workspace]")
  const marks = await until(() => P.$$eval("[role=menu] [role=menuitemradio]", (els) => els.map((e) => e.querySelector("[data-workspace-icon]")?.getAttribute("data-workspace-icon") ?? e.textContent.trim())), 3000)
  check("… its menu shows each workspace's mark, as the computer's list does", marks?.[0] === "book-open" && marks?.[1] === "2Reading", marks)
  await pctx.close()
} finally {
  writeFileSync(PLUGINS, pluginsBefore)
  putBack()
}
await done()
