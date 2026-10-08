// vau choose (ui.choose, core/coreops.ts; the window's answer in components/Chooser.tsx): lines piped in show in the
// window's palette with the prompt above them, filtered as typed; Enter answers the pick's id, Esc nothing; JSON items
// keep their ids and details; --current starts on one; --other answers what's typed; a timeout closes the list and is
// an error; the window closing ends the wait; no window says so. Opens the app in headless Chrome.
// WRITES: nothing in the vault.
//   node web/qa/choose.mjs <base url>
import { spawn } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { CHROME, qa, ROOT, wait } from "./lib/qa.mjs"

if (!fs.existsSync(CHROME)) { console.log("choose: skipped (no Google Chrome here)"); process.exit(0) }
const { args: [arg], browser, check, done } = await qa(import.meta.url)
const base = arg.endsWith("/") ? arg : `${arg}/`
/** vau running in the background: its exit status and output once it ends. */
const vau = (args, input = "") => new Promise((resolve) => {
  const p = spawn(process.execPath, [path.join(ROOT, "bin/vau"), ...args], { env: { ...process.env, VAULTITE_URL: base.replace(/\/$/, "") } })
  let stdout = "", stderr = ""
  p.stdout.on("data", (d) => { stdout += d })
  p.stderr.on("data", (d) => { stderr += d })
  p.on("close", (status) => resolve({ status, stdout, stderr }))
  p.stdin.end(input)
})
const json = (r) => { try { return JSON.parse(r.stdout) } catch { return null } }

try {
  let r = await vau(["choose"], "One\nTwo\n")
  check("no window open: says so, exit 1", r.status === 1 && r.stderr.includes("no app window is open"), r)

  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  let page = await ctx.newPage()
  await page.goto(base)
  await page.waitForFunction(() => document.querySelector("#root > *"), null, { timeout: 20000 })
  await wait(1500)
  const dialog = () => page.locator('[role="dialog"][aria-modal="true"]')
  const shown = () => page.waitForSelector('[role="dialog"] [role="option"]', { timeout: 5000 }).then(() => true, () => false)

  // Lines piped in, filtered, Enter picks.
  let run = vau(["choose", "--prompt", "Which fruit?"], "Apple\nBanana\nCherry\n")
  check("the list shows in the window", await shown(), null)
  const text = await dialog().innerText()
  check("the prompt above the lines", text.includes("Which fruit?") && text.includes("Apple") && text.includes("Cherry"), text)
  await page.keyboard.type("bnn")
  await wait(100)
  check("typing filters it", (await dialog().locator('[role="option"]').count()) === 1, await dialog().innerText())
  await page.keyboard.press("Enter")
  r = await run
  check("Enter: the pick printed", r.status === 0 && r.stdout.trim() === "Banana", r)
  check("the list is gone", (await dialog().count()) === 0, null)

  // Esc: nothing.
  run = vau(["choose", "--json"], "Apple\nBanana\n")
  await shown()
  await page.keyboard.press("Escape")
  r = await run
  check("Esc: nothing picked", r.status === 0 && json(r)?.picked === null && json(r)?.typed === null, r)

  // JSON items: ids, details, a current one.
  run = vau(["choose", "--json", "--current", "b", "--items", JSON.stringify([{ id: "a", label: "Keep both", detail: "two files" }, { id: "b", label: "Merge", icon: "merge" }, "Skip"])])
  await shown()
  const rows = await dialog().innerText()
  check("an item's detail", rows.includes("two files"), rows)
  await page.keyboard.press("Enter")
  r = await run
  check("--current: Enter picks it, with its id and index", json(r)?.picked?.id === "b" && json(r)?.picked?.index === 1 && json(r)?.picked?.label === "Merge", r)

  // --other: what's typed.
  run = vau(["choose", "--other"], "Low\nHigh\n")
  await shown()
  await page.keyboard.type("Medium")
  await wait(100)
  await page.keyboard.press("Enter")
  r = await run
  check("--other: the text typed", r.status === 0 && r.stdout.trim() === "Medium", r)

  // A list in place of another: the first answers nothing.
  const first = vau(["choose", "--json"], "One\n")
  await shown()
  run = vau(["choose"], "Two\n")
  r = await first
  check("a second list in place of the first: the first gets nothing", json(r)?.picked === null, r)
  await wait(300)
  await page.keyboard.press("Enter")
  r = await run
  check("the second answers", r.stdout.trim() === "Two", r)

  // Time's up: an error, and the list closes.
  r = await vau(["choose", "--timeout", "5"], "Late\n")
  check("timeout: exit 1, says so", r.status === 1 && r.stderr.includes("picked nothing within 5 s"), r)
  await wait(300)
  check("timeout: the list closed", (await dialog().count()) === 0, null)

  r = await vau(["choose", "--items", "[]"])
  check("no items: an error", r.status === 1 && r.stderr.includes("nothing to pick"), r)

  // The window closing ends the wait.
  run = vau(["choose", "--timeout", "60"], "Gone\n")
  await shown()
  await page.close()
  const t0 = Date.now()
  r = await run
  check("the window closing ends the wait", r.status === 1 && r.stderr.includes("closed") && Date.now() - t0 < 10000, r)
} catch (e) {
  check(String(e), false)
}
await done()
