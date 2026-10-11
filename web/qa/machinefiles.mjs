// Read-only machine files: folder navigation, text and binary previews, errors, and desktop/phone layout.
// Uses fake API responses and turns Machines on: throwaway server only.
//   node web/qa/machinefiles.mjs <base url> [out dir]
import { mkdirSync } from "node:fs"
import { qa, apiAt, until } from "./lib/qa.mjs"
const { args: [B, OUT = "/tmp/machinefiles-shots/"], browser, check, watch, done } = await qa(import.meta.url)
mkdirSync(OUT, { recursive: true })
await apiAt(B)("POST", "ops/plugin.enable", { id: "machines" })
for (const [name, viewport] of [["desktop", { width: 1280, height: 800 }], ["phone", { width: 390, height: 844 }]]) {
  const ctx = await browser.newContext({ viewport })
  const page = watch(await ctx.newPage())
  await page.route("**/api/machines", (route) => route.fulfill({ json: [{ id: "sandbox", label: "Sandbox", online: true, self: false, dial: true, readOnly: true, via: "studio", plugins: [] }] }))
  await page.route("**/api/machines/sandbox/fs/**", (route) => {
    const u = new URL(route.request().url()), p = u.searchParams.get("path")
    if (u.pathname.endsWith("/list")) return route.fulfill({ json: { path: p === "/home/alice/work" ? p : "/home/alice", parent: "/home", truncated: false,
      entries: p === "/home/alice/work" ? [{ name: "report.txt", dir: false }] : [{ name: "work", dir: true }, { name: "hello.txt", dir: false }, { name: "binary.bin", dir: false }, { name: "missing.txt", dir: false }] } })
    if (p.endsWith("missing.txt")) return route.fulfill({ status: 400, json: { error: "No such file" } })
    return route.fulfill({ json: p.endsWith("binary.bin") ? { path: p, base64: "AAEC", size: 3 } : { path: p, text: "<script>untrusted file</script>\nHello from the VM.", size: 62, truncated: false } })
  })
  await page.goto(`${B}#view/machine-files%2Fsandbox`)
  await page.getByRole("button", { name: "hello.txt", exact: true }).click()
  check(`${name}: text is escaped and read-only`, await until(async () => (await page.locator("[data-file-content]").innerText()).includes("<script>")) && await page.locator("[data-machine-files] textarea").count() === 0)
  await page.getByRole("button", { name: "binary.bin", exact: true }).click()
  check(`${name}: binary preview explained`, await until(async () => (await page.locator("[data-machine-files]").innerText()).includes("Binary file")))
  await page.getByRole("button", { name: "missing.txt", exact: true }).click()
  check(`${name}: read error visible`, await until(async () => (await page.locator("[role=alert]").innerText()).includes("No such file")))
  await page.getByRole("button", { name: "work", exact: true }).click()
  await page.getByRole("button", { name: "report.txt", exact: true }).click()
  check(`${name}: folders navigate`, await page.locator('[aria-label="Folder path"]').inputValue() === "/home/alice/work")
  check(`${name}: no horizontal overflow`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  await page.screenshot({ path: `${OUT}${name}.png` })
  await ctx.close()
}
await done()
