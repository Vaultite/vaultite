// Live answers: a ```genui fence draws with the app's controls, block buttons share a row without spilling out of it, an
// AppBlock gets ChatGPT's theme variables, a change redraws it and is kept in the note (and back
// after a reload), an AppBlock and the program share state both ways, the program has no network, a ```chart draws, on a
// desktop and a 390px phone. WRITES fixtures (QA/ in the vault): throwaway server only.
//   node web/qa/genui.mjs <base url> <vault path>
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { qa, until, wait, SHOTS as OUT } from "./lib/qa.mjs"
const { args: [B, VAULT], browser, check, watch, done } = await qa(import.meta.url)
mkdirSync(OUT, { recursive: true })
mkdirSync(`${VAULT}/QA`, { recursive: true })
const NOTE = "QA/QA live answer.md"
writeFileSync(`${VAULT}/${NOTE}`, `# QA live answer

Pick a size.

\`\`\`genui
{@body const [size, setSize] = DIL.useState("s")}
{@body const [net, setNet] = DIL.useState("?")}
{@body DIL.useEffect(() => { try { fetch("https://example.com").then(() => setNet("open"), () => setNet("blocked")) } catch { setNet("blocked") } }, [])}
<box gap={2}>
  <select value={size} onChange={setSize} options={[{value: "s", label: "Small"}, {value: "l", label: "Large"}]}/>
  <title>Size {size}</title>
  <text>Network: {net}</text>
  <AppBlock title="QA app" bind={{value: size, setValue: setSize}}>
    <button id="pick" class="px-2 py-1 rounded bg-blue-500 text-white">Large</button>
    <p id="seen">-</p>
    <p id="viz">-</p>
    <script>
      document.getElementById("pick").onclick = () => globalThis.__bindings.setValue("l")
      globalThis.__effect(() => { document.getElementById("seen").textContent = "seen " + globalThis.__bindings.value })
      document.getElementById("viz").textContent = getComputedStyle(document.documentElement).getPropertyValue("--viz-accent").trim() && getComputedStyle(document.documentElement).getPropertyValue("--text-secondary").trim() ? "themed" : "bare"
    </script>
  </AppBlock>
  <row gap={2}><button block variant="outline">Previous</button><button block onClick={() => setSize("l")}>Next stage</button></row>
</box>
\`\`\`

\`\`\`chart
type: bar
data:
  - {m: Jan, a: 3}
  - {m: Feb, a: 5}
\`\`\`
`)

for (const [w, h, mobile] of [[1280, 900, false], [390, 844, true]]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: mobile, hasTouch: mobile })
  const page = watch(await ctx.newPage(), { label: w })
  await page.goto(`${B}#file/${encodeURIComponent(NOTE)}`)
  const drawn = await until(() => page.evaluate(() => document.querySelector(".genui select") ? 1 : 0), 10000)
  check(`${w}: the fence draws with the app's controls`, drawn)
  if (!drawn) continue
  const text = () => page.evaluate(() => document.querySelector(".genui")?.innerText ?? "")
  check(`${w}: the program can't reach the network`, await until(async () => /Network: blocked/.test(await text()), 5000), await text())
  check(`${w}: a chart draws`, await page.locator(".genui-chart svg").count() === 1)
  const spill = await page.evaluate(() => { const box = document.querySelector(".genui-block").getBoundingClientRect(); return [...document.querySelectorAll(".genui button")].filter((b) => b.getBoundingClientRect().right > box.right + 1).map((b) => b.textContent) })
  check(`${w}: block buttons in a row share it, none past the answer's edge`, !spill.length, spill)
  if (w === 1280) {
    await page.selectOption(".genui select", "l")
    check("a change redraws it", await until(async () => /Size l/.test(await text()), 3000), await text())
    const frames = page.frames().filter((f) => f !== page.mainFrame())
    let seen = ""
    for (const f of frames) seen ||= await f.evaluate(() => document.getElementById("seen")?.textContent ?? "").catch(() => "")
    check("the AppBlock sees the program's state", seen === "seen l", seen)
    let viz = ""
    for (const f of frames) viz ||= await f.evaluate(() => document.getElementById("viz")?.textContent ?? "").catch(() => "")
    check("the AppBlock has ChatGPT's theme variables", viz === "themed", viz)
    await page.selectOption(".genui select", "s")
    for (const f of frames) if (await f.evaluate(() => !!document.getElementById("pick")).catch(() => false)) await f.click("#pick")
    check("the AppBlock sets the program's state", await until(async () => /Size l/.test(await text()), 3000), await text())
    const saved = await until(() => /\{@state \{"size":"l"/.test(readFileSync(`${VAULT}/${NOTE}`, "utf8")), 5000)
    check("its values are kept in the note", saved, readFileSync(`${VAULT}/${NOTE}`, "utf8").match(/\{@state.*\}/)?.[0])
    await page.reload()
    check("and come back when it opens again", await until(async () => /Size l/.test(await text()), 10000), await text())
  }
  await page.screenshot({ path: `${OUT}genui-${w}.png` })
  await ctx.close()
}
await wait(100)
await done()
