// The welcome card (components/Welcome.tsx, core/welcome.ts): a new vault shows it over the app; its look page applies a
// layout and the theme behind it, no toasts; AI branches on the agents found (answered here by a stand-in for ai.agents):
// found, Use them turns their plugins on and Not now turns AI off (Standard not marked changed for it); a layout looked at
// and left leaves no file (core/bundles.ts); none, Continue says it works without; Done teaches the
// quick switcher's key by pressing it; Skip and Esc close it as it is (no agents: AI off); the app's keys wait while it's
// up; Show welcome in the palette brings it back for a vault set up long ago; a phone skips it, on Standard. Shots: light,
// dark, AI found and none. WRITES settings: throwaway server only.
//   node web/qa/welcome.mjs <base url> <vault path> [out dir]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { SHOTS, apiAt, palette, qa, until, wait } from "./lib/qa.mjs"

const { args: [B, VAULT, OUT = SHOTS], browser, check, watch, done } = await qa(import.meta.url)
mkdirSync(OUT, { recursive: true })
const api = apiAt(B)
const OFFER = path.join(VAULT, ".vaultite/bundles/onboarding.json")
const json = (rel) => { try { return JSON.parse(readFileSync(path.join(VAULT, ".vaultite", rel), "utf8")) } catch { return {} } }
const plugins = () => json("plugins.json")
const offer = () => { mkdirSync(path.dirname(OFFER), { recursive: true }); writeFileSync(OFFER, "{}\n") }
const FOUND = [{ id: "claude-code", name: "Claude Code", path: "/home/alice/.local/bin/claude", site: "https://claude.com/claude-code", plugin: true, on: true },
  { id: "codex", name: "Codex", path: "/home/alice/.npm-global/bin/codex", site: "https://developers.openai.com/codex/cli", plugin: true, on: false },
  { id: "opencode", name: "OpenCode", path: null, site: "https://opencode.ai", plugin: false, on: false }]
const NONE = FOUND.map((a) => ({ ...a, path: null }))
const card = (page) => page.locator("[data-welcome]")
const gone = (page) => until(async () => !(await card(page).count()), 4000)

/** A window on the vault, the agents it's told are found `agents`. */
async function open({ w = 1280, h = 800, scheme = "light", agents = FOUND, mobile = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: scheme, ...(mobile ? { isMobile: true, hasTouch: true } : {}) })
  const page = watch(await ctx.newPage(), { label: `${w} ${scheme}` })
  await page.route("**/api/ops/ai.agents", (r) => r.fulfill({ json: agents }))
  await page.goto(B)
  await page.waitForSelector("main", { timeout: 30000 })
  return { ctx, page }
}

await api("POST", "ops/settings.set", { name: "plugins", values: { ai: null } })

// ---------- a new vault: the look, AI found, Not now, done by its key ----------
offer()
let { ctx, page } = await open()
check("a new vault opens on the welcome card", !!(await until(() => card(page).count(), 8000)) && await page.locator("[data-welcome=new-vault]").count() === 1)
await until(() => page.locator("[data-welcome] [data-layout-pick]").count() === 3, 8000)
check("its look page: the three layouts, no menus, light/dark/system, three dots", !(await page.locator("[data-welcome] [data-layout-more]").count())
  && await page.locator("[data-welcome-theme]").count() === 3 && (await page.getAttribute("[data-dots]", "data-dots")) === "1/3")
check("no Back on the first page", !(await page.locator("[data-welcome-back]").count()))
check("the app behind takes no clicks", await page.evaluate(() => document.getElementById("root").hasAttribute("inert")))
await wait(500)
await page.screenshot({ path: `${OUT}welcome-look-light.png` })
await page.locator('[data-welcome] [data-layout-pick="zen"]').click()
await until(() => json("appearance.json")?.rails === false, 8000)
await wait(400)
check("a tile applies its layout behind the card, quietly: no toast, no guide, the offer ended", json("appearance.json")?.rails === false && !existsSync(OFFER)
  && !(await page.locator("[data-sonner-toast]", { hasText: "Zen" }).count()) && await card(page).count() === 1)
const ZEN_GUIDE = path.join(VAULT, "Guides/How Zen works.md"), guided = existsSync(ZEN_GUIDE)
await page.locator('[data-welcome] [data-layout-pick="standard"]').click()
await until(() => json("appearance.json")?.rails !== false && !existsSync(ZEN_GUIDE), 8000)
check("Standard again: Zen looked at and left leaves nothing (its guide taken back)", guided && json("appearance.json")?.rails !== false && !existsSync(ZEN_GUIDE))
await page.locator('[data-welcome-theme="dark"]').click()
check("Dark applies at once", await until(() => page.evaluate(() => document.documentElement.classList.contains("dark")), 3000))
await page.screenshot({ path: `${OUT}welcome-look-dark.png` })
await page.locator('[data-welcome-theme="light"]').click()
await page.keyboard.press("ControlOrMeta+p")
await wait(400)
check("the app's keys wait while it's up (⌘P opens no palette)", await page.locator("[role=dialog] input").count() === 0)
await page.locator("[data-welcome-body=look]").click({ position: { x: 4, y: 4 } })
await page.keyboard.press("ArrowRight")
await until(() => page.locator("[data-welcome-ai=found]").count(), 4000)
check("→ goes on to AI: the agents found, by name, two answers", (await page.locator("#welcome-title").innerText()) === "Claude Code and Codex are on this Mac".replace("Mac", process.platform === "darwin" ? "Mac" : "computer")
  && await page.locator("[data-welcome-use]").count() === 1 && await page.locator("[data-welcome-not-now]").count() === 1, await page.locator("#welcome-title").innerText())
check("...no paths, no install lines", !(await page.locator("[data-welcome]").innerText()).includes("/"))
await page.screenshot({ path: `${OUT}welcome-ai-found-light.png` })
await page.keyboard.press("ArrowLeft")
check("← goes back", !!(await until(() => page.locator("[data-welcome-body=look]").count(), 3000)))
await page.locator("[data-welcome-next]").click()
await page.locator("[data-welcome-not-now]").click()
await until(() => page.locator("[data-welcome-body=done]").count(), 4000)
check("Not now: AI off for real", await until(() => plugins().ai === false, 4000), plugins())
const layouts = (await api("GET", "bundles")).bundles.filter((b) => b.inUse)
check("...and Standard, the layout in use, isn't marked changed by it", JSON.stringify(layouts.map((b) => `${b.id}${b.modified ? " modified" : ""}`)) === '["standard"]', layouts)
check("then done: the quick switcher's key to press", (await page.locator("[data-welcome-done]").innerText()).includes("to find any note"))
await page.keyboard.press("ControlOrMeta+o")
check("pressing it: it lights up", !!(await until(() => page.locator("[data-welcome-done=pressed]").count(), 2000)))
await page.screenshot({ path: `${OUT}welcome-done-pressed.png` })
await gone(page)
check("...then the card goes and the switcher opens", !(await card(page).count()) && !!(await until(() => page.locator("[role=dialog] input").count(), 3000)))
check("...and the app takes clicks again", !(await page.evaluate(() => document.getElementById("root").hasAttribute("inert"))))
await page.keyboard.press("Escape")
await ctx.close()

// ---------- Show welcome, for a vault set up long ago: Use them; then none found ----------
;({ ctx, page } = await open({ scheme: "dark" }))
await wait(1500)
check("a vault set up before shows no card", !(await card(page).count()))
await palette(page, "Show welcome")
check("Show welcome in the palette brings it back", !!(await until(() => page.locator("[data-welcome=again]").count(), 3000)))
await page.locator("[data-welcome-next]").click()
await page.locator("[data-welcome-use]").click()
await until(() => page.locator("[data-welcome-body=done]").count(), 6000)
const pj = plugins()
check("Use them: AI on, Codex's plugin switched on, Claude Code the one you talk to", pj.ai !== false && (pj.enabled ?? []).includes("codex")
  && !json("plugins/companion/data.json").agent, pj)
await page.locator("[data-welcome-back]").click()
await until(() => page.locator("[data-welcome-ai=found]").count(), 3000)
await page.screenshot({ path: `${OUT}welcome-ai-found-dark.png` })
await page.keyboard.press("Escape")
await gone(page)
check("Esc closes it, as it was", !(await card(page).count()) && plugins().ai !== false)
await ctx.close()

;({ ctx, page } = await open({ agents: NONE }))
await palette(page, "Show welcome")
await page.locator("[data-welcome-next]").click()
await until(() => page.locator("[data-welcome-ai=none]").count(), 4000)
check("none found: it works fully without AI, one answer", (await page.locator("#welcome-title").innerText()) === "Vaultite works fully without AI"
  && (await page.locator("[data-welcome]").innerText()).includes("connect the Claude or ChatGPT app") && !(await page.locator("[data-welcome-use]").count()))
await wait(500)
await page.screenshot({ path: `${OUT}welcome-ai-none-light.png` })
await page.locator("[data-welcome-next]").click()
await until(() => page.locator("[data-welcome-body=done]").count(), 4000)
await page.keyboard.press("Escape")
await gone(page)
check("Continue, then Esc, on a replay changes nothing", plugins().ai !== false)
await ctx.close()

// Found, its plugin not here (getting one runs code): named apart, for Settings > AI, never turned on by a yes.
const HERE = (o) => o.map((a) => (a.id === "opencode" ? { ...a, path: "/home/alice/.opencode/bin/opencode" } : a))
;({ ctx, page } = await open({ agents: HERE(FOUND) }))
await palette(page, "Show welcome")
await page.locator("[data-welcome-next]").click()
await until(() => page.locator("[data-welcome-ai=found]").count(), 4000)
check("found without its plugin: not offered, named for Settings > AI", (await page.locator("#welcome-title").innerText()).startsWith("Claude Code and Codex are on this")
  && (await page.locator("[data-welcome]").innerText()).includes("OpenCode is here too: Settings > AI can add it"))
await ctx.close()
;({ ctx, page } = await open({ agents: HERE(NONE) }))
await palette(page, "Show welcome")
await page.locator("[data-welcome-next]").click()
await until(() => page.locator("[data-welcome-ai=none]").count(), 4000)
check("only one without its plugin: works without AI, and says where to add it", (await page.locator("[data-welcome]").innerText()).includes("Settings > AI can add it") && !(await page.locator("[data-welcome-use]").count()))
await ctx.close()

// ---------- a new vault, no layout picked, Not now: Standard, and AI stays off ----------
await api("POST", "ops/settings.set", { name: "plugins", values: { ai: null } })
offer()
;({ ctx, page } = await open())
await until(() => card(page).count(), 8000)
await page.locator("[data-welcome-next]").click()
await page.locator("[data-welcome-not-now]").click()
await page.locator("[data-welcome-next]").click()
await gone(page)
check("no pick, Not now, Done: Standard applied first, AI still off", await until(() => !existsSync(OFFER) && plugins().ai === false, 6000), plugins())
await ctx.close()

// ---------- a new vault skipped with no agents: Standard, AI off ----------
offer()
;({ ctx, page } = await open({ agents: NONE }))
await until(() => card(page).count(), 8000)
await wait(600)
await page.locator("[data-welcome-skip]").click()
await gone(page)
check("skipped: the offer ends (Standard), and with no agent AI is off", await until(() => !existsSync(OFFER) && plugins().ai === false, 6000), plugins())
await ctx.close()

// ---------- a phone: no card, Standard ----------
await api("POST", "ops/settings.set", { name: "plugins", values: { ai: null } })
offer()
;({ ctx, page } = await open({ w: 390, h: 844, mobile: true }))
await until(() => !existsSync(OFFER), 8000)
check("a phone shows no card: the new vault starts on Standard", !existsSync(OFFER) && !(await card(page).count()))
await ctx.close()

await done()
