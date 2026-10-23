// The Links panel on a web page (plugins/core/backlinks): the notes about it and linking it, links elsewhere on its
// site, and "New note on this page" making a note whose `source` it is, beside the page. WRITES a "Qa web links" folder,
// plugins.json and sidebars.json (put back): throwaway server only.
//   node web/qa/weblinks-panel.mjs <base url>
import { apiAt, qa, until } from "./lib/qa.mjs"

const { args: [B0], browser, check, watch, done } = await qa(import.meta.url)
const B = B0.endsWith("/") ? B0 : `${B0}/`
const api = apiAt(B)
const URL = "https://example.com/posts/one"
const sidebars = await api("GET", "config/sidebars")
await api("POST", "ops/plugin.enable", { id: "web-viewer" })
await api("PUT", "config/sidebars", { left: ["pages:pages"], right: ["backlinks:links"], collapsed: [], heights: {} })
await api("POST", "file", { path: "Qa web links/About it.md", text: `---\ntype: note\nsource: ${URL}\n---\n\nMy notes.\n` })
await api("POST", "file", { path: "Qa web links/Linking it.md", text: `Read [the post](${URL}?utm_source=x).\nAlso https://example.com/about.\n` })

try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  // (about:blank has no storage)
  await ctx.addInitScript(() => { try { if (!sessionStorage.getItem("qa")) { localStorage.clear(); sessionStorage.setItem("qa", "1") } } catch { /* about:blank */ } })
  const page = watch(await ctx.newPage(), { console: true })
  await page.goto(`${B}#view/${encodeURIComponent(`web/${URL}`)}`)
  const panel = page.locator("[data-links-panel]")
  const rows = (group) => panel.locator(`[data-links-group='${group}'] [data-link-item]`).evaluateAll((els) => els.map((e) => e.dataset.linkItem))
  check("the panel is for the page", !!(await until(async () => (await panel.locator(`[data-links-for='${URL}']`).count()) > 0, 15000)))
  check("this page: the note about it, then the one linking it", !!(await until(async () => (await rows("page")).join("|") === "About it|Linking it")), await rows("page"))
  check("elsewhere on its site", !!(await until(async () => (await rows("site")).includes("Linking it"))), await rows("site"))
  await panel.locator("[data-page-note]").click()
  const at = () => page.evaluate(() => decodeURIComponent(location.hash))
  check("its note opens beside the page", !!(await until(async () => (await page.locator("[data-pane]").count()) > 1 && (await at()).endsWith("About it.md"))), await at())
  await api("DELETE", `file?path=${encodeURIComponent("Qa web links/About it.md")}`)
  // (a hash set on the open page is undone by the workspace's tabs: load it fresh)
  await page.goto("about:blank")
  await page.goto(`${B}#view/${encodeURIComponent("web/https://example.org/new")}`)
  await until(async () => (await panel.locator("[data-links-for='https://example.org/new'] [data-page-note]").count()) > 0, 15000)
  await panel.locator("[data-page-note]").click()
  check("none yet: a new note named after the page opens", !!(await until(async () => /example\.org\.md$/.test(await at()), 10000)), await at())
  const made = (await at()).replace(/^#file\//, "")
  const text = (await api("GET", `file?path=${encodeURIComponent(made)}`)).text ?? ""
  check("its source is the address", text.includes("source: https://example.org/new\n"), text)
  await api("DELETE", `file?path=${encodeURIComponent(made)}`)
} finally {
  await api("DELETE", `file?path=${encodeURIComponent("Qa web links/Linking it.md")}`)
  await api("PUT", "config/sidebars", sidebars)
  await done()
}
