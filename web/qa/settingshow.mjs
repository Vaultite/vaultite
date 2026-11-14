// settings.show opens Settings at a setting, companion.see reads it and its sheets, AI shows the companion's model. Throwaway server only.
//   node web/qa/settingshow.mjs <base url> [out dir] (core/settingsfind.ts, components/AiSettings.tsx, plugins/core/companion/panes.ts)
import { mkdirSync } from "node:fs"
import { SHOTS, apiAt, qa, until } from "./lib/qa.mjs"

const { args: [B, OUT = SHOTS], browser, check, watch, done } = await qa(import.meta.url)
mkdirSync(OUT, { recursive: true })
const api = apiAt(B)
const op = (id, params) => api("POST", `ops/${id}`, params)
const was = await api("GET", "config/plugin/companion")
await op("settings.set", { name: "plugins", values: { ai: null } })

async function open(w, h, mobile = false) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: mobile, hasTouch: mobile })
  const page = watch(await ctx.newPage(), { label: `${w}` })
  await page.goto(B)
  await page.waitForSelector("main", { timeout: 30000 })
  await until(async () => ((await api("GET", "ui"))?.windows ?? 0) > 0, 10000)
  return { ctx, page }
}
const flashed = (page, sel) => until(() => page.locator(`${sel}.reveal-flash`).count(), 5000)

try {
  const { ctx, page } = await open(1280, 800)
  const r = await op("settings.show", { setting: "summoned_model" })
  check("settings.show summoned_model: found, in AI", r.found && r.where === "AI", r)
  check("...the AI section, its row flashed beside the Companion row", !!(await flashed(page, '[data-ai-agents] [data-ai-model]')))
  check("...under the Companion row and its agent", !!(await page.locator("[data-ai-companion]").count()))
  check("...with All companion settings after it", !!(await page.locator("[data-ai-companion-settings]").count()))
  await page.screenshot({ path: `${OUT}settingshow-ai.png` })

  const seen = await op("companion.see", {})
  check("companion.see reads Settings: its words", /Talk key model/.test(seen.text ?? "") && /Coding agents/.test(seen.text ?? ""), seen.text?.slice(0, 300))
  check("...and its controls' states", /switch "Use AI": on/.test(seen.text ?? ""), seen.text?.slice(-400))

  for (const [said, where] of [["dark mode", "Appearance"], ["Model for summoned asks", "AI"], ["companion.voice", "Companion"], ["density", "Appearance"]]) {
    const s = await op("settings.show", { setting: said })
    check(`settings.show "${said}": ${where}`, s.found && s.where === where, s)
  }
  const none = await op("settings.show", { setting: "no-such-setting-here" })
  check("a name nothing matches: an error", !!none.error, none)

  await op("settings.show", { setting: "summoned_model" })
  await flashed(page, '[data-ai-agents] [data-ai-model]')
  const a = await op("companion.act", { action: "click", find: "Talk key model" })
  check("act opens the row's menu: its models and effort", a.ok && (await page.locator("[role=menu] [role=menuitemradio]", { hasText: "Haiku" }).count()) === 1 &&
    (await page.locator("[role=menu] [role=radiogroup]").count()) === 1, a)
  const b = await op("companion.act", { action: "click", find: "Haiku" })
  check("act picks Haiku: the row says it", b.ok && /Haiku/.test(await page.locator("[data-ai-model]").innerText()), b)
  check("...and it's saved", await until(async () => (await api("GET", "config/plugin/companion"))?.summoned_model === "haiku", 4000))
  await ctx.close()

  const phone = await open(390, 844, true)
  const p = await op("settings.show", { setting: "companion.voice" })
  check("phone: settings.show opens the Companion sheet at Voice", p.found && !!(await flashed(phone.page, '[data-plugin-settings-sheet="companion"] [data-setting="voice"]')), p)
  let sheet = null
  check("...companion.see reads the sheet over the window", !!(await until(async () => { sheet = await op("companion.see", {}); return sheet.kind === "sheet" && /Talk keys/.test(sheet.text ?? "") }, 5000)), sheet)
  await phone.page.screenshot({ path: `${OUT}settingshow-phone.png` })
  await phone.ctx.close()
} finally {
  await op("settings.set", { name: "plugin/companion", values: { summoned_model: was?.summoned_model ?? null } })
}
await done()
