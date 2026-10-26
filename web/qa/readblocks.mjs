// Plugins drawing a note's blocks while it's read (`reading`), with the made-up vault plugin Qa ruby. Writes
// Qa reading/ and .vaultite/plugins/qa-ruby, turned on: throwaway server only.
//   node web/qa/readblocks.mjs <base url> <vault path> [out dir]
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import { SHOTS, palette, qa, until, wait } from "./lib/qa.mjs"
const { args: [B, VAULT, OUT = SHOTS], browser, check, watch, done } = await qa(import.meta.url)
const DIR = "Qa reading", NOTE = `${DIR}/Gems.md`, PLAIN = `${DIR}/Plain.md`, enc = encodeURIComponent
const abs = (p) => `${VAULT}/${p}`
const write = (p, t) => { mkdirSync(dirname(abs(p)), { recursive: true }); writeFileSync(abs(p), t) }
const plugins = () => { try { return JSON.parse(readFileSync(abs(".vaultite/plugins.json"), "utf8")) } catch { return {} } }
const GEMS = "---\norigin: ai\n---\n# Gems\n\nA plain line about [[Plain]].\n\nA ruby for [[Plain]], set in gold.\n\n- [ ] polish the ruby\n- [ ] cut the opal\n\nThe last line.\n"

rmSync(abs(DIR), { recursive: true, force: true })
write(NOTE, GEMS)
write(PLAIN, "---\norigin: ai\n---\n# Plain\n\nNothing a plugin changes, with a [[Gems]] link.\n\n- one\n- two\n\n> A quote.\n")

try {
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 900 } })
  const page = watch(await ctx.newPage())
  const open = async (path) => {
    await page.goto("about:blank"); await page.goto(`${B}#file/${enc(path)}`)
    await page.waitForSelector("[data-pane] .cm-content", { timeout: 15000 }); await wait(600)
    if (await page.locator("[data-pane] .cm-content[contenteditable=true]").count()) await palette(page, "Switch to reading view")
    await until(() => page.locator("[data-pane] .cm-content[contenteditable=false]").count(), 5000)
    await wait(800)
  }
  const content = () => page.evaluate(() => document.querySelector("[data-pane] .cm-content")?.innerHTML ?? "")
  const drawn = () => page.locator("[data-pane] .cm-block-read")

  await open(PLAIN)
  const before = await content()
  check("no plugin: reading is the editor's own drawing", before.includes("cm-line") && (await drawn().count()) === 0)

  write(".vaultite/plugins/qa-ruby/manifest.json", JSON.stringify({ id: "qa-ruby", category: "other", name: "Qa ruby", icon: "gem", description: "A made-up vault plugin that marks rubies while a note is read.", version: "1.0.0", author: "Alice Park", disclosures: {}, apiVersion: 4 }, null, 2))
  write(".vaultite/plugins/qa-ruby/index.tsx", `import { definePlugin } from "@vaultite"
const asked = (window as any).__qaAsked = [] as unknown[]
export default definePlugin({
  reading: {
    active: () => true,
    subscribe: () => () => {},
    draw: (el, b) => {
      asked.push({ kind: b.kind, path: b.path, lines: [b.lineStart, b.lineEnd], text: b.text })
      if (!/ruby/.test(b.text)) return null
      const s = document.createElement("span")
      s.className = "qa-gem"
      s.textContent = " (gem)"
      el.querySelector("p, li")?.append(s)
      return { destroy: () => { (window as any).__qaLetGo = ((window as any).__qaLetGo ?? 0) + 1 } }
    },
  },
})
`)
  await page.goto(`${B}#plugins`)
  const sw = page.getByRole("switch", { name: "Qa ruby plugin" })
  check("Qa ruby is listed", await until(async () => (await sw.count()) === 1, 15000))
  if ((await sw.getAttribute("aria-checked")) !== "true") await sw.click()
  check("…and on", await until(async () => (plugins().enabled ?? []).includes("qa-ruby"), 8000), plugins().enabled)
  await wait(1500)

  // A note it changes nothing in: asked about every block, drawn exactly as before.
  await open(PLAIN)
  const asked = () => page.evaluate((p) => (window.__qaAsked ?? []).filter((a) => a.path === p), PLAIN)
  const kinds = await until(async () => { const a = await asked(); return a.length >= 5 && [...new Set(a.map((x) => x.kind))].sort().join() }, 8000)
  check("every block asked once: the frontmatter, heading, paragraph, list, quote", kinds === "frontmatter,heading,list,paragraph,quote", await asked())
  check("…and a note none changed draws exactly as before", (await content()) === before && (await drawn().count()) === 0)

  // A note with rubies: only their blocks drawn as made, at their lines.
  await open(NOTE)
  check("the blocks it changed are drawn as it made them", await until(async () => (await drawn().count()) === 2, 8000), await drawn().count())
  const gems = await page.evaluate((p) => (window.__qaAsked ?? []).filter((a) => a.path === p && /ruby/.test(a.text)).map((a) => a.lines), NOTE)
  const lines = GEMS.split("\n"), at = (t) => lines.findIndex((l) => l.startsWith(t))
  check("…each knows its lines in the file", JSON.stringify(gems) === JSON.stringify([[at("A ruby"), at("A ruby")], [at("- [ ] polish"), at("- [ ] cut")]]), gems)
  check("…the rest is the editor's lines", await page.locator("[data-pane] .cm-line", { hasText: "A plain line about" }).count() === 1)
  await page.screenshot({ path: `${OUT}readblocks-reading.png` })

  // Its task ticks the file; its link opens the note, once.
  await drawn().locator("input[type=checkbox]").first().click()
  check("a task in a drawn block ticks the file", await until(() => readFileSync(abs(NOTE), "utf8").includes("- [x] polish the ruby"), 5000), readFileSync(abs(NOTE), "utf8"))
  await page.goto("about:blank"); await page.goto(`${B}#file/${enc(NOTE)}`); await page.waitForSelector("[data-pane] .cm-block-read", { timeout: 15000 }); await wait(500)
  const back = await page.evaluate(() => history.length)
  await drawn().locator("[data-wiki]").first().click()
  check("a link in a drawn block opens its note", await until(() => page.url().includes(enc(PLAIN)), 5000), page.url())
  await wait(600)
  check("…once, in the app", (await page.evaluate(() => history.length)) === back + 1 && (await ctx.pages()).length === 1, { back, now: await page.evaluate(() => history.length) })

  // Live preview: the source, what it made let go; reading again draws it again.
  await open(NOTE)
  await until(() => drawn().count(), 8000)
  const letGo = () => page.evaluate(() => window.__qaLetGo ?? 0)
  const was = await letGo()
  await palette(page, "Switch to live preview")
  check("live preview shows the source", await until(async () => (await drawn().count()) === 0, 5000) && await page.locator("[data-pane] .cm-line", { hasText: "A ruby for" }).count() === 1)
  check("…and lets go of what it made", (await letGo()) >= was + 2, { was, now: await letGo() })
  await palette(page, "Switch to reading view")
  check("reading again draws it again", await until(async () => (await drawn().count()) === 2, 5000))
} finally {
  rmSync(abs(".vaultite/plugins/qa-ruby"), { recursive: true, force: true })
  const c = plugins(); if (c.enabled) { c.enabled = c.enabled.filter((x) => x !== "qa-ruby"); write(".vaultite/plugins.json", JSON.stringify(c, null, 2) + "\n") }
  rmSync(abs(DIR), { recursive: true, force: true })
}
await done()
