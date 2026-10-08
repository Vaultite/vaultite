// Bug recorder end to end: on, it records typing (counted, not the letters), scrolling the user did and the app did, and
// Report a bug saves a note with the description and the timeline. WRITES "QA recorder/" and "Bug reports/": throwaway
// server only.
//   node web/qa/recorder.mjs <base url>
import { execFileSync } from "node:child_process"
import path from "node:path"
import { ROOT, apiAt, palette, qa, until, wait } from "./lib/qa.mjs"

const { args: [B0], browser, check, watch, done } = await qa(import.meta.url)
const B = B0.endsWith("/") ? B0 : `${B0}/`
const api = apiAt(B)
execFileSync(process.execPath, [path.join(ROOT, "bin/vau"), "--url", B, "plugin", "on", "recorder"], { encoding: "utf8" })
const P = "QA recorder/Long note.md"
await api("POST", "file", { path: P, text: `# Long note\n\n${Array.from({ length: 120 }, (_, i) => `Line ${i + 1} of the long note.`).join("\n\n")}\n` })

const page = watch(await (await browser.newContext({ viewport: { width: 1300, height: 850 } })).newPage())
await page.goto(`${B}#file/${encodeURIComponent(P)}`)
await page.waitForSelector(".cm-content", { timeout: 30000 })
await wait(1500)
await page.locator(".cm-line", { hasText: "Line 3 of" }).first().click()
await page.keyboard.type("secret words", { delay: 20 })
await page.mouse.move(650, 500)
await page.mouse.wheel(0, 900)
await wait(1200)
// (the app moving the page with nobody touching it: what the recorder must tell apart)
await page.evaluate(() => { const s = document.querySelector("[data-pane]:not([data-kept]) .overflow-y-auto, #main-scroll"); if (s) s.scrollTop = 0 })
await wait(1200)

const reports = async () => ((await api("GET", "state")).files?.files ?? []).map((x) => x.path).filter((p) => p.startsWith("Bug reports/"))
const before = new Set(await reports())
await palette(page, "Report a bug", 600)
check("Report a bug asks what went wrong", await page.getByText("What went wrong?").isVisible().catch(() => false))
await page.keyboard.type("It jumped to the top")
await page.keyboard.press("Enter")
const report = await until(async () => {
  const f = (await reports()).find((p) => p.endsWith(".md") && !before.has(p))
  return f ? (await api("GET", `file?path=${encodeURIComponent(f)}`)).text : null
}, 15000, 300)
check("the report is saved in Bug reports/", !!report)
const r = report ?? ""
check("it has the description", r.includes("It jumped to the top"), r.slice(0, 300))
check("it has the timeline", r.includes("## Timeline") && r.includes("```text"))
check("typing is counted", /key key=typed n=\d{2,} in="editor/.test(r), r.match(/.*key=typed.*/)?.[0])
check("the letters typed aren't in it", !r.includes("secret words"))
check("the editor's changes are in it", /editor input\.type x\d+ path=/.test(r))
check("the user's wheel and scroll are in it", /wheel dy=\d+/.test(r) && / scroll .*by=user/.test(r), r.match(/.* scroll .*/g)?.slice(0, 4))
check("the app's scroll is told apart", / scroll .*by=app/.test(r), r.match(/.* scroll .*/g)?.slice(0, 6))
check("the report opened in a tab", await until(() => page.evaluate(() => decodeURIComponent(location.hash).includes("Bug reports/")), 5000))
await done()
