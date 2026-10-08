// A plugin's newer page (core/pages.ts, plugins/core/dashboards/Update.tsx): the app never changes a page itself, the
// page shows "Update available"; See changes opens the difference, Update makes the page the new version, Dismiss
// keeps it and the bar stays gone. A page the user changed says so. Makes Today and Health look installed from an older
// template by editing the vault's files: throwaway server only.
//   node web/qa/pageupdate.mjs <base url> <vault path>
import fs from "node:fs"
import path from "node:path"
import { qa, until, wait } from "./lib/qa.mjs"
const { args: [B, VAULT], browser, check, watch, done } = await qa(import.meta.url)
const file = (rel) => path.join(VAULT, rel)
const read = (rel) => fs.readFileSync(file(rel), "utf8")

// As if installed from an older template: the kept copy and the page say `icon: star`; Health is also changed by hand.
for (const name of ["Today", "Health"]) {
  const kept = `.vaultite/generated/Dashboards/${name}.md`, page = `Dashboards/${name}.md`
  const old = read(kept).replace(/^icon: .*$/m, "icon: star")
  fs.writeFileSync(file(kept), old)
  fs.writeFileSync(file(page), name === "Health" ? `${old}\nMy own line.\n` : old)
}
const template = fs.readFileSync(new URL("../../plugins/core/today/pages/Today.md", import.meta.url), "utf8")
await wait(1500)

const page = watch(await browser.newPage({ viewport: { width: 1280, height: 900 } }))
const bar = page.locator("[data-page-update]")

await page.goto(`${B}#file/${encodeURIComponent("Dashboards/Today.md")}`)
check("an older page shows the bar", await until(async () => await bar.count() === 1, 8000))
check("...and the file is as it was", read("Dashboards/Today.md").includes("icon: star"))
check("Update available, an untouched copy", (await bar.getAttribute("data-page-update")) === "clean" && (await bar.innerText()).includes("Update available"))
await bar.getByRole("button", { name: "See changes" }).click()
check("See changes: a tab with the difference",
  await until(async () => (await page.locator("[data-page-diff] [data-diff=add]").count()) > 0 && (await page.locator("[data-page-diff] [data-diff=del]").count()) > 0, 8000))
await page.goBack()
await until(async () => await bar.count() === 1, 8000)
await bar.getByRole("button", { name: "Update" }).click()
check("Update: the page is the new version", await until(() => read("Dashboards/Today.md") === template, 8000))
check("...and the bar goes", await until(async () => await bar.count() === 0, 8000))

await page.goto(`${B}#file/${encodeURIComponent("Dashboards/Health.md")}`)
check("a page the user changed: the bar says so", await until(async () => (await bar.getAttribute("data-page-update").catch(() => null)) === "edited", 8000))
check("...in words", (await bar.innerText()).includes("You changed this page"))
await bar.getByRole("button", { name: "Dismiss" }).click()
check("Dismiss: the bar goes", await until(async () => await bar.count() === 0, 8000))
await page.reload()
await wait(2500)
check("...and stays gone, the page as it was", await bar.count() === 0 && read("Dashboards/Health.md").includes("My own line."))
await done()
