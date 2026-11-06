// A vault plugin written for a newer plugin API than the window was built with (a window left open across an update,
// a plugin updated meanwhile): the window doesn't run it, so a note with its tasks still draws (no React "element type
// is undefined"), the plugin says why, and the window reloads once into the server's build. Then, with the same API,
// the plugin draws the note's tasks with their Do it.
// WRITES a vault plugin and fixtures: throwaway server only.
//   node web/qa/pluginapi.mjs <base url> <vault path>
import { mkdirSync, writeFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { qa, until, wait } from "./lib/qa.mjs"
const { args: [B, VAULT], browser, check, done } = await qa(import.meta.url)
const api = Number((await (await fetch(new URL("/api/ops/app.version", B), { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).json().catch(() => ({}))).api) || 8
const dir = `${VAULT}/.vaultite/plugins/qa-tasks`
mkdirSync(dir, { recursive: true })
writeFileSync(`${dir}/manifest.json`, JSON.stringify({ id: "qa-tasks", name: "QA tasks", description: "a note's open tasks, each with Do it", version: "0.1.0", apiVersion: api,
  disclosures: {}, blocks: { "qa-tasks": { description: "a note's open tasks", options: {} } } }, null, 2))
// (first as code of a newer API: it draws a component this app doesn't have yet, undefined here)
const code = (comp) => `import * as V from "@vaultite"
const Later = (V as Record<string, unknown>)["${comp}"] as (p: { task: { text: string } }) => null
export default V.definePlugin({ blocks: { "qa-tasks": () => <ul data-qa-tasks>{["Compare the two flights", "Book the car"].map((t) => <li key={t}>{t} <Later task={{ text: t }} /></li>)}</ul> } })
`
writeFileSync(`${dir}/index.tsx`, code("ComingInTheNextApi"))
writeFileSync(`${dir}/plugin.ts`, `import { Plugin } from "@vaultite/core/plugins.ts"\nexport const plugin = new Plugin(import.meta.url)\nplugin.block("qa-tasks", () => "- Compare the two flights\\n- Book the car")\n`)
mkdirSync(`${VAULT}/QA`, { recursive: true })
writeFileSync(`${VAULT}/QA/Trip.md`, "---\ntype: note\n---\n# Trip\n\n- [ ] Compare the two flights\n- [ ] Book the car\n\n```block-qa-tasks\n```\n")
const vau = (...a) => execFileSync("vau", ["--url", B, ...a], { encoding: "utf8" })
vau("plugin", "on", "qa-tasks")
vau("plugin", "allow", "qa-tasks")

const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
const errors = []
page.on("pageerror", (e) => errors.push(e.message))
page.on("console", (m) => { if (m.type() === "error" && /Minified React error|Element type is invalid/.test(m.text())) errors.push(m.text()) })
let loads = 0
page.on("load", () => { loads++ })
try {
  // The window older than the plugin: the server's state says it needs a newer API than this build has.
  await page.route("**/api/state**", async (r) => {
    // (the whole state each time, not a patch of one this page holds)
    const res = await r.fetch({ url: r.request().url().replace(/since=[^&]*/, "since=0") }), j = await res.json()
    for (const p of j.state?.vaultPlugins ?? []) if (p.id === "qa-tasks") p.apiVersion = api + 1
    return r.fulfill({ response: res, json: j })
  })
  await page.goto(`${B}#file/${encodeURIComponent("QA/Trip.md")}`)
  await page.waitForSelector(".cm-line", { timeout: 20000 })
  check("a note with tasks still draws", await until(async () => (await page.locator(".cm-line", { hasText: "Compare the two flights" }).count()) > 0, 10000))
  await wait(3000)
  check("…with no React error (an element type undefined)", errors.length === 0, errors)
  check("…and the plugin doesn't draw there", (await page.locator("[data-qa-tasks]").count()) === 0)
  check("the window reloads once into the server's build, never again", await until(() => loads >= 2, 15000) && (await wait(4000), loads === 2), loads)
  const why = await page.evaluate(() => fetch("/api/state").then((r) => r.json()).then(() => true)).catch(() => false)
  check("the app still answers", why)

  // The same API: the plugin draws the note's tasks with their Do it.
  await page.unroute("**/api/state**")
  writeFileSync(`${dir}/index.tsx`, code("DoIt"))
  await wait(1500)
  vau("plugin", "allow", "qa-tasks")
  await page.reload()
  check("with its API, the plugin draws the tasks", await until(async () => (await page.locator("[data-qa-tasks] li").count()) === 2, 20000))
  check("…each with Do it", (await page.locator("[data-qa-tasks] [data-do-it]").count()) === 2, await page.locator("[data-qa-tasks]").innerHTML().catch(() => ""))
  check("no React error at all", errors.length === 0, errors)
} finally { await done() }
