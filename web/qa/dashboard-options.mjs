// A block on a dashboard (the user's file, read, not edited): its menu lists its live data's folders, Options writes
// its fence. WRITES to the vault: throwaway server only.
//   node web/qa/dashboard-options.mjs <base url> [out dir]
import { SHOTS, qa, wait } from "./lib/qa.mjs"
import { pagePath } from "./subjects.mjs"
const { args: [B, OUT = SHOTS], browser, check, watch, done } = await qa(import.meta.url)
const enc = encodeURIComponent
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 })
const page = watch(await ctx.newPage())
const menu = page.locator("[role=menu]")
const block = page.locator('[data-block="agent-sessions"] > *').first()

const PAGE = await pagePath(B, "Claude")
const fence = async () => {
  const text = (await (await fetch(`${B}api/file?path=${enc(PAGE)}`)).json()).text
  return /```block-agent-sessions\n([\s\S]*?)```/.exec(text)?.[1] ?? null
}
const src = await (await fetch(`${B}api/blocks/sources?path=${enc(PAGE)}&name=agent-sessions&nth=0`)).json()
const live = src.sources?.find((s) => s.kind === "live")
check(`its live source names its folders (${live?.folders?.map((f) => f.label).join(", ")})`, live?.folders?.length > 0)

await page.goto(`${B}#file/${enc(PAGE)}`); await wait(2500)
await block.click({ button: "right" }); await wait(1200)
const text = await menu.innerText()
check("its menu lists the folders, to open in Finder", live?.folders?.every((f) => text.includes(f.label)) && /Show in (Finder|folder)/.test(text))
check("…and Options", text.includes("Options"))
await page.screenshot({ path: `${OUT}dashboard-options-menu.png` })
await menu.getByRole("menuitem", { name: /Options/ }).click(); await wait(600)
const form = page.locator(".cm-block-options")
check("Options unfolds its form on the dashboard, not its source", await form.isVisible() && !page.url().includes("line="))
const recent = form.locator("label", { hasText: "Recent" }).locator("input")
await recent.fill("3"); await recent.press("Enter"); await wait(1200)
check(`the form writes its fence (${JSON.stringify(await fence())})`, /recent: 3/.test((await fence()) ?? ""))
await page.screenshot({ path: `${OUT}dashboard-options-form.png` })
await form.getByRole("button", { name: "Done" }).click(); await wait(300)
check("Done folds it", !(await form.isVisible()))
await done()
