// A file drawn in a sidebar (mini-apps): an .html page, a note with a genui and an mcp-app block; by vau and by the palette.
// WRITES fixtures (QA/ in the vault): throwaway server only.
//   node web/qa/filepanels.mjs <base url> <vault path>
import { mkdirSync, writeFileSync } from "node:fs"
import { apiAt, palette, qa, until, wait, SHOTS as OUT } from "./lib/qa.mjs"
const { args: [B, VAULT], browser, check, watch, done } = await qa(import.meta.url)
mkdirSync(OUT, { recursive: true })
mkdirSync(`${VAULT}/QA`, { recursive: true })
writeFileSync(`${VAULT}/QA/table.csv`, "a,b\n1,2\n3,4\n")
writeFileSync(`${VAULT}/QA/Weather.html`, `<!doctype html><html><head><title>Weather</title></head><body><p id="rows">loading</p>
<script>vau.csv("table.csv").then((r) => { document.getElementById("rows").textContent = r.length + " rows" })</script></body></html>`)
writeFileSync(`${VAULT}/QA/Cups.md`, "---\ntype: note\n---\nA small app.\n\n```genui\n{@body const [n, setN] = DIL.useState(3)}\n<box gap={2}><title size=\"md\">{n} cups</title><slider min={0} max={8} value={n} onChange={setN}/></box>\n```\n\n- [ ] Water the fern\n\n```block-mcp-app\ntool: read\narguments:\n  path: QA/Note.md\n```\n")
writeFileSync(`${VAULT}/QA/Note.md`, "A note the card reads.\n")
const api = apiAt(B)
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
watch(page)
await page.goto(B)
await page.waitForSelector("aside", { timeout: 20000 })

await api("POST", "ops/panel.right", { panel: "QA/Weather.html", vault: true })
await api("POST", "ops/panel.right", { panel: "QA/Cups.md", vault: true })
const panel = (f) => page.locator(`[data-file-panel="${f}"]`)
await until(async () => await panel("QA/Weather.html").count() > 0, 8000).catch(() => {})
if (!await panel("QA/Weather.html").count()) await palette(page, "Toggle right sidebar")
check("an .html file drawn as a panel", await until(async () => await panel("QA/Weather.html").count() > 0, 8000))
const rows = async () => { for (const f of page.frames()) { const t = await f.locator("#rows").textContent({ timeout: 300 }).catch(() => null); if (t) return t } return null }
check("it runs, reading the vault", await until(async () => (await rows()) === "2 rows", 10000), await rows())
check("a note's genui answer draws in its panel", await until(async () => /3 cups/.test(await panel("QA/Cups.md").innerText()), 8000))
const slider = panel("QA/Cups.md").locator("input[type=range], [role=slider]").first()
await slider.focus()
await page.keyboard.press("ArrowRight")
check("and it's live", await until(async () => /4 cups/.test(await panel("QA/Cups.md").innerText()), 4000), await panel("QA/Cups.md").innerText())
check("a note's mcp-app card draws in its panel", await until(async () => await panel("QA/Cups.md").locator("iframe").count() > 0 && !/no tool/.test(await panel("QA/Cups.md").innerText()), 8000), await panel("QA/Cups.md").innerText())
await page.screenshot({ path: `${OUT}filepanels.png` })

// Its heading's menu opens the file in a tab, and hides it.
await page.locator('[data-panel="pages:file/QA/Weather.html"] [data-panel-handle]').first().click({ button: "right" })
check("its menu opens it in a tab", await until(async () => await page.getByText("Open Weather in a tab").count() > 0, 3000))
await page.getByText("Open Weather in a tab").first().click()
check("open in a tab: the file's the focused tab", await until(async () => /Weather/.test(await page.locator('[data-tab][data-active="true"], [role=tab][aria-selected="true"]').first().innerText().catch(() => "")), 4000))

// The palette toggles the file on screen.
await palette(page, "Remove current file from the sidebar")
check("the palette takes it out", await until(async () => await panel("QA/Weather.html").count() === 0, 4000))
await palette(page, "Show current file in the sidebar")
check("and puts it back", await until(async () => await panel("QA/Weather.html").count() > 0, 4000))
await wait(200)

await page.close()
await api("POST", "ops/panel.hide", { panel: "QA/Weather.html", vault: true })
await api("POST", "ops/panel.hide", { panel: "QA/Cups.md", vault: true })
done()
