// A coding agent's conversation pinned (view:terminal/resume-claude-<session>): the sidebar shows it under the name it
// was pinned with (pages.json's labels) and its agent's icon; its menu opens it and unpins it (Unpin last, no file
// items), and unpinning forgets its name. The server takes only a view that names one.
// WRITES .vaultite/pages.json (and puts it back): throwaway server only.
//   node web/qa/viewpins.mjs <base url>
import { execFileSync } from "node:child_process"
import path from "node:path"
import { qa, until } from "./lib/qa.mjs"
const { args: [B], browser, check, watch, done } = await qa(import.meta.url)
const post = (p, body) => fetch(`${B}api/${p}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
const conf = async () => (await (await fetch(`${B}api/config/pages`)).json())
const before = await conf()
// pages.json's list, the one the sidebar shows without Workspaces (with it, a workspace's own: put back at the end)
const vau = (...a) => execFileSync(process.execPath, [path.resolve(import.meta.dirname, "../../bin/vau"), "--url", B, ...a], { encoding: "utf8" })
const desks = /^on\s+workspaces/m.test(vau("plugins"))
if (desks) vau("plugin", "off", "workspaces")
const KEY = "view:terminal/resume-claude-0b5c9e2a-4f1d-4c4e-9a7e-2d6f1b3c8e90"
const NAME = "Fix the sidebar menus"

try {
  check("a view that names nothing isn't pinned", !(await post("pins", { path: "view:", pinned: true })).ok)
  check("a label is only for a view", !(await post("pins/label", { path: "Notes/a.md", label: "x" })).ok)
  await post("pins/label", { path: KEY, label: NAME })
  check("a conversation pins", (await post("pins", { path: KEY, pinned: true })).ok && (await conf()).pinned.includes(KEY), (await conf()).pinned)
  check("...its name in pages.json's labels", (await conf()).labels?.[KEY] === NAME, (await conf()).labels)

  const page = watch(await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage())
  await page.goto(B); await page.waitForSelector("nav[aria-label=Pages]")
  const row = page.locator(`nav[aria-label=Pages] [data-pin="${KEY}"]`)
  check("the sidebar shows it, by the name it was pinned with", !!(await until(async () => (await row.count()) === 1)) && (await row.innerText()).trim() === NAME, await page.locator("nav[aria-label=Pages]").innerText())
  check("...linking to its terminal", (await row.getAttribute("href")) === `#view/${encodeURIComponent(KEY.slice(5))}`, await row.getAttribute("href"))
  await row.click({ button: "right" })
  const items = await page.locator("[role=menu] [role^=menuitem]").allInnerTexts()
  check("its menu: open it, Unpin last, no file items", items[0] === "Open in new tab" && items.at(-1) === "Unpin" && !items.includes("Rename") && !items.includes("Copy path"), items)
  await page.locator("[role=menuitem]", { hasText: /^Unpin$/ }).click()
  check("Unpin: out of the sidebar and of pages.json", !!(await until(async () => !(await row.count()) && !(await conf()).pinned.includes(KEY))), (await conf()).pinned)
  check("...its name forgotten", !(await conf()).labels?.[KEY], (await conf()).labels)
} finally {
  await post("pins", { path: KEY, pinned: false })
  for (const p of before.pinned ?? []) await post("pins", { path: p, pinned: true })
  if (desks) vau("plugin", "on", "workspaces")
}
await done()
