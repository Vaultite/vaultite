// Appearance settings: its order (theme, colour scheme, density, file icons, fonts, text sizes, CSS snippets), Settings' three scheme
// tiles (Gruvbox, the default; the one in use or Classic; More…), the colour scheme gallery (the sheet of More… and of "Change
// colour scheme": one grid, every built-in scheme and the vault's Obsidian themes, a tile each), the Fonts row (folded at first, saying what's set; a click unfolds the three pickers), every colour
// scheme (built in, and the vault's Obsidian themes) in light and dark, and that no
// scheme or mode moves anything (the boxes of the page's key elements are measured on Settings, Today and a note, at
// desktop width and 390px, and must match Classic's (`default`, index.css's own tokens) in light), density, the font pickers (search, each font drawn in
// itself, Enter applies, a name typed that isn't listed, back to the default), CSS snippets (inside Appearance) turned on
// and edited on disk (live, no reload), and no font size setting. Screenshots at desktop width and 390px, light and dark.
// WRITES .vaultite/appearance.json, a snippet and the workspaces' data.json (put back): throwaway server only.
//   node web/qa/appearance.mjs <base url> <vault path> [out dir]
import fs from "node:fs"
import path from "node:path"
import { SHOTS, apiAt, qa } from "./lib/qa.mjs"
import { setAsideWorkspaces } from "./lib/wsfiles.mjs"
const { args: [B, VAULT, OUT = `${SHOTS}appearance/`], browser, check, watch, done } = await qa(import.meta.url)
fs.mkdirSync(OUT, { recursive: true })
const api = apiAt(B)
const saved = await api("GET", "config/appearance")
const set = (patch) => api("PUT", "config/appearance", { ...saved, theme: "system", scheme: "default", density: "compact", interfaceFont: "", textFont: "", monoFont: "", snippets: [], ...patch })
// Workspaces keep tabs that would take the page's address over: none during the run (put back at the end).
const putBackWs = setAsideWorkspaces(VAULT)
const files = (await api("GET", "files")).files
const note = files.find((f) => f.path.startsWith("Notes/") && f.path.endsWith(".md"))?.path ?? files.find((f) => f.path.endsWith(".md")).path
const today = files.find((f) => f.path === "Dashboards/Today.md")?.path ?? note
const themes = await api("GET", "themes")

async function open(w, dark, hash) {
  const mobile = w < 768
  const ctx = await browser.newContext({ viewport: { width: w, height: mobile ? 844 : 900 }, deviceScaleFactor: 2, isMobile: mobile, hasTouch: mobile, colorScheme: dark ? "dark" : "light" })
  const page = watch(await ctx.newPage())
  await page.goto(`${B}#${hash}`)
  await page.waitForTimeout(1500)
  return page
}
const shot = (page, name) => page.screenshot({ path: `${OUT}${name}.png` })
const token = (page, t) => page.evaluate((t) => getComputedStyle(document.documentElement).getPropertyValue(`--${t}`).trim(), t)
const fileHash = (p) => `file/${encodeURIComponent(p)}`

// Settings, desktop and phone, light and dark
await set({})
for (const [w, dark] of [[1440, false], [1440, true], [390, false], [390, true]]) {
  const page = await open(w, dark, "settings")
  await shot(page, `settings-${w}-${dark ? "dark" : "light"}`)
  if (w === 1440 && !dark) {
    check("no font size setting", !(await page.getByText("Font size", { exact: true }).count()) && !(await page.locator('input[type="range"]').count()))
    const appearance = page.locator("section", { has: page.getByRole("heading", { name: "Appearance" }) }).last()
    check("CSS snippets are inside Appearance", (await appearance.locator('section[aria-label="CSS snippets"]').count()) === 1)
    check("no CSS snippets panel of its own", !(await page.getByRole("heading", { name: "CSS snippets" }).count()))
    const text = await appearance.innerText()
    const at = ["Theme", "Colour scheme", "Density", "File icons", "Scroll sidebar panels separately", "Fonts", "Note text size", "CSS snippets"].map((t) => text.indexOf(t))
    check("in order: theme, colour scheme, density, file icons, fonts, CSS snippets", at.every((x, i) => x >= 0 && (!i || x > at[i - 1])), at)
    const radios = () => appearance.getByRole("radiogroup", { name: "Colour scheme" }).getByRole("radio").evaluateAll((els) => els.map((e) => `${e.getAttribute("aria-label")}${e.getAttribute("aria-checked") === "true" ? "*" : ""}`))
    check("three tiles: Gruvbox (the default), Classic (in use), More…", (await radios()).join() === "Gruvbox,Classic*" && (await appearance.getByRole("button", { name: "More colour schemes" }).count()) === 1, await radios())
    await appearance.getByRole("radio", { name: "Gruvbox", exact: true }).click(); await page.waitForTimeout(500)
    check("a tile picks its scheme", (await api("GET", "config/appearance")).scheme === "gruvbox")
    await appearance.getByRole("button", { name: "More colour schemes" }).click(); await page.waitForTimeout(600)
    check("More… opens the gallery", (await page.getByRole("dialog").getByRole("radio").count()) === 16 + themes.filter((t) => !t.problem).length)
    await page.getByRole("dialog").getByRole("radio", { name: "Nord", exact: true }).click(); await page.waitForTimeout(500)
    await page.keyboard.press("Escape"); await page.waitForTimeout(500)
    check("the second tile is the scheme in use", (await radios()).join() === "Gruvbox,Nord*", await radios())
    await set({}); await page.waitForTimeout(800)
    // Rows are even: every row of the list has the same room above and below what it draws (its label and its control).
    const pads = await appearance.evaluate((sec) => [...sec.querySelector(".hairline").children].map((r) => {
      const row = r
      const box = row.getBoundingClientRect(), kids = [...row.children].map((k) => k.getBoundingClientRect())
      return [Math.round(Math.min(...kids.map((k) => k.top)) - box.top), Math.round(box.bottom - Math.max(...kids.map((k) => k.bottom)))]
    }))
    check("every row has the same room above and below", pads.every(([a, b]) => a >= 7 && Math.abs(a - b) <= 1), pads)
    const fonts = page.locator("[data-fonts-open]")
    check("fonts: one row saying Default, no pickers on the page", (await fonts.innerText()).includes("Default") &&
      !(await page.getByRole("button", { name: /^Interface font:/ }).count()), await fonts.innerText())
    await page.evaluate(() => document.querySelector("#main-scroll")?.scrollTo(0, 99999)); await page.waitForTimeout(200)
    await shot(page, `settings-${w}-light-end`)
  }
  // The gallery as a sheet (More…, the command "Change colour scheme")
  await page.evaluate(() => { location.hash = "settings/schemes" }); await page.waitForTimeout(600)
  check(`the gallery's sheet at ${w}px: the same grid`, (await page.getByRole("dialog").getByRole("radio").count()) === 16 + themes.filter((t) => !t.problem).length)
  await shot(page, `gallery-${w}-${dark ? "dark" : "light"}`)
  await page.close()
}

// Every scheme on Today and a note, dark and light
const ids = ["default", "gruvbox", "catppuccin", "nord", "dracula", "solarized", "tokyo-night", "rose-pine", "everforest", "kanagawa", "one", "ayu", "github", "flexoki", "amethyst", "paper", ...themes.map((t) => `theme:${t.name}`)]
for (const scheme of ids) {
  await set({ scheme })
  for (const dark of [false, true]) {
    const page = await open(1440, dark, fileHash(today))
    const bg = await token(page, "background")
    check(`${scheme} ${dark ? "dark" : "light"}: html has it`, await page.evaluate((s) => (document.documentElement.dataset.scheme ?? "default") === s, scheme))
    check(`${scheme} ${dark ? "dark" : "light"}: background set`, !!bg, bg)
    if (scheme === "dracula") check("dracula stays dark", await page.evaluate(() => document.documentElement.classList.contains("dark")))
    await shot(page, `scheme-${scheme.replace(":", "-")}-${dark ? "dark" : "light"}`)
    await page.close()
  }
}

// No scheme or mode moves anything: a scheme only recolours. The boxes of the key elements (every control, heading,
// row, tab, section and bar) must be where Default puts them in light, on each page; the scheme and mode change live,
// so a switch that reflows (a line appearing, a border, a font) is caught as well as a scheme that loads differently.
const KEY = "aside, nav, main, section, header, h1, h2, h3, button, a, input, [role=switch], [role=radio], [role=tab], [role=treeitem], [role=tablist], [data-titlebar], #main-scroll, [data-panel-handle], label, kbd"
const boxes = (page) => page.evaluate((KEY) => [...document.querySelectorAll(KEY)].filter((el) => el.getClientRects().length).map((el) => {
  const b = el.getBoundingClientRect()
  const name = `${el.tagName.toLowerCase()}${el.getAttribute("role") ? `[${el.getAttribute("role")}]` : ""} "${(el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 30)}"`
  return [name, Math.round(b.x * 4) / 4, Math.round(b.y * 4) / 4, Math.round(b.width * 4) / 4, Math.round(b.height * 4) / 4]
}), KEY)
const settle = async (page, scheme) => {
  await page.waitForFunction((s) => (document.documentElement.dataset.scheme ?? "default") === s, scheme, { timeout: 8000 }).catch(() => {})
  await page.waitForTimeout(350) // past the tiles' transitions
}
for (const [w, hash] of [[1440, "settings"], [1440, fileHash(today)], [1440, fileHash(note)], [390, "settings"], [390, fileHash(today)]]) {
  await set({})
  const page = await open(w, false, hash)
  const base = await boxes(page)
  const moved = []
  for (const scheme of ids) {
    await set({ scheme })
    for (const dark of [false, true]) {
      await page.emulateMedia({ colorScheme: dark ? "dark" : "light" })
      await settle(page, scheme)
      const now = await boxes(page)
      if (now.length !== base.length) { moved.push(`${scheme} ${dark ? "dark" : "light"}: ${base.length} -> ${now.length} elements`); continue }
      // Settings' second tile changes scheme and name with the scheme in use: the same box.
      const d = now.map((b, i) => [base[i], b]).filter(([a, b]) => a.slice(1).join() !== b.slice(1).join())
      if (d.length) moved.push(`${scheme} ${dark ? "dark" : "light"}: ${d.length} moved, first ${JSON.stringify(d[0])}`)
    }
  }
  check(`no scheme or mode moves anything: ${decodeURIComponent(hash).split("/").pop()} at ${w}px (${base.length} elements, ${ids.length} schemes)`, !moved.length, moved)
  await page.close()
}

// Density
await set({ density: "comfortable", scheme: "nord" })
for (const [w, dark] of [[1440, false], [1440, true], [390, true]]) {
  const page = await open(w, dark, fileHash(today))
  check("comfortable: spacing scaled", (await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--spacing").trim())) .endsWith(".28125rem"))
  await shot(page, `comfortable-${w}-${dark ? "dark" : "light"}`)
  await page.close()
}
{
  await set({ density: "compact", scheme: "nord" })
  const page = await open(1440, false, fileHash(today))
  await shot(page, "compact-1440-light")
  await page.close()
}

// The font pickers: the button shows the font in itself; the palette lists this device's fonts, each drawn in its own
// font, the default first; typing filters; Enter applies at once; a name that isn't listed can be used; the default
// row puts it back. An old fontSize key is ignored.
await set({ fontSize: 22 })
{
  const page = await open(1440, false, "settings")
  const size = await page.evaluate(() => getComputedStyle(document.body).fontSize)
  await page.locator("[data-fonts-open]").click(); await page.waitForTimeout(500)
  check("fonts: a click opens a sheet of the three pickers", (await page.locator("dialog[open]").getByRole("button", { name: /^(Interface|Text|Monospace) font:/ }).count()) === 3)
  const button = page.getByRole("button", { name: /^Interface font:/ })
  await button.scrollIntoViewIfNeeded()
  check("interface font: a picker button showing the default", (await button.getAttribute("aria-label")) === "Interface font: System font", await button.getAttribute("aria-label"))
  await button.click(); await page.waitForTimeout(300)
  const dialog = page.getByRole("dialog", { name: "Interface font" })
  check("the picker opens (the palette)", await dialog.isVisible())
  const rows = dialog.getByRole("option")
  const first = await rows.first().textContent()
  check("the default first, marked", /System font.*Default/.test(first), first)
  check("fonts listed (this device's)", (await rows.count()) > 10, await rows.count())
  check("the current one is selected", (await rows.first().getAttribute("aria-selected")) === "true")
  await shot(page, "font-picker")
  await page.keyboard.type("georg"); await page.waitForTimeout(200)
  const hit = rows.first()
  check("typing filters (fuzzy)", /Georgia/.test(await hit.textContent()), await hit.textContent())
  const drawn = await hit.evaluate((el) => getComputedStyle(el.querySelector("[style]")).fontFamily)
  check("each font drawn in itself", drawn.startsWith("Georgia"), drawn)
  await shot(page, "font-picker-typed")
  await page.keyboard.press("Enter"); await page.waitForTimeout(600)
  check("Enter applies at once (appearance.json)", (await api("GET", "config/appearance")).interfaceFont === "Georgia")
  check("the interface is drawn in it", (await page.evaluate(() => getComputedStyle(document.body).fontFamily)).startsWith("Georgia"))
  check("the button shows it, in itself", (await button.getAttribute("aria-label")) === "Interface font: Georgia" &&
    (await button.evaluate((el) => getComputedStyle(el.querySelector("span")).fontFamily)).startsWith("Georgia"))
  // A name that isn't listed
  await page.getByRole("button", { name: /^Text font:/ }).click(); await page.waitForTimeout(300)
  await page.keyboard.type("Qa Unlisted Serif"); await page.waitForTimeout(200)
  const other = page.getByRole("dialog").getByRole("option").last()
  check("a name that isn't listed: offered", (await other.textContent()).includes('Use "Qa Unlisted Serif"'), await other.textContent())
  await page.keyboard.press("Enter"); await page.waitForTimeout(600)
  check("…and used", (await api("GET", "config/appearance")).textFont === "Qa Unlisted Serif")
  check("fonts: the row says which are set", (await page.locator("[data-fonts-open]").innerText()).includes("Georgia, Qa Unlisted Serif"), await page.locator("[data-fonts-open]").innerText())
  check("quoted in the stack", (await page.evaluate(() => document.documentElement.style.getPropertyValue("--font-text"))).startsWith('"Qa Unlisted Serif"'))
  // Monospace: monospace fonts first
  await page.getByRole("button", { name: /^Monospace font:/ }).click(); await page.waitForTimeout(300)
  const second = await page.getByRole("dialog").getByRole("option").nth(1).textContent()
  check("monospace: monospace fonts first", /Monospace/.test(second), second)
  await page.keyboard.press("Escape"); await page.waitForTimeout(200)
  check("Escape closes it, the fonts' sheet stays", !(await page.getByRole("dialog", { name: "Monospace font" }).count()) &&
    (await page.locator("dialog[open]").getByRole("button", { name: /^Interface font:/ }).count()) === 1)
  // Back to the default
  await button.click(); await page.waitForTimeout(300)
  await page.getByRole("dialog").getByRole("option").first().click(); await page.waitForTimeout(600)
  check("the default row resets it", (await api("GET", "config/appearance")).interfaceFont === "")
  check("an old fontSize key is ignored, and left in the file", size === (await page.evaluate(() => getComputedStyle(document.body).fontSize)) &&
    (await api("GET", "config/appearance")).fontSize === 22)
  await page.close()
}
{
  const page = await open(1440, false, fileHash(note))
  const size = await page.evaluate(() => getComputedStyle(document.querySelector(".vau-editor .cm-editor")).fontSize)
  check("the editor's text is 16px (no font size setting)", size === "16px", size)
  await page.close()
}
{
  const page = await open(390, false, "settings")
  await page.locator("[data-fonts-open]").click(); await page.waitForTimeout(500)
  await page.getByRole("button", { name: /^Interface font:/ }).click(); await page.waitForTimeout(400)
  check("phone: the picker opens", await page.getByRole("dialog", { name: "Interface font" }).isVisible())
  await shot(page, "font-picker-390")
  await page.close()
}

// Snippets: on, then edited on disk while the page is open
const snip = path.join(VAULT, ".vaultite/snippets/Qa snippet.css")
fs.mkdirSync(path.dirname(snip), { recursive: true })
fs.writeFileSync(snip, ":root { --primary: rgb(1, 2, 3); }\n")
await set({ snippets: ["Qa snippet"] })
{
  const page = await open(1440, false, "settings")
  check("snippet applied", (await token(page, "primary")) === "rgb(1, 2, 3)", await token(page, "primary"))
  fs.writeFileSync(snip, ":root { --primary: rgb(4, 5, 6); }\n")
  await page.waitForTimeout(1500)
  check("snippet edited on disk: live", (await token(page, "primary")) === "rgb(4, 5, 6)", await token(page, "primary"))
  await page.getByRole("switch", { name: "Qa snippet snippet" }).click(); await page.waitForTimeout(800)
  check("snippet off from Settings", (await token(page, "primary")) !== "rgb(4, 5, 6)", await token(page, "primary"))
  check("appearance.json has it off", !(await api("GET", "config/appearance")).snippets.includes("Qa snippet"))
  await page.close()
}
fs.rmSync(snip)

await api("PUT", "config/appearance", saved)
const left = Object.keys(await api("GET", "config/appearance")).filter((k) => !(k in saved))
if (left.length) await api("PATCH", "config/appearance", Object.fromEntries(left.map((k) => [k, null])))
putBackWs()
await done()
