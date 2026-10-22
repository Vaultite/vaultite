// Agents never take the user's focus: a terminal an agent opens goes in a tab behind the one on screen, with a toast
// "Claude Code started a session" whose Show opens it; the user's own `vau terminal open` still shows its tab. On a
// computer and a phone. Writes workspaces (the tabs) and starts shells: throwaway server only.
//   node web/qa/agentfocus.mjs <base url>
import { apiAt, qa, until, wait } from "./lib/qa.mjs"
const { args: [B], browser, check, watch, done } = await qa(import.meta.url)
const agent = apiAt(B, { "X-Vaultite-Client": "cli", "X-Vaultite-Agent": "claude-code" })
const user = apiAt(B, { "X-Vaultite-Client": "cli" })
const started = []
const open = async (as) => { const r = await as("POST", "ops/terminal.open", {}); if (r?.id) started.push(r.id); return r?.id }

async function run(label, viewport, mobile) {
  const ctx = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile })
  const page = watch(await ctx.newPage(), { label, console: true, ignore: /favicon|Failed to load resource|WebSocket/ })
  await page.goto(B)
  await page.waitForSelector(mobile ? "main" : "[role=tree]", { timeout: 60000 })
  await page.bringToFront()
  await page.mouse.click(5, viewport.height / 2) // (the window the user used last is the one that's driven)
  await wait(800)
  const hash = () => page.evaluate(() => decodeURIComponent(location.hash))
  const before = await hash()
  const id = await open(agent)
  const toast = page.locator("[data-sonner-toast]", { hasText: "Claude Code started a session" }).first()
  check(`${label}: an agent's terminal: a toast with Show`, await until(() => toast.count(), 5000) &&
    await toast.getByRole("button", { name: "Show" }).count() === 1, await toast.innerText().catch(() => ""))
  check(`${label}: and the user stays where they were`, (await hash()) === before, [before, await hash()])
  const tabs = ((await user("POST", "ops/tabs.list", {}))?.panes ?? []).flatMap((p) => p.tabs)
  check(`${label}: its tab is there, behind`, tabs.some((t) => t.to === `view:terminal/${id}` && !t.active), tabs)
  await toast.getByRole("button", { name: "Show" }).click().catch(() => {})
  check(`${label}: Show opens it`, await until(async () => (await hash()).includes(`terminal/${id}`), 5000), await hash())
  if (!mobile) {
    const mine = await open(user)
    check(`${label}: the user's own vau terminal open still shows its tab`, await until(async () => (await hash()).includes(`terminal/${mine}`), 5000), await hash())
  }
  await ctx.close()
}

await run("computer", { width: 1440, height: 900 }, false)
await run("phone", { width: 390, height: 844 }, true)
for (const id of started) await user("POST", "ops/terminal.end", { id }).catch(() => {})
await done()
