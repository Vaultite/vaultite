// The Plugins page's groups (pages/Plugins.tsx): Built-in has only the app's essential plugins (Vim among them, off
// until turned on), Vaultite plugins the rest of the app's own, with its line saying they're off until turned on; a
// Vaultite plugin's sheet says so. Screenshots, light and dark. Reads only.
//   node web/qa/plugingroups.mjs <base url> [out dir]
import { mkdirSync } from "node:fs"
import { qa, until, wait } from "./lib/qa.mjs"

const { args: [B, OUT = "/tmp/plugingroups-shots/"], browser, check, watch, done } = await qa(import.meta.url)
mkdirSync(OUT, { recursive: true })
const rows = (page, group) => page.locator(`[data-plugin-group="${group}"] [data-plugin-row]`).evaluateAll((els) => els.map((e) => e.dataset.pluginRow))

for (const colorScheme of ["light", "dark"]) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme })
  const page = watch(await ctx.newPage(), { label: colorScheme })
  await page.goto(`${B}#plugins`)
  await until(() => page.locator('[data-plugin-group="vaultite"]').count(), 10000)
  await wait(800)
  await page.screenshot({ path: `${OUT}plugins-${colorScheme}.png` })
  await page.locator('[data-plugin-group="vaultite"] h2').evaluate((e) => e.scrollIntoView({ block: "center" }))
  await wait(300)
  await page.screenshot({ path: `${OUT}plugins-vaultite-${colorScheme}.png` })
  if (colorScheme === "light") {
    const core = await rows(page, "core"), ours = await rows(page, "vaultite")
    check("Built-in: the essential ones, Vim too", ["files", "search", "terminal", "claude-code", "codex", "clipper", "other-apps", "vim"].every((id) => core.includes(id)), core)
    check("Built-in: none of the Vaultite plugins", !["today", "people", "logs", "projects", "documents", "machines"].some((id) => core.includes(id)), core)
    check("Vaultite plugins: the app's others", ["today", "people", "logs", "projects", "books", "documents", "machines", "web-viewer"].every((id) => ours.includes(id)), ours)
    check("Vaultite plugins: its line says they're off until turned on",
      (await page.locator('[data-plugin-group="vaultite"] p').first().innerText()).includes("off until you turn them on"))
    await page.locator('[data-plugin-row="today"]').click()
    await until(() => page.locator("dialog[open]").count(), 4000)
    check("a Vaultite plugin's sheet says what it is", (await page.locator("dialog[open]").innerText()).includes("Vaultite plugin"))
    await page.keyboard.press("Escape"); await wait(500)
  }
  await ctx.close()
}
await done()
